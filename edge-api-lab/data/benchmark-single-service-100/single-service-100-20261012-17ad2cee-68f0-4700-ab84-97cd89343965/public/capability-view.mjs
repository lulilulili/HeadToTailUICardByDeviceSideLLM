import {escapeHtml as esc,flattenInputs,fieldConstraint,domainName} from './ui-utils.mjs';

export const granularityLabel=value=>({current:'实况 / 当前',minute:'分钟粒度',hour:'小时粒度',hourly:'小时粒度',day:'日粒度',daily:'日粒度',date:'日期',instant:'单一时刻',range:'时间范围',none:'无时间要求'}[value] || value || '未声明');
export const objectLabel=value=>({current:'实况天气',hourly:'逐小时预报',daily:'逐日预报',minute:'分钟降水',alerts:'天气预警',indices:'生活指数',tides:'潮汐',city:'天气城市',event:'日程对象',Event:'日程对象',CalendarAccount:'日历账户',calendar:'日历对象',contact:'联系人对象',Contact:'联系人对象',file:'文件对象',FileMetadata:'文件元数据',Preview:'文件预览',RegisteredService:'注册服务',DeferredLink:'延迟应用链接',Link:'应用链接',material:'会议资料',MeetingMaterial:'会议资料',StorageBucket:'云存储',DatabaseObject:'数据库对象',DatabaseQuery:'数据库查询',FunctionParams:'云函数',Prefetch:'资源预取',PrefetchResult:'资源预取结果',UploadParams:'上传请求',DownloadParams:'下载请求',weather:'天气对象'}[value] || value);
const resolverName=value=>({system_location:'使用系统位置',relative_time:'由系统时钟和时区换算',datetime:'解析用户明确日期与时刻',selected_object:'仅使用用户显式选择的对象'}[value] || value);

export function filterCapabilities(items,{domain='all',object='all',granularity='all',search=''}={}) {
  const query=search.trim().toLowerCase();
  return items.filter(item=>(domain==='all'||item.domain===domain)&&(object==='all'||item.object===object)&&(granularity==='all'||item.granularities?.includes(granularity))&&`${item.id} ${item.name} ${item.description} ${item.object || ''} ${item.field || ''} ${item.projection || ''}`.toLowerCase().includes(query));
}
function evidenceLabel(item) {
  const value=typeof item.support==='string'?item.support:item.support?.evidence || item.support?.level || item.support?.type || item.evidence;
  const label=({official:'官方能力依据',official_doc:'官方文档依据',official_docs:'官方文档依据',sdk:'SDK 字段映射',sdk_mapping:'SDK 字段映射',official_object_projection:'SDK 字段映射',official_method:'官方方法映射',proposed:'拟定业务契约',proposed_business:'拟定业务契约',business_contract:'拟定业务契约',business_extension:'拟定业务契约',adapter_contract:'适配层契约'}[value]);
  return label || (value?String(value):item.sourceRef?'SDK 字段映射':'拟定业务契约');
}
function sourceLink(source,label) {
  const url=typeof source==='string'?source:source?.url;
  if(!url)return '';
  try{const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol))return '';}
  catch{return '';}
  return `<a class="source-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label==='拟定业务契约'||label==='适配层契约'?'参考文档':'官方依据'} ↗</a>`;
}
function constraintsView(constraints) {
  if(!constraints)return '';
  const rules=[];
  if(constraints.atLeastOne)rules.push(`至少提供一项：${constraints.atLeastOne.join(' / ')}`);
  if(constraints.nonEmptyObject)rules.push(`对象必须包含变更字段：${constraints.nonEmptyObject.join(' / ')}`);
  if(constraints.coordinateOrLocation)rules.push('提供坐标或可解析的地点名称；位置不足时停止补全');
  return rules.length?`<p class="helper" style="margin:12px 0 0">${esc(rules.join('；'))}</p>`:'';
}
function availabilityView(availability) {
  if(!availability)return '';
  const limits={...(availability.horizon || {}),...availability};
  limits.outsideChinaHours ??= limits.outsideHours;
  const labels={chinaHours:['中国地区预报范围','小时'],outsideChinaHours:['其他地区预报范围','小时'],days:['预报范围','天'],minutes:['短期范围','分钟'],radiusKm:['坐标覆盖半径','公里']};
  const values=Object.entries(labels).filter(([key])=>limits[key]!=null).map(([key,[label,unit]])=>`${label}：${limits[key]} ${unit}`);
  return values.length?`<p class="helper">数据范围声明 · ${esc(values.join('；'))}</p>`:'';
}
const alternativeGroups=item=>(Array.isArray(item.inputAlternatives)?item.inputAlternatives:[]).filter(group=>Array.isArray(group.fields)&&group.fields.length);
function alternativeLabel(group) {
  const location=group.resolver==='system_location';
  return `${location?'位置输入':''}${group.fields.length===2?'二选一':'任选一项'}${group.resolver?' · 可由系统补全':''}`;
}
function inputMeta(inputs,path) {
  let fields=inputs,meta;
  for(const name of path.split('.')){meta=fields?.[name];fields=meta?.properties;}
  return meta;
}
function inputRequirement(item,field,meta) {
  const group=alternativeGroups(item).find(value=>value.fields.includes(field));
  if(group)return `<span class="input-rule alternative">${esc(alternativeLabel(group))}</span>`;
  const segments=field.split('.'),name=segments.pop(),parentPath=segments.join('.');
  const parent=parentPath?inputMeta(item.inputs,parentPath):null;
  if(parent&&((Array.isArray(parent.required)&&parent.required.includes(name))||meta.required===true))return `<span class="input-rule conditional">${esc(parentPath==='coordinates'?'提供坐标时必填':`提供 ${parentPath} 时必填`)}</span>`;
  return meta.required===true?'<span class="badge warning">必填</span>':'可选';
}
function alternativesView(item) {
  return alternativeGroups(item).map(group=>`<div class="input-alternative"><strong>${esc(alternativeLabel(group))}</strong><p>${group.fields.map(field=>`<code>${esc(field)}</code>`).join(' 或 ')}</p>${group.description?`<p>${esc(group.description)}</p>`:''}${group.resolvedField?`<p class="input-resolution-note">${group.resolver==='system_location'?`提取入参：地点原文或用户明确的经纬度。<br>最终解析坐标：位置 <code>${esc(group.resolvedField)}</code> 解析成功后显示有效经纬度，并保留位置来源。`:`提取入参按用户表达保存；规则补全后统一写入 <code>${esc(group.resolvedField)}</code>。`}</p>`:''}</div>`).join('');
}
export function renderCapability(item) {
  const inputs=flattenInputs(item.inputs);
  const output=item.returns || item.output;
  const precision=item.availability?.precision;
  const fallback=item.support?.fallbackDatasets || [];
  const evidence=evidenceLabel(item);
  return `<article class="panel capability-card"><div class="capability-top"><code class="api-code">${esc(item.id)}</code><span class="badge neutral">${esc(domainName(item.domain))}</span></div><h2>${esc(item.name)}</h2><p>${esc(item.description)}</p><div class="capability-metadata">${item.object?`<span class="source-chip">对象 · ${esc(objectLabel(item.object))}</span>`:''}${item.field?`<span class="source-chip mono">字段 · ${esc(item.field)}</span>`:''}${(item.granularities || []).map(value=>`<span class="badge info">${esc(granularityLabel(value))}</span>`).join('')}<span class="badge ${['拟定业务契约','适配层契约'].includes(evidence)?'warning':'neutral'}">${esc(evidence)}</span></div>${item.projection?`<div class="capability-projection"><span>字段投影</span><code>${esc(item.projection)}</code></div>`:''}${output?`<p class="capability-return">返回 ${esc(output.type || 'object')}${output.unit?` · ${esc(output.unit)}`:''}${output.shape==='series'?' · 时序列表':output.shape==='value'?' · 单个值':''}${output.optional||output.nullable?' · 可能缺失':''}${precision?` · ${esc(granularityLabel(precision))}`:''}</p>`:''}${item.note?`<p class="helper capability-note">${esc(item.note)}</p>`:""}<details><summary>${inputs.length} 个入参字段 · 查看契约和补全规则</summary>${alternativesView(item)}<div class="table-wrap"><table class="data-table param-table"><thead><tr><th>参数</th><th>类型 / 输入条件</th><th>缺省与补全</th></tr></thead><tbody>${inputs.map(([field,meta])=>{
    const defaultValue=item.inputDefaults?.[field] ?? meta.default;
    return `<tr><td><code>${esc(field)}</code><span class="field-desc">${esc(meta.description)}</span></td><td>${esc(meta.type)}<br>${inputRequirement(item,field,meta)}${fieldConstraint(meta)?`<span class="field-desc">${esc(fieldConstraint(meta))}</span>`:''}</td><td>${defaultValue!==undefined?`默认 ${esc(JSON.stringify(defaultValue))}`:''}${meta.resolver?`${defaultValue!==undefined?'<br>':''}${esc(typeof meta.resolver==='object'?JSON.stringify(meta.resolver):resolverName(meta.resolver))}`:''}${defaultValue===undefined&&!meta.resolver?'按用户输入；必要时澄清':''}</td></tr>`;
  }).join('')}</tbody></table></div>${constraintsView(item.constraints)}${availabilityView(item.availability)}${fallback.length?`<p class="helper">允许回退的数据集：${esc(fallback.map(granularityLabel).join(' / '))}。保留原始用户约束。</p>`:''}${item.availability?.absence?`<p class="helper">字段边界：${esc(item.availability.absence)}</p>`:''}</details><div class="capability-footer"><span>${esc({read:'只读',write:'写入',navigation:'页面跳转'}[item.risk] || item.risk || '契约')} · 本阶段模拟执行</span>${sourceLink(item.sourceRef,evidence)}</div></article>`;
}

