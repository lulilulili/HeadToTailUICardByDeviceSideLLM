import {buildLayaDomainPrompt,buildLayaIntentPrompt} from '../src/prompts.mjs';
import {getCapability} from '../src/registry.mjs';
import {isDeepStrictEqual} from 'node:util';
import {validateValue} from '../src/providers.mjs';
export const LAYA_SHADOW_POLICY='same-candidates-qwen-authoritative-v1';
const check=(ok,message)=>{if(!ok)throw new Error('Laya shadow: '+message);};
const finite=n=>Number.isFinite(n)&&n>=0;
const stages=['domain','intent','intent_arguments'];
const parse=raw=>{try{return JSON.parse(raw);}catch{return null;}};
function candidateIds(request){
 const ids=[...(request.promptMeta?.candidates?.ids??[])];
 if(request.stage!=='domain'&&!ids.includes('unsupported'))ids.push('unsupported');
 check(ids.length>0&&new Set(ids).size===ids.length,'primary candidates missing/duplicated');return ids;
}
function promptFor(request,{text,context}){
 const ids=candidateIds(request),domain=request.stage==='domain'?null:getCapability(ids.find(id=>id!=='unsupported'))?.domain;
 const prompt=request.stage==='domain'?buildLayaDomainPrompt(text,context):buildLayaIntentPrompt(text,domain,context);
 const decision=structuredClone(prompt.decision),fullMap=decision.choiceMap;
 const entries=Object.entries(decision.question.criteria).filter(([key])=>ids.includes(fullMap?fullMap[key]:key));
 check(entries.length===ids.length,'secondary candidate mapping differs');
 decision.question.criteria=Object.fromEntries(entries);
 if(fullMap)decision.choiceMap=Object.fromEntries(entries.map(([key])=>[key,fullMap[key]]));
 const answerKey=request.stage==='domain'?'domain':'api';
 const schema={type:'object',properties:{[answerKey]:{type:'string',enum:ids}},required:[answerKey],additionalProperties:false};
 return{...prompt,decision,schema,promptMeta:{...prompt.promptMeta,version:'laya-shadow-v1',candidates:{ids,policy:LAYA_SHADOW_POLICY,limit:ids.length},decisionChars:JSON.stringify(decision).length},domain,ids,answerKey};
}
function choice(trace,key,decision){
 const raw=parse(trace?.raw),wire=raw?.answers?.[key]?.choice;
 return wire!==undefined?(decision?.choiceMap?.[wire]??wire):(raw?.[key]??null);
}
function selection(trace,key,ids,expected,decision){
 const selected=choice(trace,key,decision);
 return{selected,selectionCorrect:ids.includes(selected)&&selected===expected,contractValid:!trace?.error&&ids.includes(selected),wallMs:trace?.wallMs??null,error:trace?.error??null};
}
function nativeProtocolValid(trace,key,decision){
 const payload=parse(trace.raw),answer=payload?.answers?.[key],keys=Object.keys(decision.question.criteria),probabilities=answer?.probabilities;
 if(typeof payload?.model!=='string'||!payload.model||answer?.type!=='choice'||!keys.includes(answer.choice)||!probabilities||Object.keys(probabilities).length!==keys.length)return false;
 if(!keys.every(k=>Object.hasOwn(probabilities,k)&&finite(probabilities[k])&&probabilities[k]<=1))return false;
 const total=Object.values(probabilities).reduce((s,n)=>s+n,0);
 if(Math.abs(total-1)>Math.max(.001,keys.length*.00005+1e-8)||!finite(answer.confidence)||answer.confidence>1||probabilities[answer.choice]+1e-9<Math.max(...Object.values(probabilities)))return false;
 const selected=decision.choiceMap?.[answer.choice]??answer.choice;
 return Boolean(trace.schema&&validateValue(trace.schema,{[key]:selected}).valid);
}
/** Wrap only the local primary provider. A secondary never supplies pipeline values. */
export function createLayaShadowObserver({providers}){
 check(providers?.ollama?.invoke&&providers?.laya?.invoke,'both local providers required');let active=null;
 const wrapped={...providers,ollama:{...providers.ollama,async invoke(request){
  check(active,'beginCase is required');
  if(!stages.includes(request.stage))return providers.ollama.invoke(request);
  const caseState=active,slot={primaryStage:request.stage};caseState.pending.push(slot);
  // Invoke the local choice immediately, then invoke Qwen without waiting for it.
  slot.task=(async()=>{
   let prompt,start=performance.now(),startedAt=new Date().toISOString();
   try{
    prompt=promptFor(request,caseState);slot.prompt=prompt;
    const response=await providers.laya.invoke({stage:request.stage==='domain'?'domain':'intent',model:providers.laya.defaultModel??'multilingual',...prompt,options:request.options,signal:request.signal});
    slot.trace={...response.trace,startedAt:response.trace.startedAt??startedAt,completedAt:new Date().toISOString(),decision:structuredClone(prompt.decision)};
   }catch(error){slot.trace={...(error.trace??{stage:request.stage==='domain'?'domain':'intent',provider:'laya',model:providers.laya.defaultModel??'multilingual',raw:'',wallMs:performance.now()-start}),startedAt:error.trace?.startedAt??startedAt,completedAt:new Date().toISOString(),error:error.message,...(prompt?{decision:structuredClone(prompt.decision)}:{})};slot.setupError=!prompt;}
  })();
  return providers.ollama.invoke(request);
 }}};
 return{providers:wrapped,
  beginCase({text,context}){check(!active,'previous case has not drained');active={text,context:structuredClone(context),start:performance.now(),startedAt:new Date().toISOString(),pending:[]};},
  async finishCase({run,expected}){
   check(active,'no active case');const state=active,drainStart=performance.now();
   try{
    await Promise.all(state.pending.map(slot=>slot.task));
    const primaryTraces=run.traces.filter(trace=>stages.includes(trace.stage));
    check(primaryTraces.length===state.pending.length,'primary/secondary stage count differs');
    const decisions=state.pending.map((slot,index)=>{
     const trace=primaryTraces[index],prompt=slot.prompt;
     const key=slot.primaryStage==='domain'?'domain':'api',gold=expected[key];
     const ids=prompt?.ids??candidateIds({stage:slot.primaryStage,promptMeta:trace.promptMeta});
     const primary=selection(trace,key,ids,gold),secondary=selection(slot.trace,key,ids,gold,prompt?.decision);
     return{stage:key==='domain'?'domain':'intent',primaryStage:slot.primaryStage,candidateIds:ids,...(prompt?.domain?{domain:prompt.domain}:{}),answerKey:key,expected:gold,expectedInCandidates:ids.includes(gold),
      primary,laya:{...secondary,trace:slot.trace},agreement:primary.selected!==null&&secondary.selected!==null?primary.selected===secondary.selected:null};
    });
    return{policy:LAYA_SHADOW_POLICY,startedAt:state.startedAt,primaryWallMs:run.totalMs,combinedWallMs:Math.max(run.totalMs,performance.now()-state.start),drainMs:performance.now()-drainStart,decisions};
   }finally{active=null;}
  }
 };
}
/** Recompute shadow choices and pair them with immutable primary traces; never re-infer. */
export function verifyLayaShadowRecord(shadow,run,{expected,text,enabled}={}){
 if(!enabled){check(shadow===undefined||shadow===null,'unexpected unregistered secondary');return true;}
 check(shadow?.policy===LAYA_SHADOW_POLICY&&Array.isArray(shadow.decisions),'missing frozen secondary decisions');
 check(shadow.primaryWallMs===run.totalMs&&finite(shadow.combinedWallMs)&&shadow.combinedWallMs>=run.totalMs&&finite(shadow.drainMs)&&shadow.drainMs<=shadow.combinedWallMs,'combined/primary timing differs');
 const traces=run.traces.filter(t=>stages.includes(t.stage));check(traces.length===shadow.decisions.length,'decision count differs');
 shadow.decisions.forEach((d,i)=>{
  const primaryTrace=traces[i],ids=candidateIds({stage:primaryTrace.stage,promptMeta:primaryTrace.promptMeta}),key=primaryTrace.stage==='domain'?'domain':'api';
  check(d.primaryStage===primaryTrace.stage&&d.stage===(key==='domain'?'domain':'intent')&&d.answerKey===key,'stage pairing differs');
  check(isDeepStrictEqual(d.candidateIds,ids)&&d.expected===expected[key]&&d.expectedInCandidates===ids.includes(expected[key]),'gold/candidates differ');
  check(isDeepStrictEqual(d.primary,selection(primaryTrace,key,ids,expected[key])),'primary selection differs');
  const lt=d.laya?.trace;check(lt?.provider==='laya'&&lt.stage===d.stage&&finite(lt.wallMs)&&typeof lt.raw==='string','secondary trace/provider/timing invalid');
  const decision=lt.decision;
  if(decision){
   check(decision.state?.text===text&&decision.answerKey===key,'secondary input ownership differs');
   const received=Object.keys(decision.question.criteria).map(k=>decision.choiceMap?.[k]??k);
   check(received.length===ids.length&&new Set(received).size===ids.length&&ids.every(id=>received.includes(id)),'secondary choices differ');
   if(key==='api')check(d.domain===decision.state.domain&&ids.filter(id=>id!=='unsupported').every(id=>getCapability(id)?.domain===d.domain),'secondary domain differs');
   if(lt.request){
    check(isDeepStrictEqual(lt.request.state,decision.state)&&isDeepStrictEqual(lt.request.questions,{[key]:decision.question})&&lt.request.lang==='zh','actual secondary request differs from decision');
    check(lt.request.model===lt.requestedModel&&isDeepStrictEqual(lt.choiceMap??null,decision.choiceMap??null),'actual secondary model/map differs');
    if(!lt.error)check(nativeProtocolValid(lt,key,decision),'successful secondary native response protocol invalid');
   }
  }else check(Boolean(lt.error),'missing secondary request');
  const verified=selection(lt,key,ids,expected[key],decision),actual={...d.laya};delete actual.trace;check(isDeepStrictEqual(actual,verified),'secondary scores/selection differ');
  const agreement=d.primary.selected!==null&&verified.selected!==null?d.primary.selected===verified.selected:null;check(d.agreement===agreement,'agreement differs');
 });return true;
}
