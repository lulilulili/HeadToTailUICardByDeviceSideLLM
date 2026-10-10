import {escapeHtml as esc,pretty} from './ui-utils.mjs';
import {granularityLabel} from './capability-view.mjs';

const precisionLabel=value=>({city:'城市级',district:'区县级',region:'区域级',coordinate:'坐标级',coordinates:'坐标级',exact:'精确坐标',coarse:'粗略位置',device:'设备定位',named_place:'地点名称 / 待解析'}[value] || value || '精度未声明');
const sourceLabel=value=>({fixture:'固定实验夹具',browser:'浏览器授权位置',system_location:'系统位置',system_time:'系统时间',system_timezone:'系统时区',user:'用户明确输入',user_selection:'用户显式选择',geocoding:'地理编码',provided_experiment:'实验控制',context:'上下文推导',default:'契约默认值'}[value] || value || '来源未声明');
const compact=value=>value==null?'尚未解析':typeof value==='string'?value:JSON.stringify(value);
function rangeView(range) {
  if(!range)return '';
  if(typeof range==='string')return `<p>${esc(range)}</p>`;
  const start=range.startAt ?? range.start,end=range.endAt ?? range.end;
  return `${range.expression?`<p class="resolution-expression">${esc(range.expression)}</p>`:''}${range.at?`<div class="resolution-range mono">${esc(range.at)}</div>`:start || end?`<div class="resolution-range mono"><span>${esc(compact(start))}</span><span>→ ${esc(compact(end))}</span></div>`:''}${range.timezone?`<small>${esc(range.timezone)}</small>`:''}`;
}
function timeBox(value,label) {
  return `<div class="resolution-condition"><span class="resolution-label">${label}</span><strong>${value?esc(granularityLabel(value.precision || value.dataset)):'尚未解析'}</strong>${value?.dataset?`<small class="mono">${esc(value.dataset)}</small>`:''}${rangeView(value?.range)}${value?.api?`<small>实际读取 API</small><small class="mono">${esc(value.api)}</small>`:''}${value?.projection?`<small class="mono">投影 ${esc(value.projection)}</small>`:''}</div>`;
}
function locationBox(value,label) {
  let description='尚未解析';
  if(value)description=value.label || value.location || value.name || (value.latitude!=null&&value.longitude!=null?`${value.latitude}, ${value.longitude}`:value.coordinates?compact(value.coordinates):Object.keys(value).length?compact(value):'使用系统位置补全');
  const accuracy=value?.accuracyMeters ?? value?.accuracy;
  return `<div class="resolution-condition"><span class="resolution-label">${label}</span><strong>${esc(description)}</strong>${value?.latitude!=null&&value?.longitude!=null?`<small class="mono">${esc(value.latitude)}, ${esc(value.longitude)}</small>`:''}${value?.precision?`<small>${esc(precisionLabel(value.precision))}${accuracy!=null?` · 精度约 ${esc(accuracy)} 米`:''}</small>`:''}${value?.source?`<small>${esc(sourceLabel(value.source))}</small>`:''}</div>`;
}
function fallbackView(value,{time=false}={}) {
  const fallback=value.fallback;
  const changed=Boolean(fallback?.applied);
  return `${fallback?.reason?`<div class="resolution-reason ${changed?'degraded':'unresolved'}"><span>${changed?'已降级':value.effective?'解析说明':'补全未完成'}</span> ${esc(fallback.reason)}</div>`:''}${time&&value.effective?.requiresFilteringToRequestedRange?'<p class="resolution-preserved">✓ 保留原始请求约束，按原始时间范围筛选。</p>':time&&fallback?.requestedConstraintsPreserved?'<p class="resolution-preserved">✓ 原始请求时间范围已保留。</p>':''}${value.geocoding?`<p class="helper">${value.geocoding.simulated?'模拟地理编码 · 实验夹具':'地理编码'}${value.geocoding.source?` · ${esc(sourceLabel(value.geocoding.source))}`:''}${value.geocoding.query?` · ${esc(value.geocoding.query)}`:''}</p>`:''}`;
}
export function renderResolution(resolution) {
  if(!resolution || (!resolution.time&&!resolution.location&&!resolution.context?.length))return '';
  const effectiveLocation=resolution.location?.effective?{...resolution.location.effective,precision:resolution.location.effective.precision || resolution.location.precision}:null;
  return `<section class="resolution-section" aria-label="请求约束与系统解析"><div class="section-caption"><span>请求约束与系统解析</span><span>原始条件始终保留</span></div>${resolution.time?`<div class="resolution-card"><h3>时间粒度</h3><div class="resolution-flow">${timeBox(resolution.time.requested,'用户请求')}<span class="resolution-arrow" aria-hidden="true">→</span>${timeBox(resolution.time.effective,'最终读取条件')}</div>${fallbackView(resolution.time,{time:true})}${resolution.time.availabilitySource?`<p class="helper">数据可用性来源 · ${esc(sourceLabel(resolution.time.availabilitySource))}</p>`:''}</div>`:''}${resolution.location?`<div class="resolution-card"><h3>位置精度与来源</h3><div class="resolution-flow">${locationBox(resolution.location.requested,'用户请求 / 系统状态')}<span class="resolution-arrow" aria-hidden="true">→</span>${locationBox(effectiveLocation,'最终读取位置')}</div>${fallbackView(resolution.location)}</div>`:''}${resolution.context?.length?`<div class="resolution-card"><h3>系统状态与当前对象</h3><div class="source-list">${resolution.context.map(item=>`<span class="source-chip" title="${esc(item.reason || item.inferredFrom || "")}">${esc(item.field)} ← ${esc(sourceLabel(item.source))}${item.trusted?' · 用户确认选择':''}${item.reason?` · ${esc(item.reason)}`:''}${item.inferredFrom?`（${esc(typeof item.inferredFrom==='string'?item.inferredFrom:JSON.stringify(item.inferredFrom))}）`:''}</span>`).join('')}</div></div>`:''}</section>`;
}
export function renderCandidates(candidates) {
  if(!candidates || typeof candidates!=='object')return '';
  const groups=Object.entries(candidates).filter(([,value])=>value&&typeof value==='object');
  if(!groups.length)return '';
  return `<details class="raw-details candidates-details"><summary>候选 API · 检索收缩与选择范围</summary>${groups.map(([stage,value])=>`<div class="candidate-group"><strong>${esc(stage==='unified'?'一次调用':'API 选择')}</strong><span class="helper">${Array.isArray(value.ids)?value.ids.length:0} 个候选${value.limit!=null?` / 上限 ${esc(value.limit)}`:''} · ${esc(value.policy || '检索规则')}</span><div class="source-list">${(Array.isArray(value.ids)?value.ids:[]).map((id,index)=>`<span class="source-chip mono">${esc(id)}${value.scores?.[index]!=null?` · ${esc(typeof value.scores[index]==='object'?value.scores[index].score:value.scores[index])}`:''}</span>`).join('')}</div></div>`).join('')}<pre>${pretty(candidates)}</pre></details>`;
}
