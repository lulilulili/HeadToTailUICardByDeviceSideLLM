import {api,escapeHtml as esc,pretty,percent,duration,domainName,empty,notice,dateTime,downloadJson} from './ui-utils.mjs';
import {renderGrounding} from './grounding-view.mjs';
import {renderResolution} from './resolution-view.mjs';

const count=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
const domainIds=report=>[...new Set([...(report.domains || []).map(value=>typeof value==='object'?value.id:value),...(report.cells || []).map(row=>row.testDomain)])];
const modelIds=report=>[...new Set([...(report.models || []),...(report.cells || []).map(row=>row.model)])];
const match=(row,filters)=> (!filters.domain || row.testDomain===filters.domain) && (!filters.model || row.model===filters.model);
const metricKeys=['oldExtractionAccuracy','oldStrictAccuracy','oldSemanticAccuracy','newSemanticAccuracy','oldModelP50Ms','oldModelP95Ms','replayP50Ms','replayP95Ms'];
const replayTime=value=>value==null || !Number.isFinite(Number(value))?'—':`${Number(value).toFixed(2)} ms`;
const stateLabels={not_started:'待生成',queued:'等待处理',running:'规则回放中',completed:'已完成',failed:'回放失败',cancelled:'已取消',interrupted:'已中断',stale:'快照与当前批次不匹配'};
export const shouldPollGroundingReport=status=>['queued','running'].includes(status);
export function groundingReportRows(report={},filters={}) {
  return domainIds(report).flatMap(testDomain=>modelIds(report).map(model=>{
    const existing=(report.cells || []).find(row=>row.testDomain===testDomain&&row.model===model) || {};
    const total=count(existing.total),row={...existing,testDomain,model,total,targetTotal:count(existing.targetTotal || report.expectedCasesPerDomain || 50)};
    if(!total)for(const key of metricKeys)row[key]=null;
    return row;
  })).filter(row=>match(row,filters));
}
const semanticLabel=value=>typeof value==='boolean'?(value?'通过':'未通过'):typeof value?.plan==='boolean'?(value.plan?'通过':'未通过'):typeof value?.correct==='boolean'?(value.correct?'通过':'未通过'):typeof value?.passed==='boolean'?(value.passed?'通过':'未通过'):'见审计详情';
function renderMatrix(rows) {
  return `<section class="panel report-panel"><div class="report-section-heading"><div><h2>提取与执行语义 · 三种独立口径</h2><p class="helper">仅按已完成样本计算；每格属于测试领域 × 模型，待处理样本不计为错误。领域和 API 的模型判断保持冻结。</p></div></div><div class="table-wrap"><table class="data-table grounding-matrix"><caption class="visually-hidden">同一冻结输出的原文核对回放对照</caption><thead><tr>${['测试领域','模型','完成 / 50','旧提取严格准确率','旧完整计划（严格）','旧执行语义准确率','核对后执行语义准确率','改善 / 退步 / 不变','原模型耗时 P50 / P95（含旧解析）','规则回放耗时 P50 / P95'].map(title=>`<th scope="col">${title}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr class="${row.total?'':'report-pending'}"><th scope="row">${esc(domainName(row.testDomain))}</th><td class="mono">${esc(row.model)}</td><td>${row.total} / ${row.targetTotal}${row.total?'':'<small>待处理</small>'}</td><td>${percent(row.oldExtractionAccuracy)}</td><td>${percent(row.oldStrictAccuracy)}</td><td>${percent(row.oldSemanticAccuracy)}</td><td class="report-main-metric">${percent(row.newSemanticAccuracy)}</td><td>${row.total?`${count(row.improved)} / ${count(row.regressed)} / ${count(row.unchanged)}`:'—'}</td><td>${duration(row.oldModelP50Ms)} / ${duration(row.oldModelP95Ms)}</td><td>${replayTime(row.replayP50Ms)} / ${replayTime(row.replayP95Ms)}</td></tr>`).join('')}</tbody></table></div><p class="helper report-table-note">典型耗时（P50）和较慢耗时（P95）：50% / 95% 请求在该时间内完成（样本百分位插值）。原模型列取冻结 run.totalMs，包含当时模型与解析链路，排除队列等待和预热；每次模型耗时仍在原 trace 可查。规则回放仅为代码核对与解析时间，不是新模型耗时，不与原模型秒级耗时合并。</p></section>`;
}
function renderTotals(report) {
  if(!report.metrics&&!report.changes)return '';
  return `<section class="panel report-panel"><div class="report-section-heading"><div><h2>整体对照 · 同一冻结输出</h2><p class="helper">每项保留独立定义与已处理分母；严格提取和严格完整计划不因规则修复加分。</p></div></div>${report.changes?.regressed?notice(`发现 ${count(report.changes.regressed)} 条执行语义退步，请结合原文与审计逐例复核。`,'warning'):''}${report.changes?`<p class="helper grounding-changes">改善 ${count(report.changes.improved)} 条 · 退步 ${count(report.changes.regressed)} 条 · 不变 ${count(report.changes.unchanged)} 条</p>`:''}<div class="grounding-totals">${[['oldExtraction','旧提取严格准确率'],['oldStrict','旧完整计划（严格）'],['oldExecutionSemantics','旧执行语义准确率'],['newExecutionSemantics','核对后执行语义准确率']].map(([key,label])=>{const value=report.metrics?.[key],available=value&&count(value.total)>0;return `<article><span>${label}</span><strong>${percent(available?value.accuracy:null)}</strong><small>${available?`${count(value.correct)} / ${count(value.total)} 条通过`:'尚未计算'}</small></article>`;}).join('')}</div></section>`;
}
function renderCharts(rows) {
  if(!rows.some(row=>row.total))return '';
  return `<section class="panel report-panel"><div class="report-section-heading"><div><h2>同一输出，核对前后的执行语义</h2><p class="helper">条形长度统一为 0–100%；三条分别使用各自评分定义，不能当作模型重新推理的提升。</p></div></div><div class="report-chart-grid">${rows.filter(row=>row.total).map(row=>`<article class="report-domain-chart"><h3>${esc(domainName(row.testDomain))} · <span class="mono">${esc(row.model)}</span> · ${row.total}/${row.targetTotal}</h3>${[['旧提取严格',row.oldExtractionAccuracy,'extraction'],['旧执行语义',row.oldSemanticAccuracy,'old-semantic'],['核对后执行语义',row.newSemanticAccuracy,'new-semantic']].map(([label,value,tone])=>`<div class="grounding-chart-row"><span>${label}</span><div class="chart-track" role="img" aria-label="${label} ${percent(value)}"><i class="chart-bar ${tone}" style="width:${value==null?0:Math.min(100,Math.max(0,Number(value)*100))}%"></i></div><strong>${percent(value)}</strong></div>`).join('')}</article>`).join('')}</div></section>`;
}
function renderExamples(report,filters) {
  const examples=(report.examples || []).map((example,index)=>({example,index})).filter(({example})=>match(example,filters)),limit=filters.exampleLimit || 12;
  return `<section class="panel report-panel"><div class="report-section-heading"><div><h2>原文、修复与拦截样例</h2><p class="helper">保留原模型输出与耗时，展示确定性规则的依据。目标 ID 来源可以核对，真实 ID 存在性尚未接 SDK。</p></div><span class="muted">${examples.length} 条样例</span></div>${examples.length?`<div class="report-errors">${examples.slice(0,limit).map(({example,index})=>`<details class="report-error-group" data-grounding-example="${index}"><summary><span>${esc(domainName(example.testDomain))} · <span class="mono">${esc(example.model)}</span> · ${esc(example.caseId)}</span><span class="report-error-tag">旧执行语义 ${semanticLabel(example.oldSemantic)} → 核对后 ${semanticLabel(example.newSemantic)}</span></summary><div class="report-error-body"><p class="report-example-text">${esc(example.text || example.input || '')}</p>${example.runId?`<button type="button" class="button small secondary" data-grounding-trace="${index}">查看原调用与耗时</button>`:''}<div class="report-expected-actual grounding-example-values"><div><h3>模型原始输出 · 冻结</h3><pre>${typeof example.raw==='string'?esc(example.raw):pretty(example.raw)}</pre></div><div><h3>原文核对后参数</h3><pre>${pretty(example.groundedArguments)}</pre></div>${example.newSemantic?.actualResolved?`<div><h3>规则最终参数 · 回放</h3><pre>${pretty(example.newSemantic.actualResolved.arguments)}</pre></div>`:''}</div><p class="helper">这里呈现确定性规则回放，原模型输出与耗时保持不变。</p>${renderGrounding(example.grounding)}${renderResolution(example.newSemantic?.actualResolved?.resolution)}<details class="raw-details"><summary>提取与执行语义评分审计</summary><pre>${pretty({caseId:example.caseId,runId:example.runId,expected:example.expected,oldScore:example.oldScore,oldSemantic:example.oldSemantic,newSemantic:example.newSemantic})}</pre></details></div></details>`).join('')}</div>${examples.length>limit?`<button type="button" class="button secondary report-more" data-grounding-more>再显示 12 条（剩余 ${examples.length-limit}）</button>`:''}`:empty('暂无匹配的回放样例','调整筛选或生成规则回放后查看；当前不补造结果。')}</section>`;
}
export function renderGroundingReport(report={},filters={}) {
  if(report.status==='stale')return notice(`快照与当前批次不匹配。${(report.notes || []).join(' ')}`,'warning')+empty('回放快照待重新生成','批次或规则源码已经变化，本页停止展示旧指标和样例。自动更新已停止，生成匹配快照后可手动刷新。');
  if(!report.manifestId || report.status==='not_started')return empty('原文核对回放待生成','冻结模型实测结果继续保留。生成同一原始输出的规则回放后，才展示提取与执行语义准确率；当前未计算。');
  const done=count(report.progress?.done),total=count(report.progress?.total),running=shouldPollGroundingReport(report.status);
  return `<section class="panel report-panel report-overview"><div class="job-top"><div><h2>原文核对与目标来源 · ${esc(stateLabels[report.status] || '状态待确认')}</h2><p class="helper mono">${esc(report.version)} · ${esc(report.manifestId)}</p></div><span class="badge ${report.status==='completed'?'success':running?'info':'warning'}">${done} / ${total} 条</span></div><p class="helper">冻结模型实测保留；这里是同一原始输出的规则回放，没有新增模型调用。${running?'每 10 秒更新报告。':'自动更新已停止，可手动刷新。'} 原模型耗时不变；规则回放耗时不是新模型耗时。</p><div class="job-progress" role="progressbar" aria-label="原文核对回放进度" aria-valuemin="0" aria-valuemax="${total || 1}" aria-valuenow="${Math.min(done,total || 1)}"><div style="width:${total?Math.min(100,done/total*100):0}%"></div></div><div class="job-progress-label"><span>${domainIds(report).length} 个测试领域 · ${modelIds(report).length} 个模型</span><span>更新于 ${esc(dateTime(report.updatedAt || report.generatedAt))}</span></div>${report.notes?.length?`<details class="report-notes"><summary>语义评分口径与已实现检测范围</summary><ul>${report.notes.map(note=>`<li>${esc(note)}</li>`).join('')}</ul>${report.scope?`<p>${esc(report.scope)}</p>`:''}${report.semanticsDefinition?`<pre>${pretty(report.semanticsDefinition)}</pre>`:''}</details>`:''}</section>${renderTotals(report)}${renderMatrix(groundingReportRows(report,filters))}${renderCharts(groundingReportRows(report,filters))}${renderExamples(report,filters)}`;
}
export function createGroundingReport({showRun,toast}) {
  const box=document.querySelector('#grounding-report-content');
  let initialized=false,active=false,report=null,busy=false,timer,exampleLimit=12;
  const filters={domain:'',model:''};
  function initialize() {
    if(initialized)return;initialized=true;
    box.innerHTML=`<div class="panel report-toolbar"><div class="report-filters grounding-filters"><div><label class="field-label" for="grounding-domain">测试领域</label><select id="grounding-domain"><option value="">全部领域</option></select></div><div><label class="field-label" for="grounding-model">冻结模型</label><select id="grounding-model"><option value="">全部模型</option></select></div></div><div class="report-actions"><button class="button secondary" type="button" id="grounding-refresh">刷新规则回放</button><button class="button secondary" type="button" id="grounding-export" disabled>导出回放 JSON</button><span class="helper" id="grounding-status" role="status"></span></div></div><div id="grounding-error"></div><div id="grounding-results"><div class="loading-state"><span class="spinner"></span><p>正在读取规则回放…</p></div></div>`;
    for(const key of ['domain','model'])box.querySelector(`#grounding-${key}`).addEventListener('change',event=>{filters[key]=event.target.value;exampleLimit=12;render();});
    box.querySelector('#grounding-refresh').addEventListener('click',load);
    box.querySelector('#grounding-export').addEventListener('click',()=>report && downloadJson(report,`grounding-replay-${String(report.manifestId || 'pending').replace(/[^\w-]/g,'_')}.json`));
    box.addEventListener('click',async event=>{
      if(event.target.closest('[data-grounding-more]')){exampleLimit+=12;render();return;}
      const button=event.target.closest('[data-grounding-trace]'),example=report?.examples?.[Number(button?.dataset.groundingTrace)];
      if(!button || !example?.runId)return;
      button.disabled=true;
      try{const run=await api(`/api/runs/${encodeURIComponent(example.runId)}`);showRun(run,{caseId:example.caseId,groundedArguments:example.groundedArguments,grounding:example.grounding,oldScore:example.oldScore,oldSemantic:example.oldSemantic,newSemantic:example.newSemantic});}
      catch(error){toast(`读取原调用失败：${error.message}`);}finally{button.disabled=false;}
    });
  }
  function render() {
    if(!report)return;
    for(const [key,values,label,name] of [['domain',domainIds(report),'全部领域',domainName],['model',modelIds(report),'全部模型',value=>value]]) {
      const select=box.querySelector(`#grounding-${key}`);
      if(filters[key]&&!values.includes(filters[key]))filters[key]='';
      select.innerHTML=`<option value="">${label}</option>`+values.map(value=>`<option value="${esc(value)}">${esc(name(value))}</option>`).join('');select.value=filters[key];
    }
    const results=box.querySelector('#grounding-results'),opened=new Set([...results.querySelectorAll('[data-grounding-example][open]')].map(item=>item.dataset.groundingExample));
    results.innerHTML=renderGroundingReport(report,{...filters,exampleLimit});
    results.querySelectorAll('[data-grounding-example]').forEach(item=>{if(opened.has(item.dataset.groundingExample))item.open=true;});
  }
  function schedule(){clearTimeout(timer);if(active&&report&&shouldPollGroundingReport(report.status))timer=setTimeout(load,10000);}
  async function load() {
    initialize();if(busy)return;busy=true;clearTimeout(timer);
    const button=box.querySelector('#grounding-refresh'),status=box.querySelector('#grounding-status');button.disabled=true;status.textContent='读取中…';
    try{report=await api('/api/grounding-report');box.querySelector('#grounding-error').innerHTML='';render();box.querySelector('#grounding-export').disabled=false;status.textContent=shouldPollGroundingReport(report.status)?'规则回放中，每 10 秒更新一次':`${stateLabels[report.status] || '状态待确认'}，自动更新已停止，可手动刷新`;}
    catch(error){box.querySelector('#grounding-error').innerHTML=notice(`读取规则回放失败：${error.message}${report?'。保留上次快照。':''}`);if(!report)box.querySelector('#grounding-results').innerHTML=empty('规则回放暂不可读','可手动刷新重试，不生成推测结果。');status.textContent='读取失败，可手动刷新';}
    finally{busy=false;button.disabled=false;schedule();}
  }
  function setActive(value){active=value;if(!active){clearTimeout(timer);return;}load();}
  return {setActive,load};
}
