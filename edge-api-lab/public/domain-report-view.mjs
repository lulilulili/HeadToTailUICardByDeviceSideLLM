import {api,escapeHtml as esc,percent,duration,domainName,notice,empty,dateTime,pretty,downloadJson} from './ui-utils.mjs';

const count=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
export const shouldPollDomainReport=status=>['not_started','queued','running'].includes(status);
const reportStates={
  not_started:{title:'领域评测待启动',label:'待启动',tone:'info',description:'等待后台启动固定对照，尚未计算准确率。'},
  queued:{title:'领域对照等待队列',label:'排队中',tone:'info',description:'等待模型推理队列，报告每 10 秒自动更新。'},
  running:{title:'领域对照进行中',label:'评测中',tone:'info',description:'报告每 10 秒自动更新；仅已完成样本计入准确率。'},
  completed:{title:'领域对照已完成',label:'已完成',tone:'success',description:'全部运行结果已保存，自动更新已停止；可手动刷新读取最新快照。'},
  cancelled:{title:'领域对照已取消',label:'已取消',tone:'warning',description:'评测已取消，自动更新已停止。已完成样本与调用轨迹保留，可手动刷新读取最新快照；未运行样本不计入准确率。'},
  failed:{title:'领域对照运行失败',label:'运行失败',tone:'danger',description:'本轮运行失败，自动更新已停止。已完成样本与错误轨迹保留，可手动刷新读取最新快照。'},
  interrupted:{title:'领域对照已中断',label:'已中断',tone:'warning',description:'本轮运行已中断，自动更新已停止。中断前保存的样本与调用轨迹保留，可手动刷新读取最新快照。'},
};
const reportState=status=>reportStates[status] || {title:'领域对照状态待确认',label:'状态未知',tone:'warning',description:'自动更新已停止，请手动刷新确认状态。'};
const rootLabels={service_error:'模型 / 服务异常',domain_error:'领域识别错误',candidate_missing:'候选 API 缺失',api_error:'API 选择错误',arguments_extra:'多提取参数',arguments_missing:'遗漏参数',arguments_value:'参数值错误',resolution_error:'系统补全错误',status_error:'处理状态错误',other:'其他错误'};
const scenarioLabels={
  explicit:'明确指令',default:'系统默认',relative:'相对表达',ambiguity:'歧义与澄清',unsupported:'拒识',injection:'提示注入',missing:'缺少参数',resolution:'系统补全',reference:'当前对象指代',
  basic_field:'单字段查询',system_defaults:'系统状态补全',compound_object:'完整对象查询',nested_field:'对象内字段查询',precision:'时间粒度要求',relative_time:'相对时间',explicit_time:'明确时间',boundary:'范围与边界',multifield:'多个字段',coordinates:'明确经纬度',environment_failure:'系统环境缺失',availability:'数据可用性与降级',refusal:'不支持请求拒识',multi_intent:'多个领域意图',wording:'不同表达方式',search:'对象搜索',selected_object:'当前选中对象',create:'创建请求',missing_target:'缺少目标或关键项',conflict:'参数相互冲突',update:'更新请求',write_target:'明确写入目标',untrusted_context:'未确认的当前对象',
  search_keyword:'按关键词搜索',search_type:'按文件类型搜索',formatted_input:'分行格式输入',missing_query:'缺少搜索关键词',quoted_literal:'引号内容原样提取',metadata_field:'文件信息字段',missing_object:'缺少对象标识',untrusted_object:'未确认的对象',explicit_precedence:'明确目标优先',preview_capability:'预览能力查询',preview_state:'预览窗口状态',preview_close:'关闭预览窗口',preview_prepare:'准备预览资源',preview_explicit:'明确预览参数',mime_inference:'推断文件类型',mime_unknown:'文件类型未知',unsupported_action:'不支持的操作',multiple_actions:'多个操作意图',prompt_injection:'提示注入',negative_scope:'否定与限定范围',
  navigation_target:'服务页面目标',navigation_parameters:'页面导航参数',navigation_no_autofill:'导航目标不能默认',unsupported_service:'不支持的服务',unsupported_navigation:'不支持的导航目标',target_field:'页面目标信息',parameters_field:'页面参数查询',availability_field:'服务可用状态',link_field:'直达链接查询',link_parse:'解析应用链接',selected_link:'当前选中链接',deferred_link:'延迟应用链接',
  materials_search:'会议资料搜索',missing_filter:'缺少筛选条件',materials_get:'完整会议资料',materials_field:'会议资料字段',materials_save:'保存会议资料',missing_write_body:'缺少写入正文',missing_write_title:'缺少写入标题',materials_share:'分享会议资料',missing_write_target:'缺少写入目标',write_selection_denied:'写入目标不能使用当前选择',storage_link:'云文件下载地址',storage_upload:'上传云文件',missing_write_path:'缺少写入路径',storage_download:'下载云文件',function_defaults:'云函数默认参数',function_body:'云函数请求正文',function_options:'云函数调用选项',missing_function:'缺少云函数名称',database_field:'数据库记录字段',selected_record:'当前数据库记录',missing_database_input:'缺少数据库参数',database_count:'数据库计数',database_sum:'数据库求和',database_average:'数据库平均值',database_maximum:'数据库最大值',database_minimum:'数据库最小值',prefetch_resource:'提前加载资源',prefetch_defaults:'预加载默认状态',prefetch_mode:'预加载模式',prefetch_link:'应用链接预加载',unsupported_query:'不支持的数据库指令',
};
export const scenarioLabel=value=>scenarioLabels[value] || value || '未分类';
const scenarioName=scenarioLabel;
const matches=(item,filters)=> (!filters.domain || item.testDomain===filters.domain) && (!filters.model || item.model===filters.model);
const domainsOf=report=>[...new Set([...(report.caseCoverage?.byDomain || []).map(row=>row.testDomain),...(report.summary || []).map(row=>row.testDomain)])];
const modelsOf=report=>[...new Set([...(report.models || []),...(report.summary || []).map(row=>row.model)])];
const coverageOf=(report,domain)=>report.caseCoverage?.byDomain?.find(item=>item.testDomain===domain);
const scenarioTarget=(report,row)=> (coverageOf(report,row.testDomain)?.categories || []).filter(item=>item.scenario===row.scenario).reduce((sum,item)=>sum+count(item.count),0);

export function domainReportRows(report={},filters={}) {
  return domainsOf(report).flatMap(testDomain=>modelsOf(report).map(model=>{
    const source=(report.summary || []).find(row=>row.testDomain===testDomain && row.model===model) || {};
    const total=count(source.total),targetTotal=count(source.targetTotal || report.expectedCasesPerDomain || 50);
    const row={...source,testDomain,model,total,targetTotal,errorCount:total?count(source.errorCount):0};
    for(const key of ['domainAccuracy','apiAccuracy','argumentAccuracy','statusAccuracy','planAccuracy','p50Ms','p95Ms'])row[key]=total?(source[key]??null):null;
    return row;
  })).filter(row=>matches(row,filters));
}

function renderSummary(report,filters) {
  const rows=domainReportRows(report,filters);
  if(!rows.length)return empty('没有匹配的对照结果','调整领域或模型筛选条件。');
  const headers=['测试领域','模型','完成 / 目标','领域','API','参数','状态','整体计划','典型耗时（P50）','较慢耗时（P95）','调用异常'];
  return `<section class="panel report-panel"><div class="report-section-heading"><div><h2>领域与模型对照</h2><p class="helper">准确率仅按已完成样本计算；待运行样本不计为错误。分组依据测试领域，拒识题仍属于原测试领域。</p></div></div><div class="table-wrap"><table class="data-table report-matrix"><caption class="visually-hidden">各测试领域与模型的完成数、准确率及整条请求耗时</caption><thead><tr>${headers.map(label=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr class="${row.total?'':'report-pending'}"><th scope="row">${esc(domainName(row.testDomain))}</th><td class="mono">${esc(row.model)}</td><td><strong>${row.total} / ${row.targetTotal}</strong><small>${row.total===0?'待运行':row.total<row.targetTotal?'部分结果':'样本已完成'}</small></td>${['domainAccuracy','apiAccuracy','argumentAccuracy','statusAccuracy','planAccuracy'].map(key=>`<td class="${key==='planAccuracy'?'report-main-metric':''}">${percent(row[key])}</td>`).join('')}<td>${duration(row.p50Ms)}</td><td>${duration(row.p95Ms)}</td><td>${row.total?row.errorCount:'—'}</td></tr>`).join('')}</tbody></table></div><p class="helper report-table-note">P50 / P95 为完整请求的墙钟耗时；单次模型调用的加载、生成、原文与配置可在错误样例的调用详情查看。</p></section><section class="panel report-panel"><div class="report-section-heading"><div><h2>整体计划准确率</h2><p class="helper">每条请求的领域、API、参数、状态和补全条件共同通过，才算整体计划通过。</p></div></div><div class="report-chart-grid">${[...new Set(rows.map(row=>row.testDomain))].map(domain=>`<div class="report-domain-chart"><h3>${esc(domainName(domain))}</h3>${rows.filter(row=>row.testDomain===domain).map(row=>`<div class="report-chart-row"><span class="mono">${esc(row.model)}</span><div class="chart-track" role="img" aria-label="${esc(`${row.model} 整体计划准确率 ${percent(row.planAccuracy)}，完成 ${row.total}/${row.targetTotal}`)}"><div class="chart-bar" style="width:${row.planAccuracy==null?0:Math.min(100,Math.max(0,Number(row.planAccuracy)*100))}%"></div></div><strong>${percent(row.planAccuracy)}</strong><small>${row.total} / ${row.targetTotal} · P50 ${duration(row.p50Ms)} · P95 ${duration(row.p95Ms)}</small></div>`).join('')}</div>`).join('')}</div></section>`;
}

export function reportScenarioRows(report={},filters={}) {
  return (report.scenarios || []).filter(row=>matches(row,filters) && (!filters.scenario || row.scenario===filters.scenario));
}
export function reportScenarioPage(report={},filters={}) {
  const all=reportScenarioRows(report,filters),pageSize=20,pages=Math.max(1,Math.ceil(all.length/pageSize));
  const page=Math.max(0,Math.min(pages-1,Math.floor(count(filters.scenarioPage))));
  return {rows:all.slice(page*pageSize,(page+1)*pageSize),page,pages,total:all.length,pageSize};
}

export function renderLatencyCharts(report={},filters={}) {
  const rows=domainReportRows(report,filters);
  return `<section class="panel report-panel"><div class="report-section-heading"><div><h2>P50 / P95 耗时对照</h2><p class="helper">典型耗时（P50）与较慢耗时（P95）：可理解为 50% / 95% 请求在该时间内完成，数值使用样本百分位插值。浅色为 P50、深色为 P95，均为完整请求的墙钟耗时。</p><p class="helper">同一领域使用相同耗时刻度，按该领域当前最高耗时缩放；跨领域以数值比较。</p></div></div><div class="report-chart-grid">${[...new Set(rows.map(row=>row.testDomain))].map(domain=>{
    const values=rows.filter(row=>row.testDomain===domain),scale=Math.max(1,...values.flatMap(row=>[count(row.p50Ms),count(row.p95Ms)]));
    return `<div class="report-domain-chart"><h3>${esc(domainName(domain))}</h3>${values.map(row=>`<div class="report-latency-chart-row"><div class="mono">${esc(row.model)} <small>${row.total} / ${row.targetTotal}</small></div>${row.total?['p50Ms','p95Ms'].map((key,index)=>`<div class="report-time-bar"><span>${index?'较慢耗时（P95）':'典型耗时（P50）'}</span><div class="chart-track" role="img" aria-label="${esc(`${row.model} ${index?'P95':'P50'} 耗时 ${duration(row[key])}`)}"><div class="chart-bar ${index?'':'report-p50-bar'}" style="width:${row[key]==null?0:100*count(row[key])/scale}%"></div></div><strong>${duration(row[key])}</strong></div>`).join(''):'<p class="helper">待运行，暂无耗时</p>'}</div>`).join('')}</div>`;
  }).join('')}</div></section>`;
}

function renderScenarios(report,filters) {
  const pagination=reportScenarioPage(report,filters),{rows,page,pages,total,pageSize}=pagination;
  return `<section class="panel report-panel"><div class="report-section-heading report-scenario-heading"><div><h2>场景与主要错因</h2><p class="helper">场景筛选作用于此表及错误样例；上方对照保持完整领域的 ${count(report.expectedCasesPerDomain || 50)} 题口径。每条失败请求只计入一个主要错因。</p></div><div class="header-actions report-pagination"><button type="button" class="button small secondary" data-report-page="previous" ${page===0?'disabled':''}>上一页</button><span class="helper" role="status">${page+1} / ${pages}</span><button type="button" class="button small secondary" data-report-page="next" ${page===pages-1?'disabled':''}>下一页</button></div></div>${!rows.length?empty('暂无匹配场景','调整筛选，或等待首个场景结果。'):`<div class="table-wrap"><table class="data-table report-scenario-table"><thead><tr><th scope="col">测试领域 / 场景</th><th scope="col">模型</th><th scope="col">完成数</th><th scope="col">整体计划</th><th scope="col">典型 / 较慢耗时</th><th scope="col">错误样本中的主错因分布</th></tr></thead><tbody>${rows.map(row=>{
    const total=count(row.total),errors=(row.primaryErrors || []).filter(error=>count(error.count)>0),errorTotal=errors.reduce((sum,error)=>sum+count(error.count),0),target=scenarioTarget(report,row);
    return `<tr><th scope="row">${esc(domainName(row.testDomain))}<small>${esc(scenarioName(row.scenario))}</small></th><td class="mono">${esc(row.model)}</td><td>${total}${target?` / ${target}`:''}</td><td>${percent(total?row.planAccuracy:null)}</td><td class="report-latency">${duration(total?row.p50Ms:null)}<small>${duration(total?row.p95Ms:null)}</small></td><td>${errorTotal?`<div class="report-causes">${errors.map(error=>`<div><span>${esc(error.label || rootLabels[error.code] || error.code)}</span><span class="report-cause-track"><i style="width:${100*count(error.count)/errorTotal}%"></i></span><strong>${count(error.count)}</strong></div>`).join('')}</div>`:`<span class="muted">${total?'暂无主要错因记录':'待运行'}</span>`}</td></tr>`;
  }).join('')}</tbody></table></div><p class="helper report-table-note">第 ${page*pageSize+1}–${page*pageSize+rows.length} 条，共 ${total} 个领域 / 模型 / 场景组合；每页 ${pageSize} 条。</p>`}</section>`;
}

function filteredErrors(report,filters) {
  return (report.errors || []).map((group,index)=>({group,index})).filter(({group})=>matches(group,filters)).map(({group,index})=>({group,index,examples:(group.examples || []).map((example,exampleIndex)=>({example,exampleIndex})).filter(({example})=>!filters.scenario || group.scenario===filters.scenario || example.scenario===filters.scenario)})).filter(({group,examples})=>!filters.scenario || group.scenario===filters.scenario || examples.length);
}

export function renderReportErrors(report={},filters={}) {
  const groups=filteredErrors(report,filters),limit=filters.errorLimit || 12;
  return `<section class="panel report-panel"><div class="report-section-heading"><div><h2>具体错误样例</h2><p class="helper">查看期待值、实际输出及判断原因。调用详情按需读取，并保留提示词原文与单次调用耗时。</p></div><span class="muted">${groups.length} 组错因</span></div>${groups.length?`<div class="report-errors">${groups.slice(0,limit).map(({group,index,examples})=>`<details class="report-error-group" data-report-group="${esc(JSON.stringify([group.testDomain,group.model,group.scenario,group.code]))}"><summary><span><strong>${esc(domainName(group.testDomain))}</strong> <span class="mono">${esc(group.model)}</span>${group.scenario?` · ${esc(scenarioName(group.scenario))}`:''}</span><span class="report-error-tag">${esc(group.label || rootLabels[group.code] || group.code)} · ${count(group.count)} 条</span></summary><div class="report-error-body">${examples.length?examples.map(({example,exampleIndex})=>`<article class="report-example"><div class="report-example-header"><span class="mono">${esc(example.caseId)}</span>${example.runId?`<button type="button" class="button small secondary" data-report-trace="${index}:${exampleIndex}">查看调用原文与耗时</button>`:''}</div><p class="report-example-text">${esc(example.text)}</p><div class="report-expected-actual"><div><h3>期待</h3><pre>${pretty(example.expected)}</pre></div><div><h3>实际</h3><pre>${pretty(example.actual)}</pre></div></div><p class="report-example-reason"><strong>原因</strong> ${typeof example.reason==='object'?pretty(example.reason):esc(example.reason || '未提供详细原因')}</p></article>`).join(''):'<p class="helper">此组尚无已保存样例。</p>'}</div></details>`).join('')}</div>${groups.length>limit?`<button type="button" class="button secondary report-more" data-report-more>再显示 12 组（剩余 ${groups.length-limit}）</button>`:''}`:empty('暂无匹配的错误样例',count(report.progress?.done)?'可调整领域、模型或场景筛选。':'完成首批请求后将显示具体错误。')}</section>`;
}

export function renderDomainReport(report={},filters={}) {
  if(!report.id || report.status==='not_started')return empty('领域评测待启动','每个领域 50 题、四个模型的固定对照将在启动后呈现。当前尚无结果，未计算准确率。');
  const done=count(report.progress?.done),total=count(report.progress?.total),state=reportState(report.status);
  return `<section class="panel report-panel report-overview"><div class="job-top"><div><h2>${esc(state.title)}</h2><p class="helper mono">${esc(report.suite)} · ${esc(report.mode)} · ${esc(report.id)}</p></div><span class="badge ${state.tone}">${esc(state.label)} · ${done} / ${total} 请求</span></div><p class="helper report-state-note">冻结模型实测：保留 sparse-v6 原始输出、旧评分与原模型耗时；原文核对回放独立呈现。${esc(state.description)}</p><div class="job-progress" role="progressbar" aria-label="领域对照完成进度" aria-valuemin="0" aria-valuemax="${total || 1}" aria-valuenow="${Math.min(done,total || 1)}"><div style="width:${total?Math.min(100,100*done/total):0}%"></div></div><div class="job-progress-label"><span>${domainsOf(report).length} 个领域 · ${modelsOf(report).length} 个固定模型 · 每组 ${count(report.expectedCasesPerDomain || 50)} 题</span><span>更新于 ${esc(dateTime(report.updatedAt))}</span></div>${report.notes?.length?`<details class="report-notes" data-report-group="report-notes"><summary>评测口径与运行说明</summary><ul>${report.notes.map(note=>`<li>${esc(note)}</li>`).join('')}</ul></details>`:''}</section>${renderSummary(report,filters)}${renderLatencyCharts(report,filters)}${renderScenarios(report,filters)}${renderReportErrors(report,filters)}`;
}

export function createDomainReport({showRun,toast}) {
  const box=document.querySelector('#domain-report-content');
  let initialized=false,active=false,report=null,busy=false,timer,errorLimit=12,scenarioPage=0;
  const filters={domain:'',model:'',scenario:''};
  function initialize() {
    if(initialized)return;initialized=true;
    box.innerHTML=`<div class="panel report-toolbar"><div class="report-filters"><div><label for="report-domain" class="field-label">测试领域</label><select id="report-domain"><option value="">全部领域</option></select></div><div><label for="report-model" class="field-label">固定模型</label><select id="report-model"><option value="">全部模型</option></select></div><div><label for="report-scenario" class="field-label">场景（下方明细）</label><select id="report-scenario"><option value="">全部场景</option></select></div></div><div class="report-actions"><button type="button" class="button secondary" id="report-refresh">刷新报告</button><button type="button" class="button secondary" id="report-export" disabled>导出 JSON</button><span id="report-refresh-status" class="helper" role="status"></span></div></div><div id="report-load-error"></div><div id="domain-report-results"><div class="loading-state"><span class="spinner"></span><p>正在读取领域对照…</p></div></div>`;
    for(const key of ['domain','model','scenario'])box.querySelector(`#report-${key}`).addEventListener('change',event=>{filters[key]=event.target.value;errorLimit=12;scenarioPage=0;render();});
    box.querySelector('#report-refresh').addEventListener('click',load);
    box.querySelector('#report-export').addEventListener('click',()=>report && downloadJson(report,`domain-report-${String(report.id || 'pending').replace(/[^\w-]/g,'_')}.json`));
    box.addEventListener('click',async event=>{
      const pageButton=event.target.closest('[data-report-page]');if(pageButton && !pageButton.disabled){scenarioPage+=pageButton.dataset.reportPage==='next'?1:-1;render();return;}
      const more=event.target.closest('[data-report-more]');if(more){errorLimit+=12;render();return;}
      const button=event.target.closest('[data-report-trace]');if(!button || !report)return;
      const [groupIndex,exampleIndex]=button.dataset.reportTrace.split(':').map(Number),example=report.errors?.[groupIndex]?.examples?.[exampleIndex];
      if(!example?.runId)return;
      button.disabled=true;
      try{const run=await api(`/api/runs/${encodeURIComponent(example.runId)}`);showRun(run,{caseId:example.caseId,expected:example.expected,actual:example.actual,reason:example.reason});}
      catch(error){toast(`读取调用详情失败：${error.message}`);}finally{button.disabled=false;}
    });
  }
  function updateFilters() {
    const scenarios=[...new Set([...(report.scenarios || []).map(row=>row.scenario),...(report.caseCoverage?.byDomain || []).flatMap(row=>(row.categories || []).map(item=>item.scenario))])];
    for(const [key,values,label,name] of [['domain',domainsOf(report),'全部领域',domainName],['model',modelsOf(report),'全部模型',value=>value],['scenario',scenarios,'全部场景',scenarioName]]) {
      const select=box.querySelector(`#report-${key}`);
      if(filters[key] && !values.includes(filters[key]))filters[key]='';
      const signature=JSON.stringify(values);
      if(select.dataset.reportOptions!==signature){select.innerHTML=`<option value="">${label}</option>`+values.map(value=>`<option value="${esc(value)}">${esc(name(value))}</option>`).join('');select.dataset.reportOptions=signature;}
      select.value=filters[key];
    }
  }
  function render() {
    if(!report)return;
    const results=box.querySelector('#domain-report-results');
    const opened=new Set([...results.querySelectorAll('[data-report-group][open]')].map(item=>item.dataset.reportGroup));
    const focus=document.activeElement,focusedTrace=focus?.dataset?.reportTrace,focusedGroup=focus?.parentElement?.dataset?.reportGroup,focusedPage=focus?.dataset?.reportPage;
    scenarioPage=reportScenarioPage(report,{...filters,scenarioPage}).page;
    results.innerHTML=renderDomainReport(report,{...filters,errorLimit,scenarioPage});
    results.querySelectorAll('[data-report-group]').forEach(item=>{if(opened.has(item.dataset.reportGroup))item.open=true;if(focusedGroup===item.dataset.reportGroup)item.querySelector('summary')?.focus({preventScroll:true});});
    if(focusedTrace)[...results.querySelectorAll('[data-report-trace]')].find(item=>item.dataset.reportTrace===focusedTrace)?.focus({preventScroll:true});
    if(focusedPage){const buttons=[...results.querySelectorAll('[data-report-page]')],same=buttons.find(item=>item.dataset.reportPage===focusedPage);(same?.disabled?buttons.find(item=>!item.disabled):same)?.focus({preventScroll:true});}
  }
  function schedule(){clearTimeout(timer);if(active && (!report || shouldPollDomainReport(report.status)))timer=setTimeout(load,10000);}
  async function load() {
    initialize();if(busy)return;busy=true;clearTimeout(timer);
    const refresh=box.querySelector('#report-refresh'),status=box.querySelector('#report-refresh-status');refresh.disabled=true;status.textContent='读取中…';
    try {
      report=await api('/api/domain-report');box.querySelector('#report-load-error').innerHTML='';
      updateFilters();render();box.querySelector('#report-export').disabled=false;
      status.textContent=!shouldPollDomainReport(report.status)?`${reportState(report.status).label}，自动更新已停止，可手动刷新`:active?`${report.status==='not_started'?'待启动，':'进行中，'}每 10 秒更新一次`:'已读取快照';
    }catch(error){box.querySelector('#report-load-error').innerHTML=notice(`读取领域报告失败：${error.message}${report?'。下方保留上次成功读取的快照。':''}`);if(!report)box.querySelector('#domain-report-results').innerHTML=empty('领域报告暂不可读','可点击刷新重试；未生成任何推测结果。');status.textContent=report && !shouldPollDomainReport(report.status)?'读取失败，可手动刷新重试':'读取失败，将自动重试';}
    finally{busy=false;refresh.disabled=false;schedule();}
  }
  function setActive(value){active=value;if(!active){clearTimeout(timer);return;}load();}
  return {setActive,load};
}
