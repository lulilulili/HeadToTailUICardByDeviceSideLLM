import test from 'node:test';
import assert from 'node:assert/strict';
import {createEvaluation} from '../public/evaluation-view.mjs';

test('Jev evaluation blocks missing backend key, then posts an independent profile only after readiness',async()=>{
  const previousDocument=globalThis.document,previousFetch=globalThis.fetch,elements=new Map(),requests=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{innerHTML:'',disabled:false,textContent:'',value:'',checked:false,listeners:{},addEventListener(type,handler){this.listeners[type]=handler;},querySelector:element,querySelectorAll:()=>[]});
    return elements.get(id);
  };
  const checkedModels=[{value:'qwen2.5:3b'}],checkedCases=[{value:'test-1'}];
  const box={innerHTML:'',querySelector:element,querySelectorAll:selector=>selector==='[name="eval-model"]:checked'?checkedModels:selector==='[name="eval-case"]:checked'?checkedCases:[]};
  let jev={official:true,configured:false};
  Object.assign(element('#eval-mode'),{value:'jev'});Object.assign(element('#eval-limit'),{value:'1'});Object.assign(element('#eval-repeats'),{value:'1'});
  globalThis.document={querySelector:()=>box};
  globalThis.fetch=async(path,options={})=>{
    requests.push({path,...options});
    const result=path==='/api/cases'?{cases:[{id:'test-1',suite:'single-service-100-v1',text:'查询电量'}],context:{}}:path==='/api/evaluations?view=summary'?{evaluations:[]}:options.method==='POST'?{id:'new-jev-job'}:{id:'new-jev-job',mode:'jev',status:'completed',progress:{done:0,total:1},results:[],summary:[]};
    return new Response(JSON.stringify(result));
  };
  const controller=createEvaluation({getModels:()=>[{name:'qwen2.5:3b',eligible:true}],getOptions:()=>({num_ctx:2048}),getJevStatus:()=>jev,showRun(){},toast(){}});
  try{
    await controller.load();
    assert.equal(element('#eval-submit').disabled,true);assert.match(element('#eval-jev-status').innerHTML,/TYPESAFE_API_KEY/);
    await element('#evaluation-form').listeners.submit({preventDefault(){}});
    assert.equal(requests.filter(item=>item.method==='POST').length,0);
    assert.match(element('#eval-submit-notice').innerHTML,/官方 Jev 尚未就绪/);
    jev={official:true,configured:true};controller.updateExclusiveBenchmark();
    assert.equal(element('#eval-submit').disabled,false);
    await element('#evaluation-form').listeners.submit({preventDefault(){}});
    const writes=requests.filter(item=>item.method==='POST');assert.equal(writes.length,1);
    assert.equal(writes[0].path,'/api/evaluations');assert.deepEqual(JSON.parse(writes[0].body),{models:['qwen2.5:3b'],mode:'jev',caseIds:['test-1'],limit:1,repeats:1,warmup:false,options:{num_ctx:2048}});
    assert.match(element('#job-content').innerHTML,/Jev \+ Qwen/);
    assert.doesNotMatch(writes[0].body,/TYPESAFE_API_KEY|apiKey|secret/);
  }finally{controller.setSuspended(true);globalThis.document=previousDocument;globalThis.fetch=previousFetch;}
});
