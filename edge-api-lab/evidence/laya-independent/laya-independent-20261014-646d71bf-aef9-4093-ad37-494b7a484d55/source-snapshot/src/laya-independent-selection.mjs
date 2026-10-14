import {buildLayaDomainPrompt,buildLayaIntentPrompt,selectAdaptiveCandidates} from './prompts.mjs';
import {getCapability} from './registry.mjs';

export const LAYA_INDEPENDENT_POLICY='laya-domain-soft-api-choice-v1';
const owns=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);

/** Preserve the native wire labels/order, while retrieving only inside Laya's own domain. */
export function buildIndependentLayaIntentPrompt(text,domain,context={}){
 const selected=selectAdaptiveCandidates(text,domain,{limit:12,context});
 const prompt=buildLayaIntentPrompt(text,domain,context),wanted=new Set([...selected.map(cap=>cap.id),'unsupported']);
 const entries=Object.entries(prompt.decision.question.criteria).filter(([wire])=>wanted.has(prompt.decision.choiceMap[wire]));
 const ids=entries.map(([wire])=>prompt.decision.choiceMap[wire]);
 const decision={...prompt.decision,question:{...prompt.decision.question,criteria:Object.fromEntries(entries)},choiceMap:Object.fromEntries(entries.map(([wire])=>[wire,prompt.decision.choiceMap[wire]]))};
 const candidates={ids,retrievalIds:selected.map(cap=>cap.id),scores:selected.map(cap=>({id:cap.id,score:cap.retrievalScore,matchedAliases:cap.matchedAliases,matchedRelations:cap.matchedRelations,object:cap.object??null,field:cap.field??null})),policy:LAYA_INDEPENDENT_POLICY,limit:12,totalEligible:prompt.promptMeta.candidates.totalEligible,hardFilters:[],wireKeys:entries.map(([wire])=>wire)};
 return {...prompt,decision,schema:{type:'object',properties:{api:{type:'string',enum:ids}},required:['api'],additionalProperties:false},promptMeta:{...prompt.promptMeta,decisionChars:JSON.stringify(decision).length,candidates}};
}

/** Choice only: neither a Qwen result nor evaluation expectations are accepted as routing input. */
export async function runLayaIndependentSelection({text,context={},options={}}={}, {provider,signal,onTrace}={}){
 const start=performance.now();
 const selection={domain:null,api:null,status:'error',error:null,errorStage:null,policy:LAYA_INDEPENDENT_POLICY,totalMs:0,decisions:{},candidates:{},traces:[]};
 let stage=null;
 async function choose(next,prompt){
  signal?.throwIfAborted();stage=next;
  selection.decisions[next]=structuredClone(prompt.decision);selection.candidates[next]=structuredClone(prompt.promptMeta.candidates);
  const callStart=performance.now();let emitted=false;
  try{
   if(typeof provider?.invoke!=='function')throw new Error('Laya provider.invoke is required');
   const response=await provider.invoke({stage:next,model:provider.defaultModel??'multilingual',...prompt,options,signal});
   if(!response.trace||typeof response.trace.raw!=='string')throw new Error('Laya native trace is missing');
   selection.traces.push(response.trace);emitted=true;if(onTrace)await onTrace(response.trace);
   const key=prompt.decision.answerKey,value=response.value;
   if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||!owns(value,key)||!prompt.schema.properties[key].enum.includes(value[key]))throw new Error('Laya choice violates the frozen decision schema');
   return value[key];
  }catch(error){
   if(!emitted){const trace=error.trace??{stage:next,provider:'laya',model:provider?.defaultModel??'multilingual',raw:'',wallMs:performance.now()-callStart,httpCalls:0,error:error.message};selection.traces.push(trace);if(onTrace)await onTrace(trace);}
   throw error;
  }
 }
 try{
  if(typeof text!=='string'||!text.trim())throw new Error('User text is required');
  selection.domain=await choose('domain',buildLayaDomainPrompt(text,context));
  if(selection.domain==='unsupported')selection.status='unsupported';
  else{
   const api=await choose('intent',buildIndependentLayaIntentPrompt(text,selection.domain,context));
   selection.api=api==='unsupported'?null:api;
   if(selection.api&&getCapability(selection.api)?.domain!==selection.domain)throw new Error('Laya selected API belongs to another domain');
   selection.status=selection.api?'selected':'unsupported';
  }
 }catch(error){selection.status=signal?.aborted?'cancelled':'error';selection.error=error.message;selection.errorStage=stage;}
 selection.totalMs=performance.now()-start;return selection;
}

/** Evaluation happens after both choices; expectations never enter native requests. */
export function scoreIndependentSelection(expected,selection){
 const providerError=['error','cancelled'].includes(selection.status);
 const domain=selection.domain===expected.domain,api=!providerError&&selection.api===expected.api;
 const ids=selection.candidates?.intent?.ids;
 const expectedInCandidates=Array.isArray(ids)&&ids.includes(expected.api);
 const candidateRecallEligible=domain&&Array.isArray(ids);
 const domainGateMiss=selection.domain!==null&&!domain;
 const retrievalMiss=candidateRecallEligible&&!expectedInCandidates;
 const candidateChoiceMiss=!providerError&&expectedInCandidates&&!api;
 const errorCategory=providerError?'provider_protocol':domainGateMiss?'domain_gate':retrievalMiss?'retrieval':candidateChoiceMiss?'candidate_choice':domain&&api?'correct':'selection';
 return {domain,api,joint:domain&&api,expectedInCandidates,candidateRecallEligible,domainGateMiss,retrievalMiss,candidateChoiceMiss,providerError,errorCategory};
}
