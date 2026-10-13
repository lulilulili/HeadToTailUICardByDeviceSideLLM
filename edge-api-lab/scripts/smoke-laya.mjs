import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runPipeline} from '../src/pipeline.mjs';
import {createProviders} from '../src/providers.mjs';
import {experimentDefaults} from '../src/fixtures.mjs';
import {scoreCase} from '../src/evaluation.mjs';
import {scoreExecutionSemantics} from '../src/semantic-evaluation.mjs';
import {collectTestEnvironment} from '../src/test-environment.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url))),model='qwen2.5:1.5b';
const id=`laya-smoke-${new Date().toISOString().replace(/[^0-9]/g,'')}`;
const output=join(root,'evidence',id);
const cases=[
 {id:'simple-no-input',text:'查本机电量',calls:2,expected:{domain:'device',api:'device.battery.level',arguments:{},status:'ready_mock'}},
 {id:'simple-weather',text:'上海现在气温多少？',calls:3,expected:{domain:'weather',api:'weather.current.temperature',arguments:{location:'上海',time_ref:'现在'},status:'ready_mock'}},
 {id:'complex-write',text:'修改日程 ev_7，标题为设计评审，地点为A室',calls:3,expected:{domain:'calendar',api:'calendar.update',arguments:{event_id:'ev_7',changes:{title:'设计评审',location:'A室'}},status:'ready_mock'}},
 {id:'complex-json',text:'调用云函数 refreshIndex，正文 {"items":[1,2],"force":true}',calls:3,expected:{domain:'cloud',api:'cloud.function.call',arguments:{function_name:'refreshIndex',data:'{"items":[1,2],"force":true}'},status:'ready_mock'}},
 {id:'unsupported',text:'请写一首赞美秋天的诗',calls:1,expected:{domain:'unsupported',api:null,arguments:{},status:'unsupported'}},
 {id:'no-input-skip',text:'查本机电量，返回 JSON {}',calls:2,expected:{domain:'device',api:'device.battery.level',arguments:{},status:'ready_mock'}}
];
await mkdir(output,{recursive:true});
const providers=createProviders(),status=await providers.laya.getStatus();
if(!status.ready)throw new Error('Laya not ready: '+status.error);
const paths=['src/pipeline.mjs','src/prompts.mjs','src/adaptive-routing.mjs','src/providers.mjs','src/laya-provider.mjs','src/grounding.mjs','src/resolver.mjs','src/registry.mjs','integrations/laya/server.py','integrations/laya/requirements.txt','scripts/smoke-laya.mjs'];
const sourceHashes={};
for(const path of paths){const bytes=await readFile(join(root,path));sourceHashes[path]=createHash('sha256').update(bytes).digest('hex');const target=join(output,'source-snapshot',path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});}
const context={...structuredClone(experimentDefaults),now:'2026-10-10T08:00:00+08:00',timezone:'Asia/Shanghai',location:{latitude:31.2304,longitude:121.4737,label:'模拟手机当前位置（上海固定坐标）',source:'fixture'}};
const manifest={id,status:'running',createdAt:new Date().toISOString(),mode:'laya',model,laya:status,sourceHashes,sourceSnapshot:`evidence/${id}/source-snapshot`,environment:await collectTestEnvironment(),context,options:{num_ctx:2048,temperature:0,timeoutMs:180000},cases,records:[],notes:['6条工程烟测，预加载Laya模型；不是Jev对照或独立盲测。','Laya概率来自分组淘汰时不是204项联合概率；内部predict计数由官方rounds字段推算，低层forward未观测。','保留错误，不调用官方Jev、不充值、不改变4000条历史原始记录；业务仍mock。']};
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({evidence:output,laya:status}));
for(const item of cases){
 const run=await runPipeline({text:item.text,mode:'laya',model,context:structuredClone(context),options:manifest.options},{providers});
 const record={id:item.id,expected:item.expected,expectedCallCount:item.calls,run,rawScore:scoreCase(item.expected,run),executionScore:scoreExecutionSemantics(item.expected,run,run.context),routingPassed:run.traces.length===item.calls};
 await writeFile(join(output,item.id+'.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
 manifest.records.push({id:item.id,status:run.status,domain:run.domain,api:run.api,actualCallCount:run.traces.length,totalMs:run.totalMs,rawPlan:record.rawScore.plan,finalPlan:record.executionScore.plan,routingPassed:record.routingPassed,error:run.error??null,traces:run.traces.map(t=>({stage:t.stage,provider:t.provider,model:t.model,wallMs:t.wallMs,inferenceMs:t.inferenceMs,inputTokens:t.inputTokens,outputTokens:t.outputTokens,httpCalls:t.httpCalls,internalPredictCalls:t.internalPredictCalls,forwardPasses:t.forwardPasses,tournament:t.tournament,truncated:t.truncated,error:t.error??null}))});
 await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest.records.at(-1)));
}
manifest.status='completed';manifest.completedAt=new Date().toISOString();await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
