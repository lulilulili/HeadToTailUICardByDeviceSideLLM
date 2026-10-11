import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadCases} from '../src/corpus.mjs';
import {selectCaseIds,caseMatchesScope,defaultEvaluationModelChecked,exclusiveBenchmarkMessage} from '../public/ui-utils.mjs';
const cases=await loadCases(fileURLToPath(new URL('..',import.meta.url)));
const current=cases.filter(c=>c.suite==='single-service-v1'),ids=current.map(c=>c.id);
test('a short default single-service sample still includes all ten domains',()=>{
  const chosen=selectCaseIds(ids,12,cases);
  assert.equal(chosen.length,12);
  assert.equal(new Set(chosen.map(id=>current.find(c=>c.id===id).testDomain)).size,10);
});
test('balanced selection respects manual choices and does not introduce extra cases',()=>{
  const selected=ids.filter((_,index)=>index%3===0),chosen=selectCaseIds(selected,13,cases);
  assert.equal(chosen.length,13);
  assert.ok(chosen.every(id=>selected.includes(id)));
  assert.equal(new Set(selectCaseIds(ids,100,cases)).size,100);
});
test('historical and mixed-case selection keeps the original explicit order',()=>{
  const old=cases.filter(c=>caseMatchesScope(c.suite,'history')).slice(0,5).map(c=>c.id);
  assert.deepEqual(selectCaseIds(old,3,cases),old.slice(0,3));
  assert.deepEqual(selectCaseIds([...old,...ids],3,cases),old.slice(0,3));
});

test('the thousand-case default suite is balanced across ten domains and independent of the old hundred',()=>{
  const thousand=cases.filter(c=>caseMatchesScope(c.suite,'single-service-100-v1'));
  assert.equal(thousand.length,1000);
  const selected=selectCaseIds(thousand.map(c=>c.id),12,cases);
  assert.equal(selected.length,12);assert.equal(new Set(selected.map(id=>thousand.find(c=>c.id===id).testDomain)).size,10);
  assert.equal(selectCaseIds(thousand.map(c=>c.id),1000,cases).length,1000);
  assert.equal(cases.filter(c=>caseMatchesScope(c.suite,'single-service-v1')).length,100);
  assert.equal(cases.filter(c=>caseMatchesScope(c.suite,'history')).length,478);
  assert.equal(cases.filter(c=>caseMatchesScope(c.suite,'all')).length,1578);
});

test('both single-service suites support balanced manual selection but historical rows retain order',()=>{
  const selected=cases.filter(c=>['single-service-v1','single-service-100-v1'].includes(c.suite)&&c.testDomain!=='weather').map(c=>c.id);
  const chosen=selectCaseIds(selected,9,cases);
  assert.equal(chosen.length,9);assert.equal(new Set(chosen.map(id=>cases.find(c=>c.id===id).testDomain)).size,9);
  assert.ok(chosen.every(id=>selected.includes(id)));
});

test('default comparison models exclude installed seven billion and exclusive status explains the lock',()=>{
  for(const name of ['qwen2.5:0.5b','qwen2.5:1.5b','qwen2.5:3b'])assert.equal(defaultEvaluationModelChecked(name),true);
  assert.equal(defaultEvaluationModelChecked('qwen2.5:7b'),false);
  assert.equal(defaultEvaluationModelChecked('another:3b'),false);
  assert.equal(exclusiveBenchmarkMessage(null),'');
  assert.match(exclusiveBenchmarkMessage({progress:{done:12,total:3000}}),/12\/3000/);
  assert.match(exclusiveBenchmarkMessage({}),/不可用|重复启动/);
});
