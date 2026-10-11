import {isDeepStrictEqual} from 'node:util';
import {getCapability,schemaFor} from './registry.mjs';
import {resolveArguments} from './resolver.mjs';
import {validateValue} from './providers.mjs';
import {buildParameterProvenance} from './parameter-provenance.mjs';

export const GROUNDING_VERSION='deterministic-grounding-v2';
const idPrefixes={event_id:'ev',calendar_id:'cal',contact_id:'ct',file_id:'file',material_id:'ma',meeting_id:'mt',record_id:'(?:rec|record|invoice)'};
const placeholder=/^(?:null|undefined|none|unknown|current(?:_selected)?(?:_[a-z]+)*_id|selected(?:_[a-z]+)*_id|当前.*|这个.*|那个.*)$/i;
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const span=(text,start,end)=>({start,end,text:text.slice(start,end)});
const evidence=(text,regex,group=0)=>[...text.matchAll(new RegExp(regex.source,regex.flags.includes('d')?regex.flags:regex.flags+'d'))].map(match=>{
 const value=match[group];const start=match.indices[group][0];
 return {value,span:span(text,start,start+value.length),matchStart:match.index};
});
const pathGet=(value,path)=>path.split('.').reduce((item,key)=>item?.[key],value);
const quotedEvidence=text=>[...text.matchAll(/“([^”]*)”|"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'/gd)].map(match=>{
 const group=[1,2,3].find(index=>match[index]!==undefined),[start,end]=match.indices[group];
 let value=match[group];
 // An ASCII JSON string may encode nested quotes; its exact representation stays in span.
 if(group===2)try{value=JSON.parse(match[0]);}catch{}
 return {value,span:span(text,start,end),matchStart:match.index};
});
function quotedAfter(text,prefix){
 const preceding=new RegExp(`(?:${prefix.source})\\s*$`,prefix.flags.replace(/[gd]/g,''));
 return quotedEvidence(text).flatMap(item=>{
  const match=preceding.exec(text.slice(0,item.matchStart));
  return match?[{...item,matchStart:match.index}]:[];
 });
}
const contained=(item,entries)=>entries.some(x=>item.span.start>=x.span.start&&item.span.end<=x.span.end);
const labelInside=(item,entries)=>entries.some(x=>(item.matchStart??item.span.start)>=x.span.start&&(item.matchStart??item.span.start)<x.span.end);
function pathSet(value,path,item){const parts=path.split('.');let parent=value;for(const key of parts.slice(0,-1))parent=parent[key]??={};if(item===undefined)delete parent[parts.at(-1)];else parent[parts.at(-1)]=structuredClone(item);}
function unique(items){return [...new Map(items.map(x=>[JSON.stringify(x.value),x])).values()];}
function negatedEvidence(text,item){
 const before=text.slice(0,item.span.start),clause=before.slice(Math.max(before.lastIndexOf('，'),before.lastIndexOf(','),before.lastIndexOf('；'),before.lastIndexOf(';'),before.lastIndexOf('。'),before.lastIndexOf('\n'))+1);
 const denial=[...clause.matchAll(/不要|不用|无需|不需要|别(?:查|看|用|读|给)|不(?:查询|查看|读取|查|看)|不是/g)].at(-1);
 if(!denial)return false;
 const replacement=[...clause.matchAll(/而是|改(?:为|成)|换(?:为|成)|只(?:查询|查看|查|看)/g)].at(-1);
 return !replacement||replacement.index<denial.index;
}
function coordinateTupleEvidence(text){
 const entries=[],unclear=[];
 const regex=/(?:坐标|coordinates|纬度经度|经纬度)\s*[:：=]?\s*[（(\[]?\s*(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)(?:\s*[）)\]])?/gdi;
 for(const match of text.matchAll(regex)){
  const start=match.indices[1][0],end=match.indices[2][1],item={span:span(text,start,end),matchStart:match.index};
  if(contained(item,quotedEvidence(text))||negatedEvidence(text,item))continue;
  const a=Number(match[1]),b=Number(match[2]);
  const latFirst={latitude:a,longitude:b},lonFirst={latitude:b,longitude:a};
  const valid=value=>Math.abs(value.latitude)<=90&&Math.abs(value.longitude)<=180;
  const order=/^纬度经度/.test(match[0])?'latitude':/^经纬度/.test(match[0])?'longitude':null;
  const candidates=order?[order==='latitude'?latFirst:lonFirst]:unique([latFirst,lonFirst].filter(valid).map(value=>({value}))).map(x=>x.value);
  if(candidates.length===1&&valid(candidates[0]))entries.push({...item,value:candidates[0]});
  else unclear.push({...item,value:match[0],reason:candidates.length?'坐标元组顺序不能唯一判断，请标注纬度和经度。':'坐标超出经纬度范围。'});
 }
 return {entries,unclear};
}

// These are semantic slot labels, not example answers or a lookup of evaluation cases.
const slotLabels={title:['标题','窗口标题'],content:['正文','内容'],description:['说明','描述'],name:['姓名','联系人姓名'],phone:['电话','电话号码','手机号','手机号码','联系电话','号码'],email:['邮箱','电子邮箱'],organization:['单位','组织','公司'],address:['地址','住址','邮寄地址'],birthday:['生日'],nickname:['昵称'],note:['备注'],website:['网站','主页网址'],keyword:['关键词','关键字'],query:['查询词','搜索词','筛选词'],location:['地点'],cloud_path:['云路径','云端路径','目标路径'],local_path:['本地路径','保存路径','保存位置'],bucket:['存储实例','实例'],function_name:['函数名'],version:['版本'],timeout_ms:['超时'],collection:['表名','集合名'],field_name:['字段名'],zone:['数据库区域','区域'],resource:['注册资源'],mime_type:['MIME类型','MIME'],file_type:['文件类型','类型'],timezone:['时区'],is_all_day:['全天标记'],recurrence:['重复规则'],net_id:['网络ID','网络句柄ID'],stream_type:['音频流类型','流类型'],locale:['语言标记','语言'],country:['国家','国家代码'],max_items:['最大结果数','结果上限']};
const pendingValue=/^(?:还(?:没|未|没有)|尚未|未定|待定|未给|未提供|没(?:给|有|定|提供)|稍后|以后|不填|不限制|什么|多少|哪个|哪些|是否|怎么|当前选|已选|选中的|这个|那个)/;
const spatialTemporalPrefix=/^(?:现在|此刻|当前|今天|今日|明天|明日|后天|昨天|今晚|明早|明晚|(?:上|下|本|这)?(?:周|星期)[一二三四五六日天]?|凌晨|早上|上午|中午|下午|晚上|傍晚|\d{4}[-年]\d{1,2}|\d{1,2}月|\d{1,2}[:：]\d{2}|[\d零〇一二两三四五六七八九十]+(?:点|时))/;
function trimEntry(text,item){
 const leading=item.value.length-item.value.trimStart().length,value=item.value.trim();
 return {...item,value,span:span(text,item.span.start+leading,item.span.start+leading+value.length)};
}
function definitionPaths(inputs,prefix=''){
 return Object.entries(inputs).flatMap(([name,definition])=>{
  const path=prefix?`${prefix}.${name}`:name;
  return [{path,name,definition},...(definition.type==='object'&&definition.properties?definitionPaths(definition.properties,path):[])];
 });
}
function labeledEvidence(text,path,definition,aliases=[],excluded=[]){
 const labels=[path,...aliases].sort((a,b)=>b.length-a.length).map(label=>/^[\w.]+$/.test(label)?`(?<![\\w.])${escape(label)}(?![\\w.])`:escape(label)).join('|');
 const connector='(?:原样(?:传|为|是)|改(?:成|为)|设置为|设为|叫|名为|是|为|[:：=])';
 const quoted=quotedAfter(text,new RegExp(`(?:${labels})\\s*(?:${connector})?`,'i'));
 const arrays=definition.type==='array'?evidence(text,new RegExp(`(?:${labels})\\s*${connector}\\s*(\\[[^\\]\\r\\n]*\\])`,'gi'),1):[];
 const plain=evidence(text,new RegExp(`(?:${labels})\\s*${connector}\\s*(?![\\s“"'{\\[])([^，,；;。！？\\r\\n]+)`,'gi'),1).map(item=>trimEntry(text,item));
 const convert=item=>{
  if(definition.type==='string')return item;
  if(definition.type==='boolean'&&/^(?:true|false)$/i.test(item.value))return {...item,value:item.value.toLowerCase()==='true'};
  if(['integer','number'].includes(definition.type)&&/^-?\d+(?:\.\d+)?(?:毫秒|分钟|秒)?$/.test(item.value))return {...item,value:Number(item.value.replace(/(?:毫秒|分钟|秒)$/,''))*(path.endsWith('timeout_ms')&&/(?<!毫)秒$/.test(item.value)?1000:1)};
  if(definition.type==='array'){
   try{return {...item,value:JSON.parse(item.value)};}catch{}
   if(definition.items?.type==='integer'&&/^-?\d+(?:\s*(?:和|、|,)\s*-?\d+)*$/.test(item.value))return {...item,value:item.value.split(/和|、|,/).map(x=>Number(x.trim()))};
  }
  return {...item,invalidContract:true};
 };
 return [...quoted,...arrays,...plain].filter(item=>!labelInside(item,[...quotedEvidence(text),...excluded])&&!pendingValue.test(item.value)&&!negatedEvidence(text,item)).map(convert);
}

/** Lexical evidence, never corpus gold or a second generative extraction. */
export function temporalEvidence(text){
 const day='(?:今天|今日|明天|明日|后天|昨天|(?:下|本|这)?(?:周|星期)[一二三四五六日天]|这周末|本周末|下周末|周末|下周|本周|这周|今早|明早|今晚|明晚)';
 const clock='(?:(?:凌晨|早上|上午|中午|下午|晚上|傍晚)?[\\d零〇一二两三四五六七八九十]+(?:点|时)(?:[\\d零〇一二两三四五六七八九十]+分?)?(?:半|一刻|三刻)?|\\d{1,2}[:：]\\d{2})';
 const iso='\\d{4}-\\d{2}-\\d{2}(?:[Tt]\\d{2}:\\d{2}(?::\\d{2})?(?:Z|[+-]\\d{2}:\\d{2})?)?';
 const chinese='(?:\\d{4}年|当前年|今年|本年)?\\d{1,2}月\\d{1,2}(?:日|号)?';
 const regex=new RegExp(`${iso}(?:至|到|\\/)${iso}|${iso}(?:${clock}|早上|上午|下午|晚上|夜间|白天)?|${chinese}(?:${clock}|早上|上午|下午|晚上|夜间|白天)?|(?:未来|接下来)[\\d一二两三四五六七八九十]+(?:分钟|小时|天)(?:\\s*[，,、]?\\s*(?:每分钟|逐分钟|分钟级|按分钟|每小时|逐小时|小时级|按小时|逐日|每天|按天))?|${day}(?:${clock}|早上|上午|下午|晚上|夜间|白天)?|[\\d一二两三四五六七八九十]+(?:分钟|小时)后|现在|此刻|实时|当前`,'g');
 const literals=quotedEvidence(text);
 return evidence(text,regex).filter(item=>!contained(item,literals)&&!negatedEvidence(text,item)&&!(item.value==='当前'&&/选中|联系人|文件|日程|服务|会议|记录|资料/.test(text.slice(item.span.end,item.span.end+5))));
}

function jsonEvidence(text){
 const found=[],quotedValues=quotedEvidence(text);
 for(let start=0;start<text.length;start++)if(text[start]==='{'){
  const wrapperPayload=/(?:data\s*[:：=]|(?:正文|内容)(?:原样是|原样为|是|为|[:：])?)\s*[“"']\s*$/.test(text.slice(Math.max(0,start-24),start));
  if(!wrapperPayload&&quotedValues.some(item=>start>=item.span.start&&start<item.span.end))continue;
  let depth=0,quoted=false,escaped=false;
  for(let end=start;end<text.length;end++){
   const c=text[end];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
   if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&!--depth){
    try{
     const payload=wrapperPayload||/(?:正文|内容)(?:原样是|原样为|是|为|[:：])?\s*$/.test(text.slice(Math.max(0,start-18),start));
     found.push({value:JSON.parse(text.slice(start,end+1)),span:span(text,start,end+1),role:payload?'payload':'arguments'});start=end;
    }catch{}
    break;
   }
  }
 }
 return found;
}

function idEvidence(text,field){
 const label=field==='event_id'?'(?:日程|会议|事件)':field==='calendar_id'?'(?:日历账户|日历)':field==='contact_id'?'联系人':field==='file_id'?'(?:文件|文件URI)':field==='material_id'?'(?:会议资料|资料)':field==='meeting_id'?'会议':'记录';
 const marked=new RegExp(`(?:${field}|${label}\\s*ID)\\s*(?:是|为|[:：=])?\\s*["“']?([a-zA-Z0-9_./:+%-]+)`,'gi');
 const prefixed=new RegExp(`(?<![a-zA-Z0-9_])(${idPrefixes[field]}_[a-zA-Z0-9_-]+)`,'g');
 const jsonLiterals=jsonEvidence(text);
 const json=jsonLiterals.filter(x=>x.role!=='payload'&&typeof x.value[field]==='string').map(x=>({...x,value:x.value[field]}));
 const markedItems=evidence(text,marked,1).filter(x=>!contained(x,jsonLiterals)&&!labelInside(x,quotedEvidence(text)));
 const items=[...json,...markedItems,...evidence(text,prefixed,1).filter(x=>x.value!==field&&!contained(x,[...jsonLiterals,...quotedEvidence(text)]))];
 if(field==='file_id'){
  const quoted=quotedEvidence(text).filter(item=>/^(?:file|https?):\/\//.test(item.value));
  items.push(...quoted);
  items.push(...evidence(text,/(?:file|https?):\/\/[^\s，。；！？“”"'<>]+/g).filter(x=>!quoted.some(q=>x.span.start>=q.span.start&&x.span.end<=q.span.end)).map(x=>{
   const value=x.value.replace(/(?:有多少字节|准备预览资源|(?:的)?(?:文件名|文件后缀|MIME类型|最近修改时间|大小|名称)).*$/,'');
   return {...x,value,span:span(text,x.span.start,x.span.start+value.length)};
  }));
 }
 return unique(items).filter(x=>!placeholder.test(x.value));
}

export function groundArguments(capability,text,args={},context={}){
 const groundedArguments=structuredClone(args);
 const literalFields=new Map();
 const verifiedFields=new Set();
 const grounding={version:GROUNDING_VERSION,scope:'确定性规则只覆盖下列可辨识原文形态；未报告问题不等于已完成全部自然语言语义核验。',checks:[],identity:[],blockers:[],repairs:[],coverage:['结构化字段：契约允许的JSON、嵌套字段赋值、中文槽位标签、引号内容，保留原文证据','单服务参数：联系人/文件/日程查询词、创建姓名与标题、显式写值、路径角色、云调用元数据','地点：原文关系中的未登记地名、地点标签、明确坐标轴与可唯一判断顺序的元组；否定目标不生效','时间：常用日期、日期范围、相对窗口、时刻和精度策略；引号载荷不作时间','目标：明确ID标签、领域ID前缀、文件URI、可信只读选择','防猜测：明确未提供的业务参数、无证据可选写值、把输出字段名当查询词；明确但无法核验的坐标/音频场景阻止系统覆盖']};
 function check(field,code,severity,message,entry,effectiveValue){
  const item={field,code,severity,original:entry?.value,modelValue:pathGet(args,field),effectiveValue,span:entry?.span??null,message};
  grounding.checks.push(item);if(severity==='repair')grounding.repairs.push(item);if(severity==='block')grounding.blockers.push(item);
 }
 function recover(field,items,kind='lexical'){
  if(kind==='lexical'&&literalFields.has(field))return;
  if(kind==='literal'&&items.length){items=[...(literalFields.get(field)??[]),...items];literalFields.set(field,items);}
  const choices=unique(items);if(choices.length>1){check(field,'ambiguous_explicit_values','block','原文存在多个不同目标值，单个接口无法安全选择。',choices[0]);return;}
  const entry=choices[0];if(!entry)return;
  verifiedFields.add(field);
  if(!isDeepStrictEqual(pathGet(groundedArguments,field),entry.value)){
   pathSet(groundedArguments,field,entry.value);check(field,'explicit_evidence_recovered','repair','以用户原文的明确值校对，阻止漏提或改写后使用系统默认值。',entry,entry.value);
  }else check(field,'explicit_evidence_matched','info','模型提取与可核验原文一致。',entry,entry.value);
 }
 function recoverTyped(field,items,definition,kind='lexical'){
  const rule=schemaFor({inputs:{value:definition}}).properties.value;
  const valid=[],invalid=[];
  for(const item of items)(!item.invalidContract&&validateValue(rule,item.value).valid?valid:invalid).push(item);
  if(invalid.length){
   verifiedFields.add(field);pathSet(groundedArguments,field,invalid[0].value);
   check(field,'explicit_contract_invalid','block','用户明确给出的参数不符合该接口类型/枚举/范围，不能当成缺省参数。',invalid[0],invalid[0].value);
  }
  recover(field,valid,kind);
 }
 const has=name=>Object.hasOwn(capability.inputs,name);
 const literals=jsonEvidence(text);
 for(const {path:field,name,definition}of definitionPaths(capability.inputs)){
  recoverTyped(field,literals.filter(x=>x.role!=='payload'&&!negatedEvidence(text,x)&&pathGet(x.value,field)!==undefined).map(x=>({...x,value:pathGet(x.value,field)})),definition,'literal');
  if(!Object.hasOwn(idPrefixes,name)&&['string','boolean','integer','number','array'].includes(definition.type)){
   const labeled=labeledEvidence(text,field,definition,slotLabels[name]??[],literals).filter(item=>name!=='data'||!literals.some(x=>x.role==='payload'&&item.span.start>=x.span.start&&item.span.start<x.span.end));
   recoverTyped(field,labeled,definition,'literal');
  }
 }
 if(has('parameters')&&capability.inputs.parameters.properties?.query){
  const objects=literals.filter(x=>x.role!=='payload'&&Object.hasOwn(x.value,'query')&&!Object.hasOwn(x.value,'parameters')&&/(?:参数|query)/i.test(text.slice(Math.max(0,x.span.start-8),x.span.start)));
  recover('parameters',objects.filter(x=>validateValue(schemaFor({inputs:{value:capability.inputs.parameters}}).properties.value,x.value).valid),'literal');
  recover('parameters.query',quotedAfter(text,/\bquery\s*(?:原样传|参数是|参数为|[:：=])/i));
  recover('parameters.query',evidence(text,/\bquery\s*[:：=]\s*(?![\s“"'{])([^，；。\r\n]+)/gi,1).map(x=>({...x,value:x.value.trim()})));
 }
 if(has('title')){
  const quoted=quotedAfter(text,/(?:标题(?:改为|是|为)?|(?:创建|新建)(?:一个)?(?:全天)?(?:日程)?|(?:新建一个叫))/);
  recover('title',quoted);
 }
 if(has('content'))recover('content',quotedAfter(text,/(?:正文|内容)(?:原样为|原样是|是|为)?\s*[:：]?/));
 if(has('data')&&capability.inputs.data.type==='string'){
  recover('data',literals.filter(x=>/(?:data\s*[:：=]|(?:正文|请求正文)(?:原样是|原样为|是|为|[:：])?)\s*[“"']?\s*$/.test(text.slice(Math.max(0,x.span.start-24),x.span.start))).map(x=>({...x,value:x.span.text})));
 }
 const unquoted=(regex,group=1)=>evidence(text,regex,group).filter(item=>!contained(item,[...quotedEvidence(text),...literals])).map(item=>trimEntry(text,item)).filter(item=>item.value&&!pendingValue.test(item.value));
 if(has('keyword')){
  recover('keyword',quotedAfter(text,/(?:关键词|关键字|标题(?:含|包含)|搜索|查找|找)\s*(?:原样(?:是|为)|为|是|[:：])?/));
  recover('keyword',unquoted(/标题(?:含|包含)([^，,；;。！？“”"'\r\n]+?)(?:的)?日程/g));
  if(capability.domain==='files'){
   recover('keyword',quotedAfter(text,/(?:在本地(?:图片|文件)(?:里|中)?(?:搜索|查找|找)|搜索|查找)/));
   recover('keyword',unquoted(/(?:帮我)?(?:找|搜索|查找)(?:名为)?([^，,；;。！？“”"'\r\n]+?)(?:相关的|的)?(?:PDF|docx|xlsx|pptx|纯文本|图片)文件/gi));
  }
 }
 if(capability.domain==='files'&&has('file_type')){
  const types={pdf:'pdf',docx:'docx',xlsx:'xlsx',pptx:'pptx',图片:'image',图像:'image',纯文本:'text',文本:'text'};
  recover('file_type',unquoted(/(PDF|docx|xlsx|pptx|图片|图像|纯文本|文本)(?:文件|中|里)/gi).map(item=>({...item,value:types[item.value.toLowerCase()]})));
  recover('file_type',unquoted(/(?:文件类型|类型)(?:是|为|[:：])?\s*(PDF|docx|xlsx|pptx|image|text)/gi).map(item=>({...item,value:types[item.value.toLowerCase()]??item.value.toLowerCase()})));
 }
 if(capability.domain==='files'&&has('mime_type'))recover('mime_type',unquoted(/(?:MIME(?:类型)?(?:是|为|[:：])?|按)\s*([\w.+-]+\/[\w.+-]+)(?:处理)?/gi));
 if(capability.domain==='contacts'){
  if(has('query')){
   recover('query',unquoted(/(?:通讯录(?:里|中)?(?:查找|找)|(?:查找|搜索)联系人)\s*([^，,；;。！？“”"'\r\n]+)$/g));
   recover('query',quotedAfter(text,/(?:姓名|号码|电话|组织)(?:含|包含)/));
   recover('query',unquoted(/(?:姓名|号码|电话|组织)(?:含|包含)\s*([^，,；;。！？“”"'\r\n]+?)(?:的)?联系人/g));
  }
  if(capability.risk==='write'){
   if(has('name'))recover('name',unquoted(/(?:创建|新增|新建)(?:一个)?联系人\s*([^，,；;。！？“”"'\r\n]+)/g));
   for(const name of ['name','phone','email','organization','address','birthday','nickname','note','website'])if(has(name)){
    const labels=(slotLabels[name]??[]).sort((a,b)=>b.length-a.length).map(escape).join('|');
    recover(name,unquoted(new RegExp(`(?:${labels})\\s*(?:改为|是|为|[:：=])?\\s*([^，,；;。！？“”"'\\r\\n]+)`,'g')));
   }
  }
 }
 if(capability.domain==='weather'){
  const lat=evidence(text,/(?:纬度|latitude|lat)\s*[:：=]?\s*(-?\d+(?:\.\d+)?)/gi,1).filter(x=>!contained(x,quotedEvidence(text))&&!negatedEvidence(text,x));
  const lon=evidence(text,/(?:经度|longitude|lon|lng)\s*[:：=]?\s*(-?\d+(?:\.\d+)?)/gi,1).filter(x=>!contained(x,quotedEvidence(text))&&!negatedEvidence(text,x));
  const tuples=coordinateTupleEvidence(text);
  if(lat.length||lon.length||tuples.entries.length||tuples.unclear.length){
   if(lat.length===1&&lon.length===1){
    recover('coordinates',[{value:{latitude:Number(lat[0].value),longitude:Number(lon[0].value)},span:span(text,Math.min(lat[0].span.start,lon[0].span.start),Math.max(lat[0].span.end,lon[0].span.end))},...tuples.entries]);
    if(groundedArguments.location!==undefined){delete groundedArguments.location;check('location','coordinate_alternative','repair','明确坐标已确定查询目标，地点字符串无需作为另一个必填目标。',undefined,undefined);}
   }else if(!lat.length&&!lon.length&&tuples.entries.length)recover('coordinates',tuples.entries);
   else if(lat.length||lon.length)check('coordinates','incomplete_coordinates','block','坐标轴缺失或存在多个值，需要提供一组明确经纬度。',lat[0]??lon[0]);
   for(const item of tuples.unclear)check('coordinates','ambiguous_coordinate_order','block',item.reason,item);
  }else if(has('location')){
   const marked=evidence(text,/(?:地点|城市|位置|location)\s*(?:[:：=]|是|为|在)\s*[“"']?([^，,。；;！？“”"'\r\n]+)/gi,1).filter(x=>!labelInside(x,quotedEvidence(text))&&!negatedEvidence(text,x));
   const cities=Object.keys(context.geocodes??{}).sort((a,b)=>b.length-a.length);
   const known=cities.length?evidence(text,new RegExp(`(?:${cities.map(escape).join('|')})(?:市)?`,'g')).filter(x=>!contained(x,quotedEvidence(text))&&!negatedEvidence(text,x)).map(x=>({...x,value:x.value.replace(/市$/,'')})):[];
   const nearby=evidence(text,/当前位置|此地|附近|这里|当地|本地/g).filter(x=>!negatedEvidence(text,x));
   const subjectNames=[...(capability.aliases??[]).map(name=>name.split('·').at(-1)),capability.name?.split('·').at(-1),capability.field?.split('.').at(-1),'天气','气温','温度','湿度','气压','风速','降水','能见度','紫外线指数','云量','空气质量','日出','日落'].filter(name=>name&&name!=='*').sort((a,b)=>b.length-a.length).map(escape).join('|');
   const temporalModifiers=temporalEvidence(text).map(item=>escape(item.value)).sort((a,b)=>b.length-a.length);
   const day=`(?:${[...temporalModifiers,'现在','此刻','当前','今天','明天','后天','本周','这周','下周','今晚','明早','明晚'].join('|')})`;
   const action='(?:请問|请问|请(?:帮我)?|帮我|麻烦)?\\s*(?:我想知道|想知道|我想看|想看|想查|能否告诉我|告诉我|查询(?:一下)?|查看(?:一下)?|查(?:一下)?|读取|看看|看一下|看下|看|获取|显示|播报)?\\s*';
   // Relation-based extraction is independent of geocoding fixtures. Dataset/projection
   // words are not place names; only an actual place label may intentionally name them.
   const datasetOnly=/^(?:实况|实时|当前|逐小时|小时级|小时|逐日|每日|每天|日级|分钟级|逐分钟|分钟|预报|预测|天气|气象|数据|信息|指数|最高|最低|最大|最小|平均|变化|趋势|的|\\s)+$/;
   const projectionModifiers='(?:实况|实时|逐小时|小时级|逐日|每日|日级|分钟级|逐分钟|最高|最低|最大|最小|平均|相对)*';
   const named=unquoted(new RegExp(`(?:^|[，,；;。！？\\r\\n]|而是|改查|换成)\\s*(?:${day}\\s*)?${action}(?:${day}\\s*)?(?:在)?([\\p{Script=Han}A-Za-z· -]{2,120}?)(?:\\s*${day})?(?:的)?${projectionModifiers}(?:的)?\\s*(?:${subjectNames})`,'giu')).filter(item=>!negatedEvidence(text,item)&&!datasetOnly.test(item.value)&&!/^(?:包含|包括|我要|我想要|给我|请给|别给|不要给|需要)/.test(item.value)&&!/(?:未来|接下来|分钟|小时|这周|本周|下周|明早|今晚|今天|明天|后天|现在|此刻|当前|此地|附近|这里|当地|本地|帮我|看下|看看|读取|查看|查询|实时|早上|上午|下午|夜间|白天|精确|不要|不用|无需)/.test(item.value));
   // Quoted names must relate to the requested weather field, not a quoted annotation.
   const placePrefix=new RegExp(`(?:^|[，,；;。！？\\r\\n]|而是|改查|换成)\\s*(?:${day}\\s*)?${action}(?:${day}\\s*)?(?:在)?\\s*$`,'iu');
   const placeSuffix=new RegExp(`^\\s*(?:${day})?(?:的)?${projectionModifiers}(?:的)?\\s*(?:${subjectNames})`,'iu');
   const quotedPlaces=quotedEvidence(text).filter(item=>placePrefix.test(text.slice(0,item.matchStart))&&placeSuffix.test(text.slice(item.span.end+1))&&!negatedEvidence(text,item));
   // A postposed place needs an explicit relation ('in/located at'), not any trailing noun.
   const postposed=unquoted(new RegExp(`(?:^|[，,；;。！？\\r\\n]|(?:${subjectNames})\\s*)(?:${day}\\s*)?(?:在|位于)\\s*([\\p{Script=Han}A-Za-z· -]{2,120}?)(?:\\s*${day})?(?:的)?(?:${projectionModifiers}(?:的)?(?:${subjectNames}))?(?:是多少|多少|如何|怎样|怎么样|呢|吗)?(?=$|[，,；;。！？\\r\\n])`,'giu')).filter(item=>!negatedEvidence(text,item)&&!datasetOnly.test(item.value)&&!spatialTemporalPrefix.test(item.value));
   const relatedPlaces=[...named,...quotedPlaces,...postposed];
   // Labeled locations take precedence; otherwise multiple names block rather than choosing arbitrarily.
   const places=marked.length?marked:unique(known).length>1?known:relatedPlaces.length?relatedPlaces:known.length?known:nearby;
   const splitPlaces=places.flatMap(item=>{
    if(!/^.{2,}(?:和|与|及|、).{2,}$/.test(item.value))return [item];
    let offset=0;return item.value.split(/和|与|及|、/).map(value=>{const start=item.span.start+offset;offset+=value.length+1;return {value,span:span(text,start,start+value.length)};}).filter(item=>item.value.length>1);
   });
   recover('location',splitPlaces);
  }
  if(has('strict_time')){
   const forbid=evidence(text,/不允许降(?:低)?精度|不(?:能|可|要)降精度|必须按分钟准确返回|严格时间/g).filter(x=>!contained(x,quotedEvidence(text)));
   const allow=evidence(text,/可以降(?:低)?精度|允许降(?:低)?精度|允许降级/g).filter(x=>!contained(x,quotedEvidence(text))&&!forbid.some(f=>x.span.start>=f.span.start&&x.span.end<=f.span.end));
   if(forbid.length&&allow.length)check('strict_time','conflicting_precision_policy','block','原文同时要求允许和禁止降精度，需明确策略。',forbid[0]);
   else if(forbid.length||allow.length)recover('strict_time',[{...(forbid[0]??allow[0]),value:!!forbid.length}]);
  }
 }
 const times=temporalEvidence(text);
 if(has('time_ref')){
  const explicitlyLabeled=times.filter(x=>/(?:时间(?:范围)?|time_ref)\s*(?:为|是|[:：=])\s*$/.test(text.slice(Math.max(0,x.span.start-14),x.span.start)));
  const filtered=capability.domain==='weather'&&capability.object==='city'?[]:explicitlyLabeled.length?explicitlyLabeled:times;
  const timeItems=filtered.map(item=>{
   // A daily object's dedicated daytime/overnight field already expresses this period.
   if(capability.object==='daily'&&(/daytimeForecast/.test(capability.field)&&/白天$/.test(item.value)||/overnightForecast/.test(capability.field)&&/夜间$/.test(item.value)))return {...item,value:item.value.replace(/(?:白天|夜间)$/,'')};
   return item;
  });
  recover('time_ref',timeItems);
 }
 if(capability.domain==='calendar'&&(has('starts_at')||has('changes'))){
  const calendarTimes=times.flatMap(item=>{
   const pair=item.value.match(/^(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?)(?:至|到|\/)(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?)$/i);
   return pair?[{value:pair[1],span:span(text,item.span.start,item.span.start+pair[1].length),timeRole:'start'},{value:pair[2],span:span(text,item.span.end-pair[2].length,item.span.end),timeRole:'end'}]:[item];
  });
  const startItems=calendarTimes.filter(x=>x.timeRole==='start'||/(?:开始|起)/.test(text.slice(x.span.end,x.span.end+4))||/(?:开始时间(?:改为|是|为|[:：])?|开始(?:时刻)?(?:改为|是|为|[:：])|从)\s*$/.test(text.slice(Math.max(0,x.span.start-14),x.span.start)));
  const endItems=calendarTimes.filter(x=>x.timeRole==='end'||/(?:结束|止)/.test(text.slice(x.span.end,x.span.end+4))||/(?:结束时间(?:改为|是|为|[:：])?|结束(?:时刻)?(?:改为|是|为|[:：])|到)\s*$/.test(text.slice(Math.max(0,x.span.start-14),x.span.start)));
  if(has('starts_at'))recover('starts_at',startItems.length?startItems:calendarTimes.length===1?calendarTimes:[]);
  if(has('ends_at'))recover('ends_at',endItems);
  if(has('changes')){
   const starts=capability.inputs.changes.properties?.starts_at;
   if(starts&&/开始时间/.test(text)&&times.length===1)recover('changes.starts_at',times);
   else if(starts)recover('changes.starts_at',startItems);
   if(capability.inputs.changes.properties?.ends_at)recover('changes.ends_at',endItems);
  }
 }
 if(capability.domain==='calendar'&&capability.risk==='write'){
  const base=has('changes')?'changes.':'';
  const input=base?capability.inputs.changes.properties:capability.inputs;
  const target=name=>`${base}${name}`;
  if(input.duration_minutes)recover(target('duration_minutes'),unquoted(/(?:持续|时长(?:为|是|[:：])?)\s*(\d+)\s*分钟/g).map(item=>({...item,value:Number(item.value)})));
  if(input.reminder_minutes){
   recover(target('reminder_minutes'),unquoted(/提前\s*(\d+)\s*分钟(?:提醒)?/g).map(item=>({...item,value:Number(item.value)})));
   recover(target('reminder_minutes'),evidence(text,/开始时提醒/g).filter(item=>!contained(item,quotedEvidence(text))).map(item=>({...item,value:0})));
  }
  if(input.location)recover(target('location'),unquoted(/(?:地点|位置)(?:改为|是|为|[:：])?\s*([^，,；;。！？“”"'\r\n]+)/g));
  if(input.is_all_day)recover(target('is_all_day'),evidence(text,/(?:创建|新建)(?:一个)?(全天)日程/g,1).map(item=>({...item,value:true})));
  if(input.recurrence)recover(target('recurrence'),unquoted(/(每(?:周|星期)[一二三四五六日天]|每天|每月\d+(?:日|号)|每年\d+月\d+(?:日|号))重复/g));
  if(input.attendees)recover(target('attendees'),unquoted(/(?:参会人|参与人|与会者)(?:是|为|[:：])?\s*([^，,；;。！？“”"'\r\n]+)/g).map(item=>({...item,value:item.value.split(/和|、/).map(x=>x.trim()).filter(Boolean)})));
 }
 if(capability.risk==='write'&&has('value')){
  const member=capability.id.split('.').at(-1),key={all_day:'is_all_day',reminders:'reminders'}[member]??member;
  recoverTyped('value',labeledEvidence(text,'value',capability.inputs.value,slotLabels[key]??(key==='reminders'?['提醒提前分钟数','提醒分钟数']:[]),literals),capability.inputs.value);
  if(capability.inputs.value.type==='array'&&key==='reminders')recover('value',unquoted(/提醒(?:提前)?分钟数(?:为|是|[:：])\s*(\d+(?:\s*(?:和|、|,)\s*\d+)*)/g).map(item=>({...item,value:item.value.split(/和|、|,/).map(x=>Number(x.trim()))})));
 }
 if(capability.domain==='cloud'){
  if(has('cloud_path'))recover('cloud_path',unquoted(/(?:云文件|到云端|云端路径(?:是|为|[:：])?)\s*((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+)/g));
  if(has('local_path'))recover('local_path',unquoted(/((?:[A-Za-z]:[\\/]|file:\/\/\/)[^，,；;。！？\s“”"'\r\n]+?)(?=上传|到云端|，|,|；|;|\s|$)/g));
  if(has('bucket'))recover('bucket',unquoted(/(?:存储实例|实例)(?:是|为|[:：])?\s*([A-Za-z0-9_.-]+)/g));
  if(has('function_name'))recover('function_name',unquoted(/(?:调用云函数|函数名(?:是|为|[:：])?)\s*([A-Za-z_$][A-Za-z0-9_$.-]*)/g));
  if(has('version'))recover('version',unquoted(/版本(?:是|为|[:：])?\s*([A-Za-z0-9_$.-]+)/g));
  if(has('timeout_ms'))recover('timeout_ms',unquoted(/超时(?:是|为|[:：])?\s*(\d+)毫秒/g).map(item=>({...item,value:Number(item.value)})));
  if(has('collection'))recover('collection',unquoted(/云数据库\s*([A-Za-z_][A-Za-z0-9_]*)表/g));
  if(has('field_name'))recover('field_name',unquoted(/(?:的)?([A-Za-z_][A-Za-z0-9_]*)字段/g));
  if(has('zone'))recover('zone',unquoted(/(?:数据库区域|区域)(?:是|为|[:：])?\s*([A-Za-z0-9_.-]+)/g));
  if(has('operation')){
   const operations={计数:'count',求和:'sum',平均值:'average',最大值:'maximum',最小值:'minimum'};
   recover('operation',unquoted(/(计数|求和|平均值|最大值|最小值)/g).map(item=>({...item,value:operations[item.value]})));
  }
  if(has('resource'))recover('resource',unquoted(/注册资源\s*([A-Za-z0-9_.-]+)/g));
  if(has('mode')){
   const modes={安装:'install',周期:'periodic',跳链:'link'};
   recover('mode',unquoted(/(安装|周期|跳链)预加载/g).map(item=>({...item,value:modes[item.value]})));
  }
  if(has('link'))recover('link',unquoted(/链接(?:是|为|[:：])\s*([A-Za-z][A-Za-z0-9+.-]*:\/\/[^，,；;。！？\s“”"'\r\n]+)/g));
 }
 if(capability.domain==='services'&&has('service')){
  const names={天气:'weather',日历:'calendar',通讯录:'contacts',文件:'files',会议资料:'materials'};
  const named=evidence(text,/(天气|日历|通讯录|文件|会议资料)(?:服务|页面|页)/g,1).filter(x=>!contained(x,quotedEvidence(text))).map(x=>({...x,value:names[x.value]}));
  const literal=evidence(text,/\bservice\s*[:：=]\s*["“']?(weather|calendar|contacts|files|materials)\b/gi,1).filter(x=>!labelInside(x,quotedEvidence(text))).map(x=>({...x,value:x.value.toLowerCase()}));
  recover('service',[...named,...literal]);
 }
 if(capability.domain==='services'&&has('url'))recover('url',quotedEvidence(text).filter(item=>/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(item.value)).concat(unquoted(/([A-Za-z][A-Za-z0-9+.-]*:\/\/[^，,；;。！？\s“”"'\r\n]+)/g)));
 if(capability.domain==='location'&&has('address')){
  recover('address',quotedAfter(text,/(?:地址|地理编码|坐标(?:是|为)?|查(?:询)?(?:一下)?(?:地址)?|把|将)\s*(?:是|为|[:：])?/));
  recover('address',unquoted(/(?:查询|查找|查|获取|读取)\s*([^，,；;。！？“”"'\r\n]+?)的(?:经纬度|坐标)/g));
 }
 if(capability.domain==='location'&&has('coordinates')){
  const lat=unquoted(/(?:纬度|latitude|lat)\s*[:：=]?\s*(-?\d+(?:\.\d+)?)/gi).filter(item=>!negatedEvidence(text,item)),lon=unquoted(/(?:经度|longitude|lon|lng)\s*[:：=]?\s*(-?\d+(?:\.\d+)?)/gi).filter(item=>!negatedEvidence(text,item));
  const tuples=coordinateTupleEvidence(text);
  if(lat.length===1&&lon.length===1)recover('coordinates',[{value:{latitude:Number(lat[0].value),longitude:Number(lon[0].value)},span:span(text,Math.min(lat[0].span.start,lon[0].span.start),Math.max(lat[0].span.end,lon[0].span.end))},...tuples.entries]);
  else if(!lat.length&&!lon.length&&tuples.entries.length)recover('coordinates',tuples.entries);
  else if(lat.length||lon.length)check('coordinates','incomplete_coordinates','block','用户提到坐标但未给出一组明确的经纬度，不能改用当前设备位置。',lat[0]??lon[0]);
  for(const item of tuples.unclear)check('coordinates','ambiguous_coordinate_order','block',item.reason,item);
 }
 if(capability.domain==='media'&&has('stream_type')){
  const streams={音乐:'MUSIC',媒体:'MUSIC',闹钟:'ALARM',语音通话:'VOICE_COMMUNICATION',通话:'VOICE_COMMUNICATION',语音助手:'VOICE_ASSISTANT',助手:'VOICE_ASSISTANT',铃声:'RINGTONE',通知:'NOTIFICATION',电影:'MOVIE',游戏:'GAME',有声书:'AUDIOBOOK'};
  // The selected audio API supplies the relation; intervening time modifiers do not erase a named stream.
  const streamNames=Object.keys(streams).sort((a,b)=>b.length-a.length).map(escape).join('|');
  const named=unquoted(new RegExp(`(${streamNames})`,'g')).filter(item=>!negatedEvidence(text,item)).map(item=>({...item,value:streams[item.value]}));
  const native=unquoted(new RegExp(`(?<![A-Za-z_])(${capability.inputs.stream_type.enum.map(escape).join('|')})(?![A-Za-z_])`,'g')).filter(item=>!negatedEvidence(text,item));
  recover('stream_type',[...named,...native]);
  if(!verifiedFields.has('stream_type')){
   const scenarios=unquoted(/(?:^|[，,；;。！？\r\n])\s*(?:请(?:帮我)?|帮我)?\s*(?:查(?:询|看)?(?:一下)?|读取|看(?:一下)?|获取)?\s*(.{1,24}?)(?:的)?(?:音量|声音大小|静音)/g).filter(item=>!negatedEvidence(text,item));
   const unresolved=scenarios.filter(item=>!/^(?:现在|当前|此刻|最小|最大|最低|最高|本机|系统|这台手机|手机|我的手机|我|默认|播放|正在播放|我正在播放|音频|的|\s)+$/.test(item.value));
   if(unresolved.length)check('stream_type','unresolved_explicit_stream','block','用户指定了音频场景，但不能核验为当前契约音频流，不能用本机当前流替代。',unresolved[0]);
  }
 }
 if(capability.domain==='connectivity'&&has('net_id'))recover('net_id',unquoted(/(?:网络ID|网络句柄ID)\s*(?:是|为|[:：=])?\s*(\d+)/gi).map(item=>({...item,value:Number(item.value)})));
 if(has('coordinates')&&!verifiedFields.has('coordinates')&&!grounding.blockers.some(item=>item.field==='coordinates')){
  const explicit=unquoted(/(?:坐标|coordinates)\s*[:：=]?\s*[（(\[]?\s*-?\d|(?:这组|那组|给定|指定|提供的)坐标/gi,0).filter(item=>!negatedEvidence(text,item));
  if(explicit.length)check('coordinates','unresolved_explicit_coordinates','block','原文已经指定坐标，但当前规则无法完整核验，不能补成本机当前位置。',explicit[0]);
 }
 if(capability.domain==='contacts'&&has('query')&&!idEvidence(text,'contact_id').length){
  const names=evidence(text,/(?:联系人|通讯录(?:里|中)?(?:查找|找))([\p{Script=Han}A-Za-z·]{2,12}?)(?:的|完整|关联人|电话|邮箱|号码|住址|单位|备注)/gu,1).filter(x=>!/(?:当前|选中|这个|那个|完整|电话|邮箱|号码|详细|姓名|信息)/.test(x.value)&&!/(?:当前(?:已)?选中|已选中|选中|这个|那个)\s*$/.test(text.slice(Math.max(0,x.matchStart-12),x.matchStart)));
  recover('query',names);
  if(groundedArguments.contact_id!==undefined&&names.length===1){
   const value=groundedArguments.contact_id;delete groundedArguments.contact_id;
   check('contact_id','name_query_alternative','repair','原文给的是联系人名称查询，不能混入模型猜测ID或当前选择的另一联系人。',names[0],undefined);
   grounding.identity.push({field:'contact_id',value,status:'rejected',existenceVerified:false,source:'model',message:'已去除该ID，使用原文明确名称作为候选查询；查询不假定唯一联系人。'});
  }
 }
 for(const [field,definition] of Object.entries(capability.inputs))if(Object.hasOwn(idPrefixes,field)){
  const candidates=idEvidence(text,field);recover(field,candidates);
  let value=groundedArguments[field];let status='unverified';let source='model';let message='尚未核验真实对象存在性，需要接入对应SDK查询。';
  const selected=context.objects?.[definition.contextKey??field];
  const trusted=capability.risk==='read'&&selected?.trusted===true&&selected.source==='user_selection';
  const selectionReference=/(?:当前|已选|选中|这个|那个|这份|那份|那个人|那位)/.test(text);
  const exact=candidates.find(x=>x.value===value);
  if(exact){status='explicit';source='user';message='ID/URI与明确原文对应；格式和原文核验不证明真实对象存在。';}
  else if(value!==undefined){
   if(trusted&&value===selected.value&&!placeholder.test(String(value))){status='selected';source='user_selection';message='只读目标来自可信用户选择；真实对象存在性仍未接SDK核验。';}
   else{
    delete groundedArguments[field];status='rejected';
    message=placeholder.test(String(value))?'占位符不能当成真实目标ID。':'名称、标题或未对应明确ID证据的值不能当成目标ID。';
    const optionalMetadata=!definition.required&&!definition.resolver;
    check(field,'ungrounded_identity',optionalMetadata||trusted&&selectionReference?'repair':'block',message,undefined,undefined);
   }
  }
  if(groundedArguments[field]===undefined&&trusted){value=selected.value;status='selected';source='user_selection';message='缺省只读目标使用可信用户选择；未证明SDK对象存在。';}
  const directory=context.identityDirectory?.[field];
  if(directory?.source==='fixture'&&directory.complete===true&&Array.isArray(directory.ids)&&value!==undefined&&!directory.ids.includes(value)){
   status='rejected';message='目标ID不在当前完整实验目录中，夹具报告该目标不存在；这不是SDK验证。';
   check(field,'identity_fixture_not_found','block',message,undefined,undefined);
  }
  if(value!==undefined||status==='rejected')grounding.identity.push({field,value,status,existenceVerified:false,source,message});
 }
 if(has('local_path')&&args.local_path!==undefined&&/(?:保存位置(?:我)?(?:没给|未给|未提供)|本地(?:文件|路径|目标).{0,4}(?:未选|没给|未给|未提供|还未|还没))/.test(text)){
  delete groundedArguments.local_path;check('local_path','explicitly_missing_path','block','原文明确未提供本地目标路径，不能使用模型猜测的目录。',undefined,undefined);
 }
 function remove(field,code,message,entry){
  if(pathGet(groundedArguments,field)===undefined)return;
  pathSet(groundedArguments,field,undefined);check(field,code,'repair',message,entry,undefined);
 }
 // Explicit absence is evidence, too. It cannot be replaced with a model's business default.
 const missingWords='(?:还(?:没|未|没有)(?:有|给|定|选|提供|确定|想好)?|尚未(?:决定|确定|提供)?|未(?:定|给|选|提供|确定)|待定|没(?:给|有|定|提供|指定|确定|想好)|稍后(?:再说|提供)|以后再定)';
 for(const {path:field,name}of definitionPaths(capability.inputs)){
  if(name.endsWith('_id'))continue;
  const labels=[field,...(slotLabels[name]??[]),...(name==='data'?['请求正文']:[]),...(name==='query'?['筛选条件']:[])].map(escape).join('|');
  const absent=evidence(text,new RegExp(`(?:${labels})(?:我)?\\s*${missingWords}|(?:没有提供|不填|不提供)\\s*(?:${labels})`,'g')).filter(item=>!contained(item,[...quotedEvidence(text),...literals]));
  if(absent.length){
   if(verifiedFields.has(field)&&!pendingValue.test(String(pathGet(groundedArguments,field)))){
    // A genuine provided value alongside an explicit denial is not silently resolved.
    const actual=pathGet(groundedArguments,field);if(typeof actual==='string'&&absent.some(item=>item.span.text.includes(actual)))remove(field,'explicitly_missing_parameter','用户明确尚未给出该业务参数，移除模型填充的占位文字。',absent[0]);
    else if(pathGet(groundedArguments,field)!==undefined)check(field,'conflicting_explicit_parameter','block','原文同时提供参数并声明参数未提供，需用户明确。',absent[0]);
   }else remove(field,'explicitly_missing_parameter','用户明确未提供该业务参数，不能用模型猜测值代替。',absent[0]);
  }
 }
 const strictOptional=capability.domain==='calendar'&&capability.risk==='write'?['ends_at','duration_minutes','reminder_minutes','description','is_all_day','recurrence','attendees']:
  capability.domain==='contacts'&&capability.risk==='write'?[...(capability.inputs.name&&!capability.inputs.name.required?['name']:[]),'phone','email','organization','address','birthday','nickname','note','website']:
  capability.domain==='cloud'?['bucket','version','timeout_ms','zone']:capability.domain==='files'?['file_type']:[];
 for(const name of strictOptional){
  const field=has('changes')&&capability.inputs.changes.properties?.[name]?`changes.${name}`:name;
  if(!verifiedFields.has(field))remove(field,'unmentioned_business_parameter','原文没有可核验的该槽位值，移除模型自行补出的业务参数。');
 }
 // Explicit optional SDK options may use a natural relation rather than assignment syntax.
 if(capability.domain==='location'){
  if(has('max_items'))recoverTyped('max_items',unquoted(/(?:最多|至多)(?:返回)?\s*(-?\d+)\s*(?:条|个)(?:结果|地址)?/g).filter(item=>!negatedEvidence(text,item)).map(item=>({...item,value:Number(item.value)})),capability.inputs.max_items);
  if(has('locale'))recoverTyped('locale',unquoted(/(?:结果)?(?:用|使用|采用)\s*([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*)\s*语言/gi).filter(item=>!negatedEvidence(text,item)),capability.inputs.locale);
 }
 // Final guard: input role, not model plausibility, decides whether a value is allowed.
 // A system timezone can fill a missing create slot; an update timezone is a business
 // change and must never be supplied implicitly. SDK metadata likewise stays absent.
 const guardedFields=definitionPaths(capability.inputs).filter(({name,definition})=>
  name==='timezone'&&(definition.resolver==='system_timezone'||capability.domain==='calendar'&&capability.risk==='write')||
  capability.domain==='location'&&['locale','country','max_items'].includes(name)||
  capability.domain==='calendar'&&capability.risk==='write'&&name==='starts_at'&&definition.required
 );
 for(const {path:field,name,definition}of guardedFields)if(!verifiedFields.has(field)){
  const isEnvironment=definition.resolver==='system_timezone';
  remove(field,isEnvironment?'unmentioned_system_parameter':'unmentioned_business_parameter',
   isEnvironment?'用户未提供可核验时区，移除模型猜测值，按契约获取系统时区。':
    name==='starts_at'?'必需的业务开始时间没有可核验原文，不能采用模型猜测或系统当前时间。':
    '用户未提供可核验的该槽位值，移除模型默认；业务写值不自动补全，SDK可选项按声明契约处理。');
 }
 // MIME derivation is safe only after the target URI/selection has been grounded.
 if(capability.domain==='files'&&capability.inputs.mime_type?.resolver==='mime_from_uri'&&!verifiedFields.has('mime_type')&&
  grounding.identity.some(item=>item.field==='file_id'&&['explicit','selected'].includes(item.status))){
  remove('mime_type','unmentioned_derived_parameter','用户未提供MIME类型，移除模型猜测，保留已核验文件目标交由URI/SDK推导。');
 }
 for(const [field,identity]of [['keyword','event_id'],['query','contact_id']])if(has(field)&&!verifiedFields.has(field)&&pathGet(groundedArguments,field)!==undefined){
  const value=String(pathGet(groundedArguments,field));
  const selectedReference=/(?:当前|已选|选中|这个|那个)/.test(text);
  const candidateLiteral=typeof pathGet(groundedArguments,field)==='string'&&text.includes(value);
  if((idEvidence(text,identity).length||selectedReference)&&!/(?:关键词|查询词|搜索词|标题含|号码含|组织含|keyword\s*[:：=]|query\s*[:：=])/.test(text)||!candidateLiteral||temporalEvidence(value).some(item=>item.span.start===0&&item.span.end===value.length))remove(field,'output_label_not_query','目标已由ID/明确选择指代，输出字段或日期不能自动成为搜索条件。');
 }
 for(const name of ['service','url','cloud_path','resource','zone'])if(has(name)&&!verifiedFields.has(name)&&groundedArguments[name]!==undefined){
  const value=groundedArguments[name],selected=context.objects?.[capability.inputs[name].contextKey??name];
  const trusted=capability.risk==='read'&&selected?.trusted===true&&selected.source==='user_selection'&&isDeepStrictEqual(value,selected.value);
  let literal=typeof value==='string'&&text.includes(value)&&!placeholder.test(value)&&!/(?:当前|已选|选中|这个|那个|未定|还没|未给)/.test(value);
  if(name==='url')literal=literal&&/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
  if(name==='cloud_path'&&literal){
   const localSpans=grounding.checks.filter(item=>item.field==='local_path'&&item.span).map(item=>item.span);
   const occurrences=evidence(text,new RegExp(escape(value),'g'));
   if(localSpans.length&&occurrences.every(item=>localSpans.some(source=>item.span.start>=source.start&&item.span.end<=source.end)))literal=false;
  }
  if(!trusted&&!literal)remove(name,'ungrounded_business_target','目标值无法对应原文或可信用户选择，移除猜测值后再按契约补全/澄清。');
 }
 for(const name of ['time_ref','stream_type','net_id','coordinates',...(capability.domain==='weather'?['location','strict_time']:[])])if(has(name)&&!verifiedFields.has(name)&&groundedArguments[name]!==undefined){
  const value=groundedArguments[name];
  const explicitlyLocated=typeof value==='string'&&value&&!placeholder.test(value)&&unquoted(new RegExp(escape(value),'g'),0).length>0;
  if(!explicitlyLocated)remove(name,'unmentioned_system_parameter','用户未提供该环境参数，移除模型猜测值，由系统能力按契约获取当前本机值。');
 }
 // Missing model location is not proof that the user requested the local device.
 // An unresolved spatial relation blocks fallback; it never invents a city name.
 if(capability.domain==='weather'&&has('location')&&!verifiedFields.has('location')&&!verifiedFields.has('coordinates')){
  const spatial=evidence(text,/(?:我(?:们)?(?:现在|目前|正在|正|将|打算|准备|计划|要)?(?:在|位于|身处|前往|去|到)|位于|身处|前往|去往|到达|(?:^|[，,；;。！？\r\n])\s*去)/g).filter(item=>{
   if(contained(item,[...quotedEvidence(text),...literals])||negatedEvidence(text,item))return false;
   const before=text.slice(0,item.span.start);
   if(/(?:不|没|未|并非|不是)(?:曾|曾经|正|正在|目前)?\s*$/.test(before))return false;
   const target=text.slice(item.span.end).split(/[，,；;。！？\r\n]/,1)[0].trim().replace(/^[“"'（(\[]\s*/,'');
   return target&&!spatialTemporalPrefix.test(target)&&!/^(?:这里|此地|附近|当地|本地|当前位置|现在的位置)/.test(target)&&
    !/^(?:查询|查看|查|看看|看|获取|读取|显示|播报)(?:一下|下|一眼|天气|气温|温度|湿度|气压|风速|降水|能见度|紫外线|实况|当前)/.test(target);
  });
  if(spatial.length)check('location','unresolved_spatial_reference','block','原文存在尚未核验的空间目标，请明确地点或完整坐标；不能把模型漏填当作用户未说而获取当前位置。',spatial[0]);
 }
 if(has('value')&&!verifiedFields.has('value')){
  const key=capability.id.split('.').at(-1),labels=slotLabels[key]??(key==='description'?['内容','说明']:[]);
  const missing=labels.length&&new RegExp(`(?:${labels.map(escape).join('|')}).{0,5}${missingWords}`).test(text);
  if(missing)remove('value','explicitly_missing_parameter','写入值尚未给出，不能把接口描述当作新值。');
 }
 if(groundedArguments.changes&&Object.keys(groundedArguments.changes).length===0)delete groundedArguments.changes;
 return {groundedArguments,grounding};
}

export function finalizePlan({text='',domain,api,extractedArguments={},context={},systemRequests=[]}){
 const started=performance.now();
 if(domain==='unsupported'||!api)return {domain:'unsupported',api:null,groundedArguments:{},grounding:{version:GROUNDING_VERSION,checks:[],identity:[],blockers:[],repairs:[],coverage:[]},resolved:{arguments:{},sources:{},missing:[],issues:['请求不属于单个已注册业务能力，或包含多个独立动作。'],status:'unsupported'},status:'unsupported',mock:null,deterministicMs:performance.now()-started};
 const capability=getCapability(api);if(!capability||capability.domain!==domain)throw new Error('领域与 API 不一致');
 const {groundedArguments,grounding}=groundArguments(capability,text,extractedArguments,context);
 const resolved=resolveArguments(capability,groundedArguments,context,{blockedFields:grounding.blockers.map(item=>item.field)});
 if(grounding.blockers.length){resolved.status='needs_clarification';resolved.issues.push(...grounding.blockers.map(x=>`${x.field}: ${x.message}`));for(const x of grounding.blockers)if(!resolved.missing.includes(x.field))resolved.missing.push(x.field);}
 resolved.provenance=buildParameterProvenance({capability,text,groundedArguments,grounding,resolved,context,systemRequests});
 const status=resolved.status;const effective=getCapability(resolved.resolution?.time?.effective?.api)??capability;
 const mock={executed:false,simulated:status==='ready_mock',api:effective.id,requestedApi:capability.id,requestedProjection:capability.projection??null,arguments:resolved.arguments,projection:effective.projection??null,outputContract:effective.returns??null,value:null,message:status==='ready_mock'?'契约校验完成，已生成模拟回执。业务 API 未接入。':'参数未就绪，需要澄清或补全系统状态。',risk:capability.risk};
 return {domain,api,groundedArguments,grounding,resolved,status,mock,deterministicMs:performance.now()-started};
}
