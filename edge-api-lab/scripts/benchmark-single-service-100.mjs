import {readFile,writeFile,rename,mkdir,open,unlink,link} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {cpus,totalmem,freemem,platform} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createProviders} from '../src/providers.mjs';
import {runPipeline} from '../src/pipeline.mjs';
import {getCapability,validateArguments,capabilities} from '../src/registry.mjs';
import {resolveArguments} from '../src/resolver.mjs';
import {scoreCase} from '../src/evaluation.mjs';
import {scoreExecutionSemantics} from '../src/semantic-evaluation.mjs';
import {PROMPT_VERSION} from '../src/prompts.mjs';
import {GROUNDING_VERSION} from '../src/grounding.mjs';
import {loadSingleService100Cases,SINGLE_SERVICE_100_MODELS as models,SINGLE_SERVICE_100_DOMAINS as domains,SINGLE_SERVICE_100_CONTEXT as baseContext,SINGLE_SERVICE_100_FILES,SINGLE_SERVICE_100_SUITE as suite} from '../src/single-service-100.mjs';
import {buildSingleService100Report,primaryFailure} from '../src/single-service-100-report.mjs';
import {saveReplaySourceSnapshot} from './replay-grounding.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath=join(root,'data/runtime/single-service-100-suite.json');
const reportPath=join(root,'docs/single-service-100-v1-results.json');
const evidenceRoot=join(root,'evidence/single-service-100-v1');
const indexPath=join(evidenceRoot,'index.json');
const lockPath=join(root,'data/runtime/single-service-100.lock');
const snapshotDirectory='data/benchmark-single-service-100-v1';
const options={num_ctx:2048,num_predict:224,timeoutMs:180000,temperature:0};
const sourcePaths=['src/registry.mjs','src/weather-capabilities.mjs','src/extended-capabilities.mjs','src/system-capabilities.mjs','src/prompts.mjs','src/providers.mjs','src/pipeline.mjs','src/resolver.mjs','src/grounding.mjs','src/system-context.mjs','src/fixtures.mjs','src/evaluation.mjs','src/semantic-evaluation.mjs','src/runtime.mjs','src/corpus.mjs','src/application.mjs','src/single-service-100.mjs','src/single-service-100-report.mjs','data/single-service-core.mjs','data/cases-system-single.json',...SINGLE_SERVICE_100_FILES,'scripts/benchmark-single-service-100.mjs','scripts/replay-grounding.mjs','server.mjs','package.json','public/app.js','public/index.html','public/context-builder.mjs','public/evaluation-view.mjs','public/ui-utils.mjs','public/single-service-100-view.mjs','tests/single-service-100-report.test.mjs','tests/single-service-100-http.test.mjs','tests/single-service-100-view.test.mjs','tests/single-service-ui.test.mjs'];
// New snapshots must also freeze the host-generated parameter audit and its UI.
sourcePaths.push('src/parameter-provenance.mjs','public/provenance-view.mjs','public/run-view.mjs','tests/parameter-provenance.test.mjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sampleHost=()=>({at:new Date().toISOString(),freeMemoryBytes:freemem(),runnerRssBytes:process.memoryUsage().rss,cpuTicks:cpus().map(c=>c.times)});
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
const hashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async p=>[p,hash(await readFile(join(root,p)))])));
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
  performance:{loadMs:trace.loadMs??null,promptMs:trace.promptMs??null,generationMs:trace.generationMs??null,tokensPerSecond:trace.tokensPerSecond??null,deterministicMs:run.deterministicMs??null,hostBefore:record.hostSample?.before??null,hostAfter:record.hostSample?.after??null,hostCpuBusyFraction:record.hostSample?.cpuBusyFraction??null},
  detailPath:`/api/single-service-100-run/${modelKey(record.model)}/${record.caseId}`,recordSha256:record.recordSha256??null};
 row.primary=primaryFailure(row);return row;
}
async function loadSaved(manifest,cases){
 const rows=[];let previousIndex;
 try{previousIndex=await read(indexPath);check(previousIndex.manifestId===manifest.id,'Saved index belongs to another benchmark');}catch(error){if(error.code!=='ENOENT')throw error;}
 const registered=new Map((previousIndex?.rows??[]).map(row=>[`${row.model}/${row.caseId}`,row.recordSha256]));
 for(const model of models)for(const c of cases){
  const path=join(evidenceRoot,modelKey(model),`${c.id}.json`);
  try{const bytes=await readFile(path),record=JSON.parse(bytes),digest=hash(bytes),registeredDigest=registered.get(`${model}/${c.id}`);
   check(record.manifestId===manifest.id&&record.model===model&&record.caseId===c.id&&record.testDomain===c.testDomain&&record.text===c.text&&record.scenario===c.scenario&&same(record.expected,c.expected)&&same(record.context,{...structuredClone(baseContext),...structuredClone(c.context??{})}),`Stored evidence ownership/gold/context changed: ${path}`);
   check(!registeredDigest||registeredDigest===digest,`Saved raw evidence differs from registered SHA-256: ${path}`);
   record.recordSha256=digest;rows.push(compactRecord(record));}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 return rows;
}
async function acquireLock(){
 try{const handle=await open(lockPath,'wx');await handle.writeFile(JSON.stringify({pid:process.pid,token:randomUUID(),createdAt:new Date().toISOString()}));return handle;}
 catch(error){if(error.code!=='EEXIST')throw error;const previous=await read(lockPath);let alive=Number.isInteger(previous.pid)&&previous.pid>0;try{if(alive)process.kill(previous.pid,0);}catch{alive=false;}
  check(!alive,'An existing benchmark runner is alive; refusing duplicate inference');
  await rename(lockPath,`${lockPath}.stale-${Date.now()}`);return acquireLock();}
}
async function main(){
 const initialize=process.argv.includes('--initialize'),exportOnly=process.argv.includes('--export-only');
 await mkdir(dirname(manifestPath),{recursive:true});
 const handle=await acquireLock();
 try{
 const cases=await loadSingleService100Cases(root),coverage=validateSuite(cases),order=orderedCases(cases),sourceHashes=await hashes();
 const tags=await fetch('http://127.0.0.1:11434/api/tags').then(r=>r.json());
 const modelDetails=models.map(name=>tags.models.find(m=>m.name===name));check(modelDetails.every(Boolean),'Three requested models must be installed');
 const corpusHash=hash(JSON.stringify(cases));
 const snapshot=await saveReplaySourceSnapshot({root,snapshotDirectory,paths:sourcePaths});
 check(snapshot.files.every(file=>file.sha256===sourceHashes[file.path]),'Source changed while snapshotting; refusing a mixed-version freeze');
 const verifyModels=async()=>{const current=await fetch('http://127.0.0.1:11434/api/tags').then(r=>r.json());check(modelDetails.every(detail=>current.models.some(m=>m.name===detail.name&&m.digest===detail.digest)),'Model digest changed during benchmark; refusing mixed-model output');};
 let manifest;
 try{manifest=await read(manifestPath);check(same(manifest.conditions.sourceHashes,sourceHashes)&&manifest.corpus.sha256===corpusHash&&same(manifest.conditions.modelDetails.map(m=>m.digest),modelDetails.map(m=>m.digest)),'Frozen code, corpus or models changed; refusing mixed-version resume');}
 catch(error){if(error.code!=='ENOENT')throw error;manifest={id:`single-service-100-v1-20261011-${corpusHash.slice(0,12)}`,suite,status:'queued',createdAt:new Date().toISOString(),warmups:[],sourceSnapshot:snapshot.directory,
  corpus:{total:1000,perDomain:100,original:100,new:900,sha256:corpusHash,coverage,caseOrder:order.map(c=>c.id),contractBoundaries:cases.filter(c=>c.contractBoundary).map(c=>({id:c.id,text:c.text,expectedStatus:c.expected.status,userGoalStatus:c.userGoalStatus,boundary:c.contractBoundary}))},conditions:{sourceHashes,catalogVersion:'single-service-v3',promptVersion:PROMPT_VERSION,groundingVersion:GROUNDING_VERSION,models,modelDetails,options,context:baseContext,
   hardware:{cpu:cpus()[0]?.model,logicalCores:cpus().length,totalMemoryBytes:totalmem(),platform:platform()},modelDirectory:'D:/OllamaModels',callsPerModel:1000,totalCalls:3000,repeats:1,resumePolicy:'已保存记录按key和已登记SHA-256恢复，不重复推理；请求后、落盘前发生进程崩溃的无记录调用无法证明不曾执行，必须另记恢复事件，不能宣称严格exactly-once。',scope:'中文单服务；全pipeline、固定手机位置mock，未接真实Harmony SDK；7B排除',modelOrder:models}};}
 const rows=await loadSaved(manifest,cases),keys=new Set(rows.map(r=>`${r.model}/${r.caseId}`));
 const publish=async({index=true}={})=>{manifest.updatedAt=new Date().toISOString();manifest.progress={done:rows.length,total:3000};await save(manifestPath,manifest);if(index)await save(indexPath,{manifestId:manifest.id,status:manifest.status,updatedAt:manifest.updatedAt,rows});await save(reportPath,buildSingleService100Report(manifest,rows));};
 if(initialize||exportOnly){await publish();console.log(JSON.stringify({status:manifest.status,id:manifest.id,progress:manifest.progress,coverage}));return;}
 if(rows.length===3000&&manifest.status==='completed'){console.log(JSON.stringify({status:'already_completed',id:manifest.id}));return;}
 const stop=new AbortController();
 const abort=()=>stop.abort(new Error('Runner interrupted; saved calls remain resumable'));process.once('SIGINT',abort);process.once('SIGTERM',abort);
 try{
  manifest.status='running';manifest.runner={pid:process.pid,startedAt:new Date().toISOString()};delete manifest.error;await publish();
  // Publish the exclusive gate before inspecting workbench activity. Already
  // accepted/queued HTTP requests must also recheck the gate at invocation.
  const health=await fetch('http://127.0.0.1:3210/api/health').then(r=>r.json());check(health.queueDepth===0&&health.activeJobs===0&&health.lab?.exclusiveBenchmark?.id===manifest.id,'Workbench inference/jobs are active or exclusive gate is unavailable; cannot start benchmark');
  const providers=createProviders();let previousModel=null;
  for(const model of models){
   if(order.every(c=>keys.has(`${model}/${c.id}`)))continue;
   await verifyModels();check(same(sourceHashes,await hashes()),'Source changed before model start');
   if(previousModel)await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:previousModel,keep_alive:0})});
   manifest.active={model,phase:'warmup'};await publish();
   const warmup=await runPipeline({text:'手机还剩多少电',model,mode:'unified',context:structuredClone(baseContext),options},{providers,signal:stop.signal});
   const warmupPath=join(evidenceRoot,'warmups',`${modelKey(model)}-${Date.now()}.json`);await save(warmupPath,warmup);manifest.warmups.push({model,path:warmupPath,excludedFromScores:true,status:warmup.status,totalMs:warmup.totalMs});
   previousModel=model;
   for(const c of order){
    if(keys.has(`${model}/${c.id}`))continue;stop.signal.throwIfAborted();
    manifest.active={model,caseId:c.id,testDomain:c.testDomain,phase:'inference',startedAt:new Date().toISOString()};await save(manifestPath,{...manifest,updatedAt:new Date().toISOString()});
    const context={...structuredClone(baseContext),...structuredClone(c.context??{})};
    const hostBefore=sampleHost();
    const run=await runPipeline({text:c.text,model,mode:'unified',context,options},{providers,signal:stop.signal});
    const hostAfter=sampleHost();
    const record={manifestId:manifest.id,model,caseId:c.id,testDomain:c.testDomain,scenario:c.scenario,text:c.text,origin:c.origin,expected:structuredClone(c.expected),contractBoundary:c.contractBoundary??null,userGoalStatus:c.userGoalStatus??null,context,hostSample:{before:hostBefore,after:hostAfter,cpuBusyFraction:cpuBusyFraction(hostBefore,hostAfter),note:'整机CPU累计ticks与可用内存的首尾采样，不是Ollama独占CPU利用率/峰值RAM；runnerRss仅评测脚本，不含模型进程'},createdAt:new Date().toISOString(),run,rawScore:scoreCase(c.expected,run),execution:scoreExecutionSemantics(c.expected,run,run.context??context)};
    const path=join(evidenceRoot,modelKey(model),`${c.id}.json`);record.recordSha256=await saveNewRecord(path,record);
    const row=compactRecord(record);rows.push(row);keys.add(`${model}/${c.id}`);
    await publish({index:rows.length%10===0});
    console.log(JSON.stringify({done:rows.length,total:3000,model,caseId:c.id,domain:c.testDomain,api:run.api,rawArguments:row.rawScore.arguments,semantics:row.execution.plan,primary:row.primary,wallMs:Math.round(row.wallMs)}));
   }
   await verifyModels();check(same(sourceHashes,await hashes()),'Source changed during benchmark; refusing certify mixed-version output');await publish();
  }
  check(rows.length===3000,'Incomplete formal calls');manifest.status='completed';manifest.completedAt=new Date().toISOString();manifest.active=null;await publish();
  if(previousModel)await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:previousModel,keep_alive:0})});
  console.log(JSON.stringify({status:'completed',id:manifest.id,total:rows.length}));
 }catch(error){manifest.status=stop.signal.aborted?'interrupted':'failed';manifest.error=error.message;manifest.active=null;await publish();throw error;}
 }finally{await handle.close();const owner=await read(lockPath);if(owner.pid===process.pid)await unlink(lockPath);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
