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
export const stageName = stage => ({domain:'领域识别',intent:'API 选择',intent_arguments:'API 选择与参数提取',arguments:'参数提取',unified:'一次调用',warmup:'模型预热'}[stage] || stage || '调用');
export const domainName = domain => ({weather:'天气',calendar:'日历',contacts:'联系人',files:'文件',services:'服务入口',cloud:'云端业务',device:'设备与电量',connectivity:'网络连接',location:'位置',media:'媒体与音频',unsupported:'不支持'}[domain] || domain || '—');
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
export const isSingleServiceSuite = suite => ['single-service-v1','single-service-100-v1'].includes(suite);
export const caseMatchesScope = (suite,scope) => scope==='all' || (scope==='history'?!isSingleServiceSuite(suite):suite===scope);
export const defaultEvaluationModelChecked = name => ['qwen2.5:0.5b','qwen2.5:1.5b','qwen2.5:3b','qwen2.5:7b'].includes(name);
export const exclusiveBenchmarkMessage = benchmark => benchmark ? `独立千题实测独占推理中${benchmark.progress?` · ${benchmark.progress.done ?? 0}/${benchmark.progress.total ?? 3000}`:''}。实验台和批量启动暂不可用；可查看“千题单服务实测”结果，不会重复启动模型。` : '';
export const selectCaseIds = (ids,limit,cases=[]) => {
  const count=Math.max(1,Math.floor(Number(limit) || ids.length)),byId=new Map(cases.map(c=>[c.id,c]));
  if(!ids.length||!ids.every(id=>isSingleServiceSuite(byId.get(id)?.suite)))return ids.slice(0,count);
  const groups=new Map(),selected=[];
  for(const id of ids){const domain=byId.get(id).testDomain;if(!groups.has(domain))groups.set(domain,[]);groups.get(domain).push(id);}
  for(let index=0;selected.length<Math.min(count,ids.length);index++)for(const group of groups.values())if(group[index]&&selected.length<count)selected.push(group[index]);
  return selected;
};
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

