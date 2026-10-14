export {renderLayaIndependentHtml} from '../public/laya-independent-view.mjs';

export const LAYA_INDEPENDENT_REPORT_VERSION='laya-independent-report-v1';
const REUSE_VERSION='laya-independent-replay-v1';
const validMs=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const sumKnown=values=>values.length&&values.every(validMs)?values.reduce((a,b)=>a+b,0):null;
function stats(values){
 const a=values.filter(validMs).sort((a,b)=>a-b),quantile=p=>{if(!a.length)return null;const index=(a.length-1)*p,lo=Math.floor(index),hi=Math.ceil(index);return a[lo]+(a[hi]-a[lo])*(index-lo);};
 return {samples:a.length,totalMs:a.length?a.reduce((x,y)=>x+y,0):null,meanMs:a.length?a.reduce((x,y)=>x+y,0)/a.length:null,p50Ms:quantile(.5),p95Ms:quantile(.95)};
}
const metric=(records,key)=>{const correct=records.filter(r=>r.score?.[key]===true).length;return{correct,total:records.length,accuracy:records.length?correct/records.length:null};};
const labels={domain_gate:'领域门控导致正确API不可见',domain_gate_miss:'领域门控导致正确API不可见',retrieval_miss:'正确领域内候选漏召回',candidate_missing:'正确领域内候选漏召回',candidate_choice:'候选内选错',candidate_choice_miss:'候选内选错',provider_error:'服务或协议失败',domain_error:'领域选择错误',other:'其他选择错误'};
function errorCode(record){
 const score=record.score??{};
 if(score.joint===true)return null;
 if(score.providerError)return 'provider_error';
 if(score.domainGateMiss)return 'domain_gate';
 if(score.retrievalMiss)return 'retrieval_miss';
 if(score.candidateChoiceMiss)return 'candidate_choice';
 return score.errorCategory??(score.domain===false?'domain_error':'other');
}
function metrics(records){
 const reachable=records.filter(r=>r.score?.expectedInCandidates===true),eligible=records.filter(r=>r.score?.candidateRecallEligible===true);
 return{domain:metric(records,'domain'),api:metric(records,'api'),joint:metric(records,'joint'),apiReachable:metric(reachable,'api'),candidateRecallEligible:{correct:eligible.filter(r=>r.score?.expectedInCandidates===true).length,total:eligible.length,accuracy:eligible.length?eligible.filter(r=>r.score?.expectedInCandidates===true).length/eligible.length:null},domainGateMiss:records.filter(r=>r.score?.domainGateMiss===true).length,retrievalMiss:records.filter(r=>r.score?.retrievalMiss===true).length,candidateChoiceMiss:records.filter(r=>r.score?.candidateChoiceMiss===true).length,providerError:records.filter(r=>r.score?.providerError===true).length};
}
function timing(records,profile){
 const reuse={hits:0,verifiedHits:0,unverifiedHits:0,fresh:0,unknownMetadata:0},stageMap=new Map(),requests={wall:[],mixedSources:[],currentFreshNative:[]};
 for(const record of records){
  requests.wall.push(record.selection?.totalMs);
  const sources=[],freshOnly=[];
  for(const trace of record.selection?.traces??[]){
   const stage=trace.stage??'unknown';
   if(!stageMap.has(stage))stageMap.set(stage,{stage,calls:0,httpCalls:0,knownHttpTraces:0,cacheHits:0,freshCalls:0,access:[],http:[],currentNative:[],historicalSource:[],historicalSourceHttp:[],historicalSourceService:[],mixedSources:[],lookup:[]});
   const item=stageMap.get(stage),meta=trace.independentReuse;
   item.calls++;item.access.push(trace.wallMs);
   if(Number.isInteger(trace.httpCalls)&&trace.httpCalls>=0){item.httpCalls+=trace.httpCalls;item.knownHttpTraces++;if(trace.httpCalls>0)item.http.push(trace.wallMs);}
   const compatible=meta?.version===REUSE_VERSION&&typeof meta.hit==='boolean'&&['modelRevision','layaVersion','threads'].every(k=>profile?.[k]===undefined||meta.profile?.[k]===profile[k]);
   let source=null,current=null;
   if(!compatible){reuse.unknownMetadata++;}
   else if(meta.hit){
    reuse.hits++;item.cacheHits++;item.lookup.push(meta.lookupMs);
    if(meta.verified===true){reuse.verifiedHits++;source=validMs(meta.sourceInferenceMs)?meta.sourceInferenceMs:null;item.historicalSource.push(source);item.historicalSourceHttp.push(meta.sourceHttpMs);item.historicalSourceService.push(meta.sourceServiceMs);}
    else reuse.unverifiedHits++;
   }else if(meta.verified===true){
    reuse.fresh++;item.freshCalls++;current=validMs(trace.inferenceMs)?trace.inferenceMs:null;source=current;item.currentNative.push(current);
   }else reuse.unknownMetadata++;
   item.mixedSources.push(source);sources.push(source);freshOnly.push(current);
  }
  requests.mixedSources.push(sumKnown(sources));requests.currentFreshNative.push(sumKnown(freshOnly));
 }
 return{reuse,timing:{stages:[...stageMap.values()].map(s=>({...s,httpCalls:s.knownHttpTraces===s.calls?s.httpCalls:null,access:stats(s.access),http:stats(s.http),currentNative:stats(s.currentNative),historicalSource:stats(s.historicalSource),historicalSourceHttp:stats(s.historicalSourceHttp),historicalSourceService:stats(s.historicalSourceService),mixedSources:stats(s.mixedSources),lookup:stats(s.lookup)})),requests:Object.fromEntries(Object.entries(requests).map(([k,v])=>[k,stats(v)])),percentileMethod:'linear_interpolation',scope:'选择访问含客户端只读复用；HTTP仅本轮实际网络请求。当前原生推理仅未复用调用；历史来源推理仅已验证复用。来源推理之和可跨历史/本轮，不是本轮完整冷推理实测。'}};
}

/** Saved-record projection only. Does not invoke a provider or alter gold/scores. */
export function buildLayaIndependentReport(manifest,records=[]){
 if(!manifest?.id)throw new Error('Manifest ownership missing');
 const ids=new Set();
 for(const record of records){
  if(record?.manifestId!==manifest.id||!record.caseId)throw new Error('Record ownership mismatch');
  if(ids.has(record.caseId))throw new Error('Duplicate formal case');
  ids.add(record.caseId);
 }
 const total=manifest.progress?.total??manifest.corpus?.total??1000,done=records.length;
 if(done>total)throw new Error('Formal cases exceed plan');
 const terminal=['failed','cancelled','interrupted'].includes(manifest.status),status=terminal?manifest.status:manifest.status==='completed'&&done===total?'completed':manifest.status==='completed'?'partial':manifest.status==='running'?'running':done?'partial':'planned';
 const errorMap=new Map();
 for(const record of records){const code=errorCode(record);if(!code)continue;if(!errorMap.has(code))errorMap.set(code,{code,label:labels[code]??code,count:0,caseIds:[]});const group=errorMap.get(code);group.count++;group.caseIds.push(record.caseId);}
 const domains=[...new Set([...(manifest.corpus?.domains??[]).map(x=>typeof x==='string'?x:x.testDomain),...records.map(r=>r.testDomain)].filter(Boolean))];
 const summary=timing(records,manifest.conditions?.profile);
 return{version:LAYA_INDEPENDENT_REPORT_VERSION,id:manifest.id,status,manifestStatus:manifest.status,generatedAt:new Date().toISOString(),progress:{done,total},conditions:manifest.conditions??{},environment:manifest.environment??{},corpus:manifest.corpus??{},storage:manifest.storage??{},createdAt:manifest.createdAt??null,completedAt:manifest.completedAt??null,metrics:metrics(records),...summary,cells:domains.map(testDomain=>{const rows=records.filter(r=>r.testDomain===testDomain),t=timing(rows,manifest.conditions?.profile);return{testDomain,total:rows.length,metrics:metrics(rows),timing:t.timing,reuse:t.reuse};}),errors:[...errorMap.values()].sort((a,b)=>b.count-a.count),cases:records.map(record=>({caseId:record.caseId,testDomain:record.testDomain,scenario:record.scenario,text:record.text,context:record.context,expected:record.expected,domain:record.selection?.domain??null,api:record.selection?.api??null,status:record.selection?.status??'unknown',error:record.selection?.error??null,totalMs:record.selection?.totalMs??null,candidates:record.selection?.candidates??{},decisions:record.selection?.decisions??{},traces:record.selection?.traces??[],score:record.score??{},errorCategory:errorCode(record),rawPath:manifest.storage?.rawDirectory?`${manifest.storage.rawDirectory.replace(/\/$/,'')}/${record.caseId}.json`:null})),notes:['Laya独立选择：由Laya先选领域，再在自身所选领域候选中选API。Qwen调用为0，不生成业务参数，不接真实SDK。','领域、API和联合选择以已保存正式case为分母；API可达子集只包含正确答案实际进入API候选的case。待执行用例不计为错误。','复用需要完整原生请求、部署profile和来源SHA验证一致。当前原生推理只包含fresh；客户端只读复用不发生本轮HTTP调用，lookup不是模型推理速度。','整题wall是本轮实际两阶段访问；来源推理之和混合历史与新调用，不是本轮完整冷推理实测。样本缺失保持未知，P50/P95使用样本百分位插值。','公开开发集、固定系统fixture、仅选择验证。选择准确率不代表真实业务完成率，也不能将本页数值等同旧Qwen权威影子链路。']};
}
