import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {createApplication} from '../src/application.mjs';
import {RuntimeStore} from '../src/runtime.mjs';

const save=async(path,data)=>{await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(data));};
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'edge-benchmark-selection-'));
 const activePath=join(root,'data/runtime/single-service-100-active.json');
 const id='single-service-100-v1-20261012-fixture';
 const pointer={id,status:'queued',manifestPath:`data/runtime/single-service-100/${id}/manifest.json`,reportPath:`docs/single-service-100/${id}/results.json`,evidenceRoot:`evidence/single-service-100/${id}`};
 const manifest={id,status:'running',updatedAt:new Date().toISOString(),runner:{pid:process.pid},progress:{done:1,total:4000},conditions:{models:['qwen2.5:1.5b','qwen2.5:3b','qwen2.5:0.5b','qwen2.5:7b'],totalCalls:4000},active:{model:'qwen2.5:7b'}};
 const report={id,status:'running',progress:{done:1,total:4000},conditions:manifest.conditions,summary:[],cells:[],examples:[]};
 const record={manifestId:id,model:'qwen2.5:7b',caseId:'e100-cloud-011',run:{traces:[{raw:'{"api":"materials.search"}'}]}};
 await save(activePath,pointer);await save(join(root,pointer.manifestPath),manifest);await save(join(root,pointer.reportPath),report);
 await save(join(root,pointer.evidenceRoot,'index.json'),{manifestId:id,rows:[{model:record.model,caseId:record.caseId,testDomain:'cloud',primary:'parameters'}]});
 await save(join(root,pointer.evidenceRoot,'qwen2.5-7b/e100-cloud-011.json'),record);
 await save(join(root,'legacy-report.json'),{id:'legacy-three-model',status:'completed',progress:{done:3000,total:3000}});
 const store=await new RuntimeStore(join(root,'data/runtime')).init();let invoked=0;
 const handler=createApplication({store,runPipeline:async()=>{invoked++;return {};},providers:{},catalog:{version:'stub',domains:[],capabilities:[]},docs:[],cases:[],baseContext:{},
  singleService100Root:root,singleService100ActivePath:activePath,singleService100StatePath:join(root,'legacy-state.json'),singleService100ReportPath:join(root,'legacy-report.json'),singleService100EvidenceDirectory:join(root,'legacy-evidence'),
  fetchImpl:async url=>({ok:true,json:async()=>url.endsWith('/api/tags')?{models:[{name:'qwen2.5:7b',details:{parameter_size:'7.6B'}}]}:{version:'stub'}})});
 const server=createServer(handler);await new Promise(done=>server.listen(0,'127.0.0.1',done));
 return {root,id,pointer,manifest,report,record,activePath,url:`http://127.0.0.1:${server.address().port}`,get invoked(){return invoked;},
  async close(){await new Promise(done=>server.close(done));const target=resolve(root);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('edge-benchmark-selection-'));await rm(target,{recursive:true,force:true});}};
}
test('new active batch selects its four-model report, index and 7B raw detail without inference',async()=>{
 const app=await fixture();try{
  assert.deepEqual(await(await fetch(app.url+'/api/single-service-100-report')).json(),app.report);
  const rows=await(await fetch(app.url+'/api/single-service-100-results?model=qwen2.5%3A7b')).json();assert.equal(rows.manifestId,app.id);assert.equal(rows.rows.length,1);
  assert.deepEqual(await(await fetch(app.url+'/api/single-service-100-run/qwen2.5-7b/e100-cloud-011')).json(),app.record);
  assert.equal(app.invoked,0);
 }finally{await app.close();}
});
test('exclusive gate reads the selected manifest even when pointer status is queued',async()=>{
 const app=await fixture();try{
  const health=await(await fetch(app.url+'/api/health')).json();assert.equal(health.lab.exclusiveBenchmark?.id,app.id);
  const response=await fetch(app.url+'/api/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'查电量',model:'qwen2.5:7b'})});assert.equal(response.status,409);assert.equal(app.invoked,0);
 }finally{await app.close();}
});
test('active pointer cannot select a path outside its own batch directory',async()=>{
 const app=await fixture();try{
  await save(app.activePath,{...app.pointer,reportPath:'legacy-report.json'});
  assert.equal((await fetch(app.url+'/api/single-service-100-report')).status,503);assert.equal(app.invoked,0);
 }finally{await app.close();}
});
test('active report and raw detail must belong to the selected manifest',async()=>{
 const app=await fixture();try{
  await save(join(app.root,app.pointer.reportPath),{...app.report,id:'other-batch'});
  assert.equal((await fetch(app.url+'/api/single-service-100-report')).status,503);
  await save(join(app.root,app.pointer.evidenceRoot,'qwen2.5-7b/e100-cloud-011.json'),{...app.record,manifestId:'other-batch'});
  assert.equal((await fetch(app.url+'/api/single-service-100-run/qwen2.5-7b/e100-cloud-011')).status,503);
 }finally{await app.close();}
});
test('initializing report preserves selected model plan even before the report file exists',async()=>{
 const app=await fixture();try{
  await unlink(join(app.root,app.pointer.reportPath));
  const pending=await(await fetch(app.url+'/api/single-service-100-report')).json();
  assert.equal(pending.id,app.id);assert.deepEqual(pending.conditions.models,app.manifest.conditions.models);assert.equal(pending.progress.total,4000);assert.deepEqual(pending.summary,[]);
 }finally{await app.close();}
});
test('a browser snapshot cannot read rows or detail from a newly selected batch',async()=>{
 const app=await fixture();try{
  for(const path of ['/api/single-service-100-results','/api/single-service-100-run/qwen2.5-7b/e100-cloud-011']){
   assert.equal((await fetch(app.url+path+'?manifestId=previous-batch')).status,409);
   assert.equal((await fetch(app.url+path+'?manifestId='+app.id)).status,200);
  }
  assert.equal(app.invoked,0);
 }finally{await app.close();}
});
