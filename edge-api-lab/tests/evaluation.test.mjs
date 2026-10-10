import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCase, summarize } from '../src/evaluation.mjs';

const expected={domain:'weather',api:'weather.query',arguments:{place_text:'上海'},status:'ready_mock'};
test('a correct route still fails the complete plan when extraction invents a parameter',()=>{
  const score=scoreCase(expected,{domain:'weather',api:'weather.query',extractedArguments:{place_text:'上海',date_ref:'today'},status:'ready_mock'});
  assert.equal(score.domain,true); assert.equal(score.api,true); assert.equal(score.arguments,false); assert.equal(score.plan,false);
});
test('default sources are part of full plan correctness when annotated',()=>{
  const score=scoreCase({...expected,sources:{date:'system_time'}},{domain:'weather',api:'weather.query',extractedArguments:{place_text:'上海'},status:'ready_mock',resolved:{sources:{date:'user'}}});
  assert.equal(score.arguments,true); assert.equal(score.sources,false); assert.equal(score.plan,false);
});
test('execution errors stay in the accuracy denominator and latency distribution',()=>{
  const rows=[{model:'small',score:{domain:true,api:true,arguments:true,status:true,plan:true},run:{totalMs:100,traces:[{loadMs:20}]}},{model:'small',score:{domain:false,api:false,arguments:false,status:false,plan:false},run:{totalMs:900,status:'error',traces:[]}}];
  const summary=summarize(rows)[0]; assert.equal(summary.total,2); assert.equal(summary.planAccuracy,0.5); assert.equal(summary.errorCount,1); assert.equal(summary.p50Ms,500); assert.equal(summary.p95Ms,860);
});
test('empty and null argument objects normalize for unsupported results',()=>{
  assert.equal(scoreCase({domain:'unsupported',api:null,arguments:{},status:'unsupported'},{domain:'unsupported',api:null,status:'unsupported'}).plan,true);
});

test('annotated precision and fallback constraints participate in full-plan accuracy',()=>{
  const gold={...expected,resolution:{time:{effective:{dataset:'hourly',precision:'hour'},fallback:{applied:true}},location:{precision:'city'}}};
  const run={domain:expected.domain,api:expected.api,extractedArguments:expected.arguments,status:expected.status,resolved:{resolution:{time:{requested:{precision:'minute'},effective:{dataset:'hourly',precision:'hour',range:{}},fallback:{applied:true,reason:'minute unavailable'}},location:{precision:'city',effective:{source:'fixture'}}}}};
  assert.equal(scoreCase(gold,run).plan,true);
  run.resolved.resolution.time.effective.precision='minute';
  assert.equal(scoreCase(gold,run).resolution,false);
  assert.equal(scoreCase(gold,run).plan,false);
  assert.equal(scoreCase(expected,run).plan,true);
});
