import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {finalizePlan} from '../src/grounding.mjs';
import {getCapability} from '../src/registry.mjs';
import {runPipeline} from '../src/pipeline.mjs';
import {experimentDefaults} from '../src/fixtures.mjs';

// Geographic scope is worldwide, but this phase accepts Chinese city names/translations.
// These test-only names and source coordinates never enter runtime grounding/geocoding fixtures.
const dataset=JSON.parse(await readFile(new URL('../data/global-city-samples.json',import.meta.url),'utf8'));
const samples=dataset.samples;
const context={...experimentDefaults,geocodes:{},now:'2026-10-10T08:00:00+08:00',timezone:'Asia/Shanghai',location:{latitude:22.5,longitude:114,source:'fixture'}};
const plan=(text,api,args={})=>finalizePlan({text,api,domain:getCapability(api).domain,extractedArguments:args,context});
const assertPlace=(text,api,name,args={})=>{
 const r=plan(text,api,args);
 assert.equal(r.groundedArguments.location,name,text);
 const check=r.grounding.checks.find(item=>item.field==='location'&&item.effectiveValue===name&&item.span);
 assert.ok(check,text);assert.equal(text.slice(check.span.start,check.span.end),name,text);assert.equal(check.span.text,name,text);
 assert.equal(r.status,'resolution_failed',text);assert.equal(r.resolved.sources.location,'user',text);assert.equal(r.resolved.resolution.location.effective,null,text);
 assert.equal(r.mock.executed,false,text);return r;
};

test('global Chinese city samples retain declared provenance and do not enter runtime fixtures',()=>{
 assert.equal(samples.length,60);
 assert.ok(dataset.provenance);assert.ok(dataset.sampling);
 assert.ok(new Set(samples.map(item=>item.continent)).size>=6);
 for(const sample of samples){assert.ok(/\p{Script=Han}/u.test(sample.name),sample.name);assert.equal(Object.hasOwn(context.geocodes,sample.name),false,sample.name);}
});

for(const sample of samples)test('exact Chinese place recovery: '+sample.id+' '+sample.name,()=>{
 const name=sample.name;
 for(const [text,api]of [
  ['查'+name+'现在的气温','weather.current.temperature'],
  ['明天'+name+'湿度','weather.hourly.humidity'],
  [name+'现在紫外线指数','weather.current.uvIndex'],
  ['现在的气温，城市：'+name,'weather.current.temperature'],
  ['现在湿度，在'+name,'weather.current.humidity'],
  ['气温在'+name+'是多少','weather.current.temperature'],
  ['查“'+name+'”现在的气温','weather.current.temperature'],
  ['看'+name+'现在气温','weather.current.temperature']
 ])assertPlace(text,api,name);
});

test('quoted place evidence is atomic weather input, not an unrelated quoted annotation',()=>{
 const name='圣皮埃尔·德克鲁斯·示例城';
 assertPlace('查“'+name+'”现在湿度，备注“北京的温度”','weather.current.humidity',name);
 assertPlace('查"'+name+'"现在湿度','weather.current.humidity',name);
 const r=plan('看看湿度，备注“'+name+'”','weather.current.humidity');
 assert.equal(r.groundedArguments.location,undefined);assert.equal(r.status,'ready_mock');assert.equal(r.resolved.sources.location,'system_location');
});

test('long and middle-dot Chinese names are preserved without a whitelist or truncation',()=>{
 const name='圣皮埃尔·'+ '未登记的海外中文译名'.repeat(6);
 assert.ok(name.length>60);assertPlace('查'+name+'现在的气温','weather.current.temperature',name);
});

test('user omitted model arguments recover foreign Chinese names before any system current-location substitution',async()=>{
 for(const sample of samples.slice(0,8)){
  for(const text of ['查'+sample.name+'现在的气温','现在的气温，城市：'+sample.name,'查“'+sample.name+'”现在的气温']){
  const requests=[],raw={};
  const r=await runPipeline({text,model:'test',mode:'unified',context},{providers:{ollama:{async invoke(){return {value:{domain:'weather',api:'weather.current.temperature',arguments:raw},trace:{stage:'unified',raw:JSON.stringify(raw)}};}}},systemContextProvider:{async read(request){requests.push(request);throw new Error('geocoding unavailable');}}});
  assert.deepEqual(requests.map(item=>item.capability),['location.geocode'],text);
  assert.equal(requests[0].arguments.address,sample.name,text);
  assert.equal(r.groundedArguments.location,sample.name,text);assert.equal(r.status,'resolution_failed',text);assert.deepEqual(r.extractedArguments,{});
  }
 }
});

test('a different model-guessed or current-device city never replaces the explicit raw Chinese name',()=>{
 const name=samples[0].name,raw={location:'北京',time_ref:'现在'},r=assertPlace('查'+name+'现在的气温','weather.current.temperature',name,raw);
 assert.equal(raw.location,'北京');assert.equal(r.resolved.arguments.location,name);
});
