import {api,escapeHtml as esc,pretty,duration,notice,downloadJson,stageName,exclusiveBenchmarkMessage} from './ui-utils.mjs';
import {renderRun,bindRunDownload} from './run-view.mjs';
import {createLibrary} from './library.mjs';
import {createEvaluation} from './evaluation-view.mjs';
import {createDomainReport} from './domain-report-view.mjs';
import {createGroundingReport} from './grounding-report-view.mjs';
import {createSingleService100View} from './single-service-100-view.mjs';
import {buildContext} from './context-builder.mjs';

const $=selector=>document.querySelector(selector);
let health={models:[],recommendedModels:[]},running=false,toastTimer;
const pageNames={experiment:'实验台',evaluation:'批量评测',catalog:'能力目录',history:'运行记录',docs:'详细说明'};
const library=createLibrary({showRun,toast});
const getExclusiveBenchmark=()=>health.lab?.exclusiveBenchmark;
const evaluation=createEvaluation({getModels:()=>health.models || [],getOptions,showRun,toast,getExclusiveBenchmark});
const domainReport=createDomainReport({showRun,toast});
const groundingReport=createGroundingReport({showRun,toast});
const singleService100=createSingleService100View({showRun,toast,onRefresh:()=>loadHealth()});
let evaluationView='workbench';

function toast(message) {
  clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;
  toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);
}
function showRun(run,extra) {
  $('#dialog-content').innerHTML=(extra?`<details class="raw-details"><summary>基准期望与匹配结果</summary><pre>${pretty(extra)}</pre></details>`:'')+renderRun(run);
  bindRunDownload($('#dialog-content'),run,downloadJson);
  if(!$('#run-dialog').open)$('#run-dialog').showModal();
}
$('#close-dialog').addEventListener('click',()=>$('#run-dialog').close());
$('#run-dialog').addEventListener('click',event=>{if(event.target===$('#run-dialog')){const bounds=event.target.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)event.target.close();}});

function navigate(page) {
  if(!pageNames[page])page='experiment';
  document.querySelectorAll('.page').forEach(section=>section.hidden=section.id!==`page-${page}`);
  document.querySelectorAll('[data-page]').forEach(button=>{const active=button.dataset.page===page;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  $('#current-page').textContent=pageNames[page];document.title=`${pageNames[page]} · 端侧 API 实验室`;
  if(locationHash()!==page)history.replaceState(null,'',`#${page}`);
  if(page==='catalog')library.loadCatalog();
  if(page==='history')library.loadHistory();
  if(page==='docs')library.loadDocs();
  evaluation.setSuspended(page!=='evaluation' || evaluationView!=='workbench');
  domainReport.setActive(page==='evaluation' && evaluationView==='report');
  groundingReport.setActive(page==='evaluation' && evaluationView==='grounding');
  singleService100.setActive(page==='evaluation' && evaluationView==='single100');
  if(page==='experiment')loadHealth();
  if(page==='evaluation' && evaluationView==='workbench')evaluation.load();
}
const locationHash=()=>window.location.hash.replace('#','');
document.querySelectorAll('[data-page]').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.page)));
window.addEventListener('hashchange',()=>navigate(locationHash()));

function setEvaluationView(view) {
  evaluationView=['report','grounding','single100'].includes(view)?view:'workbench';
  document.querySelectorAll('[data-evaluation-view]').forEach(button=>{const selected=button.dataset.evaluationView===evaluationView;button.classList.toggle('active',selected);button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;});
  $('#evaluation-content').hidden=evaluationView!=='workbench';
  $('#domain-report-content').hidden=evaluationView!=='report';
  $('#grounding-report-content').hidden=evaluationView!=='grounding';
  $('#single-service-100-content').hidden=evaluationView!=='single100';
  evaluation.setSuspended($('#page-evaluation').hidden || evaluationView!=='workbench');
  domainReport.setActive(!$('#page-evaluation').hidden && evaluationView==='report');
  groundingReport.setActive(!$('#page-evaluation').hidden && evaluationView==='grounding');
  singleService100.setActive(!$('#page-evaluation').hidden && evaluationView==='single100');
  if(!$('#page-evaluation').hidden && evaluationView==='workbench')evaluation.load();
}
document.querySelectorAll('[data-evaluation-view]').forEach(button=>{
  button.addEventListener('click',()=>setEvaluationView(button.dataset.evaluationView));
  button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=[...document.querySelectorAll('[data-evaluation-view]')],index=tabs.indexOf(button),target=tabs[event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length];setEvaluationView(target.dataset.evaluationView);target.focus();});
});

function modelMetadata() {
  const model=health.models?.find(item=>item.name===$('#base-model').value);
  const excluded=health.models?.filter(item=>!item.eligible).length || 0;
  $('#model-detail').textContent=model?`${model.parameterSize || '参数量未知'} · ${model.quantization || '量化未知'}${model.size?` · ${(model.size/1024**3).toFixed(2)} GB`:''} · ${model.recommended?'推荐梯度模型':'本机模型'}${excluded?` · ${excluded} 个模型不满足 < 10B 条件`:''}`:'没有可用模型；请安装模型后刷新。';
}
async function loadHealth() {
  $('#refresh-health').disabled=true;
  try {
    health=await api('/api/health');
    const okay=health.ollama?.ok;
    $('#connection-status').classList.toggle('error',!okay);
    $('#connection-status').innerHTML=`<span class="tiny-dot"></span>${okay?`Ollama ${esc(health.ollama.version || '')} 已连接`:'Ollama 未连接'}`;
    const eligible=(health.models || []).filter(model=>model.eligible);
    const previous=$('#base-model').value;
    const fallback=eligible.find(model=>model.name==='qwen2.5:3b')?.name || health.recommendedModels?.find(name=>eligible.some(model=>model.name===name)) || eligible[0]?.name;
    $('#base-model').innerHTML=eligible.length?eligible.map(model=>`<option value="${esc(model.name)}">${esc(model.name)}${model.recommended?' · 推荐':''}</option>`).join(''):'<option value="">没有 10B 以下的可用模型</option>';
    $('#base-model').value=eligible.some(model=>model.name===previous)?previous:fallback || '';
    $('#health-notice').innerHTML=(getExclusiveBenchmark()?notice(exclusiveBenchmarkMessage(getExclusiveBenchmark()),'warning'):'')+(!okay?notice(`无法连接本机 Ollama。${health.ollama?.error || '请启动 Ollama 后刷新状态。'}`,'warning'):!eligible.length?notice('Ollama 已连接，尚未发现符合 10B 以下条件的模型。请安装推荐模型后刷新。','warning'):'');
    $('#run-submit').disabled=running || !okay || !eligible.length || Boolean(getExclusiveBenchmark());
    modelMetadata();evaluation.updateModels();
  }catch(error){$('#connection-status').innerHTML='<span class="tiny-dot"></span>工程服务未连接';$('#connection-status').classList.add('error');$('#health-notice').innerHTML=notice(error.message);$('#run-submit').disabled=true;}
  finally{$('#refresh-health').disabled=false;}
}
$('#refresh-health').addEventListener('click',loadHealth);$('#base-model').addEventListener('change',modelMetadata);

const savedOverrides={};
function renderOverrides() {
  document.querySelectorAll('[data-stage]').forEach(row=>{savedOverrides[row.dataset.stage]={provider:row.querySelector('select').value,model:row.querySelector('input').value};});
  const stages=$('#run-mode').value==='unified'?['unified']:['domain','intent','arguments'];
  $('#stage-overrides').innerHTML=stages.map(stage=>`<div class="override-row" data-stage="${stage}"><label for="provider-${stage}">${stageName(stage)}</label><select id="provider-${stage}" aria-label="${stageName(stage)} 提供方"><option value="">继承基础模型</option><option value="ollama">Ollama</option><option value="jev">Jev</option></select><input id="model-${stage}" aria-label="${stageName(stage)} 模型" placeholder="模型名（可选）"></div>`).join('');
  document.querySelectorAll('[data-stage]').forEach(row=>{const value=savedOverrides[row.dataset.stage];if(value){row.querySelector('select').value=value.provider;row.querySelector('input').value=value.model;}});
}
$('#run-mode').addEventListener('change',renderOverrides);renderOverrides();
document.querySelectorAll('[data-example]').forEach(button=>button.addEventListener('click',()=>{$('#prompt-text').value=button.dataset.example;$('#prompt-text').focus();}));

function updateClock() {
  $('#system-clock').textContent=new Date().toLocaleString('zh-CN',{hour12:false});
  $('#system-timezone').textContent=Intl.DateTimeFormat().resolvedOptions().timeZone;
}
updateClock();setInterval(updateClock,1000);
function updateLocation() {
  const mode=$('#location-mode').value;
  $('#location-description').textContent=mode==='fixture'?'模拟手机当前位置：上海固定坐标 31.2304, 121.4737，仅用于演示和复现；不读取电脑位置，也不是手机真实定位。':mode==='coarse'?'模拟手机当前位置：上海城市代表点，声明精度约 20 公里（mock 实验值）；不读取电脑位置。':mode==='none'?'不提供模拟手机位置。提示词明确给出的城市仍可使用地理编码夹具；关闭下方开关可测试地点无法解析。':'该位置模式不可用；不会读取电脑位置，也不会自动使用固定坐标。';
}
$('#location-mode').addEventListener('change',updateLocation);
updateLocation();
function getOptions() {
  const options={num_ctx:Number($('#num-ctx').value)};
  if($('#num-predict').value.trim())options.num_predict=Number($('#num-predict').value);
  return options;
}
function getContext() {
  const weatherAvailability=Object.fromEntries([...document.querySelectorAll('[data-weather-dataset]')].map(input=>[input.dataset.weatherDataset,input.checked]));
  const selectedObjects=Object.fromEntries([...document.querySelectorAll('[data-selected-object]')].map(input=>[input.dataset.selectedObject,input.value]));
  return buildContext({timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,locationMode:$('#location-mode').value,weatherAvailability,geocoding:$('#geocoding-fixture').checked,selectedObjects});
}
$('#run-form').addEventListener('submit',async event=>{
  event.preventDefault();if(running)return;
  if(getExclusiveBenchmark()){toast(exclusiveBenchmarkMessage(getExclusiveBenchmark()));return;}
  const text=$('#prompt-text').value.trim();
  if(!text){toast('请填写用户提示词');return;}
  const stages={};
  document.querySelectorAll('[data-stage]').forEach(row=>{const provider=row.querySelector('select').value,model=row.querySelector('input').value.trim();if(provider||model)stages[row.dataset.stage]={provider:provider || 'ollama',...(model?{model}:{})};});
  const request={text,mode:$('#run-mode').value,model:$('#base-model').value,stages,context:getContext(),options:getOptions()};
  running=true;$('#run-submit').disabled=true;$('#run-submit').innerHTML='<span class="spinner"></span>推理中';
  const started=performance.now();
  $('#run-result').innerHTML=`<div class="panel waiting-panel"><span class="spinner"></span><h2 style="margin-top:22px">模型正在生成调用计划</h2><p style="margin-top:7px">${esc(request.model)} · ${request.mode==='unified'?'一次调用':'领域 → API → 参数'}<br>首次调用可能包含模型冷加载。</p><p id="elapsed-time" class="mono" style="margin-top:25px">0.00 s</p></div>`;
  const ticker=setInterval(()=>{const target=$('#elapsed-time');if(target)target.textContent=duration(performance.now()-started);},100);
  try {
    const run=await api('/api/runs',{method:'POST',body:JSON.stringify(request)});
    $('#run-result').innerHTML=renderRun(run);bindRunDownload($('#run-result'),run,downloadJson);
    $('#run-hint').textContent=run.status==='error'?'调用失败记录已保存':'本次验证记录已保存';
  }catch(error){$('#run-result').innerHTML=`<div class="panel result-panel">${notice(error.message)}<p class="helper">检查工程服务和模型状态后重试。</p></div>`;}
  finally{clearInterval(ticker);running=false;$('#run-submit').disabled=!health.ollama?.ok || !health.models?.some(model=>model.eligible) || Boolean(getExclusiveBenchmark());$('#run-submit').innerHTML='运行验证 <span>↗</span>';}
});
navigate(locationHash() || 'experiment');if(locationHash()!=='experiment')loadHealth();

