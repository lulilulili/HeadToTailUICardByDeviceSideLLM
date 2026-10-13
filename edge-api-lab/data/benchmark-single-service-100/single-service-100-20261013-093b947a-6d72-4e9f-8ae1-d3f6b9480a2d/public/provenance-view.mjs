import {escapeHtml as esc,pretty} from './ui-utils.mjs';

const labels={U:'用户原文',S:'系统状态',C:'用户选择',D:'契约默认',R:'规则派生',X:'未核实'};
const states={b:'已拦截，需澄清',m:'尚缺参数',f:'参数已提供，解析依赖未就绪',r:'已移除 / 未采用','?':'来源尚未核实'};
const origins={fixture:'模拟手机 / 实验夹具',harmony:'内部鸿蒙系统桥',user_selection:'可信用户选择',provided_context:'提供的实验上下文',host_fallback:'PC 宿主兜底（非手机）',unresolved:'原文目标未确定'};
const label=tag=>Object.hasOwn(labels,tag)?labels[tag]:'未核实';
export const parameterSourceName=tag=>`${Object.hasOwn(labels,tag)?tag:'X'} · ${label(tag)}`;
const origin=value=>origins[value]??value;

export function renderParameterProvenance(provenance) {
  if(!provenance) return '<p class="helper provenance-legacy">此记录未保存逐参数来源（历史记录或提取未完成），不从旧 sources 反推原文已核实。</p>';
  const entries=Object.entries(provenance.p??{});
  return `<section class="provenance-section grounding-section" aria-label="逐参数来源"><div class="section-caption"><span>逐参数来源 · 程序生成</span><span>不增加模型输入 / 输出</span></div><p class="helper">U 原文 · S 系统 · C 用户选择 · D 契约默认 · R 规则派生 · X 未核实。来源不代表对象存在、已获权限或数据仍有效；未记录采样时间时不能推定新鲜度。</p>${entries.length?`<div class="provenance-list grounding-checks">${entries.map(([path,record])=>`<article class="provenance-item grounding-check"><div class="grounding-check-header"><strong class="mono">${esc(path)}</strong><span class="badge ${record.q||record.s==='X'?'warning':'info'}">${esc(Object.hasOwn(labels,record.s)?record.s:'X')} · ${esc(label(record.s))}</span></div>${record.q?`<p>${esc(states[record.q]??record.q)}</p>`:''}${record.o?`<p class="helper">来源：${esc(origin(record.o))}</p>`:''}${(Array.isArray(record.e)?record.e:[]).map(span=>`<div class="grounding-span"><span>原文 · 字符 ${esc(span.b)}–${esc(span.e)}</span><q>${esc(span.t)}</q></div>`).join('')}${record.d?.length?`<div class="source-list">${record.d.map(dependency=>`<span class="source-chip">依赖 ${esc(dependency.k)} ← ${esc(label(dependency.s))}${dependency.o?` · ${esc(origin(dependency.o))}`:''}${dependency.t?` · 采样 ${esc(dependency.t)}`:''}${dependency.x?` · 到期 ${esc(dependency.x)}`:''}</span>`).join('')}</div>`:''}${record.t||record.x?`<p class="helper">${record.t?`采样 ${esc(record.t)}`:''}${record.x?` · 到期 ${esc(record.x)}`:''}</p>`:''}</article>`).join('')}</div>`:'<p class="helper">该调用没有待填入参；电量等查询值属于输出，不生成伪入参。</p>'}<details class="raw-details"><summary>紧凑来源审计 · v${esc(provenance.v)}</summary><pre>${pretty(provenance)}</pre></details></section>`;
}
