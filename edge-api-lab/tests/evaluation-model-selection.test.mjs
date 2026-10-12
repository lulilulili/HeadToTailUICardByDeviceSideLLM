import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {defaultEvaluationModelChecked} from '../public/ui-utils.mjs';
import {createEvaluation} from '../public/evaluation-view.mjs';

test('current manual evaluation defaults include all four requested Qwen gradients',()=>{
  for(const name of ['qwen2.5:0.5b','qwen2.5:1.5b','qwen2.5:3b','qwen2.5:7b'])assert.equal(defaultEvaluationModelChecked(name),true,name);
  for(const name of ['another:3b','qwen2.5:14b'])assert.equal(defaultEvaluationModelChecked(name),false,name);
});

test('workbench copy names the four-model default and never excludes the current seven-billion model',async()=>{
  const source=await readFile(new URL('../public/evaluation-view.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/本轮千题不测|7B 不参加千题实测/);
  assert.match(source,/0\.5B \/ 1\.5B \/ 3B \/ 7B 默认勾选/);
  assert.match(source,/modelsInitialized\?previous\.has\(model\.name\):defaultEvaluationModelChecked\(model\.name\)/);
  assert.match(source,/getModels\(\)\.filter\(model=>model\.eligible\)/);
});

test('workbench initially checks all four eligible gradients and preserves a later custom model choice',async()=>{
  const previousDocument=globalThis.document,previousFetch=globalThis.fetch,elements=new Map();let checked=[];
  const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',disabled:false,textContent:'',addEventListener(){}});return elements.get(id);};
  const box={innerHTML:'',querySelector:element,querySelectorAll:selector=>selector==='[name="eval-model"]:checked'?checked:[]};
  globalThis.document={querySelector:()=>box};globalThis.fetch=async path=>new Response(JSON.stringify(path==='/api/cases'?{cases:[],context:{}}:{evaluations:[]}));
  const names=['qwen2.5:0.5b','qwen2.5:1.5b','qwen2.5:3b','qwen2.5:7b','another:3b'];
  const controller=createEvaluation({getModels:()=>[...names.map(name=>({name,eligible:true,parameterSize:'sample'})),{name:'too-large:14b',eligible:false}],getOptions:()=>({}),showRun(){},toast(message){assert.fail(message);}});
  const checkMarkup=name=>element('#eval-models').innerHTML.match(new RegExp('<input[^>]*value="'+name.replaceAll('.','\\.')+'"[^>]*>'))?.[0] || '';
  try{
    await controller.load();
    for(const name of names.slice(0,4))assert.match(checkMarkup(name),/checked/,name);
    assert.doesNotMatch(checkMarkup('another:3b'),/checked/);assert.doesNotMatch(element('#eval-models').innerHTML,/too-large:14b|本轮千题不测/);
    checked=[{value:'another:3b'}];controller.updateModels();
    assert.match(checkMarkup('another:3b'),/checked/);
    for(const name of names.slice(0,4))assert.doesNotMatch(checkMarkup(name),/checked/,name);
  }finally{controller.setSuspended(true);globalThis.document=previousDocument;globalThis.fetch=previousFetch;}
});
