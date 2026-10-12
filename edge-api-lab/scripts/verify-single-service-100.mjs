import {readFile,readdir,realpath,lstat,writeFile,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,resolve,relative,isAbsolute,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {scoreCase} from '../src/evaluation.mjs';
import {scoreExecutionSemantics} from '../src/semantic-evaluation.mjs';
import {buildSingleService100Report} from '../src/single-service-100-report.mjs';
import {loadSingleService100Cases,singleService100Plan,SINGLE_SERVICE_100_MODELS as models,SINGLE_SERVICE_100_DOMAINS as domains,SINGLE_SERVICE_100_CONTEXT as baseContext,SINGLE_SERVICE_100_FILES,SINGLE_SERVICE_100_SUITE as suite} from '../src/single-service-100.mjs';
import {compactRecord,orderedCases,modelKey,benchmarkStorage} from './benchmark-single-service-100.mjs';

// Offline verification only: neither this script nor its imports invoke a model.
// Saved runs are scored as recorded, never re-grounded, repaired, or overwritten.
const defaultRoot=dirname(dirname(fileURLToPath(import.meta.url)));
const formalTotal=3000,perModel=1000,perDomain=100;
const evidenceDirectory='evidence/single-service-100-v1';
const paths={manifest:'data/runtime/single-service-100-suite.json',index:`${evidenceDirectory}/index.json`,report:'docs/single-service-100-v1-results.json'};
const check=(condition,message)=>{if(!condition)throw new Error(message);};
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const jsonValue=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const same=(a,b)=>isDeepStrictEqual(jsonValue(a),jsonValue(b));
const equal=(actual,expected,label)=>check(same(actual,expected),`${label}: mismatch`);
const keyOf=row=>`${row.model}/${row.caseId}`;
const temporary=name=>name.endsWith('.tmp')||/\.pending-/.test(name)||/\.tmp-/.test(name);

export function workspacePath(root,path){
 check(typeof path==='string'&&path.length>0,'Workspace path must be nonempty');
 const workspace=resolve(root),target=resolve(workspace,path),rel=relative(workspace,target);
 check(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith(`..${process.platform==='win32'?'\\':'/'}`),`Path escapes workspace: ${path}`);
 return target;
}
async function safeRead(root,path){
 const target=workspacePath(root,path),physicalRoot=await realpath(root),physical=await realpath(target);
 workspacePath(physicalRoot,physical);
 check((await lstat(target)).isFile(),`Expected a regular file, not a symlink/directory: ${path}`);
 return readFile(target);
}
async function safeEntries(root,path){
 const target=workspacePath(root,path),physical=await realpath(target);workspacePath(await realpath(root),physical);
 check((await lstat(target)).isDirectory(),`Expected a real directory: ${path}`);
 return readdir(target,{withFileTypes:true});
}
export function verifySourceBytes(path,expected,current,snapshot){
 check(/^[a-f0-9]{64}$/i.test(expected??''),`Invalid frozen source SHA-256: ${path}`);
 check(sha256(current)===expected.toLowerCase(),`Current source differs from frozen manifest: ${path}`);
 check(sha256(snapshot)===expected.toLowerCase(),`Frozen snapshot differs from manifest: ${path}`);
 return {path,sha256:expected.toLowerCase()};
}
async function verifySources(root,manifest,{historical=false}={}){
 const entries=Object.entries(manifest.conditions?.sourceHashes??{});
 check(entries.length>0,'Missing manifest.conditions.sourceHashes');
 const required=['src/evaluation.mjs','src/semantic-evaluation.mjs','src/registry.mjs','src/resolver.mjs','src/grounding.mjs','src/single-service-100.mjs','src/single-service-100-report.mjs','scripts/benchmark-single-service-100.mjs','data/single-service-core.mjs','data/cases-system-single.json',...SINGLE_SERVICE_100_FILES];
 if(!historical)required.push('src/parameter-provenance.mjs','src/providers.mjs','src/pipeline.mjs','src/test-environment.mjs','src/benchmark-selection.mjs');
 for(const path of required)check(Object.hasOwn(manifest.conditions.sourceHashes,path),`Missing critical source hash: ${path}`);
 check(typeof manifest.sourceSnapshot==='string','Missing sourceSnapshot');
 const snapshot=workspacePath(root,manifest.sourceSnapshot),verified=[];
 check(snapshot!==resolve(root),'Snapshot cannot be the workspace root');
 for(const [path,expected]of entries){
  check(!isAbsolute(path)&&!path.split(/[\\/]/).includes('..'),`Invalid relative source path: ${path}`);
  const frozen=workspacePath(snapshot,path);workspacePath(root,frozen);
  const snapshotBytes=await safeRead(root,frozen),current=await safeRead(root,path);
  if(historical){check(sha256(snapshotBytes)===expected,`Historical frozen snapshot differs: ${path}`);verified.push({path,sha256:expected,currentMatches:sha256(current)===expected,historical:true});}
  else verified.push(verifySourceBytes(path,expected,current,snapshotBytes));
 }
 return verified;
}
function verifyRunIdentity(run,model,text,manifest,label){
 check(run&&typeof run==='object',`${label}: missing run`);
 equal(run.model,model,`${label} run.model`);equal(run.text,text,`${label} run.text`);
 equal(run.mode,'unified',`${label} run.mode`);equal(run.options,manifest.conditions.options,`${label} run.options`);
 check(Array.isArray(run.traces)&&run.traces.length===1,`${label}: require one formal unified model trace, including errors/timeouts`);
 for(const trace of run.traces){
  equal(trace.model,model,`${label} trace.model (model must match record)`);
  equal(trace.stage,'unified',`${label} trace.stage`);
  check(typeof trace.raw==='string',`${label}: trace.raw must exist, including empty timeout output`);
  if(trace.promptVersion!=null)equal(trace.promptVersion,manifest.conditions.promptVersion,`${label} trace.promptVersion`);
 }
 for(const stage of Object.values(run.stages??{}))if(stage?.model!==undefined)equal(stage.model,model,`${label} stage model override`);
}

export function verifyStoredRecord({bytes,model,caseDefinition:c,manifest,registeredRow=null,engine={scoreCase,scoreExecutionSemantics,compactRecord}}){
 const digest=sha256(bytes),record=JSON.parse(bytes),label=`${model}/${c.id}`;
 if(manifest.conditions.models)check(manifest.conditions.models.includes(model),label+': record model outside manifest');
 const ownership={manifestId:manifest.id,model,caseId:c.id,testDomain:c.testDomain,scenario:c.scenario,text:c.text,origin:c.origin,
  expected:c.expected,contractBoundary:c.contractBoundary??null,userGoalStatus:c.userGoalStatus??null,
  context:{...structuredClone(manifest.conditions.context??baseContext),...structuredClone(c.context??{})}};
 for(const [field,expected]of Object.entries(ownership))equal(record[field],expected,`${label} ownership.${field}`);
 check(record.recordSha256===undefined,`${label}: raw record must not contain a derived/self-referential recordSha256`);
 verifyRunIdentity(record.run,model,c.text,manifest,label);
 equal(record.run.context,record.context,label+' run.context');
 const rawScore=engine.scoreCase(c.expected,record.run);
 const execution=engine.scoreExecutionSemantics(c.expected,record.run,record.run.context??record.context);
 equal(record.rawScore,rawScore,`${label} independently recomputed rawScore`);
 equal(record.execution,execution,`${label} independently recomputed execution`);
 const row=engine.compactRecord({...record,rawScore,execution,recordSha256:digest});
 if(registeredRow){
  check(registeredRow.recordSha256===digest,`${label}: raw SHA-256 differs from index.recordSha256`);
  equal(registeredRow,row,`${label} compactRecord/index (including primary)`);
 }
 return {record,row,digest};
}

export function stablePublicManifest(manifest){
 check(manifest.status==='completed','public-manifest.json is only available for completed runs');
 const value=structuredClone(manifest);delete value.runner;delete value.active;delete value.updatedAt;
 return value;
}
export function verifyPublicationWindow({savedCount,indexedCount,reportedDone,manifestDone,complete=false,plannedTotal=formalTotal}){
 for(const value of [savedCount,indexedCount,reportedDone,manifestDone])check(Number.isInteger(value)&&value>=0&&value<=plannedTotal,'Invalid formal publication count');
 check(indexedCount<=savedCount,'Indexed raw file is missing; do not silently rerun/ignore it');
 check(savedCount-indexedCount<=9,'Partial index publication gap exceeds 9');
 check(reportedDone>=indexedCount&&reportedDone<=savedCount,'Report publication is not a coherent saved/index prefix; running publish may have changed, retry --partial after publication');
 check(manifestDone>=indexedCount&&manifestDone<=savedCount,'Manifest progress disagrees with saved/indexed evidence; retry --partial if publication is in flight');
 if(complete)check([savedCount,indexedCount,reportedDone,manifestDone].every(value=>value===plannedTotal),`Completed audit requires all ${plannedTotal} unique formal records and published counts`);
 return {unindexed:savedCount-indexedCount,unpublishedInReport:savedCount-reportedDone};
}
export function verifyKeyOrder({indexedKeys,savedKeys,expectedKeys}){
 check(new Set(expectedKeys).size===expectedKeys.length,'Duplicate planned formal key');
 check(new Set(indexedKeys).size===indexedKeys.length&&new Set(savedKeys).size===savedKeys.length,'Duplicate saved/index key');
 check(indexedKeys.length<=savedKeys.length&&savedKeys.length<=expectedKeys.length,'Saved/index count exceeds planned order');
 for(let i=0;i<indexedKeys.length;i++)check(indexedKeys[i]===expectedKeys[i],'Index row order is not the frozen modelOrder/caseOrder prefix; unexpected resume/reordering needs separate review');
 const saved=new Set(savedKeys);
 for(const key of expectedKeys.slice(0,savedKeys.length))check(saved.has(key),`Saved raw keys are not the frozen order prefix: missing ${key}`);
 return true;
}
function sorted(value){
 if(Array.isArray(value))return value.map(sorted);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])]));
 return value;
}
async function writeDerived(root,path,value){
 const target=workspacePath(root,path),parent=dirname(target);workspacePath(await realpath(root),await realpath(parent));
 try{check((await lstat(target)).isFile(),`Derived target must be a regular file: ${path}`);}catch(error){if(error.code!=='ENOENT')throw error;}
 const pending=workspacePath(root,`${target}.tmp-${randomUUID()}`);
 await writeFile(pending,JSON.stringify(sorted(jsonValue(value)),null,2)+'\n',{flag:'wx'});
 await rename(pending,target);
}
export function verifyManifest(manifest,partial){
 check(manifest.suite===suite,'Wrong suite');check(typeof manifest.id==='string'&&manifest.id.length>0,'Missing manifest id');
 const plan=singleService100Plan(manifest);
 equal(manifest.conditions?.modelDetails?.map(m=>m.name),plan.models,'Manifest installed model identities/order');
 check(manifest.conditions.modelDetails.every(m=>typeof m.digest==='string'&&m.digest.length>0),'Missing frozen model digests');
 check(manifest.conditions.context&&typeof manifest.conditions.context==='object','Missing frozen context');
 equal(manifest.conditions.callsPerModel,plan.callsPerModel,'callsPerModel');equal(manifest.conditions.totalCalls,plan.totalCalls,'totalCalls');equal(manifest.conditions.repeats,1,'repeats');
 for(const [field,value]of Object.entries({total:1000,perDomain:100,original:100,new:900}))equal(manifest.corpus?.[field],value,'Corpus '+field);
 check(partial||manifest.status==='completed','Default audit requires completed manifest; use --partial for saved progress');
 if(manifest.status==='completed')check(typeof manifest.completedAt==='string','Completed manifest requires completedAt');
 return plan;
}
async function inventory(root,{models,evidenceDirectory}){
 const byModel=new Map(models.map(model=>[model,[]])),warmups=[],ignored=[],auxiliary=[];
 const allowed=new Set(models.map(modelKey));
 for(const entry of await safeEntries(root,evidenceDirectory)){
  if(entry.isFile()&&temporary(entry.name)){ignored.push(`${evidenceDirectory}/${entry.name}`);continue;}
  if(entry.isDirectory()){
   check(allowed.has(entry.name)||entry.name==='warmups',`Unexpected evidence directory (outside manifest): ${entry.name}`);
   const parent=`${evidenceDirectory}/${entry.name}`;
   for(const file of await safeEntries(root,parent)){
    if(file.isFile()&&temporary(file.name)){ignored.push(`${parent}/${file.name}`);continue;}
    check(file.isFile()&&file.name.endsWith('.json'),`Unexpected evidence entry: ${parent}/${file.name}`);
    if(entry.name==='warmups')warmups.push(`${parent}/${file.name}`);
    else byModel.get(models.find(model=>modelKey(model)===entry.name)).push({caseId:file.name.slice(0,-5),path:`${parent}/${file.name}`});
   }
  }else{
   check(entry.isFile()&&['index.json','audit.json','public-manifest.json','host-observations.json'].includes(entry.name),`Unexpected root evidence entry: ${entry.name}`);
   if(entry.name==='host-observations.json')auxiliary.push(`${evidenceDirectory}/${entry.name}`);
  }
 }
 return {byModel,warmups,ignored,auxiliary};
}
async function verifyWarmups(root,manifest,files,complete,{models,evidenceDirectory}){
 check(Array.isArray(manifest.warmups),'Missing warmup list');
 const registered=new Map(),modelCounts=Object.fromEntries(models.map(model=>[model,0])),results=[];
 for(const item of manifest.warmups){
  check(models.includes(item.model),'Warmup uses an unapproved model (outside manifest)');
  check(item.excludedFromScores===true,'Warmup must be explicitly excluded from formal scores');
  const path=workspacePath(root,item.path),rel=relative(resolve(root),path).replaceAll('\\','/');
  check(rel.startsWith(`${evidenceDirectory}/warmups/`)&&rel.endsWith('.json')&&!temporary(rel),'Warmup path must be a saved warmup JSON inside this workspace');
  check(!registered.has(rel),`Duplicate warmup registration: ${rel}`);registered.set(rel,item);
 }
 for(const file of files){
  const bytes=await safeRead(root,file),run=JSON.parse(bytes),item=registered.get(file);
  check(models.includes(run.model),'Warmup raw/trace uses an unapproved model (outside manifest)');
  verifyRunIdentity(run,run.model,'手机还剩多少电',manifest,file);modelCounts[run.model]++;
  const warmupName=file.split('/').at(-1);
  check(warmupName===modelKey(run.model)+'.json'||warmupName.startsWith(`${modelKey(run.model)}-`),'Warmup filename/model mismatch');
  if(item){equal(item.model,run.model,`${file} warmup model`);equal(item.status,run.status,`${file} warmup status`);equal(item.totalMs,run.totalMs,`${file} warmup duration`);registered.delete(file);}
  else check(!complete,'Completed run has an unregistered warmup file');
  results.push({path:file,model:run.model,registered:Boolean(item),sha256:sha256(bytes)});
 }
 check(registered.size===0,'Registered warmup raw file is missing');
 if(complete){
  check(results.length===models.length&&manifest.warmups.length===models.length,'Completed audit requires one excluded warmup per manifest model');
  check(models.every(model=>modelCounts[model]===1),'Completed run must contain exactly one excluded warmup per model');
 }else{
  check(results.length<=models.length&&manifest.warmups.length<=models.length,'Partial audit allows at most one excluded warmup per manifest model');
  check(results.filter(item=>!item.registered).length<=1,'More than one unpublished warmup file');
 }
 check(models.every(model=>modelCounts[model]<=1),'Repeated warmups for the same model are forbidden');
 return {saved:results.length,registered:manifest.warmups.length,perModel:modelCounts,excludedFromFormal:true,files:results};
}

export async function auditSingleService100({root=defaultRoot,manifestPath=null,partial=false,writeAudit=false}={}){
 root=resolve(root);
 if(!manifestPath){
  try{const pointer=JSON.parse(await safeRead(root,'data/runtime/single-service-100-active.json'));manifestPath=pointer.manifestPath;}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 const manifestRel=manifestPath?relative(root,workspacePath(root,manifestPath)).replaceAll('\\','/'):paths.manifest;
 const selected=JSON.parse(await safeRead(root,manifestRel));
 const storage=selected.storage??{manifestPath:paths.manifest,indexPath:paths.index,reportPath:paths.report,evidenceRoot:evidenceDirectory};
 if(selected.storage)equal(storage,benchmarkStorage(selected.id),'Manifest unique storage identity');
 equal(manifestRel,storage.manifestPath,'Selected manifest path');
 const selectedPaths={manifest:manifestRel,index:storage.indexPath,report:storage.reportPath};
 const directory=storage.evidenceRoot;
 const initial=Object.fromEntries(await Promise.all(Object.entries(selectedPaths).map(async([key,path])=>[key,await safeRead(root,path)])));
 const manifest=JSON.parse(initial.manifest),index=JSON.parse(initial.index),report=JSON.parse(initial.report);
 const plan=verifyManifest(manifest,partial),{models,domains,callsPerModel:perModel,perDomain,totalCalls:formalTotal}=plan;
 const historical=manifest.version!=='single-service-100-batch-v2';
 const complete=manifest.status==='completed';
 if(!partial||complete){check(index.status==='completed'&&report.status==='completed','Full audit requires completed index/report');equal(manifest.progress,{done:formalTotal,total:formalTotal},'Completed manifest progress');}
 check(index.manifestId===manifest.id,'Index belongs to another manifest');check(Array.isArray(index.rows),'Missing index rows');
 const sourceFiles=await verifySources(root,manifest,{historical});
 let engine={scoreCase,scoreExecutionSemantics,compactRecord,buildSingleService100Report,loadSingleService100Cases,orderedCases};
 if(historical){
  const snapshot=workspacePath(root,manifest.sourceSnapshot);
  const load=path=>import(pathToFileURL(join(snapshot,path)).href);
  const [raw,semantic,runner,reporter,corpus]=await Promise.all([load('src/evaluation.mjs'),load('src/semantic-evaluation.mjs'),load('scripts/benchmark-single-service-100.mjs'),load('src/single-service-100-report.mjs'),load('src/single-service-100.mjs')]);
  engine={...engine,scoreCase:raw.scoreCase,scoreExecutionSemantics:semantic.scoreExecutionSemantics,compactRecord:runner.compactRecord,orderedCases:runner.orderedCases,buildSingleService100Report:reporter.buildSingleService100Report,loadSingleService100Cases:corpus.loadSingleService100Cases};
 }
 const cases=await engine.loadSingleService100Cases(historical?workspacePath(root,manifest.sourceSnapshot):root),caseMap=new Map(cases.map(c=>[c.id,c]));
 equal(manifest.corpus.sha256,sha256(JSON.stringify(cases)),'Frozen corpus SHA-256');
 equal(manifest.corpus.caseOrder,engine.orderedCases(cases).map(c=>c.id),'Frozen shared case order');
 equal(manifest.corpus.contractBoundaries,cases.filter(c=>c.contractBoundary).map(c=>({id:c.id,text:c.text,expectedStatus:c.expected.status,userGoalStatus:c.userGoalStatus,boundary:c.contractBoundary})),'Corpus known contract boundaries');
 const expectedKeys=new Set(models.flatMap(model=>cases.map(c=>`${model}/${c.id}`))),indexed=new Map();
 for(const row of index.rows){
  const key=keyOf(row);check(expectedKeys.has(key),`Unknown indexed key/model (outside manifest): ${key}`);
  check(!indexed.has(key),`Duplicate index key: ${key}`);check(/^[a-f0-9]{64}$/.test(row.recordSha256??''),`Missing valid indexed raw SHA-256: ${key}`);indexed.set(key,row);
 }
 const files=await inventory(root,{models,evidenceDirectory:directory}),saved=new Map();
 for(const model of models)for(const file of files.byModel.get(model)){
  const key=`${model}/${file.caseId}`,c=caseMap.get(file.caseId);
  check(c&&expectedKeys.has(key),`Unknown formal case file: ${file.path}`);check(!saved.has(key),`Duplicate saved key: ${key}`);
  saved.set(key,verifyStoredRecord({bytes:await safeRead(root,file.path),model,caseDefinition:c,manifest,registeredRow:indexed.get(key),engine}));
 }
 for(const key of indexed.keys())check(saved.has(key),`Indexed raw file is missing; do not silently rerun/ignore it: ${key}`);
 const plannedKeys=models.flatMap(model=>manifest.corpus.caseOrder.map(caseId=>`${model}/${caseId}`));
 verifyKeyOrder({indexedKeys:index.rows.map(keyOf),savedKeys:[...saved.keys()],expectedKeys:plannedKeys});
 const unindexed=[...saved.keys()].filter(key=>!indexed.has(key));
 if(!partial||complete){
  check(saved.size===formalTotal&&indexed.size===formalTotal,'Completed audit requires all planned saved/indexed unique formal keys');check(unindexed.length===0,'Completed audit forbids unindexed formal records');
 }else check(unindexed.length<=9,`Partial index publication gap exceeds 9: ${unindexed.length}`);
 const order=manifest.corpus.caseOrder,rank=new Map(models.flatMap((model,m)=>order.map((id,i)=>[`${model}/${id}`,m*perModel+i])));
 unindexed.sort((a,b)=>rank.get(a)-rank.get(b));
 const rows=[...index.rows.map(r=>saved.get(keyOf(r)).row),...unindexed.map(key=>saved.get(key).row)];
 const progress=report.progress;
 check(progress?.total===formalTotal&&Number.isInteger(progress.done),'Invalid report progress');
 check(manifest.progress?.total===formalTotal&&Number.isInteger(manifest.progress.done),'Invalid manifest progress');
 verifyPublicationWindow({savedCount:saved.size,indexedCount:indexed.size,reportedDone:progress.done,manifestDone:manifest.progress.done,complete:!partial||complete,plannedTotal:formalTotal});
 const reportedRows=rows.slice(0,progress.done);
 const rebuilt=engine.buildSingleService100Report({...manifest,status:report.status,active:report.active,completedAt:report.completedAt,error:report.error},reportedRows);
 for(const field of ['summary','cells','examples','progress','examplePolicy','notes'])equal(report[field],rebuilt[field],`Independently rebuilt report.${field}`);
 for(const field of ['id','suite','createdAt','conditions','corpus','sourceSnapshot'])equal(report[field],manifest[field],`Report/manifest ${field}`);
 equal(report.warmupCount,manifest.warmups.length,'Reported excluded warmup count');
 if(complete){equal(report.completedAt,manifest.completedAt,'Completed report time');equal(report.error,manifest.error??null,'Completed report error');equal(report.active,null,'Completed active case');}
 const warmups=await verifyWarmups(root,manifest,files.warmups,complete,{models,evidenceDirectory:directory});
 const counts=models.map(model=>({model,total:rows.filter(row=>row.model===model).length,
  domains:domains.map(testDomain=>({testDomain,total:rows.filter(row=>row.model===model&&row.testDomain===testDomain).length}))}));
 if(!partial||complete){
  for(const count of counts){check(count.total===perModel,`Wrong model denominator: ${count.model}`);for(const cell of count.domains)check(cell.total===perDomain,`Wrong model/domain denominator: ${count.model}/${cell.testDomain}`);}
  check(expectedKeys.size===formalTotal&&rows.length===formalTotal,'Formal expected key space is not manifest models × 10 × 100');
 }
 // Refuse a mixed live snapshot instead of silently attributing changing files to failures.
 for(const [key,path]of Object.entries(selectedPaths))check(sha256(await safeRead(root,path))===sha256(initial[key]),`Live ${key} changed during audit; retry --partial after publication`);
 equal(await verifySources(root,manifest,{historical}),sourceFiles,'Current/snapshot source hashes at audit end');
 const verifierHash=sha256(await readFile(fileURLToPath(import.meta.url)));
 const audit={version:'single-service-100-audit-v1',manifestId:manifest.id,status:complete?'verified_completed':'verified_partial',auditedAt:new Date().toISOString(),modelCalls:0,verifierSha256:verifierHash,
  formal:{planned:formalTotal,saved:saved.size,indexed:indexed.size,reported:progress.done,manifestPublished:manifest.progress.done,unindexed:unindexed.length,unpublishedInReport:saved.size-progress.done,uniqueKeys:saved.size,counts},
  warmups,checks:{sourceFiles:sourceFiles.length,sourceAndSnapshotHashesVerified:true,corpusSha256:manifest.corpus.sha256,sharedOrderVerified:true,ownershipVerified:saved.size,rawHashesMatchedIndex:indexed.size,rawScoresRecomputed:saved.size,executionScoresRecomputed:saved.size,compactRowsMatchedIndex:indexed.size,reportSummaryAndCellsRecomputed:true,modelsMatchManifest:true,sevenBAbsent:!models.includes('qwen2.5:7b'),historicalFrozenEngine:historical},
  primaryCounts:Object.fromEntries([...Map.groupBy(rows,row=>row.primary)].map(([primary,list])=>[primary,list.length])),
  ignoredTemporaryFiles:files.ignored,auxiliaryMetadata:{paths:files.auxiliary,excludedFromFormal:true,shaPinned:false},unindexedKeys:unindexed,derivedWrites:[],notes:[
   '独立读取已保存原始JSON并重算评分；未调用模型、重跑grounding或改写任何原始记录。',
   '错误/schema/timeout均保留在正式调用分母；预热与.tmp/.pending临时文件不计入正式调用。',
   '延迟分位数复核报告既有的全部调用（含失败尝试）口径，不改成仅成功调用的耗时。',
   'partial仅认证此次读取到的已保存证据；明确分列saved/indexed/reported，最多9条尚未index；不认证尚未完成的3000条。',
   'host-observations.json仅为辅助观测，不计正式分母，未纳入sourceHashes，不宣称SHA已固定。',
   '本轮要求index和saved key均是冻结modelOrder/caseOrder的共同顺序前缀；恢复重排需另外明确审查，不无声截断。',
   'SHA证明与现有冻结清单/快照的内部一致性，不代替外部签名或独立盲测。']};
 if(writeAudit){
  if(complete){const path=`${directory}/public-manifest.json`;await writeDerived(root,path,stablePublicManifest(manifest));audit.derivedWrites.push(path);}
  const path=`${directory}/audit.json`;audit.derivedWrites.push(path);await writeDerived(root,path,audit);
 }
 return audit;
}
async function main(){
 const args=process.argv.slice(2);let partial=false,writeAudit=false,manifestPath=null;
 for(let i=0;i<args.length;i++){
  const arg=args[i];if(arg==='--partial')partial=true;else if(arg==='--write-audit')writeAudit=true;
  else if(arg==='--manifest'){check(args[i+1],'--manifest needs a path');manifestPath=args[++i];}
  else if(arg==='--help'){console.log('node scripts/verify-single-service-100.mjs [--manifest <path>] [--partial] [--write-audit]\nManifest determines model order and total (4000 new / 3000 historical). Historical audits use frozen source scoring; raw runs are never re-grounded.');return;}
  else throw new Error('Unknown argument: '+arg);
 }
 const audit=await auditSingleService100({manifestPath,partial,writeAudit});
 console.log(JSON.stringify({status:audit.status,manifestId:audit.manifestId,formal:audit.formal,warmupCount:audit.warmups.saved,checks:audit.checks,auxiliaryMetadata:audit.auxiliaryMetadata,derivedWrites:audit.derivedWrites,modelCalls:0},null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await main();}catch(error){console.error(JSON.stringify({status:'audit_failed',modelCalls:0,error:error.message}));process.exitCode=1;}
}
