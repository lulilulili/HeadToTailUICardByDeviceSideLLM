import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RuntimeStore} from '../src/runtime.mjs';
import {scoreCase,summarize} from '../src/evaluation.mjs';

export const IMPORT_VERSION='feasibility-evidence-import-v1';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const variants=['explicit-v7','sparse-v6-shared-catalog','explicit-v7-guards'];
const requiredModels=['qwen2.5:0.5b','qwen2.5:1.5b','qwen2.5:3b','qwen2.5:7b'];
const expectedCounts=[160,48,16];
const boundary='固定实验上下文直连 provider，再调用 finalizePlan；绕过 prepareSystemContext，未读取 Harmony 真机，业务 API 全部模拟。导入仅保存证据，不重新推理。';
const clone=value=>structuredClone(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const omitNulls=value=>Array.isArray(value)?value.map(omitNulls):object(value)?Object.fromEntries(Object.entries(value).filter(([,child])=>child!==null).map(([key,child])=>[key,omitNulls(child)])):value;

/** Deterministic, UUID-shaped SHA-256 IDs, scoped to this evidence importer. */
export function evidenceId(manifestId,kind,variant,model='',caseId=''){
 const bytes=createHash('sha256').update(JSON.stringify([IMPORT_VERSION,manifestId,kind,variant,model,caseId])).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|128;bytes[8]=(bytes[8]&63)|128;
 const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function parsedOutput(row){
 let parsed;
 try{parsed=JSON.parse(row.trace?.raw);}catch{}
 if(!row.error){
  check(object(parsed)&&object(parsed.arguments),`${row.model}/${row.variant}/${row.caseId}: successful call has no parseable raw arguments`);
  check(isDeepStrictEqual(omitNulls(parsed.arguments),row.raw.extractedArguments),`${row.caseId}: raw/extracted argument evidence differs`);
 }
 return object(parsed)?parsed:null;
}
function validateAudit(audit){
 check(object(audit)&&['completed','partial_hardware_limited'].includes(audit.status),'证据尚未 completed 或明确 partial_hardware_limited；拒绝导入运行中或未审计的部分结果。');
 const partial=audit.status==='partial_hardware_limited';
 const endedAt=audit.completedAt??audit.interruptedAt??audit.stoppedAt;
 check(typeof audit.id==='string'&&audit.id.trim()&&Number.isFinite(Date.parse(audit.createdAt))&&Number.isFinite(Date.parse(endedAt)),'证据 manifest ID / 时间无效');
 if(partial)check(object(audit.hardwareLimit)&&requiredModels.includes(audit.hardwareLimit.model)&&typeof audit.hardwareLimit.reason==='string'&&audit.hardwareLimit.reason.trim(),'部分结果必须明确记录受限模型和硬件限制原因');
 check(audit.conditions?.catalog==='single-service-v3'&&audit.conditions?.groundingVersion==='deterministic-grounding-v2','证据不是 single-service-v3 / deterministic-grounding-v2');
 const details=audit.conditions.modelDetails;
 check(Array.isArray(details)&&requiredModels.every(model=>details.some(item=>item.name===model&&typeof item.digest==='string'&&item.digest)),'四档模型 digest 元数据不完整');
 const sampling=audit.conditions.sampling??{};
 const caseLists=[sampling.currentCaseIds,sampling.pairedCaseIds,sampling.guards?.map(item=>item.id)];
 caseLists.forEach((ids,index)=>check(Array.isArray(ids)&&ids.length===[40,12,4][index]&&new Set(ids).size===ids.length&&ids.every(id=>typeof id==='string'&&id),`variant ${variants[index]} 的抽样 ID 不完整`));
 check(caseLists[1].every(id=>caseLists[0].includes(id))&&caseLists[2].every(id=>!caseLists[0].includes(id)),'baseline/guard 抽样边界不一致');
 check(Array.isArray(audit.rows)&&(partial?audit.rows.length>0&&audit.rows.length<224:audit.rows.length===224),'completed 证据必须包含完整 224 次正式调用；硬件受限部分证据必须为 1–223 次，预热不计入此数量');
 const seen=new Set();
 for(const row of audit.rows){
  const index=variants.indexOf(row.variant),key=JSON.stringify([row.model,row.variant,row.caseId]);
  check(index>=0&&requiredModels.includes(row.model)&&caseLists[index].includes(row.caseId)&&!seen.has(key),`未知或重复正式调用：${key}`);seen.add(key);
  check(typeof row.text==='string'&&row.text.trim()&&object(row.expected)&&object(row.raw)&&object(row.raw.extractedArguments)&&object(row.context)&&object(row.v2Run)&&typeof row.v2Run.status==='string',`${key}: 逐例证据缺失`);
  check(typeof row.v1Score?.plan==='boolean'&&typeof row.v2Score?.plan==='boolean',`${key}: 独立 v1/v2 语义评分缺失`);
  parsedOutput(row);
 }
 const missingCalls=[];
 for(const [index,variant]of variants.entries()){
  if(!partial)check(audit.rows.filter(row=>row.variant===variant).length===expectedCounts[index],`${variant} 分母不完整`);
  for(const model of requiredModels)for(const caseId of caseLists[index]){
   if(seen.has(JSON.stringify([model,variant,caseId])))continue;
   check(partial,`缺失调用 ${model}/${variant}/${caseId}`);
   // This terminal state must account for the omitted model, not excuse unrelated missing rows.
   check(model===audit.hardwareLimit.model,`硬件限制声明不能解释其他模型的缺失调用 ${model}/${variant}/${caseId}`);
   missingCalls.push({model,variant,caseId});
  }
 }
 const completeModels=requiredModels.filter(model=>!missingCalls.some(call=>call.model===model));
 if(partial&&audit.completeModels!==undefined)check(Array.isArray(audit.completeModels)&&isDeepStrictEqual([...audit.completeModels].sort(),[...completeModels].sort()),'已完成模型声明与实际调用覆盖不一致');
 if(audit.plannedCalls!==undefined)check(audit.plannedCalls===224,'plannedCalls 必须对应已冻结的 224 次正式调用计划');
 if(audit.missingCalls!==undefined&&typeof audit.missingCalls==='number')check(audit.missingCalls===missingCalls.length,'missingCalls 与实际缺失调用数量不一致');
 check(Array.isArray(audit.warmups)&&audit.warmups.every(item=>requiredModels.includes(item.model)&&item.excludedFromScores===true),'预热必须独立且明确 excludedFromScores');
 return {caseLists,partial,endedAt,missingCalls,completeModels};
}
function environment(audit,model){
 const detail=audit.conditions.modelDetails.find(item=>item.name===model);
 return {models:[{...clone(detail),parameterSize:detail.details?.parameter_size,quantization:detail.details?.quantization_level}],hardware:clone(audit.conditions.hardware??{}),modelDirectory:audit.conditions.modelDirectory,executionBoundary:boundary,prepareSystemContextExecuted:false,harmonyHostUsed:false,businessApiExecuted:false};
}
/** No expected/gold is used to construct runs. It is only read below to score evaluation results. */
function makeRun(audit,row,index,metadata){
 const parsed=parsedOutput(row),wall=Number.isFinite(row.trace?.wallMs)?row.trace.wallMs:null;
 const deterministic=Number.isFinite(row.v2Run.deterministicMs)?row.v2Run.deterministicMs:null;
 return {...clone(row.v2Run),id:evidenceId(audit.id,'run',row.variant,row.model,row.caseId),createdAt:row.trace?.startedAt??audit.createdAt,
  text:row.text,model:row.model,mode:'unified',catalogVersion:'single-service-v3',ruleVersion:'deterministic-grounding-v2',
  modelArguments:object(parsed?.arguments)?clone(parsed.arguments):null,extractedArguments:clone(row.raw.extractedArguments),
  context:clone(row.context),traces:row.trace?[clone(row.trace)]:[],candidates:{unified:clone(row.trace?.promptMeta?.candidates??{scores:row.candidates??[]})},
  options:clone(audit.conditions.options??{}),stages:{unified:{provider:row.trace?.provider??'ollama',model:row.model}},environment:environment(audit,row.model),
  totalMs:wall===null?null:wall+(deterministic??0),requestTotalMs:null,queueWaitMs:null,warmup:false,
  timing:{totalMsMeasured:false,formula:'trace.wallMs + recorded v2Run.deterministicMs; excludes harness, queue, and system-context reads',providerWallMs:wall,recordedDeterministicMs:deterministic},
  feasibilityManifestId:audit.id,feasibilityImportVersion:IMPORT_VERSION,feasibilityVariant:row.variant,feasibilityCaseId:row.caseId,
  feasibilityEvidence:{...metadata,rowIndex:index,raw:clone(row.raw),modelArgumentsSource:parsed?'trace.raw.arguments':'unparsed_failed_call',executionBoundary:boundary}
 };
}
function makeWarmup(audit,item,index,metadata){
 let parsed;try{parsed=JSON.parse(item.trace?.raw);}catch{}
 return {id:evidenceId(audit.id,'warmup','shared',item.model,String(index)),createdAt:item.trace?.startedAt??audit.createdAt,
  text:item.trace?.messages?.find(message=>message.role==='user')?.content??'手机还剩多少电',model:item.model,mode:'unified',
  domain:parsed?.domain??null,api:parsed?.api==='unsupported'?null:parsed?.api??null,modelArguments:clone(parsed?.arguments??null),extractedArguments:omitNulls(clone(parsed?.arguments??{})),
  status:item.error?'error':'parsed',...(item.error?{error:item.error}:{}),context:clone(audit.conditions.context??{}),traces:item.trace?[clone(item.trace)]:[],
  totalMs:Number.isFinite(item.trace?.wallMs)?item.trace.wallMs:null,options:clone(audit.conditions.options??{}),environment:environment(audit,item.model),
  catalogVersion:'single-service-v3',ruleVersion:null,warmup:true,excludedFromScores:true,
  feasibilityManifestId:audit.id,feasibilityImportVersion:IMPORT_VERSION,feasibilityVariant:'shared-warmup',feasibilityEvidence:{...metadata,warmupIndex:index,executionBoundary:'预热仅直连 provider；未调用 finalizePlan 或 prepareSystemContext，不进入任何准确率分母。'}
 };
}
export function buildFeasibilityImport(audit,{evidencePath='evidence/feasibility-live-audit.json',evidenceSha256=null,importedAt=new Date().toISOString()}={}){
 const coverage=validateAudit(audit),{caseLists,partial,endedAt}=coverage;
 const metadata={path:evidencePath,sha256:evidenceSha256,importedAt,sourceManifestId:audit.id};
 const runs=audit.rows.map((row,index)=>makeRun(audit,row,index,metadata));
 const mainJobId=evidenceId(audit.id,'eval',variants[0]);
 const warmups=audit.warmups.map((item,index)=>makeWarmup(audit,item,index,metadata));
 const evaluations=variants.map((variant,index)=>{
  const results=audit.rows.flatMap((row,rowIndex)=>row.variant!==variant?[]:[{
   caseId:row.caseId,text:row.text,category:row.category??(index===2?'独立守卫':'单一服务可行性'),suite:index===2?'single-service-guards':'single-service-v1',testDomain:row.testDomain,scenario:row.scenario??null,
   model:row.model,variant,repeatIndex:0,expected:clone(row.expected),actual:{domain:runs[rowIndex].domain,api:runs[rowIndex].api,arguments:clone(runs[rowIndex].extractedArguments),status:runs[rowIndex].status},
   score:scoreCase(row.expected,runs[rowIndex]),executionScore:clone(row.v2Score),rawScore:clone(row.rawScore??null),v1Score:clone(row.v1Score),v1Run:clone(row.v1Run??null),
   ...(row.v1Error?{v1Error:row.v1Error}:{}),...(row.v2Error?{v2Error:row.v2Error}:{}),run:runs[rowIndex]
  }]);
  const summary=summarize(results).map(item=>{
   const source=audit.rows.filter(row=>row.variant===variant&&row.model===item.model);
   const hardwareLimited=partial&&item.model===audit.hardwareLimit.model;
   return {...item,executionAccuracy:results.filter(row=>row.model===item.model&&row.executionScore.plan).length/item.total,executionScored:item.total,
    providerErrors:source.filter(row=>row.error).length,ruleErrors:source.filter(row=>row.v2Error).length,routingEvaluableCalls:source.filter(row=>!row.error).length,
    hardwareLimited,capacityComparisonEligible:!hardwareLimited};
  });
  const missing=coverage.missingCalls.filter(call=>call.variant===variant);
  return {id:evidenceId(audit.id,'eval',variant),createdAt:audit.createdAt,completedAt:partial?null:endedAt,...(partial?{interruptedAt:endedAt}:{}),status:partial?'interrupted':'completed',catalogVersion:'single-service-v3',ruleVersion:'deterministic-grounding-v2',mode:'unified',
   models:[...requiredModels],variant,promptVersion:index===1?'sparse-v6':'explicit-v7',options:clone(audit.conditions.options??{}),repeats:1,caseIds:[...caseLists[index]],context:clone(audit.conditions.context??{}),
   progress:{done:results.length,total:partial?expectedCounts[index]:results.length},results,summary,warmup:warmups.length>0,warmups:index===0?warmups:[],
   samplingCoverage:{plannedCalls:expectedCounts[index],observedCalls:results.length,missingCallCount:missing.length,missingCalls:clone(missing),completeModels:[...coverage.completeModels]},
   sourceAuditStatus:audit.status,...(partial?{hardwareLimit:clone(audit.hardwareLimit)}:{}),
   sharedWarmupEvidence:{ownerJobId:mainJobId,count:warmups.length,excludedFromScores:true},conditions:clone(audit.conditions),
   feasibilityManifestId:audit.id,feasibilityImportVersion:IMPORT_VERSION,feasibilityVariant:variant,feasibilityEvidence:metadata,
   notes:[boundary,'score = scoreCase(expected, v2Run status + untouched raw extractedArguments)；executionScore = 原证据 v2Score，独立评分。','v1Run / v1Score 仅为冻结 v1 对照审计，不混入当前 v2 分数或分母。','总耗时为已有 provider wallMs 与 v2 deterministicMs 的和，非重新测量的整链路耗时。',index===2?'独立守卫题保留原文与逐例期望；未加入默认 corpus。':'保持原抽样范围；错误保留在分母。',
    partial?`硬件限制结束；本评测计划 ${expectedCounts[index]} 次，实际 ${results.length} 次，缺失 ${missing.length} 次不进入准确率分母。${audit.hardwareLimit.model} 的超时单列 providerErrors，不能据此判断模型 API 识别能力。`:'预热由主评测独立保存，三个评测正式分母分别为 160 / 48 / 16。']
  };
 });
 return {manifestId:audit.id,runs,evaluations,warmupCount:warmups.length,sourceAuditStatus:audit.status,plannedCalls:224,observedCalls:runs.length,missingCallCount:coverage.missingCalls.length,missingCalls:clone(coverage.missingCalls),completeModels:[...coverage.completeModels]};
}
async function assertOwnedTargets(directory,plan){
 for(const [kind,records]of [['run',plan.runs],['eval',plan.evaluations]])for(const item of records){
  const path=join(directory,`${kind}-${item.id}.json`);let previous;
  try{previous=JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw new Error(`拒绝覆盖无法验证所有权的记录 ${path}: ${error.message}`);}
  check(previous.id===item.id&&previous.feasibilityManifestId===plan.manifestId&&previous.feasibilityImportVersion===IMPORT_VERSION&&previous.feasibilityVariant===item.feasibilityVariant,`拒绝覆盖历史/非本 manifest 导入记录：${path}`);
 }
}
export async function importFeasibilityEvidence({auditPath=join(root,'evidence','feasibility-live-audit.json'),runtimeDirectory=join(root,'data','runtime'),dryRun=false}={}){
 const bytes=await readFile(auditPath),audit=JSON.parse(bytes.toString('utf8'));
 const plan=buildFeasibilityImport(audit,{evidencePath:resolve(auditPath),evidenceSha256:createHash('sha256').update(bytes).digest('hex')});
 await assertOwnedTargets(resolve(runtimeDirectory),plan); // Preflight every target before the first write.
 if(!dryRun){
  const store=await new RuntimeStore(resolve(runtimeDirectory)).init();
  for(const run of plan.runs)await store.save('run',run);
  for(const job of plan.evaluations)await store.save('eval',job);
 }
 return {status:dryRun?'dry_run':'imported',manifestId:plan.manifestId,sourceAuditStatus:plan.sourceAuditStatus,runtimeDirectory:resolve(runtimeDirectory),runCount:plan.runs.length,warmupCount:plan.warmupCount,plannedCalls:plan.plannedCalls,missingCallCount:plan.missingCallCount,completeModels:plan.completeModels,jobs:plan.evaluations.map(job=>({id:job.id,variant:job.variant,status:job.status,count:job.results.length,caseCount:job.caseIds.length,plannedCalls:job.samplingCoverage.plannedCalls,missingCallCount:job.samplingCoverage.missingCallCount}))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};
 for(let index=2;index<process.argv.length;index++){
  const arg=process.argv[index];
  if(arg==='--dry-run')options.dryRun=true;
  else if(arg==='--audit'||arg==='--runtime'){check(process.argv[index+1]&&!process.argv[index+1].startsWith('--'),`${arg} requires a path`);options[arg==='--audit'?'auditPath':'runtimeDirectory']=process.argv[++index];}
  else throw new Error(`Unknown option: ${arg}`);
 }
 try{console.log(JSON.stringify(await importFeasibilityEvidence(options),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
