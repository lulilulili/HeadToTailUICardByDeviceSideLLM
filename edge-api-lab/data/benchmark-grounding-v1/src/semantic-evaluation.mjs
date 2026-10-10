import {isDeepStrictEqual} from 'node:util';
import {getCapability} from './registry.mjs';
import * as resolver from './resolver.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>structuredClone(value);
const point=value=>value&&Number.isFinite(value.latitude)&&Number.isFinite(value.longitude)?{latitude:value.latitude,longitude:value.longitude}:null;
const annotated=(expected,actual)=>Array.isArray(expected)?Array.isArray(actual)&&expected.length===actual.length&&expected.every((item,index)=>annotated(item,actual[index])):object(expected)?object(actual)&&Object.entries(expected).every(([key,value])=>annotated(value,actual[key])):isDeepStrictEqual(expected,actual);

function temporal(path,value,context,capability,inheritedDay){
 return resolver.normalizeTemporalValue(path,value,{...context,capability,...(inheritedDay?{inheritedDay}:{})});
}
function canonicalArguments(capability,resolved,context){
 const walk=(value,fields,path='',parent={})=>{
  if(!object(value))return clone(value);
  const out={};
  for(const [key,child]of Object.entries(value)){
   const name=path?`${path}.${key}`:key,field=fields?.[key];
   if(['relative_time','datetime'].includes(field?.resolver))out[key]=temporal(name,child,context,capability,parent.starts_at?.slice?.(0,10))??{unparsed:clone(child)};
   else if(field?.type==='object'&&object(child))out[key]=walk(child,field.properties,name,child);
   else out[key]=clone(child);
  }
  return out;
 };
 const out=walk(resolved?.arguments??{},capability?.inputs,'',resolved?.arguments??{});
 if(capability?.domain==='weather'){
  const coordinates=point(resolved?.resolution?.location?.effective)??point(resolved?.arguments?.location);
  if(coordinates){delete out.coordinates;out.location=coordinates;}
 }
 return out;
}
function precisionView(capability,resolved,context){
 const plan=resolved?.resolution??{},time=plan.time;
 const view={};
 if(plan.location)view.location={precision:plan.location.precision==='coordinate'?'coordinates':plan.location.precision,fallbackApplied:plan.location.fallback?.applied??false};
 if(time){
  const part=value=>{
   if(value==null)return null;
   const range=temporal('time_ref',value.range,context,capability)??{unparsed:clone(value.range)};
   const fieldWindow=capability?.object==='daily'&&/^(daytimeForecast|overnightForecast)(?:\.|$)/.test(capability.field??'')&&value.range?.precision==='period'&&range?.precision==='day';
   return {dataset:fieldWindow?'daily':value.dataset,precision:fieldWindow?'day':value.precision,range,...(value.api?{api:value.api}:{}),...(value.requiresFilteringToRequestedRange!==undefined?{requiresFilteringToRequestedRange:fieldWindow?false:value.requiresFilteringToRequestedRange}:{})};
  };
  const requested=part(time.requested),effective=part(time.effective);
  const implicitWindow=capability?.object==='daily'&&/^(daytimeForecast|overnightForecast)(?:\.|$)/.test(capability.field??'')&&time.requested?.range?.precision==='period'&&requested?.range?.precision==='day'&&effective?.dataset==='daily';
  if(implicitWindow&&effective)effective.requiresFilteringToRequestedRange=false;
  view.time={requested,effective,fallbackApplied:implicitWindow?false:time.fallback?.applied??false};
 }
 return view;
}
function fieldConstraint(field){
 const targets={event_id:'event_target',contact_id:'contact_target',file_id:'file_target',material_id:'material_target',task_id:'task_target',meeting_id:'meeting_target'};
 const members=field.split('|');
 for(const member of members)if(targets[member])return targets[member];
 return field;
}
function blockingView(resolved,status){
 if(!['needs_clarification','resolution_failed'].includes(status))return {fields:[],constraints:[]};
 const fields=[...new Set((resolved?.missing??[]).map(fieldConstraint))].sort();
 const constraints=new Set();
 for(const field of fields)if(field.endsWith('_target'))constraints.add('missing_target');else if(field==='time_ref'||/(?:starts_at|ends_at)$/.test(field))constraints.add('unclear_time');else constraints.add('missing_parameter');
 for(const issue of resolved?.issues??[]){
  if(/系统时间无效|系统时区无效|Invalid time zone|当前位置获取失败|地理编码|地点.*不能猜坐标/.test(issue))constraints.add('environment_unresolved');
  else if(/结束时间必须晚于|起止.*冲突|范围.*冲突/.test(issue))constraints.add('range_conflict');
  else if(/数据集|预报范围|降级|精度/.test(issue)){constraints.delete('unclear_time');constraints.add('unsupported_precision');}
  else if(/时间.*(?:无法|不明|歧义)|时刻.*歧义|缺少明确时刻|日期.*无效/.test(issue))constraints.add('unclear_time');
  else if(/至少一个变更字段/.test(issue))constraints.add('missing_parameter');
  else if(/原文.*多个|同时要求/.test(issue))constraints.add('conflicting_explicit_constraints');
  else if(/expected|must be|type|minimum|maximum|不允许的字段|应为|必须为/i.test(issue))constraints.add('invalid_contract_value');
 }
 return {fields,constraints:[...constraints].sort()};
}
function differences(expected,actual,path='',out=[]){
 if(isDeepStrictEqual(expected,actual))return out;
 if(object(expected)&&object(actual)){
  for(const key of new Set([...Object.keys(expected),...Object.keys(actual)]))differences(expected[key],actual[key],path?`${path}.${key}`:key,out);
 }else out.push({path:path||'arguments',expected:expected??null,actual:actual??null,kind:expected===undefined?'extra':actual===undefined?'missing':'value'});
 return out;
}

/** Offline evaluation only: the hand-written gold never participates in inference or grounding. */
export function scoreExecutionSemantics(expected,run,context={}){
 if(typeof resolver.normalizeTemporalValue!=='function')throw new Error('normalizeTemporalValue is required for execution semantic evaluation');
 const capability=getCapability(expected.api),actualCapability=getCapability(run.api);
 const expectedResolved=expected.domain==='unsupported'||!expected.api?{arguments:{},sources:{},missing:[],issues:[],resolution:{},status:'unsupported'}:capability?resolver.resolveArguments(capability,expected.arguments??{},context):{arguments:{},sources:{},missing:[],issues:['未知金标 API'],resolution:{},status:'error'};
 const actualResolved=run.resolved??{arguments:{},sources:{},missing:[],issues:[],resolution:{},status:run.status};
 const expectedArguments=canonicalArguments(capability,expectedResolved,context),actualArguments=canonicalArguments(actualCapability,actualResolved,context);
 const expectedPrecision=precisionView(capability,expectedResolved,context),actualPrecision=precisionView(actualCapability,actualResolved,context);
 const expectedBlocking=blockingView(expectedResolved,expected.status),actualBlocking=blockingView(actualResolved,run.status);
 const failed=['error','cancelled'].includes(run.status);
 const expectedResolverStatusMatchesGold=expectedResolved.status===expected.status;
 const score={
  domain:!failed&&expected.domain===run.domain,
  api:!failed&&(expected.api??null)===(run.api??null),
  finalArguments:!failed&&isDeepStrictEqual(expectedArguments,actualArguments),
  status:!failed&&expected.status===run.status,
  precision:!failed&&isDeepStrictEqual(expectedPrecision,actualPrecision)&&annotated(expected.resolution??{},actualResolved.resolution??{}),
  sources:!failed&&Object.entries(expected.sources??{}).every(([field,source])=>actualResolved.sources?.[field]===source),
  blocking:{match:!failed&&isDeepStrictEqual(expectedBlocking,actualBlocking),expected:expectedBlocking,actual:actualBlocking},
  expectedResolverStatusMatchesGold,
  expectedResolved,actualResolved,
  expectedCanonicalArguments:expectedArguments,actualCanonicalArguments:actualArguments,
  precisionDetails:{expected:expectedPrecision,actual:actualPrecision},
  sourceDetails:{annotations:expected.sources??{},expected:expectedResolved.sources??{},actual:actualResolved.sources??{}},
  differences:differences(expectedArguments,actualArguments),
 };
 score.plan=expectedResolverStatusMatchesGold&&score.domain&&score.api&&score.finalArguments&&score.status&&score.precision&&score.sources&&score.blocking.match;
 return score;
}
