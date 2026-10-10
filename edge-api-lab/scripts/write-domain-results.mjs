import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {loadCases} from '../src/corpus.mjs';
import {buildDomainReport,testDomains,suiteModels,diagnoseCase} from '../src/domain-report.mjs';
import {summarize} from '../src/evaluation.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const manifest=JSON.parse(await readFile(join(root,'data/runtime/domain-suite.json'),'utf8'));
const jobs=await Promise.all(manifest.entries.map(entry=>readFile(join(root,`data/runtime/eval-${entry.jobId}.json`),'utf8').then(JSON.parse)));
const cases=await loadCases(root),report=buildDomainReport(manifest,cases,jobs);
const rows=jobs.flatMap(job=>job.results??[]);
const domainNames={weather:'天气',calendar:'日历',contacts:'联系人',files:'文件',services:'服务入口',cloud:'云端业务'};
const pct=n=>n==null?'—':`${(n*100).toFixed(1)}%`,sec=n=>n==null?'—':(n/1000).toFixed(2);
const cell=value=>String(value??'').replaceAll('|','\\|').replaceAll('\n',' ');
const table=(head,body)=>[head.map(cell).join(' | '),head.map(()=>'---').join(' | '),...body.map(row=>row.map(cell).join(' | '))].map(line=>`| ${line} |`).join('\n');
const counts=values=>[...Map.groupBy(values,value=>value.code)].map(([code,entries])=>({code,label:entries[0].label,count:entries.reduce((n,item)=>n+item.count,0)})).sort((a,b)=>b.count-a.count);
const text=[];
text.push('# 六领域 × 四模型：每领域 50 条新增用例实测','',`状态：${report.status}；${report.progress.done}/${report.progress.total} 次完成。开始 ${manifest.startedAt}；结束 ${manifest.completedAt??'仍在运行'}。`, '', '## 测试范围与评分','',`原有 178 条开发用例保留，新增 ${cases.filter(item=>item.suite===report.suite).length} 条手工金标：每领域 50 条。这里只统计新增题组 ${report.suite}，不混入历史结果。每题覆盖一种明确的条件，另存 scenario、category、note、上下文、期望 API/明确入参/状态/来源和已标注精度。`, '',...report.notes.map(note=>`- ${note}`),'','准确率使用严格契约匹配：等价的默认值若被模型当作“用户明确提供”输出，也计为参数错误；原时间表达被模型自行改写计为值错误。合法 JSON 并不代表契约或调用计划正确。对明确求完整对象的用例，父对象和叶字段不互换。','', 'P50 是耗时中位数，P95 是较慢请求的参考：按耗时排序后，用线性插值计算 50% 和 95% 百分位。近似可理解为一半/95% 的请求在对应时间内完成；有限样本不保证实际恰有该比例。耗时单元为秒，整条处理含模型和解析、不含队列与预热。单次调用的 wall/load/prompt/generation 耗时、token 数和原始输出均在运行记录。','', '## 冻结运行条件','',table(['项目','值'],[['模式',manifest.mode],['模型',manifest.models.join(' / ')],['参数',`temperature=0；num_ctx=${manifest.conditions.num_ctx}；单轮输出上限=${manifest.conditions.outputBudget}；每题${manifest.conditions.repeats}次`],['提示词 / 目录',`${manifest.conditions.promptVersion} / ${manifest.conditions.catalogVersion}`],['Ollama / Node',`${manifest.conditions.ollama} / ${manifest.conditions.node}`],['CPU / 内存',`${manifest.conditions.hardware.cpu} / ${manifest.conditions.hardware.memoryGB} GB`],['位置/时间',`${manifest.conditions.context.now}，${manifest.conditions.context.timezone}，上海固定坐标夹具；逐题覆写另存`],['预热',manifest.conditions.warmup]]),'','模型实际规格/量化/digest 与用例和关键源码 SHA256 见 validation-domain-50.json 的 conditions；完整原始批次为 data/runtime/eval-<jobId>.json，单条记录为 run-<runId>.json。','', '## 各模型总体结果','',table(['模型','题数','领域','API','明确入参','完整计划','P50秒','P95秒'],summarize(rows).map(row=>[row.model,row.total,pct(row.domainAccuracy),pct(row.apiAccuracy),pct(row.argumentAccuracy),pct(row.planAccuracy),sec(row.p50Ms),sec(row.p95Ms)])),'', '## 每领域、每模型对照','',table(['测试领域','模型','完成/50','领域','API','明确入参','状态','完整计划','P50秒','P95秒','调用异常'],report.summary.map(row=>[domainNames[row.testDomain],row.model,`${row.total}/50`,pct(row.domainAccuracy),pct(row.apiAccuracy),pct(row.argumentAccuracy),pct(row.statusAccuracy),pct(row.planAccuracy),sec(row.p50Ms),sec(row.p95Ms),row.errorCount])),'', '## 错误来源与排查顺序','', '每条失败仅分配一个主错因，按调用链中最早可观察失败归类：调用/结构输出 → 领域/拒识 → 目标候选缺失或选错 → 多填/漏填/值错 → 来源/精度补全 → 状态。一次上游错误引发的 API、入参、状态连带错误不重复计数。若领域被错误拒识，API 遗漏只作次级证据；“领域或拒识”并不能单独证明模型的内部领域判断出错。','', '目标 API 不在候选列表属于检索层证据；候选存在却选错属于 API 选择证据。参数检查按递归字段路径比较。多填、漏填、值错可以同时发生，主因按该顺序取一个，原始逐项分数仍完整保留。该归因是工程定位规则，不是模型内部因果证明。','',table(['模型','主错因','数量'],suiteModels.flatMap(model=>counts(report.errors.filter(error=>error.model===model)).map(error=>[model,error.label,error.count]))));
for(const domain of testDomains) {
 const subset=report.errors.filter(error=>error.testDomain===domain);
 const causes=counts(subset),coverage=report.caseCoverage.byDomain.find(item=>item.testDomain===domain);
 text.push('',`### ${domainNames[domain]}：具体情况`, '',`${coverage.count} 条，${coverage.categories.length} 个场景类别。当前主要错误：${causes.slice(0,3).map(c=>`${c.label} ${c.count} 次`).join('；')||'暂无已完成失败'}。`,'',table(['场景','模型','完成/目标','完整计划','P50秒','主错因'],report.scenarios.filter(s=>s.testDomain===domain&&s.total).map(s=>[s.scenario,s.model,`${s.total}/${s.targetTotal}`,pct(s.planAccuracy),sec(s.p50Ms),s.primaryErrors.map(c=>`${c.label} ${c.count}`).join('；')])));
 // One representative per cause, preserve exact expected and actual extraction.
 for(const cause of causes) {
  const group=subset.find(item=>item.code===cause.code),example=group.examples[0];
  text.push('',`**${cause.label}**（本领域共 ${cause.count} 次）`, '',`样例 ${example.caseId} / ${group.model} / ${example.scenario}：${example.text}`, '',example.reason, '', '```json',JSON.stringify({expected:example.expected,actual:example.actual,runId:example.runId},null,2),'```');
 }
}
let analysis;
try{analysis=JSON.parse(await readFile(join(root,'docs/domain-analysis.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(analysis?.manifestId===manifest.id)text.push('', '## 人工复核与改进优先级','',...analysis.paragraphs.flatMap(p=>[p,'']));
let optimization;
try{optimization=JSON.parse(await readFile(join(root,'docs/optimization-comparison.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(optimization?.newId===manifest.id)text.push('', '## 优化前后：同题组 0.5B 完整对照','',optimization.scope,'',table(['领域','旧完整计划','新完整计划','旧P50秒','新P50秒'],optimization.byDomain.map(r=>[domainNames[r.domain],pct(r.old.planAccuracy),pct(r.current.planAccuracy),sec(r.old.p50Ms),sec(r.current.p50Ms)])),'',table(['版本','题数','API','明确入参','完整计划','P50秒','P95秒'],[['旧 retrieval-v5',...optimization.old.map(r=>[r.total,pct(r.apiAccuracy),pct(r.argumentAccuracy),pct(r.planAccuracy),sec(r.p50Ms),sec(r.p95Ms)])[0]],['新 sparse-v6',...optimization.current.map(r=>[r.total,pct(r.apiAccuracy),pct(r.argumentAccuracy),pct(r.planAccuracy),sec(r.p50Ms),sec(r.p95Ms)])[0]]]),'',...optimization.limits.map(p=>`- ${p}`),'','旧轮其余模型未全部完成，保留部分记录但不用于总体改善对照。主结果仍只统计当前独立清单的 1200 次。');
text.push('', '## 复现与页面阅读','', '页面：批量评测 → 领域与模型对照。选择测试领域和模型，查看完整领域 50 题对照；场景筛选仅作用于下方明细和错误例子。展开错误组查看预期/实际，再点调用详情查看模型实际看到的候选、提示词、原始 JSON 和单次耗时。报告可导出 JSON。','', '首次执行：npm run benchmark:domains。已有本轮记录时脚本不覆盖：node scripts/benchmark-domains.mjs --resume 按已登记批次继续；冻结条件改变会拒绝混跑。只导出：node scripts/benchmark-domains.mjs --export-only。node scripts/write-domain-results.mjs 从原始批次重新生成此文档，无模型调用。','', '本轮不为提高成绩修改已冻结提示词、候选或金标，也不重试失败、补答案或过滤服务错误。新题组涉及公开开发契约、人工边界、fixture 系统状态、伪业务执行，后续需要独立盲测集、不同模型家族、重复运行、真实设备位置/SDK响应及真实用户分布验证。','', '## 批次索引','',table(['领域','模型','状态','完成数','批次ID'],manifest.entries.map(e=>[domainNames[e.testDomain],e.model,e.status,e.done,e.jobId])),'');
await writeFile(join(root,'docs/validation-domain-50.json'),JSON.stringify(report,null,2));
await writeFile(join(root,'docs/DOMAIN_EVALUATION_RESULTS.md'),text.join('\n'));
console.log(`结果文档生成：${report.status} ${report.progress.done}/${report.progress.total}`);
