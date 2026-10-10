import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getCapability,validateArguments} from '../src/registry.mjs';
import {resolveArguments} from '../src/resolver.mjs';
import {experimentDefaults} from '../src/fixtures.mjs';
import {scoreCase} from '../src/evaluation.mjs';

const load=async()=>JSON.parse(await readFile(new URL('../data/cases-domain-core.json',import.meta.url),'utf8'));
const context={...experimentDefaults,now:'2026-10-10T08:00:00+08:00',timezone:'Asia/Shanghai',location:{latitude:31.2304,longitude:121.4737,label:'上海（固定实验位置）',source:'fixture'}};

test('domain-50 core suite has fifty distinct annotated scenarios in each requested domain',async()=>{
 const cases=await load();assert.equal(cases.length,150);
 assert.equal(new Set(cases.map(item=>item.id)).size,150);
 assert.equal(new Set(cases.map(item=>item.text)).size,150);
 for(const domain of ['weather','calendar','contacts']){
  const rows=cases.filter(item=>item.testDomain===domain);assert.equal(rows.length,50,domain);
  assert.ok(new Set(rows.map(item=>item.scenario)).size>=8,domain);
  assert.ok(rows.some(item=>item.expected.domain==='unsupported'),`${domain} refusal`);
  assert.ok(rows.some(item=>['needs_clarification','resolution_failed'].includes(item.expected.status)),`${domain} incomplete`);
  for(let i=0;i<50;i++)assert.equal(rows[i].id,`d50-${domain}-${String(i+1).padStart(3,'0')}`);
 }
 for(const item of cases){
  assert.equal(item.suite,'domain-50-v1');assert.match(item.scenario,/^[a-z][a-z_]+$/);
  assert.match(item.category,/[\u4e00-\u9fff]/);assert.ok(item.note.length>=8,item.id);
  assert.ok(item.expected.arguments&&typeof item.expected.arguments==='object',item.id);
  if(item.expected.domain==='unsupported'){assert.equal(item.expected.api,null,item.id);assert.equal(item.expected.status,'unsupported',item.id);}
  else assert.equal(item.expected.domain,item.testDomain,item.id);
  for(const [field,source]of Object.entries(item.expected.sources??{})){
   assert.ok(['user','default','context','system_time','system_location','system_timezone'].includes(source),`${item.id}/${field}`);
   if(source==='context')assert.equal(item.context.objects[field].trusted,true,`${item.id} trusted selected object`);
  }
 }
});

test('handwritten core gold fits business schemas and deterministic context resolution',async()=>{
 const cases=await load();const errors=[];
 for(const item of cases){
  if(!item.expected.api)continue;
  const cap=getCapability(item.expected.api);assert.ok(cap,`${item.id} unknown API`);
  assert.equal(cap.domain,item.expected.domain,item.id);
  const valid=validateArguments(cap,item.expected.arguments);assert.ok(valid.valid,`${item.id}: ${valid.issues}`);
  const actual=resolveArguments(cap,item.expected.arguments,{...context,...item.context});
  if(actual.status!==item.expected.status)errors.push(`${item.id}: ${actual.status} != ${item.expected.status}; ${actual.issues}`);
  for(const [field,source]of Object.entries(item.expected.sources??{}))if(actual.sources[field]!==source)errors.push(`${item.id}: ${field} source ${actual.sources[field]} != ${source}`);
  const score=scoreCase(item.expected,{domain:cap.domain,api:cap.id,extractedArguments:item.expected.arguments,status:actual.status,resolved:actual});
  if(!score.resolution)errors.push(`${item.id}: annotated resolution mismatch`);
  if(cap.risk==='write')assert.ok(!Object.values(actual.sources).includes('context'),`${item.id}: never choose write target from selection`);
 }
 assert.deepEqual(errors,[]);
});

test('object-list gold explicitly requests member metadata as well as leaf values',async()=>{
 const cases=await load();
 for(const [id,api,terms]of [
  ['d50-contacts-005','contacts.phone',['对象','号码','标签']],
  ['d50-contacts-007','contacts.email',['对象','地址','显示名称','标签']],
  ['d50-contacts-010','contacts.address',['对象','城市','街道','邮编']],
  ['d50-contacts-025','contacts.groups',['对象','名称','ID']],
  ['d50-contacts-030','contacts.im',['对象','地址','标签']],
  ['d50-calendar-012','calendar.event.attendees',['信息','姓名','邮箱']]
 ]){
  const item=cases.find(row=>row.id===id);assert.ok(item,id);assert.equal(item.expected.api,api,id);
  for(const term of terms)assert.ok(item.text.includes(term),`${id}: explicitly request ${term}`);
 }
});
