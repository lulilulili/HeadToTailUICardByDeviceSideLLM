import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizePlan,groundArguments,GROUNDING_VERSION} from '../src/grounding.mjs';
import {getCapability} from '../src/registry.mjs';
import {experimentDefaults} from '../src/fixtures.mjs';

// These regression expectations apply after final-argument-guard.patch is installed.
// They deliberately do not mutate, replay, or replace the initially frozen live run.
const context={...experimentDefaults,now:'2026-10-10T08:00:00+08:00',timezone:'Asia/Shanghai',location:{latitude:31.2304,longitude:121.4737,source:'fixture'}};
const plan=(text,api,args={},extra={})=>finalizePlan({text,api,domain:getCapability(api).domain,extractedArguments:args,context:{...context,...extra}});
const ground=(text,api,args={})=>groundArguments(getCapability(api),text,args,context);
const createText='创建日程，标题“复盘”，开始时间明天下午四点，持续30分钟';

test('final guard keeps v2 and removes both invalid and valid unmentioned create timezones',()=>{
 assert.equal(GROUNDING_VERSION,'deterministic-grounding-v2');
 for(const timezone of ['北京时间','America/New_York','Asia/Shanghai']){
  const raw={title:'复盘',starts_at:'明天下午四点',duration_minutes:30,timezone},r=plan(createText,'calendar.create',raw);
  assert.equal(r.groundedArguments.timezone,undefined,timezone);
  assert.equal(r.resolved.arguments.timezone,'Asia/Shanghai',timezone);
  assert.equal(r.resolved.sources.timezone,'system_timezone',timezone);
  assert.equal(r.resolved.arguments.starts_at,'2026-10-11T16:00:00+08:00',timezone);
  assert.equal(r.status,'ready_mock',timezone);assert.equal(raw.timezone,timezone);
 }
});

test('an explicit labeled create timezone is kept instead of the local system timezone',()=>{
 const text=createText+'，时区：America/New_York',r=plan(text,'calendar.create',{timezone:'Asia/Shanghai'});
 assert.equal(r.groundedArguments.timezone,'America/New_York');assert.equal(r.resolved.sources.timezone,'user');assert.match(r.resolved.arguments.starts_at,/-04:00$/);assert.equal(r.status,'ready_mock');
 const check=r.grounding.checks.find(item=>item.field==='timezone'&&item.span);
 assert.equal(text.slice(check.span.start,check.span.end),'America/New_York');
});

test('a timezone given as literal JSON input survives the guard',()=>{
 const r=plan('创建日程，参数：{"title":"复盘","starts_at":"2026-10-12T16:00:00-04:00","timezone":"America/New_York"}','calendar.create',{});
 assert.equal(r.groundedArguments.timezone,'America/New_York');assert.equal(r.groundedArguments.starts_at,'2026-10-12T16:00:00-04:00');assert.equal(r.status,'ready_mock');
});

test('invalid but explicitly provided timezone is not treated as user omission',()=>{
 const r=plan(createText+'，timezone="not-a-zone"','calendar.create',{});
 assert.equal(r.groundedArguments.timezone,'not-a-zone');assert.notEqual(r.status,'ready_mock');assert.notEqual(r.resolved.sources.timezone,'system_timezone');
});

test('an unmentioned update timezone is removed and never becomes a default business change',()=>{
 const r=plan('修改日程ev_17，标题改为“更正”','calendar.update',{event_id:'ev_17',changes:{title:'更正',timezone:'America/New_York'}});
 assert.deepEqual(r.groundedArguments.changes,{title:'更正'});assert.equal(r.resolved.arguments.changes.timezone,undefined);assert.equal(r.status,'ready_mock');
});

test('a guessed timezone alone cannot make an otherwise unspecified update ready',()=>{
 const r=plan('修改日程ev_17','calendar.update',{event_id:'ev_17',changes:{timezone:'Asia/Shanghai'}});
 assert.equal(r.groundedArguments.changes,undefined);assert.equal(r.status,'needs_clarification');
});

test('an explicit nested update timezone remains the user business write',()=>{
 for(const text of ['修改日程ev_17，changes.timezone="America/New_York"','修改日程ev_17，参数：{"changes":{"timezone":"America/New_York"}}']){
  const r=plan(text,'calendar.update',{event_id:'ev_17',changes:{timezone:'Asia/Shanghai'}});
  assert.deepEqual(r.groundedArguments.changes,{timezone:'America/New_York'});assert.equal(r.resolved.sources['changes.timezone'],'user');assert.equal(r.status,'ready_mock');
 }
});

test('geocoding optional metadata disappears unless the user explicitly supplied it',()=>{
 const r=plan('把“未登记街道8号”转换为经纬度','location.geocode',{address:'未登记街道8号',locale:'en',country:'US',max_items:10});
 assert.deepEqual(r.groundedArguments,{address:'未登记街道8号'});assert.equal(r.resolved.arguments.max_items,1);assert.equal(r.resolved.sources.max_items,'default');
 assert.equal(r.resolved.arguments.locale,undefined);assert.equal(r.resolved.arguments.country,undefined);assert.equal(r.status,'ready_mock');
});

test('reverse geocoding keeps explicit coordinates but not model-added language country or count',()=>{
 const coordinates={latitude:31.2304,longitude:121.4737},r=plan('坐标（31.2304,121.4737）对应哪个地址','location.reverse_geocode',{coordinates,locale:'zh-CN',country:'CN',max_items:10});
 assert.deepEqual(r.groundedArguments,{coordinates});assert.deepEqual(r.resolved.arguments.coordinates,coordinates);assert.equal(r.resolved.arguments.max_items,1);assert.equal(r.status,'ready_mock');
});

test('explicit SDK metadata labels and JSON fields remain intact including zero',()=>{
 for(const text of ['地址：“未登记街道8号”；locale="en"；country="US"；max_items=0','地理编码，参数：{"address":"未登记街道8号","locale":"en","country":"US","max_items":0}']){
  const r=plan(text,'location.geocode',{});
  assert.deepEqual(r.groundedArguments,{address:'未登记街道8号',locale:'en',country:'US',max_items:0});assert.equal(r.resolved.arguments.max_items,0);assert.equal(r.status,'ready_mock');
 }
});

test('invalid explicit optional SDK metadata blocks rather than receiving its default',()=>{
 const r=plan('地址：“未登记街道8号”；max_items=-1','location.geocode',{});
 assert.equal(r.groundedArguments.max_items,-1);assert.equal(r.status,'needs_clarification');assert.notEqual(r.resolved.arguments.max_items,1);
});

test('natural result-count and language relations are explicit SDK options, not guessed defaults',()=>{
 const text='查询地址“未登记街道8号”的经纬度，最多返回2条，结果用zh语言',r=plan(text,'location.geocode',{address:'未登记街道8号',max_items:2,locale:'zh'});
 assert.deepEqual(r.groundedArguments,{address:'未登记街道8号',max_items:2,locale:'zh'});assert.equal(r.status,'ready_mock');
 const omitted=plan(text,'location.geocode',{});assert.equal(omitted.groundedArguments.max_items,2);assert.equal(omitted.groundedArguments.locale,'zh');
 for(const field of ['max_items','locale']){const check=omitted.grounding.checks.find(item=>item.field===field&&item.span);assert.equal(text.slice(check.span.start,check.span.end),check.span.text);}
});

test('an unmentioned MIME cannot override the suffix of a grounded URI',()=>{
 const file_id='file:///tmp/review.pdf',raw={file_id,mime_type:'image/png'},r=plan('预览file:///tmp/review.pdf','files.preview',raw);
 assert.equal(r.groundedArguments.file_id,file_id);assert.equal(r.groundedArguments.mime_type,undefined);assert.equal(r.resolved.arguments.mime_type,'application/pdf');assert.equal(r.status,'ready_mock');assert.equal(raw.mime_type,'image/png');
});

test('explicit user MIME is kept even when it differs from a file suffix',()=>{
 const r=plan('预览file:///tmp/review.pdf，MIME类型：image/png','files.preview',{file_id:'file:///tmp/review.pdf',mime_type:'application/pdf'});
 assert.equal(r.groundedArguments.mime_type,'image/png');assert.equal(r.resolved.arguments.mime_type,'image/png');assert.equal(r.resolved.sources.mime_type,'user');assert.equal(r.status,'ready_mock');
});

test('trusted file selection may derive MIME without changing the selected file',()=>{
 const file_id='file:///tmp/selected.pdf',r=plan('预览当前选中的文件','files.preview',{mime_type:'image/png'},{objects:{file_id:{value:file_id,trusted:true,source:'user_selection'}}});
 assert.equal(r.groundedArguments.mime_type,undefined);assert.equal(r.resolved.arguments.file_id,file_id);assert.equal(r.resolved.arguments.mime_type,'application/pdf');assert.equal(r.status,'ready_mock');
});

test('missing required business start is not filled with a guessed ISO date relative date or device time',()=>{
 for(const starts_at of ['2026-10-12T16:00:00+08:00','2026-10-12','明天下午四点','现在']){
  const r=plan('创建日程，标题“复盘”','calendar.create',{title:'复盘',starts_at});
  assert.equal(r.groundedArguments.starts_at,undefined,starts_at);assert.equal(r.resolved.arguments.starts_at,undefined,starts_at);assert.equal(r.status,'needs_clarification',starts_at);assert.ok(r.resolved.missing.includes('starts_at'),starts_at);
 }
});

test('a time-looking quoted title is not evidence for a business start',()=>{
 const r=plan('创建日程，标题“明天下午四点”','calendar.create',{title:'明天下午四点',starts_at:'明天下午四点'});
 assert.equal(r.groundedArguments.title,'明天下午四点');assert.equal(r.groundedArguments.starts_at,undefined);assert.equal(r.status,'needs_clarification');
});

test('a clearly supplied business start is retained from labels timestamps and structured fields',()=>{
 for(const text of ['创建日程，标题“复盘”，开始时间2026-10-12T16:00:00+08:00','创建日程，title="复盘"，starts_at="2026-10-12T16:00:00+08:00"']){
  const r=plan(text,'calendar.create',{starts_at:'2026-01-01T01:00:00+08:00'});
  assert.equal(r.groundedArguments.starts_at,'2026-10-12T16:00:00+08:00');assert.equal(r.status,'ready_mock');
 }
});

test('an explicit day without a start clock cannot be replaced with a guessed instant',()=>{
 const r=plan('创建日程，标题“复盘”，明天开始','calendar.create',{title:'复盘',starts_at:'2026-10-11T16:00:00+08:00'});
 assert.equal(r.groundedArguments.starts_at,'明天');assert.equal(r.status,'needs_clarification');
});
