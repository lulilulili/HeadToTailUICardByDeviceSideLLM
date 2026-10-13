import {api,escapeHtml as esc,badge,domainName,duration,dateTime,notice,empty,flattenInputs,fieldConstraint} from './ui-utils.mjs';
import {filterCapabilities,renderCapability,objectLabel,granularityLabel} from './capability-view.mjs';

export function createLibrary({showRun,toast}) {
  let catalog,docs,domainFilter='all',objectFilter='all',granularityFilter='all',search='',catalogPage=0,docId;
  const catalogBox=document.querySelector('#catalog-content');
  const docsBox=document.querySelector('#docs-content');
  const historyBox=document.querySelector('#history-content');

  function renderCapabilities() {
    const scoped=catalog.capabilities.filter(item=>domainFilter==='all'||item.domain===domainFilter);
    const objects=[...new Set(scoped.map(item=>item.object).filter(Boolean))];
    const granularities=[...new Set(scoped.flatMap(item=>item.granularities || []))];
    if(!objects.includes(objectFilter))objectFilter='all';
    if(!granularities.includes(granularityFilter))granularityFilter='all';
    catalogBox.querySelector('#catalog-object').innerHTML='<option value="all">全部对象</option>'+objects.map(value=>`<option value="${esc(value)}" ${objectFilter===value?'selected':''}>${esc(objectLabel(value))} · ${esc(value)}</option>`).join('');
    catalogBox.querySelector('#catalog-granularity').innerHTML='<option value="all">全部时间粒度</option>'+granularities.map(value=>`<option value="${esc(value)}" ${granularityFilter===value?'selected':''}>${esc(granularityLabel(value))} · ${esc(value)}</option>`).join('');
    const filtered=filterCapabilities(scoped,{object:objectFilter,granularity:granularityFilter,search});
    const pageSize=24,pages=Math.max(1,Math.ceil(filtered.length/pageSize));catalogPage=Math.min(catalogPage,pages-1);
    catalogBox.querySelector('#catalog-visible-count').textContent=`匹配 ${filtered.length} / ${catalog.capabilities.length} API`;
    catalogBox.querySelector('#catalog-page-number').textContent=`${catalogPage+1} / ${pages}`;
    catalogBox.querySelector('#catalog-prev').disabled=catalogPage===0;
    catalogBox.querySelector('#catalog-next').disabled=catalogPage===pages-1;
    catalogBox.querySelector('#capability-list').innerHTML=filtered.length?filtered.slice(catalogPage*pageSize,(catalogPage+1)*pageSize).map(renderCapability).join(''):empty('没有匹配的能力','尝试更换对象、粒度或搜索词。');
    catalogBox.querySelectorAll('[data-domain]').forEach(button=>button.classList.toggle('active',button.dataset.domain===domainFilter));
  }
  async function loadCatalog() {
    if (catalog) return;
    catalogBox.innerHTML='<div class="loading-state"><span class="spinner"></span><p>正在载入能力目录…</p></div>';
    try {
      catalog=await api('/api/catalog');
      document.querySelector('#catalog-count').textContent=`${catalog.domains.length} 领域 / ${catalog.capabilities.length} API`;
      const fields=catalog.capabilities.filter(item=>item.risk==='read'&&!item.aggregate&&item.field&&item.field!=='*').length;
      catalogBox.innerHTML=`<div class="overview-cards"><div class="overview-card"><h3>服务领域</h3><strong>${catalog.domains.length}</strong><p>按用户任务划分</p></div><div class="overview-card"><h3>业务能力</h3><strong>${catalog.capabilities.length}</strong><p>统一伪 API 契约</p></div><div class="overview-card"><h3>字段读取 API</h3><strong>${fields}</strong><p>对象、字段与返回投影</p></div><div class="overview-card"><h3>真实业务写入</h3><strong>0</strong><p>全部由模拟执行器接收</p></div></div><div class="catalog-toolbar"><input id="catalog-search" type="search" placeholder="搜索 API、字段或功能…" aria-label="搜索能力和字段"><div class="filter-pills"><button data-domain="all" class="active">全部</button>${catalog.domains.map(item=>`<button data-domain="${esc(item.id)}">${esc(item.name || domainName(item.id))}</button>`).join('')}</div></div><div class="catalog-subfilters"><div><label class="field-label" for="catalog-object">读取对象</label><select id="catalog-object"></select></div><div><label class="field-label" for="catalog-granularity">时间粒度</label><select id="catalog-granularity"></select></div></div><div class="catalog-results-top"><span id="catalog-visible-count"></span><div class="header-actions"><button id="catalog-prev" class="button small secondary" aria-label="上一页能力">‹</button><span id="catalog-page-number" class="mono"></span><button id="catalog-next" class="button small secondary" aria-label="下一页能力">›</button></div></div><div class="capability-grid" id="capability-list"></div>`;
      catalogBox.querySelector('#catalog-search').addEventListener('input',event=>{search=event.target.value;catalogPage=0;renderCapabilities();});
      catalogBox.querySelector('#catalog-object').addEventListener('change',event=>{objectFilter=event.target.value;catalogPage=0;renderCapabilities();});
      catalogBox.querySelector('#catalog-granularity').addEventListener('change',event=>{granularityFilter=event.target.value;catalogPage=0;renderCapabilities();});
      catalogBox.querySelector('#catalog-prev').addEventListener('click',()=>{catalogPage--;renderCapabilities();});
      catalogBox.querySelector('#catalog-next').addEventListener('click',()=>{catalogPage++;renderCapabilities();});
      catalogBox.querySelectorAll('[data-domain]').forEach(button=>button.addEventListener('click',()=>{domainFilter=button.dataset.domain;objectFilter='all';granularityFilter='all';catalogPage=0;renderCapabilities();}));
      if(catalog.version)catalogBox.querySelector('.catalog-results-top').insertAdjacentHTML('beforebegin',`<p class="helper catalog-version">契约版本 <span class="mono">${esc(catalog.version)}</span> · 历史结果按当时的契约保留</p>`);
      renderCapabilities();
    } catch (error) {catalogBox.innerHTML=notice(error.message)+`<button class="button secondary" id="retry-catalog">重新加载</button>`;catalogBox.querySelector('button').addEventListener('click',loadCatalog);}
  }
  function renderDocs() {
    if (!docs.length) {docsBox.innerHTML=empty('说明文档尚未载入');return;}
    docId=docs.some(item=>item.id===docId)?docId:docs[0].id;
    const current=docs.find(item=>item.id===docId);
    docsBox.innerHTML=`<div class="docs-shell"><nav class="docs-tabs" aria-label="工程说明页签">${docs.map(item=>`<button ${item.id===docId?'class="active" aria-current="page"':''} data-doc="${esc(item.id)}">${esc(item.title)}</button>`).join('')}</nav><article class="panel docs-article" tabindex="0">${current.html}</article></div>`;
    docsBox.querySelectorAll('[data-doc]').forEach(button=>button.addEventListener('click',()=>{docId=button.dataset.doc;renderDocs();}));
  }
  async function loadDocs() {
    if(docs){renderDocs();return;}
    docsBox.innerHTML='<div class="loading-state"><span class="spinner"></span><p>正在载入工程说明…</p></div>';
    try{docs=(await api('/api/docs')).sections;renderDocs();}catch(error){docsBox.innerHTML=notice(error.message)+'<button class="button secondary">重新加载</button>';docsBox.querySelector('button').addEventListener('click',loadDocs);}
  }
  async function loadHistory() {
    historyBox.innerHTML='<div class="loading-state"><span class="spinner"></span><p>正在读取本机运行记录…</p></div>';
    try {
      const {runs}=await api('/api/runs');
      historyBox.innerHTML=`<div class="history-toolbar"><span>${runs.length} 条本机记录</span><div><select id="history-status" aria-label="按状态筛选记录"><option value="all">全部状态</option><option value="ready_mock">模拟调用就绪</option><option value="needs_clarification">需要澄清</option><option value="resolution_failed">补全失败</option><option value="unsupported">不支持的请求</option><option value="error">调用失败</option><option value="cancelled">已取消</option></select><button id="refresh-history" class="button small secondary">刷新</button></div></div><div class="panel table-wrap" id="history-table"></div>`;
      function render() {
        const status=historyBox.querySelector('#history-status').value;
        const filtered=runs.filter(run=>status==='all'||run.status===status);
        historyBox.querySelector('#history-table').innerHTML=filtered.length?`<table class="data-table"><thead><tr><th>提示词 / 时间</th><th>模型 / 方式</th><th>领域 / API</th><th>状态</th><th>总耗时</th><th>详情</th></tr></thead><tbody>${filtered.map(run=>`<tr><td class="prompt-cell">${esc(run.text)}<div class="helper">${esc(dateTime(run.createdAt || run.timestamp))}</div></td><td><span class="mono">${esc(run.model)}</span><div class="helper">${run.mode==='unified'?'一次调用':'分层调用'}</div></td><td>${esc(domainName(run.domain))}<div class="helper mono">${esc(run.api || '—')}</div></td><td>${badge(run.status)}</td><td class="mono">${duration(run.totalMs)}</td><td><button class="button small secondary" data-run-id="${esc(run.id)}">查看 ↗</button></td></tr>`).join('')}</tbody></table>`:empty('暂无匹配的运行记录','在实验台完成一次验证，记录会保存在这里。');
        historyBox.querySelectorAll('[data-run-id]').forEach(button=>button.addEventListener('click',async()=>{try{button.disabled=true;showRun(await api(`/api/runs/${encodeURIComponent(button.dataset.runId)}`));}catch(error){toast(error.message);}finally{button.disabled=false;}}));
      }
      historyBox.querySelector('#history-status').addEventListener('change',render);historyBox.querySelector('#refresh-history').addEventListener('click',loadHistory);render();
    }catch(error){historyBox.innerHTML=notice(error.message)+'<button class="button secondary">重新加载</button>';historyBox.querySelector('button').addEventListener('click',loadHistory);}
  }
  return {loadCatalog,loadDocs,loadHistory};
}


