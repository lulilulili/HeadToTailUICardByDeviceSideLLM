import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderJevStatus} from '../public/inference-mode-view.mjs';

test('new guide distinguishes cloud readiness, model roles, actual calls and frozen historical evidence',async()=>{
  const markdown=await readFile(new URL('../docs/ADAPTIVE_JEV.md',import.meta.url),'utf8');
  const section=JSON.parse(await readFile(new URL('../docs/adaptive-jev.json',import.meta.url),'utf8'));
  assert.equal(section.id,'adaptive-jev');assert.match(section.title,/Jev/);
  for(const text of [markdown,section.html]){
    for(const expression of [/2 次/,/3 次/,/无入参/,/confidence.*不是.*正确率/,/TYPESAFE_API_KEY/,/未配置/,/尚无真实 Jev/,/4,000.*unified/,/模拟/,/可能产生费用/,/https:\/\/docs\.typesafe\.ai\/api/,/https:\/\/github\.com\/typesafe-ai\/typesafe-sdk-js/])assert.match(text,expression);
    assert.doesNotMatch(text,/Jev.*(?:实测准确率|准确率提升)|每百万.*(?:美元|元)/);
  }
  assert.match(section.html,/class="table-wrap"/);assert.match(section.html,/密钥.*本机后端/);
});

test('official key acquisition links lead to console and quickstart without browser credential fields',async()=>{
  const markdown=await readFile(new URL('../docs/ADAPTIVE_JEV.md',import.meta.url),'utf8');
  const section=JSON.parse(await readFile(new URL('../docs/adaptive-jev.json',import.meta.url),'utf8'));
  const status=renderJevStatus({official:true,configured:false,apiKey:'must-never-render'});
  for(const text of [markdown,section.html,status]){
    assert.match(text,/https:\/\/console\.typesafe\.ai/);assert.match(text,/https:\/\/docs\.typesafe\.ai\/introduction\/quickstart/);
    assert.match(text,/注册.*登录.*按.*提示.*获取.*密钥/);
    assert.doesNotMatch(text,/免费额度|API Keys 菜单|must-never-render/);
  }
  assert.doesNotMatch(status,/<input|<textarea/);assert.match(status,/密钥只由本机后端读取/);
});
