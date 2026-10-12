import {randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SerialQueue} from './runtime.mjs';
import {scoreCase,summarize} from './evaluation.mjs';
import {buildDomainReport} from './domain-report.mjs';
import {GROUNDING_VERSION} from './grounding.mjs';
import {scoreExecutionSemantics} from './semantic-evaluation.mjs';
import {getCapability,validateArguments} from './registry.mjs';
import {resolveBenchmarkSelection,assertBenchmarkOwnership} from './benchmark-selection.mjs';
import {SINGLE_SERVICE_100_MODELS} from './single-service-100.mjs';

const recommended=['qwen2.5:0.5b','qwen2.5:1.5b','qwen2.5:3b','qwen2.5:7b'];
// Public HTTP inputs may supply experimental fixtures, never native-host provenance.
// Use the same field definitions as the resolver instead of a second type/enum list.
const fixtureSystemFields=new Map([
 ['net_id','connectivity.network.capabilities'],
 ['stream_type','media.volume.level']
]);
function bad(message,status=400) { const error=new Error(message);error.statusCode=status;return error; }
function checkBenchmarkView(url,currentId){
 const expected=url.searchParams.get('manifestId');
 if(expected&&currentId&&expected!==currentId)throw bad('当前展示批次已切换，请刷新本轮报告再查看记录。',409);
}
function json(res,value,status=200) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req) {
 let data='';for await(const chunk of req) {data+=chunk;if(Buffer.byteLength(data)>131072) throw bad('请求过大',413);}
 try{return JSON.parse(data||'{}');}catch{throw bad('请求必须为有效 JSON');}
}
function parameterB(label) {
 const match=String(label??'').match(/([\d.]+)\s*([BM])/i);
 return match?Number(match[1])/(match[2].toUpperCase()==='M'?1000:1):null;
}
function csv(rows) {
 if(!rows.length)return '\ufeffid,status\r\n';
 const keys=[...new Set(rows.flatMap(Object.keys))];
 const cell=value=>{let text=String(typeof value==='object'?JSON.stringify(value):value??'');if(/^[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
 return '\ufeff'+[keys.map(cell).join(','),...rows.map(row=>keys.map(key=>cell(row[key])).join(','))].join('\r\n');
}
export function createApplication({store,runPipeline,providers,systemContextProvider,catalog,docs,cases,baseContext,contextDefaults={},publicDirectory,groundingReportPath,singleService100ReportPath,singleService100StatePath,singleService100EvidenceDirectory,singleService100ActivePath,singleService100Root,ollamaUrl='http://127.0.0.1:11434',fetchImpl=fetch}) {
 const inferenceQueue=new SerialQueue(), controllers=new Map(),liveJobs=new Map();
 let healthCache=null,healthAt=0;
 const selectedBenchmark=()=>resolveBenchmarkSelection({root:singleService100Root,activePath:singleService100ActivePath,legacy:{statePath:singleService100StatePath,reportPath:singleService100ReportPath,evidenceDirectory:singleService100EvidenceDirectory}});
 async function benchmarkState(){
  const selection=await selectedBenchmark();if(!selection.statePath)return null;
  try{const state=selection.manifest??JSON.parse(await readFile(selection.statePath,'utf8'));const updated=Date.parse(state.updatedAt),age=Date.now()-updated;
   if(state.status!=='running'||!Number.isFinite(updated)||age<0||age>300000)return null;
   if(!Number.isInteger(state.runner?.pid)||state.runner.pid<1)return null;
   try{process.kill(state.runner.pid,0);}catch{return null;}
   return {id:state.id,status:state.status,progress:state.progress,active:state.active};
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
 }
 async function health(force=false) {
  if(!force&&healthCache&&Date.now()-healthAt<5000)return {...healthCache,lab:{id:'edge-api-lab',catalogVersion:catalog.version,exclusiveBenchmark:await benchmarkState()},queueDepth:inferenceQueue.pending,activeJobs:controllers.size};
  try {
   const [tags,version]=await Promise.all([fetchImpl(`${ollamaUrl}/api/tags`,{signal:AbortSignal.timeout(4000)}),fetchImpl(`${ollamaUrl}/api/version`,{signal:AbortSignal.timeout(4000)})]);
   if(!tags.ok)throw new Error('Ollama 模型列表读取失败');
   const list=await tags.json(),info=version.ok?await version.json():{};
   const models=(list.models??[]).map(item=>{const count=parameterB(item.details?.parameter_size);return {name:item.name,digest:item.digest,parameterSize:item.details?.parameter_size,parameterB:count,quantization:item.details?.quantization_level,size:item.size,eligible:count!==null&&count<10,recommended:recommended.includes(item.name)};});
   healthCache={ollama:{ok:true,url:ollamaUrl,version:info.version},models,recommendedModels:recommended.filter(name=>models.some(m=>m.name===name&&m.eligible)),jev:{configured:Boolean(process.env.JEV_URL)}};
  }catch(error){healthCache={ollama:{ok:false,url:ollamaUrl,error:error.message},models:[],recommendedModels:[],jev:{configured:Boolean(process.env.JEV_URL)}};}
  healthAt=Date.now();return {...healthCache,lab:{id:'edge-api-lab',catalogVersion:catalog.version,exclusiveBenchmark:await benchmarkState()},queueDepth:inferenceQueue.pending,activeJobs:controllers.size};
 }
 async function validateInput(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw bad('请求必须是对象');
  if(typeof input.text!=='string'||!input.text.trim()||input.text.length>4000)throw bad('请输入 1 至 4000 字的提示词');
  if(input.mode&&!['staged','unified'].includes(input.mode))throw bad('未知调用模式');
  const options=input.options??{};
  if(options.num_ctx!==undefined&&(!Number.isInteger(options.num_ctx)||options.num_ctx<512||options.num_ctx>8192))throw bad('上下文窗口 num_ctx 必须为 512 至 8192');
  if(options.num_predict!==undefined&&(!Number.isInteger(options.num_predict)||options.num_predict<16||options.num_predict>1024))throw bad('输出上限 num_predict 必须为 16 至 1024');
  if(options.temperature!==undefined&&options.temperature!==0)throw bad('本实验固定 temperature=0，避免隐式改变对照条件');
  const state=await health();if(!state.ollama.ok)throw bad(state.ollama.error,503);
  if(state.lab.exclusiveBenchmark)throw bad('千题单服务对照正在独占串行推理；请在“千题单服务实测”查看进度，完成后再发起其他调用。',409);
  const requested=[input.model,...Object.values(input.stages??{}).filter(stage=>(stage.provider??'ollama')==='ollama').map(stage=>stage.model).filter(Boolean)];
  for(const name of requested) {const model=state.models.find(m=>m.name===name);if(!model)throw bad(`模型未安装：${name??'未选择'}`);if(!model.eligible)throw bad(`仅允许参数量小于 10B 且规格可识别的本地模型：${name}`);}
  for(const stage of Object.values(input.stages??{}))if(!['ollama','jev'].includes(stage.provider??'ollama'))throw bad('未知模型提供方');
  if(input.context?.now&&!Number.isFinite(Date.parse(input.context.now)))throw bad('系统时间无效');
  if(input.context?.timezone)try{new Intl.DateTimeFormat('zh',{timeZone:input.context.timezone});}catch{throw bad('时区无效');}
  const location=input.context?.location;if(location!==undefined&&location!==null&&(typeof location!=='object'||Array.isArray(location)||!Number.isFinite(location.latitude)||Math.abs(location.latitude)>90||!Number.isFinite(location.longitude)||Math.abs(location.longitude)>180||location.source!=='fixture'))throw bad('HTTP 位置仅允许有效经纬度的模拟手机位置 fixture；不读取电脑浏览器位置，harmony 只能由内部手机系统桥提供');
  if(location?.accuracyMeters!==undefined&&(!Number.isFinite(location.accuracyMeters)||location.accuracyMeters<0))throw bad('位置精度必须为非负米数');
  const context=input.context??{};
  if(context.systemValues!==undefined){
   if(!context.systemValues||typeof context.systemValues!=='object'||Array.isArray(context.systemValues))throw bad('系统参数夹具必须为对象表');
   for(const [key,entry]of Object.entries(context.systemValues)){
    if(!fixtureSystemFields.has(key)||!entry||typeof entry!=='object'||Array.isArray(entry)||entry.source!=='fixture')throw bad('HTTP 系统参数仅允许已知字段的 fixture 来源；harmony 只能由内部系统桥提供');
    const validation=validateArguments(getCapability(fixtureSystemFields.get(key)),{[key]:entry.value});
    if(!validation.valid)throw bad(`系统参数夹具 ${key} 类型无效：${validation.issues.join('；')}`);
   }
  }
  if(context.weatherRegion!==undefined&&!['CN','outside_CN'].includes(context.weatherRegion))throw bad('天气区划须为 CN 或 outside_CN 实验策略');
  const objectKeys=['event_id','contact_id','file_id','material_id','service','url','calendar_id','cloud_path','record_id','zone','resource'];
  if(context.objects!==undefined){
   if(!context.objects||typeof context.objects!=='object'||Array.isArray(context.objects))throw bad('当前对象必须是用户选择的对象表');
   for(const [key,entry]of Object.entries(context.objects))if(!objectKeys.includes(key)||!entry||entry.trusted!==true||entry.source!=='user_selection'||typeof entry.value!=='string'||!entry.value.trim()||entry.value.length>2000)throw bad('当前对象须标记为 user_selection，且提供有效 value');
  }
  if(context.weatherAvailability!==undefined){
   if(!context.weatherAvailability||typeof context.weatherAvailability!=='object'||Array.isArray(context.weatherAvailability))throw bad('天气数据可用性必须为对象');
   for(const [key,value]of Object.entries(context.weatherAvailability))if(!['current','hourly','daily','minute','alerts','indices','tides','city'].includes(key)||typeof value!=='boolean')throw bad('天气数据可用性须为已知数据集的布尔值');
  }
  if(context.geocodes!==undefined){
   if(!context.geocodes||typeof context.geocodes!=='object'||Array.isArray(context.geocodes))throw bad('地理编码夹具必须为对象表');
   for(const [key,entry]of Object.entries(context.geocodes))if(key.length>80||!entry||entry.source!=='fixture'||!Number.isFinite(entry.latitude)||Math.abs(entry.latitude)>90||!Number.isFinite(entry.longitude)||Math.abs(entry.longitude)>180)throw bad('地理编码须为有效坐标并明确标记 fixture');
  }
  if(context.resolutionPolicy?.allowApproximation!==undefined&&typeof context.resolutionPolicy.allowApproximation!=='boolean')throw bad('允许降级选项必须为布尔值');
  return {...input,mode:input.mode??'staged',text:input.text.trim()};
 }
 async function execute(input,signal,{save=true,warmup=false}={}) {
  const requestStart=performance.now(),traces=[];
  // A connected native host owns environmental time; PC defaults must not suppress its reads.
  const clockContext=systemContextProvider?{now:null,timezone:null}:{now:new Date().toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone};
  const context={...structuredClone(contextDefaults),...clockContext,...input.context};
  if(input.context?.weatherAvailability!==undefined)context.weatherAvailabilitySource='provided_experiment';
  let result,queueWaitMs=0;
  try {
   result=await inferenceQueue.run(async()=>{
    // Recheck at actual invocation, not only HTTP validation: an accepted request
    // may have waited in the queue while the exclusive CLI runner acquired it.
    if(await benchmarkState())throw bad('千题单服务对照正在独占串行推理；该调用未发给模型。',409);
    queueWaitMs=performance.now()-requestStart;
    try {return {...await runPipeline({...input,context},{providers,systemContextProvider,signal,onTrace:trace=>traces.push(trace)}),queueWaitMs};}
    catch(error) {
     if(signal?.aborted)throw error;
     if(error.trace&&!traces.includes(error.trace))traces.push(error.trace);
     return {text:input.text,model:input.model,mode:input.mode,context,status:'error',error:error.message,traces,totalMs:performance.now()-requestStart-queueWaitMs,queueWaitMs};
    }
   },signal);
  }catch(error){
   if(!signal?.aborted)throw error;
   if(error.trace&&!traces.includes(error.trace))traces.push(error.trace);
   result={...error.partialRun,text:input.text,model:input.model,mode:input.mode,context,status:'cancelled',error:error.message,traces,totalMs:performance.now()-requestStart-queueWaitMs,queueWaitMs};
  }
  result={...result,options:structuredClone(input.options??{}),stages:structuredClone(input.stages??{}),environment:{node:process.version,ollama:healthCache?.ollama?.version,models:healthCache?.models?.filter(model=>[input.model,...Object.values(input.stages??{}).map(stage=>stage.model)].includes(model.name))},id:randomUUID(),createdAt:new Date().toISOString(),requestTotalMs:performance.now()-requestStart,warmup};
  result.catalogVersion=catalog.version??'legacy-v1';
  if(save)await store.save('run',result);return result;
 }
 const runView=run=>({...run,catalogVersion:run.catalogVersion??'legacy-v1'});
 function jobView(job) {
  const results=job.results??[];
  const summary=summarize(results).map(row=>{
   const records=results.filter(item=>item.model===row.model),scored=records.filter(item=>typeof item.executionScore?.plan==='boolean');
   return {...row,executionAccuracy:scored.length===records.length&&scored.length?scored.filter(item=>item.executionScore.plan).length/scored.length:null,executionScored:scored.length};
  });
  return {...job,catalogVersion:job.catalogVersion??results[0]?.run?.catalogVersion??'legacy-v1',summary};
 }
 async function performJob(job,controller) {
  const signal=controller.signal;
  try {
   if(signal.aborted)return;
   job.status='running';await store.save('eval',jobView(job));
   const selected=cases.filter(item=>job.caseIds.includes(item.id));
   for(const model of job.models) {
    if(job.warmup) {
     signal.throwIfAborted();
     const run=await execute({text:'上海今天的天气怎么样',model,mode:job.mode,stages:job.stages,context:baseContext,options:job.options},signal,{save:false,warmup:true});
     job.warmups.push(run);await store.save('eval',jobView(job));
    }
    for(let repeatIndex=0;repeatIndex<job.repeats;repeatIndex++)for(const item of selected) {
     signal.throwIfAborted();
     const run=await execute({text:item.text,model,mode:job.mode,stages:job.stages,context:{...baseContext,...item.context},options:job.options},signal);
     if(signal.aborted){job.cancelledRun=run;break;}
     job.results.push({caseId:item.id,text:item.text,category:item.category,suite:item.suite,testDomain:item.testDomain,scenario:item.scenario,note:item.note,model,repeatIndex,expected:item.expected,actual:{domain:run.domain,api:run.api,arguments:run.extractedArguments,status:run.status},score:scoreCase(item.expected,run),executionScore:scoreExecutionSemantics(item.expected,run,run.context),run});
     job.progress.done++;await store.save('eval',jobView(job));
    }
   }
   if(!signal.aborted){job.status='completed';job.completedAt=new Date().toISOString();}
  }catch(error){if(signal.aborted){job.status='cancelled';}else{job.status='failed';job.error=error.message;}}
  finally {await store.save('eval',jobView(job));controllers.delete(job.id);liveJobs.delete(job.id);}
 }
 return async(req,res)=>{
  try {
   const url=new URL(req.url,'http://localhost'),path=url.pathname;
   if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)throw bad('外部网页不能操作本地实验接口',403);
   if(path==='/api/health'&&req.method==='GET')return json(res,await health(true));
   if(path==='/api/catalog')return json(res,catalog);
   if(path==='/api/docs')return json(res,{sections:docs});
   if(path==='/api/single-service-100-report'&&req.method==='GET'){
    const selection=await selectedBenchmark();
    const conditions=selection.manifest?.conditions??(singleService100ActivePath?{models:SINGLE_SERVICE_100_MODELS,totalCalls:1000*SINGLE_SERVICE_100_MODELS.length}:null);
    const pending={status:selection.manifest?.status??'not_started',progress:selection.manifest?.progress??{done:0,total:conditions?.totalCalls??3000},summary:[],cells:[],examples:[],...(conditions?{conditions}:{}),...(selection.manifest?{id:selection.id,corpus:selection.manifest.corpus,notes:['当前批次报告尚在生成，统计指标暂不显示。']}: {})};
    if(!selection.reportPath)return json(res,pending);
    try{const report=JSON.parse(await readFile(selection.reportPath,'utf8'));assertBenchmarkOwnership(selection,report);return json(res,report);}catch(error){if(error.code!=='ENOENT')throw error;return json(res,pending);}
   }
   if(path==='/api/single-service-100-results'&&req.method==='GET'){
    const selection=await selectedBenchmark();if(!selection.evidenceDirectory)return json(res,{rows:[]});
    if(selection.active)checkBenchmarkView(url,selection.id);
    let index;try{index=JSON.parse(await readFile(resolve(selection.evidenceDirectory,'index.json'),'utf8'));assertBenchmarkOwnership(selection,index,{kind:'index'});}catch(error){if(error.code!=='ENOENT')throw error;return json(res,{rows:[]});}
    checkBenchmarkView(url,index.manifestId);
    const model=url.searchParams.get('model'),domain=url.searchParams.get('domain'),failed=url.searchParams.get('failed')==='true';
    return json(res,{...index,rows:index.rows.filter(r=>(!model||r.model===model)&&(!domain||r.testDomain===domain)&&(!failed||r.primary!=='correct'))});
   }
   if(path.startsWith('/api/single-service-100-run/')&&req.method==='GET'){
    const parts=path.split('/');const model=parts[3],caseId=parts[4];
    const selection=await selectedBenchmark(),modelName=selection.models.find(name=>name.replace(':','-')===model);
    if(selection.active)checkBenchmarkView(url,selection.id);
    if(!selection.evidenceDirectory||parts.length!==5||!modelName||!/^e100-(weather|calendar|contacts|files|services|cloud|device|connectivity|location|media)-\d{3}$/.test(caseId))throw bad('未知千题评测记录',404);
    try{const record=JSON.parse(await readFile(resolve(selection.evidenceDirectory,model,`${caseId}.json`),'utf8'));assertBenchmarkOwnership(selection,record,{kind:'record',model:modelName,caseId});checkBenchmarkView(url,record.manifestId);return json(res,record);}catch(error){if(error.code!=='ENOENT')throw error;throw bad('该调用尚未完成或记录不存在',404);}
   }
   if(path==='/api/cases')return json(res,{cases,context:baseContext});
   if(path==='/api/domain-report') {
    let manifest={};
    try{manifest=JSON.parse(await readFile(resolve(store.directory,'domain-suite.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    return json(res,buildDomainReport(manifest,cases,store.evaluations));
   }
   if(path==='/api/grounding-report'&&req.method==='GET'){
    const file=groundingReportPath??(publicDirectory?resolve(publicDirectory,'../docs/grounding-replay.json'):null);
    let report;try{report=file?JSON.parse(await readFile(file,'utf8')):null;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!report)return json(res,{version:GROUNDING_VERSION,status:'not_started',progress:{done:0,total:1200},cells:[],examples:[],notes:['尚未生成独立规则回放报告。']});
    let manifest;try{manifest=JSON.parse(await readFile(resolve(store.directory,'domain-suite.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(manifest?.id!==report.manifestId)return json(res,{...report,status:'stale',cells:[],examples:[],metrics:null,notes:[...(report.notes??[]),'该回放与当前领域评估批次不匹配，历史指标暂不呈现；请为当前批次重新生成回放。']});
    const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
    for(const [name,hash]of Object.entries(report.conditions?.replaySourceHashes??{})){
     const source=resolve(root,name);
     if(!source.startsWith(root+sep)||createHash('sha256').update(await readFile(source)).digest('hex')!==hash)return json(res,{...report,status:'stale',cells:[],examples:[],metrics:null,notes:[...(report.notes??[]),'当前规则代码与回放快照不一致，历史指标暂不呈现；请重新生成规则回放。']});
    }
    return json(res,report);
   }
   if(path==='/api/runs'&&req.method==='POST') {
    const input=await validateInput(await body(req)),controller=new AbortController();
    const onClose=()=>{if(!res.writableEnded)controller.abort(new Error('请求已断开'));};res.on('close',onClose);
    try{return json(res,await execute(input,controller.signal));}finally{res.off('close',onClose);}
   }
   if(path==='/api/runs')return json(res,{runs:store.runs.map(runView)});
   if(path.startsWith('/api/runs/')){const run=store.runs.find(row=>row.id===path.split('/')[3]);if(!run)throw bad('记录不存在',404);return json(res,runView(run));}
   if(path==='/api/evaluations'&&req.method==='POST') {
    if(controllers.size)throw bad('已有评测正在运行，请完成或取消后再开始',409);
    const input=await body(req);
    if(!Array.isArray(input.models)||!input.models.length||input.models.length>8)throw bad('请选择 1 至 8 个已安装模型');
    for(const model of input.models)await validateInput({...input,text:'检查模型',model});
    const repeats=input.repeats??1;if(!Number.isInteger(repeats)||repeats<1||repeats>3)throw bad('重复次数为 1 至 3');
    const limit=input.limit??cases.length;if(!Number.isInteger(limit)||limit<1||limit>cases.length)throw bad(`样本数为 1 至 ${cases.length}`);
    const selected=(input.caseIds?cases.filter(row=>input.caseIds.includes(row.id)):cases).slice(0,limit);if(!selected.length)throw bad('没有可运行的样本');
    const job={id:randomUUID(),createdAt:new Date().toISOString(),catalogVersion:catalog.version??'legacy-v1',ruleVersion:GROUNDING_VERSION,status:'queued',models:[...new Set(input.models)],mode:input.mode??'staged',stages:input.stages,options:input.options,warmup:Boolean(input.warmup),repeats,caseIds:selected.map(c=>c.id),context:baseContext,progress:{done:0,total:selected.length*new Set(input.models).size*repeats},results:[],warmups:[]};
    if(controllers.size)throw bad('已有评测正在运行，请完成或取消后再开始',409);
    const controller=new AbortController();controllers.set(job.id,controller);liveJobs.set(job.id,job);await store.save('eval',jobView(job));
    json(res,jobView(job),202);setImmediate(()=>performJob(job,controller));return;
   }
   if(path==='/api/evaluations')return json(res,{evaluations:store.evaluations.map(jobView).map(job=>{if(url.searchParams.get('view')!=='summary')return job;const {results,warmups,cancelledRun,...compact}=job;return compact;})});
   if(path.startsWith('/api/evaluations/')) {
    const id=path.split('/')[3],job=liveJobs.get(id)??store.evaluations.find(row=>row.id===id);if(!job)throw bad('评测不存在',404);
    if(path.endsWith('/cancel')&&req.method==='POST') {
     const controller=controllers.get(id);if(controller){job.status='cancelled';controller.abort(new Error('用户取消评测'));await store.save('eval',jobView(job));}
    }
    return json(res,jobView(job));
   }
   if(path==='/api/export') {
    const type=url.searchParams.get('type'),format=url.searchParams.get('format');
    const records=type==='evaluations'?store.evaluations.map(jobView):store.runs.map(runView);
    const rows=type==='evaluations'?records.flatMap(job=>job.results.map(row=>({jobId:job.id,model:row.model,caseId:row.caseId,text:row.text,status:row.run.status,...row.score,executionPlan:row.executionScore?.plan,executionArguments:row.executionScore?.arguments,ruleVersion:row.run.ruleVersion??(row.executionScore?job.ruleVersion:undefined),totalMs:row.run.totalMs}))):records.map(row=>({id:row.id,createdAt:row.createdAt,model:row.model,mode:row.mode,text:row.text,domain:row.domain,api:row.api,status:row.status,totalMs:row.totalMs,deterministicMs:row.deterministicMs,ruleVersion:row.ruleVersion,queueWaitMs:row.queueWaitMs,traces:row.traces}));
    res.writeHead(200,{'Content-Type':format==='csv'?'text/csv; charset=utf-8':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="edge-api-${type??'runs'}.${format==='csv'?'csv':'json'}"`});res.end(format==='csv'?csv(rows):JSON.stringify(records,null,2));return;
   }
   if(path.startsWith('/api/'))throw bad('接口不存在',404);
   if(!publicDirectory)throw bad('页面尚未准备',404);
   const file=resolve(publicDirectory,`.${decodeURIComponent(path==='/'?'/index.html':path)}`);
   if(!file.startsWith(resolve(publicDirectory)+sep))throw bad('路径无效',403);
   let content;try{content=await readFile(file);}catch{throw bad('文件不存在',404);}
   const type={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml'}[extname(file)]??'application/octet-stream';
   res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'"});res.end(content);
  }catch(error){if(!res.headersSent)json(res,{error:error.message},error.statusCode??500);else res.end();}
 };
}
