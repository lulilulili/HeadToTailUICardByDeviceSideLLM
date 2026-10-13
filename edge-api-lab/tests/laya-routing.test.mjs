import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runPipeline} from '../src/pipeline.mjs';
import {stageSelection} from '../src/adaptive-routing.mjs';
import * as prompts from '../src/prompts.mjs';
import {capabilities,domains} from '../src/registry.mjs';

const context={now:'2026-10-13T08:00:00+08:00',timezone:'Asia/Shanghai'};
function mock(values,{failAt,abortAt,controller,defaultModel='multilingual'}={}){
 const calls=[];
 const provider=name=>({defaultModel:name==='laya'?defaultModel:undefined,async invoke(request){
  calls.push({...request,provider:name});
  if(calls.length===abortAt)controller.abort();
  if(calls.length===failAt||calls.length===abortAt){const error=new Error('Laya selection failed');error.trace={stage:request.stage,provider:name,model:request.model,cloud:name==='jev',wallMs:2,error:error.message};throw error;}
  const value=typeof values[request.stage]==='function'?values[request.stage](request):values[request.stage];
  return {value,trace:{stage:request.stage,provider:name,model:request.model,cloud:name==='jev',wallMs:2,raw:JSON.stringify(value),promptVersion:request.promptMeta.version}};
 }});
 return {calls,providers:{laya:provider('laya'),ollama:provider('ollama'),jev:provider('jev')}};
}

test('Laya profile uses local choice decisions then Qwen extraction without inheriting Qwen tags',async()=>{
 const setup=mock({domain:{domain:'contacts'},intent:{api:'contacts.search'},arguments:{query:'王明'}});
 const run=await runPipeline({text:'找联系人王明',mode:'laya',model:'qwen2.5:1.5b',context},setup);
 assert.equal(run.status,'ready_mock',run.error);
 assert.deepEqual(setup.calls.map(call=>[call.stage,call.provider,call.model]),[['domain','laya','multilingual'],['intent','laya','multilingual'],['arguments','ollama','qwen2.5:1.5b']]);
 assert.equal(run.routing.actualCallCount,3);
 assert.ok(run.routing.triggerReasons.includes('typed_decision_requires_arguments'));
 assert.equal(run.traces[0].cloud,false);
 assert.equal(setup.calls[1].promptMeta.version,'laya-choice-v1');
 assert.equal(setup.calls[2].promptMeta.version,'laya-choice-v1');
});

test('Laya decision checkpoint default and explicit stage models remain separate from Qwen',()=>{
 const base={mode:'laya',model:'qwen',providers:{laya:{defaultModel:'local-checkpoint'}},stages:{intent:{model:'custom-checkpoint'}}};
 assert.deepEqual(stageSelection('domain',base),{provider:'laya',model:'local-checkpoint'});
 assert.deepEqual(stageSelection('intent',base),{provider:'laya',model:'custom-checkpoint'});
 assert.deepEqual(stageSelection('arguments',base),{provider:'ollama',model:'qwen'});
 assert.equal(stageSelection('domain',{mode:'laya',model:'qwen'}).model,'multilingual');
});

test('Laya profile skips independent Qwen extraction when selected API has no inputs',async()=>{
 const setup=mock({domain:{domain:'device'},intent:{api:'device.battery.level'}});
 const run=await runPipeline({text:'查本机电量',mode:'laya',model:'qwen',context},setup);
 assert.equal(run.status,'ready_mock',run.error);
 assert.deepEqual(setup.calls.map(call=>call.stage),['domain','intent']);
 assert.equal(run.routing.actualCallCount,2);
 assert.deepEqual(run.routing.skippedStages,[{stage:'arguments',reason:'api_has_no_inputs'}]);
});

test('adaptive Laya domain override still allows joint Qwen selection in two calls',async()=>{
 const setup=mock({domain:{domain:'contacts'},intent_arguments:{api:'contacts.search',arguments:{query:'王明'}}});
 const run=await runPipeline({text:'找联系人王明',mode:'adaptive',model:'qwen',stages:{domain:{provider:'laya'}},context},setup);
 assert.equal(run.status,'ready_mock',run.error);
 assert.deepEqual(setup.calls.map(call=>[call.stage,call.provider]),[['domain','laya'],['intent_arguments','ollama']]);
 assert.equal(setup.calls[0].decision.answerKey,'domain');
 assert.equal(run.routing.actualCallCount,2);
});

test('adaptive Laya API override forces a separate Qwen argument call',async()=>{
 const setup=mock({domain:{domain:'contacts'},intent:{api:'contacts.search'},arguments:{query:'王明'}});
 const run=await runPipeline({text:'找联系人王明',mode:'adaptive',model:'qwen',stages:{intent:{provider:'laya'}},context},setup);
 assert.equal(run.status,'ready_mock',run.error);
 assert.deepEqual(setup.calls.map(call=>[call.stage,call.provider]),[['domain','ollama'],['intent','laya'],['arguments','ollama']]);
 assert.equal(run.routing.path,'three_step');
 assert.ok(run.routing.triggerReasons.includes('typed_decision_requires_arguments'));
 assert.ok(setup.calls[1].decision.choiceMap);
});

test('Laya domain choice exposes all ten domains and unsupported without compact mapping',()=>{
 assert.equal(typeof prompts.buildLayaDomainPrompt,'function');
 const prompt=prompts.buildLayaDomainPrompt('查设备温度');
 assert.deepEqual(Object.keys(prompt.decision.question.criteria),[...domains.map(domain=>domain.id),'unsupported']);
 assert.equal(prompt.decision.choiceMap,undefined);
 assert.deepEqual(prompt.schema.properties.domain.enum,[...domains.map(domain=>domain.id),'unsupported']);
 assert.equal(prompt.promptMeta.version,'laya-choice-v1');
 assert.equal(prompt.promptMeta.candidates.policy,'laya-all-domains-v1');
});

test('Laya intent compact labels preserve the complete actual API catalog and unsupported',()=>{
 assert.equal(typeof prompts.buildLayaIntentPrompt,'function');
 for(const domain of domains){
  const prompt=prompts.buildLayaIntentPrompt('查询业务',domain.id);
  const ids=[...capabilities.filter(cap=>cap.domain===domain.id).map(cap=>cap.id),'unsupported'];
  const keys=Object.keys(prompt.decision.question.criteria);
  assert.deepEqual(Object.keys(prompt.decision.choiceMap),keys);
  assert.deepEqual(Object.values(prompt.decision.choiceMap),ids);
  assert.equal(new Set(Object.values(prompt.decision.choiceMap)).size,ids.length);
  assert.ok(keys.every((key,index)=>key===`c${String(index).padStart(3,'0')}`));
  assert.deepEqual(prompt.schema.properties.api.enum,ids);
  assert.deepEqual(prompt.promptMeta.candidates.ids,ids);
  assert.equal(prompt.promptMeta.candidates.policy,'laya-full-domain-compact-v1');
  assert.ok(Object.values(prompt.decision.question.criteria).every(value=>typeof value==='string'&&value.length<100));
  assert.ok(Object.values(prompt.decision.question.criteria).every(value=>!value.includes('入参角色')&&!value.includes('schema')));
 }
 const weather=prompts.buildLayaIntentPrompt('天气','weather');
 assert.equal(Object.keys(weather.decision.choiceMap).length,204);
 const label=id=>weather.decision.question.criteria[Object.entries(weather.decision.choiceMap).find(([,actual])=>actual===id)[0]];
 assert.notEqual(label('weather.current.humidity'),label('weather.hourly.humidity'));
 assert.match(label('weather.daily.daytimeForecast.humidity'),/白天/);
});

test('Laya API labels distinguish multi-field update coverage from a single-field setter',()=>{
 const prompt=prompts.buildLayaIntentPrompt('修改日程标题和地点','calendar');
 const label=id=>prompt.decision.question.criteria[Object.entries(prompt.decision.choiceMap).find(([,actual])=>actual===id)[0]];
 assert.match(label('calendar.update'),/多字段|全部变更/);
 assert.match(label('calendar.event.set.title'),/单字段|只修改/);
});

test('Laya fixed profile rejects provider conflicts and nonexistent stage overrides before any calls',async()=>{
 for(const stages of [{domain:{provider:'ollama'}},{intent:{provider:'jev'}},{arguments:{provider:'laya'}},{arguments:{provider:'jev-bridge'}},{unified:{provider:'ollama'}},{intent_arguments:{provider:'ollama'}}]){
  const setup=mock({});const run=await runPipeline({text:'查询业务',mode:'laya',model:'qwen',stages},setup);
  assert.equal(run.status,'error');assert.match(run.error,/Laya|laya|阶段/);assert.equal(setup.calls.length,0);
 }
});

test('Laya is globally forbidden in argument and combined generation stages',async()=>{
 for(const [mode,stage]of [['adaptive','arguments'],['adaptive','intent_arguments'],['staged','arguments'],['unified','unified']]){
  const setup=mock({});const run=await runPipeline({text:'查询业务',mode,model:'qwen',stages:{[stage]:{provider:'laya'}}},setup);
  assert.equal(run.status,'error');assert.match(run.error,/Laya|laya/);assert.equal(setup.calls.length,0);
 }
});

test('Laya unsupported domain and API decisions stop without generating arguments',async()=>{
 for(const values of [{domain:{domain:'unsupported'}},{domain:{domain:'contacts'},intent:{api:'unsupported'}}]){
  const setup=mock(values);const run=await runPipeline({text:'请求业务',mode:'laya',model:'qwen',context},setup);
  assert.equal(run.status,'unsupported',run.error);assert.equal(run.routing.actualCallCount,values.intent?2:1);assert.ok(!setup.calls.some(call=>call.stage==='arguments'));
 }
});

test('Laya failure creates one failed trace and does not switch provider or continue',async()=>{
 const setup=mock({domain:{domain:'contacts'}},{failAt:2});const emitted=[];
 const run=await runPipeline({text:'找联系人王明',mode:'laya',model:'qwen',context},{...setup,onTrace:trace=>emitted.push(trace)});
 assert.equal(run.status,'error');assert.equal(run.traces.length,2);assert.equal(emitted.length,2);assert.equal(run.routing.actualCallCount,2);assert.ok(run.traces[1].error);assert.ok(setup.calls.every(call=>call.provider==='laya'));
});

test('Laya cancellation keeps the partial trace count without making a later Qwen call',async()=>{
 const controller=new AbortController();const setup=mock({domain:{domain:'contacts'}},{abortAt:2,controller});
 await assert.rejects(runPipeline({text:'找联系人王明',mode:'laya',model:'qwen',context},{...setup,signal:controller.signal}),error=>{assert.equal(error.partialRun.status,'cancelled');assert.equal(error.partialRun.routing.actualCallCount,2);assert.equal(error.traces.length,2);return true});
 assert.equal(setup.calls.length,2);
});

test('Laya routing never turns tournament group metadata into extra pipeline invocations',async()=>{
 const setup=mock({domain:{domain:'device'},intent:{api:'device.battery.level'}});
 const invoke=setup.providers.laya.invoke;
 setup.providers.laya.invoke=async request=>{const response=await invoke(request);response.trace.tournament={rounds:1,groups:13};response.trace.internalPredictCalls=2;return response};
 const run=await runPipeline({text:'查电量',mode:'laya',model:'qwen',context},setup);
 assert.equal(run.routing.actualCallCount,run.traces.length);assert.equal(run.routing.actualCallCount,2);
});

test('existing adaptive v2 and official Jev v2 prompt payloads remain unchanged',()=>{
 const text='修改日程 ev_7，标题为设计评审，地点为A室';
 const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 assert.deepEqual({adaptiveDomain:hash(prompts.buildAdaptiveDomainPrompt(text)),adaptiveIntent:hash(prompts.buildAdaptiveIntentPrompt(text,'calendar')),adaptiveJoint:hash(prompts.buildIntentArgumentsPrompt(text,'calendar')),jevDomain:hash(prompts.buildJevDomainPrompt(text)),jevIntent:hash(prompts.buildJevIntentPrompt(text,'calendar'))},{adaptiveDomain:'186b0b00148c30a8c1be291777c17ec7336a11c83e0b946b0a5b3125efed2138',adaptiveIntent:'1352153a3330a08a52d81d511c935ed26652887a126b87ceacfa26aa9833501b',adaptiveJoint:'a77f44f26cae5fe3b52a08e69454eea018f29f73b9ededee168a5642f84194be',jevDomain:'46f5ab37b3af394ed1c70c4dbae279fe9e6b52fcf446f95655638da88de275ce',jevIntent:'5214457ddbaa0bc52ab4ee815af66e83a61267d6652f47b21fd3b039acbfc8a1'});
});
