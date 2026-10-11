import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cpus,totalmem,platform} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createProviders} from '../src/providers.mjs';
import {buildUnifiedPrompt,PROMPT_VERSION} from '../src/prompts.mjs';
import {GROUNDING_VERSION,finalizePlan} from '../src/grounding.mjs';
import {loadCases} from '../src/corpus.mjs';
import {scoreCase} from '../src/evaluation.mjs';
import {scoreExecutionSemantics} from '../src/semantic-evaluation.mjs';
import {experimentDefaults,evaluationSystemDefaults} from '../src/fixtures.mjs';
import {domains,capabilities} from '../src/registry.mjs';
import {buildGroundingReplay,saveReplaySourceSnapshot} from './replay-grounding.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const models=['qwen2.5:0.5b','qwen2.5:1.5b','qwen2.5:3b','qwen2.5:7b'];
const sourcePaths=['src/registry.mjs','src/weather-capabilities.mjs','src/extended-capabilities.mjs','src/system-capabilities.mjs','src/prompts.mjs','src/providers.mjs','src/pipeline.mjs','src/resolver.mjs','src/grounding.mjs','src/system-context.mjs','src/fixtures.mjs','src/evaluation.mjs','src/semantic-evaluation.mjs','src/corpus.mjs','data/single-service-core.mjs','data/cases-system-single.json','scripts/verify-feasibility.mjs','data/benchmark-sparse-v6/src/prompts.mjs','data/benchmark-grounding-v1-final/src/grounding.mjs','data/benchmark-grounding-v1-final/src/resolver.mjs'];
sourcePaths.push('scripts/replay-grounding.mjs','src/application.mjs');
const hashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,createHash('sha256').update(await readFile(join(root,path))).digest('hex')])));
const save=async(path,value)=>{await mkdir(dirname(path),{recursive:true});await writeFile(`${path}.tmp`,JSON.stringify(value,null,2)+'\n');await rename(`${path}.tmp`,path);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const nulls=value=>Array.isArray(value)?value.map(nulls):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,child])=>child!==null).map(([key,child])=>[key,nulls(child)])):value;
const percent=(rows,key)=>({correct:rows.filter(row=>row[key]).length,total:rows.length,accuracy:rows.length?rows.filter(row=>row[key]).length/rows.length:null});
const sourceURL=path=>pathToFileURL(join(root,path)).href;
// Import frozen baseline modules without altering their archived bytes. Registry is shared deliberately.
const baselineImport=async(path,overrides={})=>{
  let source=await readFile(join(root,path),'utf8');
  for(const name of ['registry','providers','resolver']) source=source.replaceAll(`'./${name}.mjs'`,JSON.stringify(overrides[name]??sourceURL(`src/${name}.mjs`)));
  const url=`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return {module:await import(url),url};
};
async function replay(sourceHashes){
  const manifest=JSON.parse(await readFile(join(root,'data/runtime/domain-suite.json'),'utf8'));
  const jobs=await Promise.all(manifest.entries.map(e=>readFile(join(root,`data/runtime/eval-${e.jobId}.json`),'utf8').then(JSON.parse)));
  const previous=JSON.parse(await readFile(join(root,'docs/grounding-replay-audit.json'),'utf8'));
  const evidencePaths=['data/runtime/domain-suite.json','docs/grounding-replay-audit.json',...manifest.entries.map(e=>`data/runtime/eval-${e.jobId}.json`)];
  const evidenceHashes=Object.fromEntries(await Promise.all(evidencePaths.map(async path=>[path,createHash('sha256').update(await readFile(join(root,path))).digest('hex')])));
  const map=new Map(previous.rows.map(row=>[`${row.jobId}/${row.caseId}`,row]));
  const {report,rows}=await buildGroundingReplay({manifest,jobs,finalize:finalizePlan});
  report.version=GROUNDING_VERSION;
  report.auditPath='evidence/grounding-replay-v2-audit.json';
  const previousScores=rows.map(row=>({previous:map.get(`${row.jobId}/${row.caseId}`)?.newSemantic?.plan,current:row.newSemantic.plan}));
  if(previousScores.some(row=>typeof row.previous!=='boolean'))throw new Error('Previous replay comparison incomplete');
  report.comparisonAgainstV1={previous:percent(previousScores,'previous'),current:percent(previousScores,'current'),improved:previousScores.filter(r=>!r.previous&&r.current).length,regressed:previousScores.filter(r=>r.previous&&!r.current).length};
  const single=rows.filter(row=>row.expected.api&&row.expected.domain!=='unsupported');
  report.singleSupported={scope:'历史受支持单API请求；非新增100题',total:single.length,current:percent(single.map(r=>({plan:r.newSemantic.plan})),'plan')};
  report.conditions.replaySourceHashes=sourceHashes;
  report.conditions.frozenEvidenceHashes=evidenceHashes;
  report.conditions.replaySnapshotDirectory='data/benchmark-single-service-v3';
  await save(join(root,report.auditPath),{version:report.version,manifestId:report.manifestId,rows});
  await save(join(root,'docs/grounding-replay-v2.json'),report);
  console.log(JSON.stringify({kind:'replay',metrics:report.metrics,comparison:report.comparisonAgainstV1,single:report.singleSupported}));
}
function summary(rows){
  return models.flatMap(model=>['explicit-v7','sparse-v6-shared-catalog'].map(variant=>{
    const list=rows.filter(row=>row.model===model&&row.variant===variant);
    if(!list.length)return null;
    const yes=key=>({correct:list.filter(row=>key(row)).length,total:list.length,accuracy:list.filter(row=>key(row)).length/list.length});
    const durations=list.map(r=>r.trace?.wallMs).filter(Number.isFinite).sort((a,b)=>a-b);
    const q=p=>durations.length?durations[Math.round((durations.length-1)*p)]:null;
    return {model,variant,total:list.length,domain:yes(r=>r.rawScore.domain),api:yes(r=>r.rawScore.api),rawArguments:yes(r=>r.rawScore.arguments),v1Semantics:yes(r=>r.v1Score.plan),v2Semantics:yes(r=>r.v2Score.plan),candidateRecall:yes(r=>r.candidates.some(c=>c.id===r.expected.api)),errors:list.filter(r=>r.error).length,v1Errors:list.filter(r=>r.v1Error).length,v2Errors:list.filter(r=>r.v2Error).length,p50Ms:q(.5),p95Ms:q(.95),maxInputTokens:Math.max(...list.map(r=>r.trace?.inputTokens??0))};
  })).filter(Boolean);
}
async function live(sourceHashes){
  const file=join(root,'evidence/feasibility-live-audit.json');
  const all=(await loadCases(root)).filter(c=>c.suite==='single-service-v1');
  const chosen=[];
  for(const d of domains){
    const group=all.filter(c=>c.testDomain===d.id);
    const indexes=d.id==='media'?[0,1,5,9]:d.id==='location'?[0,6,8,9]:d.id==='connectivity'?[0,1,3,9]:[0,1,6,9];
    for(const index of indexes)chosen.push(group[index]);
  }
  const paired=all.filter(c=>domains.slice(0,6).some(d=>d.id===c.testDomain)&&['01','07'].includes(c.id.slice(-2)));
  const guards=[
    {id:'guard-mohe',testDomain:'weather',text:'漠河现在气温是多少',expected:{domain:'weather',api:'weather.current.temperature',arguments:{location:'漠河',time_ref:'现在'},status:'resolution_failed'}},
    {id:'guard-paris',testDomain:'weather',text:'查巴黎现在的紫外线指数',expected:{domain:'weather',api:'weather.current.uvIndex',arguments:{location:'巴黎',time_ref:'现在'},status:'resolution_failed'}},
    {id:'guard-music',testDomain:'media',text:'音乐现在的音量是多少',expected:{domain:'media',api:'media.volume.level',arguments:{stream_type:'MUSIC'},status:'ready_mock'}},
    {id:'guard-coordinate',testDomain:'location',text:'坐标（31.2304,121.4737）对应哪个地址',expected:{domain:'location',api:'location.reverse_geocode',arguments:{coordinates:{latitude:31.2304,longitude:121.4737}},status:'ready_mock'}}
  ];
  if(chosen.length!==40||paired.length!==12)throw new Error('Sampling definition drift');
  const tags=await fetch('http://127.0.0.1:11434/api/tags').then(r=>r.json());
  if(models.some(model=>!tags.models.some(item=>item.name===model)))throw new Error('Required models missing');
  const context={...experimentDefaults,...evaluationSystemDefaults,now:'2026-10-10T08:00:00+08:00',timezone:'Asia/Shanghai',location:{latitude:31.2304,longitude:121.4737,source:'fixture'}};
const conditions={sourceHashes,catalog:'single-service-v3',domains:domains.length,apiCount:capabilities.length,promptVersion:PROMPT_VERSION,groundingVersion:GROUNDING_VERSION,modelDetails:tags.models.filter(m=>models.includes(m.name)),hardware:{cpu:cpus()[0]?.model,logicalCores:cpus().length,totalMemoryBytes:totalmem(),platform:platform()},options:{num_ctx:2048,num_predict:224,timeoutMs:180000},context,modelDirectory:'D:/OllamaModels',sampling:{currentCaseIds:chosen.map(c=>c.id),pairedCaseIds:paired.map(c=>c.id),guards},scope:'开发集单服务验证，非盲测；API全部模拟；不评价组合服务',abControl:'旧sparse-v6与explicit-v7共享当前417API目录，原文/上下文/模型digest/参数完全相同；A/B同时包括候选检索与提示词工程，不是纯措辞对照',groundingControl:'相同原始模型输出分别进入冻结v1与当前v2；v1 resolver为冻结文件，目录共享当前版本'};
  let audit={id:'single-service-v3-live-2026-10-11',createdAt:new Date().toISOString(),conditions,warmups:[],rows:[],status:'running'};
  try{const prior=JSON.parse(await readFile(file,'utf8'));if(!same(prior.conditions.sourceHashes,sourceHashes)||!same(prior.conditions.sampling,conditions.sampling)||!same(prior.conditions.modelDetails.map(m=>m.digest),conditions.modelDetails.map(m=>m.digest)))throw new Error('Evidence already exists with different code/models; refusing overwrite');audit=prior;}catch(error){if(error.code!=='ENOENT')throw error;}
  const oldPrompt=(await baselineImport('data/benchmark-sparse-v6/src/prompts.mjs')).module;
  const oldResolver=await baselineImport('data/benchmark-grounding-v1-final/src/resolver.mjs');
  const oldGround=(await baselineImport('data/benchmark-grounding-v1-final/src/grounding.mjs',{resolver:oldResolver.url})).module;
  const provider=createProviders().ollama;
  const keys=new Set(audit.rows.map(r=>`${r.model}/${r.variant}/${r.caseId}`));
  const tasks=[];
  for(const model of models){
    for(const c of chosen){tasks.push({model,c,variant:'explicit-v7'});if(paired.some(p=>p.id===c.id))tasks.push({model,c,variant:'sparse-v6-shared-catalog'});}
    for(const c of guards)tasks.push({model,c,variant:'explicit-v7-guards'});
  }
  let warmed='';
  for(const task of tasks){
    const {model,c,variant}=task,key=`${model}/${variant}/${c.id}`;
    if(keys.has(key))continue;
    if(warmed!==model){
      // Explicitly unload the previous model: this 8 GB machine must not keep 7B plus smaller models resident.
      for(const name of models)await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:name,keep_alive:0})});
      try{const response=await provider.invoke({stage:'unified',model,...buildUnifiedPrompt('手机还剩多少电',context),options:conditions.options});audit.warmups.push({model,excludedFromScores:true,trace:response.trace});}catch(error){audit.warmups.push({model,excludedFromScores:true,error:error.message,trace:error.trace});}
      warmed=model;
    }
    const ctx={...context,...c.context};
    const prompt=(variant.startsWith('explicit-v7')?buildUnifiedPrompt:oldPrompt.buildUnifiedPrompt)(c.text,ctx);
    const record={model,variant,caseId:c.id,testDomain:c.testDomain,text:c.text,expected:c.expected,context:ctx,candidates:prompt.promptMeta.candidates.scores};
    let raw;
    try{
      const response=await provider.invoke({stage:'unified',model,...prompt,options:conditions.options});record.trace=response.trace;
      raw={domain:response.value.domain,api:response.value.api==='unsupported'?null:response.value.api,extractedArguments:nulls(response.value.arguments)};
    }catch(error){record.error=error.message;record.trace=error.trace;raw={domain:null,api:null,extractedArguments:{}};}
    for(const [name,finalize] of [['v1',oldGround.finalizePlan],['v2',finalizePlan]]){
      if(record.error){record[`${name}Run`]={...raw,status:'error',error:record.error};continue;}
      try{record[`${name}Run`]=finalize({text:c.text,...raw,context:ctx});}
      catch(error){record[`${name}Error`]=error.message;record[`${name}Run`]={...raw,status:'error',error:error.message};}
    }
    record.raw=raw;
    // Routing/extraction measures are independent of downstream rule exceptions.
    record.rawScore=scoreCase(c.expected,{...raw,status:record.error?'error':'parsed'});
    record.v1Score=scoreExecutionSemantics(c.expected,record.v1Run,ctx);
    record.v2Score=scoreExecutionSemantics(c.expected,record.v2Run,ctx);
    audit.rows.push(record);keys.add(key);
    await save(file,audit);
    console.log(JSON.stringify({done:audit.rows.length,total:tasks.length,model,variant,caseId:c.id,api:raw.api,rawArguments:record.rawScore.arguments,v1:record.v1Score.plan,v2:record.v2Score.plan,error:record.error??null,inputTokens:record.trace?.inputTokens}));
  }
  if(!same(sourceHashes,await hashes()))throw new Error('Source changed during live calls; cannot certify mixed-version results');
  audit.status='completed';audit.completedAt=new Date().toISOString();await save(file,audit);
  const pairedRows=audit.rows.filter(r=>paired.some(c=>c.id===r.caseId));
  const report={id:audit.id,status:audit.status,generatedAt:audit.completedAt,conditions: audit.conditions,total:audit.rows.length,warmupCount:audit.warmups.length,current:summary(audit.rows.filter(r=>r.variant==='explicit-v7')),paired:summary(pairedRows),guards:summary(audit.rows.filter(r=>r.variant==='explicit-v7-guards').map(r=>({...r,variant:'explicit-v7'}))),auditPath:'evidence/feasibility-live-audit.json',notes:['不修改历史1200次调用、严格分数、gold或冻结快照。','当前40题每域4题，A/B其中原六域各2题；另4题地点/音频/坐标守卫；正式224次调用，预热不在分母。','守卫题单独计分，不混入40题当前均衡样本。','确定性规则不更改API；rawArguments和语义成功分开报告。','v1/v2语义均按当前独立evaluator口径评分；本次v1分数并非直接复制历史v1成绩。','live仅在固定上下文下执行finalizePlan，不调用prepareSystemContext或Harmony宿主；原生依赖路径只由注入式测试验证，尚无真机证明。','错误不从分母剔除；未自动重试。','四档同为Q4_K_M，因此不能分离量化影响；相同测试题参与工程迭代，非独立留出证明。']};
  await save(join(root,'docs/feasibility-live.json'),report);
  console.log(JSON.stringify(report,null,2));
}
const initial=await hashes();
await saveReplaySourceSnapshot({root,snapshotDirectory:'data/benchmark-single-service-v3',paths:sourcePaths});
await replay(initial);
if(!process.argv.includes('--replay-only'))await live(initial);
if(!same(initial,await hashes()))throw new Error('Verification source changed');
