import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {buildSingleService100Report,cellSummary,primaryFailure} from '../src/single-service-100-report.mjs';
import {loadSingleService100Cases,SINGLE_SERVICE_100_MODELS as models,SINGLE_SERVICE_100_DOMAINS as domains,SINGLE_SERVICE_100_SUITE as suite} from '../src/single-service-100.mjs';
import {compactRecord,orderedCases,validateSuite,modelKey} from '../scripts/benchmark-single-service-100.mjs';
import {getCapability,validateArguments} from '../src/registry.mjs';

// Synthetic rows test report accounting. Corpus checks read hand-authored gold only.
// Importing the guarded CLI does not run main(), make model calls, or write evidence.
const root=fileURLToPath(new URL('..',import.meta.url));
const cases=await loadSingleService100Cases(root);
const original='previous-100-development',fresh='new-900-fixed-before-inference';
const rawPass={domain:true,api:true,arguments:true,plan:true};
const finalPass={domain:true,api:true,finalArguments:true,status:true,precision:true,sources:true,expectedResolverStatusMatchesGold:true,plan:true};
function row(patch={}){
 const value={model:models[0],testDomain:'weather',caseId:'synthetic',origin:fresh,
  expectedStatus:'ready_mock',status:'ready_mock',candidateRecall:true,parsedApiCorrect:true,
  error:null,providerError:false,errorType:null,truncated:false,wallMs:10,inputTokens:100,
  contractBoundary:null,differences:[],...patch,
  rawScore:{...rawPass,...patch.rawScore},execution:{...finalPass,...patch.execution}};
 value.primary=primaryFailure(value);return value;
}
const manifest=(patch={})=>({id:'report-contract-only',suite,status:'running',createdAt:'2026-10-11T00:00:00Z',
 conditions:{models},corpus:{total:1000,perDomain:100,original:100,new:900},sourceSnapshot:'synthetic-no-model-call',...patch});
const summarize=rows=>cellSummary(rows,{model:models[0],testDomain:'weather',planned:100});
const metric=(correct,total)=>({correct,total,accuracy:total?correct/total:null});
function record(patch={}){
 const expected={domain:'weather',api:cases.find(c=>c.testDomain==='weather').expected.api,arguments:{},status:'ready_mock'};
 const baseline={model:models[0],caseId:'synthetic-weather',testDomain:'weather',scenario:'report-only',
  text:'报告契约测试，不调用模型',origin:fresh,expected,rawScore:{...rawPass},execution:{...finalPass,differences:[]},
  run:{domain:expected.domain,api:expected.api,status:'ready_mock',modelArguments:{},extractedArguments:{},groundedArguments:{},
   candidates:{unified:{ids:[expected.api]}},totalMs:11,
   traces:[{raw:JSON.stringify({domain:expected.domain,api:expected.api,arguments:{}}),inputTokens:90,outputTokens:30,error:false}]}};
 return {...baseline,...patch,rawScore:{...baseline.rawScore,...patch.rawScore},
  execution:{...baseline.execution,...patch.execution},run:{...baseline.run,...patch.run}};
}

test('empty reports keep null accuracies and fixed planned denominators, not zero percent',()=>{
 const result=buildSingleService100Report(manifest({warmups:[{model:models[0]}]}),[]);
 assert.deepEqual(result.progress,{done:0,total:4000});assert.equal(result.warmupCount,1);
 assert.equal(result.summary.length,4);assert.equal(result.cells.length,40);
 assert.deepEqual(result.summary.map(c=>c.model),models);
 for(const cell of [...result.summary,...result.cells]){
  assert.equal(cell.planned,cell.testDomain===null?1000:100);assert.equal(cell.total,0);assert.equal(cell.complete,false);
  for(const key of ['domain','api','rawArguments','semantics','candidateRecall','parsedApi','readyRequestSemantics','safeNonReady'])
   assert.deepEqual(cell[key],metric(0,0),key);
  for(const key of ['p50Ms','p95Ms','maxInputTokens'])assert.equal(cell[key],null,key);
  assert.equal(cell.providerErrors,0);assert.equal(cell.ruleErrors,0);assert.deepEqual(cell.origins,[]);
 }
 assert.deepEqual(result.examples,[]);
});

test('partial rates use completed calls including failures while planned counts remain 1000 and 100',()=>{
 const rows=[row(),row({caseId:'failed',error:'bad schema',providerError:true,
  rawScore:{domain:false,api:false,arguments:false},execution:{plan:false}})];
 const result=buildSingleService100Report(manifest(),rows),model=result.summary[0],cell=result.cells[0];
 assert.deepEqual(result.progress,{done:2,total:4000});
 assert.equal(model.planned,1000);assert.equal(cell.planned,100);assert.equal(model.total,2);assert.equal(cell.total,2);
 assert.equal(model.complete,false);assert.deepEqual(model.api,metric(1,2));assert.deepEqual(model.semantics,metric(1,2));
 assert.deepEqual(result.summary[1].api,metric(0,0));assert.deepEqual(result.cells[1].api,metric(0,0));
 assert.equal(model.providerErrors,1);assert.equal(model.ruleErrors,0);
});

test('completion is separate from correctness and requires the entire planned cell/model',()=>{
 const hundred=Array.from({length:100},(_,index)=>row({caseId:`complete-${index}`,rawScore:{api:index<50}}));
 const cell=summarize(hundred);assert.equal(cell.complete,true);assert.deepEqual(cell.api,metric(50,100));
 assert.equal(summarize(hundred.slice(0,99)).complete,false);
 const thousand=domains.flatMap(testDomain=>hundred.map(r=>({...r,testDomain})));
 const result=buildSingleService100Report(manifest({status:'partial'}),thousand);
 assert.equal(result.summary[0].complete,true);assert.equal(result.summary[0].planned,1000);
 assert.equal(result.summary[1].complete,false);assert.deepEqual(result.progress,{done:1000,total:4000});
 assert.ok(result.cells.filter(c=>c.model===models[0]).every(c=>c.complete));
});

test('raw argument and final execution metrics stay independent and repairs are not model gains',()=>{
 const rows=[row(),row({rawScore:{arguments:false}}),
  row({execution:{finalArguments:false,plan:false}}),
  row({rawScore:{arguments:false},execution:{finalArguments:false,plan:false}})];
 const cell=summarize(rows);assert.deepEqual(cell.rawArguments,metric(2,4));assert.deepEqual(cell.semantics,metric(2,4));
 assert.equal(cell.rawMismatchFinalPass,1);assert.equal(cell.rawCorrectFinalFail,1);
 assert.equal(rows[1].primary,'correct');assert.equal(rows[2].primary,'parameters');
 const repairedOnly=summarize([rows[1]]);assert.deepEqual(repairedOnly.rawArguments,metric(0,1));assert.deepEqual(repairedOnly.semantics,metric(1,1));
});

test('the actual suite separates the previous development 100 from the new fixed 900',()=>{
 assert.equal(cases.length,1000);assert.equal(cases.filter(c=>c.origin===original).length,100);
 assert.equal(cases.filter(c=>c.origin===fresh).length,900);
 for(const testDomain of domains){
  assert.equal(cases.filter(c=>c.testDomain===testDomain&&c.origin===original).length,10,testDomain);
  assert.equal(cases.filter(c=>c.testDomain===testDomain&&c.origin===fresh).length,90,testDomain);
 }
 assert.ok(cases.filter(c=>c.origin===original).every(c=>c.originCaseId));
 const cell=summarize([row({origin:original}),row({origin:fresh,rawScore:{api:false,arguments:false},execution:{plan:false}})]);
 const groups=Object.fromEntries(cell.origins.map(g=>[g.origin,g]));
 assert.deepEqual(groups[original].api,metric(1,1));assert.deepEqual(groups[fresh].api,metric(0,1));
 assert.deepEqual(groups[original].semantics,metric(1,1));assert.deepEqual(groups[fresh].rawArguments,metric(0,1));
});

test('safe refusals are separate from executable request success, with null empty strata',()=>{
 const rows=[row(),row({status:'needs_clarification',execution:{plan:false}}),
  row({expectedStatus:'needs_clarification',status:'needs_clarification'}),
  row({expectedStatus:'resolution_failed',status:'resolution_failed',contractBoundary:'user goal remains unmet',userGoalStatus:'ready_mock'})];
 const cell=summarize(rows);assert.deepEqual(cell.semantics,metric(3,4));
 assert.deepEqual(cell.readyRequestSemantics,metric(1,2));assert.deepEqual(cell.safeNonReady,metric(2,2));
 assert.equal(cell.contractBoundaryCount,1);assert.deepEqual(summarize([rows[0]]).safeNonReady,metric(0,0));
 assert.deepEqual(summarize(rows.slice(2)).readyRequestSemantics,metric(0,0));
 // The ready subset also checks actual readiness, not just the general plan flag.
 assert.deepEqual(summarize([row({status:'needs_clarification'})]).readyRequestSemantics,metric(0,1));
});

test('primary failures have one ordered cause: errors, routing, gold contract, parameters, final constraints',()=>{
 const allWrong={rawScore:{domain:false,api:false,arguments:false},execution:{expectedResolverStatusMatchesGold:false,finalArguments:false,plan:false}};
 const samples=[
  [row({...allWrong,error:'request timed out',providerError:true}),'provider_timeout'],
  [row({...allWrong,error:'network failed',providerError:true,errorType:'TimeoutError'}),'provider_timeout'],
  [row({...allWrong,error:'模型超时',providerError:true}),'provider_timeout'],
  [row({...allWrong,error:'invalid contract',providerError:true}),'provider_contract'],
  [row({...allWrong,error:'post-processing timed out',providerError:false,errorType:'TimeoutError'}),'rule_error'],
  [row(allWrong),'domain'],
  [row({...allWrong,rawScore:{domain:true,api:false}}),'api'],
  [row({execution:{expectedResolverStatusMatchesGold:false,finalArguments:false,plan:false}}),'gold_contract'],
  [row({execution:{finalArguments:false,plan:false}}),'parameters'],
  [row({execution:{plan:false}}),'status_or_constraint'],
  [row({rawScore:{arguments:false}}),'correct'],
  [row(),'correct']
 ];
 for(const [value,expected]of samples)assert.equal(primaryFailure(value),expected);
 assert.equal(primaryFailure(row({error:'historical contract failure',providerError:undefined})),'provider_contract');
});

test('provider and rule errors are counted separately while legacy rows remain provider-compatible',()=>{
 const rows=[row({error:'provider schema failed',providerError:true}),row({error:'invalid timezone',providerError:false}),
  row({error:'legacy provider record',providerError:undefined}),row({providerError:true})];
 const cell=summarize(rows);assert.equal(cell.providerErrors,2);assert.equal(cell.ruleErrors,1);
 assert.deepEqual(cell.primaryFailures,{provider_contract:2,rule_error:1,correct:1});assert.equal(cell.total,4);
});

test('parseable correct API intent is retained when the extracted argument schema fails',()=>{
 const input=record(),badArguments={__unknown_argument:true},cap=getCapability(input.expected.api);
 assert.equal(validateArguments(cap,badArguments).valid,false);
 input.run={...input.run,domain:undefined,api:undefined,status:'error',error:'Output schema invalid',
  traces:[{raw:JSON.stringify({domain:input.expected.domain,api:input.expected.api,arguments:badArguments}),error:true,errorType:'SchemaError',truncated:false}]};
 input.rawScore={domain:false,api:false,arguments:false,plan:false};input.execution={...input.execution,plan:false};
 const before=structuredClone(input),value=compactRecord(input),cell=summarize([value]);
 assert.deepEqual(input,before);assert.equal(value.parsedApiCorrect,true);assert.equal(value.candidateRecall,true);
 assert.equal(value.providerError,true);assert.equal(value.primary,'provider_contract');
 assert.deepEqual(cell.api,metric(0,1));assert.deepEqual(cell.parsedApi,metric(1,1));
 assert.equal(cell.providerErrors,1);assert.equal(cell.wrongApiWithCandidate,0);
});

test('compact records retain raw, extracted, and grounded roles without classifying rule failures as providers',()=>{
 const input=record({contractBoundary:'datetime grammar',userGoalStatus:'ready_mock',recordSha256:'test-digest',
  run:{error:'Invalid time zone',modelArguments:{timezone:'北京时间'},extractedArguments:{timezone:'北京时间'},groundedArguments:{},status:'error'},
  execution:{plan:false}}),before=structuredClone(input),value=compactRecord(input);
 assert.equal(value.providerError,false);assert.equal(value.primary,'rule_error');assert.equal(value.parsedApiCorrect,true);
 assert.deepEqual(value.modelArguments,{timezone:'北京时间'});assert.deepEqual(value.extractedArguments,{timezone:'北京时间'});
 assert.deepEqual(value.groundedArguments,{});assert.deepEqual(value.expectedArguments,{});assert.deepEqual(input,before);
 assert.equal(value.contractBoundary,'datetime grammar');assert.equal(value.userGoalStatus,'ready_mock');assert.equal(value.recordSha256,'test-digest');
 assert.equal(value.detailPath,`/api/single-service-100-run/${modelKey(models[0])}/synthetic-weather`);
 assert.equal(summarize([value]).providerErrors,0);assert.equal(summarize([value]).ruleErrors,1);
 const batchBound=compactRecord({...input,manifestId:'new-batch'});
 assert.equal(batchBound.detailPath,`/api/single-service-100-run/${modelKey(models[0])}/synthetic-weather?manifestId=new-batch`);
});

test('compact records handle unparseable raw and absent trace/candidates explicitly',()=>{
 const invalid=compactRecord(record({run:{error:'Output is not JSON',status:'error',traces:[{raw:'not JSON',error:true,errorType:'ParseError',truncated:true}]},execution:{plan:false}}));
 assert.equal(invalid.parsedApiCorrect,false);assert.equal(invalid.providerError,true);assert.equal(invalid.truncated,true);assert.equal(invalid.primary,'provider_contract');
 const absent=compactRecord(record({run:{traces:undefined,candidates:undefined,error:'Rule cannot resolve',status:'error'},execution:{plan:false}}));
 assert.equal(absent.parsedApiCorrect,false);assert.equal(absent.candidateRecall,false);assert.equal(absent.providerError,false);assert.equal(absent.primary,'rule_error');
 const timeout=compactRecord(record({run:{error:'connection interrupted',traces:[{error:true,errorType:'TimeoutError'}]},execution:{plan:false}}));
 assert.equal(timeout.primary,'provider_timeout');
});

test('retrieval misses, wrong selection with a candidate, and parameter differences are distinct diagnostics',()=>{
 const missing={kind:'missing',path:'arguments.location'},wrong={kind:'value',path:'arguments.time_ref'};
 const rows=[row({candidateRecall:false,rawScore:{api:false},differences:[missing]}),
  row({rawScore:{api:false},differences:[missing]}),
  row({error:'schema failure',providerError:true,rawScore:{api:false},differences:[missing]}),
  row({execution:{expectedResolverStatusMatchesGold:false,finalArguments:false,plan:false},differences:[missing]}),
  row({execution:{finalArguments:false,plan:false},differences:[missing,wrong]}),
  row({execution:{finalArguments:false,plan:false},differences:[missing]})];
 const cell=summarize(rows);assert.equal(cell.retrievalMisses,1);assert.equal(cell.wrongApiWithCandidate,1);
 assert.deepEqual(cell.parameterDifferences,[{field:'missing:arguments.location',count:2},{field:'value:arguments.time_ref',count:1}]);
 assert.equal(cell.primaryFailures.parameters,2);assert.equal(cell.parameterDifferences.reduce((n,d)=>n+d.count,0),3);
});

test('latency quantiles ignore non-finite durations but preserve a measured zero',()=>{
 const rows=[0,10,20,30,null,undefined,NaN].map(wallMs=>row({wallMs,inputTokens:0}));
 const cell=summarize(rows);assert.equal(cell.p50Ms,20);assert.equal(cell.p95Ms,30);assert.equal(cell.maxInputTokens,0);
 const missing=summarize([row({wallMs:undefined})]);assert.equal(missing.p50Ms,null);assert.equal(missing.p95Ms,null);
});

test('example sampling caps each model/domain/cause at two without reducing report denominators',()=>{
 const rows=Array.from({length:4},(_,i)=>row({caseId:`weather-api-${i}`,rawScore:{api:false}}));
 rows.push(row({testDomain:'calendar',rawScore:{api:false}}),row({model:models[1],rawScore:{api:false}}),row({execution:{finalArguments:false,plan:false}}),row());
 const result=buildSingleService100Report(manifest(),rows);assert.equal(result.examples.length,5);
 assert.equal(result.examples.filter(r=>r.model===models[0]&&r.testDomain==='weather'&&r.primary==='api').length,2);
 assert.equal(result.examples.some(r=>r.primary==='correct'),false);assert.equal(result.progress.done,8);assert.equal(result.summary[0].total,7);
});

test('all 1000 cases are deterministic and every block of ten contains every domain for every model',async()=>{
 const before=cases.map(c=>c.id),ordered=orderedCases(cases),ids=ordered.map(c=>c.id);
 assert.equal(ordered.length,1000);assert.equal(new Set(ids).size,1000);assert.deepEqual(cases.map(c=>c.id),before);
 assert.deepEqual(orderedCases([...cases].reverse()).map(c=>c.id),ids);
 assert.deepEqual(models,['qwen2.5:0.5b','qwen2.5:1.5b','qwen2.5:3b','qwen2.5:7b']);
 for(let i=0;i<1000;i+=10)assert.deepEqual(ordered.slice(i,i+10).map(c=>c.testDomain),domains,`block ${i/10}`);
 const perModel=models.map(model=>({model,ids:orderedCases(cases).map(c=>c.id)}));
 assert.ok(perModel.every(entry=>JSON.stringify(entry.ids)===JSON.stringify(ids)));
 // Check that the real harness consumes one shared order, not a per-model shuffle.
 const source=await readFile(new URL('../scripts/benchmark-single-service-100.mjs',import.meta.url),'utf8');
 assert.match(source,/order=orderedCases\(cases\)/);assert.match(source,/for\(const model of models\)/);assert.match(source,/for\(const c of order\)/);
});

test('all 1000 hand-authored gold cases pass schema and resolver contracts without changing gold',()=>{
 const before=JSON.stringify(cases),coverage=validateSuite(cases);
 assert.equal(JSON.stringify(cases),before);assert.equal(coverage.length,10);assert.deepEqual(coverage.map(c=>c.testDomain),domains);
 for(const cell of coverage){
  assert.equal(cell.total,100,cell.testDomain);assert.ok(cell.apiCount>0&&cell.apiCount<=cell.registeredApis,cell.testDomain);
  assert.ok(cell.scenarios>1,cell.testDomain);assert.equal(Object.values(cell.expectedStatuses).reduce((a,b)=>a+b,0),100);
 }
});

test('suite validation rejects missing cases, wrong-domain APIs, invalid arguments, and contradictory statuses',()=>{
 assert.throws(()=>validateSuite(cases.slice(1)),/Require 1000 cases/);
 const badDomain=structuredClone(cases);badDomain[0].expected.api=cases.find(c=>c.testDomain==='calendar').expected.api;
 assert.throws(()=>validateSuite(badDomain),/unknown\/wrong-domain API/);
 const badSchema=structuredClone(cases);badSchema[0].expected.arguments.__unknown_argument=true;
 assert.throws(()=>validateSuite(badSchema),/invalid expected arguments/);
 const badStatus=structuredClone(cases);badStatus[0].expected.status='impossible-test-status';
 assert.throws(()=>validateSuite(badStatus),/Expected status\/contract inconsistencies/);
});

test('manifest evidence identity, corpus provenance, active case, and partial status are preserved',()=>{
 const input=manifest({status:'partial',active:{model:models[0],caseId:'pending'},error:'stopped before all calls',
  completedAt:null,warmups:[{id:'warmup-only'}],corpus:{total:1000,perDomain:100,original:100,new:900,contractBoundaries:[{id:'boundary'}]}});
 const before=structuredClone(input),result=buildSingleService100Report(input,[row()]);
 assert.deepEqual(input,before);assert.equal(result.id,input.id);assert.equal(result.status,'partial');assert.equal(result.completedAt,null);
 assert.deepEqual(result.active,input.active);assert.deepEqual(result.corpus,input.corpus);assert.equal(result.sourceSnapshot,input.sourceSnapshot);
 assert.equal(result.error,input.error);assert.equal(result.warmupCount,1);assert.deepEqual(result.progress,{done:1,total:4000});
 assert.equal(Number.isFinite(Date.parse(result.updatedAt)),true);
});


test('historical three-model manifests still produce 3000 planned calls while new offload is observed only from samples',()=>{
 const legacy=['qwen2.5:1.5b','qwen2.5:3b','qwen2.5:0.5b'],legacyReport=buildSingleService100Report(manifest({conditions:{models:legacy,modelOrder:legacy,totalCalls:3000}}),[]);
 assert.equal(legacyReport.progress.total,3000);assert.equal(legacyReport.summary.length,3);assert.equal(legacyReport.cells.length,30);assert.match(legacyReport.notes[0],/7B不参与/);
 const sample={at:'sample-time',models:[{name:models[3],contextLength:2048,offload:{status:'observed',cpuBytes:1000,gpuBytes:0,gpuFraction:0}}]};
 const report=buildSingleService100Report(manifest(),[row({model:models[3],performance:{ollamaSamples:[sample],hostSamples:[{freeMemoryBytes:10},{freeMemoryBytes:3}]}})]);
 assert.equal(report.inferenceEnvironment.models[3].gpuFraction,0);assert.equal(report.inferenceEnvironment.models[3].status,'observed');assert.equal(report.inferenceEnvironment.models[0].status,'unknown');assert.equal(report.summary[3].performance.minSampledFreeMemoryBytes,3);
 assert.throws(()=>buildSingleService100Report(manifest({conditions:{models:legacy}}),[row({model:models[3]})]),/outside manifest/);
});
