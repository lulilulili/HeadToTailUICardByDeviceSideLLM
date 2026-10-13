import {singleService100Plan} from './single-service-100.mjs';

const metric=(rows,fn)=>({correct:rows.filter(fn).length,total:rows.length,accuracy:rows.length?rows.filter(fn).length/rows.length:null});
const q=(values,p)=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a[Math.round((a.length-1)*p)]:null;};
const nonnegative=value=>Number.isFinite(value)&&value>=0;
const totalKnown=values=>values.length&&values.every(nonnegative)?values.reduce((sum,value)=>sum+value,0):null;
const stageOrder=['domain','intent','intent_arguments','arguments','unified'];

/** Derive recorded timings only; a request is not interchangeable with a model call. */
function timingSummary(rows){
 const hasCalls=row=>Array.isArray(row.traceTimings)&&Number.isInteger(row.actualCallCount)&&row.actualCallCount>=0&&row.actualCallCount===row.traceTimings.length;
 const callKnown=rows.filter(hasCalls),calls=rows.flatMap(row=>Array.isArray(row.traceTimings)?row.traceTimings:[]);
 const knownRequests=callKnown.filter(row=>row.traceTimings.every(trace=>nonnegative(trace.wallMs))).length;
 const requestTotalMs=totalKnown(rows.map(row=>row.wallMs));
 const actualCallCount=rows.length&&callKnown.length===rows.length?rows.reduce((sum,row)=>sum+row.actualCallCount,0):null;
 const modelCallTotalMs=actualCallCount!==null&&knownRequests===rows.length?calls.reduce((sum,trace)=>sum+trace.wallMs,0):null;
 const stages=[...Map.groupBy(calls,trace=>trace.stage)].map(([stage,traces])=>{
  const values=traces.map(trace=>trace.wallMs),totalMs=totalKnown(values),knownCalls=values.filter(nonnegative).length;
  return {stage,calls:traces.length,knownCalls,totalMs,meanMs:totalMs===null?null:totalMs/traces.length,
   p50Ms:knownCalls===traces.length?q(values,.5):null,p95Ms:knownCalls===traces.length?q(values,.95):null,
   errors:traces.every(trace=>Object.hasOwn(trace,'error'))?traces.filter(trace=>trace.error).length:null,
   providers:[...new Set(traces.map(trace=>trace.provider).filter(Boolean))],models:[...new Set(traces.map(trace=>trace.model).filter(Boolean))],
   loadMs:totalKnown(traces.map(trace=>trace.loadMs)),promptMs:totalKnown(traces.map(trace=>trace.promptMs)),generationMs:totalKnown(traces.map(trace=>trace.generationMs)),
   inputTokens:totalKnown(traces.map(trace=>trace.inputTokens)),outputTokens:totalKnown(traces.map(trace=>trace.outputTokens))};
 }).sort((a,b)=>{const x=stageOrder.indexOf(a.stage),y=stageOrder.indexOf(b.stage);return (x<0?stageOrder.length:x)-(y<0?stageOrder.length:y)||String(a.stage).localeCompare(String(b.stage));});
 return {requests:rows.length,knownRequests,requestKnownCount:rows.filter(row=>nonnegative(row.wallMs)).length,
  requestTotalMs,requestMeanMs:requestTotalMs===null?null:requestTotalMs/rows.length,requestP50Ms:q(rows.map(row=>row.wallMs),.5),requestP95Ms:q(rows.map(row=>row.wallMs),.95),
  actualCallCount,observedActualCallCount:calls.length,meanCalls:actualCallCount===null?null:actualCallCount/rows.length,modelCallTotalMs,
  complete:rows.length>0&&knownRequests===rows.length&&requestTotalMs!==null,stages};
}

function candidateDiagnostics(rows){
 const known=rows.filter(row=>typeof row.domainGateMiss==='boolean'&&typeof row.candidateRecallEligible==='boolean');
 const fullyKnown=rows.length>0&&known.length===rows.length;
 return {domainGateMiss:fullyKnown?known.filter(row=>row.domainGateMiss).length:null,
  budgetRecallMisses:fullyKnown?known.filter(row=>row.candidateRecallEligible&&!row.candidateRecall).length:null,
  candidateRecallEligible:metric(known.filter(row=>row.candidateRecallEligible),row=>row.candidateRecall),candidateDiagnosticsKnownRequests:known.length};
}

function executionElapsed(manifest,windows=manifest.executionWindows,source='manifest.executionWindows'){
 const result={elapsedMs:null,status:'unknown',windows:Array.isArray(windows)?windows.length:0,asOf:null,includesWarmups:true,source};
 if(!Array.isArray(windows)||!windows.length)return result;
 let sum=0,previousEnd=null,hasOpen=false;
 for(const window of windows){
  const open=!window.endedAt,start=Date.parse(window.startedAt),end=Date.parse(open&&manifest.status==='running'?manifest.updatedAt:window.endedAt);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||(previousEnd!==null&&start<previousEnd)||hasOpen)return {...result,status:'invalid'};
  sum+=end-start;previousEnd=end;hasOpen=open;result.asOf=open?manifest.updatedAt:window.endedAt;
 }
 return {...result,elapsedMs:sum,status:hasOpen?'observed':'complete'};
}

function warmupTiming(manifest){
 const rows=(manifest.warmups??[]).map(row=>({...row,wallMs:row.totalMs})),total=totalKnown(rows.map(row=>row.wallMs));
 const calls=totalKnown(rows.map(row=>row.actualCallCount)),modelMs=totalKnown(rows.map(row=>row.modelCallMs));
 return {requests:rows.length,requestTotalMs:total,requestMeanMs:total===null?null:total/rows.length,actualCallCount:calls,modelCallTotalMs:modelMs,excludedFromFormal:true};
}

function comparableSummary(cell){
 if(!cell)return null;
 return Object.fromEntries(['total','planned','complete','domain','api','rawArguments','semantics','p50Ms','p95Ms'].map(key=>[key,cell[key]??null]).concat([
  ['requestMeanMs',cell.timing?.requestMeanMs??null],['requestTotalMs',cell.timing?.requestTotalMs??null]]));
}

function baselineComparison(manifest,rows,summary,cells){
 const baseline=manifest.comparisonBaseline;
 if(!baseline)return null;
 const sameCorpus=typeof baseline.corpusSha256==='string'&&baseline.corpusSha256===manifest.corpus?.sha256;
 const pair=(current,previous)=>{
  const scoped=rows.filter(row=>row.model===current.model&&(!current.testDomain||row.testDomain===current.testDomain));
  const unique=new Set(scoped.map(row=>row.caseId)).size===current.planned;
  const knownIds=!Array.isArray(manifest.corpus?.caseOrder)||scoped.every(row=>manifest.corpus.caseOrder.includes(row.caseId));
  const oldDigest=baseline.conditions?.modelDetails?.find(model=>(model.name??model.model)===current.model)?.digest;
  const newDigest=manifest.conditions?.modelDetails?.find(model=>(model.name??model.model)===current.model)?.digest;
  let reason=!sameCorpus?'corpus_sha_mismatch':!previous?'baseline_scope_missing':oldDigest&&newDigest&&oldDigest!==newDigest?'model_digest_mismatch':
   !current.complete||!previous.complete||previous.total!==current.planned||previous.planned!==current.planned?'partial_or_different_scope':!unique||!knownIds?'case_keys_not_complete':'paired_complete_scope';
  const paired=reason==='paired_complete_scope',a=comparableSummary(current),b=comparableSummary(previous);
  const subtract=(x,y)=>Number.isFinite(x)&&Number.isFinite(y)?x-y:null;
  const delta=paired?Object.fromEntries(['domain','api','rawArguments','semantics'].map(key=>[key,subtract(a[key]?.accuracy,b[key]?.accuracy)]).concat(
   ['p50Ms','p95Ms','requestMeanMs','requestTotalMs'].map(key=>[key,subtract(a[key],b[key])]))):null;
  return {model:current.model,testDomain:current.testDomain,paired,current:a,baseline:b,delta,reason};
 };
 return {id:baseline.id,reportSha256:baseline.reportSha256??null,corpusSha256:baseline.corpusSha256??null,mode:baseline.conditions?.mode??baseline.mode??null,conditions:baseline.conditions??null,
  summary:summary.map(current=>pair(current,baseline.summary?.find(previous=>previous.model===current.model))),
  cells:cells.map(current=>pair(current,baseline.cells?.find(previous=>previous.model===current.model&&previous.testDomain===current.testDomain))),
  notes:['仅相同语料、同模型/领域且双方全量完成时计算差值；partial当前结果展示全量基线但不作配对。',
   '候选检索、提示词、调用方式与规则可能改变；这是完整工程流程的同题对照，不是纯模型能力或公平速度实验。',
   '并行影子选择会竞争CPU；昨日独占基线耗时只作展示，不能将速度差归因于某一个组件。']};
}

function choiceMetric(values){
 const correct=values.filter(value=>value===true).length,total=values.length,known=values.filter(value=>typeof value==='boolean').length;
 return {correct,total,accuracy:known===total&&total?correct/total:null,...(known===total?{}:{knownTotal:known})};
}

function choiceResults(samples){
 return Object.fromEntries(['primary','laya'].map(provider=>[provider,{
  selection:choiceMetric(samples.map(sample=>sample===false?false:typeof sample?.[provider]?.selectionCorrect==='boolean'?sample[provider].selectionCorrect:null)),
  contract:choiceMetric(samples.map(sample=>sample===false?false:typeof sample?.[provider]?.contractValid==='boolean'?sample[provider].contractValid:null))
 }]));
}

function shadowCallTiming(outcomes){
 const values=outcomes.map(outcome=>outcome?.wallMs),totalMs=totalKnown(values),knownCalls=values.filter(nonnegative).length;
 return {calls:outcomes.length,knownCalls,totalMs,meanMs:totalMs===null?null:totalMs/outcomes.length,
  p50Ms:knownCalls===outcomes.length?q(values,.5):null,p95Ms:knownCalls===outcomes.length?q(values,.95):null,
  errors:outcomes.every(outcome=>outcome&&Object.hasOwn(outcome,'error'))?outcomes.filter(outcome=>outcome.error).length:null};
}

function shadowStage(rows,stage,planned){
 const get=row=>row.shadow?.decisions?.find(decision=>decision.stage===stage);
 const known=row=>Array.isArray(row.shadow?.decisions);
 const all=rows.map(row=>known(row)?get(row)??false:null),observed=all.filter(decision=>decision&&typeof decision==='object'),eligible=observed.filter(decision=>decision.expectedInCandidates===true);
 return {coverage:{observed:observed.length,requests:rows.length,planned,missing:rows.filter(known).length-observed.length,eligible:eligible.length,knownRequests:rows.filter(known).length},
  all:choiceResults(all),observed:choiceResults(observed),eligible:choiceResults(eligible),
  agreement:choiceMetric(observed.map(decision=>typeof decision.agreement==='boolean'?decision.agreement:null)),
  primaryStages:[...new Set(observed.map(decision=>decision.primaryStage).filter(Boolean))],
  primaryTiming:shadowCallTiming(observed.map(decision=>decision.primary)),layaTiming:shadowCallTiming(observed.map(decision=>decision.laya))};
}

function shadowElapsedTiming(rows,key){
 const values=rows.map(row=>row.shadow?.[key]),knownRequests=values.filter(nonnegative).length,totalMs=totalKnown(values);
 return {requests:rows.length,knownRequests,totalMs,meanMs:totalMs===null?null:totalMs/rows.length,p50Ms:knownRequests===rows.length?q(values,.5):null,p95Ms:knownRequests===rows.length?q(values,.95):null};
}

function shadowSummary(rows,{model=null,testDomain=null,planned}){
 return {model,testDomain,requests:rows.length,observedRequests:rows.filter(row=>Array.isArray(row.shadow?.decisions)).length,
  domain:shadowStage(rows,'domain',planned),api:shadowStage(rows,'intent',planned),
  combinedRequestTiming:shadowElapsedTiming(rows,'combinedWallMs'),drainTiming:shadowElapsedTiming(rows,'drainMs')};
}

function shadowComparison(manifest,rows,plan){
 const configuration=manifest.conditions?.layaShadow?.enabled?manifest.conditions.layaShadow:manifest.conditions?.shadow;
 if(!configuration&&!rows.some(row=>row.shadow))return null;
 return {...shadowSummary(rows,{planned:plan.totalCalls}),policy:configuration?.policy??rows.find(row=>row.shadow)?.shadow?.policy??null,
  summary:plan.models.map(model=>shadowSummary(rows.filter(row=>row.model===model),{model,planned:plan.callsPerModel})),
  cells:plan.models.flatMap(model=>plan.domains.map(testDomain=>shadowSummary(rows.filter(row=>row.model===model&&row.testDomain===testDomain),{model,testDomain,planned:plan.perDomain}))),
  notes:['影子Laya仅做领域/API选择，最终下游领域、API和参数均由Qwen决定；不是Laya独立端到端计划准确率。',
   'API影子给定Qwen选择的领域和完全相同候选；Laya领域选择不控制它的下一阶段。eligible只含金标在候选内的实际decision。',
   'all以已完成请求为分母，未执行的后续阶段不算正确；observed仅含实际decision，coverage标明缺失阶段。没有影子记录的历史数据保持未知。',
   'selectionCorrect记录可解析的候选选择，contractValid另记完整返回协议有效性；Qwen联合API与参数阶段schema失败不自动算选择错误。',
   'primaryStage=intent_arguments的Qwen耗时含API与参数生成，Laya仅选择API，耗时不是等任务对比。combinedWallMs包含影子等待，权威Qwen请求时间及其trace单独计。',
   'Qwen与Laya并行使用CPU会竞争资源；昨日独占基线速度只能作为观察，不作单组件因果归因。']};
}
export function primaryFailure(row){
 if(row.error)return row.providerError===false?'rule_error':/timeout|timed out|超时/i.test(row.error)||row.errorType==='TimeoutError'?'provider_timeout':'provider_contract';
 if(!row.rawScore.domain)return 'domain';
 if(!row.rawScore.api)return 'api';
 if(!row.execution.expectedResolverStatusMatchesGold)return 'gold_contract';
 if(!row.execution.finalArguments)return 'parameters';
 if(!row.execution.plan)return 'status_or_constraint';
 return 'correct';
}
export function cellSummary(rows,{model,testDomain=null,planned}){
 const issues={};for(const row of rows)issues[row.primary]=(issues[row.primary]??0)+1;
 const differences={};for(const row of rows.filter(r=>r.primary==='parameters'))for(const d of row.differences??[]){const key=`${d.kind}:${d.path}`;differences[key]=(differences[key]??0)+1;}
 return {model,testDomain,planned,total:rows.length,complete:rows.length===planned,timing:timingSummary(rows),...candidateDiagnostics(rows),domain:metric(rows,r=>r.rawScore.domain),api:metric(rows,r=>r.rawScore.api),rawArguments:metric(rows,r=>r.rawScore.arguments),semantics:metric(rows,r=>r.execution.plan),
  candidateRecall:metric(rows,r=>r.candidateRecall),parsedApi:metric(rows,r=>r.parsedApiCorrect),providerErrors:rows.filter(r=>r.error&&r.providerError!==false).length,ruleErrors:rows.filter(r=>r.error&&r.providerError===false).length,truncated:rows.filter(r=>r.truncated).length,
  retrievalMisses:rows.filter(r=>!r.candidateRecall).length,wrongApiWithCandidate:rows.filter(r=>!r.error&&!r.rawScore.api&&r.candidateRecall).length,
  readyRequestSemantics:metric(rows.filter(r=>r.expectedStatus==='ready_mock'),r=>r.execution.plan&&r.status==='ready_mock'),
  safeNonReady:metric(rows.filter(r=>r.expectedStatus!=='ready_mock'),r=>r.execution.plan),contractBoundaryCount:rows.filter(r=>r.contractBoundary).length,
  rawMismatchFinalPass:rows.filter(r=>!r.rawScore.arguments&&r.execution.plan).length,rawCorrectFinalFail:rows.filter(r=>r.rawScore.domain&&r.rawScore.api&&r.rawScore.arguments&&!r.execution.plan).length,
  p50Ms:q(rows.map(r=>r.wallMs),.5),p95Ms:q(rows.map(r=>r.wallMs),.95),maxInputTokens:rows.length?Math.max(...rows.map(r=>r.inputTokens??0)):null,
  performance:{loadP50Ms:q(rows.map(r=>r.performance?.loadMs),.5),promptP50Ms:q(rows.map(r=>r.performance?.promptMs),.5),generationP50Ms:q(rows.map(r=>r.performance?.generationMs),.5),decodeP50TokensPerSecond:q(rows.map(r=>r.performance?.tokensPerSecond),.5),deterministicP50Ms:q(rows.map(r=>r.performance?.deterministicMs),.5),minSampledFreeMemoryBytes:q(rows.flatMap(r=>r.performance?.hostSamples?.map(sample=>sample.freeMemoryBytes)??[r.performance?.hostAfter?.freeMemoryBytes]),0),hostCpuBusyP50:q(rows.map(r=>r.performance?.hostCpuBusyFraction),.5)},
  primaryFailures:issues,parameterDifferences:Object.entries(differences).sort((a,b)=>b[1]-a[1]).map(([field,count])=>({field,count})),
  origins:[...Map.groupBy(rows,r=>r.origin)].map(([origin,list])=>({origin,total:list.length,api:metric(list,r=>r.rawScore.api),rawArguments:metric(list,r=>r.rawScore.arguments),semantics:metric(list,r=>r.execution.plan)}))};
}
export function buildSingleService100Report(manifest,rows){
 const plan=singleService100Plan(manifest);
 if(rows.some(row=>!plan.models.includes(row.model)||!plan.domains.includes(row.testDomain)))throw new Error('Report rows contain models/domains outside manifest');
 const summary=plan.models.map(model=>({...cellSummary(rows.filter(r=>r.model===model),{model,planned:plan.callsPerModel}),executionElapsed:executionElapsed(manifest,manifest.modelExecutionWindows?.filter(window=>window.model===model),'manifest.modelExecutionWindows')}));
 const cells=plan.models.flatMap(model=>plan.domains.map(testDomain=>cellSummary(rows.filter(r=>r.model===model&&r.testDomain===testDomain),{model,testDomain,planned:plan.perDomain})));
 const seen=new Map(),examples=[];
 for(const row of rows.filter(r=>r.primary!=='correct')){const key=`${row.model}/${row.testDomain}/${row.primary}`,count=seen.get(key)??0;if(count<2){examples.push(row);seen.set(key,count+1);}}
 const totalTiming=timingSummary(rows),diagnostics=candidateDiagnostics(rows);
 return {id:manifest.id,status:manifest.status,suite:manifest.suite,createdAt:manifest.createdAt,updatedAt:new Date().toISOString(),completedAt:manifest.completedAt??null,
  totalTiming,executionElapsed:executionElapsed(manifest),warmupTiming:warmupTiming(manifest),baselineComparison:baselineComparison(manifest,rows,summary,cells),shadowComparison:shadowComparison(manifest,rows,plan),
  metrics:{plannedRequests:plan.totalCalls,completedRequests:rows.length,actualCallCount:totalTiming.actualCallCount,meanCalls:totalTiming.meanCalls,...diagnostics},
  progress:{done:rows.length,total:plan.totalCalls},active:manifest.active??null,conditions:manifest.conditions,summary,cells,examples,examplePolicy:'每模型/领域/主错因最多2条；完整逐例结果可在结果列表筛选，原始输出单独保存',
  inferenceEnvironment:inferenceEnvironment(plan.models,rows),
  corpus:manifest.corpus,warmupCount:manifest.warmups?.length??0,sourceSnapshot:manifest.sourceSnapshot,error:manifest.error??null,
  notes:[plan.models.length===3&&plan.models.join(',')==='qwen2.5:1.5b,qwen2.5:3b,qwen2.5:0.5b'?'每领域100条、10领域共1000条单服务；1.5B→3B→0.5B，各一次，共3000条正式调用。7B不参与；预热单独保存。':`每领域${plan.perDomain}条、${plan.domains.length}领域共${plan.callsPerModel}条单服务；${plan.models.map(model=>model.split(':').at(-1).toUpperCase()).join('→')}，各一次，共${plan.totalCalls}条案例请求。预热单独保存。`,
   '前三列领域/API/原始参数与最终执行语义分开；失败仍计入已完成调用分母，未完成不算0分。running时百分比只指部分结果。',
   manifest.conditions?.mode==='adaptive'?'相同既有1000条已用于开发诊断，本轮属于工程回归对照；运行开始后冻结语料、金标、提示词和规则，仍非独立盲测或生产成功率。':'既有100条开发用例与新900条固定表达分列；新用例推理前冻结，不据模型输出修改金标、提示词或规则；仍非独立人类盲测或生产成功率。',
   '整体执行语义包含正确澄清/解析失败，不能当作服务执行成功率。readyRequestSemantics只统计期望可执行的请求；自然表达被现有合同拒绝的已知边界在corpus.contractBoundaries单列，不宣称支持该表达。',
   '手机位置、时钟、网络句柄和音频上下文均为明确标记的固定实验fixture；不读取电脑位置或Harmony真机，业务API仅mock。',
   'API正确率要求输出契约有效；parsedApi另记录可解析raw中的选择，不能把结构失败全部归为API意图错误。',
   '参数差异只对领域/API已对的剩余失败计数；一个调用可有多处差异，差异数不可相加成失败数。原始参数不匹配但最终通过含规则修复及时间语义等价，不等于模型原始提取变好。',
   '准确率按案例请求计分；actualCallCount按记录的模型阶段调用计数并包含失败阶段，modelCallTotalMs为这些trace耗时之和。整题requestTotalMs另含确定性处理，executionElapsed为实际执行窗口（含预热/落盘，不含跨次暂停），三者不可互换。',
   'domainGateMiss表示领域选择使正确API不可见；budgetRecallMisses仅统计正确领域且已产生API候选的漏选。历史retrievalMisses仍为所有未召回请求，缺少分层证据显示未知。']};
}

function inferenceEnvironment(models,rows){
 return {source:'/api/ps',models:models.map(name=>{
  const samples=rows.filter(row=>row.model===name).flatMap(row=>row.performance?.ollamaSamples??[]);
  const matches=samples.flatMap(sample=>(sample.models??[]).filter(model=>model.name===name).map(model=>({...model,at:sample.at})));
  const observed=matches.filter(model=>model.offload?.status==='observed'),last=observed.at(-1);
  return {name,sampleCount:samples.length,observedSamples:observed.length,status:last?'observed':'unknown',at:last?.at??null,
   cpuBytes:last?.offload.cpuBytes??null,gpuBytes:last?.offload.gpuBytes??null,gpuFraction:last?.offload.gpuFraction??null,contextLength:last?.contextLength??null,
   minGpuFraction:observed.length?Math.min(...observed.map(model=>model.offload.gpuFraction)):null,maxGpuFraction:observed.length?Math.max(...observed.map(model=>model.offload.gpuFraction)):null};
 }),notes:['仅根据推理期间 /api/ps 的 size、size_vram 和 context_length 观测；缺少字段或未采样显示unknown。','CPU/GPU bytes是Ollama报告的模型分配估计，不表示处理器利用率；安装GPU硬件不证明模型使用GPU。']};
}
