import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {finalizePlan,GROUNDING_VERSION} from '../src/grounding.mjs';
import {scoreExecutionSemantics} from '../src/semantic-evaluation.mjs';
import {saveReplaySourceSnapshot,buildGroundingReplay} from './replay-grounding.mjs';

// Zero model calls. Preserve the original live report and derive final rule scores separately.
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const read=async path=>JSON.parse(await readFile(join(root,path),'utf8'));
const save=async(path,value)=>{await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),JSON.stringify(value,null,2)+'\n');};
const rate=(rows,fn)=>({correct:rows.filter(fn).length,total:rows.length,accuracy:rows.length?rows.filter(fn).length/rows.length:null});
function summarize(rows){
  return [...Map.groupBy(rows,row=>row.model)].map(([model,list])=>({model,total:list.length,
    api:rate(list,r=>r.rawScore.api),domain:rate(list,r=>r.rawScore.domain),rawArguments:rate(list,r=>r.rawScore.arguments),
    initialV2Semantics:rate(list,r=>r.initialV2Score.plan),finalSemantics:rate(list,r=>r.v2Score.plan),
    improved:list.filter(r=>!r.initialV2Score.plan&&r.v2Score.plan).length,regressed:list.filter(r=>r.initialV2Score.plan&&!r.v2Score.plan).length,
    providerErrors:list.filter(r=>r.error).length,ruleErrors:list.filter(r=>r.v2Error).length,
    routingEvaluableCalls:list.filter(r=>!r.error).length,capacityComparisonEligible:list.some(r=>!r.error),
    maxInputTokens:Math.max(...list.map(r=>r.trace?.inputTokens??0))}));
}
const initial=await read('evidence/feasibility-live-audit.json');
if(initial.status==='completed'&&initial.rows.length!==224)throw new Error('Completed grid is not 224');
if(!['completed','partial_hardware_limited'].includes(initial.status))throw new Error('Live audit must be closed before final rule replay');
if(initial.status==='partial_hardware_limited'&&(!initial.hardwareLimit||initial.accounting.savedFormalCalls!==initial.rows.length))throw new Error('Missing audited hardware-limit accounting');
for(const [path,hash] of Object.entries(initial.conditions.sourceHashes)){
  const bytes=await readFile(join(root,'data/benchmark-single-service-v3',path));
  if(createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error(`Initial inference snapshot changed: ${path}`);
}
const paths=[...Object.keys(initial.conditions.sourceHashes),'scripts/finalize-feasibility.mjs','scripts/import-feasibility-evidence.mjs','scripts/record-feasibility-hardware-limit.mjs',
 'tests/final-argument-guard.test.mjs','tests/location-failclosed.test.mjs','tests/global-city-extraction.test.mjs','tests/global-city-candidates.test.mjs','tests/global-city-sampling.test.mjs',
 'data/global-city-samples.json','scripts/build-global-city-samples.mjs','scripts/verify-global-cities.mjs','scripts/finalize-global-cities-final3.mjs',
 'server.mjs','public/app.js','public/index.html','public/context-builder.mjs',
 'tests/mock-phone-location.test.mjs','tests/http-system-context.test.mjs','tests/frontend.test.mjs','scripts/verify-final-evidence.mjs'];
const snapshot=await saveReplaySourceSnapshot({root,snapshotDirectory:'data/benchmark-single-service-v3-final3',paths});
const finalHashes=Object.fromEntries(snapshot.files.map(file=>[file.path,file.sha256]));
const final=structuredClone(initial);
final.id=`${initial.id}-final-phone-mock3`;
final.completedAt=new Date().toISOString();
final.derivedFrom={manifestId:initial.id,path:'evidence/feasibility-live-audit.json',modelCalls:0,modelOutputsReused:true,ruleOnlyReplay:true};
final.conditions.inferenceSourceHashes=initial.conditions.sourceHashes;
final.conditions.sourceHashes=finalHashes;
final.conditions.groundingVersion=GROUNDING_VERSION;
final.conditions.finalRuleSnapshot=snapshot.directory;
for(const row of final.rows){
  row.initialV2Run=structuredClone(row.v2Run);row.initialV2Score=structuredClone(row.v2Score);
  if(row.error)continue;
  delete row.v2Error;
  try{row.v2Run=finalizePlan({text:row.text,domain:row.raw.domain,api:row.raw.api,extractedArguments:structuredClone(row.raw.extractedArguments),context:row.context});}
  catch(error){row.v2Error=error.message;row.v2Run={domain:row.raw.domain,api:row.raw.api,status:'error',error:error.message};}
  row.v2Score=scoreExecutionSemantics(row.expected,row.v2Run,row.context);
}
const current=final.rows.filter(r=>r.variant==='explicit-v7'),guards=final.rows.filter(r=>r.variant==='explicit-v7-guards');
const pairedIds=new Set(initial.conditions.sampling.pairedCaseIds);
const report={id:final.id,status:final.status,generatedAt:final.completedAt,scope:`相同${initial.rows.length}条已保存调用记录的最终参数守卫回放；无新增推理`,inferenceManifestId:initial.id,modelCalls:0,hardwareLimit:initial.hardwareLimit??null,accounting:initial.accounting??{plannedFormalCalls:224,savedFormalCalls:224},
  current:summarize(current),guards:summarize(guards),paired:[...Map.groupBy(final.rows.filter(r=>pairedIds.has(r.caseId)),r=>r.variant)].map(([variant,rows])=>({variant,models:summarize(rows)})),
  changes:{improved:final.rows.filter(r=>!r.initialV2Score.plan&&r.v2Score.plan).length,regressed:final.rows.filter(r=>r.initialV2Score.plan&&!r.v2Score.plan).length},
  conditions:final.conditions,auditPath:'evidence/feasibility-final3-audit.json',initialLiveReport:'docs/feasibility-live.json',
  notes:['模型raw、domain/API、extractedArguments、候选、schema/messages和模型耗时不变；期望仅评分使用。','初版v2与最终v2不同源码哈希分别冻结，不能将规则回放算作新模型成绩。','原计划主样本每模型40条、每域4条；A/B每种提示每模型12条，守卫每模型4条；硬件限制时仅按实际保存条数计分，7B超时不构成模型API选择能力证据。均非盲测。','用户没提供的时区/SDK可选元数据不保留模型猜测；写入开始时间缺失仍澄清，不用当前时间替代。','未调用真实Harmony SDK；系统依赖桥由注入式测试验证。','四档同为Q4_K_M，不能隔离量化影响。']};
const manifest=await read('data/runtime/domain-suite.json');
const jobs=await Promise.all(manifest.entries.map(e=>read(`data/runtime/eval-${e.jobId}.json`)));
const initialReplay=await read('docs/grounding-replay-v2.json');
for(const [path,hash] of Object.entries(initialReplay.conditions.frozenEvidenceHashes)){
 if(createHash('sha256').update(await readFile(join(root,path))).digest('hex')!==hash)throw new Error(`Frozen historical evidence changed: ${path}`);
}
const initialRows=(await read('evidence/grounding-replay-v2-audit.json')).rows;
const v1Rows=(await read('docs/grounding-replay-audit.json')).rows;
const baseline=new Map(initialRows.map(row=>[`${row.jobId}/${row.caseId}`,row.newSemantic.plan]));
const v1Baseline=new Map(v1Rows.map(row=>[`${row.jobId}/${row.caseId}`,row.newSemantic.plan]));
const {report:replay,rows}=await buildGroundingReplay({manifest,jobs,finalize:finalizePlan});
if(rows.some(row=>typeof baseline.get(`${row.jobId}/${row.caseId}`)!=='boolean'))throw new Error('Initial V2 baseline incomplete');
replay.version=GROUNDING_VERSION;replay.auditPath='evidence/grounding-replay-v2-final3-audit.json';
replay.conditions.replaySourceHashes=finalHashes;replay.conditions.replaySnapshotDirectory=snapshot.directory;
replay.conditions.frozenEvidenceHashes=initialReplay.conditions.frozenEvidenceHashes;
replay.comparisonAgainstInitialV2={previous:initialReplay.metrics.newExecutionSemantics,current:replay.metrics.newExecutionSemantics,improved:rows.filter(r=>!baseline.get(`${r.jobId}/${r.caseId}`)&&r.newSemantic.plan).length,regressed:rows.filter(r=>baseline.get(`${r.jobId}/${r.caseId}`)&&!r.newSemantic.plan).length};
if(rows.some(row=>typeof v1Baseline.get(`${row.jobId}/${row.caseId}`)!=='boolean'))throw new Error('V1 baseline incomplete');
replay.comparisonAgainstV1={previous:initialReplay.comparisonAgainstV1.previous,current:replay.metrics.newExecutionSemantics,
 improved:rows.filter(r=>!v1Baseline.get(`${r.jobId}/${r.caseId}`)&&r.newSemantic.plan).length,
 regressed:rows.filter(r=>v1Baseline.get(`${r.jobId}/${r.caseId}`)&&!r.newSemantic.plan).length};
const single=rows.filter(row=>row.expected.api&&row.expected.domain!=='unsupported');
replay.singleSupported={total:single.length,current:rate(single,r=>r.newSemantic.plan)};
for(const [path,hash]of Object.entries(finalHashes))if(createHash('sha256').update(await readFile(join(root,path))).digest('hex')!==hash)throw new Error(`Source changed during final replay: ${path}`);
const previousFinal=await read('evidence/feasibility-final-audit.json');
const previousById=new Map(previousFinal.rows.map(row=>[`${row.model}/${row.variant}/${row.caseId}`,row]));
report.comparisonAgainstFinal1={improved:final.rows.filter(row=>!previousById.get(`${row.model}/${row.variant}/${row.caseId}`).v2Score.plan&&row.v2Score.plan).length,
 regressed:final.rows.filter(row=>previousById.get(`${row.model}/${row.variant}/${row.caseId}`).v2Score.plan&&!row.v2Score.plan).length};
report.notes.push('最终安全守卫：未核验的空间目标不使用当前位置；排除纯时间、否定和引用，不猜地名。初始推理、final1与final2证据原样保留。',
 '当前PC实验台的本机位置指模拟手机当前位置，仅使用fixture；移除浏览器电脑定位入口并拒绝HTTP browser来源。真实手机定位仍待鸿蒙宿主接入；本次不新增模型调用。');
await save('evidence/feasibility-final3-audit.json',final);
await save('docs/feasibility-final3.json',report);
await save(replay.auditPath,{version:replay.version,manifestId:manifest.id,rows});
await save('docs/grounding-replay-v2-final3.json',replay);
console.log(JSON.stringify({current:report.current,guards:report.guards,changes:report.changes,historical:replay.metrics.newExecutionSemantics,historicalChanges:replay.comparisonAgainstInitialV2},null,2));
