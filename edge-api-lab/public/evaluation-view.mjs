import {api,escapeHtml as esc,badge,percent,duration,domainName,notice,empty,dateTime,downloadJson,selectCaseIds,caseMatchesScope,defaultEvaluationModelChecked,exclusiveBenchmarkMessage} from './ui-utils.mjs';

const activeStatus=status=>['queued','running'].includes(status);
export const shouldPollEvaluation=(status,suspended=false)=>!suspended && activeStatus(status);
export function renderExecutionScores(score) {
  if(!score || typeof score.plan!=='boolean')return '<p class="helper execution-score-label">执行语义：—（此旧记录未计算）</p>';
  const checks={...score,blocking:typeof score.blocking==='object'?score.blocking.match:score.blocking};
  return `<div class="execution-scores"><p class="helper execution-score-label">执行语义 · 与严格提取分开</p><div class="score-row">${Object.entries({domain:'领域',api:'API',finalArguments:'最终参数',status:'状态',precision:'精度',sources:'来源',blocking:'拦截状态',expectedResolverStatusMatchesGold:'预期契约',plan:'整体'}).filter(([key])=>typeof checks[key]==='boolean').map(([key,label])=>`<span class="score ${checks[key]?'':'fail'}">${checks[key]?'✓':'×'} ${label}</span>`).join('')}</div>${score.expectedResolverStatusMatchesGold===false?notice('用例期望状态与当前契约不一致，需要复核契约疑点，不能计为正确。','warning'):''}</div>`;
}
export function renderEvaluationSummary(summary=[]) {
  return `<div class="summary-scroller"><table class="data-table summary-table"><thead><tr><th>模型 / 样本</th><th>领域</th><th>API</th><th>参数 · 严格提取</th><th>状态</th><th>执行语义</th><th>P50</th><th>P95</th><th>错误</th></tr></thead><tbody>${summary.map(row=>`<tr><td>${esc(row.model)} <span class="muted">(${row.total})</span></td><td>${percent(row.domainAccuracy)}</td><td>${percent(row.apiAccuracy)}</td><td>${percent(row.argumentAccuracy)}</td><td>${percent(row.statusAccuracy)}</td><td>${percent(row.executionAccuracy)}</td><td>${duration(row.p50Ms)}</td><td>${duration(row.p95Ms)}</td><td class="${row.errorCount?'table-status-error':''}">${row.errorCount ?? '—'}</td></tr>`).join('')}</tbody></table></div><p class="helper">旧记录未计算执行语义时显示 —；原严格提取与完整计划评分保留。</p>`;
}
export function renderCaseScores(score={}) {
  return `<div class="score-row">${Object.entries({domain:'领域',api:'API',arguments:'参数',status:'状态',sources:'来源',resolution:'补全精度',plan:'整体'}).filter(([key])=>typeof score[key]==='boolean').map(([key,label])=>`<span class="score ${score[key]?'':'fail'}">${score[key]?'✓':'×'} ${label}</span>`).join('')}</div>`;
}
export function auxiliaryRuns(job) {return [...(job.warmups || []),...(job.cancelledRun?[job.cancelledRun]:[])].filter(run=>run&&typeof run==='object');}
export function renderEmptyEvaluation(job) {
  const descriptions={
    cancelled:['评测已停止','尚无完成样本，未计算准确率。预热或中断调用轨迹已保留，可在记录中查看或导出。'],
    failed:['评测未完成','尚无完成样本。请查看错误信息和已保留的调用轨迹。'],
    interrupted:['评测已中断','尚无完成样本。服务重启前已保存的调用轨迹仍可查看或导出。'],
    completed:['评测已结束','本次没有完成样本，未计算准确率。'],
    queued:['等待推理队列','首个样本完成后，将显示准确率与耗时。'],
  };
  const [title,description]=descriptions[job.status] || ['模型正在准备','首个样本完成后，将显示准确率与耗时。'];
  return empty(title,description);
}
export function renderAuxiliaryRuns(job) {
  const runs=auxiliaryRuns(job);
  if(!runs.length)return '';
  return `<div class="section-caption"><span>预热与中断调用</span><span>不计入准确率</span></div><div class="auxiliary-list">${runs.map((run,index)=>{
    const isWarmup=run.warmup || job.warmups?.includes(run);
    const label=isWarmup?(run.status==='cancelled'?'中断的预热':run.status==='error'?'失败的预热':'模型预热'):'中断的样本调用';
    return `<div class="auxiliary-row"><div><strong>${label}</strong> ${badge(run.status)}<div class="helper mono">${esc(run.model)} · ${run.traces?.length || 0} 次模型调用 · ${duration(run.totalMs)}</div></div><button type="button" class="button small secondary" data-aux-run="${index}">查看调用轨迹</button></div>`;
  }).join('')}</div>`;
}
export function createEvaluation({getModels,getOptions,showRun,toast,getExclusiveBenchmark=()=>null}) {
  const box=document.querySelector('#evaluation-content');
  let loaded=false,caseData,job,timer,jobList=[],busy=false,casePage=0,jobGeneration=0,suspended=false,modelsInitialized=false,limitEdited=false;

  const modelList=()=>getModels().filter(model=>model.eligible);
  function updateModels() {
    if (!loaded) return;
    const previous=new Set([...box.querySelectorAll('[name="eval-model"]:checked')].map(input=>input.value));
    box.querySelector('#eval-models').innerHTML=modelList().length?modelList().map(model=>`<label class="check-model"><input type="checkbox" name="eval-model" value="${esc(model.name)}" ${(modelsInitialized?previous.has(model.name):defaultEvaluationModelChecked(model.name))?'checked':''}><div><span class="mono">${esc(model.name)}</span><small>${esc(model.parameterSize || '参数量未知')} · ${esc(model.quantization || '量化未知')}</small></div></label>`).join(''):notice('尚未找到 10B 以下的已安装模型。请先准备模型，再刷新连接状态。','warning');
    if(modelList().length)modelsInitialized=true;
    updateExclusiveBenchmark();
  }
  async function load() {
    if(loaded){await refreshJobs();return;}
    box.innerHTML='<div class="loading-state"><span class="spinner"></span><p>正在准备固定评测集…</p></div>';
    try {
      caseData=await api('/api/cases');
    box.innerHTML=`<div class="evaluation-grid"><form class="panel evaluation-config" id="evaluation-form"><h2>评测配置</h2><label class="field-label">对照模型 <span class="muted">&lt; 10B</span></label><div id="eval-models" class="check-models"></div><label for="eval-mode" class="field-label">调用方式</label><select id="eval-mode"><option value="staged">分层调用 · 3 步</option><option value="unified" selected>一次调用 · 1 步</option></select><div class="form-row"><div><label for="eval-limit" class="field-label">每模型案例数</label><input type="number" id="eval-limit" min="1" max="${caseData.cases.length}" value="${Math.min(1000,caseData.cases.length)}"></div><div><label for="eval-repeats" class="field-label">重复次数</label><input type="number" id="eval-repeats" min="1" max="3" value="1"></div></div><label class="check-inline"><input type="checkbox" id="eval-warmup" checked>预热模型（耗时单独记录）</label><label for="eval-scope" class="field-label">场景范围</label><select id="eval-scope"><option value="single-service-100-v1">当前千题 · 10领域各100条（1000）</option><option value="single-service-v1">历史小样本 · 10领域各10条（100）</option><option value="history">历史开发集（478）</option><option value="all">全部案例（1578）</option></select><details class="case-select"><summary>选择案例 <span id="selected-case-count">${caseData.cases.length}</span> / ${caseData.cases.length}</summary><div class="header-actions" style="margin-top:10px"><button type="button" class="button small secondary" id="cases-all">全选</button><button type="button" class="button small secondary" id="cases-none">清空</button></div><div class="case-list">${caseData.cases.map(item=>`<label data-case-suite="${esc(item.suite || 'history')}" ${item.suite==='single-service-100-v1'?'':'hidden' }><input type="checkbox" name="eval-case" value="${esc(item.id)}" ${item.suite==='single-service-100-v1'?'checked':''}><span>${esc(item.text)}<span class="muted">${esc(item.category)} · ${esc(item.id)}</span></span></label>`).join('')}</div></details><p class="helper">默认 1000 条单领域、单API案例，unified 一次调用；0.5B / 1.5B / 3B / 7B 默认勾选；可手动调整已安装模型。固定时间与 fixture 模拟手机位置，不读取电脑 GPS。单服务范围按领域均衡抽样；数量可手改。独立千题实测运行期间不可重复提交。</p><div id="eval-exclusive-notice"></div><div id="eval-submit-notice"></div><button class="button primary" id="eval-submit" type="submit">开始评测 <span>↗</span></button><div class="job-selector"><label for="past-jobs" class="field-label">已有评测</label><select id="past-jobs"><option value="">载入中…</option></select><p class="helper" id="eval-fixture">基准：${esc(caseData.context?.now)}<br>${esc(caseData.context?.timezone)} · fixture 模拟手机上海位置</p></div></form><div id="job-content">${empty('等待一组可比较的结果','选择模型与案例，开始这次准确率和耗时验证。')}</div></div>`;
      loaded=true;updateModels();updateCaseCount();
      box.querySelector('#eval-scope').addEventListener('change',event=>{
        const scope=event.target.value;
        box.querySelectorAll('[data-case-suite]').forEach(label=>{
          const visible=caseMatchesScope(label.dataset.caseSuite,scope);
          label.hidden=!visible;label.querySelector('input').checked=visible;
        });updateCaseCount();
        if(!limitEdited)box.querySelector('#eval-limit').value=caseData.cases.filter(item=>caseMatchesScope(item.suite || 'history',scope)).length || 1;
      });
      box.querySelector('#eval-limit').addEventListener('input',()=>{limitEdited=true;});
      box.querySelector('#evaluation-form').addEventListener('submit',start);
      box.querySelector('#past-jobs').addEventListener('change',event=>{if(event.target.value)loadJob(event.target.value);});
      box.querySelectorAll('[name="eval-case"]').forEach(input=>input.addEventListener('change',updateCaseCount));
      for(const [id,checked] of [['cases-all',true],['cases-none',false]]) box.querySelector(`#${id}`).addEventListener('click',()=>{box.querySelectorAll('[name="eval-case"]').forEach(input=>{if(!input.parentElement.hidden)input.checked=checked;});updateCaseCount();});
      await refreshJobs();
    }catch(error){box.innerHTML=notice(error.message)+'<button class="button secondary">重新加载</button>';box.querySelector('button').addEventListener('click',load);}
  }
  function updateCaseCount(){box.querySelector('#selected-case-count').textContent=box.querySelectorAll('[name="eval-case"]:checked').length;}
  async function refreshJobs() {
    try {
      jobList=(await api('/api/evaluations?view=summary')).evaluations;
      const select=box.querySelector('#past-jobs');if(!select)return;
      select.innerHTML='<option value="">选择一组评测记录…</option>'+jobList.map(item=>`<option value="${esc(item.id)}" ${job?.id===item.id?'selected':''}>${esc(dateTime(item.createdAt))} · ${esc(item.status)} · ${item.progress?.done || 0}/${item.progress?.total || 0}</option>`).join('');
      if(!job && jobList.length) await loadJob((jobList.find(item=>activeStatus(item.status)) || jobList[0]).id);
    }catch(error){toast(`读取评测记录失败：${error.message}`);}
  }
  async function start(event) {
    event.preventDefault();if(busy)return;
    if(getExclusiveBenchmark()){updateExclusiveBenchmark();toast(exclusiveBenchmarkMessage(getExclusiveBenchmark()));return;}
    const models=[...box.querySelectorAll('[name="eval-model"]:checked')].map(input=>input.value);
    const caseIds=selectCaseIds([...box.querySelectorAll('[name="eval-case"]:checked')].map(input=>input.value),Number(box.querySelector('#eval-limit').value),caseData.cases);
    const output=box.querySelector('#eval-submit-notice');
    if(!models.length||!caseIds.length){output.innerHTML=notice('至少选择一个模型和一个案例。','warning');return;}
    busy=true;box.querySelector('#eval-submit').disabled=true;output.innerHTML='';
    try {
      const result=await api('/api/evaluations',{method:'POST',body:JSON.stringify({models,mode:box.querySelector('#eval-mode').value,caseIds,limit:Number(box.querySelector('#eval-limit').value),repeats:Number(box.querySelector('#eval-repeats').value),warmup:box.querySelector('#eval-warmup').checked,options:getOptions()})});
      await loadJob(result.id);await refreshJobs();toast('评测已进入串行推理队列');
    }catch(error){output.innerHTML=notice(error.message);}finally{busy=false;updateExclusiveBenchmark();}
  }
  async function loadJob(id) {
    clearTimeout(timer);const generation=++jobGeneration;
    try{const nextJob=await api(`/api/evaluations/${encodeURIComponent(id)}`);if(generation!==jobGeneration)return;job=nextJob;casePage=0;box.querySelector('#past-jobs').value=job.id;renderJob();schedulePoll();}
    catch(error){if(generation===jobGeneration)box.querySelector('#job-content').innerHTML=notice(error.message);}
  }
  function schedulePoll(){clearTimeout(timer);if(job&&shouldPollEvaluation(job.status,suspended))timer=setTimeout(poll,2000);}
  async function poll() {
    if(suspended || !job)return;
    const generation=jobGeneration;
    try {
      const wasActive=activeStatus(job.status);
      const nextJob=await api(`/api/evaluations/${encodeURIComponent(job.id)}`);if(generation!==jobGeneration)return;job=nextJob;renderJob();
      if(wasActive&&!activeStatus(job.status)){toast('评测状态已更新，结果保存在本机');await refreshJobs();}
    }catch(error){if(generation!==jobGeneration || suspended)return;const target=box.querySelector('#job-content');target.querySelector('[data-poll-error]')?.remove();target.insertAdjacentHTML('afterbegin',`<div data-poll-error>${notice(`进度读取失败：${error.message}。将自动重试。`)}</div>`);timer=setTimeout(poll,5000);return;}
    schedulePoll();
  }
  function renderJob() {
    const target=box.querySelector('#job-content');if(!target||!job)return;
    const done=job.progress?.done || 0,total=job.progress?.total || 0;
    const summary=job.summary || [];
    const results=job.results || [];
    const hasResolutionScores=results.some(row=>typeof row.score?.resolution==='boolean');
    const scoreLegend=hasResolutionScores?'领域、API、参数、状态、来源与补全精度均匹配':'领域、API、参数、状态与来源均匹配';
    const pageSize=20,pages=Math.max(1,Math.ceil(results.length/pageSize));casePage=Math.min(casePage,pages-1);
    const visible=results.slice(casePage*pageSize,(casePage+1)*pageSize);
    const completed=job.status==='completed';
    const auxRuns=auxiliaryRuns(job);
    target.innerHTML=`<div class="panel job-panel"><div class="job-top"><h2>${activeStatus(job.status)?'<span class="spinner" style="margin-right:9px"></span>':''}本次评测 ${badge(job.status)}</h2>${activeStatus(job.status)?'<button class="button small danger" id="cancel-job">取消评测</button>':'<button class="button small secondary" id="download-job">导出本次 JSON</button>'}</div><div class="job-progress"><div style="width:${total?Math.min(100,done/total*100):0}%"></div></div><div class="job-progress-label"><span>${done} / ${total} 个样本${!completed&&done?' · 当前为部分结果':''}</span><span>${esc(job.mode || job.config?.mode || '')} · ${esc(job.id.slice(0,8))}</span></div>${job.catalogVersion?`<p class="helper job-catalog-version">契约版本 <span class="mono">${esc(job.catalogVersion)}</span></p>`:''}${job.error?notice(typeof job.error==='string'?job.error:JSON.stringify(job.error)):''}${renderAuxiliaryRuns(job)}</div>${summary.length?`<div class="panel comparison-panel"><div class="comparison-title"><h2>完整计划准确率 · 严格评分</h2><span class="comparison-hint">${scoreLegend}</span></div>${summary.map(row=>`<div class="chart-row"><span class="mono">${esc(row.model)}</span><div class="chart-track" role="img" aria-label="${esc(row.model)} 准确率 ${percent(row.planAccuracy)}"><div class="chart-bar" style="width:${Math.max(0,Math.min(100,(row.planAccuracy || 0)*100))}%"></div></div><strong>${percent(row.planAccuracy)}</strong></div>`).join('')}${renderEvaluationSummary(summary)}<p class="comparison-caption">${completed?'全部样本':'已完成样本'}统计；错误计入分母。耗时包含补全和模型调用，预热单独保留。样本量较小时，结果仅用于这组实验。</p></div>`:renderEmptyEvaluation(job)}<div class="panel table-wrap evaluation-results"><div class="panel-title"><h2>逐例结果 <span class="muted small">${results.length} 条</span></h2><div class="header-actions"><button id="case-prev" class="button small secondary" ${casePage===0?'disabled':''}>‹</button><span class="muted small">${casePage+1} / ${pages}</span><button id="case-next" class="button small secondary" ${casePage===pages-1?'disabled':''}>›</button></div></div>${visible.length?`<table class="data-table"><thead><tr><th>案例 / 模型</th><th>匹配情况</th><th>耗时 / 状态</th><th>详情</th></tr></thead><tbody>${visible.map((row,index)=>`<tr><td class="prompt-cell">${esc(row.text)}<div class="helper mono">${esc(row.model)} · ${esc(row.caseId)}${row.repeatIndex!=null?` · 第 ${row.repeatIndex+1} 次`:''}</div></td><td>${renderCaseScores(row.score)}${renderExecutionScores(row.executionScore)}<div class="helper">${esc(domainName(row.actual?.domain || row.run?.domain))} / ${esc(row.actual?.api || row.run?.api || '—')}</div></td><td class="mono">${duration(row.run?.totalMs)}<div>${badge(row.run?.status || row.actual?.status)}</div></td><td><button class="button small secondary" data-case-result="${casePage*pageSize+index}">查看</button></td></tr>`).join('')}</tbody></table>`:empty('尚无完成的案例')}</div>`;
    target.querySelector('#download-job')?.addEventListener('click',()=>downloadJson(job,`evaluation-${job.id}.json`));
    target.querySelector('#cancel-job')?.addEventListener('click',async event=>{
      event.target.disabled=true;clearTimeout(timer);
      const id=job.id,generation=++jobGeneration;
      try {
        const cancelled=await api(`/api/evaluations/${encodeURIComponent(id)}/cancel`,{method:'POST',body:'{}'});
        if(generation!==jobGeneration)return;
        job=cancelled;renderJob();
        timer=setTimeout(async()=>{
          try {const snapshot=await api(`/api/evaluations/${encodeURIComponent(id)}`);if(generation===jobGeneration){job=snapshot;renderJob();await refreshJobs();}}
          catch(error){toast(`取消状态已保存，调用记录刷新失败：${error.message}`);}
        },500);
      }catch(error){toast(error.message);event.target.disabled=false;schedulePoll();}
    });
    target.querySelectorAll('[data-aux-run]').forEach(button=>button.addEventListener('click',()=>showRun(auxRuns[Number(button.dataset.auxRun)])));
    target.querySelectorAll('[data-case-result]').forEach(button=>button.addEventListener('click',()=>{const row=results[Number(button.dataset.caseResult)];showRun(row.run,{expected:row.expected,score:row.score,executionScore:row.executionScore});}));
    target.querySelector('#case-prev')?.addEventListener('click',()=>{casePage--;renderJob();});target.querySelector('#case-next')?.addEventListener('click',()=>{casePage++;renderJob();});
  }
  function setSuspended(value){if(suspended===value)return;suspended=value;clearTimeout(timer);if(!suspended)schedulePoll();}
  function updateExclusiveBenchmark(){if(!loaded)return;const benchmark=getExclusiveBenchmark();box.querySelector('#eval-submit').disabled=busy||Boolean(benchmark);const target=box.querySelector('#eval-exclusive-notice');if(target)target.innerHTML=benchmark?notice(exclusiveBenchmarkMessage(benchmark),'warning'):'';}
  return {load,updateModels,setSuspended,updateExclusiveBenchmark};
}


