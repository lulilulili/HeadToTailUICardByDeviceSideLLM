import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizePlan,groundArguments,GROUNDING_VERSION} from '../src/grounding.mjs';
import {getCapability} from '../src/registry.mjs';
import {experimentDefaults} from '../src/fixtures.mjs';
import {runPipeline} from '../src/pipeline.mjs';

const context={...experimentDefaults,now:'2026-10-11T08:00:00+08:00',timezone:'Asia/Shanghai',location:{latitude:31.2304,longitude:121.4737,source:'fixture'}};
const plan=(text,api,args={},extra={})=>finalizePlan({text,api,domain:getCapability(api).domain,extractedArguments:args,context:{...context,...extra}});
const auditSpan=(result,field,text,value)=>{
 const check=result.grounding.checks.find(item=>item.field===field&&item.effectiveValue!==undefined);
 assert.ok(check?.span,`${field} has source evidence`);
 assert.equal(text.slice(check.span.start,check.span.end),check.span.text);
 if(value!==undefined)assert.equal(check.span.text,value);
};

test('v2 quoted business values preserve mixed punctuation, spaces and embedded quote styles',()=>{
 const text='保存资料，标题：“  R&D O\'Brien  ”，正文：“甲说 "A&B"。\n乙说不要改标点！”';
 const raw={title:'R&D OBrien',content:'甲说A&B'};
 const original=structuredClone(raw),r=plan(text,'materials.save',raw);
 assert.equal(GROUNDING_VERSION,'deterministic-grounding-v2');
 assert.deepEqual(raw,original);
 assert.equal(r.groundedArguments.title,"  R&D O'Brien  ");
 assert.equal(r.groundedArguments.content,'甲说 "A&B"。\n乙说不要改标点！');
 auditSpan(r,'title',text,"  R&D O'Brien  ");
 auditSpan(r,'content',text,'甲说 "A&B"。\n乙说不要改标点！');
});
test('ASCII double-quoted values may contain apostrophes without truncation',()=>{
 const r=plan('保存资料，title="It\'s ready"；content="Don\'t rewrite!"','materials.save',{});
 assert.equal(r.groundedArguments.title,"It's ready");assert.equal(r.groundedArguments.content,"Don't rewrite!");
});
test('indices identify the actual value when it repeats the field label',()=>{
 const text='查找文件，keyword = "keyword"',r=plan(text,'files.search');
 assert.equal(r.groundedArguments.keyword,'keyword');
 const check=r.grounding.checks.find(item=>item.field==='keyword');
 assert.equal(check.span.start,text.lastIndexOf('keyword'));assert.equal(check.span.text,'keyword');
});
test('quoted query text is data and cannot become a time or ID',()=>{
 const r=plan('搜索日程，关键词：“明天 ev_999”','calendar.search',{keyword:'明天'});
 assert.equal(r.groundedArguments.keyword,'明天 ev_999');assert.equal(r.groundedArguments.time_ref,undefined);assert.equal(r.groundedArguments.event_id,undefined);
});
test('file title search and file type can both be recovered from a single natural request',()=>{
 const r=plan('帮我找验收底稿相关的PDF文件','files.search',{});
 assert.equal(r.groundedArguments.keyword,'验收底稿');assert.equal(r.groundedArguments.file_type,'pdf');assert.equal(r.status,'ready_mock');
});
test('multiline Chinese labels recover slots when the model omits every slot',()=>{
 const text='查找文件\n关键词：签收α稿\n类型：docx',r=plan(text,'files.search');
 assert.deepEqual(r.groundedArguments,{keyword:'签收α稿',file_type:'docx'});auditSpan(r,'keyword',text,'签收α稿');
});
test('contacts search names, phone fragments and organization filters remain exact queries',()=>{
 for(const [text,query]of [['在通讯录查找欧阳青','欧阳青'],['查通讯录里号码含075512的联系人','075512'],['查通讯录里组织含星辰的联系人','星辰']]){
  const r=plan(text,'contacts.search');assert.equal(r.groundedArguments.query,query);assert.equal(r.status,'ready_mock');auditSpan(r,'query',text,query);
 }
});
test('explicit contact labels repair omitted and normalized numbers without guessing identities',()=>{
 const text='创建联系人韩青，电话“+86 186 0000 8765”，邮箱qing@example.test，备注“不要删引号中的 ev_88”';
 const r=plan(text,'contacts.create',{phone:'18600008765',email:'wrong@example.test'});
 assert.equal(r.groundedArguments.name,'韩青');assert.equal(r.groundedArguments.phone,'+86 186 0000 8765');assert.equal(r.groundedArguments.email,'qing@example.test');assert.equal(r.groundedArguments.note,'不要删引号中的 ev_88');assert.equal(r.status,'ready_mock');
});
test('explicitly absent names and phones cannot receive a model business default',()=>{
 const r=plan('新增联系人，电话13712345678，姓名稍后再说','contacts.create',{name:'联系人',phone:'13712345678',email:'test@example.test'});
 assert.deepEqual(r.groundedArguments,{phone:'13712345678'});assert.equal(r.status,'needs_clarification');
 const noPhone=plan('创建联系人周岚，不填电话号码','contacts.create',{name:'周岚',phone:'号码'});
 assert.deepEqual(noPhone.groundedArguments,{name:'周岚'});assert.equal(noPhone.status,'ready_mock');
});
test('calendar business defaults are removed while explicit durations and reminder zero are preserved',()=>{
 const r=plan('现在开始创建日程“快同步”，持续25分钟，开始时提醒','calendar.create',{title:'快同步',starts_at:'2022-01-01T09:00:00',duration_minutes:60,reminder_minutes:15,description:'快同步',ends_at:'2022-01-01T10:00:00',is_all_day:false});
 assert.equal(r.groundedArguments.starts_at,'现在');assert.equal(r.groundedArguments.duration_minutes,25);assert.equal(r.groundedArguments.reminder_minutes,0);
 for(const key of ['description','ends_at','is_all_day'])assert.equal(r.groundedArguments[key],undefined);
 assert.equal(r.status,'ready_mock');
});
test('an all-day explicit timestamp range fills separate start and end roles',()=>{
 const r=plan('创建全天日程“停机”，从2026-10-13T00:00:00+08:00到2026-10-14T00:00:00+08:00','calendar.create',{});
 assert.equal(r.groundedArguments.title,'停机');assert.equal(r.groundedArguments.is_all_day,true);assert.equal(r.groundedArguments.starts_at,'2026-10-13T00:00:00+08:00');assert.equal(r.groundedArguments.ends_at,'2026-10-14T00:00:00+08:00');assert.equal(r.status,'ready_mock');
});
test('nested calendar slot labels recover only the named changes',()=>{
 const r=plan('修改日程ev_55：标题改为“立项&A”；地点改为E708','calendar.update',{event_id:'ev_55',changes:{title:'立项',description:'默认说明'}});
 assert.deepEqual(r.groundedArguments.changes,{title:'立项&A',location:'E708'});assert.equal(r.status,'ready_mock');
});
test('arrays and false values in field setters do not become missing values',()=>{
 const array=plan('设置日程ev_55提醒提前分钟数为0和25','calendar.event.set.reminders',{});
 assert.deepEqual(array.groundedArguments.value,[0,25]);assert.equal(array.status,'ready_mock');
 const assigned=plan('event_id=ev_55；value=[0,25]','calendar.event.set.reminders',{});
 assert.deepEqual(assigned.groundedArguments.value,[0,25]);assert.equal(assigned.status,'ready_mock');
 const flag=plan('设置日程ev_55全天标记为false','calendar.event.set.all_day',{});
 assert.equal(flag.groundedArguments.value,false);assert.equal(flag.status,'ready_mock');
});
test('recurrence and attendees keep the user values instead of model abstractions',()=>{
 const r=plan('创建日程“站会”，明天上午9点开始，参会人赵一和孙二，每周三重复','calendar.create',{title:'站会',starts_at:'明天上午9点',recurrence:'weekly'});
 assert.deepEqual(r.groundedArguments.attendees,['赵一','孙二']);assert.equal(r.groundedArguments.recurrence,'每周三');
});
test('an output field name is not an extra contact or calendar search condition',()=>{
 const contact=plan('联系人ct_55的邮政信箱','contacts.postalAddresses.pobox',{contact_id:'ct_55',query:'邮政信箱'});
 assert.equal(contact.groundedArguments.query,undefined);assert.equal(contact.status,'ready_mock');
 const event=plan('日程ev_55参会人的接受状态','calendar.event.attendee.status',{event_id:'ev_55',keyword:'参会人'});
 assert.equal(event.groundedArguments.keyword,undefined);assert.equal(event.status,'ready_mock');
});
test('paths are assigned according to source and destination role with no invented bucket',()=>{
 const text='上传本地D:/demo/check.bin到云端inbox/check.bin，存储实例team-a',r=plan(text,'cloud.storage.upload',{bucket:'inbox'});
 assert.deepEqual(r.groundedArguments,{bucket:'team-a',local_path:'D:/demo/check.bin',cloud_path:'inbox/check.bin'});auditSpan(r,'cloud_path',text,'inbox/check.bin');assert.equal(r.status,'ready_mock');
});
test('unprovided upload destination remains missing even when local source is known',()=>{
 const r=plan('将D:/demo/new.csv上传到云端，目标路径以后再定','cloud.storage.upload',{cloud_path:'new.csv',local_path:'D:/demo/new.csv',bucket:'default'});
 assert.deepEqual(r.groundedArguments,{local_path:'D:/demo/new.csv'});assert.equal(r.status,'needs_clarification');
});
test('cloud invocation metadata and JSON payload are separate exact evidence',()=>{
 const payload='{ "version": "fake", "n": 7, "text": "Keep  A&B" }';
 const r=plan(`调用云函数sumRows，版本v3，超时2500毫秒，请求正文为${payload}`,'cloud.function.call',{function_name:'sum',version:'fake',data:'{}'});
 assert.equal(r.groundedArguments.function_name,'sumRows');assert.equal(r.groundedArguments.version,'v3');assert.equal(r.groundedArguments.timeout_ms,2500);assert.equal(r.groundedArguments.data,payload);assert.equal(r.status,'ready_mock');
});
test('explicit invalid typed metadata blocks rather than receiving a default',()=>{
 for(const text of ['调用云函数echo；timeout_ms=900000','调用云函数echo；timeout_ms=banana']){
  const r=plan(text,'cloud.function.call',{});assert.equal(r.status,'needs_clarification');assert.ok(r.grounding.blockers.some(item=>item.code==='explicit_contract_invalid'));
  assert.notEqual(r.groundedArguments.timeout_ms,70000);
 }
 const seconds=plan('调用云函数echo；超时是2秒','cloud.function.call',{});assert.equal(seconds.groundedArguments.timeout_ms,2000);
});
test('database names and operation recover without guessing the record from its title',()=>{
 const field=plan('读取云数据库Receipts表记录rec_55的gross字段，数据库区域audit','cloud.database.field',{field_name:'total'});
 assert.deepEqual(field.groundedArguments,{field_name:'gross',collection:'Receipts',zone:'audit',record_id:'rec_55'});
 const aggregate=plan('求云数据库Measurements表score字段的平均值，区域labs','cloud.database.calculate',{});
 assert.deepEqual(aggregate.groundedArguments,{collection:'Measurements',field_name:'score',operation:'average',zone:'labs'});
});
test('multiple distinct labeled values are blocked and repeated identical values are accepted',()=>{
 const ambiguous=plan('查找文件；keyword="甲"；keyword="乙"','files.search',{});assert.equal(ambiguous.status,'needs_clarification');
 const repeated=plan('查找文件；keyword="甲"；keyword="甲"','files.search',{});assert.equal(repeated.status,'ready_mock');assert.equal(repeated.groundedArguments.keyword,'甲');
});
test('unmentioned model environment values are removed before system completion',()=>{
 const r=plan('看看湿度','weather.current.humidity',{location:'北京',time_ref:'明天',coordinates:{latitude:39.9,longitude:116.4},strict_time:true});
 assert.deepEqual(r.groundedArguments,{});assert.equal(r.resolved.sources.location,'system_location');assert.equal(r.status,'ready_mock');
});
test('explicit multiple places block even without registered geocodes or location',()=>{
 const r=plan('查询广州和杭州现在的湿度','weather.current.humidity',{}, {geocodes:{},location:null});
 assert.equal(r.status,'needs_clarification');assert.ok(r.grounding.blockers.some(item=>item.field==='location'&&item.code==='ambiguous_explicit_values'));
});
test('a supplied but unresolved place cannot silently become a current device location',()=>{
 const r=plan('地点：未登记的试验楼；查询温度','weather.current.temperature',{});
 assert.equal(r.groundedArguments.location,'未登记的试验楼');assert.notEqual(r.resolved.sources.location,'system_location');assert.equal(r.status,'resolution_failed');
});
test('media stream and network handle use explicit user values and retain zero',()=>{
 const music=groundArguments(getCapability('media.volume.level'),'当前音乐音量多少',{stream_type:'ALARM'},{});
 assert.equal(music.groundedArguments.stream_type,'MUSIC');
 const alarm=groundArguments(getCapability('media.volume.level'),'闹钟音量多少',{},{});assert.equal(alarm.groundedArguments.stream_type,'ALARM');
 const unspecified=groundArguments(getCapability('media.volume.level'),'当前音量多少',{stream_type:'MUSIC'},{});assert.equal(unspecified.groundedArguments.stream_type,undefined);
 const network=groundArguments(getCapability('connectivity.network.capabilities'),'net_id=0；查网络能力',{},{});assert.equal(network.groundedArguments.net_id,0);
 const defaultNetwork=groundArguments(getCapability('connectivity.network.capabilities'),'当前网络能力',{net_id:1},{});assert.equal(defaultNetwork.groundedArguments.net_id,undefined);
});
test('location address and coordinates recover exact user spans without geocoding guesses',()=>{
 const address=groundArguments(getCapability('location.geocode'),'把“宁波市鄞州区试验街8号”转换为经纬度',{},{});
 assert.equal(address.groundedArguments.address,'宁波市鄞州区试验街8号');
 const coordinates=groundArguments(getCapability('location.reverse_geocode'),'查询纬度30.05经度120.88的地址',{},{});
 assert.deepEqual(coordinates.groundedArguments.coordinates,{latitude:30.05,longitude:120.88});
 const incomplete=groundArguments(getCapability('location.reverse_geocode'),'查询纬度30.05的地址',{},{});assert.ok(incomplete.grounding.blockers.some(item=>item.code==='incomplete_coordinates'));
});
test('mobile phone aliases preserve explicitly quoted numbers',()=>{
 const r=plan('新建联系人，姓名“江雨”，手机号“13800138001”，邮箱“jiang@example.test”','contacts.create',{name:'江雨',phone:'13800138001',email:'jiang@example.test'});
 assert.deepEqual(r.groundedArguments,{name:'江雨',phone:'13800138001',email:'jiang@example.test'});assert.equal(r.status,'ready_mock');
});
test('encoded quoted JSON request data decodes string notation while source evidence retains escapes',()=>{
 const data='{"text":"今天的记录","space":" A&B "}',text=`调用云函数，function_name="summarize"，data=${JSON.stringify(data)}`;
 const r=plan(text,'cloud.function.call',{function_name:'summarize',data});
 assert.equal(r.groundedArguments.data,data);assert.equal(r.status,'ready_mock');
 const check=r.grounding.checks.find(item=>item.field==='data');assert.equal(text.slice(check.span.start,check.span.end),check.span.text);assert.match(check.span.text,/\\"text\\"/);
});
test('braced JSON inside an outer text quote remains one request body',()=>{
 const text='调用云函数，function_name="echo"，data="{"text":"今天的记录"}"';
 const r=plan(text,'cloud.function.call',{function_name:'echo',data:'{"text":"今天的记录"}'});
 assert.equal(r.groundedArguments.data,'{"text":"今天的记录"}');assert.equal(r.status,'ready_mock');
});
test('an explicit network ID without an assignment separator is not a system default',()=>{
 const r=groundArguments(getCapability('connectivity.network.bearer_types'),'网络ID 37用的是WiFi还是流量',{net_id:37},{});
 assert.equal(r.groundedArguments.net_id,37);assert.equal(r.grounding.repairs.length,0);
});
test('minimum, maximum, mute and assistant queries preserve the named audio stream',()=>{
 for(const [text,stream]of [['闹钟最小音量是多少','ALARM'],['通知最大音量是多少','NOTIFICATION'],['查一下助手音量','VOICE_ASSISTANT'],['音乐静音了吗','MUSIC']]){
  const r=groundArguments(getCapability('media.volume.level'),text,{stream_type:stream},{});
  assert.equal(r.groundedArguments.stream_type,stream);assert.equal(r.grounding.repairs.length,0);
 }
});

const fakeProvider=value=>({ollama:{async invoke(){return {value,trace:{stage:'unified',raw:JSON.stringify(value)}};}}});
const pipeline=async(text,api,args,extra,read)=>runPipeline({text,model:'test',mode:'unified',context:{...context,...extra}},{providers:fakeProvider({domain:getCapability(api).domain,api,arguments:args}),systemContextProvider:{read}});

test('unknown named places recover through weather relations without a city whitelist',()=>{
 for(const [text,api,place]of [
  ['查巴黎现在的紫外线指数','weather.current.uvIndex.value','巴黎'],
  ['漠河现在气温是多少','weather.current.temperature','漠河'],
  ['明天漠河湿度','weather.hourly.humidity','漠河'],
  ['漠河未来6小时逐小时湿度','weather.hourly.humidity','漠河'],
  ['漠河的逐小时湿度','weather.hourly.humidity','漠河'],
  ['查漠河现在的紫外线指数','weather.current.uvIndex.value','漠河'],
  ['帮我看一下Reykjavik现在的湿度','weather.current.humidity','Reykjavik'],
  ['我想知道无名试验城的气压','weather.current.pressure','无名试验城']
 ]){
  const r=plan(text,api,{}, {geocodes:{}});
  assert.equal(r.groundedArguments.location,place,text);auditSpan(r,'location',text,place);
  assert.equal(r.status,'resolution_failed',text);assert.notEqual(r.resolved.sources.location,'system_location',text);
 }
});

test('unresolved explicit Mohe and Paris use named geocoding dependencies but never current location',async()=>{
 for(const [text,api,place]of [['漠河现在气温是多少','weather.current.temperature','漠河'],['明天漠河湿度','weather.hourly.humidity','漠河'],['查漠河现在的紫外线指数','weather.current.uvIndex','漠河'],['查巴黎现在的紫外线指数','weather.current.uvIndex','巴黎']]){
  const requests=[],r=await pipeline(text,api,{}, {geocodes:{},location:null},async request=>{requests.push(request);throw new Error('geocoding unavailable');});
  assert.deepEqual(requests.map(item=>item.capability),['location.geocode'],text);
  assert.equal(requests[0].arguments.address,place);assert.equal(r.groundedArguments.location,place);
  assert.equal(r.status,'resolution_failed');assert.equal(r.resolved.arguments.location,place);assert.equal(r.resolved.resolution.location.effective,null);assert.deepEqual(r.extractedArguments,{});
 }
});

test('successful named-place geocoding retains its named source rather than the device position',async()=>{
 const requests=[],r=await pipeline('漠河现在气温是多少','weather.current.temperature',{}, {geocodes:{},location:{latitude:22.5,longitude:114.0,source:'fixture'}},async request=>{requests.push(request);return {source:'harmony',value:[{latitude:52.97,longitude:122.54}]};});
 assert.deepEqual(requests.map(item=>item.capability),['location.geocode']);assert.equal(requests[0].arguments.address,'漠河');
 assert.equal(r.status,'ready_mock');assert.equal(r.resolved.resolution.location.effective.latitude,52.97);assert.equal(r.resolved.resolution.location.effective.longitude,122.54);
 assert.equal(r.resolved.resolution.location.effective.source,'harmony');assert.notEqual(r.resolved.sources.location,'system_location');
});

test('negated places and negated time do not create multiple active weather targets',()=>{
 for(const text of ['不要查北京，查广州现在湿度','不要查北京而是查广州现在湿度','不是北京，查广州现在湿度','别查北京，查看广州现在湿度']){
  const r=plan(text,'weather.current.humidity',{location:'北京'});
  assert.equal(r.groundedArguments.location,'广州',text);assert.equal(r.groundedArguments.time_ref,'现在',text);assert.equal(r.status,'ready_mock',text);
  assert.equal(r.grounding.blockers.length,0,text);auditSpan(r,'location',text,'广州');
 }
 const r=plan('不要查明天，查广州现在湿度','weather.current.humidity',{});assert.equal(r.groundedArguments.time_ref,'现在');assert.equal(r.status,'ready_mock');
});

test('weather dataset and projection modifiers are not inferred as location names',()=>{
 for(const text of ['查当前实况湿度，时间范围为明早','查逐小时湿度','查询最高温度','读取实时气压']){
  const r=plan(text,'weather.current.humidity',{});
  assert.equal(r.groundedArguments.location,undefined,text);assert.equal(r.resolved.sources.location,'system_location',text);assert.equal(r.status,'ready_mock',text);
 }
 for(const [text,place]of [['上海未来6小时逐小时天气总览，包含温度湿度风','上海'],['武汉未来3天逐日天气总览，我要最高和最低气温','武汉'],['北京现在能见度，别给整页天气总览','北京']]){
  const r=plan(text,'weather.query',{});assert.equal(r.groundedArguments.location,place,text);assert.equal(r.grounding.blockers.length,0,text);
 }
});

test('audio scenarios with intervening time modifiers override another host stream',async()=>{
 for(const [text,stream]of [['音乐现在的音量是多少','MUSIC'],['闹钟当前音量多少','ALARM'],['通知此刻音量多少','NOTIFICATION'],['不要查音乐，查闹钟现在音量','ALARM']]){
  let reads=0;
  const r=await pipeline(text,'media.volume.level',{stream_type:stream}, {systemValues:{stream_type:{value:'VOICE_ASSISTANT',source:'fixture'}}},async()=>{reads++;return {source:'harmony',value:'VOICE_ASSISTANT'};});
  assert.equal(r.groundedArguments.stream_type,stream,text);assert.equal(r.resolved.arguments.stream_type,stream,text);assert.equal(reads,0,text);assert.equal(r.status,'ready_mock',text);
 }
});

test('an unsupported explicit audio scenario fails closed instead of defaulting to the host stream',async()=>{
 let reads=0;const r=await pipeline('播客现在的音量是多少','media.volume.level',{}, {},async()=>{reads++;return {source:'harmony',value:'ALARM'};});
 assert.equal(r.status,'needs_clarification');assert.equal(reads,0);assert.ok(r.grounding.blockers.some(item=>item.code==='unresolved_explicit_stream'));
});

test('unambiguous coordinate tuples recover exact evidence without current-device replacement',async()=>{
 for(const args of [{},{coordinates:{latitude:31.2304,longitude:121.4737}}]){
  let reads=0;const text='坐标（31.2304,121.4737）对应哪个地址',r=await pipeline(text,'location.reverse_geocode',args,{location:null},async()=>{reads++;return {source:'harmony',value:{latitude:22.5,longitude:114}};});
  assert.deepEqual(r.groundedArguments.coordinates,{latitude:31.2304,longitude:121.4737});assert.deepEqual(r.resolved.arguments.coordinates,{latitude:31.2304,longitude:121.4737});
  assert.equal(reads,0);assert.equal(r.status,'ready_mock');auditSpan(r,'coordinates',text,'31.2304,121.4737');assert.deepEqual(r.extractedArguments,args);
 }
 const lonFirst=plan('经纬度（121.4737，31.2304）对应的地址','location.reverse_geocode',{});
 assert.deepEqual(lonFirst.groundedArguments.coordinates,{latitude:31.2304,longitude:121.4737});
});

test('ambiguous or malformed explicit coordinates require clarification without device substitution',async()=>{
 for(const text of ['坐标（31.2,40.1）对应哪个地址','这组坐标对应哪个地址','坐标（31.2,unknown）对应哪个地址','坐标（191,121）对应哪个地址']){
  let reads=0;const r=await pipeline(text,'location.reverse_geocode',{}, {location:null},async()=>{reads++;return {source:'harmony',value:{latitude:22.5,longitude:114}};});
  assert.equal(r.status,'needs_clarification',text);assert.equal(reads,0,text);assert.ok(r.grounding.blockers.some(item=>item.field==='coordinates'),text);
 }
});
