import {readFile,writeFile,rename,mkdir,open,unlink,link,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createProviders} from '../src/providers.mjs';
import {runPipeline} from '../src/pipeline.mjs';
import {getCapability,validateArguments,capabilities} from '../src/registry.mjs';
import {resolveArguments} from '../src/resolver.mjs';
import {scoreCase} from '../src/evaluation.mjs';
import {scoreExecutionSemantics} from '../src/semantic-evaluation.mjs';
import {PROMPT_VERSION} from '../src/prompts.mjs';
import {GROUNDING_VERSION} from '../src/grounding.mjs';
import {loadSingleService100Cases,singleService100Plan,SINGLE_SERVICE_100_MODELS as defaultModels,SINGLE_SERVICE_100_DOMAINS as domains,SINGLE_SERVICE_100_CONTEXT as baseContext,SINGLE_SERVICE_100_FILES,SINGLE_SERVICE_100_SUITE as suite} from '../src/single-service-100.mjs';
import {buildSingleService100Report,primaryFailure} from '../src/single-service-100-report.mjs';
import {saveReplaySourceSnapshot} from './replay-grounding.mjs';
import {collectTestEnvironment,sampleHost,readOllamaSample,withInferenceSampling} from '../src/test-environment.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
let manifestPath,reportPath,evidenceRoot,indexPath,snapshotDirectory;
const activePath=join(root,'data/runtime/single-service-100-active.json');
const lockPath=join(root,'data/runtime/single-service-100.lock');
const options={num_ctx:2048,num_predict:224,timeoutMs:180000,temperature:0};
const sourcePaths=['src/registry.mjs','src/weather-capabilities.mjs','src/extended-capabilities.mjs','src/system-capabilities.mjs','src/prompts.mjs','src/providers.mjs','src/pipeline.mjs','src/resolver.mjs','src/grounding.mjs','src/system-context.mjs','src/fixtures.mjs','src/evaluation.mjs','src/semantic-evaluation.mjs','src/runtime.mjs','src/corpus.mjs','src/application.mjs','src/single-service-100.mjs','src/single-service-100-report.mjs','data/single-service-core.mjs','data/cases-system-single.json',...SINGLE_SERVICE_100_FILES,'scripts/benchmark-single-service-100.mjs','scripts/replay-grounding.mjs','server.mjs','package.json','public/app.js','public/index.html','public/context-builder.mjs','public/evaluation-view.mjs','public/ui-utils.mjs','public/single-service-100-view.mjs','tests/single-service-100-report.test.mjs','tests/single-service-100-http.test.mjs','tests/single-service-100-view.test.mjs','tests/single-service-ui.test.mjs'];
// New snapshots must also freeze the host-generated parameter audit and its UI.
sourcePaths.push('src/parameter-provenance.mjs','public/provenance-view.mjs','public/run-view.mjs','tests/parameter-provenance.test.mjs');
sourcePaths.push('src/test-environment.mjs','src/benchmark-selection.mjs','tests/benchmark-selection-http.test.mjs','scripts/verify-single-service-100.mjs');
sourcePaths.push('tests/test-environment.test.mjs','tests/single-service-100-runner.test.mjs','tests/verify-single-service-100.test.mjs','tests/single-service-100-environment-view.test.mjs');
sourcePaths.push('tests/single-service-100-controller.test.mjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const cpuBusyFraction=(before,after)=>{let total=0,idle=0;for(let i=0;i<before.cpuTicks.length;i++){const a=before.cpuTicks[i],b=after.cpuTicks[i];for(const key of Object.keys(a))total+=Math.max(0,b[key]-a[key]);idle+=Math.max(0,b.idle-a.idle);}return total?(total-idle)/total:null;};
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const check=(condition,message)=>{if(!condition)throw new Error(message);};
async function save(path,value){
 await mkdir(dirname(path),{recursive:true});await writeFile(`${path}.tmp`,JSON.stringify(value,null,2)+'\n');
 for(let attempt=0;;attempt++)try{await rename(`${path}.tmp`,path);return;}catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=4)throw error;await new Promise(r=>setTimeout(r,100*(attempt+1)));}
}
async function saveNewRecord(path,record){
 await mkdir(dirname(path),{recursive:true});const bytes=JSON.stringify(record,null,2)+'\n',temporary=`${path}.pending-${randomUUID()}`;
 await writeFile(temporary,bytes,{flag:'wx'});
 try{await link(temporary,path);}finally{await unlink(temporary);}
 return hash(bytes);
}
export async function collectSourcePaths(workspace=root){
 workspace=workspace instanceof URL?fileURLToPath(workspace):resolve(workspace);
 const found=new Set(),pending=[...sourcePaths];
 while(pending.length){
  const path=pending.pop();if(found.has(path))continue;found.add(path);
  const bytes=await readFile(join(workspace,path),'utf8');
  if(!/\.(?:mjs|js)$/.test(path))continue;
  for(const match of bytes.matchAll(/(?:from\s*|import\s*\(|import\s*)['"]([^'"]+)['"]/g)){
   if(!match[1].startsWith('.'))continue;
   const target=resolve(workspace,dirname(path),match[1]),rel=relative(workspace,target).replaceAll('\\','/');
   check(!isAbsolute(rel)&&!rel.startsWith('../'),'Dependency path escapes workspace');
   pending.push(rel);
  }
 }
 return [...found].sort();
}
const hashes=async paths=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,hash(await readFile(join(root,p)))])));
export const createBenchmarkIdentity=(now=new Date(),uuid=randomUUID())=>`single-service-100-${now.toISOString().slice(0,10).replaceAll('-','')}-${uuid}`;
export function benchmarkStorage(id){
 check(typeof id==='string'&&/^single-service-100-[a-zA-Z0-9-]+$/.test(id),'Invalid benchmark identity/path');
 const evidenceRoot=`evidence/single-service-100/${id}`;
 return {manifestPath:`data/runtime/single-service-100/${id}/manifest.json`,reportPath:`docs/single-service-100/${id}/results.json`,evidenceRoot,indexPath:`${evidenceRoot}/index.json`,snapshotDirectory:`data/benchmark-single-service-100/${id}`};
}
export function validateResumeManifest(manifest,{models,sourceHashes,corpusHash,caseOrder,modelDetails,options:expectedOptions,context:expectedContext}){
 const plan=singleService100Plan(manifest);
 check(same(plan.models,models)&&same(plan.modelOrder,models)&&same(manifest.conditions.sourceHashes,sourceHashes)&&manifest.corpus.sha256===corpusHash&&same(manifest.corpus.caseOrder,caseOrder)&&same(manifest.conditions.modelDetails.map(m=>({name:m.name,digest:m.digest})),modelDetails.map(m=>({name:m.name,digest:m.digest}))),'Frozen plan, code, corpus, order or model identities changed; refusing mixed-version resume');
 if(expectedOptions)check(same(manifest.conditions.options,expectedOptions),'Frozen inference options changed; refusing resume');
 if(expectedContext)check(same(manifest.conditions.context,expectedContext),'Frozen baseline context changed; refusing resume');
 return true;
}
export const modelKey=model=>model.replace(':','-');
export function orderedCases(cases){
 const groups=domains.map(domain=>cases.filter(c=>c.testDomain===domain).sort((a,b)=>hash('single100-fixed-order/'+a.id).localeCompare(hash('single100-fixed-order/'+b.id))));
 return Array.from({length:100},(_,index)=>groups.map(group=>group[index])).flat();
}
export function validateSuite(cases){
 check(cases.length===1000,'Require 1000 cases');
 const failures=[];
 for(const c of cases){
  const cap=getCapability(c.expected.api),context={...structuredClone(baseContext),...structuredClone(c.context??{})};
  check(cap?.domain===c.testDomain,`${c.id}: unknown/wrong-domain API`);
  const validation=validateArguments(cap,c.expected.arguments??{});
  check(validation.valid,`${c.id}: invalid expected arguments: ${validation.issues.join(';')}`);
  const resolved=resolveArguments(cap,c.expected.arguments??{},context);
  if(resolved.status!==c.expected.status)failures.push({id:c.id,expected:c.expected.status,resolver:resolved.status,issues:resolved.issues});
 }
 check(!failures.length,`Expected status/contract inconsistencies: ${JSON.stringify(failures)}`);
 return domains.map(testDomain=>{const rows=cases.filter(c=>c.testDomain===testDomain);return {testDomain,total:rows.length,apiCount:new Set(rows.map(c=>c.expected.api)).size,registeredApis:capabilities.filter(c=>c.domain===testDomain).length,scenarios:new Set(rows.map(c=>c.scenario)).size,expectedStatuses:Object.fromEntries([...Map.groupBy(rows,c=>c.expected.status)].map(([status,list])=>[status,list.length]))};});
}
export function compactRecord(record){
 const {run,rawScore,execution}=record,trace=run.traces?.[0]??{};
 let parsed;try{parsed=JSON.parse(trace.raw);}catch{}
 const row={model:record.model,modelKey:modelKey(record.model),caseId:record.caseId,testDomain:record.testDomain,scenario:record.scenario,text:record.text,origin:record.origin,
  expectedDomain:record.expected.domain,expectedApi:record.expected.api,expectedStatus:record.expected.status,actualDomain:run.domain,actualApi:run.api,status:run.status,
  contractBoundary:record.contractBoundary??null,userGoalStatus:record.userGoalStatus??null,
  expectedArguments:record.expected.arguments,modelArguments:run.modelArguments,extractedArguments:run.extractedArguments,groundedArguments:run.groundedArguments,
  rawScore,execution:Object.fromEntries(['domain','api','finalArguments','status','precision','sources','expectedResolverStatusMatchesGold','plan'].map(k=>[k,execution[k]])),
  candidateRecall:(run.candidates?.unified?.ids??[]).includes(record.expected.api),parsedApiCorrect:parsed?.domain===record.expected.domain&&parsed?.api===record.expected.api,
  differences:execution.differences,error:run.error??null,providerError:Boolean(trace.error),errorType:trace.errorType??null,wallMs:run.totalMs,inputTokens:trace.inputTokens,outputTokens:trace.outputTokens,truncated:trace.truncated??false,
  performance:{loadMs:trace.loadMs??null,promptMs:trace.promptMs??null,generationMs:trace.generationMs??null,tokensPerSecond:trace.tokensPerSecond??null,deterministicMs:run.deterministicMs??null,hostBefore:record.hostSample?.before??null,hostAfter:record.hostSample?.after??null,hostCpuBusyFraction:record.hostSample?.cpuBusyFraction??null,...(record.inferenceSamples?{hostSamples:record.inferenceSamples.host,ollamaSamples:record.inferenceSamples.ollama}:{})},
  detailPath:`/api/single-service-100-run/${modelKey(record.model)}/${record.caseId}`+(record.manifestId?'?manifestId='+encodeURIComponent(record.manifestId):''),recordSha256:record.recordSha256??null};
 row.primary=primaryFailure(row);return row;
}
async function loadSaved(manifest,cases){
 const models=singleService100Plan(manifest).models,records=new Map();let previousIndex;
 try{previousIndex=await read(indexPath);check(previousIndex.manifestId===manifest.id,'Saved index belongs to another benchmark');}catch(error){if(error.code!=='ENOENT')throw error;}
 const registered=new Map((previousIndex?.rows??[]).map(row=>[`${row.model}/${row.caseId}`,row.recordSha256]));
 check(registered.size===(previousIndex?.rows??[]).length,'Duplicate registered resume key');
 const allowed=new Set([...models.map(modelKey),'warmups']);
 for(const entry of await readdir(evidenceRoot,{withFileTypes:true}).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error)))if(entry.isDirectory())check(allowed.has(entry.name),'Unexpected model directory in resume evidence: '+entry.name);
 const caseIds=new Set(cases.map(c=>c.id));
 for(const model of models){
  const folder=join(evidenceRoot,modelKey(model));
  for(const entry of await readdir(folder,{withFileTypes:true}).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error))){
   check(entry.isFile(),'Unexpected nested resume evidence directory');
   if(/\.pending-|\.tmp/.test(entry.name))continue;
   check(entry.name.endsWith('.json')&&caseIds.has(entry.name.slice(0,-5)),'Unknown formal raw record in resume set: '+entry.name);
  }
 }
 for(const model of models)for(const c of cases){
  const path=join(evidenceRoot,modelKey(model),`${c.id}.json`);
  try{const bytes=await readFile(path),record=JSON.parse(bytes),digest=hash(bytes),registeredDigest=registered.get(`${model}/${c.id}`);
   check(record.manifestId===manifest.id&&record.model===model&&record.caseId===c.id&&record.testDomain===c.testDomain&&record.text===c.text&&record.scenario===c.scenario&&same(record.expected,c.expected)&&same(record.context,{...structuredClone(baseContext),...structuredClone(c.context??{})}),`Stored evidence ownership/gold/context changed: ${path}`);
   check(!registeredDigest||registeredDigest===digest,`Saved raw evidence differs from registered SHA-256: ${path}`);
   check(record.run.model===model&&record.run.traces?.length===1&&record.run.traces[0].model===model,'Stored inference trace/model differs from resume plan');
   check(record.run.text===c.text&&record.run.mode==='unified'&&same(record.run.context,record.context)&&same(record.run.options,manifest.conditions.options),'Stored run context/options differ from frozen resume plan');
   check(same(record.rawScore,scoreCase(c.expected,record.run))&&same(record.execution,scoreExecutionSemantics(c.expected,record.run,record.context)),'Stored scores differ from independently verified resume evidence');
   record.recordSha256=digest;records.set(`${model}/${c.id}`,compactRecord(record));}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 const expected=models.flatMap(model=>manifest.corpus.caseOrder.map(id=>`${model}/${id}`)),indexKeys=(previousIndex?.rows??[]).map(row=>`${row.model}/${row.caseId}`);
 check(indexKeys.every((key,i)=>key===expected[i]),'Resume index is not the frozen order prefix');
 check(expected.slice(0,records.size).every(key=>records.has(key)),'Resume raw keys are not the frozen order prefix');
 check(indexKeys.every(key=>records.has(key)),'Indexed raw file missing; refusing resume');
 return expected.filter(key=>records.has(key)).map(key=>records.get(key));
}
async function acquireLock(){
 try{const handle=await open(lockPath,'wx');await handle.writeFile(JSON.stringify({pid:process.pid,token:randomUUID(),createdAt:new Date().toISOString()}));return handle;}
 catch(error){if(error.code!=='EEXIST')throw error;const previous=await read(lockPath);let alive=Number.isInteger(previous.pid)&&previous.pid>0;try{if(alive)process.kill(previous.pid,0);}catch{alive=false;}
  check(!alive,'An existing benchmark runner is alive; refusing duplicate inference');
  await rename(lockPath,`${lockPath}.stale-${Date.now()}`);return acquireLock();}
}
export function parseBenchmarkArguments(args){
 const result={newRun:false,initialize:false,exportOnly:false,manifest:null,help:false};
 for(let i=0;i<args.length;i++){
  const arg=args[i];if(arg==='--new')result.newRun=true;else if(arg==='--initialize')result.initialize=true;
  else if(arg==='--export-only')result.exportOnly=true;else if(arg==='--help')result.help=true;
  else if(arg==='--manifest'){check(args[i+1]&&!args[i+1].startsWith('--'),'--manifest requires a path');result.manifest=args[++i];}
  else throw new Error('Unknown benchmark argument: '+arg);
 }
 check(!(result.newRun&&result.manifest),'Choose --new or --manifest, not both');
 check(result.help||result.newRun||result.manifest,'Explicit --new or --manifest is required; historical artifacts are never reused implicitly');
 return result;
}
async function installedModels(models){
 const response=await fetch('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(5000)});check(response.ok,'Ollama tags failed');
 const tags=await response.json(),details=[];
 for(const name of models){
  const tag=tags.models?.find(item=>item.name===name);check(tag?.digest,'Requested model must be installed with a digest: '+name);
  const showResponse=await fetch('http://127.0.0.1:11434/api/show',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:name}),signal:AbortSignal.timeout(10000)});
  check(showResponse.ok,'Ollama model metadata unavailable: '+name);const show=await showResponse.json();
  const merged={...tag.details,...show.details},numeric=Number(show.model_info?.[merged.family+'.parameter_count']);
  const count=merged.parameter_size?.match(/^([\d.]+)\s*([BM])$/i),billions=count?Number(count[1])*(count[2].toUpperCase()==='M'?.001:1):numeric/1e9;
  check(Number.isFinite(billions)&&billions>0&&billions<10,'Model parameter count must be verifiably below 10B: '+name);
  details.push({...tag,details:merged,parameterB:billions,model_info:show.model_info??null,parameters:show.parameters??null,templateSha256:hash(show.template??''),showSha256:hash(JSON.stringify(show)),metadataSource:'/api/tags + /api/show'});
 }
 return details;
}
function useStorage(manifest,file){
 const storage=manifest.storage??{manifestPath:'data/runtime/single-service-100-suite.json',reportPath:'docs/single-service-100-v1-results.json',evidenceRoot:'evidence/single-service-100-v1',indexPath:'evidence/single-service-100-v1/index.json',snapshotDirectory:manifest.sourceSnapshot};
 if(manifest.storage)check(same(storage,benchmarkStorage(manifest.id)),'Manifest storage changed from unique identity');
 const inside=path=>{const full=resolve(root,path),rel=relative(root,full);check(!isAbsolute(rel)&&!rel.startsWith('..'),'Benchmark path escapes workspace');return full;};
 manifestPath=inside(storage.manifestPath);reportPath=inside(storage.reportPath);evidenceRoot=inside(storage.evidenceRoot);indexPath=inside(storage.indexPath);snapshotDirectory=storage.snapshotDirectory;
 if(file)check(resolve(file)===manifestPath,'--manifest path does not match saved manifest identity');
 return storage;
}
async function main(){
 const cli=parseBenchmarkArguments(process.argv.slice(2));
 if(cli.help){console.log('New queued run: node scripts/benchmark-single-service-100.mjs --new --initialize\nResume/start: node scripts/benchmark-single-service-100.mjs --manifest <absolute manifest.json>\nPublish only: --manifest <path> --export-only');return;}
 await mkdir(dirname(lockPath),{recursive:true});const handle=await acquireLock();
 try{
  const cases=await loadSingleService100Cases(root),coverage=validateSuite(cases),order=orderedCases(cases),freezePaths=await collectSourcePaths(root),sourceHashes=await hashes(freezePaths),corpusHash=hash(JSON.stringify(cases));
  let manifest,models,modelDetails,storage;
  if(cli.newRun){
   const id=createBenchmarkIdentity();storage=benchmarkStorage(id);models=[...defaultModels];modelDetails=await installedModels(models);
   const hardware=await collectTestEnvironment();
   manifest={version:'single-service-100-batch-v2',id,suite,status:'queued',createdAt:new Date().toISOString(),warmups:[],storage,sourceSnapshot:storage.snapshotDirectory,
    corpus:{total:1000,perDomain:100,original:100,new:900,sha256:corpusHash,coverage,caseOrder:order.map(c=>c.id),contractBoundaries:cases.filter(c=>c.contractBoundary).map(c=>({id:c.id,text:c.text,expectedStatus:c.expected.status,userGoalStatus:c.userGoalStatus,boundary:c.contractBoundary}))},
    conditions:{sourceHashes,catalogVersion:'single-service-v3',promptVersion:PROMPT_VERSION,groundingVersion:GROUNDING_VERSION,models,modelOrder:models,domains,modelDetails,options,context:baseContext,hardware,modelDirectory:hardware.modelDirectory,callsPerModel:1000,totalCalls:models.length*1000,repeats:1,
     sampling:{intervalMs:1000,source:'/api/ps',offload:'size - size_vram allocation estimate; requires reported context_length; unknown when unavailable'},
     resumePolicy:'SHA/集合/顺序校验后仅恢复未保存key；崩溃前发出但未落盘的调用不能证明未执行，恢复事件明确记录。预热每模型最多一次；恢复可能冷加载，依据loadMs/ps观测。',
     scope:'中文单服务；全pipeline、本机真实硬件，手机位置/时钟上下文固定fixture，业务API为mock；推理按声明模型顺序串行'}};
   useStorage(manifest);
   const snapshot=await saveReplaySourceSnapshot({root,snapshotDirectory,paths:freezePaths});
   check(snapshot.files.every(file=>file.sha256===sourceHashes[file.path]),'Source changed while snapshotting; refusing mixed-version freeze');
   manifest.progress={done:0,total:singleService100Plan(manifest).totalCalls};
   await saveNewRecord(manifestPath,manifest);
  }else{
   manifest=await read(resolve(cli.manifest));storage=useStorage(manifest,cli.manifest);models=singleService100Plan(manifest).models;
   modelDetails=cli.exportOnly?manifest.conditions.modelDetails:await installedModels(models);
   validateResumeManifest(manifest,{models,sourceHashes,corpusHash,caseOrder:order.map(c=>c.id),modelDetails,options,context:baseContext});
   const snapshot=await saveReplaySourceSnapshot({root,snapshotDirectory,paths:freezePaths});
   check(snapshot.files.every(file=>file.sha256===sourceHashes[file.path]),'Frozen snapshot differs on resume');
  }
  const plan=singleService100Plan(manifest),rows=await loadSaved(manifest,cases),keys=new Set(rows.map(r=>r.model+'/'+r.caseId));
  const publish=async({index=true}={})=>{
   manifest.updatedAt=new Date().toISOString();manifest.progress={done:rows.length,total:plan.totalCalls};
   await save(manifestPath,manifest);if(index)await save(indexPath,{manifestId:manifest.id,status:manifest.status,updatedAt:manifest.updatedAt,rows});
   await save(reportPath,buildSingleService100Report(manifest,rows));
   await save(activePath,{id:manifest.id,manifestPath:storage.manifestPath,reportPath:storage.reportPath,evidenceRoot:storage.evidenceRoot});
  };
  if(cli.initialize||cli.exportOnly){await publish();console.log(JSON.stringify({status:manifest.status,id:manifest.id,manifestPath,progress:manifest.progress,coverage}));return;}
  if(rows.length===plan.totalCalls&&manifest.status==='completed'){console.log(JSON.stringify({status:'already_completed',id:manifest.id}));return;}
  const stop=new AbortController(),abort=()=>stop.abort(new Error('Runner interrupted; saved calls remain resumable'));process.once('SIGINT',abort);process.once('SIGTERM',abort);
  const verifyModels=async()=>{const response=await fetch('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(5000)});check(response.ok,'Model tags unavailable');const current=await response.json();check(modelDetails.every(detail=>current.models.some(m=>m.name===detail.name&&m.digest===detail.digest)),'Model digest changed during benchmark');};
  const assertGate=async()=>{const response=await fetch('http://127.0.0.1:3210/api/health',{signal:AbortSignal.timeout(5000)});check(response.ok,'Workbench gate unavailable');const health=await response.json();check(health.queueDepth===0&&health.activeJobs===0&&health.lab?.exclusiveBenchmark?.id===manifest.id,'Workbench jobs are active or exclusive gate unavailable; no benchmark inference may start');};
  try{
   if(rows.length)manifest.recoveryEvents=[...(manifest.recoveryEvents??[]),{at:new Date().toISOString(),savedFormal:rows.length,previousStatus:manifest.status,note:'Only persisted formal keys are skipped; process/model residency may have changed, loadMs and ps samples remain recorded.'}];
   manifest.status='running';manifest.runner={pid:process.pid,startedAt:new Date().toISOString()};delete manifest.error;await publish();await assertGate();
   const providers=createProviders();let previousModel=null;
   for(const model of models){
    if(order.every(c=>keys.has(model+'/'+c.id)))continue;
    await verifyModels();check(same(sourceHashes,await hashes(freezePaths)),'Source changed before model start');await assertGate();
    const resident=await readOllamaSample();
    check(!resident.error,'Cannot verify exclusive model residency; no inference started: '+resident.error);
    for(const item of resident.models.filter(item=>item.name&&item.name!==model)){
     const response=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:item.name,keep_alive:0}),signal:AbortSignal.timeout(30000)});
     check(response.ok,'Failed to unload another resident model: '+item.name);
     manifest.residencyEvents=[...(manifest.residencyEvents??[]),{at:new Date().toISOString(),action:'unload',model:item.name,formalInference:false}];
    }
    manifest.active={model,phase:'warmup'};await publish();
    if(!manifest.warmups.some(item=>item.model===model)){
     let warmup;
     try{warmup=await runPipeline({text:'手机还剩多少电',model,mode:'unified',context:structuredClone(baseContext),options},{providers,signal:stop.signal});}
     catch(error){if(!error.partialRun||error.partialRun.traces?.length!==1)throw error;warmup=error.partialRun;}
     const warmupPath=join(evidenceRoot,'warmups',modelKey(model)+'.json');await saveNewRecord(warmupPath,warmup);
     manifest.warmups.push({model,path:relative(root,warmupPath).replaceAll('\\','/'),excludedFromScores:true,status:warmup.status,totalMs:warmup.totalMs});
     await publish();stop.signal.throwIfAborted();
    }
    previousModel=model;
    for(const c of order){
     if(keys.has(model+'/'+c.id))continue;stop.signal.throwIfAborted();
     manifest.active={model,caseId:c.id,testDomain:c.testDomain,phase:'inference',startedAt:new Date().toISOString()};await save(manifestPath,{...manifest,updatedAt:new Date().toISOString()});
     const context={...structuredClone(baseContext),...structuredClone(c.context??{})},hostBefore=sampleHost();
     let run,inferenceSamples;
     try{const measured=await withInferenceSampling(()=>runPipeline({text:c.text,model,mode:'unified',context,options},{providers,signal:stop.signal}));run=measured.value;inferenceSamples=measured.samples;}
     catch(error){if(!error.partialRun||error.partialRun.traces?.length!==1)throw error;run=error.partialRun;inferenceSamples=error.measurementSamples;}
     const hostAfter=sampleHost(),record={manifestId:manifest.id,model,caseId:c.id,testDomain:c.testDomain,scenario:c.scenario,text:c.text,origin:c.origin,expected:structuredClone(c.expected),contractBoundary:c.contractBoundary??null,userGoalStatus:c.userGoalStatus??null,context,inferenceSamples,
      hostSample:{before:hostBefore,after:hostAfter,cpuBusyFraction:cpuBusyFraction(hostBefore,hostAfter),note:'整机首尾CPU累计ticks与可用内存，推理期间另采host/ps；runner RSS不含Ollama进程，不表示峰值RAM或独占CPU利用率'},
      createdAt:new Date().toISOString(),run,rawScore:scoreCase(c.expected,run),execution:scoreExecutionSemantics(c.expected,run,run.context??context)};
     const path=join(evidenceRoot,modelKey(model),c.id+'.json');record.recordSha256=await saveNewRecord(path,record);
     const row=compactRecord(record);rows.push(row);keys.add(model+'/'+c.id);await publish({index:rows.length%10===0});
     console.log(JSON.stringify({done:rows.length,total:plan.totalCalls,model,caseId:c.id,domain:c.testDomain,api:run.api,rawArguments:row.rawScore.arguments,semantics:row.execution.plan,primary:row.primary,wallMs:Math.round(row.wallMs)}));
     stop.signal.throwIfAborted();
    }
    await verifyModels();check(same(sourceHashes,await hashes(freezePaths)),'Source changed during benchmark');await publish();
   }
   check(rows.length===plan.totalCalls,'Incomplete formal calls');manifest.status='completed';manifest.completedAt=new Date().toISOString();manifest.active=null;await publish();
   if(previousModel)await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:previousModel,keep_alive:0}),signal:AbortSignal.timeout(30000)});
   console.log(JSON.stringify({status:'completed',id:manifest.id,total:rows.length}));
  }catch(error){manifest.status=stop.signal.aborted?'interrupted':'failed';manifest.error=error.message;manifest.active=null;await publish();throw error;}
  finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
 }finally{await handle.close();const owner=await read(lockPath);if(owner.pid===process.pid)await unlink(lockPath);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
