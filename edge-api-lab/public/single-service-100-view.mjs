import {api,escapeHtml as esc,pretty,percent,duration,domainName,notice,empty,downloadJson} from './ui-utils.mjs';

const modelOrder=['qwen2.5:1.5b','qwen2.5:3b','qwen2.5:0.5b'];
const domains=['weather','calendar','contacts','files','services','cloud','device','connectivity','location','media'];
const states={not_started:'尚未开始',queued:'排队中',running:'实测中',completed:'已完成',failed:'未完成 / 失败',interrupted:'已中断',cancelled:'已停止',partial:'部分结果'};
const failureNames={domain:'领域错误',api:'API 错误',parameters:'参数错误',status_or_constraint:'状态 / 约束错误',gold_contract:'金标契约疑点',provider_timeout:'提供方超时',provider_contract:'提供方 / 输出结构错误',rule_error:'工程后处理异常',correct:'正确'};
const number=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
const order=rows=>[...rows].sort((a,b)=>(modelOrder.indexOf(a.model)<0?99:modelOrder.indexOf(a.model))-(modelOrder.indexOf(b.model)<0?99:modelOrder.indexOf(b.model)));
export const shouldPollSingleService100Report=(status,active=false)=>active&&['queued','running'].includes(status);
export const safeSingleService100DetailPath=path=>typeof path==='string'&&/^\/api\/single-service-100-run\/qwen2\.5-(?:0\.5|1\.5|3)b\/e100-(?:weather|calendar|contacts|files|services|cloud|device|connectivity|location|media)-\d{3}$/.test(path)?path:null;
export function singleService100ResultsPath({model='',domain='',failed=true}={}) {
  const query=new URLSearchParams();if(model)query.set('model',model);if(domain)query.set('domain',domain);if(failed)query.set('failed','true');
  return `/api/single-service-100-results${query.size?`?${query}`:''}`;
}
export function filterSingleService100Rows(rows=[],{model='',domain='',failed=true}={}) {
  return rows.filter(row=>(!model||row.model===model)&&(!domain||row.testDomain===domain)&&(!failed||(row.primary?row.primary!=='correct':Boolean(row.error)||row.execution?.plan===false||row.rawScore?.plan===false)));
}
const argumentsText=value=>value==null?'—（未取得）':pretty(value);
const metric=(value,total)=>number(total)>0&&number(value?.total)>0?`${percent(value.accuracy)} <span class="muted small">${esc(value.correct ?? '—')}/${esc(value.total)}</span>`:'—';
const failures=row=>Object.entries(row.primaryFailures || {}).filter(([key,count])=>key!=='correct'&&number(count)>0).map(([key,count])=>`${failureNames[key] || key} ${count}`).join('；') || '—';
function summaryBreakdown(rows) {
  return rows.map(row=>`<h3>${esc(row.model)}</h3>${number(row.total)>0?`<p>${esc(failures(row))}</p>${(row.origins || []).map(origin=>`<p class="helper">${esc(origin.origin)} · ${number(origin.total)} 次 · API ${metric(origin.api,origin.total)} · 原始参数 ${metric(origin.rawArguments,origin.total)} · 最终语义 ${metric(origin.semantics,origin.total)}</p>`).join('')}<p class="helper">已知契约边界 ${number(row.contractBoundaryCount)} 条；同一参数错误可能含多处差异，差异数不能相加为失败数。</p>`:'<p class="helper">尚无已完成调用，主错因和分层分数未计算。</p>'}`).join('');
}
function summaryTable(rows,{cell=false}={}) {
  return `<div class="summary-scroller"><table class="data-table summary-table"><thead><tr><th>${cell?'模型 / 领域':'模型 / 进度'}</th><th>领域</th><th>API</th><th>原始参数 · 严格</th><th>最终执行语义</th><th>可执行请求语义</th><th>安全非就绪</th><th>P50 / P95</th><th>提供方错误</th><th>召回漏选 / 候选内错选</th></tr></thead><tbody>${order(rows).map(row=>`<tr><td><span class="mono">${esc(row.model)}</span>${cell?`<div>${esc(domainName(row.testDomain))}</div>`:''}<div class="helper">${number(row.total)} / ${number(row.planned) || (cell?100:1000)}${number(row.total)>0&&!row.complete?' · 部分结果':''}</div></td><td>${metric(row.domain,row.total)}</td><td>${metric(row.api,row.total)}</td><td>${metric(row.rawArguments,row.total)}</td><td>${metric(row.semantics,row.total)}</td><td>${metric(row.readyRequestSemantics,row.total)}</td><td>${metric(row.safeNonReady,row.total)}</td><td class="mono">${number(row.total)>0?`${duration(row.p50Ms)} / ${duration(row.p95Ms)}`:'—'}</td><td>${number(row.total)>0?number(row.providerErrors):'—'}</td><td>${number(row.total)>0?`${number(row.retrievalMisses)} / ${number(row.wrongApiWithCandidate)}`:'—'}</td></tr>`).join('')}</tbody></table></div>`;
}
export function renderSingleService100Rows(rows=[],{page=0,pageSize=20,full=false}={}) {
  const pages=Math.max(1,Math.ceil(rows.length/pageSize)),current=Math.max(0,Math.min(page,pages-1));
  const visible=rows.slice(current*pageSize,(current+1)*pageSize);
  return `<div class="panel table-wrap evaluation-results"><div class="panel-title"><h2>${full?'完整逐例列表快照':'错误样例'} <span class="muted small">${rows.length} 条</span></h2><div class="header-actions"><button type="button" class="button small secondary" data-single100-page="prev" ${current===0?'disabled':''}>‹</button><span class="muted small">${current+1} / ${pages}</span><button type="button" class="button small secondary" data-single100-page="next" ${current===pages-1?'disabled':''}>›</button></div></div>${visible.length?`<div class="summary-scroller"><table class="data-table"><thead><tr><th>案例 / 模型</th><th>预期 / 实际 API 与状态</th><th>原始参数 / 补全后参数</th><th>错因 / 详情</th></tr></thead><tbody>${visible.map((row,index)=>`<tr><td class="prompt-cell">${esc(row.text)}<div class="helper mono">${esc(row.model)} · ${esc(row.caseId)}</div><div class="helper">${esc(domainName(row.testDomain))} · ${esc(row.origin || '来源未标记')}</div></td><td><div>预期：<span class="mono">${esc(row.expectedApi ?? row.expected?.api ?? '—')}</span></div><div>实际：<span class="mono">${esc(row.actualApi ?? row.actual?.api ?? '—')}</span></div><div class="helper">状态：${esc(row.expectedStatus ?? row.expected?.status ?? '—')} → ${esc(row.status ?? row.actual?.status ?? '—')}</div><details class="raw-details"><summary>预期参数</summary><pre>${argumentsText(row.expectedArguments ?? row.expected?.arguments)}</pre></details></td><td><details class="raw-details"><summary>模型原始参数</summary><pre>${argumentsText(row.modelArguments ?? row.extractedArguments)}</pre></details><details class="raw-details"><summary>规则补全后参数</summary><pre>${argumentsText(row.groundedArguments)}</pre></details><p class="helper">严格参数：${row.rawScore?.arguments===true?'✓':row.rawScore?.arguments===false?'×':'—'} · 执行语义：${row.execution?.plan===true?'✓':row.execution?.plan===false?'×':'—'}</p></td><td>${esc(failureNames[row.primary] || row.primary || '—')}${row.error?`<p class="helper">${esc(row.error)}</p>`:''}${row.differences?.length?`<details class="raw-details"><summary>差异</summary><pre>${pretty(row.differences)}</pre></details>`:''}<button type="button" class="button small secondary" data-single100-detail="${current*pageSize+index}" ${safeSingleService100DetailPath(row.detailPath)?'':'disabled'}>原始调用详情</button></td></tr>`).join('')}</tbody></table></div>`:empty(full?'没有匹配的已完成调用':'没有匹配的错误样例','这里不是完整成功率证明；已完成数量和评分见上方。')}</div>`;
}
export function renderSingleService100Report(report,{model='',domain='',rows=null,page=0,failed=true}={}) {
  const done=number(report.progress?.done),total=number(report.progress?.total) || 3000;
  const partial=report.status!=='completed'&&done>0;
  const activity=report.active?`${report.active.model || ''} · ${domainName(report.active.testDomain)} · ${report.active.caseId || ''} · ${report.active.phase || ''}`:'';
  const summary=order(report.summary || []).filter(row=>!model||row.model===model);
  const cells=order(report.cells || []).filter(row=>(!model||row.model===model)&&(!domain||row.testDomain===domain));
  const shown=filterSingleService100Rows(rows ?? report.examples ?? [],{model,domain,failed});
  return `<div class="panel job-panel"><div class="job-top"><h2>千题单服务实测 · ${esc(states[report.status] || report.status || '状态待确认')}</h2><span class="muted">只读结果，不启动推理</span></div><div class="job-progress" role="progressbar" aria-label="千题正式调用完成进度" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${Math.min(done,total)}"><div style="width:${Math.min(100,done/total*100)}%"></div></div><div class="job-progress-label"><span>${done} / ${total} 次正式调用${partial?' · 部分结果，未完成不计入分母':''}</span><span>1.5B → 3B → 0.5B</span></div>${activity?`<p class="helper mono">当前：${esc(activity)}</p>`:''}${report.error?notice(typeof report.error==='string'?report.error:JSON.stringify(report.error),'warning'):''}<p class="helper">10 领域 × 每领域 100 条 × 3 模型。重点比较 1.5B 与 3B；0.5B 为补充，7B 明确排除。预热不计分。</p></div>${done?`<div class="panel comparison-panel"><h2>模型对照${partial?' · 已完成部分':''}</h2>${summaryTable(summary)}<p class="helper">提供方失败计入已完成调用分母；未执行样本不当作 0 分。执行语义包含正确澄清 / 安全非就绪，不等于服务全执行成功率。原始参数与补全后语义分开。</p><details class="raw-details"><summary>主错因与既有 100 / 新增 900 分层</summary>${summaryBreakdown(summary)}</details></div><div class="panel comparison-panel"><h2>分领域对照</h2>${summaryTable(cells,{cell:true})}</div>`:empty('尚无实测数据','尚未完成正式调用，准确率与耗时不显示为 0；本页不会启动模型。')}${renderSingleService100Rows(shown,{page,full:rows!==null})}<details class="panel report-panel raw-details"><summary>实验边界、用例覆盖与固定条件</summary><p class="helper">当前位置指未来手机：现阶段只提供 fixture 手机位置 mock，不读取电脑 GPS / 浏览器定位。真实 Harmony 宿主与业务执行尚未验证。</p>${(report.notes || []).map(note=>`<p class="helper">${esc(note)}</p>`).join('')}<h3>覆盖与已知契约边界</h3><pre>${pretty(report.corpus)}</pre><h3>固定条件</h3><pre>${pretty(report.conditions)}</pre></details>`;
}

export function createSingleService100View({showRun,toast,onRefresh=()=>{}}) {
  const box=document.querySelector('#single-service-100-content');
  let active=false,initialized=false,report=null,timer,busy=false,indexBusy=false,indexRows=null,page=0,indexGeneration=0;
  const filters={model:'',domain:'',failed:true};
  const currentRows=()=>filterSingleService100Rows(indexRows ?? report?.examples ?? [],filters);
  function initialize() {
    if(initialized)return;initialized=true;
    box.innerHTML=`<div class="panel report-toolbar"><div class="report-actions"><button type="button" id="single100-refresh" class="button secondary">刷新进度</button><button type="button" id="single100-export" class="button secondary" disabled>下载报告 JSON</button><button type="button" id="single100-index" class="button secondary" disabled>载入完整逐例列表</button><button type="button" id="single100-index-export" class="button secondary" disabled>下载列表 JSON</button></div><div class="report-filters"><div><label for="single100-model" class="field-label">模型</label><select id="single100-model"><option value="">全部 · 1.5B / 3B 优先</option>${modelOrder.map(model=>`<option value="${model}">${model}${model.endsWith(':0.5b')?' · 补充':''}</option>`).join('')}</select></div><div><label for="single100-domain" class="field-label">领域</label><select id="single100-domain"><option value="">全部十领域</option>${domains.map(domain=>`<option value="${domain}">${esc(domainName(domain))}</option>`).join('')}</select></div><label class="check-inline"><input type="checkbox" id="single100-failed" checked>仅看错误</label></div><p id="single100-poll-status" class="helper" aria-live="polite"></p><p class="helper">默认样例按模型 / 领域 / 错因限量；完整列表按需读取。列表是已完成调用的快照，运行中可重新载入。</p><div id="single100-error"></div></div><div id="single100-results"></div>`;
    box.querySelector('#single100-refresh').addEventListener('click',load);
    box.querySelector('#single100-export').addEventListener('click',()=>{if(report)downloadJson(report,`single-service-100-${report.id || 'report'}.json`);});
    box.querySelector('#single100-index').addEventListener('click',loadIndex);
    box.querySelector('#single100-index-export').addEventListener('click',()=>{if(indexRows!==null)downloadJson({filters,rows:indexRows},'single-service-100-results.json');});
    for(const [id,key] of [['single100-model','model'],['single100-domain','domain'],['single100-failed','failed']])box.querySelector(`#${id}`).addEventListener('change',event=>{filters[key]=key==='failed'?event.target.checked:event.target.value;page=0;const hadIndex=indexRows!==null;indexRows=null;++indexGeneration;box.querySelector('#single100-index-export').disabled=true;render();if(hadIndex)loadIndex();});
    box.querySelector('#single100-results').addEventListener('click',async event=>{
      const pager=event.target.closest('[data-single100-page]');if(pager&&!pager.disabled){page+=pager.dataset.single100Page==='next'?1:-1;render();return;}
      const button=event.target.closest('[data-single100-detail]');if(!button||button.disabled)return;
      const row=currentRows()[Number(button.dataset.single100Detail)],path=safeSingleService100DetailPath(row?.detailPath);
      if(!path){toast('详情路径不在本轮只读接口范围内');return;}
      button.disabled=true;
      try{const record=await api(path);if(!record.run||typeof record.run!=='object')throw new Error('详情未包含调用记录');showRun(record.run,{expected:record.expected,score:record.rawScore,executionScore:record.execution});}
      catch(error){toast(`读取调用详情失败：${error.message}`);}finally{button.disabled=false;}
    });
  }
  function render(){if(report){page=Math.max(0,Math.min(page,Math.ceil(currentRows().length/20)-1));box.querySelector('#single100-results').innerHTML=renderSingleService100Report(report,{...filters,rows:indexRows,page});}}
  function schedule(){clearTimeout(timer);if(report&&shouldPollSingleService100Report(report.status,active))timer=setTimeout(load,7000);}
  async function load() {
    initialize();if(busy)return;busy=true;clearTimeout(timer);const button=box.querySelector('#single100-refresh'),status=box.querySelector('#single100-poll-status');button.disabled=true;status.textContent='读取实测快照…';
    try{report=await api('/api/single-service-100-report');box.querySelector('#single100-error').innerHTML='';box.querySelector('#single100-export').disabled=false;box.querySelector('#single100-index').disabled=indexBusy;render();status.textContent=shouldPollSingleService100Report(report.status,active)?'此页签活跃时每 7 秒刷新；不会启动模型':`${states[report.status] || '状态待确认'}，自动刷新已停止，可手动刷新`;onRefresh(report);}
    catch(error){box.querySelector('#single100-error').innerHTML=notice(`实测报告读取失败：${error.message}${report?'。保留上次快照。':''}`);if(!report)box.querySelector('#single100-results').innerHTML=empty('实测报告暂不可读','可手动刷新，不生成推测分数。');status.textContent='读取失败，可手动刷新';}
    finally{busy=false;button.disabled=false;schedule();}
  }
  async function loadIndex() {
    if(indexBusy)return;indexBusy=true;const generation=++indexGeneration,button=box.querySelector('#single100-index');button.disabled=true;
    try{const result=await api(singleService100ResultsPath(filters));if(generation!==indexGeneration)return;indexRows=Array.isArray(result.rows)?result.rows:[];page=0;box.querySelector('#single100-index-export').disabled=false;box.querySelector('#single100-error').innerHTML='';render();}
    catch(error){if(generation===indexGeneration)box.querySelector('#single100-error').innerHTML=notice(`完整列表读取失败：${error.message}`);}
    finally{indexBusy=false;button.disabled=false;if(generation!==indexGeneration&&active)loadIndex();}
  }
  function setActive(value){active=value;if(!active){clearTimeout(timer);return;}load();}
  return {setActive,load};
}
