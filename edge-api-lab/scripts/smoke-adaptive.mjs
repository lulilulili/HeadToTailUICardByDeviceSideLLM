import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runPipeline} from '../src/pipeline.mjs';
import {createProviders} from '../src/providers.mjs';
import {experimentDefaults} from '../src/fixtures.mjs';
import {scoreCase} from '../src/evaluation.mjs';
import {scoreExecutionSemantics} from '../src/semantic-evaluation.mjs';
import {collectTestEnvironment,withInferenceSampling} from '../src/test-environment.mjs';

// A small engineering smoke test, independent of the completed 4000-run baseline.
// Never uses Jev or reads a gold answer inside inference; no statistical A/B claim.
const root=dirname(dirname(fileURLToPath(import.meta.url))),model='qwen2.5:1.5b';
const smokeId=process.env.ADAPTIVE_SMOKE_ID??`adaptive-jev-smoke-${new Date().toISOString().replace(/[^0-9]/g,'')}`;
if(!/^adaptive-jev-[A-Za-z0-9-]+$/.test(smokeId))throw new Error('Invalid ADAPTIVE_SMOKE_ID');
const output=join(root,'evidence',smokeId);
const cases=[
 {id:'simple-no-input',text:'查本机电量',calls:2,expected:{domain:'device',api:'device.battery.level',arguments:{},status:'ready_mock'}},
 {id:'simple-weather',text:'上海现在气温多少？',calls:2,expected:{domain:'weather',api:'weather.current.temperature',arguments:{location:'上海',time_ref:'现在'},status:'ready_mock'}},
 {id:'complex-write',text:'修改日程 ev_7，标题为设计评审，地点为A室',calls:3,expected:{domain:'calendar',api:'calendar.update',arguments:{event_id:'ev_7',changes:{title:'设计评审',location:'A室'}},status:'ready_mock'}},
 {id:'complex-json',text:'调用云函数 refreshIndex，正文 {"items":[1,2],"force":true}',calls:3,expected:{domain:'cloud',api:'cloud.function.call',arguments:{function_name:'refreshIndex',data:'{"items":[1,2],"force":true}'},status:'ready_mock'}},
 {id:'unsupported',text:'请写一首赞美秋天的诗',calls:1,expected:{domain:'unsupported',api:null,arguments:{},status:'unsupported'}},
 {id:'no-input-skip',text:'查本机电量，返回 JSON {}',calls:2,expected:{domain:'device',api:'device.battery.level',arguments:{},status:'ready_mock'}}
];
export async function runSmoke(){
 // mkdir without recursive refuses to replace existing evidence.
 await mkdir(dirname(output),{recursive:true});await mkdir(output);
 const tags=await(await fetch('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(5000)})).json();
 const installed=tags.models.find(item=>item.name===model);if(!installed)throw new Error('Smoke model is not installed: '+model);
 const paths=['src/pipeline.mjs','src/prompts.mjs','src/adaptive-routing.mjs','src/providers.mjs','src/jev-provider.mjs','src/grounding.mjs','src/resolver.mjs','src/registry.mjs','scripts/smoke-adaptive.mjs'];
 const sourceHashes=Object.fromEntries(await Promise.all(paths.map(async path=>[path,createHash('sha256').update(await readFile(join(root,path))).digest('hex')])));
 for(const path of paths){
  const bytes=await readFile(join(root,path));
  if(createHash('sha256').update(bytes).digest('hex')!==sourceHashes[path])throw new Error('Source changed before smoke: '+path);
  const target=join(output,'source-snapshot',path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});
 }
 const context={...structuredClone(experimentDefaults),now:'2026-10-10T08:00:00+08:00',timezone:'Asia/Shanghai',location:{latitude:31.2304,longitude:121.4737,label:'模拟手机当前位置（上海固定坐标）',source:'fixture'}};
 const manifest={id:smokeId,status:'running',createdAt:new Date().toISOString(),mode:'adaptive',model,modelDetails:installed,environment:await collectTestEnvironment(),sourceHashes,sourceSnapshot:`evidence/${smokeId}/source-snapshot`,context,options:{num_ctx:2048,temperature:0,timeoutMs:180000},cases,records:[],notes:['6条人工设计工程烟测，无预热；包含加载时间；不是准确率或速度A/B评测。','只调用本机Qwen；无TypeSafe账号密钥，官方Jev未实测。','业务执行为mock，环境为明确fixture，不修改已有4000条原始证据。']};
 const providers=createProviders();
 await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 for(const item of cases){
  const sampled=await withInferenceSampling(()=>runPipeline({text:item.text,mode:'adaptive',model,context:structuredClone(context),options:manifest.options},{providers}));
  const run=sampled.value;
  const record={id:item.id,text:item.text,expected:item.expected,expectedCallCount:item.calls,run,resources:sampled.samples,rawScore:scoreCase(item.expected,run),executionScore:scoreExecutionSemantics(item.expected,run,run.context),routingPassed:run.traces.length===item.calls};
  await writeFile(join(output,item.id+'.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
  manifest.records.push({id:item.id,status:run.status,domain:run.domain,api:run.api,stages:run.traces.map(trace=>trace.stage),actualCallCount:run.traces.length,totalMs:run.totalMs,traceTimings:run.traces.map(trace=>({stage:trace.stage,wallMs:trace.wallMs,inputTokens:trace.inputTokens,outputTokens:trace.outputTokens})),routingPassed:record.routingPassed,rawScore:record.rawScore,executionScore:record.executionScore});
  await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({id:item.id,status:run.status,api:run.api,calls:run.traces.length,totalMs:run.totalMs,routingPassed:record.routingPassed,rawPlan:record.rawScore.plan,finalPlan:record.executionScore.plan}));
 }
 manifest.status='completed';manifest.completedAt=new Date().toISOString();await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await runSmoke();
