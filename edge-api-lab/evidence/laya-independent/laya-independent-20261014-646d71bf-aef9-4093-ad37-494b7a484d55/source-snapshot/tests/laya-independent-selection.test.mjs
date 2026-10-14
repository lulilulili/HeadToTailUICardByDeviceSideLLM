import test from 'node:test';
import assert from 'node:assert/strict';
import * as independent from '../src/laya-independent-selection.mjs';
import {buildLayaIntentPrompt,selectAdaptiveCandidates} from '../src/prompts.mjs';

function fakeProvider(domain,api,{failStage,onCall}={}){
 const calls=[],traces=[];
 return {defaultModel:'multilingual',calls,traces,async invoke(request){
  calls.push(request);onCall?.(request);
  const answerKey=request.decision.answerKey,selected=request.stage==='domain'?domain:api;
  const wire=Object.entries(request.decision.choiceMap??{}).find(([,actual])=>actual===selected)?.[0]??selected;
  const keys=Object.keys(request.decision.question.criteria),payload={model:'laya-rl-agent',answers:{[answerKey]:{type:'choice',choice:wire,probabilities:Object.fromEntries(keys.map(key=>[key,key===wire?1:0])),confidence:1}},usage:{input_tokens:50,output_tokens:0}};
  const trace={stage:request.stage,provider:'laya',model:'laya-rl-agent',requestedModel:'multilingual',wallMs:5,inferenceMs:4,httpCalls:1,inputTokens:50,outputTokens:0,raw:JSON.stringify(payload),request:{state:request.decision.state,model:'multilingual',questions:{[answerKey]:request.decision.question},max_len:4096,head_max_len:768,lang:'zh'}};traces.push(trace);
  if(request.stage===failStage){const error=new Error('provider failure');error.trace={...trace,error:'provider failure'};throw error;}
  return {value:{[answerKey]:selected},trace};
 }};
}
const execute=(input,provider,extra={})=>independent.runLayaIndependentSelection(input,{provider,...extra});

test('only the Laya domain controls intent candidates; unrelated Qwen/gold inputs never enter requests',async()=>{
 const provider=fakeProvider('files','files.metadata.uri');
 const selection=await execute({text:'读取文件ID file_7的URI',context:{},qwenDomain:'cloud',expected:{domain:'cloud',api:'gold_secret_id'}},provider);
 assert.equal(selection.domain,'files');assert.equal(selection.api,'files.metadata.uri');assert.equal(selection.status,'selected');
 assert.deepEqual(provider.calls.map(call=>call.stage),['domain','intent']);assert.equal(provider.calls[1].decision.state.domain,'files');
 assert.ok(selection.candidates.intent.ids.filter(id=>id!=='unsupported').every(id=>id.startsWith('files.')));
 assert.ok(!JSON.stringify(provider.calls).includes('gold_secret_id'));assert.deepEqual(selection.traces,provider.traces);
});

test('native wire labels and catalog order match the existing Laya/shadow protocol after shortlist filtering',()=>{
 const text='北京明天下午三点的风速是多少',domain='weather',full=buildLayaIntentPrompt(text,domain,{}),ranked=selectAdaptiveCandidates(text,domain,{limit:12,context:{}}),ids=new Set([...ranked.map(cap=>cap.id),'unsupported']);
 const prompt=independent.buildIndependentLayaIntentPrompt(text,domain,{}),keys=Object.keys(full.decision.question.criteria).filter(key=>ids.has(full.decision.choiceMap[key]));
 assert.deepEqual(Object.keys(prompt.decision.question.criteria),keys);assert.deepEqual(Object.keys(prompt.decision.choiceMap),keys);
 assert.deepEqual(prompt.decision.question.criteria,Object.fromEntries(keys.map(key=>[key,full.decision.question.criteria[key]])));
 assert.equal(keys.length,13);assert.deepEqual(prompt.schema.properties.api.enum,keys.map(key=>full.decision.choiceMap[key]));
 assert.deepEqual(prompt.promptMeta.candidates.retrievalIds,ranked.map(cap=>cap.id));
});

test('unsupported first domain skips API choice and has explicit gate scoring after the return',async()=>{
 const provider=fakeProvider('unsupported',null),selection=await execute({text:'写一首诗'},provider);
 assert.equal(provider.calls.length,1);assert.equal(selection.api,null);assert.equal(selection.status,'unsupported');
 const score=independent.scoreIndependentSelection({domain:'files',api:'files.search'},selection);
 assert.equal(score.domain,false);assert.equal(score.expectedInCandidates,false);assert.equal(score.candidateRecallEligible,false);assert.equal(score.domainGateMiss,true);
});

test('invalid domain/provider response emits one visible trace and cannot call later stages',async()=>{
 const provider=fakeProvider('invented_domain','files.search'),selection=await execute({text:'查找文件'},provider);
 assert.equal(selection.status,'error');assert.equal(selection.traces.length,1);assert.equal(provider.calls.length,1);assert.equal(selection.domain,null);
 assert.equal(independent.scoreIndependentSelection({domain:'files',api:'files.search'},selection).providerError,true);
});

test('API provider error preserves its native trace and scores no fabricated successful choice',async()=>{
 const provider=fakeProvider('files','files.search',{failStage:'intent'}),selection=await execute({text:'查找PDF文件'},provider);
 assert.equal(selection.status,'error');assert.equal(selection.traces.length,2);assert.equal(selection.traces[1].error,'provider failure');assert.equal(selection.api,null);
 const score=independent.scoreIndependentSelection({domain:'files',api:'files.search'},selection);
 assert.equal(score.domain,true);assert.equal(score.candidateRecallEligible,true);assert.equal(score.expectedInCandidates,true);assert.equal(score.providerError,true);assert.equal(score.candidateChoiceMiss,false);
});

test('cancellation between stages does not invent an API invocation or hidden retry',async()=>{
 const stop=new AbortController(),provider=fakeProvider('files','files.search');
 const selection=await execute({text:'查找文件'},provider,{signal:stop.signal,onTrace:()=>stop.abort(new Error('cancel'))});
 assert.equal(selection.status,'cancelled');assert.equal(selection.traces.length,1);assert.equal(provider.calls.length,1);
});

test('candidate budget misses are distinct from wrong-domain gating and candidate-choice mistakes',()=>{
 const expected={domain:'weather',api:'weather.hourly.temperature'};
 const missing=independent.scoreIndependentSelection(expected,{domain:'weather',api:'weather.current.temperature',status:'selected',candidates:{intent:{ids:['weather.current.temperature','unsupported']}},traces:[]});
 assert.equal(missing.retrievalMiss,true);assert.equal(missing.domainGateMiss,false);assert.equal(missing.candidateChoiceMiss,false);
 const present=independent.scoreIndependentSelection(expected,{domain:'weather',api:'weather.current.temperature',status:'selected',candidates:{intent:{ids:[expected.api,'weather.current.temperature','unsupported']}},traces:[]});
 assert.equal(present.candidateChoiceMiss,true);assert.equal(present.retrievalMiss,false);
});

test('pure API scoring is independent of argument filling and native traces remain unchanged',async()=>{
 const provider=fakeProvider('calendar','calendar.create'),selection=await execute({text:'创建日程，标题为评审'},provider);
 assert.equal(selection.status,'selected');assert.equal(selection.api,'calendar.create');assert.equal(provider.calls.length,2);assert.ok(provider.calls.every(call=>!['arguments','intent_arguments','unified'].includes(call.stage)));
 const before=structuredClone(selection);assert.equal(independent.scoreIndependentSelection({domain:'calendar',api:'calendar.create',arguments:{starts_at:'never passed'}},selection).joint,true);assert.deepEqual(selection,before);
});

test('failed contracts cannot score a residual correct API or joint outcome',()=>{
 const expected={domain:'files',api:'files.search'};
 const score=independent.scoreIndependentSelection(expected,{domain:'files',api:'files.search',status:'error',candidates:{intent:{ids:['files.search']}},traces:[]});
 assert.equal(score.domain,true);assert.equal(score.api,false);assert.equal(score.joint,false);assert.equal(score.providerError,true);
});
