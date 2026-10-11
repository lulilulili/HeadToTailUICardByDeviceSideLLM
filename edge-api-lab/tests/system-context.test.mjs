import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSystemContext} from '../src/system-context.mjs';
import {getCapability} from '../src/registry.mjs';
import {runPipeline} from '../src/pipeline.mjs';

const context = {now:'2026-10-10T08:00:00+08:00',timezone:'Asia/Shanghai',location:null};
const fakeProvider = value => ({ollama:{async invoke(){return {value,trace:{stage:'unified',raw:JSON.stringify(value)}};}}});

test('native LocationKit accuracy is preserved in metres and coarse positions remain coarse',async()=>{
  const run=await runPipeline({text:'现在湿度是多少',model:'test',mode:'unified',context},{
    providers:fakeProvider({domain:'weather',api:'weather.current.humidity',arguments:{}}),
    systemContextProvider:{async read(){return {value:{latitude:23.1,longitude:113.2,accuracy:5000},source:'harmony'};}}
  });
  assert.equal(run.context.location.accuracyMeters,5000);
  assert.equal(run.resolved.resolution.location.precision,'coarse');
  assert.equal(run.resolved.resolution.location.fallback.applied,true);
});
test('untrusted supplied location and system defaults do not suppress a genuine host read',async()=>{
  let calls=0;
  const prepared=await prepareSystemContext(getCapability('weather.current.humidity'),{}, {...context,location:{latitude:1,longitude:2,source:'model'}},{async read(){calls++;return {value:{latitude:3,longitude:4},source:'harmony'};}});
  assert.equal(calls,1);
  assert.equal(prepared.context.location.latitude,3);
});
test('relative-time parsing obtains both the native clock and timezone without adding API slots',async()=>{
  const requests=[];
  const prepared=await prepareSystemContext(getCapability('weather.current.humidity'),{coordinates:{latitude:1,longitude:2}},{now:null,timezone:null},{async read(request){requests.push(request);return {source:'harmony',value:request.capability==='device.time.current'?Date.parse('2026-10-11T09:00:00+08:00'):'Asia/Shanghai'};}});
  assert.deepEqual(requests.map(request=>request.capability),['device.time.current','device.time.timezone']);
  assert.equal(prepared.context.now,'2026-10-11T01:00:00.000Z');
  assert.equal(prepared.context.timezone,'Asia/Shanghai');
  assert.equal(prepared.context.systemValues,undefined);
});

test('explicit city omitted by the model is recovered before asking for device location', async () => {
  const calls=[];
  const run=await runPipeline({text:'广州现在的湿度',model:'test',mode:'unified',context}, {
    providers:fakeProvider({domain:'weather',api:'weather.current.humidity',arguments:{}}),
    systemContextProvider:{async read(request){calls.push(request);throw new Error('unavailable geocoding');}}
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].capability,'location.geocode');
  assert.equal(calls[0].arguments.address,'广州');
  assert.equal(run.groundedArguments.location,'广州');
  assert.deepEqual(run.extractedArguments,{});
});

test('named-location geocoding uses the native dependency and never reads a current position',async()=>{
  const requests=[];
  const prepared=await prepareSystemContext(getCapability('weather.current.humidity'),{location:'漠河'},context,{async read(request){requests.push(request);return {source:'harmony',value:[{latitude:52.97,longitude:122.54}]};}});
  assert.deepEqual(requests.map(request=>request.capability),['location.geocode']);
  assert.equal(prepared.context.geocodes['漠河'].source,'harmony');
  assert.equal(prepared.context.location,null);
});
test('failed or ambiguous named-location geocoding cannot fall back to current location',async()=>{
  const prepared=await prepareSystemContext(getCapability('weather.current.humidity'),{location:'漠河'},context,{async read(){return {source:'harmony',value:[{latitude:1,longitude:2},{latitude:3,longitude:4}]};}});
  assert.equal(prepared.requests[0].status,'failed');
  assert.equal(prepared.context.location,null);
  assert.equal(prepared.context.geocodes?.['漠河'],undefined);
});

test('genuinely missing location reads the injected native host with provenance', async () => {
  const calls=[];
  const run=await runPipeline({text:'湿度呢',model:'test',mode:'unified',context}, {
    providers:fakeProvider({domain:'weather',api:'weather.current.humidity',arguments:{}}),
    systemContextProvider:{async read(request){calls.push(request.capability);return {value:{latitude:23.1,longitude:113.2,accuracyMeters:20},source:'harmony',method:'geoLocationManager.getCurrentLocation'};}}
  });
  assert.deepEqual(calls,['location.current']);
  assert.equal(run.resolved.sources.location,'system_location');
  assert.equal(run.resolved.arguments.location.source,'harmony');
  assert.equal(run.systemRequests[0].status,'resolved');
  assert.equal(run.mock.executed,false);
});

test('permission failure cannot be replaced by a guessed city', async () => {
  const run=await runPipeline({text:'湿度呢',model:'test',mode:'unified',context}, {
    providers:fakeProvider({domain:'weather',api:'weather.current.humidity',arguments:{}}),
    systemContextProvider:{async read(){throw new Error('定位权限被拒绝');}}
  });
  assert.equal(run.status,'resolution_failed');
  assert.equal(run.resolved.arguments.location,undefined);
  assert.match(run.resolved.issues.join(' '),/定位权限被拒绝/);
});

test('explicit conflicting places block current-location reads', async () => {
  let reads=0;
  const run=await runPipeline({text:'查询广州和杭州现在的湿度',model:'test',mode:'unified',context}, {
    providers:fakeProvider({domain:'weather',api:'weather.current.humidity',arguments:{}}),
    systemContextProvider:{async read(){reads++;throw new Error('should not read');}}
  });
  assert.equal(reads,0);
  assert.equal(run.status,'needs_clarification');
});

test('system default slots require typed authoritative values and do not fabricate business parameters', async () => {
  const cap={inputs:{net_id:{type:'integer',minimum:0,required:true,resolver:'system_default_network'},title:{type:'string',required:true}}};
  const prepared=await prepareSystemContext(cap,{},context,{async read(){return {source:'harmony',value:17};}});
  assert.deepEqual(prepared.context.systemValues.net_id,{source:'harmony',value:17});
  assert.equal(prepared.context.systemValues.title,undefined);
  const rejected=await prepareSystemContext(cap,{},context,{async read(){return {source:'harmony',value:'seventeen'};}});
  assert.equal(rejected.requests[0].status,'failed');
  assert.equal(rejected.context.systemValues,undefined);
});

test('partial explicit coordinates are never completed using another current point', async () => {
  let reads=0;
  const cap={inputs:{coordinates:{type:'object',resolver:'system_coordinates'}}};
  await prepareSystemContext(cap,{coordinates:{latitude:31}},context,{async read(){reads++;}});
  assert.equal(reads,0);
});

test('read-only system output fields never become model input defaults', async () => {
  const cap={inputs:{}};
  const prepared=await prepareSystemContext(cap,{},context,{async read(){throw new Error('output field is not an input');}});
  assert.deepEqual(prepared.requests,[]);
  assert.deepEqual(getCapability('weather.current.humidity').inputs.humidity,undefined);
});
