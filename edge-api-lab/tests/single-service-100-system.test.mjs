import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getCapability,schemaFor,validateArguments} from '../src/registry.mjs';
import {systemCapabilities,audioStreamTypes} from '../src/system-capabilities.mjs';
import {validateValue} from '../src/providers.mjs';
import {resolveArguments} from '../src/resolver.mjs';

// Expectations are hand-authored data. This test checks them; it never derives or rewrites gold.
// No model, grounding, HTTP host, GPS, or business SDK is called here.
const cases=JSON.parse(await readFile(new URL('../data/single-service-100-system.json',import.meta.url),'utf8'));
const original=JSON.parse(await readFile(new URL('../data/cases-system-single.json',import.meta.url),'utf8'));
const citySamples=JSON.parse(await readFile(new URL('../data/global-city-samples.json',import.meta.url),'utf8')).samples;
const domainIds=['device','connectivity','location','media'];
const fixtureContext={
 now:'2026-10-11T08:00:00+08:00',timezone:'Asia/Shanghai',geocodes:{},
 location:{latitude:31.2304,longitude:121.4737,label:'模拟手机位置（固定实验点）',precision:'precise',accuracyMeters:15,source:'fixture'},
 systemValues:{net_id:{value:23,source:'fixture'},stream_type:{value:'MUSIC',source:'fixture'}}
};
const contextFor=item=>({...structuredClone(fixtureContext),...structuredClone(item.context??{})});

test('four system domains add ninety unique Chinese single-action cases with IDs 011 through 100',()=>{
 assert.equal(cases.length,360);assert.equal(new Set(cases.map(item=>item.id)).size,360);
 assert.equal(new Set(cases.map(item=>item.text)).size,360);
 const originalTexts=new Set(original.map(item=>item.text));
 for(const domain of domainIds){
  const group=cases.filter(item=>item.testDomain===domain);assert.equal(group.length,90,domain);
  assert.deepEqual(group.map(item=>item.id),Array.from({length:90},(_,index)=>`e100-${domain}-${String(index+11).padStart(3,'0')}`));
  assert.equal(original.filter(item=>item.testDomain===domain).length+group.length,100,domain);
 }
 for(const item of cases){
  assert.equal(item.suite,'single-service-100-v1');assert.equal(item.expected.domain,item.testDomain);
  assert.ok(item.category&&item.scenario&&item.note,item.id);assert.match(item.text,/\p{Script=Han}/u,item.id);
  assert.equal(originalTexts.has(item.text),false,`${item.id}: repeated original sentence`);
  assert.equal(typeof item.expected.api,'string');assert.notEqual(item.expected.domain,'unsupported');
  assert.ok(['ready_mock','needs_clarification','resolution_failed'].includes(item.expected.status),item.id);
 }
});

test('all forty-five current read-only system APIs are covered, without adding imagined APIs or output inputs',()=>{
 const targets=new Set(cases.map(item=>item.expected.api));
 assert.deepEqual([...targets].sort(),systemCapabilities.map(capability=>capability.id).sort());
 for(const item of cases){
  const cap=getCapability(item.expected.api);assert.equal(cap.domain,item.testDomain,item.id);assert.equal(cap.risk,'read',item.id);
  if(Object.keys(cap.inputs).length===0)assert.deepEqual(item.expected.arguments,{},item.id);
 }
});

test('every hand-authored extraction obeys the registered sparse schema and every status agrees with the resolver contract',()=>{
 const totals={ready_mock:0,needs_clarification:0,resolution_failed:0};
 for(const item of cases){
  const cap=getCapability(item.expected.api),args=item.expected.arguments;
  assert.equal(validateArguments(cap,args).valid,true,`${item.id}: registry schema`);
  const syntax=validateValue(schemaFor(cap),args);assert.equal(syntax.valid,true,`${item.id}: ${syntax.issues?.join(';')}`);
  const resolved=resolveArguments(cap,args,contextFor(item));
  assert.equal(resolved.status,item.expected.status,`${item.id}: ${resolved.issues.join(';')}`);totals[item.expected.status]++;
  for(const [field,source]of Object.entries(item.expected.sources??{}))assert.equal(resolved.sources[field],source,`${item.id}: ${field}`);
 }
 assert.deepEqual(totals,{ready_mock:351,needs_clarification:3,resolution_failed:6});
});

test('explicit network IDs and all nine stream usages stay user inputs ahead of the current fixture target',()=>{
 const explicit=cases.filter(item=>item.expected.arguments.net_id!==undefined||item.expected.arguments.stream_type!==undefined);
 assert.equal(explicit.length,82);
 for(const item of explicit){
  const resolved=resolveArguments(getCapability(item.expected.api),item.expected.arguments,contextFor(item));
  const field=item.expected.arguments.net_id!==undefined?'net_id':'stream_type';
  assert.equal(resolved.arguments[field],item.expected.arguments[field],item.id);assert.equal(resolved.sources[field],'user',item.id);
 }
 for(const api of ['media.volume.level','media.volume.min','media.volume.max','media.volume.muted']){
  const group=cases.filter(item=>item.expected.api===api&&item.expected.arguments.stream_type!==undefined);
  assert.equal(group.length,18,api);assert.deepEqual([...new Set(group.map(item=>item.expected.arguments.stream_type))].sort(),[...audioStreamTypes].sort());
 }
});

test('default network and stream completion require fixture context; clearing it fails rather than silently guessing',()=>{
 const defaults=cases.filter(item=>item.expected.sources?.net_id==='system_capability'||item.expected.sources?.stream_type==='system_capability');
 assert.equal(defaults.length,10);
 for(const item of defaults){
  const resolved=resolveArguments(getCapability(item.expected.api),item.expected.arguments,contextFor(item));
  const field=item.expected.sources.net_id?'net_id':'stream_type';assert.equal(resolved.arguments[field],field==='net_id'?23:'MUSIC',item.id);
  assert.equal(item.expected.arguments[field],undefined,item.id);
 }
 const failures=cases.filter(item=>item.context?.systemValues);assert.equal(failures.length,4);
 for(const item of failures){
  assert.deepEqual(item.context.systemValues,{});const resolved=resolveArguments(getCapability(item.expected.api),item.expected.arguments,contextFor(item));
  assert.equal(resolved.status,'resolution_failed',item.id);assert.ok(resolved.missing.length,item.id);
  assert.equal(resolved.arguments.net_id,undefined);assert.equal(resolved.arguments.stream_type,undefined);
 }
});

test('global Chinese names are source-attested address inputs across six continents, not a runtime geocode whitelist',()=>{
 const named=cases.filter(item=>item.citySampleId);assert.equal(named.length,13);
 const continents=new Set();
 for(const item of named){
  const city=citySamples.find(sample=>sample.id===item.citySampleId);assert.ok(city,item.id);
  assert.equal(item.expected.arguments.address,city.name,item.id);assert.equal(city.languageTagVerified,true);
  assert.equal(item.expected.api,'location.geocode');assert.equal(item.expected.status,'ready_mock');continents.add(city.continent);
  assert.deepEqual(contextFor(item).geocodes,{});
  assert.equal(item.expected.arguments.coordinates,undefined);assert.equal(item.context?.geocodes,undefined);
 }
 assert.equal(continents.size,6);
});

test('reverse geocoding preserves complete explicit coordinates including zero, negative values and limits; omission uses only a mock phone position',()=>{
 const reverse=cases.filter(item=>item.expected.api==='location.reverse_geocode');assert.equal(reverse.length,17);
 const explicit=reverse.filter(item=>item.expected.arguments.coordinates);assert.equal(explicit.length,12);
 for(const item of explicit){
  const resolved=resolveArguments(getCapability(item.expected.api),item.expected.arguments,contextFor(item));
  assert.deepEqual(resolved.arguments.coordinates,item.expected.arguments.coordinates,item.id);assert.equal(resolved.sources.coordinates,'user');
 }
 assert.ok(explicit.some(item=>item.expected.arguments.coordinates.latitude===0&&item.expected.arguments.coordinates.longitude===0));
 assert.ok(explicit.some(item=>item.expected.arguments.coordinates.latitude===-90&&item.expected.arguments.coordinates.longitude===-180));
 const defaults=reverse.filter(item=>item.scenario==='system_defaults');assert.equal(defaults.length,3);
 for(const item of defaults){
  const context=contextFor(item);assert.equal(context.location.source,'fixture');assert.match(context.location.label,/模拟手机/);
  const resolved=resolveArguments(getCapability(item.expected.api),item.expected.arguments,context);
  assert.deepEqual(resolved.arguments.coordinates,{latitude:31.2304,longitude:121.4737});assert.equal(resolved.sources.coordinates,'system_location');
 }
 for(const item of reverse.filter(item=>item.scenario==='missing_environment'))assert.equal(contextFor(item).location,null);
});

test('missing business addresses need clarification, while optional locale/country remain absent and max-items has only the declared SDK default',()=>{
 const geocodes=cases.filter(item=>item.expected.api==='location.geocode');assert.equal(geocodes.length,17);
 const missing=geocodes.filter(item=>item.scenario==='missing_required');assert.equal(missing.length,3);
 for(const item of geocodes){
  const resolved=resolveArguments(getCapability(item.expected.api),item.expected.arguments,contextFor(item));
  if(!Object.hasOwn(item.expected.arguments,'locale'))assert.equal(resolved.arguments.locale,undefined,item.id);
  if(!Object.hasOwn(item.expected.arguments,'country'))assert.equal(resolved.arguments.country,undefined,item.id);
  if(!Object.hasOwn(item.expected.arguments,'max_items'))assert.equal(resolved.arguments.max_items,1,item.id);
 }
 for(const item of missing){
  const resolved=resolveArguments(getCapability(item.expected.api),item.expected.arguments,contextFor(item));
  assert.equal(resolved.status,'needs_clarification');assert.ok(resolved.missing.includes('address'));assert.equal(resolved.arguments.address,undefined);
 }
});
