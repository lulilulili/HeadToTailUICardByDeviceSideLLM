import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBaselineBinding,buildComparisonBaseline} from '../scripts/comparison-baseline.mjs';
import {cellSummary} from '../src/single-service-100-report.mjs';
const models=['qwen2.5:0.5b','qwen2.5:1.5b','qwen2.5:3b','qwen2.5:7b'];
const domains=['weather','calendar','contacts','files','services','cloud','device','connectivity','location','media'];
function fixture(){
 const order=Array.from({length:100},(_,i)=>domains.map(domain=>`e100-${domain}-${String(i+1).padStart(3,'0')}`)).flat();
 const expected={corpusHash:'corpus',caseOrder:order,models,modelDetails:models.map(name=>({name,digest:name+'-sha'})),options:{num_ctx:2048,num_predict:224,temperature:0,timeoutMs:180000},context:{now:'frozen'}};
 const manifest={id:'baseline',status:'completed',corpus:{sha256:'corpus',caseOrder:expected.caseOrder,total:1000,perDomain:100},conditions:{...expected,domains,mode:'unified'}};
 const rows=models.flatMap(model=>expected.caseOrder.map((caseId,i)=>({model,caseId,testDomain:domains[i%10],primary:'correct',origin:'synthetic-no-model',wallMs:10,rawScore:{domain:i%11!==0,api:i%3!==0,arguments:i%4!==0},execution:{plan:i%5!==0}})));
 const summary=models.map(model=>cellSummary(rows.filter(r=>r.model===model),{model,planned:1000})),cells=models.flatMap(model=>domains.map(testDomain=>cellSummary(rows.filter(r=>r.model===model&&r.testDomain===testDomain),{model,testDomain,planned:100})));
 return {expected,manifest,report:{id:'baseline',status:'completed',conditions:manifest.conditions,corpus:manifest.corpus,summary,cells},index:{manifestId:'baseline',status:'completed',rows}};
}
test('baseline binding pins corpus, order, digest, settings and context independently of new mode',()=>{
 const f=fixture();assert.equal(validateBaselineBinding(f,f.expected),true);
 for(const key of ['corpusHash','caseOrder','models','modelDetails','options','context']){
  const e=structuredClone(f.expected);e[key]=key==='corpusHash'?'changed':Array.isArray(e[key])?[]:{};
  assert.throws(()=>validateBaselineBinding(f,e),/baseline/i,key);
 }
});
test('partial, wrong-mode, mixed-owner and duplicate raw keys cannot become a comparison baseline',()=>{
 for(const mutate of [f=>f.manifest.status='running',f=>f.manifest.conditions.mode='adaptive',f=>f.report.id='other',f=>f.index.manifestId='other',f=>f.index.rows[1]=f.index.rows[0],f=>f.index.rows.pop()]){
  const f=fixture();mutate(f);assert.throws(()=>validateBaselineBinding(f,f.expected),/baseline/i);
 }
});
test('baseline request totals and means come from all saved formal rows, including failures',()=>{
 const f=fixture();f.index.rows[0].error='timeout';f.index.rows[0].wallMs=30;
 const result=buildComparisonBaseline(f,{reportPath:'report',reportSha256:'r',indexSha256:'i',sourcePath:'manifest'});
 assert.equal(result.summary[0].timing.requestTotalMs,10020);assert.equal(result.summary[0].timing.requestMeanMs,10.02);
 assert.equal(result.cells[0].timing.requestTotalMs,1020);assert.equal(result.corpusSha256,'corpus');
 assert.notEqual(f.report.summary[0].timing.requestTotalMs,10020);
});

test('baseline rejects changed summary accuracy/counts and latency against the saved index',()=>{
 for(const mutate of [r=>r.domain.correct--,r=>r.api.accuracy=0,r=>r.rawArguments.total=999,r=>r.semantics.correct++,r=>r.p50Ms++,r=>r.p95Ms++]){
  const f=fixture();mutate(f.report.summary[0]);assert.throws(()=>validateBaselineBinding(f,f.expected),/baseline/i);
 }
});

test('baseline requires all forty unique complete model/domain cells with one hundred cases each',()=>{
 for(const mutate of [f=>f.report.cells=[],f=>f.report.cells.pop(),f=>f.report.cells[0].testDomain='files',f=>f.report.cells[0].model=models[1],f=>f.report.cells[0].planned=99,f=>f.report.cells[0].total=99,f=>f.report.cells[0].complete=false,f=>f.report.cells[0].api.correct--,f=>f.report.cells[0].p95Ms++]){
  const f=fixture();mutate(f);assert.throws(()=>validateBaselineBinding(f,f.expected),/baseline/i);
 }
});

test('baseline scope follows frozen case identities even if raw domain tags preserve aggregate counts',()=>{
 const f=fixture();[f.index.rows[0].testDomain,f.index.rows[3].testDomain]=[f.index.rows[3].testDomain,f.index.rows[0].testDomain];
 assert.throws(()=>validateBaselineBinding(f,f.expected),/baseline/i);
});

test('boolean evidence is required instead of treating missing score fields as false',()=>{
 for(const mutate of [f=>delete f.index.rows[0].rawScore.domain,f=>f.index.rows[0].rawScore.api='true',f=>delete f.index.rows[0].execution.plan]){
  const f=fixture();mutate(f);assert.throws(()=>validateBaselineBinding(f,f.expected),/baseline/i);
 }
});

test('decimal request quantiles and serialized fractional accuracies remain valid without rounding to integers',()=>{
 const f=fixture();f.index.rows.forEach((r,i)=>r.wallMs=(i%7+1)/10);
 f.report.summary=models.map(model=>cellSummary(f.index.rows.filter(r=>r.model===model),{model,planned:1000}));
 f.report.cells=models.flatMap(model=>domains.map(testDomain=>cellSummary(f.index.rows.filter(r=>r.model===model&&r.testDomain===testDomain),{model,testDomain,planned:100})));
 f.report.summary[0].api.accuracy+=Number.EPSILON;
 assert.equal(validateBaselineBinding(JSON.parse(JSON.stringify(f)),f.expected),true);
 const result=buildComparisonBaseline(f,{reportPath:'report',reportSha256:'r',indexSha256:'i',sourcePath:'manifest'});
 assert.equal(result.summary[0].p50Ms,.4);assert.equal(result.summary[0].p95Ms,.7);
});
