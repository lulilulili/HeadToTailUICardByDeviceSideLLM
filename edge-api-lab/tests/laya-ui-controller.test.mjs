import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createEvaluation} from '../public/evaluation-view.mjs';

test('Laya evaluation requires observed readiness, preserves local Qwen and posts a separate Laya job',async()=>{
  const previousDocument=globalThis.document,previousFetch=globalThis.fetch,elements=new Map(),requests=[];
  const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',disabled:false,textContent:'',value:'',checked:false,listeners:{},addEventListener(type,handler){this.listeners[type]=handler;},querySelector:element,querySelectorAll:()=>[]});return elements.get(id);};
  const box={innerHTML:'',querySelector:element,querySelectorAll:selector=>selector==='[name="eval-model"]:checked'?[{value:'qwen2.5:3b'}]:selector==='[name="eval-case"]:checked'?[{value:'laya-case'}]:[]};
  let laya={local:true,cloud:false,configured:true,ready:false};element('#eval-mode').value='laya';element('#eval-limit').value='1';element('#eval-repeats').value='1';
  globalThis.document={querySelector:()=>box};globalThis.fetch=async(path,options={})=>{
    requests.push({path,...options});const result=path==='/api/cases'?{cases:[{id:'laya-case',suite:'single-service-100-v1',text:'查询电量'}],context:{}}:path==='/api/evaluations?view=summary'?{evaluations:[]}:options.method==='POST'?{id:'laya-new'}:{id:'laya-new',mode:'laya',status:'completed',progress:{done:0,total:1},results:[],summary:[]};return new Response(JSON.stringify(result));
  };
  const controller=createEvaluation({getModels:()=>[{name:'qwen2.5:3b',eligible:true}],getOptions:()=>({}),getLayaStatus:()=>laya,getJevStatus:()=>({official:true,configured:false}),showRun(){},toast(){}});
  try{
    await controller.load();assert.equal(element('#eval-submit').disabled,true);
    await element('#evaluation-form').listeners.submit({preventDefault(){}});assert.equal(requests.filter(r=>r.method==='POST').length,0);
    assert.match(element('#eval-submit-notice').innerHTML,/Laya.*尚未就绪/);
    laya={...laya,ready:true,ok:true};controller.updateExclusiveBenchmark();assert.equal(element('#eval-submit').disabled,false);
    assert.match(element('#eval-jev-status').innerHTML,/Laya 本机/);assert.doesNotMatch(element('#eval-jev-status').innerHTML,/TYPESAFE_API_KEY|官方云端/);
    await element('#evaluation-form').listeners.submit({preventDefault(){}});const writes=requests.filter(r=>r.method==='POST');assert.equal(writes.length,1);
    assert.equal(JSON.parse(writes[0].body).mode,'laya');assert.deepEqual(JSON.parse(writes[0].body).models,['qwen2.5:3b']);assert.match(element('#job-content').innerHTML,/Laya 本机选择/);
  }finally{controller.setSuspended(true);globalThis.document=previousDocument;globalThis.fetch=previousFetch;}
});

test('single-run wiring requires Laya status only when selected and keeps backend endpoint out of request fields',async()=>{
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(source,/getLayaStatus:\(\)=>health\.laya/);assert.match(source,/inferenceRequiresLaya/);assert.match(source,/layaCanRun\(health\.laya\)/);
  assert.match(source,/renderDecisionProviderStatus/);assert.match(source,/Laya 尚未就绪/);
  assert.doesNotMatch(source,/LAYA_URL.*request|TYPESAFE_API_KEY.*request/);
});
