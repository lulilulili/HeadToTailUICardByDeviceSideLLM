import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {sha256,workspacePath,verifySourceBytes,verifyStoredRecord,verifyPublicationWindow,verifyKeyOrder,stablePublicManifest} from '../scripts/verify-single-service-100.mjs';
import {SINGLE_SERVICE_100_MODELS as models,SINGLE_SERVICE_100_CONTEXT as baseContext} from '../src/single-service-100.mjs';
import {compactRecord} from '../scripts/benchmark-single-service-100.mjs';
import {scoreCase} from '../src/evaluation.mjs';
import {scoreExecutionSemantics} from '../src/semantic-evaluation.mjs';
import {getCapability} from '../src/registry.mjs';
import {resolveArguments} from '../src/resolver.mjs';

// Tiny in-memory stubs only. Do not load the 1000-case corpus, read ongoing
// results, scan evidence, write files, start a server, or call a model.
const manifest={id:'audit-stub',status:'completed',conditions:{promptVersion:'test-only',options:{num_ctx:2048,num_predict:224,timeoutMs:180000,temperature:0}}};
const definition={id:'e100-device-stub',testDomain:'device',scenario:'audit-only',text:'查看手机剩余电量',origin:'new-900-fixed-before-inference',
 expected:{domain:'device',api:'device.battery.level',arguments:{},status:'ready_mock'}};
function stub(patch={}){
 const context=structuredClone(baseContext),resolved=resolveArguments(getCapability(definition.expected.api),{},context);
 const trace={stage:'unified',model:models[0],provider:'ollama',promptVersion:'test-only',raw:JSON.stringify({domain:'device',api:definition.expected.api,arguments:{}})};
 const run={model:models[0],mode:'unified',text:definition.text,domain:'device',api:definition.expected.api,status:resolved.status,context,options:manifest.conditions.options,
  modelArguments:{},extractedArguments:{},groundedArguments:{},resolved,candidates:{unified:{ids:[definition.expected.api]}},traces:[trace],totalMs:1,...patch};
 const record={manifestId:manifest.id,model:models[0],caseId:definition.id,testDomain:definition.testDomain,scenario:definition.scenario,text:definition.text,origin:definition.origin,
  expected:structuredClone(definition.expected),contractBoundary:null,userGoalStatus:null,context,run,
  rawScore:scoreCase(definition.expected,run),execution:scoreExecutionSemantics(definition.expected,run,run.context??context)};
 return record;
}
const bytes=record=>Buffer.from(JSON.stringify(record));
const registered=record=>compactRecord({...record,recordSha256:sha256(bytes(record))});
const verify=(record,row=registered(record))=>verifyStoredRecord({bytes:bytes(record),model:models[0],caseDefinition:definition,manifest,registeredRow:row});

test('a single saved stub independently matches ownership, SHA, scores and every compact index field',()=>{
 const record=stub(),before=structuredClone(record),result=verify(record);
 assert.deepEqual(record,before);assert.equal(result.digest,sha256(bytes(record)));
 assert.equal(result.row.primary,'correct');assert.equal(result.row.rawScore.plan,true);assert.equal(result.row.execution.plan,true);
 assert.equal(result.row.recordSha256,result.digest);
});

test('registered byte digests and compact fields cannot silently change',()=>{
 const record=stub(),row=registered(record);
 assert.throws(()=>verify(record,{...row,recordSha256:'0'.repeat(64)}),/raw SHA-256 differs/);
 assert.throws(()=>verify(record,{...row,primary:'parameters'}),/compactRecord\/index/);
 assert.throws(()=>verify(record,{...row,origin:'previous-100-development'}),/compactRecord\/index/);
});

test('ownership includes domain, scenario, origin, gold, phone context and user-goal metadata',()=>{
 for(const [field,value]of Object.entries({manifestId:'other',model:models[1],caseId:'other',text:'不同提示',testDomain:'weather',scenario:'different',
  origin:'previous-100-development',expected:{...definition.expected,api:'device.battery.chargingStatus'},context:{location:null},contractBoundary:'invented',userGoalStatus:'needs_clarification'})){
  const record=stub();record[field]=value;
  assert.throws(()=>verify(record),new RegExp(`ownership\\.${field}`),field);
 }
});

test('stored raw and execution scores are recomputed, not trusted',()=>{
 const raw=stub();raw.rawScore.arguments=false;assert.throws(()=>verify(raw),/recomputed rawScore/);
 const final=stub();final.execution.plan=false;assert.throws(()=>verify(final),/recomputed execution/);
 const self=stub();self.recordSha256='pretend-digest';assert.throws(()=>verify(self),/self-referential/);
});

test('schema errors, timeouts and postprocessing errors remain three formal score rows',()=>{
 const failures=[
  stub({status:'error',error:'schema invalid',domain:null,api:null,resolved:null,traces:[{stage:'unified',model:models[0],raw:'{}',error:'schema invalid'}]}),
  stub({status:'error',error:'provider timed out',domain:null,api:null,resolved:null,traces:[{stage:'unified',model:models[0],raw:'',error:'provider timed out',errorType:'TimeoutError'}]}),
  stub({status:'error',error:'invalid timezone',resolved:null})
 ];
 const verified=failures.map(record=>verify(record).row);
 assert.equal(verified.length,3);assert.deepEqual(verified.map(row=>row.primary),['provider_contract','provider_timeout','rule_error']);
 assert.ok(verified.every(row=>row.rawScore.plan===false&&row.execution.plan===false));
 assert.deepEqual(verified.map(row=>row.providerError),[true,true,false]);
});

test('a different record model in run/trace, trace omission or extra call is rejected',()=>{
 assert.throws(()=>verify(stub({model:'qwen2.5:7b'})),/run.model/);
 assert.throws(()=>verify(stub({traces:[{stage:'unified',model:'qwen2.5:7b',raw:''}]})),/trace.model/);
 assert.throws(()=>verify(stub({traces:[]})),/one formal unified model trace/);
 const record=stub();record.run.traces.push(structuredClone(record.run.traces[0]));assert.throws(()=>verify(record),/one formal unified model trace/);
 assert.throws(()=>verify(stub({stages:{unified:{model:'qwen2.5:7b'}}})),/stage model override/);
});

test('manifest-selected 7B records and 4000-count publication are valid without changing legacy 3000 audit',()=>{
 const chosen=structuredClone(manifest);chosen.conditions.models=models;chosen.conditions.modelOrder=models;
 const record=stub();record.model=models[3];record.run.model=models[3];record.run.traces[0].model=models[3];
 const result=verifyStoredRecord({bytes:bytes(record),model:models[3],caseDefinition:definition,manifest:chosen});
 assert.equal(result.row.model,'qwen2.5:7b');assert.equal(result.row.primary,'correct');
 const legacy={...chosen,conditions:{...chosen.conditions,models:models.slice(0,3),modelOrder:models.slice(0,3)}};
 assert.throws(()=>verifyStoredRecord({bytes:bytes(record),model:models[3],caseDefinition:definition,manifest:legacy}),/outside manifest/);
 assert.deepEqual(verifyPublicationWindow({savedCount:4000,indexedCount:4000,reportedDone:4000,manifestDone:4000,complete:true,plannedTotal:4000}),{unindexed:0,unpublishedInReport:0});
 assert.throws(()=>verifyPublicationWindow({savedCount:3000,indexedCount:3000,reportedDone:3000,manifestDone:3000,complete:true,plannedTotal:4000}),/all 4000/);
});

test('run context cannot differ from the frozen record phone fixture even if derived scores were rewritten',()=>{
 const record=stub();record.run.context={...record.context,now:'2030-01-01T00:00:00Z'};
 record.execution=scoreExecutionSemantics(definition.expected,record.run,record.run.context);
 assert.throws(()=>verify(record),/run.context/);
});

test('an unindexed partial stub still requires ownership and independently correct scores',()=>{
 const record=stub(),result=verifyStoredRecord({bytes:bytes(record),model:models[0],caseDefinition:definition,manifest});
 assert.equal(result.row.recordSha256,sha256(bytes(record)));assert.equal(result.row.primary,'correct');
 record.execution.plan=false;
 assert.throws(()=>verifyStoredRecord({bytes:bytes(record),model:models[0],caseDefinition:definition,manifest}),/recomputed execution/);
});

test('partial publication allows at most nine unindexed saves and reports every progress separately',()=>{
 assert.deepEqual(verifyPublicationWindow({savedCount:29,indexedCount:20,reportedDone:28,manifestDone:29}),{unindexed:9,unpublishedInReport:1});
 assert.deepEqual(verifyPublicationWindow({savedCount:0,indexedCount:0,reportedDone:0,manifestDone:0}),{unindexed:0,unpublishedInReport:0});
 assert.throws(()=>verifyPublicationWindow({savedCount:30,indexedCount:20,reportedDone:30,manifestDone:30}),/gap exceeds 9/);
 assert.throws(()=>verifyPublicationWindow({savedCount:9,indexedCount:10,reportedDone:9,manifestDone:9}),/raw file is missing/);
 assert.throws(()=>verifyPublicationWindow({savedCount:21,indexedCount:20,reportedDone:19,manifestDone:21}),/retry --partial/);
 assert.throws(()=>verifyPublicationWindow({savedCount:21,indexedCount:20,reportedDone:21,manifestDone:22}),/retry --partial/);
});

test('complete publication requires 3000, not a smaller finished-looking denominator',()=>{
 assert.deepEqual(verifyPublicationWindow({savedCount:3000,indexedCount:3000,reportedDone:3000,manifestDone:3000,complete:true}),{unindexed:0,unpublishedInReport:0});
 assert.throws(()=>verifyPublicationWindow({savedCount:20,indexedCount:20,reportedDone:20,manifestDone:20,complete:true}),/all 3000/);
 assert.throws(()=>verifyPublicationWindow({savedCount:3000,indexedCount:3000,reportedDone:3001,manifestDone:3000}),/Invalid formal/);
});

test('index is an ordered prefix and unindexed saves are the next frozen order tail, never arbitrary future keys',()=>{
 const expectedKeys=['modelA/c1','modelA/c2','modelA/c3','modelB/c1','modelB/c2'];
 assert.equal(verifyKeyOrder({indexedKeys:expectedKeys.slice(0,2),savedKeys:['modelA/c3','modelA/c1','modelA/c2'],expectedKeys}),true);
 assert.equal(verifyKeyOrder({indexedKeys:[],savedKeys:[],expectedKeys}),true);
 assert.throws(()=>verifyKeyOrder({indexedKeys:['modelA/c2','modelA/c1'],savedKeys:expectedKeys.slice(0,2),expectedKeys}),/Index row order/);
 assert.throws(()=>verifyKeyOrder({indexedKeys:['modelA/c1'],savedKeys:['modelA/c1','modelB/c1'],expectedKeys}),/Saved raw keys/);
 assert.throws(()=>verifyKeyOrder({indexedKeys:['modelA/c1','modelA/c1'],savedKeys:expectedKeys.slice(0,2),expectedKeys}),/Duplicate saved\/index/);
});

test('both current source and frozen snapshot must match the reference digest',()=>{
 const current=Buffer.from('small fixture source'),snapshot=Buffer.from('small fixture source'),digest=sha256(current);
 assert.deepEqual(verifySourceBytes('src/fixture.mjs',digest,current,snapshot),{path:'src/fixture.mjs',sha256:digest});
 assert.throws(()=>verifySourceBytes('src/fixture.mjs',digest,Buffer.from('changed'),snapshot),/Current source differs/);
 assert.throws(()=>verifySourceBytes('src/fixture.mjs',digest,current,Buffer.from('changed')),/Frozen snapshot differs/);
 assert.throws(()=>verifySourceBytes('src/fixture.mjs','not-a-sha',current,snapshot),/Invalid frozen source/);
});

test('all auditor-resolved paths must remain inside the specified workspace',()=>{
 const root=resolve('audit-path-unit-fixture');assert.equal(workspacePath(root,'src/stub.mjs'),resolve(root,'src/stub.mjs'));
 assert.throws(()=>workspacePath(root,'../outside.json'),/escapes workspace/);
 assert.throws(()=>workspacePath(root,resolve(root,'..','outside.json')),/escapes workspace/);
 assert.throws(()=>workspacePath(root,''),/nonempty/);
});

test('public manifests are completed-only and stable across runner/active/update variations',()=>{
 const original={...manifest,updatedAt:'first',runner:{pid:123,startedAt:'different'},active:{caseId:'transient'},corpus:{sha256:'frozen'},warmups:[{excludedFromScores:true}]};
 const before=structuredClone(original),publicOne=stablePublicManifest(original);
 assert.deepEqual(original,before);assert.equal(Object.hasOwn(publicOne,'runner'),false);assert.equal(Object.hasOwn(publicOne,'active'),false);assert.equal(Object.hasOwn(publicOne,'updatedAt'),false);
 assert.deepEqual(publicOne,stablePublicManifest({...original,runner:{pid:456},active:null,updatedAt:'second'}));
 assert.deepEqual(publicOne.corpus,original.corpus);assert.deepEqual(publicOne.warmups,original.warmups);
 assert.throws(()=>stablePublicManifest({...original,status:'running'}),/only available for completed/);
});
