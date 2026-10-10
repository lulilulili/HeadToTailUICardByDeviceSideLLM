import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseCase,buildDomainReport} from '../src/domain-report.mjs';

const model='qwen2.5:3b';
const gold={domain:'weather',api:'weather.current.humidity',arguments:{time_ref:'明天'},status:'ready_mock'};
const good={domain:true,api:true,arguments:true,status:true,sources:true,resolution:true,plan:true};
const row=(score={},run={})=>({caseId:'w1',model,expected:gold,score:{...good,...score},run:{id:'run1',status:'ready_mock',domain:'weather',api:gold.api,extractedArguments:gold.arguments,totalMs:100,traces:[],...run}});

test('primary error attributes an upstream domain failure only once',()=>{
  const diagnosis=diagnoseCase(row({domain:false,api:false,arguments:false,plan:false},{domain:'calendar',api:'calendar.search'}));
  assert.equal(diagnosis.code,'domain_error');
});
test('a missing target candidate is distinct from a model choosing the wrong available API',()=>{
  const missing=row({api:false,plan:false},{api:'weather.query',candidates:{unified:{ids:['weather.query']}}});
  assert.equal(diagnoseCase(missing).code,'candidate_missing');
  missing.run.candidates.unified.ids.push(gold.api);
  assert.equal(diagnoseCase(missing).code,'api_error');
});
test('parameter diagnoses distinguish extra contextual guesses, omission, and rewrites',()=>{
  assert.equal(diagnoseCase(row({arguments:false,plan:false},{extractedArguments:{...gold.arguments,location:'上海'}})).code,'arguments_extra');
  assert.equal(diagnoseCase(row({arguments:false,plan:false},{extractedArguments:{}})).code,'arguments_missing');
  const changed=diagnoseCase(row({arguments:false,plan:false},{extractedArguments:{time_ref:'2026-10-11'}}));
  assert.equal(changed.code,'arguments_value');assert.match(changed.reason,/time_ref|时间/);
});
test('provider and structured-output failures take priority over downstream mismatches',()=>{
  assert.equal(diagnoseCase(row({domain:false,api:false,arguments:false,plan:false},{status:'error',error:'输出 schema 结构校验失败'})).code,'service_error');
  assert.equal(diagnoseCase(row()).code,'correct');
});
test('resolution provenance mismatch is independent from a correct extraction',()=>{
  assert.equal(diagnoseCase(row({sources:false,plan:false})).code,'resolution_error');
});
test('report groups by the test domain and counts failed refusals in the completed denominator',()=>{
  const cases=[{id:'w1',suite:'domain-50-v1',testDomain:'weather',scenario:'field',category:'字段'}, {id:'w2',suite:'domain-50-v1',testDomain:'weather',scenario:'refusal',category:'拒识'}];
  const manifest={id:'suite1',suite:'domain-50-v1',status:'running',mode:'unified',models:[model],entries:[{jobId:'job1',testDomain:'weather',model}]};
  const refused={...row({plan:false,domain:false,api:false},{totalMs:900}),caseId:'w2',expected:{domain:'unsupported',api:null,arguments:{},status:'unsupported'}};
  const jobs=[{id:'job1',status:'running',progress:{done:2,total:50},results:[row(),refused]}];
  const report=buildDomainReport(manifest,cases,jobs);
  const summary=report.summary.find(value=>value.testDomain==='weather');
  assert.equal(summary.total,2);assert.equal(summary.targetTotal,50);assert.equal(summary.planAccuracy,0.5);
  assert.equal(summary.p50Ms,500);assert.equal(summary.p95Ms,860);
  assert.equal(report.progress.done,2);assert.equal(report.progress.total,300);
  assert.equal(report.errors.filter(value=>value.testDomain==='weather').reduce((n,value)=>n+value.count,0),1);
});
test('manifest isolates the active comparison and gives unrun cells null metrics',()=>{
  const manifest={id:'suite1',suite:'domain-50-v1',models:[model],status:'running',entries:[{jobId:'new'}]};
  const cases=[{id:'w1',suite:'domain-50-v1',testDomain:'weather',scenario:'field',category:'字段'}];
  const report=buildDomainReport(manifest,cases,[{id:'old',results:[row()]}]);
  assert.equal(report.progress.done,0);
  assert.equal(report.summary.length,6);
  assert.equal(report.summary[0].planAccuracy,null);assert.equal(report.summary[0].p50Ms,null);
});
test('unavailable timing is excluded from quantiles while real zero remains zero',()=>{
  const manifest={id:'s',suite:'domain-50-v1',models:[model],entries:[{jobId:'j'}]};
  const cases=[{id:'w1',suite:'domain-50-v1',testDomain:'weather',scenario:'field'}];
  const report=buildDomainReport(manifest,cases,[{id:'j',results:[row({}, {totalMs:null}),row({}, {totalMs:0})]}]);
  assert.equal(report.summary[0].p50Ms,0);assert.equal(report.summary[0].total,2);
});
