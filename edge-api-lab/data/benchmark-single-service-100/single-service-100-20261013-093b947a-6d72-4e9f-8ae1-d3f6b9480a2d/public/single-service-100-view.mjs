import {api,escapeHtml as esc,pretty,percent,duration,domainName,stageName,notice,empty,downloadJson} from './ui-utils.mjs';

const legacyModelOrder=['qwen2.5:1.5b','qwen2.5:3b','qwen2.5:0.5b'];
const domains=['weather','calendar','contacts','files','services','cloud','device','connectivity','location','media'];
const states={not_started:'尚未开始',queued:'排队中',running:'实测中',completed:'已完成',failed:'未完成 / 失败',interrupted:'已中断',cancelled:'已停止',partial:'部分结果'};
const failureNames={domain:'领域错误',api:'API 错误',parameters:'参数错误',status_or_constraint:'状态 / 约束错误',gold_contract:'金标契约疑点',provider_timeout:'提供方超时',provider_contract:'提供方 / 输出结构错误',rule_error:'工程后处理异常',correct:'正确'};
const number=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
const order=(rows,models)=>[...rows].sort((a,b)=>(models.indexOf(a.model)<0?99:models.indexOf(a.model))-(models.indexOf(b.model)<0?99:models.indexOf(b.model)));
const positive=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
export function singleService100Plan(report={}) {
  const declared=report.conditions?.models ?? report.conditions?.modelOrder;
  const models=Array.isArray(declared)&&declared.some(name=>typeof name==='string'&&name)?[...new Set(declared.filter(name=>typeof name==='string'&&name))]:legacyModelOrder;
  const cases=positive(report.corpus?.total)||positive(report.conditions?.requestsPerModel)||positive(report.conditions?.callsPerModel)||1000;
  const perDomain=positive(report.corpus?.perDomain)||100;
  const totalCalls=positive(report.conditions?.totalRequests)||positive(report.conditions?.totalCalls)||positive(report.progress?.total)||cases*models.length;
  return {models,cases,perDomain,domainCount:Math.ceil(cases/perDomain),totalCalls};
}
export function singleService100ModelOptions(report={},selected='') {
  return `<option value="">全部模型 · 按报告顺序</option>${singleService100Plan(report).models.map(name=>`<option value="${esc(name)}"${name===selected?' selected':''}>${esc(name)}</option>`).join('')}`;
}
export const shouldPollSingleService100Report=(status,active=false)=>active&&['queued','running'].includes(status);
export const safeSingleService100DetailPath=path=>typeof path==='string'&&/^\/api\/single-service-100-run\/qwen2\.5-(?:0\.5|1\.5|3|7)b\/e100-(?:weather|calendar|contacts|files|services|cloud|device|connectivity|location|media)-\d{3}(?:\?manifestId=[a-zA-Z0-9][a-zA-Z0-9._-]{0,180})?$/.test(path)?path:null;
function detailRequestPath(path,manifestId) {
  if(!safeSingleService100DetailPath(path))return null;
  const url=new URL(path,'http://localhost'),bound=url.searchParams.get('manifestId');
  if(bound&&manifestId&&bound!==manifestId)return null;
  if(manifestId)url.searchParams.set('manifestId',manifestId);
  return safeSingleService100DetailPath(url.pathname+url.search);
}
export function singleService100ResultsPath({model='',domain='',failed=true,manifestId=''}={}) {
  const query=new URLSearchParams();if(model)query.set('model',model);if(domain)query.set('domain',domain);if(failed)query.set('failed','true');if(manifestId)query.set('manifestId',manifestId);
  return `/api/single-service-100-results${query.size?`?${query}`:''}`;
}
export function filterSingleService100Rows(rows=[],{model='',domain='',failed=true}={}) {
  return rows.filter(row=>(!model||row.model===model)&&(!domain||row.testDomain===domain)&&(!failed||(row.primary?row.primary!=='correct':Boolean(row.error)||row.execution?.plan===false||row.rawScore?.plan===false)));
}
const argumentsText=value=>value==null?'—（未取得）':pretty(value);
const metric=(value,total)=>number(total)>0&&number(value?.total)>0?`${percent(value.accuracy)} <span class="muted small">${esc(value.correct ?? '—')}/${esc(value.total)}</span>`:'—';
const failures=row=>Object.entries(row.primaryFailures || {}).filter(([key,count])=>key!=='correct'&&number(count)>0).map(([key,count])=>`${failureNames[key] || key} ${count}`).join('；') || '—';
const memory=value=>positive(value)?`${(Number(value)/1024**3).toFixed(1)} GiB`:'未采集';
const measured=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const timeText=value=>measured(value)?duration(value):'未采集';
const countText=value=>Number.isInteger(value)&&value>=0?String(value):'未采集';
const modeOf=report=>report.conditions?.mode || report.mode || 'unified';
const modeText=mode=>({adaptive:'adaptive 多阶段 · Qwen 智能分步',unified:'unified 一次调用',staged:'staged 固定分层',laya:'Laya 本机选择 + Qwen 填参',jev:'Jev 云端选择 + Qwen 填参'}[mode] || mode || '模式未记录');
function stageTimingTable(timing) {
  const stages=Array.isArray(timing?.stages)?timing.stages:[];
  if(!stages.length)return '<p class="helper">阶段耗时未采集；不从案例总时间反推单次模型调用。</p>';
  return `<div class="summary-scroller"><table class="data-table"><thead><tr><th>阶段</th><th>实际调用</th><th>累计</th><th>均值</th><th>典型耗时 (P50)</th><th>较慢耗时 (P95)</th><th>失败尝试</th></tr></thead><tbody>${stages.map(stage=>`<tr><td>${esc(stageName(stage.stage))}</td><td>${countText(stage.calls)}</td><td>${timeText(stage.totalMs)}</td><td>${timeText(stage.meanMs)}</td><td>${timeText(stage.p50Ms)}</td><td>${timeText(stage.p95Ms)}</td><td>${countText(stage.errors)}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderTiming(report,summary) {
  const timing=report.totalTiming,elapsed=report.executionElapsed;
  return `<section class="panel report-panel"><h2>实际模型调用与耗时</h2><p class="helper">全批次 · ${report.shadowComparison?'Qwen 权威模型调用':'实际模型调用'} ${countText(report.metrics?.actualCallCount ?? timing?.actualCallCount)} 次 · 每案例平均调用 ${measured(timing?.meanCalls)?timing.meanCalls.toFixed(2):'未采集'}</p><p class="helper">完整请求累计 ${timeText(timing?.requestTotalMs)} · 请求均值 ${timeText(timing?.requestMeanMs)} · 模型调用累计 ${timeText(timing?.modelCallTotalMs)}</p><p class="helper">批次运行耗时 ${timeText(elapsed?.elapsedMs)}${elapsed?.includesWarmups===true?'（含预热）':''}。按清单执行窗口统计，运行中截至最近保存快照；不从页面刷新时间推算。</p><p class="helper">上述计划数量指案例请求；一个请求可能含多次模型调用。准确率分母仍是已完成案例，预热单独记录。${report.shadowComparison?'Laya 影子调用独立计数，不加入此处 Qwen 流水线统计。':''}${timing?`耗时轨迹覆盖 ${countText(timing.knownRequests)} / ${number(report.progress?.done)} 个已完成案例${timing.complete===false?'，当前轨迹不完整，未知时间不补 0':''}。`:'旧记录缺少阶段轨迹时，模型调用次数与累计时间保持未采集。'}</p><h3>每阶段耗时 · 全批次</h3>${stageTimingTable(timing)}<p class="helper">50% / 95% 请求在相应时间内完成；阶段表按该阶段的已发生调用统计，错误尝试也保留。完整请求耗时还包含规则处理；模型累计与批次运行耗时分别展示。</p>${summary.length?`<details class="raw-details"><summary>按模型查看阶段耗时</summary>${summary.map(row=>`<h3>${esc(row.model)}</h3><p class="helper">${number(row.total)} 个案例 · 实际模型调用 ${countText(row.timing?.actualCallCount)} 次 · 完整请求累计 ${timeText(row.timing?.requestTotalMs)} · 模型调用累计 ${timeText(row.timing?.modelCallTotalMs)}</p>${stageTimingTable(row.timing)}`).join('')}</details>`:''}${report.warmupTiming?`<details class="raw-details"><summary>预热耗时 · 不合并正式案例</summary><pre>${pretty(report.warmupTiming)}</pre></details>`:''}</section>`;
}
function renderRowTimings(row) {
  const traces=Array.isArray(row.traceTimings)?row.traceTimings:null;
  const count=row.actualCallCount ?? traces?.length;
  return `<div class="helper">请求总耗时 ${timeText(row.wallMs)} · ${countText(count)} 次模型调用</div>${traces?`<details class="raw-details"><summary>逐阶段耗时</summary>${traces.map(trace=>`<p class="helper">${esc(stageName(trace.stage))} · ${timeText(trace.wallMs)}${trace.provider?` · ${esc(trace.provider)}`:''}${trace.error?' · 失败尝试':''}</p>`).join('') || '<p class="helper">无已发生的模型调用。</p>'}</details>`:'<p class="helper">阶段耗时未采集</p>'}`;
}
function recallBreakdown(row) {
  const known=Number.isInteger(row.domainGateMiss)&&Number.isInteger(row.budgetRecallMisses);
  return known?`<td>${countText(row.domainGateMiss)}</td><td>${countText(row.budgetRecallMisses)}</td><td>${metric(row.candidateRecallEligible,row.total)}</td>`:`<td colspan="3">历史漏选未分层：${countText(row.retrievalMisses)}；领域误判与预算漏选未知</td>`;
}
function renderBaselineComparison(report,{model='',domain=''}={}) {
  const comparison=report.baselineComparison;if(!comparison)return '';
  const rows=((domain?comparison.cells:comparison.summary) || []).filter(row=>(!model||row.model===model)&&(!domain||row.testDomain===domain));
  const pairedComplete=row=>row.paired===true&&row.current?.complete===true&&row.baseline?.complete===true&&row.current.total===row.current.planned&&row.baseline.total===row.baseline.planned;
  const accuracyDelta=value=>typeof value==='number'&&Number.isFinite(value)?`${value>=0?'+':''}${(value*100).toFixed(1)} 个百分点`:'未提供';
  const latencyDelta=value=>typeof value==='number'&&Number.isFinite(value)?`${value>=0?'+':'−'}${duration(Math.abs(value))}`:'未提供';
  return `<section class="panel comparison-panel"><h2>昨日 unified 一次调用基线 · 并排比较</h2><p class="helper">本轮 ${esc(modeText(modeOf(report)))}；昨日 ${esc(modeText(comparison.mode || 'unified'))}。基线 ${esc(comparison.id || '未登记')}，固定快照保留；不重新调用历史模型。</p>${rows.length?`<div class="summary-scroller"><table class="data-table"><thead><tr><th>模型 / 范围</th><th>本轮 / 基线样本</th><th>API · 本轮 / 昨日</th><th>原始参数 · 本轮 / 昨日</th><th>执行语义 · 本轮 / 昨日</th><th>请求 P50 · 本轮 / 昨日</th><th>请求 P95 · 本轮 / 昨日</th><th>差值 · 本轮减基线</th></tr></thead><tbody>${rows.map(row=>`<tr><td class="mono">${esc(row.model)}${row.testDomain?`<div>${esc(domainName(row.testDomain))}</div>`:''}</td><td>${countText(row.current?.total)} / ${countText(row.baseline?.total)}</td><td>${metric(row.current?.api,row.current?.total)} / ${metric(row.baseline?.api,row.baseline?.total)}</td><td>${metric(row.current?.rawArguments,row.current?.total)} / ${metric(row.baseline?.rawArguments,row.baseline?.total)}</td><td>${metric(row.current?.semantics,row.current?.total)} / ${metric(row.baseline?.semantics,row.baseline?.total)}</td><td>${number(row.current?.total)>0?timeText(row.current?.p50Ms):'—'} / ${number(row.baseline?.total)>0?timeText(row.baseline?.p50Ms):'—'}</td><td>${number(row.current?.total)>0?timeText(row.current?.p95Ms):'—'} / ${number(row.baseline?.total)>0?timeText(row.baseline?.p95Ms):'—'}</td><td>${pairedComplete(row)&&row.delta?`执行语义 ${accuracyDelta(row.delta.semantics)}<div class="helper">P50 ${latencyDelta(row.delta.p50Ms)} · P95 ${latencyDelta(row.delta.p95Ms)}</div>`:`不计算差值<div class="helper">${esc(row.reason || '尚未取得两侧同范围的完整可比结果')}</div>`}</td></tr>`).join('')}</tbody></table></div>`:empty('该范围尚无基线对照')}<p class="helper">提示词、召回与规则版本以及运行资源状态可能不同，差值只作观察，不单独归因调用方式。只有同语料、同范围两侧均完成，才显示报告已计算的差值；本轮部分结果与昨日全量分母各自标明，不能混成同一准确率。</p>${(comparison.notes || []).map(note=>`<p class="helper">${esc(note)}</p>`).join('')}<details class="raw-details"><summary>基线来源与可比条件</summary><pre>${pretty({id:comparison.id,reportSha256:comparison.reportSha256,corpusSha256:comparison.corpusSha256,mode:comparison.mode,conditions:comparison.conditions})}</pre></details></section>`;
}
function renderShadowComparison(report,{model='',domain=''}={}) {
  const comparison=report.shadowComparison;if(!comparison)return '';
  const scopes=((domain?comparison.cells:comparison.summary) || []).filter(row=>(!model||row.model===model)&&(!domain||row.testDomain===domain));
  const entries=scopes.flatMap(scope=>['domain','api'].filter(key=>scope[key]).map(key=>({scope,key,stage:scope[key]})));
  const shadowMetric=value=>`${metric(value,value?.total)}${Number.isInteger(value?.knownTotal)?` <span class="helper">可判定 ${value.knownTotal}/${countText(value.total)}</span>`:''}`;
  const selection=(group,provider)=>shadowMetric(group?.[provider]?.selection);
  const contract=(group,provider)=>shadowMetric(group?.[provider]?.contract);
  const label=({scope,key})=>`${esc(scope.model)}${scope.testDomain?` · ${esc(domainName(scope.testDomain))}`:''} · ${key==='domain'?'领域':'API'}`;
  const rateRows=entries.map(entry=>{const {stage}=entry,coverage=stage.coverage || {};return `<tr><td class="mono">${label(entry)}<div class="helper">Qwen ${esc((stage.primaryStages || []).map(stageName).join(' / ') || '阶段未记录')}</div></td><td>${countText(coverage.observed)} / ${countText(coverage.requests)}<div class="helper">计划 ${countText(coverage.planned)} · 影子记录 ${countText(coverage.knownRequests)} / ${countText(coverage.requests)} · 阶段未发生 ${countText(coverage.missing)}</div></td><td>${selection(stage.observed,'primary')}</td><td>${selection(stage.observed,'laya')}</td><td>Qwen ${selection(stage.eligible,'primary')}<br>Laya ${selection(stage.eligible,'laya')}</td><td>${metric(stage.agreement,stage.agreement?.total)}</td></tr>`;}).join('');
  const timeRows=entries.map(entry=>{const {stage}=entry;return `<tr><td class="mono">${label(entry)}</td><td>${countText(stage.primaryTiming?.calls)} / ${countText(stage.layaTiming?.calls)}</td><td>${timeText(stage.primaryTiming?.totalMs)} / ${timeText(stage.layaTiming?.totalMs)}</td><td>${timeText(stage.primaryTiming?.meanMs)} / ${timeText(stage.layaTiming?.meanMs)}</td><td>${timeText(stage.primaryTiming?.p50Ms)} / ${timeText(stage.layaTiming?.p50Ms)}</td><td>${timeText(stage.primaryTiming?.p95Ms)} / ${timeText(stage.layaTiming?.p95Ms)}</td><td>${countText(stage.primaryTiming?.errors)} / ${countText(stage.layaTiming?.errors)}</td></tr>`;}).join('');
  return `<section class="panel comparison-panel"><h2>Laya 并行影子对照</h2><p class="helper"><strong>后续由 Qwen 决定，不影响 Qwen 原评分；不是 Laya 完整流程成功率。</strong>两者使用同候选，Laya 领域选择只评分，API 影子读取 Qwen 选域及该次候选；参数始终由 Qwen 提取。</p><p class="helper">本批为 CPU 并行资源竞争条件。Qwen 联合 API 选择与参数提取，对比 Laya 只选择 API，属于不同任务；耗时不能直接解释为模型性能优劣。与昨日独占 unified 的速度差值也仅作观察，不归因调用方式。</p>${number(report.progress?.done)===0?empty('影子对照尚无已完成结果','未执行或未观测阶段不生成正确率。'):entries.length?`<div class="summary-scroller"><table class="data-table"><thead><tr><th>模型 / 阶段</th><th>全请求对照覆盖</th><th>Qwen · 已观测选择正确率</th><th>Laya · 已观测选择正确率</th><th>目标可见子集 · 正确率</th><th>相同选择率</th></tr></thead><tbody>${rateRows}</tbody></table></div><p class="helper">选择正确率的分母是实际决策数；目标可见子集只含金标选项在该次候选中可见的决策。全请求覆盖另列，未执行阶段不算正确。</p><h3>影子与权威阶段耗时 · Qwen / Laya</h3><div class="summary-scroller"><table class="data-table"><thead><tr><th>模型 / 阶段</th><th>调用数</th><th>累计</th><th>均值</th><th>P50</th><th>P95</th><th>Qwen / Laya · 失败尝试</th></tr></thead><tbody>${timeRows}</tbody></table></div><details class="raw-details"><summary>全请求分母评分与结构有效率</summary>${entries.map(entry=>`<h3>${label(entry)}</h3><p class="helper">全请求选择匹配：Qwen ${selection(entry.stage.all,'primary')} / Laya ${selection(entry.stage.all,'laya')}；不是纯选择器调用精度，缺失阶段未记为正确。</p><p class="helper">已观测结构有效率：Qwen ${contract(entry.stage.observed,'primary')} / Laya ${contract(entry.stage.observed,'laya')}</p>`).join('')}</details><p class="helper">全批次并行请求区间累计 ${timeText(comparison.combinedRequestTiming?.totalMs)} · 均值 ${timeText(comparison.combinedRequestTiming?.meanMs)}；等待影子收尾累计 ${timeText(comparison.drainTiming?.totalMs)}。当前已观测请求 ${countText(comparison.observedRequests)} / ${countText(comparison.requests)}。</p>`:empty('该范围尚无影子对照','不借用其他模型或领域的分数。')}${(comparison.notes || []).map(note=>`<p class="helper">${esc(note)}</p>`).join('')}</section>`;
}
function renderRowShadow(row) {
  const shadow=row.shadow;if(!shadow)return '';
  const check=value=>value===true?'✓':value===false?'×':'未观测';
  const decisionSide=(label,side)=>`<p class="helper"><strong>${label}</strong> ${esc(side?.selected ?? '未输出')} · 选择 ${check(side?.selectionCorrect)} · 结构 ${check(side?.contractValid)} · ${timeText(side?.wallMs)}${side?.error?` · ${esc(side.error)}`:''}</p>`;
  return `<details class="raw-details"><summary>逐例 Laya 影子 · Qwen 权威</summary><p class="helper">影子只评分选择；Qwen 决定后续 API 和参数。并行区间 ${timeText(shadow.combinedWallMs)} · 等待影子收尾 ${timeText(shadow.drainMs)} · Qwen 主链路 ${timeText(shadow.primaryWallMs)}</p>${(Array.isArray(shadow.decisions)?shadow.decisions:[]).map(decision=>`<h3>${decision.stage==='domain'?'领域':'API'} · Qwen ${esc(stageName(decision.primaryStage))}</h3><p class="helper">${decision.stage==='intent'?'目标 API':'目标选项'} ${decision.expectedInCandidates===true?'可见':decision.expectedInCandidates===false?'不可见':'可见性未观测'} · 两者选择 ${decision.agreement===true?'相同':decision.agreement===false?'不同':'未观测'}</p>${decisionSide('Qwen',decision.primary)}${decisionSide('Laya',decision.laya)}<details class="raw-details"><summary>共同候选</summary><pre>${pretty(decision.candidateIds ?? null)}</pre></details><details class="raw-details"><summary>Laya 原始响应与独立轨迹</summary><pre>${typeof decision.laya?.trace?.raw==='string'?esc(decision.laya.trace.raw):pretty(decision.laya?.trace?.raw ?? null)}</pre><pre>${pretty(decision.laya?.trace ?? null)}</pre></details>`).join('') || '<p class="helper">本例未保存影子决策。</p>'}</details>`;
}
const fraction=value=>measured(value)&&value<=1;
const completeResidency=sample=>sample?.status==='observed'&&positive(sample.observedSamples)&&measured(sample.cpuBytes)&&measured(sample.gpuBytes)&&sample.cpuBytes+sample.gpuBytes>0&&fraction(sample.gpuFraction)&&positive(sample.contextLength);
function renderResidency(report,models) {
  const environment=report.inferenceEnvironment || {},samples=Array.isArray(environment.models)?environment.models:[];
  const observed=models.filter(name=>completeResidency(samples.find(sample=>sample.name===name))).length;
  const summary=observed?`已取得 ${observed} 个模型的完整驻留采样；其余模型的分担状态以表内记录为准。`:'推理设备未采样，不能判断 CPU / GPU 分担。';
  const rows=models.map(name=>{
    const sample=samples.find(item=>item.name===name);
    if(!completeResidency(sample))return `<tr><td class="mono">${esc(name)}</td><td colspan="6">${number(sample?.sampleCount)>0?'采样未取得完整驻留信息':'尚未采样'} · CPU / GPU 分担未知</td></tr>`;
    const range=fraction(sample.minGpuFraction)&&fraction(sample.maxGpuFraction)?`${percent(sample.minGpuFraction)} ～ ${percent(sample.maxGpuFraction)}`:'范围未采集';
    return `<tr><td class="mono">${esc(name)}</td><td>${sample.observedSamples} / ${number(sample.sampleCount)}</td><td>${(sample.cpuBytes/1024**3).toFixed(1)} GiB</td><td>${(sample.gpuBytes/1024**3).toFixed(1)} GiB</td><td>${percent(sample.gpuFraction)}<div class="helper">${range}</div></td><td>${number(sample.contextLength)}</td><td>${esc(sample.at || '时间未采集')}</td></tr>`;
  }).join('');
  return `<p class="helper">${summary}</p><details class="raw-details"><summary>CPU / GPU 驻留采样（offload）</summary><p class="helper">来源 ${esc(environment.source || '/api/ps（尚无采样）')}。驻留量和 GPU 占比取最后一次完整采样，范围为已取得的完整采样。它们不是 CPU / GPU 处理器利用率，不用显卡型号推断运行设备。</p><div class="summary-scroller"><table class="data-table"><thead><tr><th>模型</th><th>完整 / 总采样数</th><th>CPU 驻留</th><th>GPU 驻留</th><th>GPU 占比 / 采样范围</th><th>实际上下文</th><th>最近完整采样时间</th></tr></thead><tbody>${rows}</tbody></table></div>${(Array.isArray(environment.notes)?environment.notes:[]).map(note=>`<p class="helper">${esc(note)}</p>`).join('')}</details>`;
}
export function renderSingleService100Environment(report={}) {
  const conditions=report.conditions || {},hardware=conditions.hardware,plan=singleService100Plan(report);
  const os=hardware?.os || {};
  const machine=hardware?`<p>${esc(hardware.cpu || 'CPU 未采集')} · ${positive(hardware.physicalCores)?`${number(hardware.physicalCores)} 核`:'物理核数未采集'} / ${positive(hardware.logicalCores)?`${number(hardware.logicalCores)} 线程`:'线程数未采集'} · 内存 ${memory(hardware.totalMemoryBytes)}</p><p>${esc([os.name || os.version,os.platform || hardware.platform,os.release,os.build?`Build ${os.build}`:null,os.architecture].filter(Boolean).join(' · ') || '操作系统未采集')} · Node ${esc(hardware.nodeVersion || '未采集')} · Ollama ${esc(hardware.ollamaVersion || '未采集')}</p><p class="helper">检测到的显卡：${Array.isArray(hardware.gpus)&&hardware.gpus.length?hardware.gpus.map(gpu=>`${esc(gpu.name || '名称未采集')} · 驱动 ${esc(gpu.driverVersion || '未采集')}${positive(gpu.adapterMemoryBytes)?` · 适配器内存 ${memory(gpu.adapterMemoryBytes)}`:''}`).join('；'):'未采集'}。显卡存在不证明模型使用 GPU。</p>`:'<p class="helper">本报告未采集电脑环境，不能借用当前机器配置解释历史成绩。</p>';
  const details=Array.isArray(conditions.modelDetails)?conditions.modelDetails:[];
  const specifications=plan.models.map(name=>{
    const detail=details.find(item=>item.name===name),spec=detail?.details || {};
    return `<tr><td class="mono">${esc(name)}</td><td>${detail?`${esc(spec.parameter_size || '参数量未采集')} · ${esc(spec.quantization_level || '量化未采集')} · ${esc(spec.family || '架构未采集')}`:'规格未采集'}</td><td>${detail?memory(detail.size):'未采集'}</td><td><code style="overflow-wrap:anywhere">${esc(detail?.digest || 'digest 未采集')}</code></td></tr>`;
  }).join('');
  return `<section class="panel report-panel" aria-label="真实推理电脑与模拟上下文"><h2>真实推理电脑环境</h2>${machine}${renderResidency(report,plan.models)}<p class="helper"><strong>模拟手机上下文：</strong>位置、时钟、网络句柄和音频场景是固定 fixture；未连接 Harmony 真机。电脑的推理耗时是实际测量，手机业务 API 仍是伪回执。</p><details class="raw-details"><summary>版本、参数、模型规格与环境采集详情</summary><div class="summary-scroller"><table class="data-table"><thead><tr><th>模型</th><th>参数量 / 量化 / 架构</th><th>权重文件体积</th><th>digest</th></tr></thead><tbody>${specifications}</tbody></table></div><h3>推理版本与参数</h3><pre>${pretty({mode:conditions.mode,catalogVersion:conditions.catalogVersion,promptVersion:conditions.promptVersion,promptVersions:conditions.promptVersions,groundingVersion:conditions.groundingVersion,options:conditions.options,modelDirectory:conditions.modelDirectory})}</pre><h3>环境采集来源与完整规格</h3><pre>${pretty({hardware:hardware ?? null,modelDetails:details,inferenceEnvironment:report.inferenceEnvironment ?? null})}</pre></details></section>`;
}
function summaryBreakdown(rows) {
  return rows.map(row=>`<h3>${esc(row.model)}</h3>${number(row.total)>0?`<p>${esc(failures(row))}</p>${(row.origins || []).map(origin=>`<p class="helper">${esc(origin.origin)} · ${number(origin.total)} 次 · API ${metric(origin.api,origin.total)} · 原始参数 ${metric(origin.rawArguments,origin.total)} · 最终语义 ${metric(origin.semantics,origin.total)}</p>`).join('')}<p class="helper">已知契约边界 ${number(row.contractBoundaryCount)} 条；同一参数错误可能含多处差异，差异数不能相加为失败数。</p>`:'<p class="helper">尚无已完成调用，主错因和分层分数未计算。</p>'}`).join('');
}
function summaryTable(rows,{cell=false,models=legacyModelOrder}={}) {
  return `<div class="summary-scroller"><table class="data-table summary-table"><thead><tr><th>${cell?'模型 / 领域':'模型 / 进度'}</th><th>领域</th><th>API</th><th>原始参数 · 严格</th><th>最终执行语义</th><th>可执行请求语义</th><th>安全非就绪</th><th>P50 / P95</th><th>提供方错误</th><th>领域误判 · 候选不可见</th><th>正确领域 · 预算漏选</th><th>正确领域召回</th><th>候选内错选</th></tr></thead><tbody>${order(rows,models).map(row=>`<tr><td><span class="mono">${esc(row.model)}</span>${cell?`<div>${esc(domainName(row.testDomain))}</div>`:''}<div class="helper">${number(row.total)} / ${number(row.planned) || (cell?100:1000)}${number(row.total)>0&&!row.complete?' · 部分结果':''}</div></td><td>${metric(row.domain,row.total)}</td><td>${metric(row.api,row.total)}</td><td>${metric(row.rawArguments,row.total)}</td><td>${metric(row.semantics,row.total)}</td><td>${metric(row.readyRequestSemantics,row.total)}</td><td>${metric(row.safeNonReady,row.total)}</td><td class="mono">${number(row.total)>0?`${duration(row.p50Ms)} / ${duration(row.p95Ms)}`:'—'}</td><td>${number(row.total)>0?number(row.providerErrors):'—'}</td>${number(row.total)>0?recallBreakdown(row):'<td>—</td><td>—</td><td>—</td>'}<td>${number(row.total)>0?countText(row.wrongApiWithCandidate):'—'}</td></tr>`).join('')}</tbody></table></div>`;
}
export function renderSingleService100Rows(rows=[],{page=0,pageSize=20,full=false}={}) {
  const pages=Math.max(1,Math.ceil(rows.length/pageSize)),current=Math.max(0,Math.min(page,pages-1));
  const visible=rows.slice(current*pageSize,(current+1)*pageSize);
  return `<div class="panel table-wrap evaluation-results"><div class="panel-title"><h2>${full?'完整逐例列表快照':'错误样例'} <span class="muted small">${rows.length} 条</span></h2><div class="header-actions"><button type="button" class="button small secondary" data-single100-page="prev" ${current===0?'disabled':''}>‹</button><span class="muted small">${current+1} / ${pages}</span><button type="button" class="button small secondary" data-single100-page="next" ${current===pages-1?'disabled':''}>›</button></div></div>${visible.length?`<div class="summary-scroller"><table class="data-table"><thead><tr><th>案例 / 模型</th><th>预期 / 实际 API 与状态</th><th>原始参数 / 补全后参数</th><th>错因 / 详情</th></tr></thead><tbody>${visible.map((row,index)=>`<tr><td class="prompt-cell">${esc(row.text)}<div class="helper mono">${esc(row.model)} · ${esc(row.caseId)}</div><div class="helper">${esc(domainName(row.testDomain))} · ${esc(row.origin || '来源未标记')}</div>${renderRowTimings(row)}${renderRowShadow(row)}</td><td><div>预期：<span class="mono">${esc(row.expectedApi ?? row.expected?.api ?? '—')}</span></div><div>实际：<span class="mono">${esc(row.actualApi ?? row.actual?.api ?? '—')}</span></div><div class="helper">状态：${esc(row.expectedStatus ?? row.expected?.status ?? '—')} → ${esc(row.status ?? row.actual?.status ?? '—')}</div><details class="raw-details"><summary>预期参数</summary><pre>${argumentsText(row.expectedArguments ?? row.expected?.arguments)}</pre></details></td><td><details class="raw-details"><summary>模型原始参数</summary><pre>${argumentsText(row.modelArguments ?? row.extractedArguments)}</pre></details><details class="raw-details"><summary>规则补全后参数</summary><pre>${argumentsText(row.groundedArguments)}</pre></details><p class="helper">严格参数：${row.rawScore?.arguments===true?'✓':row.rawScore?.arguments===false?'×':'—'} · 执行语义：${row.execution?.plan===true?'✓':row.execution?.plan===false?'×':'—'}</p></td><td>${esc(failureNames[row.primary] || row.primary || '—')}${row.error?`<p class="helper">${esc(row.error)}</p>`:''}${row.differences?.length?`<details class="raw-details"><summary>差异</summary><pre>${pretty(row.differences)}</pre></details>`:''}<button type="button" class="button small secondary" data-single100-detail="${current*pageSize+index}" ${safeSingleService100DetailPath(row.detailPath)?'':'disabled'}>原始调用详情</button></td></tr>`).join('')}</tbody></table></div>`:empty(full?'没有匹配的已完成调用':'没有匹配的错误样例','这里不是完整成功率证明；已完成数量和评分见上方。')}</div>`;
}
export function renderSingleService100Report(report,{model='',domain='',rows=null,page=0,failed=true}={}) {
  const plan=singleService100Plan(report),done=number(report.progress?.done),total=plan.totalCalls;
  const partial=report.status!=='completed'&&done>0;
  const activity=report.active?`${report.active.model || ''} · ${domainName(report.active.testDomain)} · ${report.active.caseId || ''} · ${report.active.phase || ''}`:'';
  const summary=order(report.summary || [],plan.models).filter(row=>!model||row.model===model);
  const cells=order(report.cells || [],plan.models).filter(row=>(!model||row.model===model)&&(!domain||row.testDomain===domain));
  const shown=filterSingleService100Rows(rows ?? report.examples ?? [],{model,domain,failed});
  return `<div class="panel job-panel"><div class="job-top"><h2>千题单服务实测 · ${esc(states[report.status] || report.status || '状态待确认')}</h2><span class="muted">只读结果，不启动推理</span></div><p class="helper"><strong>${esc(modeText(modeOf(report)))}</strong> · 批次 ${esc(report.id || '未登记')} · ${esc(report.createdAt || '创建时间未采集')}</p><div class="job-progress" role="progressbar" aria-label="千题案例请求完成进度" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${Math.min(done,total)}"><div style="width:${Math.min(100,done/total*100)}%"></div></div><div class="job-progress-label"><span>${done} / ${total} 个案例请求${partial?' · 部分结果，未完成不计入分母':''}</span><span>${esc(plan.models.map(name=>name.replace(/^qwen2\.5:/,'').toUpperCase()).join(' → '))}</span></div>${activity?`<p class="helper mono">当前：${esc(activity)}</p>`:''}${report.error?notice(typeof report.error==='string'?report.error:JSON.stringify(report.error),'warning'):''}<p class="helper">${plan.domainCount} 领域 × 每领域 ${plan.perDomain} 条 × ${plan.models.length} 模型，共 ${total} 个案例请求。模型与顺序以本报告固定条件为准；预热不计分。</p></div>${renderTiming(report,summary)}${renderSingleService100Environment(report)}${renderBaselineComparison(report,{model,domain})}${renderShadowComparison(report,{model,domain})}${done?`<div class="panel comparison-panel"><h2>模型对照${partial?' · 已完成部分':''}</h2>${summaryTable(summary,{models:plan.models})}<p class="helper">提供方失败计入已完成调用分母；未执行样本不当作 0 分。执行语义包含正确澄清 / 安全非就绪，不等于服务全执行成功率。原始参数与补全后语义分开。领域误判会使目标域 API 不可见；正确领域召回以 eligible 请求为分母，预算漏选单列，旧未分层漏选不能归因预算。</p><details class="raw-details"><summary>主错因与既有 100 / 新增 900 分层</summary>${summaryBreakdown(summary)}</details></div><div class="panel comparison-panel"><h2>分领域对照</h2>${summaryTable(cells,{cell:true,models:plan.models})}</div>`:empty('尚无实测数据','尚未完成正式调用，准确率与耗时不显示为 0；本页不会启动模型。')}${renderSingleService100Rows(shown,{page,full:rows!==null})}<details class="panel report-panel raw-details"><summary>实验边界、用例覆盖与固定条件</summary><p class="helper">当前位置指未来手机：现阶段只提供 fixture 手机位置 mock，不读取电脑 GPS / 浏览器定位。真实 Harmony 宿主与业务执行尚未验证。</p>${(report.notes || []).map(note=>`<p class="helper">${esc(note)}</p>`).join('')}<h3>覆盖与已知契约边界</h3><pre>${pretty(report.corpus)}</pre><h3>固定条件</h3><pre>${pretty(report.conditions)}</pre></details>`;
}

export function createSingleService100View({showRun,toast,onRefresh=()=>{}}) {
  const box=document.querySelector('#single-service-100-content');
  let active=false,initialized=false,report=null,timer,busy=false,indexBusy=false,indexRows=null,page=0,indexGeneration=0;
  const filters={model:'',domain:'',failed:true};
  const currentRows=()=>filterSingleService100Rows(indexRows ?? report?.examples ?? [],filters);
  function initialize() {
    if(initialized)return;initialized=true;
    box.innerHTML=`<div class="panel report-toolbar"><div class="report-actions"><button type="button" id="single100-refresh" class="button secondary">刷新进度</button><button type="button" id="single100-export" class="button secondary" disabled>下载报告 JSON</button><button type="button" id="single100-index" class="button secondary" disabled>载入完整逐例列表</button><button type="button" id="single100-index-export" class="button secondary" disabled>下载列表 JSON</button></div><div class="report-filters"><div><label for="single100-model" class="field-label">模型</label><select id="single100-model">${singleService100ModelOptions(report || {})}</select></div><div><label for="single100-domain" class="field-label">领域</label><select id="single100-domain"><option value="">全部十领域</option>${domains.map(domain=>`<option value="${domain}">${esc(domainName(domain))}</option>`).join('')}</select></div><label class="check-inline"><input type="checkbox" id="single100-failed" checked>仅看错误</label></div><p id="single100-poll-status" class="helper" aria-live="polite"></p><p class="helper">默认样例按模型 / 领域 / 错因限量；完整列表按需读取。列表是已完成调用的快照，运行中可重新载入。</p><div id="single100-error"></div></div><div id="single100-results"></div>`;
    box.querySelector('#single100-refresh').addEventListener('click',load);
    box.querySelector('#single100-export').addEventListener('click',()=>{if(report)downloadJson(report,`single-service-100-${report.id || 'report'}.json`);});
    box.querySelector('#single100-index').addEventListener('click',loadIndex);
    box.querySelector('#single100-index-export').addEventListener('click',()=>{if(indexRows!==null)downloadJson({filters,rows:indexRows},'single-service-100-results.json');});
    for(const [id,key] of [['single100-model','model'],['single100-domain','domain'],['single100-failed','failed']])box.querySelector(`#${id}`).addEventListener('change',event=>{filters[key]=key==='failed'?event.target.checked:event.target.value;page=0;const hadIndex=indexRows!==null;indexRows=null;++indexGeneration;box.querySelector('#single100-index-export').disabled=true;render();if(hadIndex)loadIndex();});
    box.querySelector('#single100-results').addEventListener('click',async event=>{
      const pager=event.target.closest('[data-single100-page]');if(pager&&!pager.disabled){page+=pager.dataset.single100Page==='next'?1:-1;render();return;}
      const button=event.target.closest('[data-single100-detail]');if(!button||button.disabled)return;
      const manifestId=report?.id,row=currentRows()[Number(button.dataset.single100Detail)],path=detailRequestPath(row?.detailPath,manifestId);
      if(!path){toast('详情不属于当前批次或路径无效，请刷新后重试');return;}
      button.disabled=true;
      try{const record=await api(path);if(manifestId!==report?.id||manifestId&&record.manifestId&&record.manifestId!==manifestId)throw new Error('评测批次已切换，请刷新后重试');if(!record.run||typeof record.run!=='object')throw new Error('详情未包含调用记录');showRun(record.run,{expected:record.expected,score:record.rawScore,executionScore:record.execution});}
      catch(error){toast(`读取调用详情失败：${error.message}`);}finally{button.disabled=false;}
    });
  }
  function render(){if(report){const models=singleService100Plan(report).models;if(filters.model&&!models.includes(filters.model)){filters.model='';indexRows=null;page=0;}box.querySelector('#single100-model').innerHTML=singleService100ModelOptions(report,filters.model);page=Math.max(0,Math.min(page,Math.ceil(currentRows().length/20)-1));box.querySelector('#single100-results').innerHTML=renderSingleService100Report(report,{...filters,rows:indexRows,page});}}
  function schedule(){clearTimeout(timer);if(report&&shouldPollSingleService100Report(report.status,active))timer=setTimeout(load,7000);}
  async function load() {
    initialize();if(busy)return;busy=true;clearTimeout(timer);const button=box.querySelector('#single100-refresh'),status=box.querySelector('#single100-poll-status');button.disabled=true;status.textContent='读取实测快照…';
    try{const nextReport=await api('/api/single-service-100-report');if(report?.id!==nextReport.id){indexRows=null;page=0;++indexGeneration;box.querySelector('#single100-index-export').disabled=true;}report=nextReport;box.querySelector('#single100-error').innerHTML='';box.querySelector('#single100-export').disabled=false;box.querySelector('#single100-index').disabled=indexBusy;render();status.textContent=shouldPollSingleService100Report(report.status,active)?'此页签活跃时每 7 秒刷新；不会启动模型':`${states[report.status] || '状态待确认'}，自动刷新已停止，可手动刷新`;onRefresh(report);}
    catch(error){box.querySelector('#single100-error').innerHTML=notice(`实测报告读取失败：${error.message}${report?'。保留上次快照。':''}`);if(!report)box.querySelector('#single100-results').innerHTML=empty('实测报告暂不可读','可手动刷新，不生成推测分数。');status.textContent='读取失败，可手动刷新';}
    finally{busy=false;button.disabled=false;schedule();}
  }
  async function loadIndex() {
    if(indexBusy||!report)return;indexBusy=true;const generation=++indexGeneration,manifestId=report.id,button=box.querySelector('#single100-index');button.disabled=true;
    try{const result=await api(singleService100ResultsPath({...filters,manifestId}));if(generation!==indexGeneration||manifestId!==report?.id)return;if(result.manifestId&&manifestId&&result.manifestId!==manifestId)throw new Error('评测批次已切换，请刷新后重试');indexRows=Array.isArray(result.rows)?result.rows:[];page=0;box.querySelector('#single100-index-export').disabled=false;box.querySelector('#single100-error').innerHTML='';render();}
    catch(error){if(generation===indexGeneration)box.querySelector('#single100-error').innerHTML=notice(`完整列表读取失败：${error.message}`);}
    finally{indexBusy=false;button.disabled=false;if(generation!==indexGeneration&&active&&manifestId===report?.id)loadIndex();}
  }
  function setActive(value){active=value;if(!active){clearTimeout(timer);return;}load();}
  return {setActive,load};
}
