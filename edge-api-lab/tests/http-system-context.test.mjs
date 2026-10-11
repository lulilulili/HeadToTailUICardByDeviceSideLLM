import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createApplication} from '../src/application.mjs';
import {runPipeline} from '../src/pipeline.mjs';

const request={text:'我现在用的是WiFi还是流量',model:'qwen2.5:3b',mode:'unified'};
const networkResult={domain:'connectivity',api:'connectivity.network.bearer_types',arguments:{}};
async function setup({pipeline,systemContextProvider,modelValue=networkResult,runRequest=request,contextDefaults={}}={}){
 const inputs=[];
 const store={directory:process.cwd(),runs:[],evaluations:[],async save(kind,value){this[kind==='run'?'runs':'evaluations'].push(value);}};
 const providers={ollama:{async invoke(){return {value:modelValue,trace:{stage:'unified',raw:JSON.stringify(modelValue)}};}}};
 const app=createApplication({
  store,systemContextProvider,providers,contextDefaults,catalog:{version:'http-context-test'},docs:[],
  cases:[{id:'network',...runRequest,expected:{...modelValue,status:'ready_mock'}}],
  baseContext:{now:'2026-10-10T08:00:00+08:00',timezone:'Asia/Shanghai'},
  runPipeline:async(input,dependencies)=>{inputs.push(input);return pipeline?pipeline(input,dependencies):{status:'ready_mock',context:input.context,traces:[]};},
  fetchImpl:async url=>({ok:true,json:async()=>url.endsWith('/api/tags')?{models:[{name:request.model,details:{parameter_size:'3.1B'}}]}:{version:'test'}})
 });
 const server=createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}`;
 return {inputs,store,post:async(context,path='/api/runs')=>fetch(`${url}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(path==='/api/runs'?{...runRequest,context}:{models:[request.model],limit:1,context})}),close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

test('HTTP system values cannot claim native or model provenance before inference',async()=>{
 const app=await setup();try{
  for(const source of ['harmony','model','browser',undefined]){
   const response=await app.post({systemValues:{net_id:{value:23,source}}});
   assert.equal(response.status,400,`source ${source} must not enter the pipeline`);
   assert.match((await response.json()).error,/fixture|内部系统桥/);
  }
  const unknown=await app.post({systemValues:{battery_level:{value:88,source:'fixture'}}});
  assert.equal(unknown.status,400);
  const evaluation=await app.post({systemValues:{net_id:{value:23,source:'harmony'}}},'/api/evaluations');
  assert.equal(evaluation.status,400);
  assert.equal(app.inputs.length,0);assert.equal(app.store.runs.length,0);assert.equal(app.store.evaluations.length,0);
 }finally{await app.close();}
});

test('HTTP system fixtures must match the catalog integer and audio enum types',async()=>{
 const app=await setup();try{
  for(const systemValues of [null,[],{net_id:null},{net_id:[]},{net_id:{source:'fixture'}},
   ...['23',0,-1,1.5].map(value=>({net_id:{value,source:'fixture'}})),
   ...['VOICE_CALL','unknown',1].map(value=>({stream_type:{value,source:'fixture'}}))]){
   const response=await app.post({systemValues});assert.equal(response.status,400,JSON.stringify(systemValues));await response.json();
  }
  assert.equal(app.inputs.length,0);
 }finally{await app.close();}
});

test('HTTP accepts typed fixtures and only simulated phone fixture locations',async()=>{
 const app=await setup();try{
  const context={location:{latitude:23.1,longitude:113.2,accuracyMeters:20,source:'fixture'},systemValues:{net_id:{value:23,source:'fixture'},stream_type:{value:'ALARM',source:'fixture'}}};
  const response=await app.post(context);assert.equal(response.status,200);await response.json();
  assert.deepEqual(app.inputs.at(-1).context.location,context.location);
  assert.deepEqual(app.inputs.at(-1).context.systemValues,context.systemValues);
  for(const source of ['browser','harmony','model',undefined]){
   const forged=await app.post({location:{latitude:23.1,longitude:113.2,source}});
   assert.equal(forged.status,400);assert.match((await forged.json()).error,/模拟手机位置 fixture|内部手机系统桥/);
  }
  const evaluation=await app.post({location:{latitude:23.1,longitude:113.2,source:'browser'}},'/api/evaluations');
  assert.equal(evaluation.status,400);await evaluation.json();
  assert.equal(app.inputs.length,1);assert.equal(app.store.evaluations.length,0);
 }finally{await app.close();}
});

test('an explicit absent phone position cannot silently pick the interactive fixture default',async()=>{
 const app=await setup({contextDefaults:{location:{latitude:31.2304,longitude:121.4737,source:'fixture'}}});
 try{
  const response=await app.post({location:null,locationError:'该位置模式不可用，不读取电脑位置'});
  assert.equal(response.status,200);await response.json();
  assert.equal(app.inputs[0].context.location,null);
  assert.match(app.inputs[0].context.locationError,/不读取电脑位置/);
 }finally{await app.close();}
});

test('an internal system provider can still return typed harmony values over an HTTP run',async()=>{
 const reads=[];
 const app=await setup({pipeline:runPipeline,systemContextProvider:{async read(request){reads.push(request);return {value:37,source:'harmony',method:'connection.getDefaultNet'};}}});
 try{
  const response=await app.post({});assert.equal(response.status,200);const run=await response.json();
  assert.equal(run.status,'ready_mock');assert.equal(reads.length,1);
  assert.equal(reads[0].capability,'system.default_network');assert.equal(reads[0].field,'net_id');
  assert.deepEqual(run.context.systemValues.net_id,{value:37,source:'harmony'});
  assert.equal(run.resolved.arguments.net_id,37);assert.equal(run.resolved.sources.net_id,'system_capability');
  assert.equal(run.systemRequests[0].source,'harmony');assert.equal(run.mock.executed,false);
 }finally{await app.close();}
});

test('a validated HTTP fixture stays visibly simulated and avoids a redundant host read',async()=>{
 let reads=0;
 const app=await setup({pipeline:runPipeline,systemContextProvider:{async read(){reads++;throw new Error('fixture is already available');}}});
 try{
  const response=await app.post({systemValues:{net_id:{value:23,source:'fixture'}}});assert.equal(response.status,200);const run=await response.json();
  assert.equal(run.status,'ready_mock');assert.equal(reads,0);assert.equal(run.resolved.arguments.net_id,23);
  assert.equal(run.context.systemValues.net_id.source,'fixture');
  assert.equal(run.resolved.resolution.context.find(entry=>entry.field==='net_id').source,'fixture');
  assert.deepEqual(run.systemRequests,[]);assert.equal(run.mock.executed,false);
 }finally{await app.close();}
});

test('PC clock defaults are only installed without a native system provider',async()=>{
 const pc=await setup();try{
  const before=Date.now(),response=await pc.post({});assert.equal(response.status,200);await response.json();
  assert.ok(Date.parse(pc.inputs[0].context.now)>=before&&Date.parse(pc.inputs[0].context.now)<=Date.now());
  assert.equal(pc.inputs[0].context.timezone,Intl.DateTimeFormat().resolvedOptions().timeZone);
 }finally{await pc.close();}
 const native=await setup({systemContextProvider:{async read(){throw new Error('stub pipeline must not read');}},contextDefaults:{now:'2000-01-01T00:00:00Z',timezone:'UTC'}});
 try{
  const response=await native.post({});assert.equal(response.status,200);await response.json();
  assert.equal(native.inputs[0].context.now,null);assert.equal(native.inputs[0].context.timezone,null);
 }finally{await native.close();}
});

test('HTTP weather uses internal Harmony device clock and timezone rather than the PC clock',async()=>{
 const reads=[],deviceNow=Date.parse('2024-01-02T12:00:00+09:00');
 const app=await setup({pipeline:runPipeline,modelValue:{domain:'weather',api:'weather.current.humidity',arguments:{}},runRequest:{...request,text:'现在湿度是多少'},systemContextProvider:{async read(request){
  reads.push(request);
  if(request.capability==='device.time.current')return {source:'harmony',value:deviceNow,method:'systemDateTime.getTime'};
  if(request.capability==='device.time.timezone')return {source:'harmony',value:'Asia/Tokyo',method:'systemDateTime.getTimezoneSync'};
  if(request.capability==='location.current')return {source:'harmony',value:{latitude:23.1,longitude:113.2,accuracy:20},method:'geoLocationManager.getCurrentLocation'};
  throw new Error(`unexpected dependency: ${request.capability}`);
 }}});
 try{
  const response=await app.post({});assert.equal(response.status,200);const run=await response.json();
  assert.equal(app.inputs[0].context.now,null);assert.equal(app.inputs[0].context.timezone,null);
  assert.equal(run.status,'ready_mock');assert.equal(run.context.now,new Date(deviceNow).toISOString());assert.equal(run.context.timezone,'Asia/Tokyo');
  assert.equal(run.resolved.arguments.time_ref.at,'2024-01-02T12:00:00+09:00');
  assert.equal(run.resolved.arguments.time_ref.timezone,'Asia/Tokyo');assert.equal(run.resolved.arguments.timezone,undefined);
  assert.deepEqual(new Set(reads.map(item=>item.capability)),new Set(['location.current','device.time.current','device.time.timezone']));
  assert.ok(run.systemRequests.filter(item=>item.capability.startsWith('device.time.')).every(item=>item.source==='harmony'&&item.status==='resolved'));
  assert.equal(run.mock.executed,false);
 }finally{await app.close();}
});

test('explicit HTTP clock experiment context takes precedence over the internal native host',async()=>{
 let reads=0;
 const app=await setup({pipeline:runPipeline,modelValue:{domain:'weather',api:'weather.current.humidity',arguments:{}},runRequest:{...request,text:'现在湿度是多少'},systemContextProvider:{async read(){reads++;throw new Error('explicit experiment already supplies context');}}});
 try{
  const context={now:'2031-04-05T08:09:10Z',timezone:'Asia/Shanghai',location:{latitude:23.1,longitude:113.2,accuracyMeters:20,source:'fixture'}};
  const response=await app.post(context);assert.equal(response.status,200);const run=await response.json();
  assert.equal(run.status,'ready_mock');assert.equal(reads,0);assert.equal(run.context.now,context.now);assert.equal(run.context.timezone,context.timezone);
  assert.equal(run.resolved.arguments.time_ref.at,'2031-04-05T16:09:10+08:00');assert.deepEqual(run.systemRequests,[]);
 }finally{await app.close();}
});
