import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizePlan} from '../src/grounding.mjs';
import {buildParameterProvenance} from '../src/parameter-provenance.mjs';
import {getCapability} from '../src/registry.mjs';
import {runPipeline} from '../src/pipeline.mjs';
import {prepareSystemContext} from '../src/system-context.mjs';
import {buildUnifiedPrompt,buildArgumentsPrompt} from '../src/prompts.mjs';
import {renderParameterProvenance} from '../public/provenance-view.mjs';
import {renderRun} from '../public/run-view.mjs';
import {experimentDefaults} from '../src/fixtures.mjs';

const context={...experimentDefaults,now:'2026-10-10T08:00:00+08:00',timezone:'Asia/Shanghai',location:{latitude:31.2,longitude:121.5,source:'fixture'}};
const plan=(text,api,args={},ctx=context)=>finalizePlan({text,api,domain:getCapability(api).domain,extractedArguments:args,context:ctx});
const fakeProvider=value=>({ollama:{async invoke(){return {value,trace:{stage:'unified',raw:JSON.stringify(value)}};}}});
const record=(run,field)=>run.resolved.provenance.p[field];

test('an omitted obscure city is U with exact original span, never S or guessed coordinates',()=>{
  const text='漠河现在的湿度',run=plan(text,'weather.current.humidity');
  assert.equal(run.groundedArguments.location,'漠河');
  assert.equal(run.status,'resolution_failed');
  assert.equal(record(run,'location').s,'U');
  assert.equal(record(run,'location').q,'f');
  assert.deepEqual(record(run,'location').e,[{b:0,e:2,t:'漠河'}]);
  assert.notEqual(run.resolved.arguments.location,context.location);
});

test('explicit relative time stays U and system clock/timezone are separate dependencies',()=>{
  const run=plan('上海明天天气','weather.query');
  assert.equal(record(run,'location').s,'U');
  assert.equal(record(run,'time_ref').s,'U');
  assert.deepEqual(record(run,'time_ref').d.map(item=>[item.s,item.k]),[['S','now'],['S','timezone']]);
  assert.equal(record(run,'time_ref').e[0].t,'明天');
  assert.equal(record(run,'location').d[0].o,'fixture');
  assert.equal(record(run,'strict_time').s,'D');
});

test('genuinely absent current location is S fixture while implicit now is D plus S',()=>{
  const run=plan('湿度呢','weather.current.humidity');
  assert.deepEqual(record(run,'location'),{s:'S',o:'fixture'});
  assert.equal(record(run,'time_ref').s,'D');
  assert.equal(record(run,'time_ref').d[0].s,'S');
  assert.equal(record(run,'time_ref').e,undefined);
  assert.equal(record(run,'location').t,undefined);
});

test('blocked explicit targets do not receive cached system defaults',()=>{
  const run=plan('我在甲乙丙城出差，湿度是多少','weather.current.humidity');
  assert.equal(run.status,'needs_clarification');
  assert.equal(run.resolved.arguments.location,undefined);
  assert.deepEqual(record(run,'location'),{s:'X',e:[{b:0,e:2,t:'我在'}],q:'b',o:'unresolved'});
  assert.equal(run.mock.simulated,false);
  const conflict=plan('查询广州和杭州现在的湿度','weather.current.humidity');
  assert.equal(conflict.resolved.arguments.location,undefined);
  assert.equal(record(conflict,'location').q,'b');
});

test('selected read targets are C and MIME derivation is R with a target dependency',()=>{
  const run=plan('预览这份文件','files.preview',{}, {...context,objects:{file_id:{trusted:true,source:'user_selection',value:'file://media/Report.pdf'}}});
  assert.equal(run.status,'ready_mock');
  assert.equal(record(run,'file_id').s,'C');
  assert.equal(record(run,'mime_type').s,'R');
  assert.deepEqual(record(run,'mime_type').d,[{s:'C',k:'file_id'}]);
  assert.equal(run.grounding.identity[0].existenceVerified,false);
});

test('nested explicit changes preserve evidence for both object and leaves',()=>{
  const text='修改日程 event_id=ev_123，参数={"changes":{"title":"<复盘>","description":"逐字正文"}}';
  const run=plan(text,'calendar.update');
  assert.equal(record(run,'changes.title').s,'U');
  assert.equal(record(run,'changes.description').s,'U');
  for(const span of record(run,'changes.title').e) assert.equal(text.slice(span.b,span.e),span.t);
});

test('explicit coordinates are U; derived weather location does not pretend to be separately stated',()=>{
  const run=plan('纬度31.2304，经度121.4737，现在湿度','weather.current.humidity');
  assert.equal(record(run,'coordinates').s,'U');
  assert.equal(record(run,'coordinates.latitude').s,'U');
  assert.equal(record(run,'location').s,'R');
  assert.deepEqual(record(run,'location').d,[{s:'U',k:'coordinates'}]);
});

test('absent required business inputs are X/m, and zero-input battery queries have no pseudo parameters',()=>{
  const create=plan('创建联系人','contacts.create');
  assert.equal(create.status,'needs_clarification');
  assert.equal(record(create,'name').s,'X');
  assert.equal(record(create,'name').q,'m');
  const battery=plan('手机剩余电量','device.battery.level');
  assert.deepEqual(battery.resolved.provenance,{v:1,p:{}});
});

test('a legacy resolver user label or a string appearing in the text is not audited U evidence',()=>{
  const ledger=buildParameterProvenance({capability:{inputs:{query:{type:'string'}}},text:'不要查甲',groundedArguments:{query:'甲'},resolved:{arguments:{query:'甲'},sources:{query:'user'}}});
  assert.deepEqual(ledger.p.query,{s:'X',q:'?'});
});

test('native reads retain declared sampling/expiry timestamps and do not add model fields',async()=>{
  const observedAt='2026-10-12T00:00:00Z',expiresAt='2026-10-12T00:05:00Z';
  const run=await runPipeline({text:'当前网络能力',model:'test',mode:'unified',context},{providers:fakeProvider({domain:'connectivity',api:'connectivity.network.capabilities',arguments:{}}),systemContextProvider:{async read(){return {source:'harmony',value:42,observedAt,expiresAt};}}});
  assert.equal(run.status,'ready_mock');
  assert.deepEqual(run.extractedArguments,{});
  assert.deepEqual(record(run,'net_id'),{s:'S',o:'harmony',t:observedAt,x:expiresAt});
});

test('clock dependencies identify actual native read origin, instead of relabeling it as user',async()=>{
  const run=await runPipeline({text:'上海明天天气',model:'test',mode:'unified',context:{...context,now:null,timezone:null}},{providers:fakeProvider({domain:'weather',api:'weather.query',arguments:{}}),systemContextProvider:{async read(request){return {source:'harmony',value:request.capability==='device.time.current'?'2026-10-12T00:00:00Z':'Asia/Shanghai'};}}});
  assert.equal(record(run,'time_ref').s,'U');
  assert.ok(record(run,'time_ref').d.every(item=>item.o==='harmony'));
});

test('invalid optional native audit times fail before installing a system value',async()=>{
  const prepared=await prepareSystemContext(getCapability('connectivity.network.capabilities'),{},context,{async read(){return {source:'harmony',value:42,observedAt:'not-a-time'};}});
  assert.equal(prepared.requests[0].status,'failed');
  assert.equal(prepared.context.systemValues?.net_id,undefined);
});

test('provenance rendering escapes evidence and origins, and does not invent provenance for history',()=>{
  const html=renderParameterProvenance({v:1,p:{title:{s:'U',e:[{b:0,e:9,t:'<script>x</script>'}]},location:{s:'S',o:'<img onerror="bad">'}}});
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img onerror'));
  assert.match(renderParameterProvenance(undefined),/未保存逐参数来源/);
  const run=plan('当前音乐音量多少','media.volume.level');
  assert.match(renderRun({...run,text:'当前音乐音量多少',traces:[]}),/逐参数来源/);
  assert.match(renderParameterProvenance({v:1,p:{}}),/查询值属于输出/);
});

test('the source ledger never expands either unified or per-API extraction prompts/schemas',()=>{
  const unified=buildUnifiedPrompt('上海明天天气',context),argumentsPrompt=buildArgumentsPrompt('上海明天天气',getCapability('weather.query'));
  for(const prompt of [unified,argumentsPrompt]) {
    assert.ok(!JSON.stringify(prompt.schema).includes('provenance'));
    assert.ok(!prompt.messages.some(message=>message.content.includes('PARAMETER_SOURCE_TAGS')||message.content.includes('U 原文')));
    assert.equal(prompt.promptMeta.version,'explicit-v7');
  }
  assert.ok(unified.schema.oneOf.every(branch=>Object.keys(branch.properties).join(',')==='domain,api,arguments'));
});

test('object evidence cannot invent U provenance for a missing required child',()=>{
  const text='{"coordinates":{"latitude":31}}',value={latitude:31};
  const ledger=buildParameterProvenance({capability:{inputs:{coordinates:{type:'object',properties:{latitude:{type:'number',required:true},longitude:{type:'number',required:true}}}}},text,groundedArguments:{coordinates:value},grounding:{checks:[{field:'coordinates',code:'explicit_contract_invalid',effectiveValue:value,span:{start:0,end:text.length,text}}]},resolved:{arguments:{coordinates:value},sources:{coordinates:'user'},missing:['coordinates.longitude']}});
  assert.equal(ledger.p['coordinates.latitude'].s,'U');
  assert.deepEqual(ledger.p['coordinates.longitude'],{s:'X',q:'m'});
});
