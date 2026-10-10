import {isDeepStrictEqual} from 'node:util';
import {getCapability,schemaFor} from './registry.mjs';
import {resolveArguments} from './resolver.mjs';
import {validateValue} from './providers.mjs';

export const GROUNDING_VERSION='deterministic-grounding-v1';
const idPrefixes={event_id:'ev',calendar_id:'cal',contact_id:'ct',file_id:'file',material_id:'ma',meeting_id:'mt',record_id:'(?:rec|record|invoice)'};
const placeholder=/^(?:null|undefined|none|unknown|current(?:_selected)?(?:_[a-z]+)*_id|selected(?:_[a-z]+)*_id|当前.*|这个.*|那个.*)$/i;
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const span=(text,start,end)=>({start,end,text:text.slice(start,end)});
const evidence=(text,regex,group=0)=>[...text.matchAll(regex)].map(match=>{
 const value=match[group];const start=match.index+match[0].indexOf(value);
 return {value,span:span(text,start,start+value.length),matchStart:match.index};
});
const pathGet=(value,path)=>path.split('.').reduce((item,key)=>item?.[key],value);
const quotedEvidence=text=>evidence(text,/[“"']([^“”"'\r\n]*)[”"']/g,1);
const contained=(item,entries)=>entries.some(x=>item.span.start>=x.span.start&&item.span.end<=x.span.end);
const labelInside=(item,entries)=>entries.some(x=>(item.matchStart??item.span.start)>=x.span.start&&(item.matchStart??item.span.start)<x.span.end);
function pathSet(value,path,item){const parts=path.split('.');let parent=value;for(const key of parts.slice(0,-1))parent=parent[key]??={};if(item===undefined)delete parent[parts.at(-1)];else parent[parts.at(-1)]=structuredClone(item);}
function unique(items){return [...new Map(items.map(x=>[JSON.stringify(x.value),x])).values()];}

/** Lexical evidence, never corpus gold or a second generative extraction. */
export function temporalEvidence(text){
 const day='(?:今天|今日|明天|明日|后天|昨天|(?:下|本|这)?(?:周|星期)[一二三四五六日天]|这周末|本周末|下周末|周末|下周|本周|这周|今早|明早|今晚|明晚)';
 const clock='(?:(?:凌晨|早上|上午|中午|下午|晚上|傍晚)?[\\d零〇一二两三四五六七八九十]+(?:点|时)(?:[\\d零〇一二两三四五六七八九十]+分?)?(?:半|一刻|三刻)?|\\d{1,2}[:：]\\d{2})';
 const iso='\\d{4}-\\d{2}-\\d{2}(?:[Tt]\\d{2}:\\d{2}(?::\\d{2})?(?:Z|[+-]\\d{2}:\\d{2})?)?';
 const chinese='(?:\\d{4}年|当前年|今年|本年)?\\d{1,2}月\\d{1,2}(?:日|号)?';
 const regex=new RegExp(`${iso}(?:至|到|\\/)${iso}|${iso}(?:${clock}|早上|上午|下午|晚上|夜间|白天)?|${chinese}(?:${clock}|早上|上午|下午|晚上|夜间|白天)?|(?:未来|接下来)[\\d一二两三四五六七八九十]+(?:分钟|小时|天)(?:\\s*[，,、]?\\s*(?:每分钟|逐分钟|分钟级|按分钟|每小时|逐小时|小时级|按小时|逐日|每天|按天))?|${day}(?:${clock}|早上|上午|下午|晚上|夜间|白天)?|[\\d一二两三四五六七八九十]+(?:分钟|小时)后|现在|此刻|实时|当前`,'g');
 const literals=quotedEvidence(text);
 return evidence(text,regex).filter(item=>!contained(item,literals)&&!(item.value==='当前'&&/选中|联系人|文件|日程|服务|会议|记录|资料/.test(text.slice(item.span.end,item.span.end+5))));
}

function jsonEvidence(text){
 const found=[];
 for(let start=0;start<text.length;start++)if(text[start]==='{'){
  let depth=0,quoted=false,escaped=false;
  for(let end=start;end<text.length;end++){
   const c=text[end];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
   if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&!--depth){
    try{
     const payload=/(?:正文|内容)(?:原样是|原样为|是|为|[:：])?\s*$/.test(text.slice(Math.max(0,start-18),start));
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
  const quoted=evidence(text,/[“"']((?:file|https?):\/\/[^“”"'\r\n]+)[”"']/g,1);
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
 const grounding={version:GROUNDING_VERSION,scope:'确定性规则只覆盖下列可辨识原文形态；未报告问题不等于已完成全部自然语言语义核验。',checks:[],identity:[],blockers:[],repairs:[],coverage:['结构化字段：契约允许的JSON、字段名赋值、明确引号标题/正文/页面query','地点：已登记地名、地点标签、明确坐标轴','时间：常用日期、日期范围、相对窗口、时刻和精度策略；引号载荷不作时间','目标：明确ID标签、领域ID前缀、文件URI、可信只读选择','服务：已注册服务名；写入路径：明确缺失声明']};
 function check(field,code,severity,message,entry,effectiveValue){
  const item={field,code,severity,original:entry?.value,modelValue:pathGet(args,field),effectiveValue,span:entry?.span??null,message};
  grounding.checks.push(item);if(severity==='repair')grounding.repairs.push(item);if(severity==='block')grounding.blockers.push(item);
 }
 function recover(field,items,kind='lexical'){
  if(kind==='lexical'&&literalFields.has(field))return;
  if(kind==='literal'&&items.length){items=[...(literalFields.get(field)??[]),...items];literalFields.set(field,items);}
  const choices=unique(items);if(choices.length>1){check(field,'ambiguous_explicit_values','block','原文存在多个不同目标值，单个接口无法安全选择。',choices[0]);return;}
  const entry=choices[0];if(!entry)return;
  if(!isDeepStrictEqual(pathGet(groundedArguments,field),entry.value)){
   pathSet(groundedArguments,field,entry.value);check(field,'explicit_evidence_recovered','repair','以用户原文的明确值校对，阻止漏提或改写后使用系统默认值。',entry,entry.value);
  }else check(field,'explicit_evidence_matched','info','模型提取与可核验原文一致。',entry,entry.value);
 }
 const has=name=>Object.hasOwn(capability.inputs,name);
 const literals=jsonEvidence(text);
 for(const [field,definition]of Object.entries(capability.inputs)){
  const rule=schemaFor({inputs:{value:definition}}).properties.value;
  const allowed=items=>items.filter(item=>validateValue(rule,item.value).valid);
  recover(field,allowed(literals.filter(x=>x.role!=='payload'&&Object.hasOwn(x.value,field)).map(x=>({...x,value:x.value[field]}))),'literal');
  if(definition.type==='string'&&!field.endsWith('_id')){
   const assignments=evidence(text,new RegExp(`\\b${escape(field)}\\s*[:：=]\\s*[“"']([^“”"'\\r\\n]+)[”"']`,'gi'),1).filter(x=>!labelInside(x,quotedEvidence(text)));
   const plain=evidence(text,new RegExp(`\\b${escape(field)}\\s*[:：=]\\s*(?![\\s“"'{])([^，；。\\r\\n]+)`,'gi'),1).filter(x=>!labelInside(x,quotedEvidence(text))).map(x=>({...x,value:x.value.trim()}));
   recover(field,allowed([...assignments,...plain]),'literal');
  }
 }
 if(has('parameters')&&capability.inputs.parameters.properties?.query){
  const objects=literals.filter(x=>x.role!=='payload'&&Object.hasOwn(x.value,'query')&&!Object.hasOwn(x.value,'parameters')&&/(?:参数|query)/i.test(text.slice(Math.max(0,x.span.start-8),x.span.start)));
  recover('parameters',objects.filter(x=>validateValue(schemaFor({inputs:{value:capability.inputs.parameters}}).properties.value,x.value).valid),'literal');
  recover('parameters.query',evidence(text,/\bquery\s*(?:原样传|参数是|参数为|[:：=])\s*[“"']([^“”"'\r\n]+)[”"']/gi,1));
  recover('parameters.query',evidence(text,/\bquery\s*[:：=]\s*(?![\s“"'{])([^，；。\r\n]+)/gi,1).map(x=>({...x,value:x.value.trim()})));
 }
 if(has('title')){
  const quoted=evidence(text,/(?:标题(?:改为|是|为)?|(?:创建|新建)(?:一个)?(?:日程)?|(?:新建一个叫))\s*[“"']([^“”"'\r\n]+)[”"']/g,1);
  recover('title',quoted);
 }
 if(has('content'))recover('content',evidence(text,/(?:正文|内容)(?:原样为|原样是|是|为)?\s*[:：]?\s*[“"']([^“”"'\r\n]+)[”"']/g,1));
 if(has('data')&&capability.inputs.data.type==='string'){
  recover('data',literals.filter(x=>/(?:正文|请求正文)(?:原样是|是|为)?\s*$/.test(text.slice(Math.max(0,x.span.start-12),x.span.start))).map(x=>({...x,value:x.span.text})));
 }
 if(capability.domain==='weather'){
  const lat=evidence(text,/(?:纬度|latitude|lat)\s*[:：=]?\s*(-?\d+(?:\.\d+)?)/gi,1).filter(x=>!contained(x,quotedEvidence(text)));
  const lon=evidence(text,/(?:经度|longitude|lon|lng)\s*[:：=]?\s*(-?\d+(?:\.\d+)?)/gi,1).filter(x=>!contained(x,quotedEvidence(text)));
  if(lat.length||lon.length){
   if(lat.length===1&&lon.length===1){
    recover('coordinates',[{value:{latitude:Number(lat[0].value),longitude:Number(lon[0].value)},span:span(text,Math.min(lat[0].span.start,lon[0].span.start),Math.max(lat[0].span.end,lon[0].span.end))}]);
    if(groundedArguments.location!==undefined){delete groundedArguments.location;check('location','coordinate_alternative','repair','明确坐标已确定查询目标，地点字符串无需作为另一个必填目标。',undefined,undefined);}
   }else check('coordinates','incomplete_coordinates','block','坐标轴缺失或存在多个值，需要提供一组明确经纬度。',lat[0]??lon[0]);
  }else if(has('location')){
   const marked=evidence(text,/(?:地点|location)\s*[:：=]\s*[“"']?([^，。；！？“”"'\r\n]+)/gi,1).filter(x=>!labelInside(x,quotedEvidence(text)));
   const cities=Object.keys(context.geocodes??{}).sort((a,b)=>b.length-a.length);
   const known=cities.length?evidence(text,new RegExp(`(?:${cities.map(escape).join('|')})(?:市)?`,'g')).filter(x=>!contained(x,quotedEvidence(text))).map(x=>({...x,value:x.value.replace(/市$/,'')})):[];
   const nearby=evidence(text,/当前位置|此地|附近|这里|当地|本地/g);
   const lead=text.match(/^(?:请问|请(?:帮我)?(?:查询|查看|查|看看)?|帮我(?:查询|查看|看下|看看|查)?|查询|查看|看看|看下|读取|查)?\s*([\p{Script=Han}A-Za-z· ]{2,20}?)(?:现在|此刻|当前|今天|明天|后天)?(?:的)?(?:天气|气温|温度|湿度|气压|风速|降水|能见度)/u);
   const name=lead?.[1]?.trim();
   const named=name&&!/(?:未来|接下来|分钟|小时|这周|本周|下周|明早|今晚|今天|明天|后天|现在|此刻|当前|此地|附近|这里|当地|本地|帮我|看下|看看|读取|查看|查询|实时|早上|上午|下午|夜间|白天|精确)/.test(name)?[{value:name,span:span(text,lead.index+lead[0].indexOf(lead[1]),lead.index+lead[0].indexOf(lead[1])+lead[1].length)}]:[];
   // Labeled locations take precedence; otherwise multiple names block rather than choosing arbitrarily.
   recover('location',marked.length?marked:unique(known).length>1?known:named.length?named:known.length?known:nearby);
   if(!marked.length&&!known.length&&!nearby.length&&args.location===undefined&&/查(?:看)?(.{2,12}?)现在(?:的)?(?:天气|温度|湿度|气温)/.test(text)){
    const match=text.match(/查(?:看)?(.{2,12}?)现在(?:的)?(?:天气|温度|湿度|气温)/);const start=match.index+match[0].indexOf(match[1]);
    recover('location',[{value:match[1],span:span(text,start,start+match[1].length)}]);
   }
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
  const startItems=times.filter(x=>/(?:开始|起)/.test(text.slice(x.span.end,x.span.end+4))||/(?:开始时间|开始(?:时刻)?(?:改为|是|为|[:：])|从)\s*$/.test(text.slice(Math.max(0,x.span.start-14),x.span.start)));
  const endItems=times.filter(x=>/(?:结束|止)/.test(text.slice(x.span.end,x.span.end+4))||/(?:结束时间|结束(?:时刻)?(?:改为|是|为|[:：])|到)\s*$/.test(text.slice(Math.max(0,x.span.start-14),x.span.start)));
  if(has('starts_at'))recover('starts_at',startItems.length?startItems:times.length===1?times:[]);
  if(has('ends_at'))recover('ends_at',endItems);
  if(has('changes')){
   const starts=capability.inputs.changes.properties?.starts_at;
   if(starts&&/开始时间/.test(text)&&times.length===1)recover('changes.starts_at',times);
   else if(starts)recover('changes.starts_at',startItems);
   if(capability.inputs.changes.properties?.ends_at)recover('changes.ends_at',endItems);
  }
 }
 if(capability.domain==='services'&&has('service')){
  const names={天气:'weather',日历:'calendar',通讯录:'contacts',文件:'files',会议资料:'materials'};
  const named=evidence(text,/(天气|日历|通讯录|文件|会议资料)服务/g,1).filter(x=>!contained(x,quotedEvidence(text))).map(x=>({...x,value:names[x.value]}));
  const literal=evidence(text,/\bservice\s*[:：=]\s*["“']?(weather|calendar|contacts|files|materials)\b/gi,1).filter(x=>!labelInside(x,quotedEvidence(text))).map(x=>({...x,value:x.value.toLowerCase()}));
  recover('service',[...named,...literal]);
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
    check(field,'ungrounded_identity',trusted&&selectionReference?'repair':'block',message,undefined,undefined);
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
 return {groundedArguments,grounding};
}

export function finalizePlan({text='',domain,api,extractedArguments={},context={}}){
 const started=performance.now();
 if(domain==='unsupported'||!api)return {domain:'unsupported',api:null,groundedArguments:{},grounding:{version:GROUNDING_VERSION,checks:[],identity:[],blockers:[],repairs:[],coverage:[]},resolved:{arguments:{},sources:{},missing:[],issues:['请求不属于单个已注册业务能力，或包含多个独立动作。'],status:'unsupported'},status:'unsupported',mock:null,deterministicMs:performance.now()-started};
 const capability=getCapability(api);if(!capability||capability.domain!==domain)throw new Error('领域与 API 不一致');
 const {groundedArguments,grounding}=groundArguments(capability,text,extractedArguments,context);
 const resolved=resolveArguments(capability,groundedArguments,context);
 if(grounding.blockers.length){resolved.status='needs_clarification';resolved.issues.push(...grounding.blockers.map(x=>`${x.field}: ${x.message}`));for(const x of grounding.blockers)if(!resolved.missing.includes(x.field))resolved.missing.push(x.field);}
 const status=resolved.status;const effective=getCapability(resolved.resolution?.time?.effective?.api)??capability;
 const mock={executed:false,simulated:status==='ready_mock',api:effective.id,requestedApi:capability.id,requestedProjection:capability.projection??null,arguments:resolved.arguments,projection:effective.projection??null,outputContract:effective.returns??null,value:null,message:status==='ready_mock'?'契约校验完成，已生成模拟回执。业务 API 未接入。':'参数未就绪，需要澄清或补全系统状态。',risk:capability.risk};
 return {domain,api,groundedArguments,grounding,resolved,status,mock,deterministicMs:performance.now()-started};
}
