import test from 'node:test';
import assert from 'node:assert/strict';
import {getCapability} from '../src/registry.mjs';
import {resolveArguments} from '../src/resolver.mjs';
import {experimentDefaults} from '../src/fixtures.mjs';

const module=await import('../src/semantic-evaluation.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const score=(...args)=>{assert.equal(typeof module.scoreExecutionSemantics,'function','execution semantic scorer is not implemented');return module.scoreExecutionSemantics(...args);};
const context={...experimentDefaults,now:'2026-10-10T08:00:00+08:00',timezone:'Asia/Shanghai',location:{latitude:31.2304,longitude:121.4737,source:'fixture'}};
const gold=(api,args,status='ready_mock',annotations={})=>({domain:getCapability(api).domain,api,arguments:args,status,...annotations});
const run=(api,args,status)=>{const cap=getCapability(api);const resolved=resolveArguments(cap,args,context);return {domain:cap.domain,api,extractedArguments:structuredClone(args),resolved,status:status??resolved.status};};

test('relative write time paraphrases compare by the actual resolved instant',()=>{
 const s=score(gold('calendar.update',{event_id:'ev_42',changes:{starts_at:'明天下午4点'}}),run('calendar.update',{event_id:'ev_42',changes:{starts_at:'明天16:00'}}),context);
 assert.equal(s.finalArguments,true);assert.equal(s.plan,true);
});
test('ISO offsets representing the same instant are execution equivalent',()=>{
 const s=score(gold('calendar.update',{event_id:'ev_42',changes:{starts_at:'2026-10-11T16:00:00+08:00'}}),run('calendar.update',{event_id:'ev_42',changes:{starts_at:'2026-10-11T08:00:00Z'}}),context);
 assert.equal(s.finalArguments,true);assert.equal(s.plan,true);
});
test('a omitted current time can match the deterministic final instant',()=>{
 const s=score(gold('weather.current.humidity',{location:'广州',time_ref:'当前'}),run('weather.current.humidity',{location:'广州'}),context);
 assert.equal(s.plan,true);
});
test('an explicit city omitted upstream cannot match a different system location',()=>{
 const s=score(gold('weather.current.pressure',{location:'广州',time_ref:'当前'}),run('weather.current.pressure',{}),context);
 assert.equal(s.finalArguments,false);assert.equal(s.plan,false);
});
test('coordinate text and a coordinate object can describe the same location',()=>{
 const s=score(gold('weather.current.humidity',{coordinates:{latitude:31.2,longitude:121.5}}),run('weather.current.humidity',{location:'31.2,121.5'}),context);
 assert.equal(s.finalArguments,true);assert.equal(s.precision,true);assert.equal(s.plan,true);
});
test('canonical coordinates do not erase a city versus coordinate precision difference',()=>{
 const s=score(gold('weather.current.humidity',{location:'上海'}),run('weather.current.humidity',{coordinates:{latitude:31.2304,longitude:121.4737}}),context);
 assert.equal(s.finalArguments,true);assert.equal(s.precision,false);assert.equal(s.plan,false);
});
test('a duplicate harmless default is equivalent only when final parameters already contain it',()=>{
 const s=score(gold('weather.current.humidity',{location:'上海'}),run('weather.current.humidity',{location:'上海',strict_time:false}),context);
 assert.equal(s.finalArguments,true);assert.equal(s.plan,true);
});
test('additional write execution parameters remain errors',()=>{
 const s=score(gold('calendar.create',{title:'评审',starts_at:'明天上午10点'}),run('calendar.create',{title:'评审',starts_at:'明天上午10点',reminder_minutes:0}),context);
 assert.equal(s.finalArguments,false);assert.equal(s.plan,false);
});
test('non temporal arrays retain order and all field values',()=>{
 const s=score(gold('calendar.event.set.reminders',{event_id:'ev_42',value:[0,15]}),run('calendar.event.set.reminders',{event_id:'ev_42',value:[15,0]}),context);
 assert.equal(s.finalArguments,false);assert.equal(s.plan,false);
});
test('URI spelling is not silently normalized as execution equivalent',()=>{
 const s=score(gold('files.preview',{file_id:'file:///report%20one.pdf'}),run('files.preview',{file_id:'file:///report one.pdf'}),context);
 assert.equal(s.finalArguments,false);
});
test('parent object APIs cannot replace a field API with the same inputs',()=>{
 const s=score(gold('contacts.websites.website',{contact_id:'ct_7'}),run('contacts.websites',{contact_id:'ct_7'}),context);
 assert.equal(s.api,false);assert.equal(s.plan,false);
});
test('an arbitrary placeholder is not equivalent to a missing write target',()=>{
 const s=score(gold('calendar.event.set.location',{value:'A303'},'needs_clarification'),run('calendar.event.set.location',{event_id:'current_event_id',value:'A303'}),context);
 assert.equal(s.finalArguments,false);assert.equal(s.status,false);assert.equal(s.plan,false);
});
test('same clarification status cannot hide swapped conflicting start and end times',()=>{
 const s=score(gold('calendar.create',{title:'讨论',starts_at:'明天下午4点',ends_at:'明天下午3点'},'needs_clarification'),run('calendar.create',{starts_at:'明天下午3点',ends_at:'明天下午4点'}),context);
 assert.equal(s.status,true);assert.equal(s.finalArguments,false);assert.equal(s.blocking.match,false);assert.equal(s.plan,false);
});
test('a source annotation is required while unannotated source labels are displayed only',()=>{
 const selected={...context,objects:{contact_id:{value:'ct_7',trusted:true,source:'user_selection'}}};
 const expected=gold('contacts.emails.email',{},'ready_mock',{sources:{contact_id:'context'}});
 const r=run('contacts.emails.email',{contact_id:'ct_7'});
 const s=score(expected,r,selected);assert.equal(s.finalArguments,true);assert.equal(s.sources,false);assert.equal(s.plan,false);
});
test('old unparsed resolved values are not recovered by reparsing the old raw arguments',()=>{
 const r=run('weather.daily.daytimeForecast.humidity',{location:'广州',time_ref:'今天'});
 r.extractedArguments.time_ref='今天白天';delete r.resolved.arguments.time_ref;
 r.resolved.missing=['time_ref'];r.resolved.issues=['time_ref: 时间“今天白天”无法确定'];r.status=r.resolved.status='needs_clarification';
 const s=score(gold('weather.daily.daytimeForecast.humidity',{location:'广州',time_ref:'今天'}),r,context);
 assert.equal(s.finalArguments,false);assert.equal(s.status,false);assert.equal(s.plan,false);
});
test('same final status and omitted time are not equivalent to unavailable precision',()=>{
 const unavailable={...context,weatherAvailability:{...context.weatherAvailability,minute:false}};
 const expected=gold('weather.minute.precipitationIntensity',{location:'上海',time_ref:'未来30分钟每分钟'},'needs_clarification');
 const cap=getCapability(expected.api);const resolved=resolveArguments(cap,{location:'上海',time_ref:'30分钟'},unavailable);
 const s=score(expected,{domain:'weather',api:cap.id,resolved,status:'needs_clarification'},unavailable);
 assert.equal(s.status,true);assert.equal(s.blocking.match,false);assert.equal(s.plan,false);
});
test('unsupported requests are scored with their existing empty resolved result',()=>{
 const s=score({domain:'unsupported',api:null,arguments:{},status:'unsupported'},{domain:'unsupported',api:null,status:'unsupported',resolved:{arguments:{},sources:{},missing:[],issues:[],status:'unsupported'}},context);
 assert.equal(s.plan,true);
});
test('original model errors remain failures despite a supplied valid resolved object',()=>{
 const r=run('contacts.phone',{contact_id:'ct_7'});r.status='error';r.error='schema invalid';
 const s=score(gold('contacts.phone',{contact_id:'ct_7'}),r,context);
 assert.equal(s.plan,false);assert.equal(s.domain,false);
});
test('semantic scoring does not mutate the frozen gold, run, context or strict score',()=>{
 const expected=gold('calendar.update',{event_id:'ev_42',changes:{starts_at:'明天下午4点'}});const r=run(expected.api,{event_id:'ev_42',changes:{starts_at:'明天16:00'}});r.score={plan:false};
 const snapshot=JSON.stringify({expected,r,context});score(expected,r,context);assert.equal(JSON.stringify({expected,r,context}),snapshot);
});
test('only a dedicated daytime field can fold its own implied period into a date',()=>{
 const s=score(gold('weather.daily.daytimeForecast.humidity',{location:'广州',time_ref:'今天'}),run('weather.daily.daytimeForecast.humidity',{location:'广州',time_ref:'今天白天'}),context);
 assert.equal(s.finalArguments,true);assert.equal(s.precision,true);assert.equal(s.plan,true);
 const general=score(gold('weather.daily.highTemperature',{location:'广州',time_ref:'今天'}),run('weather.daily.highTemperature',{location:'广州',time_ref:'今天白天'}),context);
 assert.equal(general.finalArguments,false);assert.equal(general.plan,false);
});
test('gold status inconsistent with its contract is exposed and cannot become a passing score',()=>{
 const s=score(gold('calendar.create',{},'ready_mock'),run('calendar.create',{},'ready_mock'),context);
 assert.equal(s.expectedResolverStatusMatchesGold,false);assert.equal(s.plan,false);
});
