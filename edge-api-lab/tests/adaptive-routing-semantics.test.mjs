import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildAdaptiveDomainPrompt,buildAdaptiveIntentPrompt,buildIntentArgumentsPrompt,buildJevDomainPrompt,buildJevIntentPrompt,buildDomainPrompt,buildIntentPrompt,buildArgumentsPrompt,buildUnifiedPrompt,ADAPTIVE_PROMPT_VERSION,JEV_PROMPT_VERSION} from '../src/prompts.mjs';
import {getCapability} from '../src/registry.mjs';

test('new API decisions require one update covering all explicitly changed fields',()=>{
 const text='修改日程 ev_7，标题为设计评审，地点为A室';
 for(const prompt of [buildAdaptiveIntentPrompt(text,'calendar'),buildIntentArgumentsPrompt(text,'calendar'),buildJevIntentPrompt(text,'calendar')]){
  const instruction=prompt.decision?.question.instructions??prompt.messages[0].content;
  assert.match(instruction,/同一对象多个字段修改/);
  assert.match(instruction,/覆盖全部.*(?:变更|修改)/);
  assert.match(instruction,/单字段.*(?:不能|不可)/);
  assert.ok(prompt.promptMeta.candidates.ids.includes('calendar.update'));
  assert.ok(prompt.promptMeta.candidates.ids.includes('calendar.event.set.title'));
 }
});

test('new domain decisions explicitly refuse creative/general requests without a registered business action',()=>{
 for(const prompt of [buildAdaptiveDomainPrompt('请求一个业务动作'),buildJevDomainPrompt('请求一个业务动作')]){
  const instruction=prompt.decision?.question.instructions??prompt.messages[0].content;
  assert.match(instruction,/闲聊.*创作.*(?:通用|知识).*unsupported/);
  assert.match(instruction,/services仅/);
  assert.match(instruction,/服务自身状态/);
 }
});

test('new prompt revisions are distinct from the already recorded first smoke',()=>{
 assert.equal(ADAPTIVE_PROMPT_VERSION,'adaptive-v2');
 assert.equal(JEV_PROMPT_VERSION,'jev-choice-v2');
});

test('legacy domain intent arguments and unified prompt contracts remain byte-identical',()=>{
 const text='修改日程 ev_7，标题为设计评审，地点为A室';
 const hash=prompt=>createHash('sha256').update(JSON.stringify({messages:prompt.messages,schema:prompt.schema,promptMeta:prompt.promptMeta})).digest('hex');
 const actual={domain:hash(buildDomainPrompt(text)),intent:hash(buildIntentPrompt(text,'calendar')),arguments:hash(buildArgumentsPrompt(text,getCapability('calendar.update'))),unified:hash(buildUnifiedPrompt(text))};
 assert.deepEqual(actual,{domain:'419951da822b9f38ce4f397b5d46606412314eb6ebda50bfcd838d8ef6635cf2',intent:'6a344b5ed07d525415051b953c1b130aa231396b811d30aa5ce7d0d91b6e8d58',arguments:'8c9b047009b8e904fecde93db65636f672ec0d0a0e19bbd9a4a33c7c54c18787',unified:'a18e18c8b1f2703fd1f088e94a3e375e7c163e368a52c8e97bbc30c8e56d7569'});
});
