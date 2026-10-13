import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {createApplication} from '../src/application.mjs';
import {RuntimeStore} from '../src/runtime.mjs';
async function setup(ready=false){
 const directory=await mkdtemp(join(tmpdir(),'edge-laya-http-')),store=await new RuntimeStore(join(directory,'runtime')).init(),inputs=[];
 const status={provider:'laya',configured:true,ready,ok:ready,local:true,cloud:false,model:'multilingual',url:'http://127.0.0.1:8765/v1/systemone'};
 const providers={laya:{defaultModel:'multilingual',getStatus:async()=>status}};
 const fetchImpl=async url=>({ok:true,json:async()=>url.endsWith('/api/tags')?{models:[{name:'qwen2.5:1.5b',details:{parameter_size:'1.5B'}}]}:{version:'test'}});
 const runPipeline=async input=>{inputs.push(input);return {domain:'device',api:'device.battery.level',status:'ready_mock',traces:[],totalMs:0};};
 const server=createServer(createApplication({store,runPipeline,providers,fetchImpl,catalog:{version:'test'},docs:[],cases:[],baseContext:{}}));
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 return {url:`http://127.0.0.1:${server.address().port}`,inputs,status,close:async()=>{await new Promise(done=>server.close(done));await store.queue.run(async()=>{});assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith('edge-laya-http-'));await rm(directory,{recursive:true,force:true});}};
}
const post=(url,input)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'查电量',model:'qwen2.5:1.5b',...input})});
test('health publishes independent awaited local Laya status without a TypeSafe key',async()=>{
 const app=await setup(true);try{const status=await(await fetch(`${app.url}/api/health`)).json();assert.deepEqual(status.laya,app.status);assert.equal(status.jev.configured,false);}finally{await app.close();}
});
test('Laya profile and domain/API overrides require the local model to be ready',async()=>{
 const app=await setup();try{for(const input of [{mode:'laya'},{mode:'adaptive',stages:{domain:{provider:'laya'}}},{mode:'adaptive',stages:{intent:{provider:'laya'}}}]){const response=await post(`${app.url}/api/runs`,input);assert.equal(response.status,503);assert.match((await response.json()).error,/Laya/);}assert.equal(app.inputs.length,0);}finally{await app.close();}
});
test('ready Laya selects decisions while preserving local Qwen model validation and illegal override guards',async()=>{
 const app=await setup(true);try{
  for(const input of [{mode:'laya'},{mode:'laya',stages:{domain:{model:'multilingual'}}},{mode:'adaptive',stages:{intent:{provider:'laya'}}}]){const response=await post(`${app.url}/api/runs`,input);assert.equal(response.status,200);await response.json();}
  const accepted=app.inputs.length;
  for(const input of [{mode:'laya',stages:{domain:{provider:'ollama'}}},{mode:'laya',stages:{intent:{provider:'jev'}}},{mode:'laya',stages:{arguments:{provider:'laya'}}},{mode:'adaptive',stages:{intent_arguments:{provider:'laya'}}},{mode:'unified',stages:{unified:{provider:'laya'}}},{mode:'laya',model:'missing'}])assert.equal((await post(`${app.url}/api/runs`,input)).status,400);
  assert.equal(app.inputs.length,accepted);
 }finally{await app.close();}
});
