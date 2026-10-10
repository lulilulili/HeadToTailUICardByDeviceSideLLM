import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import { extendedCapabilities } from '../src/extended-capabilities.mjs';

test('every included non-weather domain exposes useful field projections and explicit output contracts', () => {
  for (const domain of ['calendar','contacts','files','services','cloud']) {
    const entries=extendedCapabilities.filter(cap=>cap.domain===domain);
    assert.ok(entries.length>=4,domain);
    assert.ok(entries.some(cap=>cap.field && cap.projection && cap.returns && cap.sourceRef),domain);
  }
  const lookup=id=>extendedCapabilities.find(cap=>cap.id===id);
  assert.equal(lookup('calendar.event.location').projection,'Event.location');
  assert.equal(lookup('contacts.phone').projection,'Contact.phoneNumbers');
  assert.equal(lookup('files.metadata.size').support,'business_extension');
  assert.equal(lookup('materials.content').support,'business_extension');
  assert.equal(lookup('contacts.set.phone').inputs.contact_id.resolver,undefined);
  assert.equal(lookup('files.metadata.size').inputs.file_id.resolver,'selected_object');
});

test('field getters distinguish read candidates from write targets and preserve typed nested changes', () => {
  const getters=extendedCapabilities.filter(cap=>cap.id.startsWith('contacts.')&&cap.risk==='read');
  assert.ok(getters.some(cap=>cap.field==='postalAddresses'));
  assert.ok(getters.some(cap=>cap.field==='events'));
  const setter=extendedCapabilities.find(cap=>cap.id==='calendar.event.set.location');
  assert.equal(setter.risk,'write');
  assert.equal(setter.inputs.event_id.required,true);
  assert.equal(setter.inputs.value.type,'string');
  assert.equal(setter.inputs.value.default,undefined);
  for(const id of ['contacts.phoneNumbers.phoneNumber','contacts.emails.email','contacts.postalAddresses.postalAddress'])assert.ok(extendedCapabilities.find(cap=>cap.id===id)?.projection.includes('[]'));
  assert.deepEqual(extendedCapabilities.find(cap=>cap.id==='contacts.phoneNumbers.phoneNumber').returns.items,{type:'string'});
  assert.deepEqual(extendedCapabilities.find(cap=>cap.id==='calendar.config.color').returns.type,['number','string']);
  assert.deepEqual(extendedCapabilities.find(cap=>cap.id==='cloud.prefetch.result').returns.type,['string','object']);
  assert.equal(extendedCapabilities.find(cap=>cap.id==='cloud.function.call').projection,'FunctionResult.result');
  assert.equal(extendedCapabilities.find(cap=>cap.id==='cloud.prefetch.timestamp').returns.sdkType,'Date');
});

test('calendar attendee and recurrence leaf getters retain official values and cardinality', () => {
  const lookup=id=>extendedCapabilities.find(cap=>cap.id===id);
  for(const [field,type,sdkType] of [['name','string'],['email','string'],['role','string','AttendeeRole'],['status','number','AttendeeStatus'],['type','number','AttendeeType']]) {
    const cap=lookup(`calendar.event.attendee.${field}`);
    assert.ok(cap,`missing Attendee.${field}`);
    assert.equal(cap.projection,`Event.attendee[].${field}`);
    assert.equal(cap.returns.type,'array');
    assert.equal(cap.returns.shape,'list');
    assert.equal(cap.returns.items.type,type);
    assert.equal(cap.returns.items.sdkType,sdkType);
    assert.equal(cap.returns.items.enum,undefined,'native enum values are not translated or guessed');
    assert.equal(cap.inputs.event_id.resolver,'selected_object');
    assert.deepEqual(cap.inputs.time_ref.defaultUnlessPresent,['event_id']);
    assert.ok(cap.sourceRef.endsWith('#attendee'));
  }
  for(const field of ['recurrenceFrequency','expire','count','interval','excludedDates','daysOfWeek','daysOfMonth','daysOfYear','weeksOfMonth','weeksOfYear','monthsOfYear']) {
    const cap=lookup(`calendar.event.recurrenceRule.${field}`);
    assert.ok(cap,`missing RecurrenceRule.${field}`);
    assert.equal(cap.projection,`Event.recurrenceRule.${field}`);
    assert.ok(cap.sourceRef.endsWith('#recurrencerule'));
    if(['recurrenceFrequency','expire','count','interval'].includes(field)) assert.equal(cap.returns.type,'number');
    else {assert.equal(cap.returns.type,'array');assert.deepEqual(cap.returns.items,{type:'number'});assert.equal(cap.returns.shape,'list');}
    assert.equal(cap.returns.default,undefined,'output defaults come from the SDK, not mock data');
  }
  assert.equal(lookup('calendar.event.id').returns.type,'number');
  assert.equal(lookup('calendar.event.type').returns.type,'number');
  assert.deepEqual(lookup('calendar.event.reminders').returns.items,{type:'number'});
  assert.equal(lookup('calendar.event.attendees').returns.items.sdkType,'Attendee');
});

test('contact composite getters expose every verified data leaf with native list types', () => {
  const lookup=id=>extendedCapabilities.find(cap=>cap.id===id);
  const lists={websites:{website:'string'},relations:{relationName:'string',labelName:'string',labelId:'number'},groups:{title:'string',groupId:'number'},imAddresses:{imAddress:'string',labelName:'string',labelId:'number'},sipAddresses:{sipAddress:'string',labelName:'string',labelId:'number'},emails:{labelName:'string',labelId:'number'},events:{labelId:'number'},postalAddresses:{labelName:'string',neighborhood:'string',pobox:'string',region:'string',labelId:'number'}};
  for(const [parent,fields] of Object.entries(lists)) for(const [field,type] of Object.entries(fields)) {
    const cap=lookup(`contacts.${parent}.${field}`);
    assert.ok(cap,`missing ${parent}.${field}`);
    assert.equal(cap.projection,`Contact.${parent}[].${field}`);
    assert.equal(cap.returns.type,'array');
    assert.equal(cap.returns.shape,'list');
    assert.equal(cap.returns.items.type,type);
    assert.equal(cap.returns.items.enum,undefined);
    assert.deepEqual(cap.constraints.atLeastOne,['contact_id','query']);
    assert.equal(cap.inputs.contact_id.resolver,'selected_object');
    assert.equal(cap.inputs[field],undefined,'queried leaf value is not an input');
    assert.equal(cap.support,'official_object_projection');
  }
  for(const [field,type] of [['name.middleName','string'],['name.middleNamePhonetic','string'],['name.namePrefix','string'],['name.nameSuffix','string'],['name.hasName','boolean'],['nickName.nickName','string'],['note.noteContent','string'],['portrait.uri','string'],['id','number'],['key','string']]) {
    const cap=lookup(`contacts.${field}`);assert.ok(cap,field);assert.equal(cap.projection,`Contact.${field}`);assert.equal(cap.returns.type,type);
  }
  assert.equal(lookup('contacts.portrait.photo').returns.sdkType,'image.PixelMap');
  assert.equal(lookup('contacts.portrait.photo').returns.serialization,'opaque resource reference');
  assert.equal(lookup('contacts.phoneNumbers.labelId').returns.items.type,'number');
  for(const id of ['contacts.phone','contacts.email','contacts.address','contacts.websites','contacts.relations','contacts.groups','contacts.im','contacts.sip','contacts.events','contacts.get','calendar.event.get']) {
    assert.equal(lookup(id).returns.type,'array',id);assert.equal(lookup(id).returns.items.type,'object',id);assert.equal(lookup(id).returns.shape,'list',id);
  }
});

test('frozen leaf samples distinguish explicit extraction, selected objects, and missing targets', async () => {
  const cases=JSON.parse(await readFile(new URL('../data/cases.json',import.meta.url),'utf8'));
  const added=cases.filter(item=>/^cx1[0-5]$|^px1[3-8]$/.test(item.id));
  assert.equal(added.length,12);
  for(const item of added)assert.ok(extendedCapabilities.some(cap=>cap.id===item.expected.api),item.id);
  for(const id of ['cx11','px15']) {
    const item=added.find(item=>item.id===id);assert.deepEqual(item.expected.arguments,{});
    const field=id==='cx11'?'event_id':'contact_id';
    assert.equal(item.context.objects[field].trusted,true);
    assert.equal(item.expected.sources[field],'context');
    assert.deepEqual(item.expected.resolution.context,[{field,source:'user_selection',trusted:true}]);
  }
  const untrusted=added.find(item=>item.id==='px18');assert.equal(untrusted.context.objects.contact_id.trusted,false);assert.equal(untrusted.expected.status,'needs_clarification');
  assert.equal(added.find(item=>item.id==='px17').expected.status,'needs_clarification');
});
