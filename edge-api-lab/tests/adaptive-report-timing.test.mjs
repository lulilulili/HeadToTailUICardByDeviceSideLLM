import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSingleService100Report,cellSummary} from '../src/single-service-100-report.mjs';
import {SINGLE_SERVICE_100_MODELS as models,SINGLE_SERVICE_100_DOMAINS as domains} from '../src/single-service-100.mjs';

const corpusSha256='a'.repeat(64);
const pass={domain:true,api:true,arguments:true};
const final={plan:true,expectedResolverStatusMatchesGold:true,finalArguments:true};
const trace=(stage,wallMs,patch={})=>({stage,provider:'ollama',model:models[0],wallMs,error:null,loadMs:1,promptMs:2,generationMs:3,inputTokens:4,outputTokens:5,...patch});
function row(patch={}) {
  return {model:models[0],testDomain:'weather',caseId:'case-1',origin:'test-only',primary:'correct',error:null,
    expectedStatus:'ready_mock',status:'ready_mock',candidateRecall:true,candidateRecallEligible:true,domainGateMiss:false,
    wallMs:20,actualCallCount:2,modelCallMs:15,traceTimings:[trace('domain',5),trace('intent_arguments',10)],
    rawScore:pass,execution:final,...patch};
}
const metric=(correct,total)=>({correct,total,accuracy:total?correct/total:null});
const cell=(rows,planned=100)=>cellSummary(rows,{model:models[0],testDomain:'weather',planned});
const manifest=(patch={})=>({id:'new-adaptive',suite:'single-service-100-v1',status:'running',createdAt:'2026-10-12T00:00:00Z',updatedAt:'2026-10-13T01:10:00Z',
  conditions:{models,mode:'adaptive'},corpus:{total:1000,perDomain:100,sha256:corpusSha256},...patch});
function baseline(patch={}) {
  const base=(model,testDomain,total)=>({model,testDomain,total,planned:total,complete:true,domain:metric(total,total),api:metric(total/2,total),rawArguments:metric(total/2,total),semantics:metric(total*.4,total),p50Ms:10,p95Ms:10,timing:{requestMeanMs:10,requestTotalMs:total*10}});
  return {id:'old-unified',reportSha256:'b'.repeat(64),corpusSha256,conditions:{mode:'unified',models},
    summary:models.map(model=>base(model,null,1000)),cells:models.flatMap(model=>domains.map(domain=>base(model,domain,100))),...patch};
}

test('request accuracy denominators and model-call timings stay separate across two and three stages',()=>{
  const result=cell([row({wallMs:30}),row({caseId:'case-2',wallMs:50,actualCallCount:3,modelCallMs:40,traceTimings:[trace('domain',7),trace('intent',13,{error:'failed'}),trace('arguments',20)],rawScore:{...pass,api:false},execution:{...final,plan:false}})]);
  assert.equal(result.api.total,2); assert.equal(result.api.correct,1);
  assert.equal(result.timing.requestTotalMs,80); assert.equal(result.timing.requestMeanMs,40);
  assert.equal(result.timing.actualCallCount,5); assert.equal(result.timing.meanCalls,2.5);
  assert.equal(result.timing.modelCallTotalMs,55); assert.equal(result.timing.knownRequests,2);
  assert.equal(result.timing.complete,true);
  const domain=result.timing.stages.find(stage=>stage.stage==='domain');
  assert.deepEqual({calls:domain.calls,totalMs:domain.totalMs,meanMs:domain.meanMs,p50Ms:domain.p50Ms,p95Ms:domain.p95Ms,errors:domain.errors},{calls:2,totalMs:12,meanMs:6,p50Ms:7,p95Ms:7,errors:0});
  assert.equal(result.timing.stages.find(stage=>stage.stage==='intent').errors,1);
  assert.equal(result.timing.stages.find(stage=>stage.stage==='arguments').inputTokens,4);
});

test('historical rows retain observed request time but unknown multi-call metrics are never invented',()=>{
  const old=row(); delete old.traceTimings; delete old.actualCallCount; delete old.modelCallMs;
  delete old.domainGateMiss; delete old.candidateRecallEligible;
  const result=cell([old]);
  assert.equal(result.p50Ms,20); assert.equal(result.timing.requestTotalMs,20);
  assert.equal(result.timing.actualCallCount,null); assert.equal(result.timing.meanCalls,null);
  assert.equal(result.timing.modelCallTotalMs,null); assert.equal(result.timing.complete,false);
  assert.equal(result.timing.knownRequests,0); assert.deepEqual(result.timing.stages,[]);
  assert.equal(result.domainGateMiss,null); assert.equal(result.budgetRecallMisses,null);
});

test('unknown call duration or missing request duration does not become zero or a complete aggregate',()=>{
  const result=cell([row({wallMs:null,modelCallMs:null,traceTimings:[trace('domain',5),trace('intent_arguments',null)]})]);
  assert.equal(result.timing.requestMeanMs,null); assert.equal(result.timing.requestTotalMs,null);
  assert.equal(result.timing.actualCallCount,2); assert.equal(result.timing.modelCallTotalMs,null);
  assert.equal(result.timing.stages.find(stage=>stage.stage==='intent_arguments').totalMs,null);
  assert.equal(result.timing.stages.find(stage=>stage.stage==='intent_arguments').meanMs,null);
});

test('wrong-domain gating and recall misses after a correct domain have distinct denominators',()=>{
  const result=cell([row({domainGateMiss:true,candidateRecallEligible:false,candidateRecall:false}),row({caseId:'case-2',candidateRecall:false}),row({caseId:'case-3'})]);
  assert.equal(result.domainGateMiss,1); assert.equal(result.budgetRecallMisses,1);
  assert.deepEqual(result.candidateRecallEligible,metric(1,2));
  assert.equal(result.retrievalMisses,2); // Original legacy all-case diagnostic stays compatible.
});

test('batch clock uses actual execution windows and frozen heartbeat rather than queued creation time',()=>{
  const input=manifest({executionWindows:[{startedAt:'2026-10-13T01:00:00Z',endedAt:'2026-10-13T01:05:00Z'},{startedAt:'2026-10-13T01:08:00Z'}],warmups:[{totalMs:120,actualCallCount:2,modelCallMs:110}]});
  const report=buildSingleService100Report(input,[row()]);
  assert.equal(report.executionElapsed.elapsedMs,420000);
  assert.equal(report.executionElapsed.asOf,input.updatedAt);
  assert.equal(report.executionElapsed.source,'manifest.executionWindows');
  assert.equal(report.executionElapsed.includesWarmups,true);
  assert.equal(report.totalTiming.requestTotalMs,20); assert.equal(report.metrics.completedRequests,1);
  assert.equal(report.metrics.plannedRequests,4000); assert.equal(report.metrics.actualCallCount,2);
  assert.equal(report.warmupTiming.requestTotalMs,120); assert.equal(report.warmupTiming.actualCallCount,2);
  assert.equal(report.warmupTiming.excludedFromFormal,true);
});

test('unknown or overlapping execution windows cannot claim a valid batch duration',()=>{
  assert.equal(buildSingleService100Report(manifest(),[]).executionElapsed.elapsedMs,null);
  const input=manifest({executionWindows:[{startedAt:'2026-10-13T01:00:00Z',endedAt:'2026-10-13T01:05:00Z'},{startedAt:'2026-10-13T01:03:00Z',endedAt:'2026-10-13T01:06:00Z'}]});
  assert.equal(buildSingleService100Report(input,[]).executionElapsed.elapsedMs,null);
});

test('partial current cell displays full baseline but never a paired accuracy or latency delta',()=>{
  const report=buildSingleService100Report(manifest({comparisonBaseline:baseline()}),Array.from({length:99},(_,i)=>row({caseId:`case-${i}`})));
  const pair=report.baselineComparison.cells[0];
  assert.equal(pair.current.total,99); assert.equal(pair.baseline.total,100);
  assert.equal(pair.paired,false); assert.equal(pair.delta,null);
  assert.equal(report.baselineComparison.id,'old-unified');
  assert.equal(report.baselineComparison.reportSha256,'b'.repeat(64));
  assert.match(report.baselineComparison.notes.join(' '),/提示|候选/);
});

test('only fully paired same-corpus scopes receive deltas including request means and totals',()=>{
  const rows=Array.from({length:100},(_,i)=>row({caseId:`case-${i}`,execution:{...final,plan:i<60}}));
  const report=buildSingleService100Report(manifest({comparisonBaseline:baseline()}),rows);
  const pair=report.baselineComparison.cells[0];
  assert.equal(pair.paired,true); assert.ok(Math.abs(pair.delta.semantics-.2)<1e-12);
  assert.equal(pair.delta.requestMeanMs,10); assert.equal(pair.delta.requestTotalMs,1000);
  assert.equal(pair.delta.p50Ms,10); assert.equal(pair.delta.p95Ms,10);
  assert.equal(report.baselineComparison.summary[0].paired,false);
});

test('different corpus or duplicate case keys cannot masquerade as a paired full cell',()=>{
  const rows=Array.from({length:100},(_,i)=>row({caseId:`case-${i}`}));
  const wrong=buildSingleService100Report(manifest({comparisonBaseline:baseline({corpusSha256:'c'.repeat(64)})}),rows);
  assert.equal(wrong.baselineComparison.cells[0].paired,false); assert.equal(wrong.baselineComparison.cells[0].delta,null);
  const duplicate=buildSingleService100Report(manifest({comparisonBaseline:baseline()}),rows.map(r=>({...r,caseId:'duplicate'})));
  assert.equal(duplicate.baselineComparison.cells[0].paired,false);
});

test('model digest mismatch is visible and prevents claiming a paired comparison',()=>{
  const old=baseline(); old.conditions.modelDetails=[{name:models[0],digest:'old'}];
  const input=manifest({comparisonBaseline:old}); input.conditions.modelDetails=[{name:models[0],digest:'new'}];
  const report=buildSingleService100Report(input,Array.from({length:100},(_,i)=>row({caseId:`case-${i}`})));
  assert.equal(report.baselineComparison.cells[0].paired,false);
  assert.match(report.baselineComparison.cells[0].reason,/digest/);
});

test('no injected baseline remains absent and report derivation does not modify source data',()=>{
  const input=manifest(),rows=[row()],before=structuredClone({input,rows});
  const report=buildSingleService100Report(input,rows);
  assert.equal(report.baselineComparison,null);
  assert.deepEqual({input,rows},before);
});
