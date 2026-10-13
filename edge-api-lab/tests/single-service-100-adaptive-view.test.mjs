import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSingleService100Report,renderSingleService100Rows} from '../public/single-service-100-view.mjs';

const models=['qwen2.5:0.5b','qwen2.5:1.5b','qwen2.5:3b','qwen2.5:7b'];
const metric=(correct,total)=>({correct,total,accuracy:total?correct/total:null});
const timing=()=>({actualCallCount:5,knownRequests:2,complete:true,requestTotalMs:3400,modelCallTotalMs:3100,meanCalls:2.5,requestMeanMs:1700,stages:[{stage:'domain',calls:2,totalMs:300,meanMs:150,p50Ms:150,p95Ms:190,errors:0},{stage:'intent_arguments',calls:1,totalMs:800,meanMs:800,p50Ms:800,p95Ms:800,errors:0},{stage:'intent',calls:1,totalMs:700,meanMs:700,p50Ms:700,p95Ms:700,errors:0},{stage:'arguments',calls:1,totalMs:1300,meanMs:1300,p50Ms:1300,p95Ms:1300,errors:1}]});
const cell=()=>({model:models[0],total:2,planned:1000,complete:false,domain:metric(1,2),api:metric(1,2),rawArguments:metric(1,2),semantics:metric(1,2),readyRequestSemantics:metric(1,2),safeNonReady:metric(0,0),domainGateMiss:1,budgetRecallMisses:0,candidateRecallEligible:metric(1,1),retrievalMisses:1,wrongApiWithCandidate:0,p50Ms:1700,p95Ms:2190,timing:timing()});
const report=()=>({id:'adaptive-new',status:'running',progress:{done:2,total:4000},corpus:{total:1000,perDomain:100},conditions:{mode:'adaptive',models,totalCalls:4000,promptVersion:'adaptive-v2'},summary:[cell()],cells:[],examples:[],totalTiming:timing(),executionElapsed:{elapsedMs:5000,status:'running',includesWarmups:true}});

test('foreground identifies adaptive and counts case requests separately from model invocations',()=>{
  const html=renderSingleService100Report(report()),foreground=html.slice(0,html.indexOf('<details'));
  assert.match(foreground,/adaptive.*多阶段/);assert.match(foreground,/2 \/ 4000 个案例请求/);assert.match(foreground,/实际模型调用.*5/);
  assert.doesNotMatch(html,/4000 次正式调用|4000 次模型调用/);
  assert.match(foreground,/批次运行耗时.*5\.00 s/);assert.match(foreground,/完整请求累计.*3\.40 s/);
});

test('stage aggregates preserve actual calls latency percentiles errors and end-to-end versus model sums',()=>{
  const html=renderSingleService100Report(report());
  assert.match(html,/每阶段耗时/);assert.match(html,/API 选择与参数提取/);assert.match(html,/模型调用累计.*3\.10 s/);assert.match(html,/每案例平均调用.*2\.50/);
  assert.match(html,/均值/);assert.match(html,/典型耗时.*P50/);assert.match(html,/较慢耗时.*P95/);assert.match(html,/150 ms/);assert.match(html,/190 ms/);
  assert.match(html,/50%.*95%.*请求/);
});

test('unknown legacy trace timing never becomes zero or an inferred one-call measurement',()=>{
  const data=report();delete data.totalTiming;delete data.executionElapsed;delete data.summary[0].timing;data.conditions.mode='unified';
  const html=renderSingleService100Report(data);
  assert.match(html,/unified.*一次/);assert.match(html,/实际模型调用.*未采集/);assert.match(html,/批次运行耗时.*未采集/);
  assert.doesNotMatch(html,/实际模型调用[^<]*2|模型调用累计[^<]*0 ms/);
});

test('domain gating and correct-domain budget misses have distinct denominators instead of one recall error count',()=>{
  const html=renderSingleService100Report(report());
  assert.match(html,/领域误判.*候选不可见/);assert.match(html,/正确领域.*预算漏选/);assert.match(html,/正确领域召回/);assert.match(html,/1\/1/);
  const legacy=report();delete legacy.summary[0].domainGateMiss;delete legacy.summary[0].budgetRecallMisses;delete legacy.summary[0].candidateRecallEligible;
  assert.match(renderSingleService100Report(legacy),/历史漏选未分层/);
});

test('per-case trace timings show stages and request total without guessing missing metrics',()=>{
  const html=renderSingleService100Rows([{model:models[0],caseId:'e100-device-001',text:'查电量',primary:'correct',wallMs:3400,actualCallCount:2,traceTimings:[{stage:'domain',wallMs:100},{stage:'intent_arguments',wallMs:0}]}],{full:true});
  assert.match(html,/请求总耗时.*3\.40 s/);assert.match(html,/2 次模型调用/);assert.match(html,/领域识别.*100 ms/);assert.match(html,/API 选择与参数提取.*0 ms/);
  const missing=renderSingleService100Rows([{text:'历史',primary:'correct',wallMs:null,traceTimings:null}],{full:true});assert.match(missing,/请求总耗时.*未采集/);assert.match(missing,/阶段耗时未采集/);assert.doesNotMatch(missing,/0 ms/);
});

test('embedded yesterday baseline is paired by model and partial rows cannot claim a delta',()=>{
  const data=report(),current={...cell(),requestMeanMs:1700,requestTotalMs:3400},baseline={...current,total:1000,complete:true,semantics:metric(600,1000),p50Ms:2000,p95Ms:4000};
  data.baselineComparison={id:'yesterday-unified',mode:'unified',conditions:{mode:'unified'},summary:[{model:models[0],paired:false,current,baseline,delta:null,reason:'本轮尚未完成'}],cells:[],notes:['提示词与规则也不同，不能仅归因调用方式']};
  const html=renderSingleService100Report(data);
  assert.match(html,/昨日 unified 一次调用基线/);assert.match(html,/本轮 adaptive 多阶段/);assert.match(html,/60\.0%/);assert.match(html,/本轮尚未完成/);assert.match(html,/不计算差值/);
  assert.match(html,/yesterday-unified/);assert.match(html,/提示词与规则也不同/);
  const empty={...data,status:'not_started',progress:{done:0,total:4000},summary:[],totalTiming:null};empty.baselineComparison.summary[0].current={total:0,planned:1000,complete:false,semantics:metric(0,0)};
  const pending=renderSingleService100Report(empty);assert.match(pending,/<td>— \/ 60\.0%/);assert.doesNotMatch(pending,/<td>0\.0%/);
});

test('a selected domain with no embedded comparison cells remains empty without borrowing another domain',()=>{
  const data=report();data.baselineComparison={id:'yesterday',mode:'unified',summary:[],notes:[]};
  assert.match(renderSingleService100Report(data,{domain:'weather'}),/该范围尚无基线对照/);
});

test('complete comparable cells display percentage-point deltas while metadata and stage labels stay escaped',()=>{
  const data=report(),current={...cell(),total:1000,complete:true},baseline={...current};
  data.baselineComparison={id:'<script>bad</script>',mode:'unified',summary:[{model:models[0],paired:true,current,baseline,delta:{semantics:.1,p50Ms:-200,p95Ms:300},reason:null}],cells:[],notes:['<img onerror="bad">']};
  data.totalTiming.stages.push({stage:'<svg>',calls:1,totalMs:null,meanMs:null,p50Ms:null,p95Ms:null});
  const html=renderSingleService100Report(data);assert.match(html,/\+10\.0 个百分点/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);assert.match(html,/&lt;svg&gt;/);assert.doesNotMatch(html,/<script>|<img |<svg>/);
});
