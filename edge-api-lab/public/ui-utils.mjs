export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const percent = value => value == null || !Number.isFinite(Number(value)) ? '—' : `${(Number(value) * 100).toFixed(1)}%`;
export const duration = value => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value) >= 1000 ? `${(Number(value) / 1000).toFixed(2)} s` : `${Math.round(Number(value))} ms`;
const statuses = {
  ready_mock:['模拟调用就绪','success'], needs_clarification:['需要澄清','warning'],
  resolution_failed:['补全失败','danger'], unsupported:['不支持的请求','warning'],
  error:['调用失败','danger'], failed:['评测失败','danger'], interrupted:['已中断','warning'],
  completed:['已完成','success'], running:['评测中','info'], queued:['排队中','info'], cancelled:['已取消','warning'],
};
export const statusInfo = status => { const [label,tone] = statuses[status] || [status || '未知状态','neutral']; return {label,tone}; };
export const stageName = stage => ({domain:'领域识别',intent:'API 选择',arguments:'参数提取',unified:'一次调用',warmup:'模型预热'}[stage] || stage || '调用');
export const domainName = domain => ({weather:'天气',calendar:'日历',contacts:'联系人',files:'文件',services:'服务入口',cloud:'云端业务',unsupported:'不支持'}[domain] || domain || '—');
export const pretty = value => escapeHtml(JSON.stringify(value ?? {}, null, 2));
export const badge = status => { const info = statusInfo(status); return `<span class="badge ${info.tone}">${escapeHtml(info.label)}</span>`; };
export const dateTime = value => value ? new Date(value).toLocaleString('zh-CN',{hour12:false}) : '—';
export function downloadJson(value,name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const anchor = document.createElement('a'); anchor.href=url; anchor.download=name; anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function api(path,options={}) {
  const response = await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers}});
  let data; try { data=await response.json(); } catch { throw new Error(`服务返回了无法解析的内容（${response.status}）`); }
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}
export const notice = (message,tone='danger') => `<div class="notice ${tone}" role="status">${escapeHtml(message)}</div>`;
export const empty = (title,description='') => `<div class="empty"><span class="empty-mark">⌁</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div>`;
export const selectCaseIds = (ids,limit) => ids.slice(0,Math.max(1,Number(limit) || ids.length));
export function flattenInputs(inputs,prefix='') {
  return Object.entries(inputs || {}).flatMap(([name,field])=>{
    const path=prefix?`${prefix}.${name}`:name;
    return [[path,field],...(field.properties?flattenInputs(field.properties,path):[])];
  });
}
export function fieldConstraint(field) {
  const rules=[];
  const values=field.enum || field.items?.enum;
  if(values)rules.push(values.join(' / '));
  if(field.minimum!=null||field.maximum!=null)rules.push(`${field.minimum??'不限'} ～ ${field.maximum??'不限'}`);
  if(field.minItems!=null)rules.push(`至少 ${field.minItems} 项`);
  if(field.uniqueItems)rules.push('不可重复');
  if(field.additionalProperties===false)rules.push('只接受列出的字段');
  return rules.join('；');
}
export const locationFresh = (location,now=Date.now()) => Boolean(location && (location.source==='fixture' || (Number.isFinite(Date.parse(location.capturedAt)) && now-Date.parse(location.capturedAt)>=0 && now-Date.parse(location.capturedAt)<=300000)));

