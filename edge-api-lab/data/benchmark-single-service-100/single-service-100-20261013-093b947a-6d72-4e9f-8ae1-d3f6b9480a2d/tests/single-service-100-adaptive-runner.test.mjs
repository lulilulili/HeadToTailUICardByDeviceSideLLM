import test from 'node:test';
import assert from 'node:assert/strict';
import * as runner from '../scripts/benchmark-single-service-100.mjs';
import {singleService100Plan,SINGLE_SERVICE_100_MODELS as models} from '../src/single-service-100.mjs';

const options={num_ctx:2048,num_predict:224,timeoutMs:180000,temperature:0};
const manifest={version:'single-service-100-batch-v3',conditions:{mode:'adaptive',promptVersion:'adaptive-v2',routingPolicy:'adaptive-routing-v1',models,modelOrder:models,options,totalRequests:4000,requestsPerModel:1000,totalCalls:4000,callsPerModel:1000,repeats:1},corpus:{total:1000,perDomain:100}};
const trace=(stage,raw,ms=2,patch={})=>({stage,provider:'ollama',model:models[0],raw:JSON.stringify(raw),promptVersion:'adaptive-v2',wallMs:ms,loadMs:0,promptMs:1,generationMs:1,inputTokens:10,outputTokens:2,startedAt:'2026-10-13T00:00:00.000Z',completedAt:'2026-10-13T00:00:00.002Z',...patch});
function run(overrides={}){
 return {mode:'adaptive',model:models[0],text:'查本机电量',domain:'device',api:'device.battery.level',status:'ready_mock',options,stages:{},totalMs:7,modelArguments:{},extractedArguments:{},groundedArguments:{},traces:[trace('domain',{domain:'device'}),trace('intent_arguments',{api:'device.battery.level',arguments:{}},3)],candidates:{domain:{ids:['device','unsupported']},intent_arguments:{ids:['device.battery.level']}},routing:{policy:'adaptive-routing-v1',path:'two_step',triggerReasons:[],actualCallCount:2,actualStages:['domain','intent_arguments'],skippedStages:[]},...overrides};
}
const verify=(value,chosen=manifest)=>{assert.equal(typeof runner.validateStoredBenchmarkRun,'function');return runner.validateStoredBenchmarkRun(value,{model:models[0],text:value.text,manifest:chosen,label:'adaptive-stub'});};
const record=value=>({model:models[0],caseId:'e100-device-stub',testDomain:'device',text:value.text,expected:{domain:'device',api:'device.battery.level',arguments:{},status:'ready_mock'},run:value,rawScore:{domain:true,api:true,arguments:true},execution:{domain:true,api:true,finalArguments:true,status:true,precision:true,sources:true,expectedResolverStatusMatchesGold:true,plan:true,differences:[]}});

test('CLI exposes new adaptive mode, baseline and shadow without changing old default',()=>{
 assert.equal(runner.parseBenchmarkArguments(['--new']).mode,undefined);
 assert.equal(runner.parseBenchmarkArguments(['--new','--mode','adaptive','--initialize']).mode,'adaptive');
 assert.equal(runner.parseBenchmarkArguments(['--new','--mode','adaptive','--baseline-manifest','old.json','--laya-shadow']).layaShadow,true);
 for(const args of [['--new','--mode','laya'],['--new','--mode'],['--manifest','saved','--baseline-manifest','old'],['--manifest','saved','--laya-shadow'],['--new','--laya-shadow']])assert.throws(()=>runner.parseBenchmarkArguments(args));
});

test('new batch plan binds adaptive mode prompt policy and case-request denominators',()=>{
 const plan=singleService100Plan(manifest);assert.equal(plan.mode,'adaptive');assert.equal(plan.totalRequests,4000);assert.equal(plan.requestsPerModel,1000);
 for(const conditions of [{...manifest.conditions,mode:'laya'},{...manifest.conditions,promptVersion:'explicit-v8-cloud'},{...manifest.conditions,routingPolicy:'unknown'},{...manifest.conditions,totalRequests:8000}])assert.throws(()=>singleService100Plan({...manifest,conditions}));
 assert.equal(singleService100Plan({...manifest,version:'single-service-100-batch-v2',conditions:{...manifest.conditions,mode:undefined}}).mode,'unified');
});

test('stored adaptive two-step and three-step paths are accepted with exact frozen models',()=>{
 assert.equal(verify(run()),true);
 const traces=[trace('domain',{domain:'calendar'}),trace('intent',{api:'calendar.update'}),trace('arguments',{event_id:'ev_7',changes:{title:'设计评审',location:'A室'}})];
 const three=run({text:'修改日程 ev_7，标题为设计评审，地点为A室',domain:'calendar',api:'calendar.update',traces,routing:{policy:'adaptive-routing-v1',path:'three_step',triggerReasons:['multi_field_write'],actualCallCount:3,actualStages:traces.map(t=>t.stage),skippedStages:[]}});
 assert.equal(verify(three),true);
});

test('stored adaptive rejects extra calls foreign providers and stage overrides',()=>{
 for(const patch of [{mode:'unified'},{stages:{domain:{provider:'ollama'}}},{traces:[trace('domain',{domain:'device'},{},{provider:'laya'})]},{traces:[trace('domain',{domain:'device'},2,{model:models[1]})]},{traces:[trace('domain',{}),trace('intent_arguments',{}),trace('arguments',{})]},{routing:{...run().routing,actualCallCount:3}}])assert.throws(()=>verify(run(patch)));
});

test('stored adaptive accepts visible failure prefixes and early unsupported without inventing later stages',()=>{
 const failed=run({status:'error',error:'bad JSON',domain:null,api:null,traces:[trace('domain',{},2,{error:'bad JSON'})],routing:{...run().routing,actualCallCount:1,actualStages:['domain']}});
 assert.equal(verify(failed),true);
 const declined=run({status:'unsupported',domain:'unsupported',api:null,traces:[trace('domain',{domain:'unsupported'})],routing:{...run().routing,actualCallCount:1,actualStages:['domain']}});
 assert.equal(verify(declined),true);
 const cancelled=run({status:'cancelled',domain:'device',api:null,traces:[trace('domain',{domain:'device'})],routing:{...run().routing,actualCallCount:1,actualStages:['domain']}});
 assert.equal(verify(cancelled),true);
});

test('stored complex no-input skip requires the explicit skip reason',()=>{
 const traces=[trace('domain',{domain:'device'}),trace('intent',{api:'device.battery.level'})];
 const skipped=run({text:'查本机电量，返回 JSON {}',traces,routing:{policy:'adaptive-routing-v1',path:'three_step',triggerReasons:['explicit_json'],actualCallCount:2,actualStages:traces.map(t=>t.stage),skippedStages:[{stage:'arguments',reason:'api_has_no_inputs'}]}});
 assert.equal(verify(skipped),true);
 assert.throws(()=>verify({...skipped,routing:{...skipped.routing,skippedStages:[]}}));
});

test('legacy unified still requires a single unified trace',()=>{
 const chosen={...manifest,version:'single-service-100-batch-v2',conditions:{...manifest.conditions,mode:undefined,promptVersion:'explicit-v8-cloud'}};
 const unified=run({mode:'unified',traces:[trace('unified',{domain:'device',api:'device.battery.level',arguments:{}},2,{promptVersion:'explicit-v8-cloud'})],routing:undefined});
 assert.equal(verify(unified,chosen),true);assert.throws(()=>verify({...unified,traces:[...unified.traces,...unified.traces]},chosen));
});

test('adaptive compact records aggregate all calls and read the actual API decision trace',()=>{
 const result=runner.compactRecord(record(run()));
 assert.equal(result.actualCallCount,2);assert.equal(result.modelCallMs,5);assert.equal(result.wallMs,7);assert.equal(result.inputTokens,20);assert.equal(result.outputTokens,4);
 assert.equal(result.parsedApiCorrect,true);assert.equal(result.candidateRecall,true);assert.equal(result.candidateRecallEligible,true);assert.equal(result.domainGateMiss,false);assert.equal(result.retrievalMiss,false);
 assert.deepEqual(result.traceTimings.map(t=>t.stage),['domain','intent_arguments']);assert.equal(result.performance.promptMs,2);assert.equal(result.routing.path,'two_step');
});

test('later stage errors truncation and unknown timing do not masquerade as complete totals',()=>{
 const value=run();value.traces[1]={...value.traces[1],error:'timeout',errorType:'TimeoutError',wallMs:null,inputTokens:null,truncated:true};value.error='timeout';value.status='error';
 const result=runner.compactRecord(record(value));assert.equal(result.providerError,true);assert.equal(result.errorType,'TimeoutError');assert.equal(result.truncated,true);assert.equal(result.modelCallMs,null);assert.equal(result.inputTokens,null);assert.deepEqual(result.modelCallMsCoverage,{known:1,total:2});
});

test('wrong domain blocking an API is distinct from correct-domain budget omission',()=>{
 const wrong=run({domain:'calendar',api:'calendar.search',traces:[trace('domain',{domain:'calendar'}),trace('intent_arguments',{api:'calendar.search',arguments:{}})],candidates:{intent_arguments:{ids:['calendar.search']}}});
 const wrongRow=runner.compactRecord(record(wrong));assert.equal(wrongRow.domainGateMiss,true);assert.equal(wrongRow.candidateRecallEligible,false);assert.equal(wrongRow.retrievalMiss,false);
 const missing=run({api:'device.info.device_type',candidates:{intent_arguments:{ids:['device.info.device_type']}}});
 const missingRow=runner.compactRecord(record(missing));assert.equal(missingRow.domainGateMiss,false);assert.equal(missingRow.candidateRecallEligible,true);assert.equal(missingRow.retrievalMiss,true);
});

test('shadow comparisons remain outside the authoritative primary trace aggregates',()=>{
 const value=record(run());value.shadow={policy:'same-candidates-qwen-authoritative-v1',decisions:[{stage:'domain'}],combinedWallMs:11,drainMs:4};
 const compact=runner.compactRecord(value);assert.deepEqual(compact.shadow,value.shadow);assert.equal(compact.actualCallCount,2);assert.equal(compact.modelCallMs,5);
});

test('resume locks explicit mode and keeps historical inferred unified compatibility',()=>{
 const chosen={...manifest,corpus:{...manifest.corpus,sha256:'corpus',caseOrder:['c1']},conditions:{...manifest.conditions,sourceHashes:{a:'h'},modelDetails:models.map(name=>({name,digest:name}))}};
 const frozen={models,sourceHashes:{a:'h'},corpusHash:'corpus',caseOrder:['c1'],modelDetails:chosen.conditions.modelDetails,mode:'adaptive'};
 assert.equal(runner.validateResumeManifest(chosen,frozen),true);assert.throws(()=>runner.validateResumeManifest(chosen,{...frozen,mode:'unified'}));
});

test('benchmark provider wrapper records measured start/end on success and failure',async()=>{
 assert.equal(typeof runner.withBenchmarkCallTiming,'function');
 const success=runner.withBenchmarkCallTiming({async invoke(){return {value:{domain:'device'},trace:{stage:'domain',wallMs:2}}}});
 const result=await success.invoke({stage:'domain'});assert.ok(Number.isFinite(Date.parse(result.trace.startedAt)));assert.ok(Number.isFinite(Date.parse(result.trace.completedAt)));assert.ok(result.trace.completedAt>=result.trace.startedAt);
 const failure=runner.withBenchmarkCallTiming({async invoke(){const error=new Error('bad');error.trace={stage:'domain',error:'bad',wallMs:2};throw error}});
 await assert.rejects(failure.invoke({stage:'domain'}),error=>Number.isFinite(Date.parse(error.trace.startedAt))&&Number.isFinite(Date.parse(error.trace.completedAt)));
});

test('request execution uses frozen mode and drains shadow outside the primary run',async()=>{
 assert.equal(typeof runner.executeBenchmarkRequest,'function');
 const value=run(),calls=[],expected={domain:'device',api:'device.battery.level'};
 const observer={providers:{},beginCase(input){calls.push(['begin',input]);},async finishCase(input){calls.push(['finish',input]);return {primaryWallMs:input.run.totalMs,combinedWallMs:12,drainMs:5}}};
 const result=await runner.executeBenchmarkRequest({text:value.text,model:models[0],mode:'adaptive',context:{now:'fixed'},options},{providers:{},shadowObserver:observer,expected,pipeline:async(input)=>{assert.equal(input.mode,'adaptive');assert.deepEqual(input.options,options);assert.equal(input.expected,undefined);calls.push(['pipeline']);return value}});
 assert.equal(result.run,value);assert.equal(result.run.totalMs,7);assert.equal(result.shadow.combinedWallMs,12);
 assert.deepEqual(calls.map(call=>call[0]),['begin','pipeline','finish']);assert.equal(calls[0][1].expected,undefined);assert.equal(calls[2][1].expected,expected);
});

test('request execution retains cancelled partial runs and still settles the shadow',async()=>{
 assert.equal(typeof runner.executeBenchmarkRequest,'function');let finished=false;
 const partial=run({status:'cancelled'});
 const result=await runner.executeBenchmarkRequest({text:partial.text,model:models[0],mode:'adaptive',context:{},options},{providers:{},pipeline:async()=>{const error=new Error('cancelled');error.partialRun=partial;throw error;},shadowObserver:{providers:{},beginCase(){},async finishCase({run}){finished=true;assert.equal(run,partial);return {decisions:[]}}}});
 assert.equal(result.run,partial);assert.equal(finished,true);
});

test('resuming closes stale execution windows at the last saved heartbeat rather than including downtime',()=>{
 assert.equal(typeof runner.closeUnfinishedExecutionWindows,'function');
 const saved={updatedAt:'2026-10-13T01:00:10.000Z',executionWindows:[{startedAt:'2026-10-13T01:00:00.000Z'}],modelExecutionWindows:[{model:models[0],startedAt:'2026-10-13T01:00:00.000Z'}]};
 runner.closeUnfinishedExecutionWindows(saved);
 assert.equal(saved.executionWindows[0].endedAt,saved.updatedAt);assert.equal(saved.modelExecutionWindows[0].endedAt,saved.updatedAt);assert.equal(saved.executionWindows[0].endedAtBasis,'last_saved_heartbeat');
});

test('an API refusal does not turn a correctly selected domain into a domain-gate miss',()=>{
 const value=run({domain:'unsupported',api:null,status:'unsupported',traces:[trace('domain',{domain:'device'}),trace('intent_arguments',{api:'unsupported',arguments:{}})]});
 const row=runner.compactRecord(record(value));assert.equal(row.selectedDomain,'device');assert.equal(row.domainGateMiss,false);assert.equal(row.candidateRecallEligible,true);assert.equal(row.domainSelectionCorrect,true);
 const broken=run({domain:null,api:null,status:'error',error:'timeout',traces:[trace('domain',{},2,{error:'timeout'})],candidates:{}});
 assert.equal(runner.compactRecord(record(broken)).domainGateMiss,false);
});

test('modern stored runs reject negative nonfinite and missing measured wall times',()=>{
 for(const value of [-1,NaN,Infinity,null,undefined]){
  const invalid=run();invalid.traces[0].wallMs=value;assert.throws(()=>verify(invalid));
 }
 for(const value of [-1,NaN,Infinity,null,undefined])assert.throws(()=>verify(run({totalMs:value})));
});

test('modern stored runs reject a successful status with a failed primary trace',()=>{
 const value=run();value.traces[1].error='schema failure';assert.throws(()=>verify(value));
});

test('resume rechecks the entire frozen comparison baseline without rewriting it',async()=>{
 assert.equal(typeof runner.verifyFrozenComparisonBaseline,'function');
 const baseline={id:'old',sourcePath:'evidence/old/public-manifest.json',summary:{plan:7}};
 const chosen={...manifest,comparisonBaseline:baseline,corpus:{...manifest.corpus,sha256:'corpus',caseOrder:['c1']},conditions:{...manifest.conditions,modelDetails:models.map(name=>({name,digest:name})),context:{now:'fixed'}}};
 let input;await runner.verifyFrozenComparisonBaseline(chosen,{loader:async request=>{input=request;return structuredClone(baseline)}});
 assert.equal(input.manifestPath,baseline.sourcePath);assert.equal(input.corpusHash,'corpus');assert.deepEqual(input.options,options);assert.deepEqual(input.context,{now:'fixed'});
 await assert.rejects(runner.verifyFrozenComparisonBaseline(chosen,{loader:async()=>({...baseline,summary:{plan:8}})}));
 assert.equal(await runner.verifyFrozenComparisonBaseline({...manifest},{loader:async()=>{throw new Error('must not load')}}),true);
});

test('registered warmup restore validates timing context and secondary policy',()=>{
 assert.equal(typeof runner.validateSavedBenchmarkWarmup,'function');
 const chosen={...manifest,conditions:{...manifest.conditions,context:{now:'fixed'}}};
 const value=run({text:'手机还剩多少电',context:{now:'fixed'}}),item={model:models[0],excludedFromScores:true,status:value.status,totalMs:value.totalMs,actualCallCount:2,modelCallMs:5};
 assert.equal(runner.validateSavedBenchmarkWarmup(value,item,chosen),true);
 for(const patch of [{context:{}},{shadow:{policy:'unexpected'}},{totalMs:-1}])assert.throws(()=>runner.validateSavedBenchmarkWarmup({...value,...patch},item,chosen));
 assert.throws(()=>runner.validateSavedBenchmarkWarmup(value,{...item,actualCallCount:3},chosen));
});
