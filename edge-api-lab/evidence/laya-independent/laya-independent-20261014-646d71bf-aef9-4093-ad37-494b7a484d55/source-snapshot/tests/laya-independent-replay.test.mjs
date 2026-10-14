import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createLayaIndependentReplayProvider,verifyLayaIndependentReplayTrace} from '../src/laya-independent-replay.mjs';

const sha=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const profile={model:'multilingual',modelRevision:'revision',layaVersion:'0.4.6',threads:8,device:'cpu',tournamentGroup:16,maxChoices:255,maxLen:4096,headMaxLen:768};
const request={state:{text:'查明天的日程'},model:'multilingual',questions:{domain:{type:'choice',instructions:'选择领域',criteria:{calendar:'日历',weather:'天气'}}},max_len:4096,head_max_len:768,lang:'zh'};
const responseRaw=JSON.stringify({model:'laya-rl-agent',answers:{domain:{type:'choice',choice:'calendar',probabilities:{calendar:.8,weather:.2},confidence:.6}},usage:{state_tokens:5}});
const invokeRequest={stage:'domain',model:'multilingual',decision:{state:request.state,answerKey:'domain',question:request.questions.domain},schema:{type:'object',properties:{domain:{type:'string',enum:['calendar','weather']}},required:['domain'],additionalProperties:false},options:{timeoutMs:1000}};

async function fixture(t,{formal=false}={}){
 const root=await mkdtemp(join(tmpdir(),'laya-independent-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const namespace='single-service-100-test',cacheDirectory=join(root,'data/runtime/laya-reuse',namespace,'entries');await mkdir(cacheDirectory,{recursive:true});
 const key=sha(request),sourcePath=formal?'evidence/single-service-100/single-service-100-test/qwen2.5-0.5b/case.json':`data/runtime/laya-reuse/${namespace}/entries/${key}.service.json`;
 const source=formal?{manifestId:namespace,shadow:{decisions:[{stage:'domain',laya:{trace:{provider:'laya',stage:'domain',httpStatus:200,request,responseRaw:undefined,raw:responseRaw,inferenceMs:230,wallMs:250,startedAt:'2026-10-13T00:00:00Z'}}}]}}:{version:'laya-benchmark-reuse-v1',namespace,profile,request,requestSha256:key,responseRaw,inferenceMs:230,serviceWallMs:240,observedAt:'2026-10-13T00:00:00Z'};
 await mkdir(join(root,sourcePath,'..'),{recursive:true});const sourceBytes=JSON.stringify(source,null,2);await writeFile(join(root,sourcePath),sourceBytes);
 const origin=formal?{type:'formal',manifestId:namespace,recordPath:sourcePath,recordSha256:sha(sourceBytes),traceIndex:0,stage:'domain'}:{type:'service_inference',namespace,serviceRecordPath:sourcePath,serviceRecordSha256:sha(sourceBytes)};
 const entry={version:'laya-benchmark-reuse-v1',namespace,profile,request,requestSha256:key,responseRaw,responseSha256:sha(responseRaw),originalInferenceMs:230,originalWallMs:formal?250:null,originalServiceWallMs:formal?null:240,origin};const entryPath=join(cacheDirectory,key+'.entry.json');await writeFile(entryPath,JSON.stringify(entry));
 let liveCalls=0;const fetch=async()=>{liveCalls++;return new Response(responseRaw,{status:200,headers:{'x-inference-time-ms':'301'}});};
 return {root,cacheDirectory,profile,fetch,entry,entryPath,sourcePath,liveCalls:()=>liveCalls};
}

test('byte-identical native input reuses verified service response without HTTP inference',async t=>{
 const f=await fixture(t),p=await createLayaIndependentReplayProvider(f),r=await p.invoke(invokeRequest);
 assert.equal(r.value.domain,'calendar');assert.equal(f.liveCalls(),0);assert.equal(r.trace.raw,responseRaw);
 assert.equal(r.trace.inferenceMs,0);assert.equal(r.trace.independentReuse.hit,true);assert.equal(r.trace.independentReuse.verified,true);
 assert.equal(r.trace.independentReuse.sourceInferenceMs,230);assert.equal(r.trace.independentReuse.sourceServiceMs,240);
 assert.equal(r.trace.independentReuse.sourcePath,f.sourcePath);assert.equal(p.replayInventory.verifiedEntries,1);
});
test('formal response source is resolved by original trace and saved byte SHA',async t=>{
 const f=await fixture(t,{formal:true}),p=await createLayaIndependentReplayProvider(f),r=await p.invoke(invokeRequest);
 assert.equal(r.trace.independentReuse.sourceHttpMs,250);assert.equal(r.trace.independentReuse.sourceInferenceMs,230);assert.equal(f.liveCalls(),0);
});
test('different criterion order is a native byte miss and invokes current Laya',async t=>{
 const f=await fixture(t),p=await createLayaIndependentReplayProvider(f),changed=structuredClone(invokeRequest);
 changed.decision.question.criteria={weather:'天气',calendar:'日历'};const r=await p.invoke(changed);
 assert.equal(f.liveCalls(),1);assert.equal(r.trace.independentReuse.hit,false);assert.equal(r.trace.inferenceMs,301);
 assert.equal(r.trace.independentReuse.sourceInferenceMs,301);
});
test('source corruption is rejected before any historical result can be reused',async t=>{
 const f=await fixture(t);await writeFile(join(f.root,f.sourcePath),'{}');await assert.rejects(createLayaIndependentReplayProvider(f),/source.*SHA|来源.*SHA/i);assert.equal(f.liveCalls(),0);
});
test('profile mismatch cannot reuse the same native input under a different deployment',async t=>{
 const f=await fixture(t);await assert.rejects(createLayaIndependentReplayProvider({...f,profile:{...profile,threads:4}}),/profile|部署/i);
});
test('entry input or response SHA tampering is detected',async t=>{
 const f=await fixture(t);f.entry.request.state.text='其他输入';await writeFile(f.entryPath,JSON.stringify(f.entry));await assert.rejects(createLayaIndependentReplayProvider(f),/request.*SHA|请求.*SHA/i);
});
test('origin outside the project cannot read unrelated files',async t=>{
 const f=await fixture(t);f.entry.origin.serviceRecordPath='../outside.json';await writeFile(f.entryPath,JSON.stringify(f.entry));await assert.rejects(createLayaIndependentReplayProvider(f),/path|路径/i);
});
test('source timing is taken from verified native source rather than editable entry timing',async t=>{
 const f=await fixture(t);f.entry.originalInferenceMs=999999;await writeFile(f.entryPath,JSON.stringify(f.entry));const p=await createLayaIndependentReplayProvider(f),r=await p.invoke(invokeRequest);assert.equal(r.trace.independentReuse.sourceInferenceMs,230);
});
test('abort before access cannot execute a current or historical decision',async t=>{
 const f=await fixture(t),p=await createLayaIndependentReplayProvider(f),a=new AbortController();a.abort();await assert.rejects(p.invoke({...invokeRequest,signal:a.signal}));assert.equal(f.liveCalls(),0);
});
test('hash-consistent native protocol corruption cannot enter the trusted inventory',async t=>{
 const f=await fixture(t),source=JSON.parse(await readFile(join(f.root,f.sourcePath),'utf8')),bad=JSON.parse(responseRaw);
 bad.answers.domain.probabilities={calendar:.1,weather:.9};const raw=JSON.stringify(bad);source.responseRaw=raw;f.entry.responseRaw=raw;f.entry.responseSha256=sha(raw);
 const bytes=JSON.stringify(source);f.entry.origin.serviceRecordSha256=sha(bytes);await writeFile(join(f.root,f.sourcePath),bytes);await writeFile(f.entryPath,JSON.stringify(f.entry));
 await assert.rejects(createLayaIndependentReplayProvider(f),/protocol|协议/i);
});
test('formal failure cannot be replayed as a successful choice despite valid hashes',async t=>{
 const f=await fixture(t,{formal:true}),source=JSON.parse(await readFile(join(f.root,f.sourcePath),'utf8'));source.shadow.decisions[0].laya.trace.error='truncated input';
 const bytes=JSON.stringify(source);f.entry.origin.recordSha256=sha(bytes);await writeFile(join(f.root,f.sourcePath),bytes);await writeFile(f.entryPath,JSON.stringify(f.entry));
 await assert.rejects(createLayaIndependentReplayProvider(f),/successful|成功/i);
});
test('local contract failure before transport does not claim an inference attempt',async t=>{
 const f=await fixture(t),p=await createLayaIndependentReplayProvider(f);let e;try{await p.invoke({...invokeRequest,stage:'arguments'});}catch(error){e=error;}
 assert.ok(e);assert.equal(f.liveCalls(),0);assert.equal(e.trace.independentReuse.currentInferenceExecuted,false);assert.equal(e.trace.independentReuse.currentInferenceAttempted,false);
});
test('offline provenance audit rejects altered source timing even if raw choice remains correct',async t=>{
 const f=await fixture(t),p=await createLayaIndependentReplayProvider(f),r=await p.invoke(invokeRequest);
 assert.equal(verifyLayaIndependentReplayTrace(r.trace,p.replayInventory),true);
 r.trace.independentReuse.sourceInferenceMs=1;assert.throws(()=>verifyLayaIndependentReplayTrace(r.trace,p.replayInventory),/provenance|来源/i);
});
test('offline fresh provenance audit binds both native input and response bytes',async t=>{
 const f=await fixture(t),p=await createLayaIndependentReplayProvider(f),changed=structuredClone(invokeRequest);changed.decision.state.text='新的输入';const r=await p.invoke(changed);
 assert.equal(verifyLayaIndependentReplayTrace(r.trace,p.replayInventory),true);
 r.trace.independentReuse.requestSha256='0'.repeat(64);assert.throws(()=>verifyLayaIndependentReplayTrace(r.trace,p.replayInventory),/SHA/i);
});
