import {escapeHtml as esc,pretty,stageName,notice,duration} from './ui-utils.mjs';

export const inferenceModeName=mode=>({adaptive:'Qwen 智能分步',laya:'Laya 本机选择 + Qwen 填参',jev:'Jev + Qwen',unified:'一次调用 · 历史对照',staged:'固定分层 · 历史对照'}[mode] || mode || '模式未记录');
export const inferenceModeDescription=mode=>({adaptive:'Qwen 通常分 2 次：先识别领域，再一起选择 API 与提取简单参数；复杂输入分 3 次，先选 API 再独立填参。提前拒识或失败按实际轨迹记录。',laya:'Laya 在本机选择领域与 API，Qwen 本机提取参数；有入参通常 3 次，无入参 API 省略 Qwen，实际 2 次。无需 API 密钥或充值，仍有模型下载和本机计算成本。',jev:'Jev 官方云端先选择领域与 API，Qwen 本机提取参数；无入参 API 省略 Qwen 参数调用。云端请求可能产生费用，尚未配置密钥时无法运行。',unified:'一次 Qwen 调用同时选择领域、API 和参数，用于与已完成的 4,000 条历史基线比较。新请求另外保存。',staged:'固定分层：领域 → API → 参数，通常 3 次 Qwen 调用。提前拒识或失败时会停止后续阶段。'}[mode] || '请选择调用方式。');
export function renderInferenceModes(selected='adaptive') {
  const labels={adaptive:'Qwen 智能分步 · 通常 2 步',laya:'Laya 本机选择 + Qwen 填参 · 2–3 步',jev:'Jev 选择 + Qwen 填参 · 2–3 步',unified:'一次调用 · 历史对照',staged:'固定分层 · 历史对照'};
  return Object.entries(labels).map(([mode,label])=>`<option value="${mode}"${mode===selected?' selected':''}>${label}</option>`).join('');
}
export function inferenceOverrideStages(mode) {
  const keys=mode==='unified'?['unified']:mode==='adaptive'?['domain','intent_arguments','intent','arguments']:['domain','intent','arguments'];
  return keys.map(stage=>({stage,allowsJev:['domain','intent'].includes(stage),allowsLaya:['domain','intent'].includes(stage),forcedProvider:['jev','laya'].includes(mode)&&['domain','intent'].includes(stage)?mode:null,label:stageName(stage)+(mode==='adaptive'&&['intent','arguments'].includes(stage)?' · 复杂请求':mode==='adaptive'&&stage==='intent_arguments'?' · 简单请求':'')}));
}
export function collectInferenceOverrides(mode,values={}) {
  const out={};
  for(const {stage,allowsJev,allowsLaya,forcedProvider}of inferenceOverrideStages(mode)){
    const value=values[stage] || {};
    if(forcedProvider){out[stage]={provider:forcedProvider};continue;}
    const provider=value.provider || '',model=String(value.model || '').trim();
    if(provider==='jev'&&!allowsJev)throw new Error('官方 Jev 只允许选择领域和 API，参数与联合生成使用本机 Qwen。');
    if(provider==='laya'&&!allowsLaya)throw new Error('Laya 只允许选择领域和 API，参数与联合生成使用本机 Qwen。');
    if(provider&&!['ollama','jev','laya'].includes(provider))throw new Error('此提供方未在页面开放。');
    if(provider||model)out[stage]={provider:provider || 'ollama',...(model&&!['jev','laya'].includes(provider)?{model}:{})};
  }
  return out;
}
export function renderInferenceOverrides(mode,values={},jev={},laya={}) {
  return inferenceOverrideStages(mode).map(({stage,label,allowsJev,allowsLaya,forcedProvider})=>{
    const value=values[stage] || {},provider=forcedProvider || (value.provider==='jev'&&allowsJev?'jev':value.provider==='laya'&&allowsLaya?'laya':value.provider==='ollama'?'ollama':'');
    const decision=['jev','laya'].includes(provider),model=decision||['jev','laya'].includes(value.provider)?'':String(value.model || '');
    const providerLabel=provider==='laya'?'Laya 本机':'Jev 官方云端';
    return `<div class="override-row" data-stage="${stage}"${forcedProvider?` data-forced-provider="${forcedProvider}"`:''}><label for="provider-${stage}">${esc(label)}</label><select id="provider-${stage}" aria-label="${esc(label)} 提供方"${forcedProvider?' disabled':''}>${forcedProvider?`<option value="${forcedProvider}" selected>${providerLabel}</option>`:`<option value=""${provider===''?' selected':''}>继承基础 Qwen 模型</option><option value="ollama"${provider==='ollama'?' selected':''}>本机 Ollama</option>${allowsLaya?`<option value="laya"${provider==='laya'?' selected':''}>Laya 本机${layaCanRun(laya)?'':' · 尚未就绪'}</option>`:''}${allowsJev?`<option value="jev"${provider==='jev'?' selected':''}>Jev 官方云端${jev.configured?'':' · 未配置'}</option>`:''}`}</select><input id="model-${stage}" aria-label="${esc(label)} 模型" value="${esc(model)}" placeholder="${esc(provider==='laya'?laya.model || 'Laya 模型由服务配置':provider==='jev'?jev.model || 'Jev 模型由服务配置':'本机模型名（可选）')}"${decision?' disabled':''}></div>`;
  }).join('');
}
export const jevCanRun=jev=>Boolean(jev?.configured&&jev?.official===true&&jev?.sdkInstalled!==false&&!jev?.error);
export const inferenceRequiresJev=(mode,stages={})=>mode==='jev'||Object.values(stages).some(stage=>stage.provider==='jev');
export const layaCanRun=laya=>Boolean(laya?.ready===true&&laya?.local===true&&laya?.cloud===false&&!laya?.error);
export const inferenceRequiresLaya=(mode,stages={})=>mode==='laya'||Object.values(stages).some(stage=>stage.provider==='laya');
export function renderLayaStatus(laya={}) {
  const ready=layaCanRun(laya),reason=laya.error || (!ready?'尚未取得本机 Laya 模型就绪状态。':'');
  return `<div class="resolution-card"><h3>Laya 本机 · ${ready?'已就绪':'尚未就绪'}</h3><p class="helper">Laya 本机选择领域与 API，Qwen 本机填参。无需 API 密钥或充值；首次安装需下载模型，运行仍消耗本机内存、电力与 CPU 计算。</p>${reason?notice(reason,'warning'):''}<p class="helper">模型 ${esc(laya.model ?? '未报告')} · 计算设置 ${esc(laya.device ?? '未报告')} · 线程 ${esc(laya.threads ?? '未报告')} · 版本 ${esc(laya.version ?? '未报告')}</p><details class="raw-details"><summary>本机启动指引与模型状态</summary><p class="helper">双击工程“安装启动Laya.bat”，等待模型下载和加载；已有模型可再次使用该入口启动。回到页面刷新状态后运行。停止服务可用“停止Laya.bat”；不在页面填写任何密钥。</p><p class="helper">接口 ${esc(laya.url ?? '未报告')} · 模型 revision ${esc(laya.modelRevision ?? '未报告')}</p><p class="helper">当前概率口径与本机限制见“详细说明”的“Laya 本机决策”。</p><pre>${pretty(laya)}</pre></details></div>`;
}
export function renderDecisionProviderStatus({mode,stages={},jev={},laya={}}={}) {
  const needsLaya=inferenceRequiresLaya(mode,stages),needsJev=inferenceRequiresJev(mode,stages);
  if(needsLaya||needsJev)return (needsLaya?renderLayaStatus(laya):'')+(needsJev?renderJevStatus(jev):'');
  return `<details class="config-section"><summary>可选决策模型 · Laya 本机 / Jev 云端</summary>${renderLayaStatus(laya)}${renderJevStatus(jev)}</details>`;
}
export function renderJevStatus(jev={}) {
  const ready=jevCanRun(jev),reason=jev.error || jev.reason || (!jev.configured?'本机后端未配置 TYPESAFE_API_KEY。':jev.official!==true?'服务未报告官方 Jev 接口，请更新或重启工程。':jev.sdkInstalled===false?'官方 SDK 尚未安装。':'');
  return `<div class="resolution-card"><h3>Jev 官方云端 · ${ready?'已配置，凭据有效性待实际请求核验':'未配置 / 尚未就绪'}</h3><p class="helper">Jev 判断领域与 API，Qwen 在本机填参。官方云端请求可能产生费用，与本机 Ollama 无按 token 云服务账单的运行方式不同。</p>${reason?notice(reason,'warning'):''}<p class="helper">密钥只由本机后端读取，不在浏览器填写或保存。尚无真实 Jev 成绩；概率和 confidence 不能代替准确率评测。</p><details class="raw-details"><summary>就绪指引与配置状态</summary><p class="helper">先打开 <a href="https://console.typesafe.ai" target="_blank" rel="noopener noreferrer">TypeSafe 官方控制台</a>，完成注册或登录后，按官方控制台提示获取 API 密钥。当前可使用 Google 或邮箱入口；登录后的操作以实际提示为准。可参阅 <a href="https://docs.typesafe.ai/introduction/quickstart" target="_blank" rel="noopener noreferrer">官方快速入门</a>。</p><p class="helper">先安装工程依赖，再在工程的 .env 或系统环境设置 TYPESAFE_API_KEY。重启实验工程后刷新状态；不要把密钥粘贴到提示词或导出记录。</p><p class="helper">模型 ${esc(jev.model || '待服务报告')} · SDK ${esc(jev.sdkVersion || '待服务报告')} · 接口 ${esc(jev.baseURL || jev.baseUrl || '待服务报告')}</p><p class="helper">具体步骤与实验口径见“详细说明”的“智能分步与 Jev”。</p></details></div>`;
}
const triggerLabel=(reason,run)=>reason==='typed_decision_requires_arguments'&&(run?.stages?.intent?.provider==='laya'||run?.traces?.some(trace=>trace.stage==='intent'&&trace.provider==='laya'))?'Laya 选择 API 后需要本机提取参数':({explicit_json:'输入包含明确的 JSON 结构',multi_field_write:'输入包含多个需要写入的字段',multiple_time_roles:'输入包含多个时间角色或时间范围',typed_decision_requires_arguments:'Jev 选择 API 后需要本机提取参数'}[reason] || reason);
export function renderInferenceRouting(run={}) {
  const traces=Array.isArray(run.traces)?run.traces:[],routing=run.routing;
  const reasons=routing?.triggerReasons ?? routing?.argumentPlan?.reasons ?? [];
  const complex=routing?.path==='three_step' || routing?.argumentPlan?.separate===true;
  const skipped=Array.isArray(routing?.skippedStages)?routing.skippedStages:[];
  return `<div class="resolution-card"><h3>${esc(inferenceModeName(run.mode))} · 实际 ${traces.length} 次模型调用</h3>${run.mode==='jev'?'<p class="helper">Jev 官方云端选择领域与 API，Qwen 本机填参；最终业务仍为模拟回执。</p>':''}${run.mode==='laya'?'<p class="helper">Laya 本机选择领域与 API，Qwen 本机填参；无需云端密钥，最终业务仍为模拟回执。</p>':''}${run.mode==='adaptive'?`<p class="helper">通常先识别领域，再联合选择 API 与提取参数。${complex?'本次计划独立提取参数。':'实际完成阶段以下方调用记录为准。'}</p>`:''}${complex&&!['jev','laya'].includes(run.mode)&&reasons.length?`<p class="helper"><strong>参数独立提取的原因：</strong>${reasons.map(reason=>esc(typeof reason==='string'?triggerLabel(reason,run):JSON.stringify(reason))).join('；')}</p>`:''}${skipped.map(item=>`<p class="helper">${item?.reason==='api_has_no_inputs'?'该 API 没有输入参数，已省略 Qwen 参数调用':`已省略 ${esc(stageName(typeof item==='string'?item:item?.stage))}：${esc(item?.reason || '本次无需该阶段')}`}</p>`).join('')}${routing?`<details class="raw-details"><summary>阶段规划与实际执行记录</summary><pre>${pretty({...routing,actualCallCount:traces.length})}</pre></details>`:''}</div>`;
}

export function renderJevDecision(trace={}) {
  if(trace.provider!=='jev')return '';
  let response;try{response=typeof trace.raw==='string'?JSON.parse(trace.raw):trace.raw;}catch{}
  const request=trace.request || {},questions=request.questions || {},key=Object.keys(questions)[0],answer=trace.answer ?? response?.answers?.[key];
  const confidence=trace.confidence ?? answer?.confidence;
  const probabilities=trace.probabilities ?? answer?.probabilities;
  const usage=trace.usage ?? response?.usage;
  return `<section class="resolution-card"><h3>Jev 官方决策</h3><p class="helper">官方 choice 从给定选项中判断；confidence 不是正确率，也不能证明参数或业务结果正确。</p><p class="helper">confidence：${typeof confidence==='number'&&Number.isFinite(confidence)?confidence.toFixed(3):'未取得'} · usage 输入 ${esc(usage?.input_tokens ?? '—')} / 输出 ${esc(usage?.output_tokens ?? '—')} token</p><p class="helper">请求模型 ${esc(trace.requestedModel || request.model || '未记录')}；实际模型 ${esc(trace.model || response?.model || '未取得')}。官方未提供分段耗时，本次只使用真实请求总耗时；不推算冷加载或生成速度。</p><details class="raw-details"><summary>问题与判断标准</summary><pre>${pretty(questions)}</pre></details><details class="raw-details"><summary>输入状态</summary><pre>${pretty(request.state ?? null)}</pre></details><details class="raw-details"><summary>官方 typed answer 与概率分布</summary><pre>${pretty({answer:answer ?? null,probabilities:probabilities ?? null,confidence:confidence ?? null,usage:usage ?? null})}</pre></details><details class="raw-details"><summary>官方请求 JSON · 不含密钥</summary><pre>${pretty({state:request.state,model:request.model,questions:request.questions})}</pre></details>${trace.httpStatus?`<p class="helper">HTTP 状态 ${esc(trace.httpStatus)}</p>`:''}</section>`;
}

export function renderLayaDecision(trace={}) {
  if(trace.provider!=='laya')return '';
  let response;try{response=typeof trace.raw==='string'?JSON.parse(trace.raw):trace.raw;}catch{}
  const request=trace.request || {},key=Object.keys(request.questions || {})[0],answer=trace.answer ?? response?.answers?.[key];
  const tournament=trace.tournament ?? answer?.x_tournament,usage=trace.usage ?? response?.usage;
  const observedCount=value=>Number.isInteger(value)&&value>=0?String(value):'未观测';
  const confidence=trace.confidence ?? answer?.confidence;
  return `<section class="resolution-card"><h3>Laya 本机决策</h3><p class="helper">本机 choice 选择领域或 API，不生成业务参数。Laya confidence 源于归一化熵，不是正确率，也不能与 Jev 云端 confidence 直接混比。</p><p class="helper">HTTP 请求 ${esc(trace.httpCalls ?? '未取得')} 次 · 内部 predict ${observedCount(trace.internalPredictCalls)} 次${trace.internalPredictCalls!=null?'（根据淘汰轮数与最终轮源码推导）':''} · 底层 forward ${observedCount(trace.forwardPasses)}</p><p class="helper">请求总耗时由调用记录显示；服务报告推理耗时 ${duration(trace.inferenceMs)}。input_tokens 累计；其余诊断主要来自最后一轮，中间轮截断未完整透传；输出 token 为 0 也不计算生成速度。</p><p class="helper">confidence ${typeof confidence==='number'&&Number.isFinite(confidence)?confidence.toFixed(3):'未取得'} · 输入 ${esc(usage?.input_tokens ?? '—')} / 输出 ${esc(usage?.output_tokens ?? '—')} token。请求模型 ${esc(trace.requestedModel || request.model || '未记录')}；实际模型 ${esc(trace.model || response?.model || '未取得')}。</p>${tournament?notice('本次采用分组淘汰；淘汰候选的 0 分不代表全量候选的联合校准概率。','info'):''}<details class="raw-details"><summary>问题、输入状态与本机请求 JSON</summary><pre>${pretty(request)}</pre></details><details class="raw-details"><summary>短候选与真实 API 映射</summary><pre>${pretty(trace.choiceMap ?? {})}</pre></details><details class="raw-details"><summary>决策答案与概率 · 保留原始短候选</summary><pre>${pretty({answer:answer ?? null,mappedProbabilities:trace.probabilities ?? null,wireProbabilities:trace.wireProbabilities ?? answer?.probabilities ?? null,confidence:confidence ?? null,answerConfidence:trace.answerConfidence ?? null,x_jev_confidence:trace.jevConfidence ?? null})}</pre></details><details class="raw-details"><summary>分组淘汰、调用计数与截断证据</summary><pre>${pretty({tournament:tournament ?? null,httpCalls:trace.httpCalls ?? null,internalPredictCalls:trace.internalPredictCalls ?? null,internalPredictCallsBasis:trace.internalPredictCallsBasis ?? null,forwardPasses:trace.forwardPasses ?? null,usage:usage ?? null,truncated:trace.truncated ?? null})}</pre></details><p class="helper">x_jev_confidence 是本机响应扩展字段，只保留原值，不作为官方 Jev 云端成绩。</p></section>`;
}
