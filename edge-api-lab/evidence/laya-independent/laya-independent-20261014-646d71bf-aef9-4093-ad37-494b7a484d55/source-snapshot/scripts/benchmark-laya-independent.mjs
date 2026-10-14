import {readFile,writeFile,mkdir,rename,open,link,unlink,readdir,lstat,realpath} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,relative,isAbsolute,dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {buildLayaDomainPrompt} from '../src/prompts.mjs';
import {getCapability} from '../src/registry.mjs';
import {createLayaProvider} from '../src/laya-provider.mjs';
import {buildIndependentLayaIntentPrompt,runLayaIndependentSelection,scoreIndependentSelection,LAYA_INDEPENDENT_POLICY} from '../src/laya-independent-selection.mjs';
import {loadSingleService100Cases,SINGLE_SERVICE_100_CONTEXT as defaultContext,SINGLE_SERVICE_100_DOMAINS as domains,SINGLE_SERVICE_100_FILES} from '../src/single-service-100.mjs';
import {collectTestEnvironment} from '../src/test-environment.mjs';

const codeRoot=dirname(dirname(fileURLToPath(import.meta.url)));
const baselineDefault='evidence/single-service-100/single-service-100-20261013-093b947a-6d72-4e9f-8ae1-d3f6b9480a2d/public-manifest.json';
const options={timeoutMs:180000,layaMaxLen:4096,layaHeadMaxLen:768};
const profileKeys=['model','modelRevision','layaVersion','threads','device','tournamentGroup','maxChoices','maxLen','headMaxLen'];
const check=(condition,message)=>{if(!condition)throw new Error('Laya independent: '+message);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const valueSha=value=>sha(JSON.stringify(value));
const same=(a,b)=>isDeepStrictEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));
const json=async path=>JSON.parse(await readFile(path,'utf8'));
function inside(root,path){const target=resolve(root,path),rel=relative(root,target);check(rel&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep),'path escapes project');return target;}
async function safePath(root,path){
 const target=inside(root,path),parts=relative(root,target).split(sep);let current=root;
 for(const part of parts){current=join(current,part);try{check(!(await lstat(current)).isSymbolicLink(),'symlink paths are forbidden');}catch(error){if(error.code==='ENOENT')break;throw error;}}
 return target;
}
async function immutable(root,path,bytes){
 const target=await safePath(root,path);await mkdir(dirname(target),{recursive:true});await safePath(root,path);
 const temporary=target+'.pending-'+randomUUID();await writeFile(temporary,bytes,{flag:'wx'});
 try{await link(temporary,target);}finally{await unlink(temporary);}return sha(bytes);
}
async function save(root,path,value){
 const target=await safePath(root,path);await mkdir(dirname(target),{recursive:true});const temporary=target+'.pending-'+randomUUID();await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
 try{await safePath(root,path);await rename(temporary,target);}catch(error){await unlink(temporary).catch(()=>{});throw error;}
}
export function independentStorage(id){
 check(typeof id==='string'&&/^laya-independent-[A-Za-z0-9-]+$/.test(id),'invalid unique batch ID');
 const directory='evidence/laya-independent/'+id;
 return {manifestPath:directory+'/manifest.json',rawDirectory:directory+'/raw',resultsPath:directory+'/results.json',auditPath:directory+'/audit.json',environmentPath:directory+'/environment.json',sourceSnapshot:directory+'/source-snapshot'};
}
export const defaultIndependentCacheDirectory=id=>'data/runtime/laya-reuse/'+id+'/entries';
export function bindIndependentCorpus(cases,baseline){
 check(baseline.status==='completed','baseline corpus must be completed');
 check(cases.length===1000&&new Set(cases.map(c=>c.id)).size===1000,'require original 1000 unique cases');
 check(cases.every(c=>/^[A-Za-z0-9-]+$/.test(c.id)&&domains.includes(c.testDomain)&&c.expected.domain===c.testDomain&&getCapability(c.expected.api)?.domain===c.testDomain),'invalid case domain/API contract');
 check(domains.every(domain=>cases.filter(c=>c.testDomain===domain).length===100),'require ten domains of 100 cases');
 check(baseline.corpus.total===1000&&baseline.corpus.sha256===valueSha(cases),'original corpus SHA differs');
 const order=baseline.corpus.caseOrder,map=new Map(cases.map(c=>[c.id,c]));
 check(Array.isArray(order)&&order.length===1000&&new Set(order).size===1000&&order.every(id=>map.has(id)),'original shared case order differs');
 return order.map(id=>map.get(id));
}
export function validateIndependentResume(manifest,binding){
 check(manifest.version==='laya-independent-batch-v1','unsupported manifest version');
 check(manifest.conditions.policy===LAYA_INDEPENDENT_POLICY&&manifest.conditions.model===manifest.conditions.profile.model,'frozen selection policy/model differs');
 for(const key of ['sourceHashes','context','options','profile','baseline','replayInventorySha256'])check(same(manifest.conditions[key],binding[key]),'frozen '+key+' changed; refusing resume');
 check(same(manifest.corpus,binding.corpus),'frozen corpus/order changed; refusing resume');
 check(same(manifest.storage,independentStorage(manifest.id)),'unique storage ownership changed');return true;
}
function nativeAnswer(trace,decision){
 try{const payload=JSON.parse(trace.raw),answer=payload.answers?.[decision.answerKey],keys=Object.keys(decision.question.criteria);
  if(trace.error||answer?.type!=='choice'||!keys.includes(answer.choice))return null;
  const ps=answer.probabilities,valid=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1;
  if(typeof payload.model!=='string'||!payload.model||!ps||Object.keys(ps).length!==keys.length||!keys.every(key=>Object.hasOwn(ps,key)&&valid(ps[key]))||!valid(answer.confidence)||ps[answer.choice]+1e-9<Math.max(...Object.values(ps))||Math.abs(Object.values(ps).reduce((sum,value)=>sum+value,0)-1)>Math.max(.001,keys.length*.00005+1e-8))return null;
  const usage=payload.usage??{};if(usage.truncated===true||usage.state_tokens_dropped>0||usage.truncated_questions?.length||Object.values(usage.options??{}).some(option=>option&&typeof option.distinct==='number'&&typeof option.total==='number'&&option.distinct<option.total))return null;
  return decision.choiceMap?.[answer.choice]??answer.choice;
 }catch{return null;}
}
export function validateIndependentRecord(record,c,manifest){
 const ctx={...structuredClone(manifest.conditions.context),...structuredClone(c.context??{})};
 for(const [key,value] of Object.entries({version:'laya-independent-record-v1',manifestId:manifest.id,caseId:c.id,testDomain:c.testDomain,scenario:c.scenario,text:c.text,context:ctx,expected:c.expected}))check(same(record[key],value),'stored ownership '+key+' differs');
 check(Number.isFinite(Date.parse(record.createdAt)),'stored record timestamp invalid');
 const s=record.selection;check(s?.policy===LAYA_INDEPENDENT_POLICY&&Number.isFinite(s.totalMs)&&s.totalMs>=0,'stored selection policy/time invalid');
 check(Array.isArray(s.traces)&&s.traces.length>=1&&s.traces.length<=2,'stored trace count invalid');
 check(s.traces[0].stage==='domain'&&(s.traces.length===1||s.traces[1].stage==='intent'),'stored stage order invalid');
 const domainPrompt=buildLayaDomainPrompt(c.text,ctx),intentPrompt=s.traces.length===2?buildIndependentLayaIntentPrompt(c.text,s.domain,ctx):null;
 for(const [index,prompt] of [domainPrompt,intentPrompt].filter(Boolean).entries()){
  const stage=index===0?'domain':'intent',trace=s.traces[index];
  check(trace.provider==='laya'&&Number.isFinite(trace.wallMs)&&trace.wallMs>=0&&typeof trace.raw==='string','stored native trace invalid');
  if(trace.schema!==undefined)check(same(trace.schema,prompt.schema),'stored native schema differs');
  if(!trace.error)check(trace.request&&trace.requestedModel===manifest.conditions.profile.model&&trace.schema,'successful native trace lacks request/model/schema');
  check(same(s.decisions[stage],prompt.decision)&&same(s.candidates[stage],prompt.promptMeta.candidates),'stored native decision/candidate set differs');
  if(trace.request)check(JSON.stringify(trace.request)===JSON.stringify({state:prompt.decision.state,model:manifest.conditions.profile.model,questions:{[prompt.decision.answerKey]:prompt.decision.question},max_len:manifest.conditions.profile.maxLen,head_max_len:manifest.conditions.profile.headMaxLen,lang:'zh'}),'stored native request or criterion order differs');
 }
 const domain=nativeAnswer(s.traces[0],domainPrompt.decision);check(s.domain===domain,'stored domain differs from native choice');
 if(s.traces.length===2){const api=nativeAnswer(s.traces[1],intentPrompt.decision);check(s.api===(api==='unsupported'?null:api),'stored API differs from native choice');}
 else check(s.api===null&&(s.status==='error'||s.status==='cancelled'||s.domain==='unsupported'),'API phase missing without early termination');
 if(s.status==='selected')check(s.traces.length===2&&s.api&&getCapability(s.api)?.domain===s.domain,'invalid selected outcome');
 if(s.status==='unsupported')check(!s.api&&(s.domain==='unsupported'||s.traces.length===2),'invalid unsupported outcome');
 check(same(record.score,scoreIndependentSelection(c.expected,s)),'stored after-return score differs');return true;
}
export async function acquireIndependentLock(root){
 root=resolve(root);const path=await safePath(root,'data/runtime/laya-independent.lock');await mkdir(dirname(path),{recursive:true});
 const token=randomUUID();let handle;
 try{handle=await open(path,'wx');}catch(error){
  if(error.code!=='EEXIST')throw error;const previous=await json(path);let alive=Number.isInteger(previous.pid)&&previous.pid>0;
  try{if(alive)process.kill(previous.pid,0);}catch{alive=false;}check(!alive,'another independent runner is alive; refusing duplicate lock');
  await rename(path,path+'.stale-'+randomUUID());return acquireIndependentLock(root);
 }
 await handle.writeFile(JSON.stringify({pid:process.pid,token,createdAt:new Date().toISOString()}));
 return{async release(){await handle.close();const owner=await json(path);check(owner.pid===process.pid&&owner.token===token,'lock owner changed');await unlink(path);}};
}
async function savedRecords(root,manifest,cases){
 check(same(manifest.storage,independentStorage(manifest.id)),'unique storage differs');
 const folder=await safePath(root,manifest.storage.rawDirectory),map=new Map(cases.map(c=>[c.id,c])),found=new Map(),fingerprints=manifest.rawHashes??={};
 for(const entry of await readdir(folder,{withFileTypes:true}).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error))){
  if(/\.pending-/.test(entry.name))continue;check(entry.isFile()&&entry.name.endsWith('.json'),'unknown raw evidence entry');
  const id=entry.name.slice(0,-5);check(map.has(id)&&!found.has(id),'unknown or duplicate raw key');
  const path=await safePath(root,join(manifest.storage.rawDirectory,entry.name)),bytes=await readFile(path),record=JSON.parse(bytes),digest=sha(bytes);validateIndependentRecord(record,map.get(id),manifest);
  if(Object.hasOwn(fingerprints,id))check(fingerprints[id]===digest,'stored raw SHA-256 fingerprint differs: '+id);
  else check(cases.findIndex(c=>c.id===id)>=(manifest.progress?.done??0),'published raw fingerprint missing');
  fingerprints[id]=digest;found.set(id,record);
 }
 check(cases.slice(0,found.size).every(c=>found.has(c.id)),'saved raw keys are not the frozen order prefix');
 check(!manifest.progress||manifest.progress.done<=found.size,'published raw record is missing');
 check(Object.keys(fingerprints).every(id=>found.has(id)),'registered raw fingerprint file missing');
 return cases.filter(c=>found.has(c.id)).map(c=>found.get(c.id));
}
export async function runIndependentBatch({root,manifest,cases,provider,buildReport,renderHtml,exportStatic=false,signal,sourceCheck,verifyRecords,afterRawSaved,onProgress}={}){
 root=resolve(root);check(cases.length===manifest.corpus.total&&same(cases.map(c=>c.id),manifest.corpus.caseOrder),'run cases differ from frozen order');
 const records=await savedRecords(root,manifest,cases),done=new Set(records.map(r=>r.caseId));
 if(verifyRecords)await verifyRecords(records);
 const publish=async({withReport=true}={})=>{manifest.updatedAt=new Date().toISOString();manifest.progress={done:records.length,total:cases.length};await save(root,manifest.storage.manifestPath,manifest);if(!withReport)return;const report=buildReport(manifest,records);await save(root,manifest.storage.resultsPath,report);return report;};
 try{
  if(manifest.status==='completed'&&records.length===cases.length)return{manifest,records,report:buildReport(manifest,records)};
  for(const window of manifest.executionWindows??[])if(!window.endedAt){check(Number.isFinite(Date.parse(manifest.updatedAt))&&Date.parse(manifest.updatedAt)>=Date.parse(window.startedAt),'stale execution window has no saved heartbeat');window.endedAt=manifest.updatedAt;window.endedAtBasis='last_saved_heartbeat';}
  manifest.status='running';manifest.executionWindows??=[];manifest.executionWindows.push({startedAt:new Date().toISOString(),endedAt:null});await publish();
  for(const c of cases){
   if(done.has(c.id))continue;signal?.throwIfAborted();if(sourceCheck)await sourceCheck();
   const context={...structuredClone(manifest.conditions.context),...structuredClone(c.context??{})};
   const selection=await runLayaIndependentSelection({text:c.text,context,options:manifest.conditions.options},{provider,signal});
   const record={version:'laya-independent-record-v1',manifestId:manifest.id,caseId:c.id,testDomain:c.testDomain,scenario:c.scenario,text:c.text,context,expected:structuredClone(c.expected),selection,score:scoreIndependentSelection(c.expected,selection),createdAt:new Date().toISOString()};
   validateIndependentRecord(record,c,manifest);const path=join(manifest.storage.rawDirectory,c.id+'.json'),digest=await immutable(root,path,JSON.stringify(record,null,2)+'\n');manifest.rawHashes[record.caseId]=digest;
   if(afterRawSaved)await afterRawSaved({path:inside(root,path),record});records.push(record);done.add(c.id);await publish({withReport:records.length%25===0});if(onProgress)await onProgress({done:records.length,total:cases.length,record});signal?.throwIfAborted();
  }
  if(sourceCheck)await sourceCheck();if(verifyRecords)await verifyRecords(records);check(records.length===cases.length,'incomplete unique case set');manifest.status='completed';manifest.completedAt=new Date().toISOString();manifest.executionWindows.at(-1).endedAt=manifest.completedAt;manifest.error=null;
  const report=await publish();
  if(exportStatic){await save(root,'public/laya-independent.json',report);if(renderHtml)await writeFile(await safePath(root,'public/laya-independent.html'),renderHtml(report));}
  return{manifest,records,report};
 }catch(error){manifest.status=signal?.aborted?'cancelled':'failed';manifest.error=error.message;const open=manifest.executionWindows?.at(-1);if(open&&!open.endedAt)open.endedAt=new Date().toISOString();await publish();throw error;}
}
export function parseIndependentArguments(args){
 const result={root:codeRoot,newRun:false,initialize:false,manifest:null,baselineManifest:null,cacheDirectory:null,exportOnly:false,help:false};
 for(let index=0;index<args.length;index++){const flag=args[index];
  if(flag==='--new')result.newRun=true;else if(flag==='--initialize')result.initialize=true;else if(flag==='--export-only')result.exportOnly=true;else if(flag==='--help')result.help=true;
  else if(['--root','--manifest','--baseline-manifest','--cache-directory'].includes(flag)){check(args[index+1]&&!args[index+1].startsWith('--'),flag+' requires a value');result[{'--root':'root','--manifest':'manifest','--baseline-manifest':'baselineManifest','--cache-directory':'cacheDirectory'}[flag]]=args[++index];}
  else throw new Error('Unknown independent benchmark argument: '+flag);
 }
 check(result.help||result.newRun!==Boolean(result.manifest),'choose --new or --manifest');check(!result.baselineManifest||result.newRun,'baseline override is new-only');check(!result.cacheDirectory||result.newRun,'cache override is new-only');return result;
}
export async function collectIndependentSourcePaths(root){
 const pending=['src/laya-independent-selection.mjs','src/laya-independent-replay.mjs','src/laya-independent-report.mjs','scripts/benchmark-laya-independent.mjs','tests/laya-independent-selection.test.mjs','tests/laya-independent-runner.test.mjs','tests/laya-independent-replay.test.mjs','tests/laya-independent-report.test.mjs','package.json','package-lock.json','data/cases-system-single.json',...SINGLE_SERVICE_100_FILES],found=new Set();
 while(pending.length){const path=pending.pop();if(found.has(path))continue;found.add(path);const text=await readFile(inside(root,path),'utf8');if(!/\.(?:mjs|js)$/.test(path))continue;
  for(const match of text.matchAll(/(?:from\s*|import\s*\(|import\s*)['"]([^'"]+)['"]/g)){if(!match[1].startsWith('.'))continue;const target=inside(root,join(dirname(path),match[1]));pending.push(relative(root,target).replaceAll('\\','/'));}
 }return[...found].sort();
}
const sourceHashes=async(root,paths)=>Object.fromEntries(await Promise.all(paths.map(async path=>[path,sha(await readFile(inside(root,path)))])));
function statusProfile(status){const deployment=status.deployment??{};const profile={model:status.model,modelRevision:status.modelRevision,layaVersion:status.version,threads:status.threads??deployment.threads,device:status.device,tournamentGroup:status.tournamentGroup,maxChoices:status.maxChoices,maxLen:status.maxLen,headMaxLen:status.headMaxLen};check(status.ready===true&&profileKeys.every(key=>profile[key]!==undefined&&profile[key]!==null),'Laya must report a complete ready deployment profile');return profile;}
async function main(){
 const cli=parseIndependentArguments(process.argv.slice(2));if(cli.help){console.log('node scripts/benchmark-laya-independent.mjs --new [--root <project>] [--baseline-manifest <path>] [--cache-directory <path>] --initialize\nnode scripts/benchmark-laya-independent.mjs --root <project> --manifest <path> [--export-only]');return;}
 const root=await realpath(resolve(cli.root)),lock=await acquireIndependentLock(root);
 try{
  const paths=await collectIndependentSourcePaths(root),hashes=await sourceHashes(root,paths),cases=await loadSingleService100Cases(root),currentStatus=await createLayaProvider().getStatus(),profile=statusProfile(currentStatus);
  const {createLayaIndependentReplayProvider,verifyLayaIndependentReplayTrace}=await import('../src/laya-independent-replay.mjs');const {buildLayaIndependentReport,renderLayaIndependentHtml}=await import('../src/laya-independent-report.mjs');
  let manifest;
  if(cli.newRun){
   const baselinePath=await safePath(root,cli.baselineManifest??baselineDefault),baselineBytes=await readFile(baselinePath),baseline=JSON.parse(baselineBytes),order=bindIndependentCorpus(cases,baseline),id='laya-independent-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+randomUUID(),storage=independentStorage(id),cacheDirectory=relative(root,await safePath(root,cli.cacheDirectory??defaultIndependentCacheDirectory(baseline.id))).replaceAll('\\','/');
   const provider=await createLayaIndependentReplayProvider({root,cacheDirectory:inside(root,cacheDirectory),profile});
   manifest={version:'laya-independent-batch-v1',id,status:'planned',createdAt:new Date().toISOString(),storage,sourceSnapshot:storage.sourceSnapshot,corpus:{total:1000,perDomain:100,sha256:valueSha(cases),caseOrder:order.map(c=>c.id)},conditions:{policy:LAYA_INDEPENDENT_POLICY,model:'multilingual',profile,options,context:defaultContext,sourceHashes:hashes,cacheDirectory,baseline:{id:baseline.id,path:relative(root,baselinePath).replaceAll('\\','/'),sha256:sha(baselineBytes)},replayInventorySha256:valueSha(provider.replayInventory)},environment:await collectTestEnvironment(),replayInventory:provider.replayInventory,progress:{done:0,total:1000},executionWindows:[]};
   for(const path of paths)await immutable(root,join(storage.sourceSnapshot,path),await readFile(inside(root,path)));
   check(same(hashes,await sourceHashes(root,paths)),'source changed during initial freeze');await immutable(root,storage.manifestPath,JSON.stringify(manifest,null,2)+'\n');await immutable(root,storage.environmentPath,JSON.stringify(manifest.environment,null,2)+'\n');
  }else{const path=await safePath(root,cli.manifest);manifest=await json(path);check(path===inside(root,manifest.storage.manifestPath),'selected manifest path differs from unique storage');}
  const baselineBytes=await readFile(await safePath(root,manifest.conditions.baseline.path)),baseline=JSON.parse(baselineBytes),order=bindIndependentCorpus(cases,baseline),provider=await createLayaIndependentReplayProvider({root,cacheDirectory:inside(root,manifest.conditions.cacheDirectory),profile});
  validateIndependentResume(manifest,{sourceHashes:hashes,corpus:{total:1000,perDomain:100,sha256:valueSha(cases),caseOrder:order.map(c=>c.id)},profile,options,context:defaultContext,baseline:{id:baseline.id,path:manifest.conditions.baseline.path,sha256:sha(baselineBytes)},replayInventorySha256:valueSha(provider.replayInventory)});
  if(provider.replayInventory.verifiedEntries===0)console.warn('No verified historical entries are available; unmatched decisions will use fresh native Laya inference.');
  for(const path of paths)check(sha(await readFile(inside(root,join(manifest.sourceSnapshot,path))))===hashes[path],'frozen source snapshot differs: '+path);
  if(cli.initialize||cli.exportOnly){const records=await savedRecords(root,manifest,order);manifest.progress={done:records.length,total:1000};const report=buildLayaIndependentReport(manifest,records);await save(root,manifest.storage.resultsPath,report);if(cli.exportOnly){await save(root,'public/laya-independent.json',report);await writeFile(await safePath(root,'public/laya-independent.html'),renderLayaIndependentHtml(report));}console.log(JSON.stringify({id:manifest.id,status:manifest.status,manifestPath:manifest.storage.manifestPath,progress:manifest.progress}));return;}
  const stop=new AbortController(),abort=()=>stop.abort(new Error('Independent runner interrupted'));process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{
   const outcome=await runIndependentBatch({root,manifest,cases:order,provider,buildReport:buildLayaIndependentReport,renderHtml:renderLayaIndependentHtml,exportStatic:true,signal:stop.signal,sourceCheck:async()=>check(same(hashes,await sourceHashes(root,paths)),'frozen source changed during run'),verifyRecords:records=>{for(const record of records)for(const trace of record.selection.traces)verifyLayaIndependentReplayTrace(trace,provider.replayInventory);},onProgress:({done,total,record})=>console.log(JSON.stringify({done,total,caseId:record.caseId,domain:record.selection.domain,api:record.selection.api,joint:record.score.joint,totalMs:record.selection.totalMs}))});
   await save(root,manifest.storage.auditPath,{version:'laya-independent-audit-v1',id:manifest.id,status:'verified_completed',at:new Date().toISOString(),caseCount:outcome.records.length,qwenCalls:0,registeredRaw:manifest.rawHashes,corpusSha256:manifest.corpus.sha256,replayInventorySha256:manifest.conditions.replayInventorySha256,checks:{ownership:true,afterReturnScores:true,nativeRequestsAndWireOrder:true,originalCorpusAndOrder:true,rawByteSha256:true,sourceSnapshots:true,replaySources:true}});
  }
  finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
 }finally{await lock.release();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
