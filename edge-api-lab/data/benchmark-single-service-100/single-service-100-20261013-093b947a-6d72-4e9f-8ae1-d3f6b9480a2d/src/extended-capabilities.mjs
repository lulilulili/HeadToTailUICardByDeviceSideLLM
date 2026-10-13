/** Object/field access contracts. These declare projections; no SDK or file access occurs. */
const str=(description,extra={})=>({type:'string',description,minLength:1,...extra});
const integer=(description,extra={})=>({type:'integer',description,...extra});
const bool=description=>({type:'boolean',description});
const array=(description,items={type:'string'})=>({type:'array',description,items,minItems:1});
const selected=(description)=>str(description,{resolver:'selected_object'});
const reference={
 calendar:'https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/js-apis-calendarmanager',
 contacts:'https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/js-apis-contact',
 files:'https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/preview-arkts',
 services:'https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/applinking-deferredlink-api',
 storage:'https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/cloudfoundation-cloudstorage',
 database:'https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/cloudfoundation-clouddatabase',
 functions:'https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/cloudfoundation-cloudfunction',
 prefetch:'https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/cloudfoundation-cloudresprefetch'
};
const getter=(id,domain,object,field,name,inputs,type,aliases,extra={})=>({
 id,domain,object,field,name,risk:'read',description:`读取${name}；只取得指定字段。缺目标时不能编造对象 ID。`,
 projection:`${object}.${field}`,returns:{type,nullable:true,description:`${name}；本阶段 value 为 null，接入后由数据源返回。`},
 inputs,aliases,sourceRef:reference[domain]??reference.storage,support:'official_object_projection',...extra
});
const eventInputs=()=>({event_id:selected('明确日程ID；未给ID时只可使用用户选中的当前日程'),keyword:str('日程标题关键词'),time_ref:str('查询日期或时段原文；未给目标/时间按今天查询',{default:'today',defaultUnlessPresent:['event_id'],resolver:'relative_time'})});
const contactInputs=()=>({contact_id:selected('明确联系人ID；未给ID时只可用用户选中的联系人'),query:str('联系人姓名、号码或组织查询词；姓名查询返回候选，不假定唯一联系人')});
const fileInputs=()=>({file_id:str('明确文件ID或URI；未给时只可使用用户选中的当前文件',{required:true,resolver:'selected_object'})});
const materialInputs=()=>({material_id:str('明确资料ID；未给时只可使用用户选中的当前资料',{required:true,resolver:'selected_object'})});
const serviceInputs=()=>({service:str('注册服务名称',{required:true,resolver:'selected_object',enum:['weather','calendar','contacts','files','materials']})});
const cloudInputs=()=>({cloud_path:str('云端文件完整路径，不用本地路径代替',{required:true,resolver:'selected_object'}),bucket:str('用户明确的存储实例；缺省由未来SDK查询默认实例')});

const eventFields=[
 ['id','数据库ID','number',['日程数据库ID','会议数据库ID']],
 ['title','标题','string',['日程标题','会议名称']],['startTime','开始时间','number',['几点开始','开始时间']],
 ['endTime','结束时间','number',['几点结束','结束时间']],['location','地点','object',['会议地点','日程地点','在哪开会']],
 ['attendee','参会人','array',['参会人','参与人','与会者']],['reminderTime','提醒时间','array',['提醒时间','提醒设置']],
 ['recurrenceRule','重复规则','object',['重复规则','每周重复','循环日程']],['description','说明','string',['日程备注','会议说明']],
 ['isAllDay','全天标记','boolean',['全天日程','全天标记']],['timeZone','时区','string',['会议时区','日程时区']],
 ['type','类型','number',['日程类型']],['identifier','业务标识','string',['日程标识']],
 ['isLunar','农历标记','boolean',['农历日程']],['instanceStartTime','实例开始时间','number',['实例开始时间']],
 ['instanceEndTime','实例结束时间','number',['实例结束时间']]
];
const eventIds={startTime:'start',endTime:'end',attendee:'attendees',reminderTime:'reminders',recurrenceRule:'recurrence',isAllDay:'all_day',timeZone:'timezone',isLunar:'lunar',instanceStartTime:'instance_start',instanceEndTime:'instance_end'};
const contactNative={phone:'phoneNumbers',email:'emails',address:'postalAddresses',organization:'organization',name:'name',nickname:'nickName',note:'note',birthday:'events'};
const eventNested=[['location.location','地点名称','string'],['location.longitude','地点经度','number'],['location.latitude','地点纬度','number'],['service.type','服务类型','string'],['service.uri','服务入口','string'],['service.description','服务描述','string']];
const contactNested=[
 ['phoneNumbers[].phoneNumber','电话号码值','string'],['emails[].email','邮箱地址值','string'],['postalAddresses[].postalAddress','完整邮寄地址','string'],
 ['name.fullName','完整姓名','string'],['name.familyName','姓','string'],['name.givenName','名','string'],['name.familyNamePhonetic','姓氏拼音','string'],['name.givenNamePhonetic','名字拼音','string'],
 ['organization.name','单位名称','string'],['organization.title','职位名称','string'],['phoneNumbers[].labelName','电话标签名称','string'],['phoneNumbers[].labelId','电话类型编码','number'],
 ['emails[].displayName','邮箱显示名称','string'],['postalAddresses[].city','住址城市','string'],['postalAddresses[].street','住址街道','string'],['postalAddresses[].postcode','邮政编码','string'],
 ['postalAddresses[].country','住址国家','string'],['events[].eventDate','生日纪念日日期','string'],['events[].labelName','事件标签','string']
];
const contactFields=[
 ['phoneNumbers','phone','电话号码','array',['电话','号码','手机号']],['emails','email','邮箱','array',['邮箱','电子邮件']],
 ['postalAddresses','address','邮寄地址','array',['联系人地址','住址','邮寄地址']],['organization','organization','单位与职位','object',['单位','公司','职位']],
 ['events','events','生日与纪念日','array',['生日','纪念日']],['name','name','姓名','object',['联系人姓名']],
 ['nickName','nickname','昵称','object',['昵称']],['note','note','备注','object',['联系人备注']],
 ['websites','websites','网站','array',['联系人网站','个人主页']],['portrait','portrait','头像','object',['头像']],
 ['groups','groups','群组','array',['联系人群组']],['relations','relations','关系','array',['联系人关系']],
 ['imAddresses','im','即时通讯地址','array',['即时通讯地址','IM地址']],['sipAddresses','sip','SIP地址','array',['SIP地址']]
];

// Native data leaves, verified against the linked SDK object tables. Enum values stay native.
const eventLeaves=[
 ['attendee[].name','参会人姓名','string','attendee',['参会人姓名','参与者姓名','与会者姓名']],
 ['attendee[].email','参会人邮箱','string','attendee',['参会人邮箱','参会人邮件地址','参与者邮箱','与会者邮箱']],
 ['attendee[].role','参会人角色','string','attendee',['参会人角色','参与者角色','组织者角色'],{sdkType:'AttendeeRole',optional:true,since:12}],
 ['attendee[].status','参会人回复状态','number','attendee',['参会人回复状态','参会人接受状态','参会人响应状态','参与者状态'],{sdkType:'AttendeeStatus',optional:true,since:18}],
 ['attendee[].type','参会人类型','number','attendee',['参会人类型','参与者类型','主送抄送类型'],{sdkType:'AttendeeType',optional:true,since:18}],
 ['recurrenceRule.recurrenceFrequency','重复频率','number','recurrencerule',['重复频率','日程重复频率','重复规则类型'],{sdkType:'RecurrenceFrequency'}],
 ['recurrenceRule.expire','重复截止时间','number','recurrencerule',['重复截止时间','重复结束日期','重复周期截止日'],{optional:true,unit:'milliseconds since Unix epoch'}],
 ['recurrenceRule.count','重复次数','number','recurrencerule',['重复次数','重复规则次数'],{optional:true,since:12}],
 ['recurrenceRule.interval','重复间隔','number','recurrencerule',['重复间隔','重复周期间隔'],{optional:true,since:12}],
 ['recurrenceRule.excludedDates','重复排除日期','array','recurrencerule',['重复排除日期','排除哪些日期','重复例外日期'],{items:{type:'number'},shape:'list',optional:true,since:12,unit:'milliseconds since Unix epoch'}],
 ['recurrenceRule.daysOfWeek','重复星期编号','array','recurrencerule',['重复星期编号','每周哪几天重复','重复规则星期'],{items:{type:'number'},shape:'list',optional:true,since:12}],
 ['recurrenceRule.daysOfMonth','重复月内日期编号','array','recurrencerule',['每月哪几天重复','重复月内日期编号'],{items:{type:'number'},shape:'list',optional:true,since:12}],
 ['recurrenceRule.daysOfYear','重复年内日期编号','array','recurrencerule',['每年第几天重复','重复年内日期编号'],{items:{type:'number'},shape:'list',optional:true,since:12}],
 ['recurrenceRule.weeksOfMonth','重复月内周编号','array','recurrencerule',['每月第几周重复','重复月内周编号'],{items:{type:'number'},shape:'list',optional:true,since:12}],
 ['recurrenceRule.weeksOfYear','重复年内周编号','array','recurrencerule',['每年第几周重复','重复年内周编号'],{items:{type:'number'},shape:'list',optional:true,since:12}],
 ['recurrenceRule.monthsOfYear','重复月份编号','array','recurrencerule',['每年哪几个月重复','重复月份编号'],{items:{type:'number'},shape:'list',optional:true,since:12}]
];
const contactLeaves=[
 ['id','系统ID','number','contact',['联系人系统ID','联系人数据库ID'],{readonly:true,optional:true}],
 ['key','系统key','string','contact',['联系人系统key','联系人唯一key'],{readonly:true,optional:true}],
 ['name.middleName','中间名','string','name',['联系人中间名']],
 ['name.middleNamePhonetic','中间名拼音','string','name',['联系人中间名拼音']],
 ['name.namePrefix','姓名前缀','string','name',['联系人姓名前缀']],
 ['name.nameSuffix','姓名后缀','string','name',['联系人姓名后缀']],
 ['name.hasName','是否含姓名','boolean','name',['联系人是否含姓名','联系人是否有姓名'],{optional:true,since:22}],
 ['nickName.nickName','昵称文本','string','nickname',['联系人昵称文本','昵称内容']],
 ['note.noteContent','备注内容','string','note',['联系人备注内容','备注文本']],
 ['portrait.uri','头像地址','string','portrait',['联系人头像地址','头像URI']],
 ['portrait.photo','头像像素图','object','portrait',['联系人头像像素图','头像PixelMap'],{sdkType:'image.PixelMap',optional:true,since:22,serialization:'opaque resource reference'}],
 ['websites[].website','网站地址','string','website',['联系人网站地址','个人主页地址']],
 ['relations[].relationName','关系名称','string','relation',['联系人关系名称','关联人姓名']],
 ['relations[].labelName','关系标签名称','string','relation',['联系人关系标签名称','关系类型名称']],
 ['relations[].labelId','关系类型编码','number','relation',['联系人关系类型编码','关系标签编码']],
 ['groups[].title','群组名称','string','group',['联系人群组名称','所属群组名称']],
 ['groups[].groupId','群组ID','number','group',['联系人群组ID','所属群组ID']],
 ['imAddresses[].imAddress','即时消息地址值','string','imaddress',['联系人即时消息地址值','IM地址值','即时通讯账号']],
 ['imAddresses[].labelName','即时消息标签名称','string','imaddress',['联系人即时消息标签名称','IM类型名称']],
 ['imAddresses[].labelId','即时消息类型编码','number','imaddress',['联系人即时消息类型编码','IM类型编码']],
 ['sipAddresses[].sipAddress','SIP地址值','string','sipaddress',['联系人SIP地址值','SIP账号地址']],
 ['sipAddresses[].labelName','SIP标签名称','string','sipaddress',['联系人SIP标签名称','SIP类型名称']],
 ['sipAddresses[].labelId','SIP类型编码','number','sipaddress',['联系人SIP类型编码','SIP标签编码']],
 ['emails[].labelName','邮箱标签名称','string','email',['联系人邮箱标签名称','邮箱类型名称']],
 ['emails[].labelId','邮箱类型编码','number','email',['联系人邮箱类型编码','邮箱标签编码']],
 ['events[].labelId','生日纪念日类型编码','number','event',['联系人事件类型编码','生日纪念日类型编码']],
 ['postalAddresses[].labelName','邮寄地址标签名称','string','postaladdress',['联系人邮寄地址标签名称','住址类型名称']],
 ['postalAddresses[].neighborhood','邮寄地址邻里信息','string','postaladdress',['联系人地址邻里信息','住址邻里信息']],
 ['postalAddresses[].pobox','邮寄地址信箱','string','postaladdress',['联系人邮寄地址信箱','邮政信箱']],
 ['postalAddresses[].region','邮寄地址区域','string','postaladdress',['联系人住址区域','邮寄地址区域']],
 ['postalAddresses[].labelId','邮寄地址类型编码','number','postaladdress',['联系人邮寄地址类型编码','住址类型编码']]
];
const nativeLeaf=(domain,object,[field,name,type,section,aliases,output={}])=>{
 const cap=getter(`${domain==='calendar'?'calendar.event':'contacts'}.${field.replaceAll('[]','')}`,domain,object,field,`${domain==='calendar'?'日程':'联系人'}${name}`,domain==='calendar'?eventInputs():contactInputs(),type,aliases,{
  sourceRef:`${reference[domain]}#${section}`,
  ...(domain==='contacts'?{constraints:{atLeastOne:['contact_id','query']}}:{}),
  note:'原生字段投影；枚举、数值和数组保留SDK原值，不把查询的输出值作为输入或生成模拟值。'
 });
 cap.returns={...cap.returns,shape:'value',...output};
 if(output.sdkType==='image.PixelMap')cap.note+=' PixelMap只能由未来端侧适配器提供不透明资源引用，不转换为文本或假定可直接JSON序列化。';
 return cap;
};

export const extendedCapabilities=[
 ...eventFields.map(([field,name,type,aliases])=>getter(`calendar.event.${eventIds[field]??field}`,'calendar','Event',field,`日程${name}`,eventInputs(),type,aliases,{selection:'ID优先；否则按关键词与日期返回候选日程的字段',granularities:['current','minute','hourly','daily']})),
 ...eventNested.map(([field,name,type])=>getter(`calendar.event.${field}`,'calendar','Event',field,`日程${name}`,eventInputs(),type,[`日程${name}`,`会议${name}`])),
 ...eventLeaves.map(spec=>nativeLeaf('calendar','Event',spec)),
 getter('calendar.event.get','calendar','Event','*','日程详情',eventInputs(),'array',['日程详情','会议详情'],{aggregate:true}),
 ...[['title','标题',str('新标题',{required:true})],['location','地点',str('新地点',{required:true})],['description','说明',str('新说明',{required:true})],['all_day','全天标记',bool('明确是否全天')],['reminders','提醒',array('明确提醒提前分钟数',{type:'integer',minimum:-10080,maximum:10080})]].map(([field,name,value])=>({id:`calendar.event.set.${field}`,domain:'calendar',object:'Event',field,name:`设置日程${name}`,risk:'write',description:`只修改日程${name}；目标ID和新值必须明确，不能用当前时间或地点替用户决定。`,inputs:{event_id:str('明确目标日程ID',{required:true}),value:{...value,required:true}},aliases:[`修改${name}`,`设置${name}`],projection:`Event.${field}`,returns:{type:'object',description:'修改回执'},sourceRef:reference.calendar,support:'official_object_projection'})),
 ...[['name','账户名称'],['displayName','显示名'],['type','账户类型']].map(([field,name])=>getter(`calendar.account.${field}`,'calendar','CalendarAccount',field,`日历账户${name}`,{calendar_id:selected('明确日历账户ID；缺省使用用户选中的日历账户')},'string',[`日历账户${name}`])),
 ...[['enableReminder','提醒开关','boolean'],['color','颜色',['number','string']]].map(([field,name,type])=>getter(`calendar.config.${field}`,'calendar','CalendarConfig',field,`日历${name}`,{calendar_id:selected('明确日历账户ID；缺省由未来SDK获取默认日历账户')},type,[`日历${name}`],{note:'未给账户时SDK可获取默认日历，当前只声明此默认适配策略。'})),
 ...contactFields.map(([field,id,name,type,aliases])=>getter(`contacts.${id}`,'contacts','Contact',field,`联系人${name}`,contactInputs(),type,aliases,{constraints:{atLeastOne:['contact_id','query']},selection:'姓名等查询返回候选；唯一对象由ID或显式选择确定'})),
 ...contactNested.map(([field,name,type])=>getter(`contacts.${field.replaceAll('[]','')}`,'contacts','Contact',field,`联系人${name}`,contactInputs(),type,[`联系人${name}`],{constraints:{atLeastOne:['contact_id','query']}})),
 ...contactLeaves.map(spec=>nativeLeaf('contacts','Contact',spec)),
 getter('contacts.get','contacts','Contact','*','联系人详情',contactInputs(),'array',['联系人详情','通讯录详情'],{aggregate:true,constraints:{atLeastOne:['contact_id','query']}}),
 ...[['phone','电话'],['email','邮箱'],['address','地址'],['organization','单位'],['name','姓名'],['nickname','昵称'],['note','备注'],['birthday','生日']].map(([field,name])=>({id:`contacts.set.${field}`,domain:'contacts',object:'Contact',field,name:`设置联系人${name}`,risk:'write',description:`设置明确联系人ID的${name}；姓名不能替代ID，新值必须来自用户。`,inputs:{contact_id:str('明确目标联系人ID',{required:true}),value:str(`明确新的${name}值`,{required:true})},aliases:[`修改联系人${name}`,`设置联系人${name}`,`更改${name}`],projection:`Contact.${field}`,returns:{type:'object',description:'修改回执'},sourceRef:reference.contacts,support:'official_object_projection'})),
 ...[['name','名称','string',['文件名']],['size','大小','number',['文件大小','多少字节']],['mime_type','类型','string',['文件类型','MIME']],['modified_at','修改时间','string',['修改时间','最近修改']],['uri','地址','string',['文件地址','文件URI']],['extension','扩展名','string',['扩展名','文件后缀']]].map(([field,name,type,aliases])=>getter(`files.metadata.${field}`,'files','FileMetadata',field,`文件${name}`,fileInputs(),type,aliases,{support:'business_extension',sourceRef:'https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/preview-api',note:'本地元数据需额外文件数据源；不声明Preview Kit能搜索文件或提供这些字段。'})),
 getter('files.preview.can_preview','files','Preview','canPreview','文件能否预览',fileInputs(),'boolean',['能否预览','支持预览','可预览'],{support:'official_method'}),
 getter('files.preview.is_open','files','Preview','hasDisplayed','预览窗口是否已打开',{},'boolean',['预览窗口是否打开','预览打开状态'],{support:'official_method'}),
 {id:'files.preview.close',domain:'files',object:'Preview',name:'关闭预览窗口',risk:'navigation',description:'关闭当前预览窗口；使用应用上下文，只产生模拟回执。',inputs:{},aliases:['关闭预览','关掉预览'],sourceRef:reference.files,support:'official_method',returns:{type:'object',description:'关闭预览回执'}},
 {id:'files.preview.prepare',domain:'files',object:'Preview',name:'预取文件预览资源',risk:'read',description:'对明确文件预取预览资源；只生成模拟准备计划。',inputs:fileInputs(),aliases:['预取文件','预加载预览','准备预览'],sourceRef:reference.files,support:'adapter_contract',returns:{type:'object',description:'预览准备计划'}},
 ...[['target','目标页面','string',['服务目标页面']],['parameters','页面参数','object',['服务页面参数']],['availability','可用状态','boolean',['服务可用','能否打开服务']],['link','直达链接','string',['服务直达链接','服务深链']]].map(([field,name,type,aliases])=>getter(`services.${field}`,'services','RegisteredService',field,`服务${name}`,serviceInputs(),type,aliases,{support:'business_extension',note:'已注册服务配置字段，不等同deferredLink官方返回字段。'})),
 {id:'services.link.parse',domain:'services',object:'Link',name:'解析应用链接',risk:'read',description:'解析用户明确给出的应用链接；生成目标页面与参数计划，不导航任意网址。',inputs:{url:str('明确应用链接或由用户选择的链接',{required:true,resolver:'selected_object'})},aliases:['解析链接','解析应用链接','延迟链接'],sourceRef:reference.services,support:'adapter_contract',returns:{type:'object',description:'链接解析计划'}},
 {id:'services.link.deferred',domain:'services',object:'DeferredLink',field:'popDeferredLink',projection:'DeferredLink.popDeferredLink',name:'获取当前延迟应用链接',risk:'read',description:'从应用上下文获取延迟应用链接；只声明待接入的SDK调用。',inputs:{},aliases:['获取延迟链接','当前延迟链接'],sourceRef:reference.services,support:'official_method',returns:{type:'string',nullable:true}},
 ...[['title','标题','string',['资料标题']],['content','正文','string',['资料正文','资料内容']],['meeting_id','关联会议','string',['资料关联会议']],['updated_at','更新时间','string',['资料更新时间']],['owner','所有者','string',['资料所有者']],['permissions','访问权限','array',['资料权限']],['download_url','下载入口','string',['资料下载链接']]].map(([field,name,type,aliases])=>getter(`materials.${field}`,'cloud','MeetingMaterial',field,`会议资料${name}`,materialInputs(),type,aliases,{support:'business_extension',note:'会议资料是实验业务数据模型，由Cloud Foundation存储/数据库实现，非官方固定对象。'})),
 {id:'cloud.storage.download_url',domain:'cloud',object:'StorageBucket',field:'getDownloadURL',projection:'StorageBucket.getDownloadURL',name:'取得云文件下载地址',risk:'read',description:'读取指定云端文件的下载地址；云路径必需，实例名可留待SDK默认查询。',inputs:cloudInputs(),aliases:['云文件下载地址','云端下载链接'],sourceRef:reference.storage,support:'official_method',returns:{type:'string',nullable:true}},
 {id:'cloud.storage.upload',domain:'cloud',object:'UploadParams',name:'上传云文件',risk:'write',description:'准备上传明确本地文件至明确云端路径，所有业务路径必须由用户提供。',inputs:{local_path:str('本地文件路径',{required:true}),cloud_path:str('云端目标路径',{required:true}),bucket:str('存储实例名')},aliases:['上传云文件','上传到云端','上传文件'],sourceRef:reference.storage,support:'official_method',returns:{type:'object',description:'上传任务回执'}},
 {id:'cloud.storage.download',domain:'cloud',object:'DownloadParams',name:'下载云文件',risk:'write',description:'准备下载指定云文件到明确本地目标路径，目标路径不得自动猜测。',inputs:{cloud_path:str('云文件路径',{required:true}),local_path:str('本地目标路径',{required:true}),bucket:str('实例名')},aliases:['下载云文件','下载到本地'],sourceRef:reference.storage,support:'official_method',returns:{type:'object',description:'下载任务回执'}},
 {id:'cloud.function.call',domain:'cloud',object:'FunctionParams',field:'result',name:'调用云函数',risk:'write',description:'准备调用已由开发者注册的云函数；函数名和正文来自用户，缺省版本和超时按契约补全。',inputs:{function_name:str('云函数名称',{required:true}),data:str('用户提供的请求正文字符串'),version:str('函数版本',{default:'$latest'}),timeout_ms:integer('超时毫秒数',{default:70000,minimum:1,maximum:180000})},aliases:['调用云函数','云函数结果'],sourceRef:reference.functions,support:'official_method',returns:{type:'object',description:'FunctionResult.result（业务内容由函数定义）'}},
 {id:'cloud.database.field',domain:'cloud',object:'DatabaseObject',field:'field_name',projection:'DatabaseObject.<field_name>',name:'读取云记录字段',risk:'read',description:'直达业务数据库指定记录的指定字段；表、记录和字段名必须明确，实际查询映射由开发者实现。',inputs:{collection:str('业务对象类型或表名',{required:true}),record_id:str('记录ID',{required:true,resolver:'selected_object'}),field_name:str('字段名',{required:true}),zone:str('数据库区域',{resolver:'selected_object'})},aliases:['云记录字段','数据库字段','查云数据库'],sourceRef:reference.database,support:'business_extension',returns:{type:'object',nullable:true}},
 {id:'cloud.database.calculate',domain:'cloud',object:'DatabaseQuery',name:'统计云记录字段',risk:'read',description:'对指定对象类型的字段做计数、求和、平均或极值；不接受自由SQL。',inputs:{collection:str('对象类型或表名',{required:true}),field_name:str('字段名',{required:true}),operation:str('统计操作',{required:true,enum:['count','sum','average','maximum','minimum']}),zone:str('数据库区域',{resolver:'selected_object'})},aliases:['云数据统计','数据库求和','云端记录计数'],sourceRef:reference.database,support:'adapter_contract',returns:{type:'number',nullable:true}},
 {id:'cloud.prefetch.resource',domain:'cloud',object:'Prefetch',name:'预取云端资源',risk:'read',description:'准备预取明确的云端资源；只生成资源准备计划。',inputs:{resource:str('注册资源标识',{required:true,resolver:'selected_object'})},aliases:['预取云资源','预加载云端'],sourceRef:reference.prefetch,support:'adapter_contract',returns:{type:'object',description:'资源准备计划'}},
 ...[['result','结果','object'],['timestamp','时间戳','string'],['token','访问令牌','string']].map(([field,name,type])=>getter(`cloud.prefetch.${field}`,'cloud','PrefetchResult',field,`预加载${name}`,{mode:str('预加载类型',{enum:['install','periodic','link'],default:'periodic'}),link:str('跳链安装延迟链接，仅link模式使用')},type,[`预加载${name}`,`预取${name}`],{support:'official_object_projection',sourceRef:reference.prefetch,note:'默认周期模式是实验业务约定；SDK参数mode仍需适配，返回访问令牌不送入模型。'}))
];

// The direct write entry accepts a human value; the adapter must construct the native object/array.
for(const cap of extendedCapabilities){
 if(cap.projection?.includes('[]'))cap.returns={...cap.returns,type:'array',items:{type:cap.returns.type,...(cap.returns.sdkType?{sdkType:cap.returns.sdkType}:{})},shape:'list',description:cap.returns.description+' 数组叶字段按原数组顺序投影，保留多值。'};
 if(['calendar','contacts'].includes(cap.domain)&&cap.returns.type==='array'&&!cap.returns.items){
  const sdkType=({attendee:'Attendee',phoneNumbers:'PhoneNumber',emails:'Email',postalAddresses:'PostalAddress',events:'Event',websites:'Website',groups:'Group',relations:'Relation',imAddresses:'ImAddress',sipAddresses:'SipAddress'})[cap.field];
  cap.returns={...cap.returns,items:{type:cap.field==='reminderTime'?'number':'object',...(sdkType?{sdkType}:{})},shape:'list'};
 }
 if(cap.id==='cloud.function.call'){cap.object='FunctionResult';cap.projection='FunctionResult.result';cap.note='输入为FunctionParams；timeout_ms的1至180000ms是实验工程上限，官方接口未规定该范围。';}
 if(cap.id.startsWith('calendar.account.'))cap.note='未给账户时由未来SDK获取默认日历账户；本阶段只生成该适配计划，不虚构账户ID。';
 if(cap.id==='cloud.function.call'||cap.id==='cloud.prefetch.result')cap.returns.type=['string','object'];
 if(cap.id==='cloud.prefetch.timestamp'){cap.returns={...cap.returns,type:'string',format:'date-time',sdkType:'Date',serialization:'ISO 8601'};cap.note+=' SDK Date 在未来 HTTP 适配器中序列化为 ISO 8601 字符串。';}
 if(cap.id==='cloud.database.field')cap.returns={type:['string','number','boolean','object','array','null'],description:'字段类型由具体业务集合模型决定。'};
 if(cap.id.startsWith('contacts.set.')){cap.field=contactNative[cap.field];cap.projection=`Contact.${cap.field}`;cap.support='adapter_contract';}
 if(cap.id.startsWith('calendar.event.set.')){cap.field={all_day:'isAllDay',reminders:'reminderTime'}[cap.field]??cap.field;cap.projection=`Event.${cap.field}`;cap.support='adapter_contract';}
}
