import {createHash} from 'node:crypto';
import {readFile,readdir,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {createLayaProvider} from './laya-provider.mjs';

export const INDEPENDENT_REPLAY_VERSION='laya-independent-replay-v1';
const sha=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0?x:null;
const profileKeys=['model','modelRevision','layaVersion','threads','device','tournamentGroup','maxChoices','maxLen','headMaxLen'];
const normalizedProfile=p=>Object.fromEntries(profileKeys.map(k=>[k,p?.[k]]));
const check=(condition,message)=>{if(!condition)throw new Error('Laya independent replay: '+message);};
function validNativeResponse(request,raw){
 let payload;try{payload=JSON.parse(raw);}catch{return false;}
 const qs=Object.keys(request.questions??{}),key=qs[0],criteria=request.questions?.[key]?.criteria,keys=Object.keys(criteria??{}),a=payload.answers?.[key],p=a?.probabilities;
 if(qs.length!==1||!['domain','api'].includes(key)||request.questions[key].type!=='choice'||!keys.length||typeof payload.model!=='string'||!payload.model||payload.x_benchmark_reuse||payload.error||a?.type!=='choice'||!keys.includes(a.choice)||!p||Object.keys(p).length!==keys.length)return false;
 if(!keys.every(k=>Object.hasOwn(p,k)&&finite(p[k])!==null&&p[k]<=1)||finite(a.confidence)===null||a.confidence>1)return false;
 if(Math.abs(Object.values(p).reduce((sum,n)=>sum+n,0)-1)>Math.max(.001,keys.length*.00005+1e-8)||p[a.choice]+1e-9<Math.max(...Object.values(p)))return false;
 const u=payload.usage??{};
 return !(u.truncated===true||(finite(u.state_tokens_dropped)??0)>0||(Array.isArray(u.truncated_questions)&&u.truncated_questions.length)||u.options&&Object.values(u.options).some(o=>o&&typeof o.distinct==='number'&&typeof o.total==='number'&&o.distinct<o.total));
}

async function safeSource(root,path){
 check(typeof path==='string'&&!isAbsolute(path)&&!path.split(/[\\/]/).includes('..')&&/^(?:evidence\/single-service-100\/|data\/runtime\/laya-reuse\/).+\.json$/.test(path),'source path invalid');
 const actual=await realpath(resolve(root,path)),rel=relative(root,actual);
 check(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep),'source path escapes project');
 return actual;
}

/** Pure offline proof check; no HTTP calls and no model invocations. */
export function verifyLayaIndependentReplayTrace(trace,inventory){
 const meta=trace?.independentReuse;
 check(meta?.version===INDEPENDENT_REPLAY_VERSION&&meta.verified===true&&typeof meta.hit==='boolean','unverified provenance');
 check(trace.request&&sha(trace.request)===meta.requestSha256&&typeof trace.raw==='string'&&sha(trace.raw)===meta.responseSha256,'trace request/response SHA mismatch');
 check(isDeepStrictEqual(meta.profile,inventory.profile)&&validNativeResponse(trace.request,trace.raw),'trace deployment/native protocol invalid');
 if(meta.hit){
  const e=inventory.entries.find(e=>e.requestSha256===meta.requestSha256);
  check(e&&Object.entries(e).every(([key,value])=>isDeepStrictEqual(meta[key],value)),'cached provenance differs from verified source');
  check(trace.httpCalls===0&&trace.inferenceMs===0&&finite(meta.lookupMs)!==null,'cache trace claims current HTTP/model inference');
 }else{
  check(meta.currentInferenceExecuted===true&&trace.httpCalls===1&&meta.sourceType==='current_inference'&&meta.sourceInferenceMs===finite(trace.inferenceMs)&&meta.sourceHttpMs===finite(trace.wallMs),'fresh provenance/time invalid');
 }
 return true;
}

/** Read-only exact-input reuse: Qwen outputs and gold never participate in lookup. */
export async function createLayaIndependentReplayProvider({root,cacheDirectory,profile,url='http://127.0.0.1:8765/v1/systemone',model='multilingual',fetch:fetchImpl}={}){
 const projectRoot=await realpath(root),entries=new Map(),sources=new Map();
 check(profileKeys.every(k=>profile?.[k]!==undefined)&&profile.model===model,'complete deployment profile required');
 const observedProfile=normalizedProfile(profile),inventory={version:INDEPENDENT_REPLAY_VERSION,verifiedEntries:0,verifiedSourceFiles:0,profile:observedProfile,entries:[]};
 for(const name of (cacheDirectory?await readdir(cacheDirectory):[]).filter(n=>n.endsWith('.entry.json')).sort()){
  const path=await realpath(resolve(cacheDirectory,name)),entryBytes=await readFile(path),entry=JSON.parse(entryBytes);
  check(entry.version==='laya-benchmark-reuse-v1'&&typeof entry.namespace==='string','entry version/namespace invalid');
  check(isDeepStrictEqual(normalizedProfile(entry.profile),observedProfile),'entry deployment profile mismatch');
  check(entry.request&&sha(entry.request)===entry.requestSha256&&name===entry.requestSha256+'.entry.json','request SHA invalid');
  check(typeof entry.responseRaw==='string'&&sha(entry.responseRaw)===entry.responseSha256,'response SHA invalid');
  const origin=entry.origin??{},sourcePath=origin.type==='service_inference'?origin.serviceRecordPath:origin.recordPath;
  const expectedSourceSha=origin.type==='service_inference'?origin.serviceRecordSha256:origin.recordSha256;
  const actualPath=await safeSource(projectRoot,sourcePath);
  let source=sources.get(actualPath);
  if(!source){const bytes=await readFile(actualPath);source={value:JSON.parse(bytes),sha256:sha(bytes)};sources.set(actualPath,source);}
  check(source.sha256===expectedSourceSha,'source byte SHA mismatch');
  let native,sourceInferenceMs,sourceHttpMs=null,sourceServiceMs=null,sourceObservedAt;
  if(origin.type==='service_inference'){
   native=source.value;
   check(native.version===entry.version&&native.namespace===entry.namespace&&isDeepStrictEqual(normalizedProfile(native.profile),observedProfile),'service source deployment profile invalid');
   sourceInferenceMs=finite(native.inferenceMs);sourceServiceMs=finite(native.serviceWallMs);sourceObservedAt=native.observedAt;
  }else{
   check(source.value.manifestId===entry.namespace&&(!origin.manifestId||source.value.manifestId===origin.manifestId)&&Number.isInteger(origin.traceIndex)&&origin.traceIndex>=0,'formal source ownership invalid');
   const d=(source.value.shadow?.decisions??source.value.run?.shadow?.decisions??[])[origin.traceIndex];
   check(d&&(!origin.stage||d.stage===origin.stage),'formal source stage invalid');native=d.laya?.trace;
   check(native?.provider==='laya'&&!native.error&&!native.truncated&&native.httpStatus>=200&&native.httpStatus<300&&native.stage===d.stage,'formal source was not a successful Laya response');
   sourceInferenceMs=finite(native?.inferenceMs);sourceHttpMs=finite(native?.wallMs);sourceObservedAt=native?.startedAt;
  }
  check(native?.request&&sha(native.request)===entry.requestSha256,'source request SHA mismatch');
  check(typeof (native.responseRaw??native.raw)==='string'&&sha(native.responseRaw??native.raw)===entry.responseSha256,'source response SHA mismatch');
  check(validNativeResponse(entry.request,entry.responseRaw),'native choice protocol invalid');
  const entryPath=relative(projectRoot,path).replaceAll('\\','/');
  check(!entryPath.startsWith('../')&&!isAbsolute(entryPath),'cache path escapes project');
  const evidence={version:INDEPENDENT_REPLAY_VERSION,hit:true,verified:true,currentInferenceExecuted:false,requestSha256:entry.requestSha256,responseSha256:entry.responseSha256,entryPath,entrySha256:sha(entryBytes),sourcePath,sourceSha256:source.sha256,sourceType:origin.type??'formal',sourceInferenceMs,sourceHttpMs,sourceServiceMs,sourceObservedAt:sourceObservedAt??null,profile:observedProfile};
  entries.set(entry.requestSha256,{responseRaw:entry.responseRaw,evidence});inventory.entries.push(evidence);
 }
 inventory.verifiedEntries=entries.size;inventory.verifiedSourceFiles=sources.size;
 const transport=fetchImpl??((...args)=>globalThis.fetch(...args)),live=createLayaProvider({url,model,fetch:transport});
 return {defaultModel:model,replayInventory:inventory,getStatus:()=>live.getStatus(),async invoke(request){
  request.signal?.throwIfAborted();let reused=null,lookupMs=null,requestSha256=null,transportAttempted=false;
  const provider=createLayaProvider({url,model,fetch:async(input,init)=>{
   if(init?.method!=='POST')return transport(input,init);
   const start=performance.now();requestSha256=sha(init.body);reused=entries.get(requestSha256)??null;lookupMs=performance.now()-start;
   if(!reused){transportAttempted=true;return transport(input,init);}
   return new Response(reused.responseRaw,{status:200,headers:{'content-type':'application/json','x-inference-time-ms':'0'}});
  }});
  let result;
  try{result=await provider.invoke(request);}catch(error){
   if(error.trace){if(!transportAttempted)error.trace.httpCalls=0;error.trace.independentReuse=reused?{...reused.evidence,lookupMs}:{version:INDEPENDENT_REPLAY_VERSION,hit:false,verified:false,currentInferenceAttempted:transportAttempted,currentInferenceExecuted:finite(error.trace.inferenceMs)!==null&&transportAttempted,requestSha256,profile:observedProfile};}
   throw error;
  }
  if(reused){result.trace.httpCalls=0;result.trace.independentReuse={...reused.evidence,lookupMs};}
  else result.trace.independentReuse={version:INDEPENDENT_REPLAY_VERSION,hit:false,verified:true,currentInferenceExecuted:true,requestSha256:requestSha256??sha(result.trace.request),responseSha256:sha(result.trace.raw),sourceType:'current_inference',sourceInferenceMs:finite(result.trace.inferenceMs),sourceHttpMs:finite(result.trace.wallMs),sourceServiceMs:null,sourceObservedAt:result.trace.startedAt,profile:observedProfile,lookupMs};
  return result;
 }};
}
