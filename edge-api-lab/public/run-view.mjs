import {escapeHtml as esc,pretty,badge,duration,domainName,stageName,dateTime,notice,empty} from './ui-utils.mjs';
import {renderResolution,renderCandidates} from './resolution-view.mjs';
import {renderGrounding} from './grounding-view.mjs';
import {renderParameterProvenance,parameterSourceName} from './provenance-view.mjs';
import {renderInferenceRouting,renderJevDecision,renderLayaDecision} from './inference-mode-view.mjs';

const sourceName = value => {
  const source = typeof value === 'string' ? value : value?.source || value?.type;
  return ({user:'用户显式输入',explicit:'用户显式输入',system_time:'系统时间',system_timezone:'系统时区',system_location:'系统位置',browser:'浏览器位置',fixture:'固定实验夹具',default:'契约默认值',context:'上下文',resolved:'规则解析'}[source] || source || JSON.stringify(value));
};
function traceView(trace,index) {
  const metrics = [['冷加载',duration(trace.loadMs)],['输入计算',duration(trace.promptMs)],['输出生成',duration(trace.generationMs)],['输入 token',trace.inputTokens ?? '—'],['输出 token',trace.outputTokens ?? '—'],['生成速度',trace.tokensPerSecond == null ? '—' : `${Number(trace.tokensPerSecond).toFixed(1)} tok/s`]];
  const traceConfig=`<details class="raw-details"><summary>实际推理配置与版本</summary><pre>${pretty({options:trace.options,promptVersion:trace.promptVersion,promptMeta:trace.promptMeta,timeoutMs:trace.timeoutMs,doneReason:trace.doneReason,truncated:trace.truncated})}</pre></details>`;
  const traceWarning=trace.truncated?notice(trace.provider==='laya'?'Laya 报告输入截断或候选折叠，本次不能作为完整输入下的正常决策。':'模型达到输出预算，输出可能被截断。','warning'):'';
  return `<details class="trace" ${trace.error ? 'open' : ''}><summary><span class="trace-number">${String(index+1).padStart(2,'0')}</span><strong>${esc(stageName(trace.stage))}</strong><span class="trace-provider">${esc(trace.provider)} / ${esc(trace.model)}</span><span class="trace-time">${duration(trace.wallMs)}</span><span class="trace-arrow">›</span></summary><div class="trace-body">${trace.error ? notice(typeof trace.error==='string'?trace.error:JSON.stringify(trace.error)) : ''}<div class="trace-metrics">${metrics.map(([title,value])=>`<div><span>${title}</span><strong>${esc(value)}</strong></div>`).join('')}</div>${traceWarning}${renderJevDecision(trace)}${renderLayaDecision(trace)}${traceConfig}<details class="raw-details"><summary>查看完整提示词</summary><pre>${pretty(trace.messages || [])}</pre></details><details class="raw-details"><summary>查看输出约束 Schema</summary><pre>${pretty(trace.schema || {})}</pre></details><details class="raw-details"><summary>查看模型原始输出</summary><pre>${typeof trace.raw==='string'?esc(trace.raw):pretty(trace.raw)}</pre></details></div></details>`;
}
export function renderRun(run,{download=true}={}) {
  if (!run) return empty('暂无运行结果');
  const resolved = run.resolved || {};
  const sources = Object.fromEntries(Object.entries(resolved.sources || {}).map(([key,value])=>[key,resolved.provenance?.p?.[key]?{source:parameterSourceName(resolved.provenance.p[key].s),legacy:value}:value]));
  const missing = resolved.missing || [];
  const issues = resolved.issues || [];
  const issueText = [...(Array.isArray(missing)?missing.map(item=>`缺少参数：${typeof item==='object'?JSON.stringify(item):item}`):[]),...(Array.isArray(issues)?issues.map(item=>typeof item==='object'?JSON.stringify(item):item):[])];
  const traces=run.traces || [];
  const mock=run.mock;
  const modelInputs=`<p class="helper" style="margin-top:9px">提取规则：模型仅提取用户明确提供的信息；确实缺省且契约允许的环境参数才由系统补全，业务目标不猜测。</p>${run.modelArguments!=null?`<details class="raw-details"><summary>模型原始提取参数</summary><pre>${pretty(run.modelArguments)}</pre></details>`:''}`;
  const parameterFlow=`<div class="json-grid ${run.grounding?'grounding-parameter-grid':''}"><div class="json-box"><h3>模型原提取 · 显式参数</h3><pre>${pretty(run.extractedArguments || {})}</pre></div>${run.grounding?`<div class="json-box"><h3>原文核对后参数</h3><pre>${pretty(run.groundedArguments || {})}</pre></div>`:''}<div class="json-box"><h3>规则最终参数</h3><pre>${pretty(resolved.arguments || {})}</pre></div></div>${run.grounding?renderGrounding(run.grounding):'<p class="helper grounding-legacy">此记录未执行原文核对；沿用已保存的提取与规则补全结果，不能视为通过新增核对。</p>'}${renderParameterProvenance(resolved.provenance)}`;
  const contextDetails=`<details class="raw-details"><summary>本次系统上下文与阶段路由</summary><pre>${pretty({context:run.context,stages:run.stages,options:run.options,environment:run.environment,catalogVersion:run.catalogVersion,queueWaitMs:run.queueWaitMs,requestTotalMs:run.requestTotalMs})}</pre></details>`;
  return `<article class="panel result-panel"><div class="result-header"><div><p class="eyebrow">VERIFICATION RESULT</p><h2>调用计划与推理轨迹</h2></div>${badge(run.status)}</div><div class="result-prompt">${esc(run.text)}</div><div class="result-metrics"><div><div class="metric-label">链路执行耗时</div><div class="metric-value">${duration(run.totalMs)}</div></div><div><div class="metric-label">识别领域</div><div class="metric-value api-value">${esc(domainName(run.domain))}</div></div><div><div class="metric-label">选择的 API</div><div class="metric-value api-value mono">${esc(run.api || '—')}</div></div></div>${run.deterministicMs!=null?`<p class="helper grounding-time">原文核对与补全耗时 <strong>${Number(run.deterministicMs).toFixed(2)} ms</strong> · 与下方模型调用耗时分别记录。</p>`:''}${run.error?notice(typeof run.error==='string'?run.error:JSON.stringify(run.error)):''}${issueText.length?`<div class="issue-list">当前请求还不能形成完整调用<ul>${issueText.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></div>`:''}<div class="section-caption"><span>参数提取与规则补全</span><span class="small">实际 ${traces.length} 次模型调用</span></div>${renderInferenceRouting(run)}${parameterFlow}${modelInputs}<div class="source-list">${Object.entries(sources).map(([key,value])=>`<span class="source-chip" title="${esc(typeof value==='object'?JSON.stringify(value):value)}">${esc(key)} ← ${esc(sourceName(value))}</span>`).join('')}</div>${renderResolution(resolved.resolution)}${renderCandidates(run.candidates)}${contextDetails}<div class="section-caption"><span>每次模型调用 <span class="muted">(${traces.length})</span></span><span class="small">点击展开详情</span></div>${traces.length?`<div class="trace-list">${traces.map(traceView).join('')}</div>`:notice('本次没有产生模型调用记录。','info')}${mock?`<details class="raw-details"><summary>模拟执行结果 · 不调用真实业务</summary><pre>${pretty(mock)}</pre></details>`:''}<div class="result-footer"><span>${esc(dateTime(run.createdAt || run.timestamp))}${run.id?` · ${esc(run.id.slice(0,8))}`:''}</span><span>${run.catalogVersion?`契约 ${esc(run.catalogVersion)} · `:""}业务执行：${run.status==='ready_mock'?'模拟':'未执行'}</span>${download?'<button type="button" class="button small secondary" data-download-run>导出本次 JSON</button>':''}</div></article>`;
}
export function bindRunDownload(container,run,downloadJson) {
  container.querySelector('[data-download-run]')?.addEventListener('click',()=>downloadJson(run,`run-${run.id || Date.now()}.json`));
}





