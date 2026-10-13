import {createHash} from 'node:crypto';

export const LAYA_REUSE_REPORT_VERSION='laya-reuse-report-v1';
const CACHE_VERSION='laya-benchmark-reuse-v1',POLICY='exact-native-request-v1';
const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const validMs=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const profileKnown=p=>p&&typeof p.modelRevision==='string'&&p.modelRevision&&typeof p.layaVersion==='string'&&p.layaVersion&&Number.isInteger(p.threads)&&p.threads>0;
const norm=path=>String(path || '').replaceAll('\\','/');
const decisions=entry=>entry.record?.shadow?.decisions ?? entry.record?.run?.shadow?.decisions ?? [];
function stats(values){const a=values.filter(validMs).sort((a,b)=>a-b),q=p=>a.length?a[Math.round((a.length-1)*p)]:null;return {samples:a.length,totalMs:a.length?a.reduce((x,y)=>x+y,0):null,meanMs:a.length?a.reduce((x,y)=>x+y,0)/a.length:null,p50Ms:q(.5),p95Ms:q(.95)};}
function score(values){const known=values.filter(v=>typeof v==='boolean'),correct=known.filter(Boolean).length;return {correct,total:known.length,unknown:values.length-known.length,accuracy:known.length?correct/known.length:null};}
function profileMatches(a,b){return ['modelRevision','layaVersion','threads'].every(key=>a?.[key]===undefined||a[key]===b?.[key]);}

/** Pure projection of saved raw files. Never invokes a provider or changes frozen scores. */
export function buildLayaReuseReport(entries,{manifestId=null,profile=null,serviceRecords=[],transition=null,generatedAt=new Date().toISOString(),plannedDomainCases=1000}={}){
  const counts={decisions:0,cacheHits:0,newInferences:0,inFlightMerged:0,legacyAttempts:0,legacyRepeatedRequests:0,invalidMetadata:0,unversionedLegacy:0,unverifiedOrigins:0,rawParseFailures:0};
  const diagnostics=[],observations=[],groups=new Map(),legacySeen=new Set();
  const formalByPath=new Map(),serviceByPath=new Map();
  for(const entry of entries)for(const path of [entry.recordPath,entry.absolutePath])if(path)formalByPath.set(norm(path),entry);
  for(const entry of serviceRecords)for(const path of [entry.recordPath,entry.absolutePath])if(path)serviceByPath.set(norm(path),entry);
  function originSource(meta){
    const origin=meta.origin || {};
    if(origin.type==='service_inference'){
      const file=serviceByPath.get(norm(origin.serviceRecordPath)),data=file?.record;
      if(!file||file.recordSha256!==origin.serviceRecordSha256||data?.version!==CACHE_VERSION||data.namespace!==meta.namespace||data.requestSha256!==meta.requestSha256||!data.request||sha(data.request)!==meta.requestSha256||!profileMatches(data.profile,meta))return null;
      if(meta.responseSha256&&(typeof data.responseRaw!=='string'||sha(data.responseRaw)!==meta.responseSha256))return null;
      return {client:null,native:data.inferenceMs,server:data.serviceWallMs,source:'verified_service_record',recordPath:file.recordPath};
    }
    const file=formalByPath.get(norm(origin.recordPath));
    if(!file||file.recordSha256!==origin.recordSha256||!Number.isInteger(origin.traceIndex)||origin.traceIndex<0||origin.manifestId&&file.record?.manifestId!==origin.manifestId)return null;
    const decision=decisions(file)[origin.traceIndex],trace=decision?.laya?.trace;
    if(!trace?.request||sha(trace.request)!==meta.requestSha256||origin.stage&&decision.stage!==origin.stage)return null;
    if(meta.responseSha256&&(typeof trace.raw!=='string'||sha(trace.raw)!==meta.responseSha256))return null;
    return {client:trace.wallMs,native:trace.inferenceMs,server:null,source:'verified_formal_origin',recordPath:file.recordPath};
  }
  for(const entry of entries)for(const decision of decisions(entry)){
    if(!['domain','intent'].includes(decision.stage))continue;
    counts.decisions++;const trace=decision.laya?.trace || {},stage=decision.stage==='intent'?'api':'domain';let payload,meta;
    try{payload=typeof trace.raw==='string'?JSON.parse(trace.raw):trace.raw;meta=payload?.x_benchmark_reuse;}catch{counts.rawParseFailures++;}
    const item={entry,decision,trace,stage,meta,source:null,key:null};observations.push(item);
    if(!trace.request){diagnostics.push({recordPath:entry.recordPath,stage,reason:'native request missing'});continue;}
    const requestSha256=sha(trace.request),candidateKey=JSON.stringify(decision.candidateIds ?? trace.choiceMap ?? null);
    if(meta!==undefined){
      const valid=meta&&meta.version===CACHE_VERSION&&meta.policy===POLICY&&profileKnown(meta)&&typeof meta.namespace==='string'&&meta.namespace&&meta.requestSha256===requestSha256&&typeof meta.hit==='boolean'&&typeof meta.inferenceExecuted==='boolean'&&meta.hit===!meta.inferenceExecuted&&(!profile||profileMatches(profile,meta))&&(!profile?.namespace||profile.namespace===meta.namespace);
      if(!valid){counts.invalidMetadata++;diagnostics.push({recordPath:entry.recordPath,stage,reason:'cache metadata version/profile/request hash invalid'});continue;}
      if(meta.hit)counts.cacheHits++;else counts.newInferences++;
      if(meta.inFlightMerged===true)counts.inFlightMerged++;
      item.source=originSource(meta);
      if(!meta.hit)item.source={client:trace.wallMs,native:meta.originalInferenceMs ?? trace.inferenceMs,server:meta.originalServiceWallMs,source:'saved_fresh_inference',recordPath:entry.recordPath};
      if(meta.hit&&!item.source){counts.unverifiedOrigins++;diagnostics.push({recordPath:entry.recordPath,stage,reason:'cache origin path/hash or request cannot be verified'});}
      item.key=JSON.stringify([stage,meta.namespace,meta.modelRevision,meta.layaVersion,meta.threads,requestSha256,candidateKey]);
    }else{
      counts.legacyAttempts++;const oldKey=JSON.stringify([stage,requestSha256,candidateKey]);if(legacySeen.has(oldKey))counts.legacyRepeatedRequests++;else legacySeen.add(oldKey);
      if(!profileKnown(profile)){counts.unversionedLegacy++;continue;}
      item.key=JSON.stringify([stage,profile.namespace ?? manifestId,profile.modelRevision,profile.layaVersion,profile.threads,requestSha256,candidateKey]);
      item.source={client:trace.wallMs,native:trace.inferenceMs,server:null,source:'saved_legacy_inference',recordPath:entry.recordPath};
    }
    if(!groups.has(item.key))groups.set(item.key,[]);groups.get(item.key).push(item);
  }
  const stages={};
  for(const stage of ['domain','api']){
    const items=observations.filter(x=>x.stage===stage),unique=[...groups.values()].filter(list=>list[0].stage===stage);
    const first=unique.map(list=>{
      const ordered=[...list].sort((a,b)=>(Date.parse(a.trace.startedAt)||0)-(Date.parse(b.trace.startedAt)||0));
      const own=ordered.find(x=>x.source&&(!x.meta||x.meta.inferenceExecuted)),source=own?.source ?? ordered.find(x=>x.source)?.source ?? null;
      const decision=(own ?? ordered[0]).decision;
      return {selection:decision.laya?.selectionCorrect,contract:decision.laya?.contractValid,noError:decision.laya?.error==null&&decision.laya?.contractValid===true,source,requestSha256:sha(ordered[0].trace.request),caseIds:[...new Set(list.map(x=>x.entry.record?.caseId))]};
    });
    stages[stage]={attempts:items.length,uniqueRequests:unique.length,uniqueCaseIds:new Set(items.map(x=>x.entry.record?.caseId).filter(Boolean)).size,
      caseSelection:score(items.map(x=>x.decision.laya?.selectionCorrect)),caseContract:score(items.map(x=>x.decision.laya?.contractValid)),uniqueSelection:score(first.map(x=>x.selection)),uniqueContract:score(first.map(x=>x.contract)),uniqueNoError:score(first.map(x=>x.noError)),
      firstClientHttp:stats(first.map(x=>x.source?.client)),firstNativeInference:stats(first.map(x=>x.source?.native)),firstServerRequest:stats(first.map(x=>x.source?.server)),accessHttp:stats(items.map(x=>x.trace.wallMs)),lookup:stats(items.filter(x=>x.meta?.version===CACHE_VERSION&&x.key).map(x=>x.meta.lookupMs)),
      origins:first.map(x=>({requestSha256:x.requestSha256,caseIds:x.caseIds,source:x.source}))};
  }
  return {version:LAYA_REUSE_REPORT_VERSION,manifestId,generatedAt,policy:POLICY,cacheVersion:CACHE_VERSION,transition:transition ?? null,plannedDomainCases,profile,counts,stages,diagnostics,
    notes:['原评测页Laya wallMs是HTTP访问汇总；本专项将首次模型与缓存访问分开，lookup不进入首次模型P50。','领域目标1000个用例，跨Qwen不重复计算；实际唯一数按完整native请求与部署版本去重。API依Qwen选域和候选请求，候选不同分别计量。','选择/结构分数读取正式gold已有decision布尔值，不改评分；不是Laya完整端到端成功率。','metadata未知版本/错误hash不纳入可信复用指标；源文件缺失或源SHA无效时不采用其首次模型耗时。','复用后CPU竞争减轻，Qwen前后耗时存在政策条件变化；保留切换时点，不归因模型或提示词改善。']};
}

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ms=value=>validMs(value)?`${value.toFixed(2)} ms`:'未知';
const rate=value=>value?.accuracy==null?'未知':`${(value.accuracy*100).toFixed(1)}%（${value.correct}/${value.total}）`;
export function renderLayaReuseHtml(report){
  const rows=['domain','api'].map(key=>{const stage=report.stages?.[key];return `<tr><th>${key==='domain'?'领域':'API'}</th><td>${stage?.uniqueRequests ?? '未知'} / ${stage?.uniqueCaseIds ?? '未知'} 用例</td><td>${rate(stage?.uniqueSelection)}</td><td>${rate(stage?.uniqueContract)}</td><td>${ms(stage?.firstClientHttp?.p50Ms)} / ${ms(stage?.firstClientHttp?.p95Ms)}</td><td>${ms(stage?.firstNativeInference?.p50Ms)} / ${ms(stage?.firstNativeInference?.p95Ms)}</td><td>${ms(stage?.firstServerRequest?.p50Ms)} / ${ms(stage?.firstServerRequest?.p95Ms)}</td><td>${ms(stage?.accessHttp?.p50Ms)} / ${ms(stage?.accessHttp?.p95Ms)}</td><td>${ms(stage?.lookup?.p50Ms)}</td></tr>`;}).join('');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Laya 本机复用计量</title><style>body{margin:0;background:#f6f5f0;color:#182a38;font:16px/1.65 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:24px}section{background:white;border:1px solid #dbe3e1;border-radius:12px;padding:20px;margin:18px 0}a{color:#08786d}h1,h2{line-height:1.3}.scroll{overflow:auto}table{border-collapse:collapse;min-width:980px;width:100%;font-size:14px}th,td{text-align:left;padding:12px;border-bottom:1px solid #dbe3e1;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere}.muted{color:#52636b}@media(max-width:600px){main{padding:12px}section{padding:14px}}</style><main><a href="/#evaluation">返回千题结果</a> · <a href="laya-reuse.json">下载本专项 JSON</a><h1>Laya 本机复用计量</h1><p><strong>原评测页 Laya 累计是 HTTP 访问；请在本页区分首次模型计算与缓存访问。</strong></p><p class="muted">只读快照 ${esc(report.generatedAt)} · 批次 ${esc(report.manifestId)}</p><section><h2>当前政策与切换</h2><p>${esc(report.policy)} · ${esc(report.cacheVersion)}</p><p>政策切换：${report.transition?esc(report.transition.at ?? report.transition.effectiveAt ?? report.transition.observedAt ?? '证据未登记明确时间'):'尚未登记切换证据，不猜测时点'}。缓存后 CPU 竞争改变，Qwen速度前后差只作观察。</p><p>领域唯一输入目标 ${report.plannedDomainCases} 个用例；API 唯一数依 Qwen 选域与完整候选请求。完整请求及版本相同才复用，跨Qwen模型不重复算首次；不同API候选另计。</p><p>新推理 ${report.counts?.newInferences ?? '未知'} · 缓存命中 ${report.counts?.cacheHits ?? '未知'} · 合并等待 ${report.counts?.inFlightMerged ?? '未知'} · 历史未缓存访问 ${report.counts?.legacyAttempts ?? '未知'}（重复 ${report.counts?.legacyRepeatedRequests ?? '未知'}）</p><p>无效缓存metadata ${report.counts?.invalidMetadata ?? '未知'} · 未验证首次来源 ${report.counts?.unverifiedOrigins ?? '未知'} · 未确认版本的历史请求 ${report.counts?.unversionedLegacy ?? '未知'}</p></section><section><h2>首次模型与实际访问 · 分开统计</h2><p>首次客户端HTTP含请求往返；原生推理header与服务请求壁钟另列，三者不互换。缓存lookup时间不加入首次模型P50。每列样本可能不同，缺失保持未知。</p><div class="scroll"><table><thead><tr><th>阶段</th><th>唯一请求 / 覆盖用例</th><th>首次唯一选择正确率</th><th>首次结构有效率</th><th>首次客户端 HTTP P50 / P95</th><th>首次原生模型 P50 / P95</th><th>首次服务请求 P50 / P95</th><th>所有实际访问 P50 / P95</th><th>lookup P50</th></tr></thead><tbody>${rows}</tbody></table></div><p>选择分数直接读取正式用例的已有gold判断，原评分不变；Laya不填参，这不是Laya完整流程成功率。</p></section><section><h2>口径与来源限制</h2>${report.notes.map(note=>`<p>${esc(note)}</p>`).join('')}<details><summary>计量、来源与缺失证据</summary><pre>${esc(JSON.stringify(report,null,2))}</pre></details></section></main></html>`;
}
