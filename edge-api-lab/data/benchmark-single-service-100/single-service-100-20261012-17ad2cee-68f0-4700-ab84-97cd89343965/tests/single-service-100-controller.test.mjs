import test from 'node:test';
import assert from 'node:assert/strict';
import {createSingleService100View} from '../public/single-service-100-view.mjs';

const row=(text,caseId='e100-cloud-011')=>({text,caseId,model:'qwen2.5:7b',testDomain:'cloud',primary:'parameters',detailPath:`/api/single-service-100-run/qwen2.5-7b/${caseId}`});
const report=(id,text)=>({id,status:'completed',progress:{done:1,total:4000},conditions:{models:['qwen2.5:1.5b','qwen2.5:3b','qwen2.5:0.5b','qwen2.5:7b'],totalCalls:4000},corpus:{total:1000,perDomain:100},summary:[],cells:[],examples:[row(text)]});
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

// Minimal DOM surface for the controller. Assertions exercise real rendered
// results and request/response state transitions, without invoking a provider.
async function withView(fetchImpl,action){
  const previousDocument=globalThis.document,previousFetch=globalThis.fetch;
  const elements=new Map(),calls=[],toasts=[],shown=[];
  const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',disabled:false,listeners:new Map(),addEventListener(type,callback){this.listeners.set(type,callback);}});return elements.get(id);};
  const box={innerHTML:'',querySelector:element};
  globalThis.document={querySelector:()=>box};globalThis.fetch=async(path,options)=>{calls.push(String(path));return fetchImpl(String(path),options);};
  const view=createSingleService100View({showRun:(...args)=>shown.push(args),toast:text=>toasts.push(text)});
  const clickDetail=()=>{const button={disabled:false,dataset:{single100Detail:'0'}};return element('#single100-results').listeners.get('click')({target:{closest:selector=>selector==='[data-single100-detail]'?button:null}});};
  try{await action({view,element,calls,toasts,shown,clickDetail});}
  finally{view.setActive(false);globalThis.document=previousDocument;globalThis.fetch=previousFetch;}
}

test('switching report identity clears loaded rows and resets pagination to new batch examples',async()=>{
  let current=report('batch-a','旧批次默认样例');
  await withView(path=>Promise.resolve(response(path.startsWith('/api/single-service-100-results')?{manifestId:'batch-a',rows:Array.from({length:45},(_,i)=>row('旧完整列表 '+i,`e100-cloud-${String(i+1).padStart(3,'0')}`))}:current)),async({view,element,calls})=>{
    await view.load();await element('#single100-index').listeners.get('click')();
    const next={disabled:false,dataset:{single100Page:'next'}};await element('#single100-results').listeners.get('click')({target:{closest:selector=>selector==='[data-single100-page]'?next:null}});
    assert.match(element('#single100-results').innerHTML,/2 \/ 3/);assert.match(element('#single100-results').innerHTML,/旧完整列表/);
    current=report('batch-b','新批次默认样例');await view.load();
    assert.match(element('#single100-results').innerHTML,/新批次默认样例/);assert.doesNotMatch(element('#single100-results').innerHTML,/旧完整列表/);assert.match(element('#single100-results').innerHTML,/1 \/ 1/);
    assert.equal(element('#single100-index-export').disabled,true);
    assert.equal(new URL(calls.find(path=>path.startsWith('/api/single-service-100-results')),'http://127.0.0.1').searchParams.get('manifestId'),'batch-a');
  });
});

test('a delayed index from the old batch cannot replace new batch data',async()=>{
  let current=report('batch-a','旧批次默认样例');const old=deferred();
  await withView(path=>path.startsWith('/api/single-service-100-results')?old.promise:Promise.resolve(response(current)),async({view,element})=>{
    await view.load();const pending=element('#single100-index').listeners.get('click')();
    current=report('batch-b','新批次默认样例');await view.load();
    old.resolve(response({manifestId:'batch-a',rows:[row('不应进入新批次的旧列表')]}));await pending;
    assert.match(element('#single100-results').innerHTML,/新批次默认样例/);assert.doesNotMatch(element('#single100-results').innerHTML,/不应进入新批次/);
    assert.equal(element('#single100-index-export').disabled,true);
  });
});

test('detail requests bind the displayed batch and surface a 409 without showing another batch run',async()=>{
  await withView(path=>Promise.resolve(path.startsWith('/api/single-service-100-run/')?response({error:'评测批次已切换，请刷新后重试'},409):response(report('batch-a','旧批次默认样例'))),async({view,clickDetail,calls,toasts,shown})=>{
    await view.load();await clickDetail();
    const path=calls.find(path=>path.startsWith('/api/single-service-100-run/'));
    assert.equal(new URL(path,'http://127.0.0.1').searchParams.get('manifestId'),'batch-a');
    assert.equal(shown.length,0);assert.match(toasts.join(' '),/批次已切换/);
  });
});

test('a delayed detail response is ignored if the displayed report switched in the meantime',async()=>{
  let current=report('batch-a','旧批次默认样例');const old=deferred();
  await withView(path=>path.startsWith('/api/single-service-100-run/')?old.promise:Promise.resolve(response(current)),async({view,clickDetail,toasts,shown})=>{
    await view.load();const pending=clickDetail();current=report('batch-b','新批次默认样例');await view.load();
    old.resolve(response({manifestId:'batch-a',run:{text:'旧批次迟到的详情'}}));await pending;
    assert.equal(shown.length,0);assert.match(toasts.join(' '),/批次已切换/);
  });
});
