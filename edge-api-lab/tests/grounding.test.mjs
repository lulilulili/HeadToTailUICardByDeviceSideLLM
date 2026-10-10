import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizePlan} from '../src/grounding.mjs';
import {experimentDefaults} from '../src/fixtures.mjs';
import {runPipeline} from '../src/pipeline.mjs';

const context={...experimentDefaults,now:'2026-10-10T08:00:00+08:00',timezone:'Asia/Shanghai',location:{latitude:31.2304,longitude:121.4737,source:'fixture'},objects:{file_id:{value:'file_other',trusted:true,source:'user_selection'},contact_id:{value:'ct_7',trusted:true,source:'user_selection'}}};
const plan=(text,api,args={},extra={})=>finalizePlan({text,api,domain:api.startsWith('materials.')?'cloud':api.split('.')[0],extractedArguments:args,context:{...context,...extra}});

test('a city before a current-time modifier is not merged with that modifier',()=>{
 const r=plan('上海此刻的气温是多少','weather.current.temperature',{location:'上海',time_ref:'此刻'});
 assert.equal(r.groundedArguments.location,'上海');assert.equal(r.status,'ready_mock');
});
test('the groups field of a selected contact is not a name query',()=>{
 const r=plan('读取当前选中联系人所属群组的名称','contacts.groups.title',{});
 assert.equal(r.groundedArguments.query,undefined);assert.equal(r.resolved.arguments.query,undefined);assert.equal(r.resolved.arguments.contact_id,'ct_7');assert.equal(r.status,'ready_mock');
});

test('explicit city omission cannot fall back to the device city; raw arguments stay unchanged',()=>{
 const raw={};const r=plan('广州当前的气压','weather.current.pressure',raw);
 assert.deepEqual(raw,{});assert.equal(r.groundedArguments.location,'广州');assert.equal(r.resolved.resolution.location.effective.latitude,23.1291);
 assert.equal(r.grounding.checks.find(x=>x.field==='location').span.text,'广州');
});
test('explicit labeled coordinate axes are restored without geocoding',()=>{
 const r=plan('查看纬度31.2经度121.5处当前湿度','weather.current.humidity',{coordinates:{latitude:12,longitude:34}});
 assert.deepEqual(r.groundedArguments.coordinates,{latitude:31.2,longitude:121.5});assert.equal(r.resolved.resolution.location.precision,'coordinates');
});
test('multiple explicit places require clarification instead of choosing a city',()=>{
 const r=plan('比较上海和北京现在的湿度','weather.current.humidity',{});
 assert.equal(r.status,'needs_clarification');assert.equal(r.mock.simulated,false);
});
test('an unknown explicitly labeled place blocks system-location fallback',()=>{
 const r=plan('地点：未登记小巷；查看现在温度','weather.current.temperature',{});
 assert.equal(r.groundedArguments.location,'未登记小巷');assert.equal(r.status,'resolution_failed');
});
test('absence of user time and location still permits deterministic state completion',()=>{
 const r=plan('帮我看下湿度','weather.current.humidity');
 assert.equal(r.status,'ready_mock');assert.deepEqual(r.groundedArguments,{});assert.equal(r.resolved.sources.location,'system_location');
});
test('future window missing from model output is recovered from the exact source span',()=>{
 const r=plan('上海未来20分钟每分钟是否降水','weather.minute.precipitation',{});
 assert.equal(r.groundedArguments.time_ref,'未来20分钟每分钟');assert.equal(r.resolved.arguments.time_ref.endAt,'2026-10-10T08:20:00+08:00');
});
test('month/day supplied without year uses system year, never a model-invented year',()=>{
 const r=plan('南京10月12日的日出时间','weather.daily.sun.sunrise',{location:'南京',time_ref:'2023-10-12'});
 assert.equal(r.groundedArguments.time_ref,'10月12日');assert.equal(r.resolved.arguments.time_ref.start,'2026-10-12');
});
test('explicit permission to degrade overrides a model-invented strict policy',()=>{
 const r=plan('北京未来40分钟每分钟降水总览，可以降精度','weather.minute.overview',{strict_time:true});
 assert.equal(r.groundedArguments.strict_time,false);
});
test('explicit file identity beats a different selected object, retaining raw URI fragments',()=>{
 const r=plan('预览https://example.test/report.docx?download=1#part2','files.preview',{file_id:'https://example.test/report.docx?download=1'});
 assert.equal(r.groundedArguments.file_id,'https://example.test/report.docx?download=1#part2');assert.equal(r.grounding.identity[0].existenceVerified,false);
});
test('an omitted explicit ID is recovered rather than replaced with selected ID',()=>{
 const r=plan('读取文件file_explicit的名称','files.metadata.name',{});
 assert.equal(r.resolved.arguments.file_id,'file_explicit');assert.equal(r.grounding.identity[0].status,'explicit');
});
test('names and window titles cannot become opaque target IDs',()=>{
 const r=plan('打开文件预览，标题叫待审稿，文件目标还没给','files.preview',{file_id:'待审稿',title:'待审稿'},{objects:{}});
 assert.equal(r.status,'needs_clarification');assert.equal(r.grounding.identity[0].status,'rejected');
});
test('reserved placeholders are rejected and read-only selected identities remain usable',()=>{
 const r=plan('只读取当前选中联系人的邮箱地址值','contacts.emails.email',{contact_id:'current_selected_contact_id'});
 assert.equal(r.resolved.arguments.contact_id,'ct_7');assert.equal(r.grounding.identity[0].status,'selected');
 assert.ok(r.grounding.repairs.length);
});
test('write target IDs cannot be supplied from selection or guessed placeholders',()=>{
 const r=plan('删除当前日程','calendar.cancel',{event_id:'current_event_id'},{objects:{event_id:{value:'ev_42',trusted:true,source:'user_selection'}}});
 assert.equal(r.status,'needs_clarification');assert.ok(r.grounding.blockers.length);
});
test('explicit opaque ID is accepted as grounded without claiming real object existence',()=>{
 const r=plan('读取联系人ID="customer-x9"的电话号码','contacts.phone',{contact_id:'customer-x9'});
 assert.equal(r.status,'ready_mock');assert.equal(r.grounding.identity[0].status,'explicit');assert.equal(r.grounding.identity[0].existenceVerified,false);
});
test('an authoritative fixture can reject nonexisting IDs but never proves SDK identity',()=>{
 const r=plan('读取联系人ct_404的电话号码','contacts.phone',{contact_id:'ct_404'},{identityDirectory:{contact_id:{source:'fixture',complete:true,ids:['ct_7']}}});
 assert.equal(r.status,'needs_clarification');assert.match(r.grounding.identity[0].message,/不存在|目录/);assert.equal(r.grounding.identity[0].existenceVerified,false);
});
test('calendar time roles are cross-checked so a reversed range cannot be silently repaired by the model',()=>{
 const r=plan('创建“讨论”，明天下午4点开始，明天下午3点结束','calendar.create',{title:'讨论',starts_at:'明天15:00',ends_at:'明天16:00'});
 assert.equal(r.groundedArguments.starts_at,'明天下午4点');assert.equal(r.groundedArguments.ends_at,'明天下午3点');assert.equal(r.status,'needs_clarification');
});
test('explicit registered service cannot be replaced with selected service',()=>{
 const r=plan('读取文件服务是否可用','services.availability',{}, {objects:{service:{value:'weather',trusted:true,source:'user_selection'}}});
 assert.equal(r.groundedArguments.service,'files');assert.equal(r.resolved.arguments.service,'files');
});
test('unknown model local destination does not become a usable invented directory',()=>{
 const r=plan('下载云文件backups/full.zip到本地，保存位置我没给','cloud.storage.download',{cloud_path:'backups/full.zip',local_path:'./'});
 assert.equal(r.status,'needs_clarification');assert.ok(!Object.hasOwn(r.groundedArguments,'local_path'));
});
test('a quoted URI containing spaces is one exact target, not two competing targets',()=>{
 const r=plan('请预览文件URI“file:///D:/demo/季度 报告.txt”','files.preview',{});
 assert.equal(r.status,'ready_mock');assert.equal(r.groundedArguments.file_id,'file:///D:/demo/季度 报告.txt');
});
test('a named contact cannot accidentally fall back to another selected contact',()=>{
 const r=plan('读取联系人林晓的电话号码','contacts.phone',{contact_id:'林晓'});
 assert.equal(r.status,'ready_mock');assert.equal(r.resolved.arguments.query,'林晓');assert.equal(r.resolved.arguments.contact_id,undefined);
});
test('a date word quoted as a title search payload does not become a query time filter',()=>{
 const r=plan('查标题含“明天”的日程','calendar.search',{keyword:'明天'});
 assert.equal(r.groundedArguments.time_ref,undefined);assert.equal(r.resolved.arguments.time_ref.start,'2026-10-10');
});
test('explicit structured slot assignments recover nested query without changing spaces or ampersands',()=>{
 const r=plan('打开会议资料服务，query原样传“A&B 合并”','services.open',{service:'materials'});
 assert.equal(r.groundedArguments.parameters.query,'A&B 合并');
});
test('explicit quoted title omitted by model is restored from the source rather than guessed',()=>{
 const r=plan('创建日程“晨会”，明天上午9点开始','calendar.create',{starts_at:'明天上午9点'});
 assert.equal(r.groundedArguments.title,'晨会');assert.equal(r.status,'ready_mock');
});
test('an explicit nested JSON parameters object remains business data including temporal words',()=>{
 const r=plan('打开文件服务，参数写作{"query":"明天\u0026后天.pdf"}','services.open',{});
 assert.deepEqual(r.groundedArguments.parameters,{query:'明天&后天.pdf'});assert.equal(r.status,'ready_mock');
});
test('a bare file URI next to a Chinese question or action ends at the resource boundary',()=>{
 for(const [text,uri]of [['文件file:///D:/demo/archive.zip有多少字节？','file:///D:/demo/archive.zip'],['为文件file:///D:/demo/deck.pptx准备预览资源','file:///D:/demo/deck.pptx']]){
  const r=plan(text,'files.metadata.name',{file_id:uri});assert.equal(r.groundedArguments.file_id,uri);assert.equal(r.status,'ready_mock');
 }
});
test('a structured ID field name is not itself a second target ID',()=>{
 for(const text of ['<请求><file_id>file_xml</file_id></请求>','file_id=file_xml；只要文件MIME字段']){
  const r=plan(text,'files.metadata.name',{file_id:'file_xml'});assert.equal(r.status,'ready_mock');assert.equal(r.groundedArguments.file_id,'file_xml');
 }
});
test('weekend expression uses the longest date span, never the containing whole week',()=>{
 const r=plan('这周末我有什么安排','calendar.search',{time_ref:'这周末'});
 assert.equal(r.groundedArguments.time_ref,'这周末');assert.equal(r.resolved.arguments.time_ref.start,'2026-10-10');assert.equal(r.resolved.arguments.time_ref.end,'2026-10-11');
});
test('forbid degradation does not also match the allow phrase inside its negation',()=>{
 const r=plan('上海明天下午3点15分湿度，不允许降精度','weather.hourly.humidity',{location:'上海',time_ref:'明天下午3点15分',strict_time:true});
 assert.equal(r.grounding.blockers.length,0);assert.equal(r.groundedArguments.strict_time,true);assert.ok(!r.grounding.checks.some(x=>x.code==='conflicting_precision_policy'));
});
test('pipeline keeps the one model response, raw extracted slots and deterministic repair independently',async()=>{
 let calls=0;
 const run=await runPipeline({text:'广州当前的气压',mode:'unified',model:'fixture',context},{providers:{ollama:{async invoke(request){calls++;return {value:{domain:'weather',api:'weather.current.pressure',arguments:{}},trace:{stage:request.stage,raw:'{"domain":"weather","api":"weather.current.pressure","arguments":{}}',wallMs:3}};}}}});
 assert.equal(calls,1);assert.equal(run.status,'ready_mock');assert.deepEqual(run.extractedArguments,{});assert.deepEqual(run.modelArguments,{});
 assert.equal(run.groundedArguments.location,'广州');assert.equal(run.ruleVersion,'deterministic-grounding-v1');assert.ok(run.deterministicMs>=0);assert.equal(run.traces.length,1);
});
test('an opaque ID inside explicit JSON remains grounded without requiring a domain-specific prefix',()=>{
 const r=plan('读取联系人电话；参数{"contact_id":"customer-x9"}','contacts.phone',{});
 assert.equal(r.status,'ready_mock');assert.equal(r.groundedArguments.contact_id,'customer-x9');assert.equal(r.grounding.identity[0].status,'explicit');
});
test('IDs occurring in quoted business values do not become competing target identities',()=>{
 for(const [text,api,args] of [
  ['把日程ev_42标题改为“ev_99”','calendar.event.set.title',{event_id:'ev_42',value:'ev_99'}],
  ['为联系人ct_7备注“联系ct_9核对”','contacts.set.note',{contact_id:'ct_7',value:'联系ct_9核对'}],
  ['读取联系人；contact_id=ct_7，query="ct_9"','contacts.get',{contact_id:'ct_7',query:'ct_9'}],
 ]){const r=plan(text,api,args);assert.equal(r.status,'ready_mock');assert.equal(r.grounding.blockers.length,0);}
});
test('a city mentioned inside a quoted annotation does not override an explicit query city',()=>{
 const r=plan('查询上海当前湿度，备注“广州是客户名”','weather.current.humidity',{location:'上海',time_ref:'当前'});
 assert.equal(r.status,'ready_mock');assert.equal(r.groundedArguments.location,'上海');
});
test('a quoted ID or place with an explicit field label is still recognized as the target',()=>{
 const r=plan('读取联系人ID="customer-x9"电话号码','contacts.phone',{});assert.equal(r.status,'ready_mock');assert.equal(r.groundedArguments.contact_id,'customer-x9');
 const w=plan('地点：“广州”；查询当前湿度','weather.current.humidity',{});assert.equal(w.groundedArguments.location,'广州');
});
test('a cloud function payload cannot override invocation metadata that happens to share its keys',()=>{
 const data='{"version":"v99","timeout_ms":5,"function_name":"wrong"}';
 const r=plan(`调用云函数echo，正文是${data}`,'cloud.function.call',{function_name:'echo',data});
 assert.equal(r.groundedArguments.function_name,'echo');assert.equal(r.groundedArguments.version,undefined);assert.equal(r.groundedArguments.timeout_ms,undefined);assert.equal(r.groundedArguments.data,data);
});
test('an explicit contact name query is an alternative to a selected contact identity',()=>{
 for(const args of [{},{query:'林晓'}]){
  const r=plan('读取联系人林晓的电话号码','contacts.phone',args);assert.equal(r.status,'ready_mock');assert.equal(r.resolved.arguments.query,'林晓');assert.equal(r.resolved.arguments.contact_id,undefined);
 }
});
test('an unregistered but explicitly named place cannot silently default to a device city',()=>{
 const r=plan('乌鲁木齐现在温度多少？','weather.current.temperature',{});
 assert.equal(r.groundedArguments.location,'乌鲁木齐');assert.equal(r.status,'resolution_failed');assert.notEqual(r.resolved.sources.location,'system_location');
});
test('quoted coordinate annotations do not replace an explicit weather city',()=>{
 const r=plan('查北京当前温度；备注“纬度31，经度121”','weather.current.temperature',{location:'北京',time_ref:'当前'});
 assert.equal(r.status,'ready_mock');assert.equal(r.groundedArguments.coordinates,undefined);assert.equal(r.groundedArguments.location,'北京');
});
test('a page query mentioning a service name cannot supply a missing navigation target',()=>{
 const r=plan('打开当前服务页面，query="天气服务"','services.open',{parameters:{query:'天气服务'}});
 assert.equal(r.groundedArguments.service,undefined);assert.equal(r.status,'needs_clarification');
});
test('an ID label inside quoted explanatory text is payload rather than a write target',()=>{
 const r=plan('把资料分享给联系人ct_receiver；说明文字是“material_id=ma_example”','materials.share',{contact_id:'ct_receiver'});
 assert.equal(r.groundedArguments.material_id,undefined);assert.equal(r.status,'needs_clarification');
});
test('explicit structured time is not overwritten by an unstructured annotation word',()=>{
 const r=plan('查看天气；参数{"location":"北京","time_ref":"明天"}；备注现在只是测试提示','weather.daily.overview',{location:'北京',time_ref:'明天'});
 assert.equal(r.groundedArguments.time_ref,'明天');assert.equal(r.resolved.arguments.time_ref.start,'2026-10-11');
});
test('a punctuation-separated time granularity remains part of the original requested constraint',()=>{
 const r=plan('杭州未来30分钟，逐小时温度，不允许降精度','weather.hourly.temperature',{location:'杭州',time_ref:'未来30分钟，逐小时',strict_time:true});
 assert.equal(r.groundedArguments.time_ref,'未来30分钟，逐小时');assert.equal(r.resolved.arguments.time_ref.precision,'hour');assert.equal(r.status,'ready_mock');
});
test('current-year phrasing is a single date expression',()=>{
 const r=plan('查询当前年10月12日的日程','calendar.search',{time_ref:'当前年10月12日'});
 assert.equal(r.status,'ready_mock');assert.equal(r.groundedArguments.time_ref,'当前年10月12日');
});
test('quoted field assignments with whitespace are not captured twice as plain assignments',()=>{
 const r=plan('搜索文件，keyword = "预算"','files.search',{keyword:'预算'});
 assert.equal(r.status,'ready_mock');assert.equal(r.groundedArguments.keyword,'预算');assert.equal(r.grounding.blockers.length,0);
});
