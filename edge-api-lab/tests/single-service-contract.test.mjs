import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadCases} from '../src/corpus.mjs';
import {finalizePlan} from '../src/grounding.mjs';
import {getCapability} from '../src/registry.mjs';
import {resolveArguments} from '../src/resolver.mjs';
import {buildUnifiedPrompt,buildIntentPrompt} from '../src/prompts.mjs';
import {experimentDefaults,evaluationSystemDefaults} from '../src/fixtures.mjs';

const cases=(await loadCases(fileURLToPath(new URL('..',import.meta.url)))).filter(c=>c.suite==='single-service-v1');
const base={...experimentDefaults,...evaluationSystemDefaults,now:'2026-10-10T08:00:00+08:00',timezone:'Asia/Shanghai',location:{latitude:31.2304,longitude:121.4737,source:'fixture'}};
test('all 100 single-service contracts preserve already correct explicit arguments',()=>{
  assert.equal(cases.length,100);
  for(const c of cases){
    const context={...base,...c.context};
    const result=finalizePlan({text:c.text,...c.expected,extractedArguments:c.expected.arguments,context});
    assert.deepEqual(result.groundedArguments,c.expected.arguments,c.id);
    assert.equal(result.status,resolveArguments(getCapability(c.expected.api),c.expected.arguments,context).status,c.id);
  }
});
test('all single-service target APIs survive both candidate limits',()=>{
  for(const c of cases){
    for(const prompt of [buildUnifiedPrompt(c.text,base),buildIntentPrompt(c.text,c.testDomain,base)]){
      assert.ok(prompt.promptMeta.candidates.ids.includes(c.expected.api),c.id);
    }
  }
});
