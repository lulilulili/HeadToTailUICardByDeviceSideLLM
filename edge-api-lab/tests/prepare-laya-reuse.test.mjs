import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareLayaReuseSeed,requestSha256,writeLayaReuseSeed} from '../scripts/prepare-laya-reuse.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const models=['qwen2.5:0.5b','qwen2.5:1.5b'];
const id='single-service-100-seed-fixture';
const request=()=>({state:{text:'查询当前音量'},model:'multilingual',questions:{api:{type:'choice',instructions:'选择业务',criteria:{c000:'音量',c001:'静音'}}},max_len:4096,head_max_len:768,lang:'zh'});
const native=()=>({model:'laya-rl-agent',answers:{api:{type:'choice',choice:'c000',probabilities:{c000:.8,c001:.2},confidence:.3}},usage:{truncated:false,state_tokens_dropped:0,truncated_questions:[]}});
function record(model,caseId='e100-media-001',patch={}){
 const trace={provider:'laya',stage:'intent',httpStatus:200,request:request(),raw:JSON.stringify(native()),wallMs:12.5,inferenceMs:9.25,truncated:false,startedAt:'2026-10-13T05:00:00Z',completedAt:'2026-10-13T05:00:00.012Z',...patch};
 return {manifestId:id,model,caseId,testDomain:'media',expected:{api:'THIS_GOLD_MUST_NOT_BE_USED'},run:{model},shadow:{policy:'same-candidates-qwen-authoritative-v1',decisions:[{stage:'intent',expected:'DO_NOT_READ_GOLD',laya:{selected:'DO_NOT_USE_SELECTION',trace}}]}};
}
async function fixture(records,fn,{warmup=false}={}){
 const root=await mkdtemp(join(tmpdir(),'edge-laya-seed-'));
 try{
  const manifest={id,status:'running',conditions:{models,layaShadow:{enabled:true,policy:'same-candidates-qwen-authoritative-v1',observedStatus:{model:'multilingual',modelRevision:'7b928d828b7b0e022f929d9bd2e44165aa270148',version:'0.4.6',threads:8,device:'cpu',tournamentGroup:16,maxChoices:255,maxLen:4096,headMaxLen:768}}},corpus:{caseOrder:[...new Set(records.map(r=>r.caseId))]},storage:{evidenceRoot:'evidence/'+id,indexPath:'evidence/'+id+'/index.json'},warmups:[]};
  const rows=[];
  for(const r of records){const relative=`evidence/${id}/${r.model.replace(':','-')}/${r.caseId}.json`,path=join(root,relative),bytes=JSON.stringify(r);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);rows.push({model:r.model,caseId:r.caseId,recordSha256:hash(bytes)});}
  if(warmup){const path='evidence/'+id+'/warmups/first.json',run={model:models[0],shadow:record(models[0],undefined,{request:{...request(),state:{text:'预热'}}}).shadow};await mkdir(dirname(join(root,path)),{recursive:true});const bytes=JSON.stringify(run);await writeFile(join(root,path),bytes);manifest.warmups.push({model:models[0],path,recordSha256:hash(bytes)});}
  await mkdir(join(root,'data/runtime'),{recursive:true});await writeFile(join(root,'data/runtime/manifest.json'),JSON.stringify(manifest));await writeFile(join(root,manifest.storage.indexPath),JSON.stringify({manifestId:id,rows}));
  return await fn({root,manifestPath:'data/runtime/manifest.json',manifest,records,rows});
 }finally{assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.ok(root.includes('edge-laya-seed-'));await rm(root,{recursive:true,force:true});}
}

test('first valid native response is retained with byte hashes and original measured times',async()=>{
 await fixture([record(models[0]),record(models[1])],async input=>{
  const seed=await prepareLayaReuseSeed(input);assert.equal(seed.entries.length,1);
  const e=seed.entries[0];assert.deepEqual(e.request,request());assert.equal(e.responseRaw,JSON.stringify(native()));
  assert.equal(e.requestSha256,hash(JSON.stringify(request())));assert.equal(e.responseSha256,hash(e.responseRaw));
  assert.equal(e.originalWallMs,12.5);assert.equal(e.originalInferenceMs,9.25);assert.equal(e.originalServiceWallMs,null);
  assert.equal(e.origin.model,models[0]);assert.equal(e.origin.recordSha256,input.rows[0].recordSha256);
  assert.equal(seed.summary.duplicates,1);assert.equal(seed.summary.conflicts,0);
  assert.equal(seed.namespace,id);assert.equal(seed.profile.threads,8);assert.equal(seed.profile.layaVersion,'0.4.6');
  assert.equal(JSON.stringify(e).includes('THIS_GOLD'),false);assert.equal(JSON.stringify(e).includes('DO_NOT_'),false);
 });
});
test('complete request order and candidate values affect the key, never gold or Qwen model',()=>{
 const a=request(),b=structuredClone(a);b.questions.api.criteria={c001:'静音',c000:'音量'};
 assert.equal(requestSha256(a),hash(JSON.stringify(a)));assert.notEqual(requestSha256(a),requestSha256(b));
 b.questions.api.criteria={c000:'音量',c001:'输出设备'};assert.notEqual(requestSha256(a),requestSha256(b));
 b.state.domain='cloud';assert.notEqual(requestSha256(a),requestSha256(b));
});
test('same request with a different response is counted without replacing the first result',async()=>{
 const different=native();different.answers.api.choice='c001';different.answers.api.probabilities={c000:.2,c001:.8};
 await fixture([record(models[0]),record(models[1],undefined,{raw:JSON.stringify(different)})],async input=>{
  const seed=await prepareLayaReuseSeed(input);assert.equal(seed.entries.length,1);assert.equal(seed.entries[0].responseRaw,JSON.stringify(native()));assert.equal(seed.summary.conflicts,1);
 });
});
test('errors, malformed native probabilities, truncation and collapsed options cannot seed reuse',async()=>{
 const bad=native();bad.answers.api.probabilities={c000:2,c001:-1};
 const variants=[{error:'failed'},{httpStatus:500},{raw:JSON.stringify(bad)},{truncated:true},{raw:JSON.stringify({...native(),usage:{state_tokens_dropped:1}})},{raw:JSON.stringify({...native(),usage:{truncated_questions:['api']}})},{raw:JSON.stringify({...native(),usage:{options:{api:{distinct:1,total:2}}}})}];
 await fixture(variants.map((patch,i)=>record(models[0],`e100-media-${String(i+1).padStart(3,'0')}`,patch)),async input=>{
  const seed=await prepareLayaReuseSeed(input);assert.equal(seed.entries.length,0);assert.equal(seed.summary.skippedDecisions,variants.length);
 });
});
test('managed cache-miss metadata is not an original native response eligible for re-seeding',async()=>{
 const response={...native(),x_benchmark_reuse:{hit:false,inferenceExecuted:true}};
 await fixture([record(models[0],undefined,{raw:JSON.stringify(response)})],async input=>{
  const seed=await prepareLayaReuseSeed(input);assert.equal(seed.entries.length,0);
  assert.equal(seed.summary.skippedReasons.reuse_managed_response,1);
 });
});
test('registered formal record SHA mismatch refuses the export instead of trusting rewritten evidence',async()=>{
 await fixture([record(models[0])],async input=>{
  const p=join(input.root,`evidence/${id}/${models[0].replace(':','-')}/e100-media-001.json`);await writeFile(p,'{}');
  await assert.rejects(()=>prepareLayaReuseSeed(input),/SHA|hash/i);
 });
});
test('warmups are excluded by default and optional inclusion keeps their provenance separate',async()=>{
 await fixture([record(models[0])],async input=>{
  assert.equal((await prepareLayaReuseSeed(input)).entries.length,1);
  const seed=await prepareLayaReuseSeed({...input,includeWarmups:true});assert.equal(seed.entries.length,2);
  assert.equal(seed.entries[1].origin.kind,'warmup');
 },{warmup:true});
});
test('unknown native inference duration stays null and atomic seed writing does not modify evidence',async()=>{
 await fixture([record(models[0],undefined,{inferenceMs:null})],async input=>{
  const path=join(input.root,`evidence/${id}/${models[0].replace(':','-')}/e100-media-001.json`),before=await readFile(path);
  const seed=await prepareLayaReuseSeed(input);assert.equal(seed.entries[0].originalInferenceMs,null);assert.equal(seed.entries[0].firstDurationMs,null);
  const out=join(input.root,'data/runtime/reuse-seed.json');await writeLayaReuseSeed(seed,out);
  assert.equal(JSON.parse(await readFile(out,'utf8')).namespace,id);assert.deepEqual(await readFile(path),before);
  await assert.rejects(()=>writeLayaReuseSeed(seed,path),/evidence|source|read.only/i);
 });
});
