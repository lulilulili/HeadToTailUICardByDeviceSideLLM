import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildFeasibilityImport,importFeasibilityEvidence,evidenceId,IMPORT_VERSION} from '../scripts/import-feasibility-evidence.mjs';
import {RuntimeStore} from '../src/runtime.mjs';

const models=['qwen2.5:0.5b','qwen2.5:1.5b','qwen2.5:3b','qwen2.5:7b'];
function fixture(){
 const current=Array.from({length:40},(_,index)=>`single-test-${index+1}`),paired=current.slice(0,12),guards=Array.from({length:4},(_,index)=>({id:`guard-test-${index+1}`}));
 const audit={id:'synthetic-completed-manifest',createdAt:'2026-10-11T01:00:00.000Z',completedAt:'2026-10-11T02:00:00.000Z',status:'completed',conditions:{catalog:'single-service-v3',groundingVersion:'deterministic-grounding-v2',promptVersion:'explicit-v7',sourceHashes:{'src/grounding.mjs':'frozen'},modelDetails:models.map(name=>({name,digest:`digest-${name}`,details:{parameter_size:name.split(':')[1],quantization_level:'Q4_K_M'}})),options:{num_ctx:2048,num_predict:224},context:{now:'2026-10-10T08:00:00+08:00',timezone:'Asia/Shanghai'},sampling:{currentCaseIds:current,pairedCaseIds:paired,guards}},rows:[],warmups:[]};
 for(const model of models){
  for(const [variant,ids]of [['explicit-v7',current],['sparse-v6-shared-catalog',paired],['explicit-v7-guards',guards.map(item=>item.id)]])for(const caseId of ids){
   const raw={domain:'files',api:'files.search',extractedArguments:{}},output={domain:'files',api:'files.search',arguments:{query:null}};
   audit.rows.push({model,variant,caseId,testDomain:'files',text:`查找 ${caseId} 报告`,expected:{domain:'files',api:'files.search',arguments:{query:'报告'},status:'ready_mock'},context:structuredClone(audit.conditions.context),raw,
    trace:{stage:'unified',provider:'ollama',model,startedAt:audit.createdAt,raw:JSON.stringify(output),messages:[{role:'user',content:`查找 ${caseId} 报告`}],schema:{type:'object'},wallMs:123,loadMs:3,promptMs:80,generationMs:40,inputTokens:100,outputTokens:20,promptVersion:variant==='sparse-v6-shared-catalog'?'sparse-v6':'explicit-v7',promptMeta:{candidates:{ids:['files.search'],scores:[{id:'files.search',score:12}]}},options:{num_ctx:2048,num_predict:224,temperature:0}},
    v2Run:{domain:'files',api:'files.search',status:'ready_mock',groundedArguments:{query:'报告'},grounding:{version:'deterministic-grounding-v2',repairs:[{field:'query'}]},resolved:{arguments:{query:'报告'},sources:{query:'user'},missing:[],issues:[],resolution:{}},mock:{executed:false,simulated:true,value:null},deterministicMs:4},
    v1Run:{domain:'files',api:'files.search',status:'needs_clarification'},rawScore:{arguments:false},v1Score:{plan:false},v2Score:{domain:true,api:true,finalArguments:true,status:true,plan:true}
   });
  }
  audit.warmups.push({model,excludedFromScores:true,trace:{stage:'unified',provider:'ollama',model,startedAt:audit.createdAt,wallMs:222,raw:JSON.stringify({domain:'device',api:'device.battery.level',arguments:{}}),messages:[{role:'user',content:'手机还剩多少电'}]}});
 }
 return audit;
}
test('224 completed calls map to 160/48/16 evaluations with untouched raw extraction and independent scores',()=>{
 const audit=fixture(),before=structuredClone(audit),plan=buildFeasibilityImport(audit,{importedAt:'2026-10-11T03:00:00Z'});
 assert.deepEqual(audit,before);assert.equal(plan.runs.length,224);assert.equal(new Set(plan.runs.map(run=>run.id)).size,224);assert.deepEqual(plan.evaluations.map(job=>job.results.length),[160,48,16]);
 assert.deepEqual(plan.evaluations.map(job=>job.caseIds.length),[40,12,4]);assert.deepEqual(plan.evaluations.map(job=>job.warmups.length),[4,0,0]);assert.equal(plan.warmupCount,4);
 const run=plan.runs[0],row=plan.evaluations[0].results[0];
 assert.deepEqual(run.modelArguments,{query:null});assert.deepEqual(run.extractedArguments,{});assert.deepEqual(run.groundedArguments,{query:'报告'});assert.deepEqual(run.traces[0],audit.rows[0].trace);assert.deepEqual(run.context,audit.rows[0].context);
 assert.equal(run.totalMs,127);assert.equal(run.timing.totalMsMeasured,false);assert.equal(run.environment.models[0].digest,audit.conditions.modelDetails[0].digest);
 assert.equal(run.environment.prepareSystemContextExecuted,false);assert.equal(run.environment.harmonyHostUsed,false);assert.match(run.environment.executionBoundary,/绕过 prepareSystemContext/);
 assert.equal(Object.hasOwn(run,'expected'),false);assert.equal(row.score.arguments,false);assert.equal(row.score.plan,false);assert.deepEqual(row.executionScore,audit.rows[0].v2Score);assert.deepEqual(row.v1Score,audit.rows[0].v1Score);
 for(const job of plan.evaluations){assert.equal(job.status,'completed');assert.equal(job.mode,'unified');assert.equal(job.catalogVersion,'single-service-v3');assert.equal(job.ruleVersion,'deterministic-grounding-v2');assert.deepEqual(job.progress,{done:job.results.length,total:job.results.length});assert.equal(job.summary.reduce((total,item)=>total+item.total,0),job.results.length);assert.ok(job.summary.every(item=>item.executionAccuracy===1&&item.argumentAccuracy===0));}
 assert.ok(plan.evaluations[2].results.every(result=>result.text.includes('guard-test')&&result.suite==='single-service-guards'));
});
test('incomplete status, missing rows, repeated keys, and altered raw extraction are rejected',()=>{
 for(const mutate of [audit=>{audit.status='running';},audit=>{audit.rows.pop();},audit=>{audit.rows[1]=structuredClone(audit.rows[0]);},audit=>{audit.rows[0].raw.extractedArguments={query:'gold must not repair raw'};}]){
  const audit=fixture();mutate(audit);assert.throws(()=>buildFeasibilityImport(audit));
 }
});
test('changing expected gold cannot change a run and IDs depend only on manifest/variant/model/case',()=>{
 const audit=fixture(),first=buildFeasibilityImport(audit,{importedAt:'same'});audit.rows[0].expected={domain:'different',api:'different',arguments:{query:'poison'},status:'unsupported'};
 const second=buildFeasibilityImport(audit,{importedAt:'same'});assert.deepEqual(first.runs,second.runs);assert.equal(first.evaluations[0].id,second.evaluations[0].id);
 assert.equal(first.runs[0].id,evidenceId(audit.id,'run',audit.rows[0].variant,audit.rows[0].model,audit.rows[0].caseId));
 assert.notEqual(evidenceId(audit.id,'run','explicit-v7',models[0],'x'),evidenceId(audit.id,'run','sparse-v6-shared-catalog',models[0],'x'));
});
test('failed calls keep their original invalid output and remain in every denominator',()=>{
 const audit=fixture(),row=audit.rows[0];row.error='output schema failed';row.trace.raw='{"domain":"files","arguments":';row.trace.error=row.error;
 row.raw={domain:null,api:null,extractedArguments:{}};row.v1Run={...row.raw,status:'error',error:row.error};row.v2Run={...row.raw,status:'error',error:row.error};row.v1Score={plan:false};row.v2Score={plan:false,domain:false,api:false};
 audit.warmups[0].error='warmup failed';const plan=buildFeasibilityImport(audit),imported=plan.runs[0];
 assert.equal(imported.status,'error');assert.equal(imported.modelArguments,null);assert.equal(imported.traces[0].raw,row.trace.raw);assert.deepEqual(imported.extractedArguments,{});
 assert.equal(plan.evaluations[0].results.length,160);assert.equal(plan.evaluations[0].summary.find(item=>item.model===row.model).total,40);assert.equal(plan.evaluations[0].summary.find(item=>item.model===row.model).errorCount,1);
 assert.equal(plan.evaluations[0].results[0].score.plan,false);assert.equal(plan.evaluations[0].results[0].executionScore.plan,false);assert.equal(plan.evaluations[0].warmups[0].status,'error');assert.equal(plan.warmupCount,4);
});
test('dry run writes nothing and repeated import is idempotent without touching historical UUID records',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'edge-feasibility-import-'));
 try{
  const audit=fixture(),path=join(dir,'audit.json'),runtime=join(dir,'runtime');await writeFile(path,JSON.stringify(audit));
  const dry=await importFeasibilityEvidence({auditPath:path,runtimeDirectory:runtime,dryRun:true});assert.equal(dry.status,'dry_run');assert.equal(dry.runCount,224);await assert.rejects(readdir(runtime),{code:'ENOENT'});
  const store=await new RuntimeStore(runtime).init(),historical={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',createdAt:'2026-10-10',status:'ready_mock',text:'historical raw'};await store.save('run',historical);
  const historicalPath=join(runtime,`run-${historical.id}.json`),before=await readFile(historicalPath,'utf8');
  const first=await importFeasibilityEvidence({auditPath:path,runtimeDirectory:runtime}),second=await importFeasibilityEvidence({auditPath:path,runtimeDirectory:runtime});
  assert.deepEqual(first.jobs,second.jobs);assert.equal(first.runCount,224);const loaded=await new RuntimeStore(runtime).init();assert.equal(loaded.runs.length,225);assert.equal(loaded.evaluations.length,3);assert.equal(await readFile(historicalPath,'utf8'),before);
  assert.ok(loaded.evaluations.every(job=>job.feasibilityImportVersion===IMPORT_VERSION&&job.status==='completed'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('a colliding historical ID refuses the whole import before any evidence write',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'edge-feasibility-collision-'));
 try{
  const audit=fixture(),path=join(dir,'audit.json'),runtime=join(dir,'runtime');await writeFile(path,JSON.stringify(audit));const plan=buildFeasibilityImport(audit);
  const store=await new RuntimeStore(runtime).init();await store.save('eval',{id:plan.evaluations[2].id,createdAt:audit.createdAt,status:'completed',results:[],historical:true});
  const before=await readdir(runtime);await assert.rejects(importFeasibilityEvidence({auditPath:path,runtimeDirectory:runtime}),/拒绝覆盖历史/);assert.deepEqual(await readdir(runtime),before);
 }finally{await rm(dir,{recursive:true,force:true});}
});
