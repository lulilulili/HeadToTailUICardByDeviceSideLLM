import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getCapability,schemaFor} from '../src/registry.mjs';
import {validateValue} from '../src/providers.mjs';
import {resolveArguments} from '../src/resolver.mjs';
import {experimentDefaults} from '../src/fixtures.mjs';
import {coreSingleServiceCases} from '../data/single-service-core.mjs';

// Gold is authored from the API contract, not from grounding, prompts or model outputs.
const cases=JSON.parse(await readFile(new URL('../data/single-service-100-weather-calendar-contacts.json',import.meta.url),'utf8'));
const cityData=JSON.parse(await readFile(new URL('../data/global-city-samples.json',import.meta.url),'utf8'));
const base={...experimentDefaults,now:'2026-10-10T08:00:00+08:00',timezone:'Asia/Shanghai',location:{latitude:31.2304,longitude:121.4737,label:'模拟手机当前位置（上海固定坐标）',source:'fixture'}};
const domains=['weather','calendar','contacts'];

test('the expansion adds exactly ninety new unique Chinese single-service cases per owned domain',()=>{
 assert.equal(cases.length,270);
 assert.equal(new Set(cases.map(c=>c.id)).size,cases.length);
 assert.equal(new Set(cases.map(c=>c.text)).size,cases.length);
 for(const domain of domains){
  const rows=cases.filter(c=>c.testDomain===domain);
  assert.equal(rows.length,90);
  assert.deepEqual(rows.map(c=>c.id),Array.from({length:90},(_,i)=>'e100-'+domain+'-'+String(i+11).padStart(3,'0')));
  const original=coreSingleServiceCases.filter(c=>c.testDomain===domain);
  assert.equal(original.length,10);assert.equal(original.length+rows.length,100);
 }
 for(const c of cases){
  assert.equal(c.suite,'single-service-100-v1',c.id);assert.equal(c.singleService,true,c.id);
  assert.ok(c.category&&c.scenario&&c.text,c.id);assert.match(c.text,/\p{Script=Han}/u,c.id);
  assert.equal(c.expected.domain,c.testDomain,c.id);assert.notEqual(c.expected.domain,'unsupported',c.id);
  assert.ok(['ready_mock','needs_clarification','resolution_failed'].includes(c.expected.status),c.id);
 }
});

test('every provided gold slot satisfies its current API schema without inventing missing business slots',()=>{
 for(const c of cases){
  const cap=getCapability(c.expected.api);assert.ok(cap,c.id);assert.equal(cap.domain,c.testDomain,c.id);
  const schema=schemaFor(cap);
  for(const [field,value]of Object.entries(c.expected.arguments)){
   assert.ok(Object.hasOwn(schema.properties,field),c.id+': undeclared '+field);
   const validation=validateValue(schema.properties[field],value);
   assert.equal(validation.valid,true,c.id+'/'+field+': '+validation.issues?.join(';'));
  }
  if(c.category==='missing-business-slot'||c.category==='write-target-boundary')assert.equal(c.expected.status,'needs_clarification',c.id);
 }
});

test('human gold status matches the resolver contract under the declared frozen phone mock context',()=>{
 const failures=[];
 for(const c of cases){
  const before=structuredClone(c.expected.arguments),context={...base,...c.context};
  const resolved=resolveArguments(getCapability(c.expected.api),c.expected.arguments,context);
  if(resolved.status!==c.expected.status)failures.push({id:c.id,text:c.text,api:c.expected.api,expected:c.expected.status,status:resolved.status,missing:resolved.missing,issues:resolved.issues});
  assert.deepEqual(c.expected.arguments,before,c.id+' resolver must not rewrite the gold');
 }
 assert.deepEqual(failures,[]);
});

test('coverage spans native fields, aggregate reads, business writes and deliberate missing slots',()=>{
 const minApis={weather:60,calendar:35,contacts:40};
 for(const domain of domains){
  const rows=cases.filter(c=>c.testDomain===domain),apis=new Set(rows.map(c=>c.expected.api));
  assert.ok(apis.size>=minApis[domain],domain+' API coverage '+apis.size);
  assert.ok(new Set(rows.map(c=>c.category)).size>=8,domain+' varied expressions');
  assert.ok(new Set(rows.map(c=>c.scenario)).size>=15,domain+' varied semantic scenarios');
  assert.ok(rows.some(c=>Object.keys(c.expected.arguments).length===0),domain+' sparse user parameters');
  assert.ok(rows.some(c=>c.category==='negation'),domain+' negation interference');
 }
 const weather=cases.filter(c=>c.testDomain==='weather');
 for(const object of ['current','hourly','daily','minute','alerts','indices','tides','city'])assert.ok(weather.some(c=>c.expected.api.startsWith('weather.'+object+'.')),object);
 assert.ok(weather.filter(c=>c.expected.api==='weather.query').length>=3);
 for(const api of ['calendar.search','calendar.create','calendar.update','calendar.cancel'])assert.ok(cases.some(c=>c.expected.api===api),api);
 for(const api of ['contacts.search','contacts.create','contacts.update'])assert.ok(cases.some(c=>c.expected.api===api),api);
 assert.ok(cases.some(c=>c.expected.api==='calendar.create'&&c.expected.arguments.title&&!c.expected.arguments.starts_at));
 assert.ok(cases.some(c=>c.expected.api==='contacts.create'&&!c.expected.arguments.name));
});

test('global Chinese places have independent official sample provenance and cannot turn into current-location gold',()=>{
 const rows=cases.filter(c=>c.provenance);
 assert.equal(rows.length,16);
 const samples=new Map(cityData.samples.map(c=>[c.id,c])),continents=new Set();
 for(const c of rows){
  const sample=samples.get(c.provenance.sampleId);assert.ok(sample,c.id);
  assert.equal(sample.languageTagVerified,true,c.id);
  assert.equal(c.expected.arguments.location,sample.name,c.id);assert.ok(c.text.includes(sample.name),c.id);
  assert.equal(c.expected.status,'resolution_failed',c.id);assert.deepEqual(c.context.geocodes,{},c.id);
  assert.equal(c.context.location,undefined,c.id);assert.equal(c.expected.arguments.coordinates,undefined,c.id);
  const resolved=resolveArguments(getCapability(c.expected.api),c.expected.arguments,{...base,...c.context});
  assert.equal(resolved.sources.location,'user',c.id);assert.equal(resolved.resolution.location.effective,null,c.id);
  continents.add(sample.continent);
 }
 assert.equal(continents.size,6);
});

test('quoted payload traps remain data for only one API and selected objects never provide gold write targets',()=>{
 for(const c of cases.filter(c=>c.category==='quoted-payload'))assert.ok(Object.values(c.expected.arguments).some(value=>typeof value==='string'||value&&typeof value==='object'),c.id);
 const writes=cases.filter(c=>c.category==='write-target-boundary');
 assert.ok(writes.length>=3);
 for(const c of writes){
  assert.equal(c.expected.status,'needs_clarification',c.id);
  const idField=c.testDomain==='calendar'?'event_id':'contact_id';
  assert.equal(c.expected.arguments[idField],undefined,c.id);assert.equal(c.context.objects[idField].source,'user_selection',c.id);
 }
});

test('safe contract rejection is not relabeled as meeting the actual user goal',()=>{
 const grammar=cases.filter(c=>c.category==='resolver-grammar-boundary');
 assert.deepEqual(grammar.map(c=>c.id),['e100-weather-054','e100-calendar-056','e100-calendar-057']);
 for(const c of grammar){
  assert.equal(c.expected.status,'needs_clarification',c.id);
  assert.equal(c.userGoalStatus,'ready_mock',c.id);assert.match(c.contractBoundary,/不支持|未把/);
  assert.ok(c.note.includes('实际用户意图尚未满足'),c.id);
 }
 const boundaries=cases.filter(c=>c.contractBoundary);
 assert.equal(boundaries.length,20);
 for(const c of boundaries){assert.equal(c.userGoalStatus,'ready_mock',c.id);assert.notEqual(c.expected.status,c.userGoalStatus,c.id);}
});
