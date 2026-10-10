import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RuntimeStore} from '../src/runtime.mjs';
import {createApplication} from '../src/application.mjs';

async function setup(pipeline=async()=>({domain:'weather',api:'weather.query',extractedArguments:{},status:'ready_mock',totalMs:10,traces:[]}),healthDelay=0) {
 const dir=await mkdtemp(join(tmpdir(),'edge-app-')); const store=await new RuntimeStore(dir).init();
 const fetchImpl=async url=>{if(healthDelay)await new Promise(resolve=>setTimeout(resolve,healthDelay));return {ok:true,json:async()=>url.endsWith('/api/tags')?{models:[{name:'qwen2.5:3b',details:{parameter_size:'3.1B'}},{name:'big:14b',details:{parameter_size:'14B'}}]}:{version:'test'}};};
 await writeFile(join(dir,'sample.mjs'),'export const hello=1;');
 const app=createApplication({store,runPipeline:pipeline,providers:{ollama:{}},fetchImpl,ollamaUrl:'http://127.0.0.1:11434',catalog:{domains:[],capabilities:[]},docs:[],cases:[{id:'c1',text:'今天会下雨吗',expected:{domain:'weather',api:'weather.query',arguments:{},status:'ready_mock'}}],baseContext:{now:'2026-10-10T08:00:00+08:00',timezone:'Asia/Shanghai'},publicDirectory:dir,groundingReportPath:join(dir,'grounding-replay.json')});
 const server=createServer(app); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}`;
 return {url,store,close:async()=>{await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>setTimeout(resolve,30));await store.queue.run(async()=>{}); await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:10});}};
}
const post=(url,body,headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});

test('grounding replay is independent and a stale manifest cannot be shown as a current comparison',async()=>{
 const app=await setup();try{
  let report=await(await fetch(`${app.url}/api/grounding-report`)).json();assert.equal(report.status,'not_started');assert.deepEqual(report.cells,[]);
  await writeFile(join(app.store.directory,'grounding-replay.json'),JSON.stringify({manifestId:'frozen',version:'deterministic-grounding-v1',status:'completed',cells:[{total:50}]}));
  await writeFile(join(app.store.directory,'domain-suite.json'),JSON.stringify({id:'frozen'}));
  report=await(await fetch(`${app.url}/api/grounding-report`)).json();assert.equal(report.manifestId,'frozen');assert.equal(report.cells.length,1);
  await writeFile(join(app.store.directory,'domain-suite.json'),JSON.stringify({id:'new-batch'}));
  report=await(await fetch(`${app.url}/api/grounding-report`)).json();assert.equal(report.status,'stale');assert.deepEqual(report.cells,[]);assert.match(report.notes.join(' '),/不匹配|历史/);
 }finally{await app.close();}
});
test('a changed grounding implementation is not presented as the report current rule version',async()=>{
 const app=await setup();try{
  await writeFile(join(app.store.directory,'grounding-replay.json'),JSON.stringify({manifestId:'frozen',status:'completed',cells:[{total:50}],conditions:{replaySourceHashes:{'src/grounding.mjs':'wrong-hash'}}}));
  await writeFile(join(app.store.directory,'domain-suite.json'),JSON.stringify({id:'frozen'}));
  const report=await(await fetch(`${app.url}/api/grounding-report`)).json();assert.equal(report.status,'stale');assert.deepEqual(report.cells,[]);assert.match(report.notes.join(' '),/代码|规则/);
 }finally{await app.close();}
});

test('domain report starts with empty metrics and isolates only manifest jobs',async()=>{
 const app=await setup();try {
  let report=await(await fetch(`${app.url}/api/domain-report`)).json();
  assert.equal(report.status,'not_started');assert.equal(report.summary.length,24);assert.equal(report.progress.done,0);assert.equal(report.summary[0].planAccuracy,null);
  await app.store.save('eval',{id:'old',createdAt:'2026-10-10',results:[{caseId:'c1',model:'qwen2.5:3b',score:{plan:true},run:{totalMs:1}}]});
  await writeFile(join(app.store.directory,'domain-suite.json'),JSON.stringify({suite:'domain-50-v1',status:'running',models:['qwen2.5:3b'],entries:[]}));
  report=await(await fetch(`${app.url}/api/domain-report`)).json();assert.equal(report.progress.done,0);assert.equal(report.summary.length,6);
 }finally{await app.close();}
});

test('compact evaluation list keeps metrics but omits large traces and warmups',async()=>{
 const app=await setup();try {
  await app.store.save('eval',{id:'compact',createdAt:'2026-10-10',results:[],warmups:[{traces:['large']}],progress:{done:0,total:50}});
  const compact=await(await fetch(`${app.url}/api/evaluations?view=summary`)).json();
  assert.equal(Object.hasOwn(compact.evaluations[0],'results'),false);assert.equal(Object.hasOwn(compact.evaluations[0],'warmups'),false);assert.ok(Array.isArray(compact.evaluations[0].summary));
  const full=await(await fetch(`${app.url}/api/evaluations`)).json();assert.ok(Array.isArray(full.evaluations[0].results));assert.equal(full.evaluations[0].warmups.length,1);
 }finally{await app.close();}
});
test('ES modules are served with JavaScript MIME under nosniff',async()=>{
 const app=await setup();try{const res=await fetch(`${app.url}/sample.mjs`);assert.match(res.headers.get('content-type'),/text\/javascript/);}finally{await app.close();}
});
test('run validates installed model size before any inference',async()=>{
 const app=await setup(); try {const res=await post(`${app.url}/api/runs`,{text:'天气',model:'big:14b'});assert.equal(res.status,400);assert.match((await res.json()).error,/10B/);}finally{await app.close();}
});
test('provider failures are saved with timing rather than discarded',async()=>{
 const app=await setup(async()=>{const error=new Error('bad schema');error.trace={stage:'domain',wallMs:9};throw error;});
 try {const res=await post(`${app.url}/api/runs`,{text:'天气',model:'qwen2.5:3b'});const run=await res.json();assert.equal(run.status,'error');assert.equal(run.traces[0].wallMs,9);assert.equal(app.store.runs.length,1);}finally{await app.close();}
});
test('foreign website cannot initiate loopback model calls',async()=>{
 const app=await setup();try {const res=await post(`${app.url}/api/runs`,{text:'天气',model:'qwen2.5:3b'},{Origin:'https://example.com'});assert.equal(res.status,403);}finally{await app.close();}
});
test('excessive context window is rejected before local memory allocation',async()=>{
 const app=await setup();try{const res=await post(`${app.url}/api/runs`,{text:'天气',model:'qwen2.5:3b',options:{num_ctx:999999}});assert.equal(res.status,400);}finally{await app.close();}
});
test('nonzero temperature cannot be silently accepted in deterministic experiment',async()=>{
 const app=await setup();try{const res=await post(`${app.url}/api/runs`,{text:'天气',model:'qwen2.5:3b',options:{temperature:0.5}});assert.equal(res.status,400);}finally{await app.close();}
});

test('context rejects fabricated selection labels and unknown weather grains before inference',async()=>{
 let calls=0;const app=await setup(async()=>{calls++;return {status:'ready_mock',traces:[]};});
 try{
  const selection=await post(`${app.url}/api/runs`,{text:'这份文件多大',model:'qwen2.5:3b',context:{objects:{file_id:{value:'file_9',trusted:false,source:'model'}}}});
  assert.equal(selection.status,400);
  const grain=await post(`${app.url}/api/runs`,{text:'天气',model:'qwen2.5:3b',context:{weatherAvailability:{second:true}}});
  assert.equal(grain.status,400);assert.equal(calls,0);
 }finally{await app.close();}
});

test('explicit selected objects and experimental availability are retained without altering the user prompt',async()=>{
 let received;const app=await setup(async input=>{received=input;return {status:'ready_mock',traces:[]};});
 try{
  const context={objects:{file_id:{value:'file_9',trusted:true,source:'user_selection'}},weatherAvailability:{minute:false,hourly:true},geocodes:{}};
  const res=await post(`${app.url}/api/runs`,{text:'这份文件多大',model:'qwen2.5:3b',context});
  assert.equal(res.status,200);assert.equal(received.text,'这份文件多大');assert.deepEqual(received.context.objects,context.objects);assert.equal(received.context.weatherAvailability.minute,false);assert.equal(received.context.weatherAvailabilitySource,'provided_experiment');
 }finally{await app.close();}
});
test('concurrent evaluation submissions cannot both claim the single batch slot',async()=>{
 const app=await setup(async(_input,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})),50);
 try {
  const responses=await Promise.all([post(`${app.url}/api/evaluations`,{models:['qwen2.5:3b'],limit:1}),post(`${app.url}/api/evaluations`,{models:['qwen2.5:3b'],limit:1})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[202,409]);
 }finally{for(const job of app.store.evaluations)await post(`${app.url}/api/evaluations/${job.id}/cancel`,{});await app.close();}
});
test('CSV export neutralizes formula prefixes from user prompts',async()=>{
 const app=await setup();try{
  await app.store.save('run',{id:'formula',createdAt:'2026-10-10',text:'=1+1',status:'error'});
  const res=await fetch(`${app.url}/api/export?format=csv&type=runs`);assert.match(await res.text(),/'=1\+1/);
 }finally{await app.close();}
});
test('evaluation CSV keeps strict and execution scores separate and leaves unscored history empty',async()=>{
 const app=await setup();try{
  await app.store.save('eval',{id:'two-scores',createdAt:'2026-10-10',ruleVersion:'deterministic-grounding-v1',results:[{model:'qwen2.5:3b',caseId:'c1',text:'天气',score:{plan:false,arguments:false},executionScore:{plan:true,arguments:true},run:{status:'ready_mock',totalMs:10}},{model:'qwen2.5:3b',caseId:'old',text:'历史',score:{plan:true,arguments:true},run:{status:'ready_mock',totalMs:11}}]});
  const text=await(await fetch(`${app.url}/api/export?format=csv&type=evaluations`)).text();
  const lines=text.replace(/^\ufeff/,'').split('\r\n').map(line=>line.split(',').map(value=>value.slice(1,-1)));
  const headers=lines[0],rows=lines.slice(1).map(values=>Object.fromEntries(headers.map((key,index)=>[key,values[index]])));
  assert.equal(rows[0].plan,'false');assert.equal(rows[0].executionPlan,'true');assert.equal(rows[0].executionArguments,'true');assert.equal(rows[0].ruleVersion,'deterministic-grounding-v1');
  assert.equal(rows[1].plan,'true');assert.equal(rows[1].executionPlan,'');
 }finally{await app.close();}
});
test('cancelling running batch aborts inference and preserves partial state',async()=>{
 let entered;const started=new Promise(resolve=>{entered=resolve;});
 const app=await setup(async(_input,{signal})=>{entered();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));});
 try {
  const res=await post(`${app.url}/api/evaluations`,{models:['qwen2.5:3b'],limit:1});const job=await res.json();assert.equal(res.status,202);
  await started;await post(`${app.url}/api/evaluations/${job.id}/cancel`,{});
  const state=await (await fetch(`${app.url}/api/evaluations/${job.id}`)).json();assert.equal(state.status,'cancelled');assert.equal(state.progress.done,0);
  await new Promise(resolve=>setTimeout(resolve,40));assert.equal(app.store.runs[0]?.status,'cancelled');
 }finally{await app.close();}
});
