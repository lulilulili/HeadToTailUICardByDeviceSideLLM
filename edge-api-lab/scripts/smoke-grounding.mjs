import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {scoreExecutionSemantics} from '../src/semantic-evaluation.mjs';

const origin='http://127.0.0.1:3210';
const health=await(await fetch(`${origin}/api/health`)).json();
assert.equal(health.queueDepth,0,'请等当前模型请求完成后再运行小样本验收');
const cases=JSON.parse(await readFile(new URL('../data/cases-domain-core.json',import.meta.url),'utf8'));
const {context}=await(await fetch(`${origin}/api/cases`)).json();
const results=[];
for(const id of ['d50-weather-008','d50-weather-023','d50-calendar-040']){
 const item=cases.find(row=>row.id===id);
 const response=await fetch(`${origin}/api/runs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:item.text,model:'qwen2.5:3b',mode:'unified',options:{temperature:0,num_ctx:2048,num_predict:224},context:{...context,...item.context}}),signal:AbortSignal.timeout(180000)});
 assert.equal(response.status,200);const run=await response.json();
 const score=scoreExecutionSemantics(item.expected,run,run.context);
 results.push({caseId:id,text:item.text,expected:item.expected,executionScore:score,run});
 console.log(JSON.stringify({caseId:id,api:run.api,status:run.status,repairs:run.grounding?.repairs.length,modelMs:run.totalMs,deterministicMs:run.deterministicMs,executionPass:score.plan}));
}
await writeFile(new URL('../evidence/grounding-live-probes.json',import.meta.url),JSON.stringify({createdAt:new Date().toISOString(),scope:'仅为新服务 3 次真实调用验收，非 1200 条冻结评测或规则回放；不纳入旧准确率和旧耗时。',model:'qwen2.5:3b',results},null,2));
assert.ok(results.every(item=>item.executionScore.plan),'详见 evidence/grounding-live-probes.json 的实际错误');
