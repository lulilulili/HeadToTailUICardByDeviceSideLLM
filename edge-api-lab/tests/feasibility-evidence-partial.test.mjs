import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {buildFeasibilityImport,importFeasibilityEvidence} from '../scripts/import-feasibility-evidence.mjs';
import {RuntimeStore} from '../src/runtime.mjs';

const models=['qwen2.5:0.5b','qwen2.5:1.5b','qwen2.5:3b','qwen2.5:7b'];
const variants=['explicit-v7','sparse-v6-shared-catalog','explicit-v7-guards'];
function partialFixture(){
  const current=Array.from({length:40},(_,index)=>`partial-single-${index+1}`),paired=current.slice(0,12),guards=Array.from({length:4},(_,index)=>({id:`partial-guard-${index+1}`}));
  const audit={id:'synthetic-hardware-limited-manifest',createdAt:'2026-10-11T01:00:00Z',completedAt:'2026-10-11T02:00:00Z',status:'partial_hardware_limited',plannedCalls:224,missingCalls:54,completeModels:models.slice(0,3),
    hardwareLimit:{model:models[3],reason:'memory_pressure_timeout',freeMemoryBytes:280000000,consecutiveTimeouts:3},
    conditions:{catalog:'single-service-v3',groundingVersion:'deterministic-grounding-v2',promptVersion:'explicit-v7',modelDetails:models.map(name=>({name,digest:`digest-${name}`,details:{quantization_level:'Q4_K_M',parameter_size:name.split(':')[1]}})),sampling:{currentCaseIds:current,pairedCaseIds:paired,guards},context:{now:'2026-10-10T08:00:00+08:00',timezone:'Asia/Shanghai'}},rows:[],warmups:[]};
  for(const model of models){
    for(const [index,variant]of variants.entries())for(const caseId of [current,paired,guards.map(item=>item.id)][index]){
      if(model===models[3]&&(index===2||caseId!==current[0]))continue;
      const raw={domain:'device',api:'device.battery.level',extractedArguments:{}},failed=model===models[3];
      const trace={model,provider:'ollama',raw:failed?'':JSON.stringify({domain:raw.domain,api:raw.api,arguments:{}}),wallMs:failed?180000:100,inputTokens:100,messages:[{role:'user',content:'查询设备电量'}]};
      const run=failed?{...raw,status:'error',error:'TimeoutError: request timed out'}:{domain:raw.domain,api:raw.api,status:'ready_mock',groundedArguments:{},resolved:{arguments:{},sources:{},missing:[],issues:[],resolution:{}},deterministicMs:1};
      audit.rows.push({model,variant,caseId,testDomain:'device',text:'查询设备电量',expected:{domain:raw.domain,api:raw.api,arguments:{},status:'ready_mock'},context:structuredClone(audit.conditions.context),
        raw:failed?{domain:null,api:null,extractedArguments:{}}:raw,trace,v1Run:structuredClone(run),v2Run:run,rawScore:{domain:!failed,api:!failed,arguments:!failed},v1Score:{plan:!failed},v2Score:{plan:!failed},...(failed?{error:run.error}:{})});
    }
    audit.warmups.push({model,excludedFromScores:true,trace:{model,raw:model===models[3]?'':JSON.stringify({domain:'device',api:'device.battery.level',arguments:{}}),wallMs:model===models[3]?180000:100},...(model===models[3]?{error:'warmup timeout'}:{})});
  }
  return audit;
}

test('170 observed calls import as interrupted without manufacturing the missing 54 calls',()=>{
  const audit=partialFixture(),before=structuredClone(audit),plan=buildFeasibilityImport(audit,{importedAt:'same'});
  assert.deepEqual(audit,before);assert.equal(plan.runs.length,170);assert.equal(new Set(plan.runs.map(run=>run.id)).size,170);
  assert.equal(plan.plannedCalls,224);assert.equal(plan.observedCalls,170);assert.equal(plan.missingCallCount,54);assert.equal(plan.missingCalls.length,54);
  assert.deepEqual(plan.completeModels,models.slice(0,3));assert.ok(plan.missingCalls.every(call=>call.model===models[3]));
  assert.deepEqual(plan.evaluations.map(job=>job.results.length),[121,37,12]);
  assert.deepEqual(plan.evaluations.map(job=>job.progress),[{done:121,total:160},{done:37,total:48},{done:12,total:16}]);
  assert.deepEqual(plan.evaluations.map(job=>job.samplingCoverage.missingCallCount),[39,11,4]);
  assert.deepEqual(plan.evaluations.map(job=>job.warmups.length),[4,0,0]);assert.equal(plan.warmupCount,4);
  for(const job of plan.evaluations){
    assert.equal(job.status,'interrupted');assert.equal(job.completedAt,null);assert.equal(job.interruptedAt,audit.completedAt);
    assert.equal(job.sourceAuditStatus,'partial_hardware_limited');assert.deepEqual(job.hardwareLimit,audit.hardwareLimit);
    assert.equal(job.summary.reduce((total,item)=>total+item.total,0),job.results.length);
    assert.ok(job.notes.some(note=>note.includes('不进入准确率分母')));
  }
  for(const job of plan.evaluations.slice(0,2)){
    const summary=job.summary.find(item=>item.model===models[3]);
    assert.equal(summary.total,1);assert.equal(summary.providerErrors,1);assert.equal(summary.ruleErrors,0);assert.equal(summary.routingEvaluableCalls,0);
    assert.equal(summary.hardwareLimited,true);assert.equal(summary.capacityComparisonEligible,false);assert.equal(summary.errorCount,1);
  }
  assert.ok(!plan.evaluations[2].summary.some(item=>item.model===models[3]),'Uncalled 7B guard cases must not receive fabricated scores');
  const failed=plan.runs.find(run=>run.model===models[3]);assert.equal(failed.status,'error');assert.equal(failed.traces[0].raw,'');assert.equal(failed.modelArguments,null);
  assert.deepEqual(plan.runs[0].traces[0],audit.rows[0].trace);assert.deepEqual(plan.runs[0].extractedArguments,audit.rows[0].raw.extractedArguments);
});

test('partial status requires auditable hardware reasons and cannot hide unrelated missing calls',()=>{
  for(const mutate of [
    audit=>{delete audit.hardwareLimit;},audit=>{audit.hardwareLimit.reason='';},audit=>{audit.hardwareLimit.model='unknown';},
    audit=>{audit.rows.shift();},audit=>{audit.completeModels=[models[0]];},audit=>{audit.missingCalls=53;},audit=>{audit.plannedCalls=170;},
    audit=>{audit.status='running';},audit=>{audit.status='cancelled';},audit=>{audit.status='completed';},
    audit=>{audit.rows[1]=structuredClone(audit.rows[0]);},audit=>{audit.rows[0].raw.extractedArguments={location:'gold repair'};}
  ]){const audit=partialFixture();mutate(audit);assert.throws(()=>buildFeasibilityImport(audit));}
});

test('partial gold changes cannot alter raw, trace, run IDs, or hardware audit',()=>{
  const audit=partialFixture(),first=buildFeasibilityImport(audit,{importedAt:'same'});
  audit.rows[0].expected={domain:'weather',api:'weather.query',arguments:{location:'poison'},status:'unsupported'};
  const second=buildFeasibilityImport(audit,{importedAt:'same'});
  assert.deepEqual(first.runs,second.runs);assert.deepEqual(first.missingCalls,second.missingCalls);
  assert.deepEqual(first.evaluations.map(job=>job.hardwareLimit),second.evaluations.map(job=>job.hardwareLimit));
});

test('partial dry run is non-mutating and repeated storage preserves interrupted status',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'edge-feasibility-partial-'));
  try{
    const audit=partialFixture(),auditPath=join(directory,'audit.json'),runtime=join(directory,'runtime');
    await writeFile(auditPath,JSON.stringify(audit));
    const dry=await importFeasibilityEvidence({auditPath,runtimeDirectory:runtime,dryRun:true});
    assert.equal(dry.runCount,170);assert.equal(dry.missingCallCount,54);assert.ok(dry.jobs.every(job=>job.status==='interrupted'));
    await assert.rejects(readdir(runtime),{code:'ENOENT'});
    const before=await readFile(auditPath,'utf8');
    const first=await importFeasibilityEvidence({auditPath,runtimeDirectory:runtime}),second=await importFeasibilityEvidence({auditPath,runtimeDirectory:runtime});
    assert.deepEqual(first.jobs,second.jobs);assert.equal(await readFile(auditPath,'utf8'),before);
    const store=await new RuntimeStore(runtime).init();assert.equal(store.runs.length,170);assert.equal(store.evaluations.length,3);
    assert.ok(store.evaluations.every(job=>job.status==='interrupted'&&job.sourceAuditStatus==='partial_hardware_limited'));
  }finally{
    assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith('edge-feasibility-partial-'));
    await rm(directory,{recursive:true,force:true});
  }
});
