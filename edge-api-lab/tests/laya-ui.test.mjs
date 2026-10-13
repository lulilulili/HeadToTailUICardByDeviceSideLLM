import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as view from '../public/inference-mode-view.mjs';
import {renderRun} from '../public/run-view.mjs';

const ready={provider:'laya',ready:true,ok:true,local:true,cloud:false,model:'multilingual',version:'0.4.6',url:'http://127.0.0.1:8765/v1/systemone',threads:8,modelRevision:'revision-local',tournamentGroup:16,maxChoices:255,maxLen:4096,headMaxLen:768,device:'cpu'};

test('Laya mode is selectable without displacing adaptive default or cloud and historical modes',async()=>{
  const options=view.renderInferenceModes();assert.match(options,/<option value="laya">Laya 本机选择/);assert.match(options,/<option value="adaptive" selected>/);
  assert.match(view.inferenceModeDescription('laya'),/Laya.*本机.*领域.*API/);assert.match(view.inferenceModeDescription('laya'),/无入参/);
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');assert.match(html,/<option value="laya">/);assert.match(html,/<option value="adaptive" selected>/);
});

test('local readiness is explicit and unknown health metadata is never fabricated',()=>{
  assert.equal(view.layaCanRun?.(ready),true);
  for(const status of [{...ready,ready:false},{...ready,ready:null},{configured:true},{...ready,cloud:true}])assert.equal(view.layaCanRun?.(status),false);
  const html=view.renderLayaStatus?.(ready) || '';assert.match(html,/Laya 本机.*已就绪/);assert.match(html,/无需.*密钥.*充值/);assert.match(html,/安装启动Laya\.bat/);assert.match(html,/0\.4\.6/);assert.match(html,/revision-local/);assert.match(html,/8/);
  const pending=view.renderLayaStatus?.({local:true,cloud:false,ready:false,error:'连接<拒绝>'}) || '';assert.match(pending,/尚未就绪/);assert.match(pending,/连接&lt;拒绝&gt;/);assert.doesNotMatch(pending,/0\.4\.6|4096|revision-local/);
});

test('Laya profile forces local decision stages and disallows Laya as parameter generator',()=>{
  const stages=view.collectInferenceOverrides('laya',{domain:{provider:'jev'},intent:{provider:'ollama'},arguments:{provider:'ollama',model:'qwen2.5:3b'}});
  assert.deepEqual(stages,{domain:{provider:'laya'},intent:{provider:'laya'},arguments:{provider:'ollama',model:'qwen2.5:3b'}});
  assert.deepEqual(view.collectInferenceOverrides('adaptive',{domain:{provider:'laya'},intent:{provider:'laya'}}),{domain:{provider:'laya'},intent:{provider:'laya'}});
  assert.throws(()=>view.collectInferenceOverrides('adaptive',{intent_arguments:{provider:'laya'}}),/Laya.*领域.*API/);
  assert.throws(()=>view.collectInferenceOverrides('unified',{unified:{provider:'laya'}}),/Laya.*领域.*API/);
  const html=view.renderInferenceOverrides('laya',{}, {},ready);assert.match(html,/data-forced-provider="laya"/);assert.match(html,/Laya 本机/);
});

test('local-only mode has no unrelated missing Jev key foreground warning',()=>{
  const html=view.renderDecisionProviderStatus?.({mode:'laya',laya:ready,jev:{configured:false,official:true}}) || '';
  assert.match(html,/Laya 本机/);assert.doesNotMatch(html,/TYPESAFE_API_KEY|官方云端|未配置/);
  const cloud=view.renderDecisionProviderStatus?.({mode:'jev',laya:ready,jev:{configured:false,official:true}}) || '';assert.match(cloud,/TYPESAFE_API_KEY/);
});

test('Laya trace separates one HTTP from source-derived tournament predicts and unknown forwards',()=>{
  const request={state:{text:'查上海湿度'},model:'multilingual',questions:{api:{type:'choice',instructions:'选择 API',criteria:{c000:'当前湿度',c001:'拒识'}}}};
  const raw={model:'multilingual',answers:{api:{type:'choice',choice:'c000',probabilities:{c000:1,c001:0},confidence:1,x_tournament:{rounds:1,finalists:['c000']}}},usage:{input_tokens:220,output_tokens:0}};
  const html=renderRun({mode:'laya',status:'ready_mock',traces:[{stage:'intent',provider:'laya',wallMs:320,inferenceMs:310,request,raw:JSON.stringify(raw),choiceMap:{c000:'weather.current.humidity',c001:'unsupported'},probabilities:{'weather.current.humidity':1,unsupported:0},wireProbabilities:{c000:1,c001:0},tournament:{rounds:1,finalists:['c000']},httpCalls:1,internalPredictCalls:2,internalPredictCallsBasis:'official_tournament_rounds_plus_final',forwardPasses:null,usage:raw.usage,confidence:1}]});
  assert.match(html,/Laya 本机决策/);assert.match(html,/HTTP 请求.*1/);assert.match(html,/内部 predict.*2/);assert.match(html,/源码推导/);assert.match(html,/底层 forward.*未观测/);
  assert.match(html,/短候选.*真实 API/);assert.match(html,/weather\.current\.humidity/);assert.match(html,/淘汰.*全量.*联合/);assert.match(html,/最后一轮/);assert.match(html,/归一化熵/);
  assert.doesNotMatch(html,/Jev 官方决策|内部 predict.*14|生成速度.*0\.0 tok/);
});

test('Laya failures and missing tournament evidence remain failures without invented forward counts',()=>{
  const html=renderRun({mode:'laya',status:'error',error:'输入截断',traces:[{provider:'laya',stage:'domain',wallMs:40,truncated:true,error:'输入截断',request:{state:{text:'<script>bad</script>'}},forwardPasses:null}]});
  assert.match(html,/业务执行：未执行/);assert.match(html,/实际 1 次模型调用/);assert.match(html,/Laya 本机决策/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|已就绪|内部 predict.*2/);
});

test('adaptive Laya intent override is never explained as a Jev cloud decision',()=>{
  const html=renderRun({mode:'adaptive',stages:{intent:{provider:'laya'}},status:'ready_mock',traces:[{stage:'intent',provider:'laya'}],routing:{path:'three_step',triggerReasons:['typed_decision_requires_arguments']}});
  assert.match(html,/Laya 选择 API 后需要本机提取参数/);assert.doesNotMatch(html,/Jev 选择 API 后/);
});
