import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as view from '../public/inference-mode-view.mjs';

test('missing official key explains readiness and never presents Jev benchmark scores',()=>{
  const html=view.renderJevStatus?.({configured:false,official:true,cloud:true,sdkVersion:'0.6.0',model:'jev-latest'}) ?? '';
  assert.match(html,/未配置/);assert.match(html,/TYPESAFE_API_KEY/);assert.match(html,/本机后端/);assert.match(html,/尚无真实 Jev 成绩/);
  assert.match(html,/官方云端/);assert.match(html,/可能产生费用/);assert.doesNotMatch(html,/已连接|0\.0%|准确率.*100/);
});

test('configured official key is not advertised as verified authentication and metadata is safe',()=>{
  const html=view.renderJevStatus?.({configured:true,official:true,model:'<svg>',baseURL:'<script>bad</script>',sdkVersion:'0.6.0'}) ?? '';
  assert.match(html,/已配置，凭据有效性待实际请求核验/);assert.match(html,/&lt;svg&gt;/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|<svg>/);
});

test('adaptive overrides cover both branches while official Jev is restricted to choice stages',()=>{
  const defs=view.inferenceOverrideStages?.('adaptive') ?? [];
  assert.deepEqual(defs.map(item=>item.stage),['domain','intent_arguments','intent','arguments']);
  assert.equal(defs.find(item=>item.stage==='domain').allowsJev,true);assert.equal(defs.find(item=>item.stage==='intent').allowsJev,true);
  assert.equal(defs.find(item=>item.stage==='intent_arguments').allowsJev,false);assert.equal(defs.find(item=>item.stage==='arguments').allowsJev,false);
  const html=view.renderInferenceOverrides?.('adaptive',{intent_arguments:{provider:'jev',model:'old-jevmode'}},{}) ?? '';
  const joint=html.match(/<div class="override-row" data-stage="intent_arguments">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.match(joint,/Ollama/);assert.doesNotMatch(joint,/value="jev"|old-jevmode/);
});

test('Jev profile enforces two cloud choices and keeps parameter model local',()=>{
  const stages=view.collectInferenceOverrides?.('jev',{domain:{provider:'ollama',model:'qwen2.5:3b'},intent:{provider:'ollama'},arguments:{provider:'ollama',model:'qwen2.5:1.5b'}}) ?? {};
  assert.deepEqual(stages,{domain:{provider:'jev'},intent:{provider:'jev'},arguments:{provider:'ollama',model:'qwen2.5:1.5b'}});
  assert.throws(()=>view.collectInferenceOverrides?.('adaptive',{intent_arguments:{provider:'jev'}}),/Jev.*领域.*API/);
  assert.throws(()=>view.collectInferenceOverrides?.('unified',{unified:{provider:'jev'}}),/Jev.*领域.*API/);
});

test('mode descriptions reflect two and three paths without claiming new accuracy or speed',()=>{
  const adaptive=view.inferenceModeDescription?.('adaptive') ?? '',jev=view.inferenceModeDescription?.('jev') ?? '';
  assert.match(adaptive,/2 次/);assert.match(adaptive,/3 次/);assert.match(jev,/Jev.*领域.*API/);assert.match(jev,/Qwen.*参数/);
  assert.doesNotMatch(adaptive+jev,/提高.*准确率|速度.*更快/);
});

test('manual evaluation exposes adaptive default and Jev mode without changing completed baseline view',async()=>{
  const source=await readFile(new URL('../public/evaluation-view.mjs',import.meta.url),'utf8');
  assert.match(source,/renderInferenceModes\('adaptive'\)/);assert.match(source,/getJevStatus/);assert.match(source,/历史.*4,000|已完成.*4000/);
});
