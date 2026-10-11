import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildUnifiedPrompt,selectCandidates} from '../src/prompts.mjs';
import {validateValue} from '../src/providers.mjs';

// Current language scope is Chinese, including verifiable Chinese names for places
// outside China. Global geography does not mean multilingual language support.
// Evaluation data only: names are user inputs, never runtime aliases, geocoding
// fixtures, or a list of supported cities. These tests make no model calls.
// Passing means candidate recall/input-contract coverage, not correct model API
// selection, argument extraction, or a successful real geocoding/weather lookup.
const dataset=JSON.parse(readFileSync(new URL('../data/global-city-samples.json',import.meta.url),'utf8'));
const samples=dataset.samples;
const candidateModes=[{domain:'weather',limit:6},{domain:undefined,limit:12}];
const weatherTemplates=[
  {text:name=>`${name}现在气温是多少`,api:'weather.current.temperature',time:'现在'},
  {text:name=>`查询${name}现在的湿度`,api:'weather.current.humidity',time:'现在'},
  {text:name=>`查${name}明早的气温`,api:'weather.hourly.temperature',time:'明早'}
];
const ids=candidates=>candidates.map(candidate=>candidate.id);
const point=sample=>({latitude:sample.latitude,longitude:sample.longitude});
const branch=(prompt,api)=>prompt.schema.oneOf.find(item=>item.properties.api.const===api);

test('Chinese-named global city inputs retain independent provenance and geographic diversity',()=>{
  assert.ok(Array.isArray(samples)&&samples.length>=60,'At least 60 independently selected world city inputs are required');
  assert.ok(dataset.provenance&&dataset.sampling,'Keep source and selection method with the test dataset');
  assert.equal(new Set(samples.map(sample=>sample.id)).size,samples.length,'City sample IDs must be unique');
  assert.ok(new Set(samples.map(sample=>sample.continent)).size>=6,'Cover all six inhabited continents');
  assert.ok(samples.filter(sample=>sample.population<50000).length>=30,'Include less-populous places, not only famous cities');
  for(const sample of samples){
    assert.equal(typeof sample.name,'string');assert.ok(sample.name.trim());
    assert.match(sample.name,/\p{Script=Han}/u,`${sample.id}: current city-name language scope is Chinese`);
    assert.equal(typeof sample.canonicalName,'string');assert.ok(sample.nameSourceField);
    assert.match(sample.countryCode,/^[A-Z]{2}$/);
    assert.ok(Number.isFinite(sample.latitude)&&Math.abs(sample.latitude)<=90,`${sample.id}: valid latitude`);
    assert.ok(Number.isFinite(sample.longitude)&&Math.abs(sample.longitude)<=180,`${sample.id}: valid longitude`);
  }
});

test('same Chinese weather intents retain their API among candidates for at least 60 world cities',()=>{
  let checks=0;
  for(const sample of samples)for(const template of weatherTemplates)for(const mode of candidateModes){
    const text=template.text(sample.name),found=selectCandidates(text,mode.domain,{limit:mode.limit});
    assert.ok(ids(found).includes(template.api),`${sample.id} ${sample.name}: ${text}; ${mode.domain??'unified'} lacks ${template.api}`);
    assert.ok(found.length<=mode.limit);checks++;
  }
  assert.ok(checks>=360,'60 cities × 3 intents × staged/unified retrieval');
});

test('Chinese place names reach the prompt unchanged and are legal sparse arguments',()=>{
  for(const sample of samples)for(const template of weatherTemplates){
    const text=template.text(sample.name),prompt=buildUnifiedPrompt(text);
    assert.equal(prompt.messages[1].content,text,`${sample.id}: do not transliterate or trim the user message`);
    const selected=branch(prompt,template.api);
    assert.ok(selected,`${sample.id}: ${template.api} must be a legal API choice`);
    const value={domain:'weather',api:template.api,arguments:{location:sample.name,time_ref:template.time}};
    assert.equal(validateValue(selected,value).valid,true,`${sample.id}: original name is not restricted to known fixtures`);
  }
});

test('city geocoding fixtures do not participate in API candidate retrieval',()=>{
  for(const sample of samples){
    const text=`${sample.name}现在气温是多少`,without=buildUnifiedPrompt(text,{});
    const contexts=[
      {geocodes:{}},
      {location:{latitude:31.2304,longitude:121.4737,source:'fixture'},geocodes:{}},
      {geocodes:{[sample.name]:{...point(sample),source:'fixture',precision:'city'}}}
    ];
    for(const context of contexts){
      const withContext=buildUnifiedPrompt(text,context);
      assert.deepEqual(withContext.promptMeta.candidates,without.promptMeta.candidates,`${sample.id}: known/unknown geocode must not gate API choices`);
      assert.deepEqual(withContext.schema,without.schema);
    }
  }
});

test('forward and reverse geocoding keep their direction for every global sample',()=>{
  for(const sample of samples){
    const requests=[
      {text:`把地址“${sample.name}”转换成经纬度`,api:'location.geocode',args:{address:sample.name},relation:'地址→坐标'},
      {text:`纬度${sample.latitude}、经度${sample.longitude}对应什么地址`,api:'location.reverse_geocode',args:{coordinates:point(sample)},relation:'坐标/当前位置→地址'}
    ];
    for(const request of requests){
      for(const mode of [{domain:'location',limit:6},{domain:undefined,limit:12}]){
        const found=selectCandidates(request.text,mode.domain,{limit:mode.limit});
        assert.ok(ids(found).includes(request.api),`${sample.id}: ${mode.domain??'unified'} lacks ${request.api}`);
      }
      const prompt=buildUnifiedPrompt(request.text),selected=branch(prompt,request.api);
      assert.equal(prompt.messages[1].content,request.text);
      assert.equal(validateValue(selected,{domain:'location',api:request.api,arguments:request.args}).valid,true,`${sample.id}: geocode input contract`);
      assert.ok(prompt.promptMeta.candidates.scores.find(candidate=>candidate.id===request.api).matchedRelations.includes(request.relation));
    }
  }
});

test('an unregistered synthetic name is still legal and cannot become a city whitelist',()=>{
  for(const name of ['未登记甲乙丙市','未登记丁戊己镇']){
    const text=`${name}现在气温是多少`,prompt=buildUnifiedPrompt(text);
    const selected=branch(prompt,'weather.current.temperature');
    assert.ok(selected);
    assert.equal(validateValue(selected,{domain:'weather',api:'weather.current.temperature',arguments:{location:name,time_ref:'现在'}}).valid,true);
    assert.equal(prompt.messages[1].content,text);
  }
});

test('location/intent keyword collisions retain recall without claiming name-independent rank',()=>{
  // Synthetic adversarial names, not geographic facts. Frozen v7 scans the whole
  // sentence lexically, so its ranks may change; recall alone is not API accuracy.
  for(const name of ['潮汐市','风力风向乡','合成日出甲乙镇']){
    const text=`${name}现在湿度是多少`;
    for(const mode of candidateModes)assert.ok(ids(selectCandidates(text,mode.domain,{limit:mode.limit})).includes('weather.current.humidity'),text);
    assert.equal(buildUnifiedPrompt(text).messages[1].content,text);
  }
});
