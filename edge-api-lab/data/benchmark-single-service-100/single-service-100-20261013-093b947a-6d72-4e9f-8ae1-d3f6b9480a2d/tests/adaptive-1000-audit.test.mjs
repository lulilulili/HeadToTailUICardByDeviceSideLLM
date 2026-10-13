import test from 'node:test';
import assert from 'node:assert/strict';
import {runPipeline} from '../src/pipeline.mjs';
import {verifyStoredRecord,auditEnginePolicy} from '../scripts/verify-single-service-100.mjs';
import {scoreCase} from '../src/evaluation.mjs';
import {scoreExecutionSemantics} from '../src/semantic-evaluation.mjs';
import {compactRecord} from '../scripts/benchmark-single-service-100.mjs';
import {SINGLE_SERVICE_100_CONTEXT as context} from '../src/single-service-100.mjs';
const model='qwen2.5:0.5b';
async function record(){
 const c={id:'audit-adaptive',testDomain:'device',scenario:'audit',text:'查本机电量',origin:'new-900-fixed-before-inference',expected:{domain:'device',api:'device.battery.level',arguments:{},status:'ready_mock'}};
 const providers={ollama:{invoke:async req=>{const value=req.stage==='domain'?{domain:'device'}:{api:'device.battery.level',arguments:{}};return{value,trace:{stage:req.stage,provider:'ollama',model,raw:JSON.stringify(value),wallMs:1,promptVersion:req.promptMeta.version,promptMeta:req.promptMeta}};}}};
 const run=await runPipeline({text:c.text,model,mode:'adaptive',options:{num_ctx:2048,num_predict:224,temperature:0,timeoutMs:180000},context},{providers});
 const manifest={id:'new-adaptive',version:'single-service-100-batch-v3',status:'running',conditions:{mode:'adaptive',promptVersion:'adaptive-v2',routingPolicy:'adaptive-routing-v1',options:run.options,context}};
 const r={manifestId:manifest.id,model,caseId:c.id,testDomain:c.testDomain,scenario:c.scenario,text:c.text,origin:c.origin,expected:c.expected,contractBoundary:null,userGoalStatus:null,context,run,rawScore:scoreCase(c.expected,run),execution:scoreExecutionSemantics(c.expected,run,context)};
 return{c,r,manifest};
}
test('offline audit accepts the primary adaptive two-call case and preserves all stage timings',async()=>{
 const {c,r,manifest}=await record();const result=verifyStoredRecord({bytes:Buffer.from(JSON.stringify(r)),model,caseDefinition:c,manifest});
 assert.equal(result.row.actualCallCount,2);assert.deepEqual(result.row.traceTimings.map(t=>t.stage),['domain','intent_arguments']);
 assert.equal(result.row.modelCallMs,2);assert.equal(result.row.wallMs,r.run.totalMs);assert.deepEqual(result.row,compactRecord({...r,recordSha256:result.digest}));
});
test('running v3 source must still match current workspace; only completed v3 uses frozen engine',()=>{
 assert.deepEqual(auditEnginePolicy({version:'single-service-100-batch-v3',status:'running'}),{legacyFormat:false,useFrozenEngine:false});
 assert.deepEqual(auditEnginePolicy({version:'single-service-100-batch-v3',status:'completed'}),{legacyFormat:false,useFrozenEngine:true});
});
test('adaptive audit rejects changed phase, routed model/provider, missing timing and false routing counts',async()=>{
 const {c,r,manifest}=await record();
 for(const mutate of [r=>r.run.mode='unified',r=>r.run.traces[1].stage='arguments',r=>r.run.traces[0].model='qwen2.5:7b',r=>r.run.traces[0].provider='laya',r=>r.run.routing.actualCallCount=3,r=>r.run.traces[0].wallMs=-1]){
  const changed=structuredClone(r);mutate(changed);assert.throws(()=>verifyStoredRecord({bytes:Buffer.from(JSON.stringify(changed)),model,caseDefinition:c,manifest}));
 }
});
