import test from 'node:test';
import assert from 'node:assert/strict';
import * as suite from '../src/single-service-100.mjs';
import * as runner from '../scripts/benchmark-single-service-100.mjs';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildSingleService100Report} from '../src/single-service-100-report.mjs';
import {auditSingleService100} from '../scripts/verify-single-service-100.mjs';

const legacy=['qwen2.5:1.5b','qwen2.5:3b','qwen2.5:0.5b'];
const current=['qwen2.5:0.5b','qwen2.5:1.5b','qwen2.5:3b','qwen2.5:7b'];
const manifest=models=>({id:'single-service-100-20261012-test',conditions:{models,modelOrder:models,totalCalls:models.length*1000,callsPerModel:1000,repeats:1,sourceHashes:{a:'h'},modelDetails:models.map(name=>({name,digest:'sha-'+name}))},corpus:{total:1000,perDomain:100,sha256:'corpus',caseOrder:['c1']}});
test('default four-model order and historical manifest plans are authoritative',()=>{
 assert.deepEqual(suite.SINGLE_SERVICE_100_MODELS,current);
 assert.equal(typeof suite.singleService100Plan,'function');
 assert.equal(suite.singleService100Plan(manifest(current)).totalCalls,4000);
 assert.equal(suite.singleService100Plan(manifest(legacy)).totalCalls,3000);
 assert.throws(()=>suite.singleService100Plan(manifest([...legacy,legacy[0]])),/duplicate|重复/i);
 assert.throws(()=>suite.singleService100Plan({...manifest(current),conditions:{...manifest(current).conditions,modelOrder:legacy}}),/order|顺序/i);
});
test('new identities are dated unique directories and cannot overwrite historical v1 artifacts',()=>{
 assert.equal(typeof runner.createBenchmarkIdentity,'function');
 const first=runner.createBenchmarkIdentity(new Date('2026-10-12T04:00:00Z'),'aaaa');
 const second=runner.createBenchmarkIdentity(new Date('2026-10-12T04:00:00Z'),'bbbb');
 assert.notEqual(first,second);assert.match(first,/20261012.*aaaa/);
 const paths=runner.benchmarkStorage(first);
 assert.equal(paths.manifestPath,`data/runtime/single-service-100/${first}/manifest.json`);
 assert.equal(paths.reportPath,`docs/single-service-100/${first}/results.json`);
 assert.equal(paths.indexPath,`evidence/single-service-100/${first}/index.json`);
 assert.throws(()=>runner.benchmarkStorage('../escape'),/identity|身份|path/i);
});
test('resume validates model identities, source/corpus hashes and the complete frozen order',()=>{
 assert.equal(typeof runner.validateResumeManifest,'function');
 const original=manifest(current);
 const frozen={models:current,sourceHashes:{a:'h'},corpusHash:'corpus',caseOrder:['c1'],modelDetails:original.conditions.modelDetails};
 assert.equal(runner.validateResumeManifest(original,frozen),true);
 for(const change of [{models:legacy},{sourceHashes:{a:'changed'}},{corpusHash:'changed'},{caseOrder:['other']},{modelDetails:original.conditions.modelDetails.map(x=>({...x,digest:'changed'}))}])
  assert.throws(()=>runner.validateResumeManifest(original,{...frozen,...change}),/resume|恢复|changed|改变/i);
 assert.throws(()=>runner.validateResumeManifest(original,{...frozen,options:{num_ctx:2048}}),/options changed/);
 assert.throws(()=>runner.validateResumeManifest(original,{...frozen,context:{now:'changed'}}),/context changed/);
});
test('CLI requires explicit creation or resume and cannot accidentally target historical files',()=>{
 assert.throws(()=>runner.parseBenchmarkArguments([]),/Explicit/);
 assert.throws(()=>runner.parseBenchmarkArguments(['--new','--manifest','old']),/not both/);
 assert.equal(runner.parseBenchmarkArguments(['--new','--initialize']).initialize,true);
 assert.equal(runner.parseBenchmarkArguments(['--manifest','saved','--export-only']).manifest,'saved');
 assert.throws(()=>runner.parseBenchmarkArguments(['--manifest']),/requires a path/);
});
test('all actual pipeline dependencies and parameter provenance belong to the freeze closure',async()=>{
 assert.equal(typeof runner.collectSourcePaths,'function');
 const paths=await runner.collectSourcePaths(new URL('..',import.meta.url));
 for(const file of ['src/pipeline.mjs','src/parameter-provenance.mjs','src/providers.mjs','src/test-environment.mjs','src/benchmark-selection.mjs','tests/benchmark-selection-http.test.mjs'])assert.ok(paths.includes(file),file);
 assert.equal(new Set(paths).size,paths.length);
});

test('a uniquely stored four-model queued batch independently audits 4000 planned calls with no inference',async()=>{
 const realRoot=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(realRoot,'.audit-test-'));
 const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
 const save=async(path,value)=>{await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(value));};
 try{
  const id=runner.createBenchmarkIdentity(new Date('2026-10-12T00:00:00Z'),'unit-audit'),storage=runner.benchmarkStorage(id),sourceHashes={};
  for(const path of await runner.collectSourcePaths(realRoot)){
   const bytes=await readFile(join(realRoot,path));sourceHashes[path]=digest(bytes);
   for(const target of [join(temporary,path),join(temporary,storage.snapshotDirectory,path)]){await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);}
  }
  const cases=await suite.loadSingleService100Cases(temporary);
  const warmupPath=storage.evidenceRoot+'/warmups/'+runner.modelKey(current[0])+'.json';
  const options={num_ctx:2048,num_predict:224,temperature:0,timeoutMs:180000};
  const batch={...manifest(current),id,version:'single-service-100-batch-v2',suite:suite.SINGLE_SERVICE_100_SUITE,status:'queued',createdAt:'2026-10-12T00:00:00Z',storage,sourceSnapshot:storage.snapshotDirectory,
   conditions:{...manifest(current).conditions,sourceHashes,context:suite.SINGLE_SERVICE_100_CONTEXT,options,promptVersion:'unit-only'},
   corpus:{total:1000,perDomain:100,original:100,new:900,sha256:digest(JSON.stringify(cases)),caseOrder:runner.orderedCases(cases).map(c=>c.id),contractBoundaries:cases.filter(c=>c.contractBoundary).map(c=>({id:c.id,text:c.text,expectedStatus:c.expected.status,userGoalStatus:c.userGoalStatus,boundary:c.contractBoundary}))},
   warmups:[{model:current[0],path:warmupPath,excludedFromScores:true,status:'ready_mock',totalMs:1}],progress:{done:0,total:4000}};
  await save(join(temporary,warmupPath),{model:current[0],mode:'unified',text:'手机还剩多少电',options,context:suite.SINGLE_SERVICE_100_CONTEXT,status:'ready_mock',totalMs:1,traces:[{model:current[0],stage:'unified',raw:'{}',promptVersion:'unit-only'}]});
  await save(join(temporary,storage.manifestPath),batch);
  await save(join(temporary,storage.indexPath),{manifestId:id,status:'queued',rows:[]});
  await save(join(temporary,storage.reportPath),buildSingleService100Report(batch,[]));
  const before=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Offline audit must not call Ollama or any model');};
  try{const audit=await auditSingleService100({root:temporary,manifestPath:storage.manifestPath,partial:true});assert.equal(audit.modelCalls,0);assert.equal(audit.formal.planned,4000);assert.equal(audit.formal.saved,0);assert.equal(audit.warmups.saved,1);assert.equal(audit.checks.modelsMatchManifest,true);assert.equal(audit.checks.sevenBAbsent,false);}
  finally{globalThis.fetch=before;}
 }finally{assert.equal(dirname(resolve(temporary)),resolve(realRoot));await rm(temporary,{recursive:true,force:true});}
});
