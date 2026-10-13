import test from 'node:test';
import assert from 'node:assert/strict';
import {createLayaShadowObserver,verifyLayaShadowRecord} from '../scripts/shadow-laya.mjs';
import {runPipeline} from '../src/pipeline.mjs';
import {SINGLE_SERVICE_100_CONTEXT as context} from '../src/single-service-100.mjs';
const expected={domain:'device',api:'device.battery.level',arguments:{},status:'ready_mock'};
const text='查本机电量',model='qwen2.5:0.5b';
const makeTrace=(req,value,provider='ollama')=>({stage:req.stage,provider,model:provider==='laya'?'multilingual':model,raw:JSON.stringify(value),wallMs:1,promptVersion:req.promptMeta.version,promptMeta:req.promptMeta});
function providers({layaError=false}={}){
 return{ollama:{invoke:async req=>{const value=req.stage==='domain'?{domain:'device'}:req.stage==='arguments'?{}:{api:expected.api,...(req.stage==='intent_arguments'?{arguments:{}}:{})};return{value,trace:makeTrace(req,value)};}},
 laya:{defaultModel:'multilingual',invoke:async req=>{if(layaError)throw Object.assign(new Error('local failed'),{trace:{...makeTrace(req,{},'laya'),error:'local failed'}});const value=req.stage==='domain'?{domain:'weather'}:{api:expected.api};return{value,trace:{...makeTrace(req,value,'laya'),decision:req.decision,schema:req.schema}};}}};
}
async function run(config={}){
 const observer=createLayaShadowObserver({providers:providers(config)});observer.beginCase({text,context});
 const primary=await runPipeline({text,context,model,mode:'adaptive'},{providers:observer.providers});
 return{primary,shadow:await observer.finishCase({run:primary,expected})};
}
test('Laya observes identical candidates and cannot replace the Qwen domain/API or parameters',async()=>{
 const {primary,shadow}=await run();assert.equal(primary.domain,'device');assert.equal(primary.api,expected.api);assert.equal(primary.traces.length,2);
 assert.equal(shadow.decisions[0].laya.selected,'weather');assert.equal(shadow.decisions[1].domain,'device');
 const wanted=[...primary.candidates.intent_arguments.ids,'unsupported'];assert.deepEqual(shadow.decisions[1].candidateIds,wanted);
 assert.equal(shadow.decisions[1].primaryStage,'intent_arguments');assert.equal(shadow.decisions[1].laya.selectionCorrect,true);
 assert.equal(shadow.primaryWallMs,primary.totalMs);assert.ok(shadow.combinedWallMs>=primary.totalMs);assert.ok(shadow.drainMs>=0);
 assert.ok(shadow.decisions.every(d=>Number.isFinite(Date.parse(d.laya.trace.startedAt))&&Number.isFinite(Date.parse(d.laya.trace.completedAt))));
 assert.equal(JSON.stringify(shadow.decisions[1].laya.trace.decision).includes('ready_mock'),false);
});
test('local failure stays a shadow error and does not fail or retry the primary pipeline',async()=>{
 const {primary,shadow}=await run({layaError:true});assert.equal(primary.status,'ready_mock');assert.equal(shadow.decisions.length,2);
 assert.ok(shadow.decisions.every(d=>d.laya.error==='local failed'&&!d.laya.contractValid));
});
test('provider invocations overlap and the primary result is returned before a delayed shadow settles',async()=>{
 let release,shadowStarted=false,primaryStarted=false;const delayed=new Promise(r=>release=r);const p=providers();
 p.laya.invoke=async req=>{shadowStarted=true;await delayed;return{value:{domain:'device'},trace:makeTrace(req,{domain:'device'},'laya')};};
 p.ollama.invoke=async req=>{primaryStarted=true;assert.equal(shadowStarted,true);return{value:{domain:'unsupported'},trace:makeTrace(req,{domain:'unsupported'})};};
 const observer=createLayaShadowObserver({providers:p});observer.beginCase({text,context});const primary=await runPipeline({text,context,model,mode:'adaptive'},{providers:observer.providers});
 assert.equal(primaryStarted,true);assert.equal(primary.status,'unsupported');let done=false;
 const ending=observer.finishCase({run:primary,expected}).then(s=>{done=true;return s;});await Promise.resolve();assert.equal(done,false);release();
 const shadow=await ending;assert.equal(shadow.decisions.length,1);assert.equal(shadow.decisions[0].stage,'domain');
});
test('shadow audit recomputes ownership, choices, timings and same candidate equality',async()=>{
 const {primary,shadow}=await run();assert.equal(verifyLayaShadowRecord(shadow,primary,{expected,text,enabled:true}),true);
 for(const change of [s=>s.decisions[1].candidateIds.pop(),s=>s.decisions[0].laya.selectionCorrect=true,s=>s.decisions[0].primary.selected='weather',s=>s.primaryWallMs=123,s=>s.decisions[0].expected='weather',s=>s.decisions[0].laya.trace.provider='jev']){
  const modified=structuredClone(shadow);change(modified);assert.throws(()=>verifyLayaShadowRecord(modified,primary,{expected,text,enabled:true}));
 }
});
test('native request, choice protocol and shadow drain duration cannot contradict saved decisions',async()=>{
 const {primary,shadow}=await run();
 for(const d of shadow.decisions){
  const t=d.laya.trace,decision=t.decision,keys=Object.keys(decision.question.criteria),wire=keys.find(k=>(decision.choiceMap?.[k]??k)===d.laya.selected);
  t.request={state:structuredClone(decision.state),model:'multilingual',questions:{[d.answerKey]:structuredClone(decision.question)},max_len:4096,head_max_len:768,lang:'zh'};
  t.requestedModel='multilingual';t.choiceMap=decision.choiceMap??null;
  t.raw=JSON.stringify({model:'laya-rl-agent',answers:{[d.answerKey]:{type:'choice',choice:wire,probabilities:Object.fromEntries(keys.map(k=>[k,k===wire?1:0])),confidence:1}}});
 }
 assert.equal(verifyLayaShadowRecord(shadow,primary,{expected,text,enabled:true}),true);
 for(const mutate of [s=>s.decisions[0].laya.trace.request.state.text='other case',s=>{const t=s.decisions[0].laya.trace,p=JSON.parse(t.raw);p.answers.domain.type='not-choice';t.raw=JSON.stringify(p);},s=>{const t=s.decisions[0].laya.trace,p=JSON.parse(t.raw);p.answers.domain.probabilities={device:2};t.raw=JSON.stringify(p);},s=>s.drainMs=s.combinedWallMs+1000,s=>s.decisions[1].laya.trace.choiceMap={}]){
  const changed=structuredClone(shadow);mutate(changed);assert.throws(()=>verifyLayaShadowRecord(changed,primary,{expected,text,enabled:true}));
 }
});
