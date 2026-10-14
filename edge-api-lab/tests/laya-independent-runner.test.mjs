import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import * as runner from '../scripts/benchmark-laya-independent.mjs';
import {runLayaIndependentSelection,scoreIndependentSelection} from '../src/laya-independent-selection.mjs';
import {SINGLE_SERVICE_100_CONTEXT as context,SINGLE_SERVICE_100_DOMAINS as domains} from '../src/single-service-100.mjs';
import {capabilities} from '../src/registry.mjs';
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const profile={model:'multilingual',modelRevision:'test-revision',layaVersion:'0.4.6',threads:8,device:'cpu',tournamentGroup:16,maxChoices:255,maxLen:4096,headMaxLen:768};
const options={timeoutMs:180000,layaMaxLen:4096,layaHeadMaxLen:768};
const cases=[{id:'e100-files-unit',testDomain:'files',scenario:'read',text:'读取文件ID file_7的URI',expected:{domain:'files',api:'files.metadata.uri'}},{id:'e100-device-unit',testDomain:'device',scenario:'read',text:'读取本机电量',expected:{domain:'device',api:'device.battery.level'}}];
function provider(){
 return{defaultModel:'multilingual',calls:0,async invoke(req){
  this.calls++;const key=req.decision.answerKey,domain=req.decision.state.text.includes('文件')?'files':'device',answer=req.stage==='domain'?domain:domain==='files'?'files.metadata.uri':'device.battery.level',wire=Object.entries(req.decision.choiceMap??{}).find(([,id])=>id===answer)?.[0]??answer,keys=Object.keys(req.decision.question.criteria);
  const raw=JSON.stringify({model:'laya-rl-agent',answers:{[key]:{type:'choice',choice:wire,probabilities:Object.fromEntries(keys.map(k=>[k,k===wire?1:0])),confidence:1}},usage:{input_tokens:40,output_tokens:0}});
  return{value:{[key]:answer},trace:{stage:req.stage,provider:'laya',model:'laya-rl-agent',requestedModel:'multilingual',schema:req.schema,raw,wallMs:2,inferenceMs:1,httpCalls:1,request:{state:req.decision.state,model:'multilingual',questions:{[key]:req.decision.question},max_len:4096,head_max_len:768,lang:'zh'}}};
 }};
}
const manifest=()=>({version:'laya-independent-batch-v1',id:'laya-independent-20261014-unit',status:'planned',conditions:{policy:'laya-domain-soft-api-choice-v1',model:'multilingual',profile,options,context,sourceHashes:{stub:'hash'},baseline:{path:'baseline',sha256:'sha'}},corpus:{sha256:sha(cases),total:2,caseOrder:cases.map(c=>c.id)},progress:{done:0,total:2},storage:runner.independentStorage('laya-independent-20261014-unit')});
async function temp(t){const base=resolve(tmpdir()),root=await mkdtemp(join(base,'laya-independent-unit-'));t.after(async()=>{const rel=relative(base,resolve(root));assert.ok(!isAbsolute(rel)&&!rel.startsWith('..')&&rel.startsWith('laya-independent-unit-'));await rm(root,{recursive:true,force:true});});return root;}
const report=(m,records)=>({id:m.id,status:m.status,progress:{done:records.length,total:m.corpus.total}});

test('new CLI pins an explicit unique run or resume and rejects conflicting mode/gold options',()=>{
 assert.equal(runner.parseIndependentArguments(['--new','--initialize']).newRun,true);
 assert.equal(runner.parseIndependentArguments(['--manifest','saved.json','--root','project']).root,'project');
 for(const args of [[],['--new','--manifest','old'],['--manifest'],['--new','--mode','unified'],['--manifest','old','--baseline-manifest','changed']])assert.throws(()=>runner.parseIndependentArguments(args));
});

test('default readonly replay path targets the immutable entries directory',()=>{
 assert.equal(runner.defaultIndependentCacheDirectory('single-service-100-unit'),'data/runtime/laya-reuse/single-service-100-unit/entries');
});

test('corpus binding requires the original 1000 unique cases and original frozen shared order',()=>{
 const all=domains.flatMap(domain=>Array.from({length:100},(_,n)=>({id:'unit-'+domain+'-'+n,testDomain:domain,text:domain+' '+n,expected:{domain,api:capabilities.find(cap=>cap.domain===domain).id}}))),order=all.map(c=>c.id).reverse(),baseline={id:'old',status:'completed',corpus:{sha256:sha(all),caseOrder:order,total:1000}};
 assert.deepEqual(runner.bindIndependentCorpus(all,baseline).map(c=>c.id),order);
 for(const changed of [{...baseline,status:'running'},{...baseline,corpus:{...baseline.corpus,sha256:'wrong'}},{...baseline,corpus:{...baseline.corpus,caseOrder:order.map(()=>order[0])}}])assert.throws(()=>runner.bindIndependentCorpus(all,changed));
 assert.throws(()=>runner.bindIndependentCorpus(all.slice(1),baseline));
});

test('resume refuses changes to code corpus context options profile and readonly replay inventory',()=>{
 const m=manifest(),binding={sourceHashes:m.conditions.sourceHashes,corpus:m.corpus,context,options,profile,baseline:m.conditions.baseline,replayInventorySha256:'inventory'};m.conditions.replayInventorySha256='inventory';
 assert.equal(runner.validateIndependentResume(m,binding),true);
 for(const field of ['sourceHashes','corpus','context','options','profile','baseline','replayInventorySha256'])assert.throws(()=>runner.validateIndependentResume(m,{...binding,[field]:field==='replayInventorySha256'?'changed':{changed:true}}));
});

test('exclusive lock rejects a live runner and safely releases only its own token',async t=>{
 const root=await temp(t),first=await runner.acquireIndependentLock(root);
 await assert.rejects(runner.acquireIndependentLock(root),/alive|runner|lock/i);
 await first.release();const second=await runner.acquireIndependentLock(root);await second.release();
});

test('raw saved before manifest progress recovers without repeated inference or overwritten records',async t=>{
 const root=await temp(t),m=manifest(),backend=provider();let savedBytes;
 await assert.rejects(runner.runIndependentBatch({root,manifest:m,cases,provider:backend,buildReport:report,afterRawSaved:async({path})=>{savedBytes=await readFile(path);throw new Error('simulated crash after raw save');}}),/simulated crash/);
 assert.equal(backend.calls,2);
 const rawPath=join(root,m.storage.rawDirectory,cases[0].id+'.json');assert.deepEqual(await readFile(rawPath),savedBytes);
 const completed=await runner.runIndependentBatch({root,manifest:m,cases,provider:backend,buildReport:report});
 assert.equal(completed.records.length,2);assert.equal(backend.calls,4);assert.equal(m.status,'completed');assert.deepEqual(await readFile(rawPath),savedBytes);
 await runner.runIndependentBatch({root,manifest:m,cases,provider:backend,buildReport:report});assert.equal(backend.calls,4);
});

test('stored raw validates native input ownership and after-return scoring without any provider call',async t=>{
 const root=await temp(t),m=manifest(),backend=provider(),selection=await runLayaIndependentSelection({text:cases[0].text,context,options},{provider:backend}),record={version:'laya-independent-record-v1',manifestId:m.id,caseId:cases[0].id,testDomain:cases[0].testDomain,scenario:cases[0].scenario,text:cases[0].text,context,expected:cases[0].expected,selection,score:scoreIndependentSelection(cases[0].expected,selection),createdAt:new Date().toISOString()};
 assert.equal(runner.validateIndependentRecord(record,cases[0],m),true);
 for(const mutation of [r=>r.context={changed:true},r=>r.score.api=false,r=>r.selection.decisions.intent.state.domain='cloud',r=>r.selection.traces[0].request.state.text='changed',r=>r.selection.api='files.search',r=>r.selection.traces[0].schema={type:'string'},r=>{const raw=JSON.parse(r.selection.traces[0].raw);raw.answers.domain.probabilities={files:1};r.selection.traces[0].raw=JSON.stringify(raw);}]){
  const changed=structuredClone(record);mutation(changed);assert.throws(()=>runner.validateIndependentRecord(changed,cases[0],m));
 }
 assert.equal(backend.calls,2);assert.ok(root);
});

test('published raw fingerprints detect changed bytes on resume even when rewritten JSON still scores valid',async t=>{
 const root=await temp(t),m=manifest(),backend=provider();await runner.runIndependentBatch({root,manifest:m,cases,provider:backend,buildReport:report});
 const path=join(root,m.storage.rawDirectory,cases[0].id+'.json'),raw=await readFile(path);
 await writeFile(path,Buffer.concat([raw,Buffer.from('\n')]));
 await assert.rejects(runner.runIndependentBatch({root,manifest:m,cases,provider:backend,buildReport:report}),/SHA|fingerprint/i);
 assert.equal(backend.calls,4);
});
