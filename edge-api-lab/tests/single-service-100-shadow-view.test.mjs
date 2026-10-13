import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSingleService100Report,renderSingleService100Rows} from '../public/single-service-100-view.mjs';

const metric=(correct,total)=>({correct,total,accuracy:total?correct/total:null});
const score=(p,l,total)=>({primary:{selection:metric(p,total),contract:metric(p,total)},laya:{selection:metric(l,total),contract:metric(l,total)}});
const timing=(calls,totalMs)=>({calls,totalMs,meanMs:totalMs/calls,p50Ms:totalMs/calls,p95Ms:totalMs/calls,errors:0});
const stage=()=>({coverage:{observed:1,requests:2,planned:1000,missing:1,eligible:1,knownRequests:2},all:score(1,0,2),observed:score(1,0,1),eligible:score(1,0,1),primaryStages:['intent_arguments'],primaryTiming:timing(1,900),layaTiming:timing(1,20),agreement:metric(0,1)});
const report=()=>({id:'adaptive-shadow',status:'running',progress:{done:2,total:4000},conditions:{mode:'adaptive',models:['qwen2.5:0.5b','qwen2.5:1.5b','qwen2.5:3b','qwen2.5:7b'],totalRequests:4000},summary:[],cells:[],examples:[],totalTiming:{actualCallCount:4,knownRequests:2,complete:true,stages:[]},shadowComparison:{policy:'same-candidates-shadow-v1',requests:2,observedRequests:2,combinedRequestTiming:{totalMs:2100,meanMs:1050,p50Ms:1000,p95Ms:1095,knownRequests:2},drainTiming:{totalMs:30,meanMs:15,p50Ms:15,p95Ms:15,knownRequests:2},summary:[{model:'qwen2.5:0.5b',testDomain:null,requests:2,observedRequests:2,domain:{...stage(),primaryStages:['domain']},api:stage()}],cells:[],notes:[]}});

test('shadow is independent from authoritative Qwen calls and warns about CPU contention and unequal API tasks',()=>{
  const data=report(),copy=structuredClone(data),html=renderSingleService100Report(data);
  assert.match(html,/Qwen 权威模型调用.*4/);assert.match(html,/Laya 并行影子对照/);assert.match(html,/不影响 Qwen.*评分/);assert.match(html,/不是 Laya 完整流程成功率/);
  assert.match(html,/CPU 并行.*竞争/);assert.match(html,/联合 API.*参数.*Laya.*只.*API.*不同任务/);assert.match(html,/同候选/);assert.match(html,/Qwen 选域/);
  assert.deepEqual(data,copy);
});

test('observed accuracy eligible accuracy and full-request coverage keep distinct denominators',()=>{
  const html=renderSingleService100Report(report());
  assert.match(html,/已观测选择正确率/);assert.match(html,/目标可见子集/);assert.match(html,/全请求.*覆盖/);assert.match(html,/1 \/ 2.*计划 1000/);
  assert.match(html,/100\.0%/);assert.match(html,/50\.0%/);assert.match(html,/0\.0%/);assert.match(html,/900 ms/);assert.match(html,/20 ms/);
  assert.match(html,/结构有效率/);assert.match(html,/相同选择率/);assert.match(html,/Laya.*失败尝试/);
});

test('pending absent shadow metadata has no fabricated metrics and domain filter does not borrow summary scores',()=>{
  const noData=report();noData.progress.done=0;noData.status='not_started';noData.shadowComparison.summary=[];
  const html=renderSingleService100Report(noData);assert.match(html,/影子对照尚无.*结果/);assert.doesNotMatch(html,/0\.0%|100\.0%/);
  assert.match(renderSingleService100Report(report(),{domain:'weather'}),/该范围尚无影子对照/);
});

test('unknown shadow records differ from known skipped stages and unknown outcomes are not rated zero',()=>{
  const data=report(),domain=data.shadowComparison.summary[0].domain;domain.coverage={observed:1,requests:2,planned:1000,knownRequests:1,missing:0,eligible:1};
  domain.all.primary.selection={correct:1,total:2,accuracy:null,knownTotal:1};domain.all.laya.selection={correct:0,total:2,accuracy:null,knownTotal:1};
  const html=renderSingleService100Report(data);assert.match(html,/影子记录 1 \/ 2/);assert.match(html,/阶段未发生 0/);assert.match(html,/可判定 1\/2/);
});

test('per-case shadow keeps both selections visibility errors original local response and different stage timings',()=>{
  const shadow={combinedWallMs:990,drainMs:15,primaryWallMs:970,decisions:[{stage:'intent',primaryStage:'intent_arguments',candidateIds:['weather.current.temperature'],expectedInCandidates:false,agreement:false,primary:{selected:'weather.current.temperature',selectionCorrect:true,contractValid:true,wallMs:900,error:null},laya:{selected:'unsupported',selectionCorrect:false,contractValid:false,wallMs:20,error:'<script>bad</script>',trace:{raw:'{"choice":"<img onerror=bad>"}',confidence:.99}}}]};
  const html=renderSingleService100Rows([{text:'查询',primary:'api',shadow}],{full:true});
  assert.match(html,/逐例 Laya 影子/);assert.match(html,/Qwen.*weather\.current\.temperature/);assert.match(html,/Laya.*unsupported/);assert.match(html,/目标 API.*不可见/);
  assert.match(html,/API 选择与参数提取/);assert.match(html,/900 ms/);assert.match(html,/20 ms/);assert.match(html,/Laya 原始响应/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<script>|<img /);
});
