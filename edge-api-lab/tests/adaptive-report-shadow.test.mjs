import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSingleService100Report} from '../src/single-service-100-report.mjs';
import {SINGLE_SERVICE_100_MODELS as models} from '../src/single-service-100.mjs';

const policy='parallel-shadow-qwen-authority';
const metric=(correct,total)=>({correct,total,accuracy:total?correct/total:null});
const outcome=(selected,patch={})=>({selected,selectionCorrect:true,contractValid:true,wallMs:10,error:null,...patch});
const domain=(patch={})=>({stage:'domain',primaryStage:'domain',candidateIds:['weather','files'],answerKey:'domain',expected:'weather',expectedInCandidates:true,primary:outcome('weather'),laya:outcome('weather',{wallMs:3}),agreement:true,...patch});
const api=(patch={})=>({stage:'intent',primaryStage:'intent_arguments',candidateIds:['weather.current.humidity'],domain:'weather',answerKey:'api',expected:'weather.current.humidity',expectedInCandidates:true,primary:outcome('weather.current.humidity',{wallMs:30}),laya:outcome('weather.current.humidity',{wallMs:5}),agreement:true,...patch});
function row(patch={}){return {model:models[0],testDomain:'weather',caseId:'case-1',origin:'test-only',primary:'correct',candidateRecall:true,
 rawScore:{domain:true,api:true,arguments:true},execution:{plan:true,expectedResolverStatusMatchesGold:true,finalArguments:true},
 wallMs:45,actualCallCount:2,modelCallMs:40,traceTimings:[{stage:'domain',wallMs:10,error:null},{stage:'intent_arguments',wallMs:30,error:null}],
 shadow:{policy,decisions:[domain(),api()],combinedWallMs:50,drainMs:5,primaryWallMs:45,startedAt:'2026-10-13T02:00:00Z'},...patch};}
const manifest=(patch={})=>({id:'adaptive-shadow-test',suite:'single-service-100-v1',status:'running',createdAt:'2026-10-13T02:00:00Z',conditions:{models,mode:'adaptive',shadow:{policy}},corpus:{total:1000,perDomain:100},...patch});

test('shadow choices are separate from authoritative Qwen plan metrics and timings',()=>{
 const input=row({rawScore:{domain:true,api:false,arguments:false},execution:{plan:false},shadow:{...row().shadow,decisions:[domain(),api({primary:outcome('weather.current.humidity',{wallMs:30,contractValid:false,error:'argument schema invalid'})})]}});
 const report=buildSingleService100Report(manifest(),[input]);
 assert.equal(report.cells[0].api.correct,0); assert.equal(report.cells[0].semantics.correct,0);
 assert.equal(report.totalTiming.actualCallCount,2); assert.equal(report.totalTiming.modelCallTotalMs,40);
 const shadow=report.shadowComparison.cells[0];
 assert.deepEqual(shadow.api.all.primary.selection,metric(1,1));
 assert.deepEqual(shadow.api.all.primary.contract,metric(0,1));
 assert.deepEqual(shadow.api.all.laya.selection,metric(1,1));
 assert.equal(shadow.api.primaryTiming.totalMs,30); assert.equal(shadow.api.layaTiming.totalMs,5);
 assert.equal(shadow.api.primaryTiming.errors,1); assert.deepEqual(shadow.api.primaryStages,['intent_arguments']);
 assert.equal(report.shadowComparison.combinedRequestTiming.totalMs,50);
 assert.equal(report.shadowComparison.drainTiming.totalMs,5);
});

test('given-domain API choice with unavailable gold remains in all results but not eligible accuracy',()=>{
 const second=row({caseId:'case-2',shadow:{...row().shadow,decisions:[domain({primary:outcome('files',{selectionCorrect:false}),agreement:false}),api({domain:'files',expectedInCandidates:false,candidateIds:['files.metadata.size'],primary:outcome('files.metadata.size',{selectionCorrect:false}),laya:outcome('files.metadata.size',{selectionCorrect:false})})]}});
 const result=buildSingleService100Report(manifest(),[row(),second]).shadowComparison.cells[0];
 assert.deepEqual(result.api.all.laya.selection,metric(1,2));
 assert.deepEqual(result.api.eligible.laya.selection,metric(1,1));
 assert.equal(result.api.coverage.observed,2); assert.equal(result.api.coverage.eligible,1);
 assert.equal(result.api.coverage.requests,2); assert.equal(result.api.coverage.planned,100);
});

test('a skipped API stage never becomes a correct Laya downstream decision',()=>{
 const input=row({shadow:{...row().shadow,decisions:[domain({primary:outcome('unsupported',{selectionCorrect:false}),agreement:false})]}});
 const result=buildSingleService100Report(manifest(),[input]).shadowComparison.cells[0];
 assert.deepEqual(result.domain.all.laya.selection,metric(1,1));
 assert.deepEqual(result.api.all.laya.selection,metric(0,1));
 assert.deepEqual(result.api.observed.laya.selection,metric(0,0));
 assert.equal(result.api.coverage.missing,1); assert.equal(result.api.layaTiming.calls,0);
});

test('unknown shadow elapsed time is not replaced with Qwen or another stage duration',()=>{
 const input=row({shadow:{...row().shadow,combinedWallMs:null,drainMs:null,decisions:[domain({laya:outcome('weather',{wallMs:null})}),api()]}});
 const result=buildSingleService100Report(manifest(),[input]).shadowComparison;
 assert.equal(result.combinedRequestTiming.totalMs,null); assert.equal(result.drainTiming.totalMs,null);
 assert.equal(result.cells[0].domain.layaTiming.totalMs,null); assert.equal(result.cells[0].domain.layaTiming.p50Ms,null);
});

test('historical absence of shadow evidence stays unknown rather than a fabricated comparison',()=>{
 const input=row(); delete input.shadow;
 const oldManifest=manifest(); delete oldManifest.conditions.shadow;
 assert.equal(buildSingleService100Report(oldManifest,[input]).shadowComparison,null);
 const expected=buildSingleService100Report(manifest(),[input]).shadowComparison;
 assert.equal(expected.observedRequests,0); assert.equal(expected.cells[0].domain.all.laya.selection.accuracy,null);
});

test('queued real runner layaShadow condition declares comparison before any records exist',()=>{
 const input=manifest({status:'queued',conditions:{models,mode:'adaptive',layaShadow:{enabled:true,policy}}});
 const result=buildSingleService100Report(input,[]).shadowComparison;
 assert.ok(result); assert.equal(result.policy,policy); assert.equal(result.observedRequests,0);
 assert.equal(result.domain.all.laya.selection.accuracy,null);
 assert.equal(result.api.all.laya.selection.accuracy,null);
 assert.equal(result.combinedRequestTiming.totalMs,null);
 assert.equal(result.summary.length,4); assert.equal(result.cells.length,40);
});

test('model/domain shadow scopes preserve task and CPU competition caveats without changing data',()=>{
 const input=manifest(),rows=[row(),row({caseId:'other-model',model:models[1],testDomain:'files'})],before=structuredClone({input,rows});
 const report=buildSingleService100Report(input,rows),comparison=report.shadowComparison;
 assert.equal(comparison.summary.length,4); assert.equal(comparison.cells.length,40);
 assert.equal(comparison.summary[0].observedRequests,1); assert.equal(comparison.summary[1].observedRequests,1);
 assert.match(comparison.notes.join(' '),/Qwen.*领域|领域.*Qwen/);
 assert.match(comparison.notes.join(' '),/参数/); assert.match(comparison.notes.join(' '),/CPU/);
 assert.deepEqual({input,rows},before);
});
