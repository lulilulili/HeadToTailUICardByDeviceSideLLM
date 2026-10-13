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
import {PROMPT_VERSION,ADAPTIVE_PROMPT_VERSION} from '../src/prompts.mjs';
import {ADAPTIVE_ROUTING_VERSION,analyzeAdaptiveRoute} from '../src/adaptive-routing.mjs';
import {GROUNDING_VERSION} from '../src/grounding.mjs';
import {loadSingleService100Cases,singleService100Plan,SINGLE_SERVICE_100_MODELS as defaultModels,SINGLE_SERVICE_100_DOMAINS as domains,SINGLE_SERVICE_100_CONTEXT as baseContext,SINGLE_SERVICE_100_FILES,SINGLE_SERVICE_100_SUITE as suite} from '../src/single-service-100.mjs';
import {buildSingleService100Report,primaryFailure} from '../src/single-service-100-report.mjs';
import {saveReplaySourceSnapshot} from './replay-grounding.mjs';
import {collectTestEnvironment,sampleHost,readOllamaSample,withInferenceSampling} from '../src/test-environment.mjs';
import {loadComparisonBaseline} from './comparison-baseline.mjs';
import {createLayaShadowObserver,LAYA_SHADOW_POLICY,verifyLayaShadowRecord} from './shadow-laya.mjs';

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
sourcePaths.push('tests/single-service-100-adaptive-runner.test.mjs');
sourcePaths.push('tests/adaptive-1000-audit.test.mjs','tests/adaptive-report-shadow.test.mjs','tests/adaptive-report-timing.test.mjs','tests/comparison-baseline.test.mjs','tests/shadow-laya.test.mjs','tests/single-service-100-adaptive-view.test.mjs','tests/single-service-100-shadow-view.test.mjs');
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
export function validateResumeManifest(manifest,{models,sourceHashes,corpusHash,caseOrder,modelDetails,options:expectedOptions,context:expectedContext,mode:expectedMode}){
 const plan=singleService100Plan(manifest);
 check(same(plan.models,models)&&same(plan.modelOrder,models)&&same(manifest.conditions.sourceHashes,sourceHashes)&&manifest.corpus.sha256===corpusHash&&same(manifest.corpus.caseOrder,caseOrder)&&same(manifest.conditions.modelDetails.map(m=>({name:m.name,digest:m.digest})),modelDetails.map(m=>({name:m.name,digest:m.digest}))),'Frozen plan, code, corpus, order or model identities changed; refusing mixed-version resume');
 if(expectedOptions)check(same(manifest.conditions.options,expectedOptions),'Frozen inference options changed; refusing resume');
 if(expectedContext)check(same(manifest.conditions.context,expectedContext),'Frozen baseline context changed; refusing resume');
 if(expectedMode!==undefined)check(plan.mode===expectedMode,'Frozen benchmark mode changed; refusing resume');
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
 if(record.run?.mode==='adaptive')return compactAdaptiveRecord(record);
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

const measured=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const traceTotal=(traces,key)=>traces.length&&traces.every(trace=>measured(trace[key]))?traces.reduce((sum,trace)=>sum+trace[key],0):null;
function compactAdaptiveRecord(record){
 const row=compactRecord({...record,run:{...record.run,mode:'unified'}}),{run}=record,traces=run.traces??[];
 const decisionStage=traces.find(trace=>trace.stage==='intent_arguments'||trace.stage==='intent')?.stage;
 const decision=traces.find(trace=>trace.stage===decisionStage),domainTrace=traces.find(trace=>trace.stage==='domain');
 let parsed,parsedDomain;try{parsed=JSON.parse(decision?.raw);}catch{}try{parsedDomain=JSON.parse(domainTrace?.raw)?.domain;}catch{}
 const ids=run.candidates?.[decisionStage]?.ids,candidateRecall=Array.isArray(ids)&&ids.includes(record.expected.api);
 const selectedDomain=typeof parsedDomain==='string'?parsedDomain:null;
 const domainSelectionCorrect=selectedDomain===record.expected.domain;
 const eligible=domainSelectionCorrect&&Array.isArray(ids),failed=traces.find(trace=>trace.error);
 Object.assign(row,{actualCallCount:traces.length,modelCallMs:traceTotal(traces,'wallMs'),modelCallMsCoverage:{known:traces.filter(trace=>measured(trace.wallMs)).length,total:traces.length},routing:run.routing??null,
  traceTimings:traces.map(trace=>Object.fromEntries(['stage','provider','model','startedAt','completedAt','wallMs','loadMs','promptMs','generationMs','inputTokens','outputTokens','tokensPerSecond','error','errorType','truncated','promptVersion'].map(key=>[key,trace[key]??null]))),
  selectedDomain,domainSelectionCorrect,candidateRecall,candidateRecallEligible:eligible,domainGateMiss:selectedDomain!==null&&!domainSelectionCorrect&&!candidateRecall,retrievalMiss:eligible&&!candidateRecall,
  parsedApiCorrect:parsedDomain===record.expected.domain&&parsed?.api===record.expected.api,providerError:Boolean(failed),errorType:failed?.errorType??null,truncated:traces.some(trace=>trace.truncated===true),inputTokens:traceTotal(traces,'inputTokens'),outputTokens:traceTotal(traces,'outputTokens'),
  performance:{...row.performance,loadMs:traceTotal(traces,'loadMs'),promptMs:traceTotal(traces,'promptMs'),generationMs:traceTotal(traces,'generationMs')}});
 row.performance.tokensPerSecond=row.outputTokens!==null&&row.performance.generationMs>0?row.outputTokens/(row.performance.generationMs/1000):null;
 if(record.shadow!==undefined)row.shadow=structuredClone(record.shadow);
 row.primary=primaryFailure(row);return row;
}

/** Shared by runner resume and offline verifier; no inference or score mutation. */
export function validateStoredBenchmarkRun(run,{model,text,manifest,label='stored run'}={}){
 const mode=manifest?.conditions?.mode??'unified',conditions=manifest?.conditions??{},modern=manifest?.version==='single-service-100-batch-v3';
 check(run&&typeof run==='object',`${label}: missing run`);
 check(run.model===model,`${label} run.model`);check(run.text===text,`${label} run.text`);check(run.mode===mode,`${label} run.mode`);
 check(same(run.options,conditions.options),`${label} run.options`);
 check(Array.isArray(run.traces),`${label}: traces missing`);
 if(modern)check(measured(run.totalMs),`${label}: invalid measured run.totalMs`);
 if(modern||mode==='adaptive')check(!Object.keys(run.stages??{}).length,`${label}: stage overrides forbidden`);
 for(const trace of run.traces){
  check(trace.model===model,`${label} trace.model`);
  check(trace.provider===undefined&&!modern||trace.provider==='ollama',`${label}: only primary Ollama is permitted`);
  check(typeof trace.raw==='string',`${label}: trace.raw missing`);
  if(modern)check(measured(trace.wallMs),`${label}: invalid measured trace.wallMs`);
  if(trace.promptVersion!=null)check(trace.promptVersion===conditions.promptVersion,`${label}: trace.promptVersion`);
 }
 if(modern&&!['error','cancelled'].includes(run.status))check(!run.traces.some(trace=>trace.error),`${label}: successful result contains failed primary trace`);
 if(mode==='unified'){
  check(run.traces.length===1,`${label}: require one formal unified model trace, including errors/timeouts`);
  check(run.traces[0].stage==='unified',`${label} trace.stage`);
  for(const stage of Object.values(run.stages??{}))if(stage?.model!==undefined)check(stage.model===model,`${label} stage model override`);
  return true;
 }
 check(mode==='adaptive',`${label}: invalid benchmark mode`);
 const routing=run.routing,route=analyzeAdaptiveRoute(text),stages=run.traces.map(trace=>trace.stage);
 check(routing&&routing.policy===(conditions.routingPolicy??ADAPTIVE_ROUTING_VERSION)&&routing.path===route.path,`${label}: routing policy/path differs`);
 check(routing.actualCallCount===stages.length&&same(routing.actualStages,stages),`${label}: routing call count/stages differ`);
 const expected=route.path==='two_step'?['domain','intent_arguments']:['domain','intent','arguments'];
 check(stages.length>0&&stages.length<=expected.length&&stages.every((stage,index)=>stage===expected[index]),`${label}: illegal adaptive stage sequence`);
 if(['error','cancelled'].includes(run.status))return true;
 if(run.status==='unsupported'){
  check(!run.api&&run.domain==='unsupported',`${label}: invalid unsupported result`);
  check(stages.length===1||stages.length===2,`${label}: unsupported called later arguments`);return true;
 }
 if(stages.length===expected.length)return true;
 if(route.path==='three_step'&&stages.length===2){
  check(run.api&&Object.keys(getCapability(run.api)?.inputs??{unknown:true}).length===0,`${label}: argument stage omitted for API with inputs`);
  check(routing.skippedStages?.some(item=>item.stage==='arguments'&&item.reason==='api_has_no_inputs'),`${label}: missing no-input skip reason`);return true;
 }
 throw new Error(`${label}: incomplete adaptive success`);
}

export function withBenchmarkCallTiming(provider){
 return {...provider,async invoke(request){
  const startedAt=new Date().toISOString();
  try{const response=await provider.invoke(request);return {...response,trace:{...response.trace,startedAt:response.trace?.startedAt??startedAt,completedAt:new Date().toISOString()}};}
  catch(error){error.trace={stage:request.stage,model:request.model,provider:'ollama',raw:'',...error.trace,startedAt:error.trace?.startedAt??startedAt,completedAt:new Date().toISOString()};throw error;}
 }};
}

export async function executeBenchmarkRequest(input,{providers,signal,shadowObserver,expected,pipeline=runPipeline,measure=false,sampling=withInferenceSampling}={}){
 signal?.throwIfAborted();
 const perform=async()=>{
  shadowObserver?.beginCase({text:input.text,context:input.context});
  let run,cause;
  try{run=await pipeline(input,{providers:shadowObserver?.providers??providers,signal});}
  catch(error){if(error.partialRun)run=error.partialRun;else{cause=error;run={...input,status:'error',error:error.message,traces:[],totalMs:0};}}
  const shadow=shadowObserver?await shadowObserver.finishCase({run,expected}):undefined;
  if(cause)throw cause;
  return {run,...(shadow!==undefined?{shadow}:{})};
 };
 if(!measure)return perform();
 const measured=await sampling(perform);
 return {...measured.value,inferenceSamples:measured.samples};
}

export function closeUnfinishedExecutionWindows(manifest){
 for(const windows of [manifest.executionWindows??[],manifest.modelExecutionWindows??[]])for(const window of windows){
  if(window.endedAt)continue;
  check(Number.isFinite(Date.parse(manifest.updatedAt))&&Date.parse(manifest.updatedAt)>=Date.parse(window.startedAt),'Cannot infer a crashed execution window beyond its saved heartbeat');
  window.endedAt=manifest.updatedAt;window.endedAtBasis='last_saved_heartbeat';
 }
}
export async function verifyFrozenComparisonBaseline(manifest,{loader=loadComparisonBaseline}={}){
 const baseline=manifest.comparisonBaseline;if(!baseline)return true;
 check(typeof baseline.sourcePath==='string'&&baseline.sourcePath.length>0,'Frozen comparison baseline source path missing');
 const current=await loader({root,manifestPath:baseline.sourcePath,corpusHash:manifest.corpus.sha256,caseOrder:manifest.corpus.caseOrder,models:manifest.conditions.models,modelDetails:manifest.conditions.modelDetails,options:manifest.conditions.options,context:manifest.conditions.context});
 check(same(current,baseline),'Frozen comparison baseline files or metrics changed; refusing mixed comparison');return true;
}
const warmupExpected={domain:'device',api:'device.battery.level',arguments:{},status:'ready_mock'};
export function validateSavedBenchmarkWarmup(run,item,manifest){
 const model=item.model;check(singleService100Plan(manifest).models.includes(model),'Warmup model outside frozen plan');
 validateStoredBenchmarkRun(run,{model,text:'手机还剩多少电',manifest,label:'saved warmup'});
 check(same(run.context,manifest.conditions.context),'Warmup context differs from frozen baseline');
 check(item.excludedFromScores===true&&item.status===run.status&&item.totalMs===run.totalMs,'Warmup registered metadata differs');
 if(manifest.version==='single-service-100-batch-v3'){
  check(item.actualCallCount===run.traces.length&&item.modelCallMs===traceTotal(run.traces,'wallMs'),'Warmup registered model-call timing differs');
  verifyLayaShadowRecord(run.shadow,run,{expected:warmupExpected,text:run.text,enabled:manifest.conditions.layaShadow?.enabled===true});
 }
 return true;
}
async function loadSavedWarmups(manifest){
 const items=manifest.warmups??[],byModel=new Map(items.map(item=>[item.model,item]));
 check(byModel.size===items.length,'Duplicate registered model warmup');
 const expectedPaths=new Map(singleService100Plan(manifest).models.map(model=>[modelKey(model)+'.json',model]));
 const found=new Set(),folder=join(evidenceRoot,'warmups');let recovered=0;
 for(const entry of await readdir(folder,{withFileTypes:true}).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error))){
  if(/\.pending-|\.tmp/.test(entry.name))continue;
  check(entry.isFile()&&expectedPaths.has(entry.name),'Unexpected saved warmup path');
  const model=expectedPaths.get(entry.name),path=join(folder,entry.name),bytes=await readFile(path),run=JSON.parse(bytes),registered=byModel.get(model);
  const rel=relative(root,path).replaceAll('\\','/');
  if(registered)check(registered.path===rel,'Registered warmup path differs from frozen model');
  const item=registered??{model,path:rel,excludedFromScores:true,status:run.status,totalMs:run.totalMs,actualCallCount:run.traces?.length,modelCallMs:traceTotal(run.traces??[],'wallMs'),recoveredFromSavedRaw:true};
  validateSavedBenchmarkWarmup(run,item,manifest);
  if(item.recordSha256)check(item.recordSha256===hash(bytes),'Saved warmup differs from registered SHA-256');
  if(!registered){check(++recovered<=1,'Multiple unregistered warmups cannot be recovered');items.push({...item,recordSha256:hash(bytes)});}
  found.add(model);
 }
 check(items.every(item=>found.has(item.model)),'Registered warmup raw file missing');manifest.warmups=items;
}
async function loadSaved(manifest,cases){
 await loadSavedWarmups(manifest);
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
   validateStoredBenchmarkRun(record.run,{model,text:c.text,manifest,label:path});
   if(manifest.version==='single-service-100-batch-v3')verifyLayaShadowRecord(record.shadow,record.run,{expected:c.expected,text:c.text,enabled:manifest.conditions.layaShadow?.enabled===true});
   check(same(record.run.context,record.context),'Stored run context/options differ from frozen resume plan');
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
 const result={newRun:false,initialize:false,exportOnly:false,manifest:null,help:false,mode:undefined,baselineManifest:null,layaShadow:false};
 for(let i=0;i<args.length;i++){
  const arg=args[i];if(arg==='--new')result.newRun=true;else if(arg==='--initialize')result.initialize=true;
  else if(arg==='--export-only')result.exportOnly=true;else if(arg==='--help')result.help=true;
  else if(arg==='--manifest'){check(args[i+1]&&!args[i+1].startsWith('--'),'--manifest requires a path');result.manifest=args[++i];}
  else if(arg==='--mode'){check(['unified','adaptive'].includes(args[i+1]),'--mode requires unified or adaptive');result.mode=args[++i];}
  else if(arg==='--baseline-manifest'){check(args[i+1]&&!args[i+1].startsWith('--'),'--baseline-manifest requires a path');result.baselineManifest=args[++i];}
  else if(arg==='--laya-shadow')result.layaShadow=true;
  else throw new Error('Unknown benchmark argument: '+arg);
 }
 check(!(result.newRun&&result.manifest),'Choose --new or --manifest, not both');
 check(result.help||result.newRun||result.manifest,'Explicit --new or --manifest is required; historical artifacts are never reused implicitly');
 check(!result.baselineManifest||result.newRun,'--baseline-manifest is new-only');
 check(!result.layaShadow||result.newRun&&(result.mode??'unified')==='adaptive','--laya-shadow requires a new adaptive batch');
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
 const invocationStartedAt=new Date().toISOString();
 const cli=parseBenchmarkArguments(process.argv.slice(2));
 if(cli.help){console.log('New queued run: node scripts/benchmark-single-service-100.mjs --new [--mode unified|adaptive] [--baseline-manifest <path>] [--laya-shadow] --initialize\nResume/start: node scripts/benchmark-single-service-100.mjs --manifest <absolute manifest.json>\nPublish only: --manifest <path> --export-only');return;}
 await mkdir(dirname(lockPath),{recursive:true});const handle=await acquireLock();
 try{
  const cases=await loadSingleService100Cases(root),coverage=validateSuite(cases),order=orderedCases(cases),freezePaths=await collectSourcePaths(root),sourceHashes=await hashes(freezePaths),corpusHash=hash(JSON.stringify(cases));
  let manifest,models,modelDetails,storage;
  if(cli.newRun){
   const id=createBenchmarkIdentity();storage=benchmarkStorage(id);models=[...defaultModels];modelDetails=await installedModels(models);
   const hardware=await collectTestEnvironment();
   const mode=cli.mode??'unified';
   const comparisonBaseline=cli.baselineManifest?await loadComparisonBaseline({root,manifestPath:cli.baselineManifest,corpusHash,caseOrder:order.map(c=>c.id),models,modelDetails,options,context:baseContext}):undefined;
   const shadowStatus=cli.layaShadow?await createProviders().laya.getStatus():undefined;
   if(shadowStatus)check(shadowStatus.ready===true,'Laya shadow model must be ready before freezing the batch');
   manifest={version:'single-service-100-batch-v3',id,suite,status:'queued',createdAt:new Date().toISOString(),warmups:[],executionWindows:[],modelExecutionWindows:[],storage,sourceSnapshot:storage.snapshotDirectory,...(comparisonBaseline?{comparisonBaseline}:{}),
    corpus:{total:1000,perDomain:100,original:100,new:900,sha256:corpusHash,coverage,caseOrder:order.map(c=>c.id),contractBoundaries:cases.filter(c=>c.contractBoundary).map(c=>({id:c.id,text:c.text,expectedStatus:c.expected.status,userGoalStatus:c.userGoalStatus,boundary:c.contractBoundary}))},
    conditions:{sourceHashes,catalogVersion:'single-service-v3',mode,promptVersion:mode==='adaptive'?ADAPTIVE_PROMPT_VERSION:PROMPT_VERSION,routingPolicy:mode==='adaptive'?ADAPTIVE_ROUTING_VERSION:'unified-single-v1',groundingVersion:GROUNDING_VERSION,models,modelOrder:models,domains,modelDetails,options,context:baseContext,hardware,modelDirectory:hardware.modelDirectory,callsPerModel:1000,totalCalls:models.length*1000,requestsPerModel:1000,totalRequests:models.length*1000,repeats:1,
     ...(shadowStatus?{layaShadow:{enabled:true,policy:LAYA_SHADOW_POLICY,observedStatus:shadowStatus}}:{}),
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
   validateResumeManifest(manifest,{models,sourceHashes,corpusHash,caseOrder:order.map(c=>c.id),modelDetails,options,context:baseContext,mode:cli.mode});
   const snapshot=await saveReplaySourceSnapshot({root,snapshotDirectory,paths:freezePaths});
   check(snapshot.files.every(file=>file.sha256===sourceHashes[file.path]),'Frozen snapshot differs on resume');
  }
  await verifyFrozenComparisonBaseline(manifest);
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
  let executionWindow,modelWindow;
  const verifyModels=async()=>{const response=await fetch('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(5000)});check(response.ok,'Model tags unavailable');const current=await response.json();check(modelDetails.every(detail=>current.models.some(m=>m.name===detail.name&&m.digest===detail.digest)),'Model digest changed during benchmark');};
  const assertGate=async()=>{const response=await fetch('http://127.0.0.1:3210/api/health',{signal:AbortSignal.timeout(5000)});check(response.ok,'Workbench gate unavailable');const health=await response.json();check(health.queueDepth===0&&health.activeJobs===0&&health.lab?.exclusiveBenchmark?.id===manifest.id,'Workbench jobs are active or exclusive gate unavailable; no benchmark inference may start');};
  try{
   closeUnfinishedExecutionWindows(manifest);
   executionWindow={startedAt:invocationStartedAt,endedAt:null};(manifest.executionWindows??=[]).push(executionWindow);
   if(rows.length)manifest.recoveryEvents=[...(manifest.recoveryEvents??[]),{at:new Date().toISOString(),savedFormal:rows.length,previousStatus:manifest.status,note:'Only persisted formal keys are skipped; process/model residency may have changed, loadMs and ps samples remain recorded.'}];
   manifest.status='running';manifest.runner={pid:process.pid,startedAt:new Date().toISOString()};delete manifest.error;await publish();await assertGate();
   const providers=createProviders();providers.ollama=withBenchmarkCallTiming(providers.ollama);
   let observer;
   if(manifest.conditions.layaShadow?.enabled){
    check(plan.mode==='adaptive'&&manifest.conditions.layaShadow.policy===LAYA_SHADOW_POLICY,'Invalid frozen Laya shadow policy');
    const status=await providers.laya.getStatus(),frozen=manifest.conditions.layaShadow.observedStatus;
    check(status.ready===true&&['model','modelRevision','version','url','tournamentGroup','maxChoices','maxLen','headMaxLen','threads'].every(key=>same(status[key],frozen[key])),'Laya shadow deployment differs from the frozen ready checkpoint');
    observer=createLayaShadowObserver({providers});
   }
   let previousModel=null;
   for(const model of models){
    if(order.every(c=>keys.has(model+'/'+c.id)))continue;
    modelWindow={model,startedAt:new Date().toISOString(),endedAt:null};(manifest.modelExecutionWindows??=[]).push(modelWindow);
    await verifyFrozenComparisonBaseline(manifest);await verifyModels();check(same(sourceHashes,await hashes(freezePaths)),'Source changed before model start');await assertGate();
    const resident=await readOllamaSample();
    check(!resident.error,'Cannot verify exclusive model residency; no inference started: '+resident.error);
    for(const item of resident.models.filter(item=>item.name&&item.name!==model)){
     const response=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:item.name,keep_alive:0}),signal:AbortSignal.timeout(30000)});
     check(response.ok,'Failed to unload another resident model: '+item.name);
     manifest.residencyEvents=[...(manifest.residencyEvents??[]),{at:new Date().toISOString(),action:'unload',model:item.name,formalInference:false}];
    }
    manifest.active={model,phase:'warmup'};await publish();
    if(!manifest.warmups.some(item=>item.model===model)){
     const warmupResult=await executeBenchmarkRequest({text:'手机还剩多少电',model,mode:plan.mode,context:structuredClone(baseContext),options},{providers,signal:stop.signal,shadowObserver:observer,expected:warmupExpected}),warmup=warmupResult.run;
     validateStoredBenchmarkRun(warmup,{model,text:'手机还剩多少电',manifest,label:'warmup'});
     if(warmupResult.shadow!==undefined)warmup.shadow=warmupResult.shadow;
     const warmupPath=join(evidenceRoot,'warmups',modelKey(model)+'.json'),warmupItem={model,path:relative(root,warmupPath).replaceAll('\\','/'),excludedFromScores:true,status:warmup.status,totalMs:warmup.totalMs,actualCallCount:warmup.traces.length,modelCallMs:traceTotal(warmup.traces,'wallMs')};
     validateSavedBenchmarkWarmup(warmup,warmupItem,manifest);warmupItem.recordSha256=await saveNewRecord(warmupPath,warmup);manifest.warmups.push(warmupItem);
     await publish();stop.signal.throwIfAborted();
    }
    previousModel=model;
    for(const c of order){
     if(keys.has(model+'/'+c.id))continue;stop.signal.throwIfAborted();
     manifest.active={model,caseId:c.id,testDomain:c.testDomain,phase:'inference',startedAt:new Date().toISOString()};await save(manifestPath,{...manifest,updatedAt:new Date().toISOString()});
     const context={...structuredClone(baseContext),...structuredClone(c.context??{})},hostBefore=sampleHost();
     const measured=await executeBenchmarkRequest({text:c.text,model,mode:plan.mode,context,options},{providers,signal:stop.signal,shadowObserver:observer,expected:c.expected,measure:true}),{run,inferenceSamples,shadow}=measured;
     validateStoredBenchmarkRun(run,{model,text:c.text,manifest,label:c.id});
     verifyLayaShadowRecord(shadow,run,{expected:c.expected,text:c.text,enabled:manifest.conditions.layaShadow?.enabled===true});
     const hostAfter=sampleHost(),record={manifestId:manifest.id,model,caseId:c.id,testDomain:c.testDomain,scenario:c.scenario,text:c.text,origin:c.origin,expected:structuredClone(c.expected),contractBoundary:c.contractBoundary??null,userGoalStatus:c.userGoalStatus??null,context,inferenceSamples,
      hostSample:{before:hostBefore,after:hostAfter,cpuBusyFraction:cpuBusyFraction(hostBefore,hostAfter),scope:observer?'primary_and_parallel_laya_until_settled':'primary_pipeline',note:'整机首尾CPU累计ticks与可用内存，采样涵盖主链路及并行Laya完成等待（如启用）；runner RSS不含Ollama或Laya进程，不表示峰值RAM或独占CPU利用率'},
      createdAt:new Date().toISOString(),run,...(shadow!==undefined?{shadow}:{}),rawScore:scoreCase(c.expected,run),execution:scoreExecutionSemantics(c.expected,run,run.context??context)};
     const path=join(evidenceRoot,modelKey(model),c.id+'.json');record.recordSha256=await saveNewRecord(path,record);
     const row=compactRecord(record);rows.push(row);keys.add(model+'/'+c.id);await publish({index:rows.length%10===0});
     console.log(JSON.stringify({done:rows.length,total:plan.totalCalls,model,caseId:c.id,domain:c.testDomain,api:run.api,rawArguments:row.rawScore.arguments,semantics:row.execution.plan,primary:row.primary,wallMs:Math.round(row.wallMs)}));
     stop.signal.throwIfAborted();
    }
    await verifyModels();check(same(sourceHashes,await hashes(freezePaths)),'Source changed during benchmark');modelWindow.endedAt=new Date().toISOString();await publish();
   }
   check(rows.length===plan.totalCalls,'Incomplete formal calls');
   if(previousModel)await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:previousModel,keep_alive:0}),signal:AbortSignal.timeout(30000)});
   manifest.status='completed';manifest.completedAt=new Date().toISOString();executionWindow.endedAt=manifest.completedAt;manifest.active=null;await publish();
   console.log(JSON.stringify({status:'completed',id:manifest.id,total:rows.length}));
  }catch(error){const endedAt=new Date().toISOString();if(executionWindow&&!executionWindow.endedAt)executionWindow.endedAt=endedAt;if(modelWindow&&!modelWindow.endedAt)modelWindow.endedAt=endedAt;manifest.status=stop.signal.aborted?'interrupted':'failed';manifest.error=error.message;manifest.active=null;await publish();throw error;}
  finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
 }finally{await handle.close();const owner=await read(lockPath);if(owner.pid===process.pid)await unlink(lockPath);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
