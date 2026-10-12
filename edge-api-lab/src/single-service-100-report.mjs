import {singleService100Plan} from './single-service-100.mjs';

const metric=(rows,fn)=>({correct:rows.filter(fn).length,total:rows.length,accuracy:rows.length?rows.filter(fn).length/rows.length:null});
const q=(values,p)=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a[Math.round((a.length-1)*p)]:null;};
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
 return {model,testDomain,planned,total:rows.length,complete:rows.length===planned,domain:metric(rows,r=>r.rawScore.domain),api:metric(rows,r=>r.rawScore.api),rawArguments:metric(rows,r=>r.rawScore.arguments),semantics:metric(rows,r=>r.execution.plan),
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
 const summary=plan.models.map(model=>cellSummary(rows.filter(r=>r.model===model),{model,planned:plan.callsPerModel}));
 const cells=plan.models.flatMap(model=>plan.domains.map(testDomain=>cellSummary(rows.filter(r=>r.model===model&&r.testDomain===testDomain),{model,testDomain,planned:plan.perDomain})));
 const seen=new Map(),examples=[];
 for(const row of rows.filter(r=>r.primary!=='correct')){const key=`${row.model}/${row.testDomain}/${row.primary}`,count=seen.get(key)??0;if(count<2){examples.push(row);seen.set(key,count+1);}}
 return {id:manifest.id,status:manifest.status,suite:manifest.suite,createdAt:manifest.createdAt,updatedAt:new Date().toISOString(),completedAt:manifest.completedAt??null,
  progress:{done:rows.length,total:plan.totalCalls},active:manifest.active??null,conditions:manifest.conditions,summary,cells,examples,examplePolicy:'每模型/领域/主错因最多2条；完整逐例结果可在结果列表筛选，原始输出单独保存',
  inferenceEnvironment:inferenceEnvironment(plan.models,rows),
  corpus:manifest.corpus,warmupCount:manifest.warmups?.length??0,sourceSnapshot:manifest.sourceSnapshot,error:manifest.error??null,
  notes:[plan.models.length===3&&plan.models.join(',')==='qwen2.5:1.5b,qwen2.5:3b,qwen2.5:0.5b'?'每领域100条、10领域共1000条单服务；1.5B→3B→0.5B，各一次，共3000条正式调用。7B不参与；预热单独保存。':`每领域${plan.perDomain}条、${plan.domains.length}领域共${plan.callsPerModel}条单服务；${plan.models.map(model=>model.split(':').at(-1).toUpperCase()).join('→')}，各一次，共${plan.totalCalls}条正式调用。预热单独保存。`,
   '前三列领域/API/原始参数与最终执行语义分开；失败仍计入已完成调用分母，未完成不算0分。running时百分比只指部分结果。',
   '既有100条开发用例与新900条固定表达分列；新用例推理前冻结，不据模型输出修改金标、提示词或规则；仍非独立人类盲测或生产成功率。',
   '整体执行语义包含正确澄清/解析失败，不能当作服务执行成功率。readyRequestSemantics只统计期望可执行的请求；自然表达被现有合同拒绝的已知边界在corpus.contractBoundaries单列，不宣称支持该表达。',
   '手机位置、时钟、网络句柄和音频上下文均为明确标记的固定实验fixture；不读取电脑位置或Harmony真机，业务API仅mock。',
   'API正确率要求输出契约有效；parsedApi另记录可解析raw中的选择，不能把结构失败全部归为API意图错误。',
   '参数差异只对领域/API已对的剩余失败计数；一个调用可有多处差异，差异数不可相加成失败数。原始参数不匹配但最终通过含规则修复及时间语义等价，不等于模型原始提取变好。']};
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
