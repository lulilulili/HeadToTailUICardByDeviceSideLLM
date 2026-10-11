import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizePlan} from '../src/grounding.mjs';
import {runPipeline} from '../src/pipeline.mjs';
import {experimentDefaults} from '../src/fixtures.mjs';

const context={...experimentDefaults,geocodes:{},now:'2026-10-10T08:00:00+08:00',timezone:'Asia/Shanghai',location:{latitude:22.5,longitude:114,source:'fixture'}};
const api='weather.current.humidity';
const plan=(text,args={})=>finalizePlan({text,domain:'weather',api,extractedArguments:args,context});
const spatialTexts=[
 '我在甲乙丙城出差，湿度是多少',
 '我们现在在甲乙丙城出差，湿度是多少',
 '我将前往甲乙丙城，湿度是多少',
 '我去甲乙丙城出差，湿度是多少',
 '甲乙丙城位于另一片区域，湿度是多少',
 '身处甲乙丙城出差，湿度是多少',
 '湿度是多少，去甲乙丙城出差'
];

test('unresolved explicit spatial cues block local fallback without inventing a city',()=>{
 for(const text of spatialTexts){
  const r=plan(text);
  assert.equal(r.status,'needs_clarification',text);
  assert.equal(r.groundedArguments.location,undefined,text);
  const blocker=r.grounding.blockers.find(item=>item.field==='location'&&item.code==='unresolved_spatial_reference');
  assert.ok(blocker,text);
  assert.equal(text.slice(blocker.span.start,blocker.span.end),blocker.span.text,text);
  assert.equal(r.mock.executed,false,text);assert.equal(r.mock.simulated,false,text);
 }
});

test('a model-guessed local reference or coordinates cannot bypass a missing spatial target',()=>{
 const text=spatialTexts[0],raw={location:'当前位置',coordinates:{latitude:22.5,longitude:114}};
 const r=plan(text,raw);
 assert.equal(r.status,'needs_clarification');
 assert.equal(r.groundedArguments.location,undefined);assert.equal(r.groundedArguments.coordinates,undefined);
 assert.deepEqual(raw,{location:'当前位置',coordinates:{latitude:22.5,longitude:114}});
});

test('a literal model city in an unresolved relation is not enough to skip clarification',()=>{
 const r=plan(spatialTexts[0],{location:'甲乙丙城'});
 assert.equal(r.status,'needs_clarification');
 assert.ok(r.grounding.blockers.some(item=>item.code==='unresolved_spatial_reference'));
});

test('full explicit coordinates already establish the target and do not trigger the spatial guard',()=>{
 const r=plan('纬度31.2304，经度121.4737，我将前往甲乙丙城，湿度是多少');
 assert.deepEqual(r.groundedArguments.coordinates,{latitude:31.2304,longitude:121.4737});
 assert.equal(r.grounding.blockers.some(item=>item.code==='unresolved_spatial_reference'),false);
 assert.equal(r.status,'ready_mock');
});

test('an already recovered unknown city uses named-place resolution rather than this fallback guard',()=>{
 const r=plan('查甲乙丙城现在湿度');
 assert.equal(r.groundedArguments.location,'甲乙丙城');
 assert.equal(r.status,'resolution_failed');
 assert.equal(r.grounding.blockers.some(item=>item.code==='unresolved_spatial_reference'),false);
});

test('pure time relations are not misclassified as named places or unresolved spatial targets',()=>{
 for(const text of ['在下午三点查湿度','在明天下午查湿度','我在下午三点，湿度是多少','到明天查湿度','我到明天再查湿度']){
  const r=plan(text);
  assert.equal(r.groundedArguments.location,undefined,text);
  assert.equal(r.grounding.blockers.some(item=>item.field==='location'),false,text);
  assert.notEqual(r.status,'needs_clarification',text);
 }
});

test('local deictic places preserve the normal environmental current-location contract',()=>{
 for(const text of ['我在这里，湿度是多少','我在当前位置，湿度是多少','我现在在当地，湿度是多少','看看当前湿度']){
  const r=plan(text);
  assert.equal(r.grounding.blockers.some(item=>item.field==='location'),false,text);
  assert.equal(r.status,'ready_mock',text);assert.equal(r.resolved.sources.location,'system_location',text);
 }
});

test('negated and quoted spatial statements do not introduce a target',()=>{
 for(const text of ['不要前往甲乙丙城，湿度是多少','我不在甲乙丙城，湿度是多少','不是位于甲乙丙城，湿度是多少','湿度是多少，备注“我在甲乙丙城出差”','湿度是多少，备注"前往甲乙丙城"']){
  const r=plan(text);
  assert.equal(r.grounding.blockers.some(item=>item.field==='location'),false,text);
  assert.equal(r.groundedArguments.location,undefined,text);assert.equal(r.status,'ready_mock',text);
 }
});

test('a trailing query action is not a travel target',()=>{
 const r=plan('湿度是多少，去查看一下');
 assert.equal(r.groundedArguments.location,undefined);
 assert.equal(r.grounding.blockers.some(item=>item.field==='location'),false);assert.equal(r.status,'ready_mock');
});

test('pipeline spatial blockers prevent native current-position reads even when the device has a value',async()=>{
 for(const text of spatialTexts){
  const reads=[];
  const r=await runPipeline({text,model:'test',mode:'unified',context:{...context,location:null}},{providers:{ollama:{async invoke(){return {value:{domain:'weather',api,arguments:{}},trace:{stage:'unified',raw:'{}'}};}}},systemContextProvider:{async read(request){reads.push(request);return {source:'fixture',value:{latitude:22.5,longitude:114}};}}});
  assert.equal(r.status,'needs_clarification',text);
  assert.deepEqual(reads,[],text);assert.deepEqual(r.extractedArguments,{},text);
  assert.equal(r.mock.executed,false,text);
 }
});

test('ordinary omitted or explicitly local locations still request native current position',async()=>{
 for(const text of ['湿度是多少','我在这里，湿度是多少']){
  const reads=[];
  const r=await runPipeline({text,model:'test',mode:'unified',context:{...context,location:null}},{providers:{ollama:{async invoke(){return {value:{domain:'weather',api,arguments:{}},trace:{stage:'unified',raw:'{}'}};}}},systemContextProvider:{async read(request){reads.push(request);return {source:'fixture',value:{latitude:22.5,longitude:114}};}}});
  assert.equal(r.status,'ready_mock',text);assert.deepEqual(reads.map(item=>item.capability),['location.current'],text);
 }
});
