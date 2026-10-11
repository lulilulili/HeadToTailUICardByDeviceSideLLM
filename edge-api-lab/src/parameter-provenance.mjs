import {isDeepStrictEqual} from 'node:util';

export const PARAMETER_PROVENANCE_VERSION = 1;
// Host-generated audit only: none of these fields belong in the model prompt/schema.
export const PARAMETER_SOURCE_TAGS = Object.freeze({user:'U',system:'S',selection:'C',default:'D',derived:'R',unknown:'X'});
const get = (object,path) => path.split('.').reduce((value,key)=>value?.[key],object);
const related = (left,right) => left===right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
const supplied = (object,path) => get(object,path)!==undefined;
const validTime = value => typeof value==='string' && Number.isFinite(Date.parse(value));
const validSpan = (span,text) => span && Number.isInteger(span.start) && Number.isInteger(span.end) && span.start>=0 && span.end>span.start && span.end<=text.length && text.slice(span.start,span.end)===span.text;
const compactSpan = span => ({b:span.start,e:span.end,t:span.text});
const explicitCodes = new Set(['explicit_evidence_matched','explicit_evidence_recovered','explicit_contract_invalid']);

function fieldPaths(inputs,args,resolved,prefix='') {
  const paths=[];
  for(const [name,definition] of Object.entries(inputs??{})) {
    const path=prefix?`${prefix}.${name}`:name;
    if(supplied(args,path)||supplied(resolved,path)||definition.required) paths.push(path);
    if(definition.properties && (supplied(args,path)||supplied(resolved,path))) paths.push(...fieldPaths(definition.properties,args,resolved,path));
  }
  return paths;
}

/** Provenance describes evidence, not object existence, permission, or model confidence. */
export function buildParameterProvenance({capability,text='',groundedArguments={},grounding={},resolved={},context={},systemRequests=[]}) {
  const checks=grounding.checks??[], identities=grounding.identity??[];
  const paths=new Set([...fieldPaths(capability.inputs,groundedArguments,resolved.arguments??{}),...Object.keys(resolved.sources??{}),...(resolved.missing??[]).flatMap(path=>path.split('|')), ...checks.map(check=>check.field).filter(Boolean)]);
  const records={};
  const definitionAt=path=>path.split('.').reduce((definition,key)=>definition?.properties?.[key],{properties:capability.inputs});
  const evidenceFor=path=>checks.filter(check=>supplied(groundedArguments,path)&&explicitCodes.has(check.code)&&validSpan(check.span,text)&&
    (check.field===path && isDeepStrictEqual(check.effectiveValue,get(groundedArguments,path)) || path.startsWith(`${check.field}.`) && isDeepStrictEqual(get(check.effectiveValue,path.slice(check.field.length+1)),get(groundedArguments,path))));
  const systemOrigin=(key,entry,capabilityId)=> {
    const request=systemRequests.find(item=>item.status==='resolved'&&(capabilityId?item.capability===capabilityId:item.field===key));
    const origin=entry?.source??request?.source??(Object.hasOwn(context,key)?'provided_context':'host_fallback');
    const observedAt=entry?.observedAt??request?.observedAt,expiresAt=entry?.expiresAt??request?.expiresAt;
    return {s:'S',k:key,o:origin,...(validTime(observedAt)?{t:observedAt}:{}),...(validTime(expiresAt)?{x:expiresAt}:{})};
  };
  for(const path of paths) {
    const value=get(groundedArguments,path), finalValue=get(resolved.arguments,path);
    const source=resolved.sources?.[path], definition=definitionAt(path);
    const evidence=evidenceFor(path), selected=(resolved.resolution?.context??[]).find(item=>item.field===path&&item.source==='user_selection'&&item.trusted===true)??identities.find(item=>item.field===path&&item.status==='selected'&&item.source==='user_selection');
    const blocked=(grounding.blockers??[]).some(item=>related(path,item.field));
    const missing=(resolved.missing??[]).some(item=>item.split('|').some(field=>related(path,field)));
    const contextRecord=(resolved.resolution?.context??[]).find(item=>item.field===path);
    let record={s:'X'};
    if(source==='system_location') record=systemOrigin('location',context.location,'location.current');
    else if(source==='system_timezone') record=systemOrigin('timezone',null,'device.time.timezone');
    else if(source==='system_capability') record=systemOrigin(path,context.systemValues?.[path]);
    else if(selected) record={s:'C',o:'user_selection'};
    else if(evidence.length) record={s:'U'};
    else if(source==='default'||value===undefined&&finalValue!==undefined&&(definition?.default!==undefined||Object.hasOwn(capability.inputDefaults??{},path))) record={s:'D'};
    else if(source==='context'&&contextRecord?.inferredFrom) record={s:'R',d:[{s:'X',k:contextRecord.inferredFrom}]};
    else if(path==='location'&&capability.domain==='weather'&&supplied(groundedArguments,'coordinates')&&finalValue!==undefined) record={s:'R',d:[{s:'X',k:'coordinates'}]};
    if(evidence.length) record.e=[...new Map(evidence.map(check=>[`${check.span.start}:${check.span.end}`,compactSpan(check.span)])).values()];
    if(record.s==='X') {
      const spans=checks.filter(check=>check.field===path&&validSpan(check.span,text)).map(check=>compactSpan(check.span));
      if(spans.length) record.e=[...new Map(spans.map(span=>[`${span.b}:${span.e}`,span])).values()];
    }
    if(['relative_time','datetime'].includes(definition?.resolver)&&finalValue!==undefined) {
      record.d??=[];
      if(source==='system_time') record.d.push(systemOrigin('now',null,'device.time.current'));
      // A relative expression is U even though computing it needs S. An implicit default stays D.
      const zoned=definition.resolver==='datetime'&&typeof value==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
      if(!zoned) record.d.push(supplied(groundedArguments,'timezone')?{s:'X',k:'timezone'}:systemOrigin('timezone',null,'device.time.timezone'));
      if(source==='context'&&path.endsWith('ends_at')) record.d.push({s:'X',k:path.replace(/ends_at$/,'starts_at')});
    }
    if(path==='location'&&resolved.resolution?.location?.geocoding?.source) record.d=[...(record.d??[]),systemOrigin(`geocodes.${String(value)}`,context.geocodes?.[value]??context.geocodes?.[String(value).replace(/市$/,'')],'location.geocode')];
    if(blocked) record.q='b';
    else if(missing) record.q=value!==undefined&&finalValue!==undefined?'f':'m';
    else if(finalValue===undefined) record.q='r';
    else if(record.s==='X') record.q='?';
    if(record.s==='X'&&blocked) record.o='unresolved';
    // Omit an internal context-key marker on the primary record; the map already names the slot.
    delete record.k;
    records[path]=record;
  }
  for(const record of Object.values(records)) for(const dependency of record.d??[]) {
    if(dependency.s==='X'&&records[dependency.k]) dependency.s=records[dependency.k].s;
  }
  return {v:PARAMETER_PROVENANCE_VERSION,p:records};
}
