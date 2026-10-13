import {readFile,writeFile,mkdir,rename,unlink,realpath,lstat} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

export const LAYA_REUSE_SEED_VERSION='laya-benchmark-reuse-seed-v1';
const check=(valid,message)=>{if(!valid)throw new Error('Laya reuse seed: '+message);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const requestSha256=request=>hash(JSON.stringify(request));
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const measured=value=>Number.isFinite(value)&&value>=0?value:null;
const probability=value=>measured(value)!==null&&value<=1;
const isInside=(root,target)=>{const rel=relative(root,target);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../')&&!rel.startsWith('..\\');};
async function sourceFile(root,path){
 const target=resolve(root,path);check(isInside(root,target),'source path escapes root');
 check(isInside(await realpath(root),await realpath(target))&&(await lstat(target)).isFile(),'source must be a regular project file');
 return {path:target,relative:relative(root,target).replaceAll('\\','/'),bytes:await readFile(target)};
}

function frozenProfile(manifest){
 const frozen=manifest.conditions?.layaShadow,status=frozen?.observedStatus,deployment=status?.deployment??{};
 check(frozen?.enabled===true&&object(status),'manifest has no frozen Laya shadow profile');
 const profile={model:status.model,modelRevision:status.modelRevision,layaVersion:status.version??deployment.version,
  threads:status.threads??deployment.threads,device:status.device,tournamentGroup:status.tournamentGroup??deployment.tournamentGroup,
  maxChoices:status.maxChoices??deployment.maxChoices,maxLen:status.maxLen??deployment.maxLen,headMaxLen:status.headMaxLen??deployment.headMaxLen};
 check(profile.model==='multilingual'&&profile.device==='cpu'&&profile.threads===8&&profile.tournamentGroup===16,'requires the recorded multilingual CPU/8-thread/group16 experiment profile');
 check(typeof profile.modelRevision==='string'&&profile.modelRevision.length>0&&typeof profile.layaVersion==='string'&&profile.layaVersion.length>0,'missing frozen model revision/version');
 return profile;
}

/** Independently validate native choice evidence. Never use gold or chosen business IDs. */
function reusable(trace,profile){
 if(trace?.provider!=='laya'||trace.error)return 'trace_error';
 if(!Number.isInteger(trace.httpStatus)||trace.httpStatus<200||trace.httpStatus>=300)return 'http_status';
 if(measured(trace.wallMs)===null)return 'unknown_wall_time';
 const request=trace.request;
 if(!object(request)||!object(request.state)||!object(request.questions)||request.model!==profile.model)return 'request_contract';
 const questions=Object.keys(request.questions);
 if(questions.length!==1||!['domain','api'].includes(questions[0]))return 'question_contract';
 const key=questions[0],question=request.questions[key],criteria=question?.criteria;
 if(question?.type!=='choice'||typeof question.instructions!=='string'||!object(criteria))return 'question_contract';
 const keys=Object.keys(criteria);
 if(keys.length<1||keys.length>255||keys.some(k=>typeof criteria[k]!=='string'&&!object(criteria[k])))return 'question_contract';
 if(!Number.isInteger(request.max_len)||!Number.isInteger(request.head_max_len)||request.head_max_len<16||request.max_len>8192||request.head_max_len>=request.max_len)return 'request_budget';
 let payload;try{payload=JSON.parse(trace.raw);}catch{return 'response_json';}
 if(object(payload)&&Object.hasOwn(payload,'x_benchmark_reuse'))return 'reuse_managed_response';
 const answer=payload?.answers?.[key];
 if(!object(payload)||typeof payload.model!=='string'||!payload.model||!object(payload.answers)||Object.keys(payload.answers).length!==1||answer?.type!=='choice'||!keys.includes(answer.choice))return 'response_contract';
 const probabilities=answer.probabilities;
 if(!object(probabilities)||Object.keys(probabilities).length!==keys.length||keys.some(k=>!Object.hasOwn(probabilities,k)||!probability(probabilities[k])))return 'response_probabilities';
 const sum=Object.values(probabilities).reduce((s,value)=>s+value,0);
 if(Math.abs(sum-1)>Math.max(.001,keys.length*.00005+1e-8)||!probability(answer.confidence)||probabilities[answer.choice]+1e-9<Math.max(...Object.values(probabilities)))return 'response_probabilities';
 const usage=payload.usage??{};
 const collapsed=object(usage.options)&&Object.values(usage.options).some(option=>object(option)&&typeof option.distinct==='number'&&typeof option.total==='number'&&option.distinct<option.total);
 if(trace.truncated===true||usage.truncated===true||(measured(usage.state_tokens_dropped)??0)>0||(Array.isArray(usage.truncated_questions)&&usage.truncated_questions.length>0)||collapsed)return 'truncated_or_collapsed';
 return null;
}

export async function prepareLayaReuseSeed({root,manifestPath,includeWarmups=false}){
 check(typeof root==='string'&&isAbsolute(root),'--root must be absolute');root=resolve(root);
 const manifestSource=await sourceFile(root,manifestPath),manifest=JSON.parse(manifestSource.bytes),profile=frozenProfile(manifest);
 check(typeof manifest.id==='string'&&Array.isArray(manifest.conditions.models)&&Array.isArray(manifest.corpus?.caseOrder),'manifest identity/order missing');
 const indexSource=await sourceFile(root,manifest.storage?.indexPath),index=JSON.parse(indexSource.bytes);
 check(index.manifestId===manifest.id&&Array.isArray(index.rows),'index manifest ownership differs');
 const ordered=manifest.conditions.models.flatMap(model=>manifest.corpus.caseOrder.map(caseId=>model+'/'+caseId));
 check(index.rows.length<=ordered.length&&index.rows.every((row,i)=>row.model+'/'+row.caseId===ordered[i]),'registered formal records are not the frozen unique prefix');
 const summary={registeredFormalRecords:index.rows.length,formalRecords:0,warmupRecords:0,totalDecisions:0,validDecisions:0,skippedDecisions:0,duplicates:0,conflicts:0,entries:0,skippedReasons:{},models:{},inputAsOf:index.updatedAt??manifest.updatedAt??null};
 const entries=[],seen=new Map();
 const consume=(record,file,model,caseId,kind)=>{
  const decisions=record.shadow?.decisions??[];
  check(Array.isArray(decisions),'shadow decisions missing');
  summary[kind==='formal'?'formalRecords':'warmupRecords']++;
  const modelSummary=summary.models[model]??={records:0,decisions:0,valid:0,entries:0,duplicates:0,conflicts:0};modelSummary.records++;
  decisions.forEach((decision,traceIndex)=>{
   const trace=decision.laya?.trace;summary.totalDecisions++;modelSummary.decisions++;
   const reason=reusable(trace,profile);
   if(reason){summary.skippedDecisions++;summary.skippedReasons[reason]=(summary.skippedReasons[reason]??0)+1;return;}
   summary.validDecisions++;modelSummary.valid++;
   const requestHash=requestSha256(trace.request),responseHash=hash(trace.raw),first=seen.get(requestHash);
   if(first){summary.duplicates++;modelSummary.duplicates++;if(first.responseSha256!==responseHash){summary.conflicts++;modelSummary.conflicts++;}return;}
   const inference=measured(trace.inferenceMs);
   const origin={kind,manifestId:manifest.id,model,caseId:caseId??null,stage:decision.stage,primaryStage:decision.primaryStage??null,
    recordPath:file.relative,recordSha256:hash(file.bytes),traceIndex,decisionIndex:traceIndex,startedAt:trace.startedAt??null,completedAt:trace.completedAt??null,
    observedAt:record.createdAt??trace.completedAt??trace.startedAt??null};
   const entry={request:trace.request,responseRaw:trace.raw,requestSha256:requestHash,responseSha256:responseHash,
    originalWallMs:trace.wallMs,originalInferenceMs:inference,originalServiceWallMs:null,firstDurationMs:inference,originalObservedAt:origin.observedAt,origin};
   seen.set(requestHash,entry);entries.push(entry);modelSummary.entries++;
  });
 };
 for(const row of index.rows){
  const path=`${manifest.storage.evidenceRoot}/${row.model.replace(':','-')}/${row.caseId}.json`,file=await sourceFile(root,path);
  check(typeof row.recordSha256==='string'&&hash(file.bytes)===row.recordSha256,'formal record SHA-256 differs from registered index: '+file.relative);
  const record=JSON.parse(file.bytes);
  check(record.manifestId===manifest.id&&record.model===row.model&&record.run?.model===row.model&&record.caseId===row.caseId,'formal raw ownership differs: '+file.relative);
  check(record.shadow?.policy===manifest.conditions.layaShadow.policy,'formal shadow policy differs');
  consume(record,file,row.model,row.caseId,'formal');
 }
 if(includeWarmups)for(const item of manifest.warmups??[]){
  const file=await sourceFile(root,item.path);check(typeof item.recordSha256==='string'&&hash(file.bytes)===item.recordSha256,'warmup SHA-256 differs from manifest');
  const record=JSON.parse(file.bytes);check(record.model===item.model&&record.shadow?.policy===manifest.conditions.layaShadow.policy,'warmup ownership/policy differs');
  consume(record,file,item.model,null,'warmup');
 }
 summary.entries=entries.length;
 return {version:LAYA_REUSE_SEED_VERSION,namespace:manifest.id,profile,createdAt:new Date().toISOString(),
  source:{root,manifestPath:manifestSource.relative,manifestSha256:hash(manifestSource.bytes),indexPath:indexSource.relative,indexSha256:hash(indexSource.bytes),evidenceRoot:manifest.storage.evidenceRoot},
  includeWarmups,summary,entries,
  notes:['Keys are SHA-256 of UTF-8 compact JSON.stringify(request), preserving insertion order including criteria. Gold and Qwen predictions do not participate.',
   'Only SHA-registered formal prefix is included. Unregistered tail records are not claimed verified. First valid native response wins; conflicting later responses are counted without replacing it.',
   'Original wall and inference measurements are preserved separately; these are historical durations, not cache-hit inference latency. Responses managed by the reuse layer are excluded.']};
}

export async function writeLayaReuseSeed(seed,out){
 check(typeof out==='string'&&isAbsolute(out),'--out must be absolute');out=resolve(out);
 check(seed.version===LAYA_REUSE_SEED_VERSION,'unsupported seed version');
 const sourceRoot=resolve(seed.source.root);
 const protectedPaths=[join(sourceRoot,seed.source.evidenceRoot),join(sourceRoot,'data/benchmark-single-service-100')];
 check(!protectedPaths.some(path=>isInside(path,out))&&out!==resolve(sourceRoot,seed.source.manifestPath)&&out!==resolve(sourceRoot,seed.source.indexPath),'read-only source evidence must not be overwritten');
 if(isInside(sourceRoot,out))check(isInside(join(sourceRoot,'data/runtime'),out),'output inside source root must be a runtime cache file');
 await mkdir(dirname(out),{recursive:true});
 // Refuse an explicit destination resolving through a junction into protected evidence.
 const physical=join(await realpath(dirname(out)),out.slice(dirname(out).length+1));
 check(!protectedPaths.some(path=>isInside(path,physical)),'output resolves into read-only source evidence');
 const temporary=out+'.tmp-'+randomUUID();
 try{await writeFile(temporary,JSON.stringify(seed,null,2)+'\n',{flag:'wx'});await rename(temporary,out);}
 finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 return {out,namespace:seed.namespace,...seed.summary};
}

export async function main(args=process.argv.slice(2)){
 const options={};
 for(let i=0;i<args.length;i++){
  const flag=args[i];if(flag==='--include-warmups'){options.includeWarmups=true;continue;}
  check(['--root','--manifest','--out'].includes(flag)&&typeof args[i+1]==='string'&&!args[i+1].startsWith('--'),'expected --root --manifest --out [--include-warmups]');
  const key=flag==='--manifest'?'manifestPath':flag.slice(2);check(options[key]===undefined,'duplicate CLI option');options[key]=args[++i];
 }
 check(options.root&&options.manifestPath&&options.out,'explicit --root --manifest --out are required');
 const seed=await prepareLayaReuseSeed(options),result=await writeLayaReuseSeed(seed,options.out);console.log(JSON.stringify(result));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
