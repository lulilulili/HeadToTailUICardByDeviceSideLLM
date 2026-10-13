import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {createApplication} from '../src/application.mjs';
import {RuntimeStore} from '../src/runtime.mjs';

async function setup(configured=false){
 const directory=await mkdtemp(join(tmpdir(),'edge-adaptive-http-'));
 const store=await new RuntimeStore(join(directory,'runtime')).init(),inputs=[];
 const providers={jev:{getStatus:()=>({configured,official:true,cloud:true,model:'jev-latest',baseURL:'https://api.typesafe.ai',sdkVersion:'0.6.0'})}};
 const fetchImpl=async url=>({ok:true,json:async()=>url.endsWith('/api/tags')?{models:[{name:'qwen2.5:0.5b',details:{parameter_size:'0.5B'}}]}:{version:'test'}});
 const runPipeline=async input=>{inputs.push(input);return {domain:'device',api:'device.battery.level',status:'ready_mock',traces:[],totalMs:0};};
 const server=createServer(createApplication({store,runPipeline,providers,fetchImpl,catalog:{version:'test'},docs:[],cases:[{id:'c1',text:'电量',expected:{domain:'device',api:'device.battery.level',arguments:{}}}],baseContext:{}}));
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const url=`http://127.0.0.1:${server.address().port}`;
 return {url,inputs,close:async()=>{await new Promise(done=>server.close(done));await store.queue.run(async()=>{});assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith('edge-adaptive-http-'));await rm(directory,{recursive:true,force:true});}};
}
const post=(url,value)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
const request={text:'电量多少',model:'qwen2.5:0.5b'};

test('HTTP default is adaptive and explicit legacy modes remain available',async()=>{
 const app=await setup();try{
  for(const mode of [undefined,'adaptive','staged','unified']){
   const response=await post(`${app.url}/api/runs`,{...request,...(mode?{mode}:{})});assert.equal(response.status,200);await response.json();
   assert.equal(app.inputs.at(-1).mode,mode??'adaptive');
  }
 }finally{await app.close();}
});
test('health exposes official configuration without depending on a bridge URL',async()=>{
 const app=await setup();try{const status=await(await fetch(`${app.url}/api/health`)).json();assert.deepEqual(status.jev,{configured:false,official:true,cloud:true,model:'jev-latest',baseURL:'https://api.typesafe.ai',sdkVersion:'0.6.0'});}finally{await app.close();}
});
test('unconfigured official Jev is rejected before any local pipeline call',async()=>{
 const app=await setup();try{
  for(const input of [{...request,mode:'jev'},{...request,mode:'adaptive',stages:{domain:{provider:'jev'}}}]){
   const response=await post(`${app.url}/api/runs`,input);assert.equal(response.status,503);assert.match((await response.json()).error,/TYPESAFE_API_KEY/);
  }
  assert.equal(app.inputs.length,0);
 }finally{await app.close();}
});
test('configured Jev profile and decision overrides are accepted; free-form overrides are rejected',async()=>{
 const app=await setup(true);try{
  for(const input of [{...request,mode:'jev'},{...request,mode:'jev',stages:{domain:{model:'jev-latest'},intent:{model:'jev-latest'}}},{...request,mode:'adaptive',stages:{intent:{provider:'jev',model:'jev-latest'}}}]){
   const response=await post(`${app.url}/api/runs`,input);assert.equal(response.status,200);await response.json();
  }
  const accepted=app.inputs.length;
  for(const stages of [{arguments:{provider:'jev'}},{unified:{provider:'jev'}},{intent_arguments:{provider:'jev'}},{typo:{provider:'ollama'}},{domain:{provider:'other'}},{domain:null}]){
   const response=await post(`${app.url}/api/runs`,{...request,stages});assert.equal(response.status,400,JSON.stringify(stages));
  }
  for(const stages of [{domain:{provider:'ollama'}},{intent:{provider:'ollama'}},{arguments:{provider:'jev-bridge'}},{unified:{provider:'ollama'}},{intent_arguments:{provider:'ollama'}}]){
   assert.equal((await post(`${app.url}/api/runs`,{...request,mode:'jev',stages})).status,400);
  }
  assert.equal(app.inputs.length,accepted);
 }finally{await app.close();}
});
test('explicit empty modes, null providers and non-string stage models fail before inference',async()=>{
 const app=await setup(true);try{
  const inputs=[...['',false,null,2].map(mode=>({...request,mode})),
   {...request,stages:{domain:{provider:null}}},
   ...['',false,null,2,{}].map(model=>({...request,mode:'jev',stages:{domain:{model}}}))];
  for(const input of inputs)assert.equal((await post(`${app.url}/api/runs`,input)).status,400,JSON.stringify(input));
  assert.equal(app.inputs.length,0);
 }finally{await app.close();}
});
