import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,relative,resolve,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {scoreExecutionSemantics} from '../src/semantic-evaluation.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const quantile=(values,p)=>{if(!values.length)return null;const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const index=(a.length-1)*p,lower=Math.floor(index),fraction=index-lower;return Math.round((a[lower]+((a[lower+1]??a[lower])-a[lower])*fraction)*1000)/1000;};
const metric=(rows,key,component='plan')=>({total:rows.length,correct:rows.filter(row=>row[key]?.[component]===true).length,accuracy:rows.length?rows.filter(row=>row[key]?.[component]===true).length/rows.length:null});

export async function saveReplaySourceSnapshot({root,snapshotDirectory,paths}){
 const workspace=resolve(root),destination=resolve(workspace,snapshotDirectory);
 const within=path=>{const rel=relative(workspace,path);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith(`..${process.platform==='win32'?'\\':'/'}`);};
 if(!within(destination))throw new Error('源码快照必须位于指定工作区内');
 const files=[];
 for(const path of paths){
  const source=resolve(workspace,path),target=resolve(destination,path);
  if(!within(source)||!within(target)||relative(destination,target).startsWith('..'))throw new Error('源码快照路径越界');
  const bytes=await readFile(source),sha256=createHash('sha256').update(bytes).digest('hex');
  await mkdir(dirname(target),{recursive:true});
  try{await writeFile(target,bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
  const snapshotHash=createHash('sha256').update(await readFile(target)).digest('hex');
  if(snapshotHash!==sha256)throw new Error(`快照源码与当前版本不一致，拒绝覆盖已冻结文件：${path}`);
  files.push({path,sha256,snapshotHash,verified:true});
 }
 return {directory:snapshotDirectory,files};
}

/** Replay the same immutable model output; this function does not import or invoke model providers. */
export async function buildGroundingReplay({manifest,jobs,finalize}){
 if(typeof finalize!=='function')throw new Error('A deterministic finalizePlan function is required');
 const jobMap=new Map(jobs.map(job=>[job.id,job])),rows=[],cells=[];
 for(const entry of manifest.entries){
  const job=jobMap.get(entry.jobId);if(!job||entry.status!=='completed'||job.status!=='completed')throw new Error(`已登记批次未完整完成：${entry.jobId}`);
  if(job.results.length!==entry.total)throw new Error(`批次记录数不匹配：${entry.jobId}`);
  const cellRows=[];
  for(const result of job.results){
   if(result.model!==entry.model||result.testDomain!==entry.testDomain)throw new Error('模型/领域与清单不匹配');
   const run=result.run,context=structuredClone(run.context??job.context??manifest.conditions?.context??{});
   const oldSemantic=scoreExecutionSemantics(result.expected,run,context);
   let newRun,replay;
   if(['error','cancelled'].includes(run.status)){newRun=run;replay={skipped:true,reason:'原模型调用或输出失败；离线规则不能修复原始调用',wallMs:null,error:run.error??run.status};}
   else{
    const start=performance.now();
    try{const final=await finalize({text:result.text??run.text,domain:run.domain,api:run.api,extractedArguments:structuredClone(run.extractedArguments??{}),context});replay={skipped:false,wallMs:performance.now()-start};newRun={...run,...final};}
    catch(error){replay={skipped:false,wallMs:performance.now()-start,error:error.message};newRun={...run,status:'error',error:error.message};}
   }
   const newSemantic=scoreExecutionSemantics(result.expected,newRun,context);
   const row={manifestId:manifest.id,jobId:entry.jobId,model:entry.model,testDomain:entry.testDomain,caseId:result.caseId,scenario:result.scenario,text:result.text??run.text,runId:run.id,expected:result.expected,raw:(run.traces??[]).map(trace=>trace.raw),modelArguments:run.modelArguments??{},extractedArguments:run.extractedArguments??{},oldScore:result.score,oldStatus:run.status,oldDomain:run.domain,oldApi:run.api,newStatus:newRun.status,newDomain:newRun.domain,newApi:newRun.api,groundedArguments:newRun.groundedArguments??run.extractedArguments??{},grounding:newRun.grounding??null,oldSemantic,newSemantic,replay,oldModelTotalMs:run.totalMs??null};
   rows.push(row);cellRows.push(row);
  }
  const times=cellRows.map(row=>row.replay.wallMs).filter(Number.isFinite),oldTimes=cellRows.map(row=>row.oldModelTotalMs).filter(Number.isFinite);
  const changed=cellRows.filter(row=>row.oldSemantic.plan!==row.newSemantic.plan);
  cells.push({model:entry.model,testDomain:entry.testDomain,jobId:entry.jobId,total:cellRows.length,oldStrictAccuracy:metric(cellRows,'oldScore').accuracy,oldSemanticAccuracy:metric(cellRows,'oldSemantic').accuracy,newSemanticAccuracy:metric(cellRows,'newSemantic').accuracy,oldModelP50Ms:quantile(oldTimes,.5),oldModelP95Ms:quantile(oldTimes,.95),replayP50Ms:quantile(times,.5),replayP95Ms:quantile(times,.95),replayTotalMs:times.reduce((a,b)=>a+b,0),improved:changed.filter(row=>row.newSemantic.plan).length,regressed:changed.filter(row=>row.oldSemantic.plan).length,unchanged:cellRows.length-changed.length,errors:cellRows.filter(row=>row.replay.error).length,repairs:cellRows.filter(row=>row.grounding?.repairs?.length).length,blockers:cellRows.filter(row=>row.grounding?.blockers?.length).length,expectedContractQuestions:cellRows.filter(row=>!row.oldSemantic.expectedResolverStatusMatchesGold).length});
 }
 const changes=rows.filter(row=>row.oldSemantic.plan!==row.newSemantic.plan);
 const selected=[];
 for(const cell of cells)for(const type of ['improved','regressed','unresolved','gold_contract_question','model_error']){
  const row=rows.find(row=>row.model===cell.model&&row.testDomain===cell.testDomain&&!selected.some(example=>example.runId===row.runId)&&(type==='improved'?!row.oldSemantic.plan&&row.newSemantic.plan:type==='regressed'?row.oldSemantic.plan&&!row.newSemantic.plan:type==='unresolved'?!row.newSemantic.plan&&!row.oldSemantic.plan:type==='model_error'?row.replay.skipped:!row.oldSemantic.expectedResolverStatusMatchesGold));
  if(row)selected.push({...row,exampleType:type});
 }
 const report={version:'deterministic-grounding-v1',manifestId:manifest.id,status:'completed',scope:'只回放清单登记的冻结模型输出；原模型未重测，历史严格分数和run/eval不改写',semanticsDefinition:{version:'execution-semantics-v1',gold:'仅离线从手工gold.arguments构造期望resolver结果；不向grounding或模型提供gold',actual:'旧执行语义只用旧run.resolved；新执行语义使用finalizePlan的新结果',required:['domain','api','finalArguments','status','precision','explicitSourceAnnotations','blockingConstraintMatch','goldResolverStatusConsistency'],temporal:'resolver.normalizeTemporalValue归一化最终时间，保留精度；只允许声明的daily白天/夜间字段组合折叠时段',strictNonTemporal:'非时间字段深层严格，包括数组顺序、额外执行字段、URI和API父叶边界',location:'有可核验坐标时按同一经纬度比较位置；精度及gold明确来源另核验'},progress:{done:rows.length,total:manifest.entries.reduce((n,e)=>n+e.total,0)},conditions:{frozen:manifest.conditions,modelOutputsReused:true,modelCalls:0,replayTiming:'replay*Ms仅测finalizePlan确定性代码，不含模型、评分、文件读取或原模型重测延迟',recordedModelTiming:'oldModel*Ms来自冻结run.totalMs，含原模型与解析链路，不含排队/预热'},metrics:{oldStrict:metric(rows,'oldScore'),oldExecutionSemantics:metric(rows,'oldSemantic'),newExecutionSemantics:metric(rows,'newSemantic')},changes:{improved:changes.filter(row=>row.newSemantic.plan).length,regressed:changes.filter(row=>row.oldSemantic.plan).length,unchanged:rows.length-changes.length,skippedModelErrors:rows.filter(row=>row.replay.skipped).length,expectedResolverStatusQuestions:rows.filter(row=>!row.oldSemantic.expectedResolverStatusMatchesGold).length},cells,examples:selected,auditPath:'docs/grounding-replay-audit.json',notes:['这是同一冻结输出的确定性规则回放，不是重新运行模型或独立盲测。','旧严格分数原样保留；语义评分使用独立口径，不加回历史分数。','旧解析失败不会通过重新解析旧raw获得旧语义正确；新解析覆盖的变化仅体现在新回放。','gold与当前resolver状态不一致会列为契约疑点，不能计为正确。','补全只核对当前规则能验证的原文证据；剩余模型领域/API错误、无证据写值、业务身份或SDK结果等价不自动修复。','回放的少量代码耗时随CPU/缓存波动，不能与模型推理速度直接相加作实测性能承诺。']};
 report.metrics.oldExtraction=metric(rows,'oldScore','arguments');
 report.metricsDefinitions={oldStrict:'历史score.plan：严格完整计划，通过全部旧评分维度',oldExtraction:'历史score.arguments：明确入参严格提取准确率，独立于完整计划',oldExecutionSemantics:'旧run.resolved最终结果的独立执行语义评分',newExecutionSemantics:'复用原模型输出、确定性finalizePlan之后的独立执行语义评分'};
 report.semanticsDefinition.expectedContract='期望计划采用报告哈希对应的当前resolver离线构造，含已声明的时间等价与目标约束修复；旧实际计划仍只读冻结run.resolved。历史严格分数不按这些规则重算。';
 for(const cell of report.cells){const subset=rows.filter(row=>row.model===cell.model&&row.testDomain===cell.testDomain);const extraction=metric(subset,'oldScore','arguments');cell.oldExtractionAccuracy=extraction.accuracy;cell.oldExtractionCorrect=extraction.correct;}
 report.generatedAt=new Date().toISOString();
 return {report,rows};
}

async function main(){
 const manifestFile=join(root,'data/runtime/domain-suite.json'),manifest=JSON.parse(await readFile(manifestFile,'utf8'));
 if(manifest.id!=='0b5941eb-729e-4e59-9d9d-70f6ae8eed92'||manifest.status!=='completed'||manifest.entries.length!==24||manifest.entries.some(entry=>entry.total!==50))throw new Error('本报告只接受完成的冻结1200次指定清单');
 const jobs=await Promise.all(manifest.entries.map(entry=>readFile(join(root,`data/runtime/eval-${entry.jobId}.json`),'utf8').then(JSON.parse)));
 const sourcePaths=['src/grounding.mjs','src/resolver.mjs','src/semantic-evaluation.mjs','scripts/replay-grounding.mjs'];
 const hashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,createHash('sha256').update(await readFile(join(root,path))).digest('hex')])));
 const initialHashes=await hashes();
 const {finalizePlan}=await import('../src/grounding.mjs');
 const {report,rows}=await buildGroundingReplay({manifest,jobs,finalize:finalizePlan});
 report.conditions.replaySourceHashes=await hashes();
 if(JSON.stringify(initialHashes)!==JSON.stringify(report.conditions.replaySourceHashes))throw new Error('回放期间源码改变，拒绝生成混合版本报告');
 const snapshot=await saveReplaySourceSnapshot({root,snapshotDirectory:'data/benchmark-grounding-v1',paths:sourcePaths});
 if(snapshot.files.some(file=>file.sha256!==report.conditions.replaySourceHashes[file.path]))throw new Error('保存快照期间源码改变，拒绝生成混合版本报告');
 report.conditions.replaySnapshotDirectory=snapshot.directory;
 report.conditions.replaySnapshotFiles=snapshot.files;
 report.conditions.generatedAt=new Date().toISOString();
 await mkdir(join(root,'docs'),{recursive:true});
 await writeFile(join(root,'docs/grounding-replay-audit.json'),JSON.stringify({version:report.version,manifestId:report.manifestId,semanticsDefinition:report.semanticsDefinition,rows},null,2)+'\n');
 await writeFile(join(root,'docs/grounding-replay.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({manifestId:report.manifestId,progress:report.progress,metrics:report.metrics,changes:report.changes,cells:report.cells.length},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
