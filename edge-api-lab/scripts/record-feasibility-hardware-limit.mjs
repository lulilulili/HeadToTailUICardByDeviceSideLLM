import {readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const file=join(root,'evidence/feasibility-live-audit.json');
const audit=JSON.parse(await readFile(file,'utf8'));
if(audit.status!=='running')throw new Error('Only a running audit can be stopped for hardware limitations');
for(const [path,hash]of Object.entries(audit.conditions.sourceHashes)){
 if(createHash('sha256').update(await readFile(join(root,path))).digest('hex')!==hash)throw new Error(`Inference source changed: ${path}`);
}
const model='qwen2.5:7b';
const failures=[...audit.warmups.filter(r=>r.model===model),...audit.rows.filter(r=>r.model===model)];
if(failures.length<3||failures.some(row=>row.trace?.errorType!=='TimeoutError'))throw new Error('Expected independently recorded consecutive 7B timeouts');
const completedModels=['qwen2.5:0.5b','qwen2.5:1.5b','qwen2.5:3b'];
if(completedModels.some(m=>audit.rows.filter(r=>r.model===m).length!==56))throw new Error('Other model grids incomplete');
audit.status='partial_hardware_limited';audit.stoppedAt=new Date().toISOString();
audit.hardwareLimit={model,reason:'memory_pressure_timeout',timeoutMs:180000,consecutiveRecordedTimeouts:failures.length,
 observedMemory:{totalVisibleKiB:8230644,freePhysicalKiB:283196,source:'Win32_OperatingSystem read while 7B was resident',observationWindowUtc:'2026-10-11 13:30–13:32 UTC'},
 diagnosis:'8GB CPU机器在7B预热、v7和较短v6提示均180秒超时；仅记录可用性/资源限制，不判定7B API选择能力。',
 action:'停止自有测试进程并卸载7B驻内存实例；D盘权重保留。未回收的在途响应不计入已保存样本。'};
audit.accounting={plannedFormalCalls:224,savedFormalCalls:audit.rows.length,unrecordedPlannedCalls:224-audit.rows.length,completeModels:completedModels,excludedWarmups:audit.warmups.length};
const rate=(rows,fn)=>({correct:rows.filter(fn).length,total:rows.length,accuracy:rows.length?rows.filter(fn).length/rows.length:null});
function summary(rows){return [...Map.groupBy(rows,r=>`${r.model}/${r.variant}`)].map(([,list])=>({model:list[0].model,variant:list[0].variant,total:list.length,
 domain:rate(list,r=>r.rawScore.domain),api:rate(list,r=>r.rawScore.api),rawArguments:rate(list,r=>r.rawScore.arguments),
 v1Semantics:rate(list,r=>r.v1Score.plan),v2Semantics:rate(list,r=>r.v2Score.plan),candidateRecall:rate(list,r=>r.candidates.some(c=>c.id===r.expected.api)),
 errors:list.filter(r=>r.error).length,v1Errors:list.filter(r=>r.v1Error).length,v2Errors:list.filter(r=>r.v2Error).length,
 evaluability:list.every(r=>r.error)?'no_completed_model_output':'saved_calls_only',maxInputTokens:Math.max(...list.map(r=>r.trace?.inputTokens??0))}));}
const paired=new Set(audit.conditions.sampling.pairedCaseIds);
const report={id:audit.id,status:audit.status,generatedAt:audit.stoppedAt,conditions:audit.conditions,hardwareLimit:audit.hardwareLimit,accounting:audit.accounting,
 total:audit.rows.length,current:summary(audit.rows.filter(r=>r.variant==='explicit-v7')),paired:summary(audit.rows.filter(r=>paired.has(r.caseId))),
 guards:summary(audit.rows.filter(r=>r.variant==='explicit-v7-guards')),auditPath:'evidence/feasibility-live-audit.json',
 notes:['原计划224次；前三模型各56正式调用完整，7B仅保存两次超时。没有补造缺失结果或把未执行题纳入分母。','7B没有完成任何模型输出，超时不构成模型路由/抽取能力证据。','预热独立且不计正式分数；在途取消未保存响应不计已保存样本。','原始raw/trace/候选/期望/上下文不改，源码哈希已核验未变。','同一开发集单服务测试，不证明真实SDK执行或端侧性能；主样本、配对A/B、守卫独立计分。']};
const save=async(path,value)=>{await writeFile(`${path}.tmp`,JSON.stringify(value,null,2)+'\n');await rename(`${path}.tmp`,path);};
await save(file,audit);await save(join(root,'docs/feasibility-live.json'),report);
console.log(JSON.stringify({status:audit.status,accounting:audit.accounting}));
