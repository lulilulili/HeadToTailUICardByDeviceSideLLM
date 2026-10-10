// Assemble the final human review only after all frozen calls are verified.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const read=async path=>JSON.parse(await readFile(join(root,path),'utf8'));
const manifest=await read('data/runtime/domain-suite.json');
const verification=await read('docs/domain-run-verification.json');
const reports=await Promise.all(['docs/domain-core-analysis-sparse.json','docs/domain-other-analysis-sparse.json'].map(read));
assert.equal(manifest.status,'completed');assert.equal(verification.manifestId,manifest.id);assert.equal(verification.runs,1200);
for(const report of reports){assert.equal(report.manifestId,manifest.id);assert.equal(report.promptVersion,manifest.conditions.promptVersion);assert.equal(report.final,true);assert.equal(report.reviewedCalls,600);}
const domainNarratives=reports.flatMap(report=>report.domainNarratives).map(row=>({...row,text:row.text??row.paragraphs?.join(' ')}));
assert.equal(domainNarratives.length,6);assert.equal(new Set(domainNarratives.map(row=>row.testDomain)).size,6);
assert.ok(domainNarratives.every(row=>typeof row.text==='string'&&row.text.length>0));
const pct=n=>`${(n*100).toFixed(1)}%`,seconds=n=>(n/1000).toFixed(2);
const paragraphs=[
 `本轮已完成四档模型各300题，共1200次真实调用；每个领域、每个模型都是相同50条。总体严格完整计划率及中位耗时：${verification.overall.map(row=>`${row.model} ${pct(row.planAccuracy)} / ${seconds(row.p50Ms)}秒`).join('；')}。这些结果来自本机CPU、一次调用模式和公开开发题组，不能单凭参数量推断每个领域的表现。`,
 '本次优化将模型职责缩小为领域、具体API和用户明确提供的稀疏参数。未知字段省略，系统时钟、时区、位置和已选只读对象由确定性规则补全；文字地点与坐标是替代输入，最终统一为坐标并保留来源。通用检索同时区分完整对象/叶字段、读写动作和否定语句。旧轮取消的548条单独归档，不混入当前结果；0.5B同300题的前后对照另列，但这是组合优化，不能归功于某一条提示词。',
 ...domainNarratives.flatMap(row=>(row.paragraphs??[row.text]).map((text,index)=>index===0?`${row.title}。${text}`:text)),
 `错误归类依据实际候选、原始提取、有效参数和状态，而不是模型内部原因猜测。核验1200条原始记录后，支持题的目标API全部进入实际候选，候选遗漏为${verification.candidateMissing}；本题组的主要剩余问题位于拒识/选API和参数保留。每个失败只计一个主错因，其他连带失败仍能在逐项分数与原始记录中查看。`,
 '严格分数与实际业务语义要一起读。原文时间的等价改写、与系统默认相同的冗余值也会扣分；漏地点后补到其他城市、漏事件ID后读取列表、漏明确写字段则会实际改变计划。今天白天等原文还暴露了冻结时间解析器和金标切分的局限。文档保留全部原分数，只在人工复核中解释差异；尚未接SDK的URI、父对象与字段返回形态不能擅自宣布等价。',
 '下一阶段应优先保留显式约束并验证目标身份，扩展确定性时间规范化和解析覆盖，检查写操作的占位ID、缺字段与冲突信息，再以独立新表达做盲测及重复计时。当前ready_mock只表示伪接口计划通过部分契约，没有读取或修改真实业务数据；夹具位置、地理编码、天气可用性及所选对象都明确标记。'
];
const analysis={manifestId:manifest.id,promptVersion:manifest.conditions.promptVersion,status:'final',final:true,reviewedCalls:1200,generatedAt:new Date().toISOString(),paragraphs,domainNarratives,reviewSources:['docs/domain-core-analysis-sparse.json','docs/domain-other-analysis-sparse.json'],verificationSource:'docs/domain-run-verification.json',limits:['公开开发集，非独立留出集','每题一次，不代表耗时稳定性或生产分布','严格契约评分保留，不以人工解释重打分','伪业务回执，未验证Huawei SDK业务结果']};
await writeFile(join(root,'docs/domain-analysis.json'),JSON.stringify(analysis,null,2));
console.log(`最终人工说明生成：${analysis.reviewedCalls}条，${domainNarratives.length}领域`);
