import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cpus,totalmem} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createProviders} from '../src/providers.mjs';
import {buildUnifiedPrompt,PROMPT_VERSION} from '../src/prompts.mjs';
import {finalizePlan,GROUNDING_VERSION} from '../src/grounding.mjs';
import {scoreCase} from '../src/evaluation.mjs';
import {scoreExecutionSemantics} from '../src/semantic-evaluation.mjs';
import {saveReplaySourceSnapshot} from './replay-grounding.mjs';
import {getCapability} from '../src/registry.mjs';

// Independent geography stress test. Names are test data only, never runtime lookup entries.
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const models=['qwen2.5:0.5b','qwen2.5:1.5b','qwen2.5:3b','qwen2.5:7b'];
const primary=JSON.parse(await readFile(join(root,'evidence/feasibility-live-audit.json'),'utf8'));
const excludedModels=primary.status==='partial_hardware_limited'?[primary.hardwareLimit.model]:[];
const activeModels=models.filter(model=>!excludedModels.includes(model));
const paths=['src/registry.mjs','src/weather-capabilities.mjs','src/extended-capabilities.mjs','src/system-capabilities.mjs','src/prompts.mjs','src/providers.mjs','src/grounding.mjs','src/resolver.mjs','src/evaluation.mjs','src/semantic-evaluation.mjs','data/global-city-samples.json','scripts/verify-global-cities.mjs'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async path=>[path,hash(await readFile(join(root,path)))])));
const save=async(path,value)=>{await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,`${path}.tmp`),JSON.stringify(value,null,2)+'\n');await rename(join(root,`${path}.tmp`),join(root,path));};
const removeNull=value=>Array.isArray(value)?value.map(removeNull):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==null).map(([k,v])=>[k,removeNull(v)])):value;
const rate=(rows,fn)=>({correct:rows.filter(fn).length,total:rows.length,accuracy:rows.length?rows.filter(fn).length/rows.length:null});
const corpus=JSON.parse(await readFile(join(root,'data/global-city-samples.json'),'utf8'));
const ids=corpus.sampling.selectLiveIds??corpus.selectLiveIds;
if(!Array.isArray(ids)||ids.length!==8)throw new Error('Exactly 8 cities must be preselected during sampling, not after observing results');
const selected=ids.map(id=>corpus.samples.find(city=>city.id===id));
if(selected.some(city=>!city))throw new Error('Selected city missing');
const templates=[
 ['weather.current.temperature',name=>`查${name}现在的气温`],
 ['weather.current.humidity',name=>`${name}现在的湿度是多少`],
 ['weather.current.uvIndex',name=>`我想看${name}现在的紫外线指数`],
 ['location.geocode',name=>`把地点“${name}”转换为经纬度`],
 ['weather.current.temperature',name=>`不是上海，查${name}现在的气温`],
 ['weather.current.wind.speed',name=>`${name}现在的风速是多少`],
 ['location.geocode',name=>`查询地址“${name}”对应的坐标`],
 ['weather.current.temperature',name=>`地点为“${name}”，查询现在的气温`]
];
const cases=selected.map((city,i)=>{const [api,template]=templates[i],weather=api.startsWith('weather.');return {id:`global-live-${city.id}`,city,text:template(city.name),expected:{domain:weather?'weather':'location',api,arguments:weather?{location:city.name,time_ref:'现在'}:{address:city.name},status:weather?'resolution_failed':'ready_mock'}};});
for(const c of cases)if(getCapability(c.expected.api)?.domain!==c.expected.domain)throw new Error(`Invalid expected API before inference: ${c.expected.api}`);
const sourceHashes=await hashes();
const tags=await fetch('http://127.0.0.1:11434/api/tags').then(r=>r.json());
if(models.some(model=>!tags.models.some(item=>item.name===model)))throw new Error('Required models missing');
const context={now:'2026-10-10T08:00:00+08:00',timezone:'Asia/Shanghai',location:{latitude:31.2304,longitude:121.4737,source:'fixture'},geocodes:{}};
const conditions={sourceHashes,promptVersion:PROMPT_VERSION,groundingVersion:GROUNDING_VERSION,modelDetails:tags.models.filter(m=>models.includes(m.name)),activeModels,excludedModels,hardwareLimit:primary.hardwareLimit??null,plannedFormalCalls:models.length*cases.length,actualScheduledCalls:activeModels.length*cases.length,modelDirectory:'D:/OllamaModels',hardware:{cpu:cpus()[0]?.model,logicalCores:cpus().length,totalMemoryBytes:totalmem()},options:{num_ctx:2048,num_predict:224,timeoutMs:180000},context,sampling:corpus.sampling,provenance:corpus.provenance,cases,
 scope:'独立全球城市中文地名压力测试，不混入原单服务验证；采样独立于模型结果，中文指令+中文地名或中文译名；不评价多语言；规则开发集而非盲测。7B已有连续超时硬件证据时跳过，不将其标为抽取/路由失败。',geocoding:'不注入样本经纬度；故明确天气地点预期resolution_failed。正确拒绝错误fallback并不等于已执行真实地理编码。location.geocode仅ready_mock，不代表SDK已执行。'};
await saveReplaySourceSnapshot({root,snapshotDirectory:'data/benchmark-global-cities-v2',paths});
let audit={id:'global-cities-v2-2026-10-11',status:'running',createdAt:new Date().toISOString(),conditions,warmups:[],rows:[]};
try{const prior=JSON.parse(await readFile(join(root,'evidence/global-cities-v2-live-audit.json'),'utf8'));if(JSON.stringify(prior.conditions.sourceHashes)!==JSON.stringify(sourceHashes)||JSON.stringify(prior.conditions.modelDetails.map(m=>m.digest))!==JSON.stringify(conditions.modelDetails.map(m=>m.digest)))throw new Error('Existing global audit uses different source/model; refusing overwrite');audit=prior;}catch(error){if(error.code!=='ENOENT')throw error;}
const provider=createProviders().ollama;
const keys=new Set(audit.rows.map(row=>`${row.model}/${row.caseId}`));
for(const model of activeModels){
 if(cases.every(c=>keys.has(`${model}/${c.id}`)))continue;
 for(const name of models)await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:name,keep_alive:0})});
 try{const warmup=await provider.invoke({stage:'unified',model,...buildUnifiedPrompt('手机还剩多少电',context),options:conditions.options});audit.warmups.push({model,excludedFromScores:true,trace:warmup.trace});}catch(error){audit.warmups.push({model,excludedFromScores:true,error:error.message,trace:error.trace});}
 for(const c of cases){
  if(keys.has(`${model}/${c.id}`))continue;
  const prompt=buildUnifiedPrompt(c.text,context);
  const row={model,caseId:c.id,text:c.text,city:c.city,expected:c.expected,candidates:prompt.promptMeta.candidates.scores,context};
  try{const response=await provider.invoke({stage:'unified',model,...prompt,options:conditions.options});row.trace=response.trace;row.raw={domain:response.value.domain,api:response.value.api==='unsupported'?null:response.value.api,extractedArguments:removeNull(response.value.arguments)};}
  catch(error){row.error=error.message;row.trace=error.trace;row.raw={domain:null,api:null,extractedArguments:{}};}
  row.rawScore=scoreCase(c.expected,{...row.raw,status:row.error?'error':'parsed'});
  try{row.run=row.error?{...row.raw,status:'error',error:row.error}:finalizePlan({text:c.text,...row.raw,context});}catch(error){row.ruleError=error.message;row.run={...row.raw,status:'error',error:error.message};}
  row.semantic=scoreExecutionSemantics(c.expected,row.run,context);
  const field=c.expected.domain==='weather'?'location':'address';
  row.rawNameExact=row.raw.extractedArguments[field]===c.city.name;
  row.finalNameExact=row.run.groundedArguments?.[field]===c.city.name;
  audit.rows.push(row);keys.add(`${model}/${c.id}`);await save('evidence/global-cities-v2-live-audit.json',audit);
  console.log(JSON.stringify({done:audit.rows.length,total:conditions.actualScheduledCalls,model,city:c.city.name,api:row.raw.api,rawNameExact:row.rawNameExact,finalNameExact:row.finalNameExact,status:row.run.status,error:row.error??row.ruleError??null}));
 }
}
if(JSON.stringify(sourceHashes)!==JSON.stringify(await hashes()))throw new Error('Source changed during global stress calls');
audit.status=excludedModels.length?'completed_with_model_exclusion':'completed';audit.completedAt=new Date().toISOString();
const summary=models.map(model=>{const rows=audit.rows.filter(row=>row.model===model);return {model,executed:!excludedModels.includes(model),exclusionReason:excludedModels.includes(model)?'recorded_7b_memory_pressure_timeout':null,api:rate(rows,r=>r.rawScore.api),rawArguments:rate(rows,r=>r.rawScore.arguments),rawNameExact:rate(rows,r=>r.rawNameExact),finalNameExact:rate(rows,r=>r.finalNameExact),semantics:rate(rows,r=>r.semantic.plan),candidateRecall:rate(rows,r=>r.candidates.some(c=>c.id===r.expected.api)),errors:rows.filter(r=>r.error).length};});
await save('evidence/global-cities-v2-live-audit.json',audit);
await save('docs/global-cities-v2-live.json',{id:audit.id,status:audit.status,generatedAt:audit.completedAt,total:audit.rows.length,conditions,summary,auditPath:'evidence/global-cities-v2-live-audit.json',notes:['全部城市名保持数据源原字形；模型原始结果、规则后地点、API路由分开计分。','测试样本未进入运行时prompt/grounding/resolver模块；不存在以测试城市表查找地点的逻辑。','天气的未解析地点保持resolution_failed，禁止使用当前上海fixture坐标；拒绝错误fallback不是地理编码成功。','8城市×可运行模型仅小样本压力测试，不能推断全球地名覆盖率。']});
console.log(JSON.stringify({summary},null,2));
