import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { domains, capabilities, getCapability, listCapabilities, schemaFor, validateArguments } from '../src/registry.mjs';
import { resolveArguments } from '../src/resolver.mjs';

test('catalog preserves six domains and the fifteen original business capabilities', () => {
  assert.deepEqual(domains.map(d => d.id), ['weather', 'calendar', 'contacts', 'files', 'services', 'cloud']);
  assert.ok(capabilities.length >= 15);
  assert.equal(new Set(capabilities.map(c => c.id)).size, capabilities.length);
  assert.ok(listCapabilities('calendar').length >= 4);
  assert.equal(getCapability('unknown'), undefined);
});

test('extraction schema accepts missing values while rejecting invented fields', () => {
  const cap = getCapability('weather.query');
  const schema = schemaFor(cap);
  assert.deepEqual(schema.required, []);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.location.type, 'string');
  assert.equal(schema.properties.time_ref.default, undefined);
  assert.equal(schema.properties.time_ref.resolver, undefined);
  for (const need of ['weather', 'precipitation', 'temperature', 'alert']) assert.ok(schema.properties.data_needs.items.enum.includes(need));
  assert.equal(validateArguments(cap, {}).valid, true);
  assert.equal(validateArguments(cap, { invented: 'today' }).valid, false);
});

test('validation refuses malformed typed and enum parameters', () => {
  assert.equal(validateArguments(getCapability('weather.query'), { data_needs: ['weather'], location: '上海' }).valid, true);
  assert.equal(validateArguments(getCapability('weather.query'), { data_needs: 'weather' }).valid, false);
  assert.equal(validateArguments(getCapability('weather.query'), { data_needs: ['unknown_weather_field'] }).valid, false);
  assert.equal(validateArguments(getCapability('calendar.create'), { reminder_minutes: -1 }).valid, false);
  assert.equal(validateArguments(getCapability('calendar.create'), { duration_minutes: 1.5 }).valid, false);
  assert.equal(validateArguments(getCapability('calendar.update'), { changes: { title: '例会' } }).valid, true);
  assert.equal(validateArguments(getCapability('calendar.update'), { changes: { shell: 'echo' } }).valid, false);
  assert.equal(validateArguments(getCapability('services.open'), { service: 'shell' }).valid, false);
  assert.equal(validateArguments(getCapability('contacts.search'), []).valid, false);
});

test('weather getters follow official object paths and preserve minute precipitation limits', () => {
  const humidity = getCapability('weather.current.humidity');
  assert.ok(humidity);
  assert.equal(humidity.object, 'current');
  assert.equal(humidity.field, 'humidity');
  assert.equal(humidity.risk, 'read');
  assert.ok(humidity.sourceRef.endsWith('#currentweather'));
  assert.equal(humidity.inputDefaults.time_ref, '现在');
  assert.ok(getCapability('weather.hourly.wind.speed'));
  assert.ok(getCapability('weather.daily.daytimeForecast.humidity'));
  assert.ok(getCapability('weather.daily.sun.sunrise'));
  assert.ok(getCapability('weather.minute.precipitationIntensity'));
  assert.equal(getCapability('weather.minute.humidity'), undefined);
  assert.equal(getCapability('weather.minute.temperature'), undefined);
  assert.equal(getCapability('weather.current.precipitationProbability'), undefined);
  assert.ok(getCapability('weather.current.overview').aggregate);
  assert.ok(getCapability('weather.query').aggregate);
});

test('weather coordinates are structured, range checked, and do not become output-value inputs', () => {
  const cap = getCapability('weather.current.humidity');
  assert.ok(cap);
  assert.equal(validateArguments(cap, { coordinates: { latitude: 31.2304, longitude: 121.4737 } }).valid, true);
  assert.equal(validateArguments(cap, { coordinates: { latitude: 99, longitude: 121.4737 } }).valid, false);
  assert.equal(validateArguments(cap, { humidity: 30 }).valid, false);
  assert.deepEqual(cap.granularities, ['current']);
  assert.equal(cap.inputs.strict_time.default, false);
});

test('weather location expressions and coordinates are alternative inputs with one resolved destination', () => {
  const context = { now: '2026-10-10T08:00:00+08:00', timezone: 'Asia/Shanghai', location: null, geocodes: { 上海: { latitude: 31.2304, longitude: 121.4737, precision: 'city', source: 'fixture' } } };
  for (const id of ['weather.query', 'weather.current.uvIndex.value']) {
    const cap = getCapability(id);
    assert.notEqual(cap.inputs.location.required, true, id);
    assert.notEqual(cap.inputs.coordinates.required, true, id);
    assert.deepEqual(cap.inputAlternatives[0].fields, ['location', 'coordinates']);
    assert.equal(cap.inputAlternatives[0].resolvedField, 'location');
    assert.equal(cap.inputs.coordinates.properties.latitude.required, true);
    assert.equal(cap.inputs.coordinates.properties.longitude.required, true);
    assert.equal(resolveArguments(cap, { coordinates: { latitude: 31.2, longitude: 121.4 } }, context).status, 'ready_mock');
    assert.equal(resolveArguments(cap, { location: '上海' }, context).status, 'ready_mock');
    assert.equal(resolveArguments(cap, {}, context).status, 'resolution_failed');
    assert.notEqual(resolveArguments(cap, { coordinates: { latitude: 31.2 } }, context).status, 'ready_mock');
  }
});

test('object field getters expose each supported domain with explicit target contracts', () => {
  for (const id of ['contacts.email', 'contacts.address', 'calendar.event.location', 'calendar.event.attendees', 'files.metadata.size', 'materials.content', 'materials.updated_at', 'services.link', 'cloud.storage.download_url', 'cloud.function.call', 'cloud.database.field']) assert.ok(getCapability(id), id);
  assert.equal(getCapability('files.metadata.size').inputs.file_id.resolver, 'selected_object');
  assert.equal(getCapability('files.metadata.size').inputs.file_id.required, true);
  assert.deepEqual(getCapability('contacts.email').constraints.atLeastOne, ['contact_id', 'query']);
});

test('nested weather arrays retain SDK projection cardinality and optional parents', () => {
  assert.equal(getCapability('weather.indices.dailyItems').returns.type, 'array');
  assert.equal(getCapability('weather.indices.dailyItems.level').projection, 'indices[].dailyItems[].level');
  assert.equal(getCapability('weather.tides.hourlyTides.height').projection, 'tides[].hourlyTides[].height');
  assert.equal(getCapability('weather.city.administrativeAreas.localizedName').projection, 'city.administrativeAreas[].localizedName');
  assert.equal(getCapability('weather.city.administrativeAreas.localizedName').returns.optional, true);
  assert.equal(getCapability('weather.hourly.updateTime').projection, 'hourly.updateTime');
  assert.equal(getCapability('weather.minute.summary').projection, 'minute.summary');
  assert.equal(getCapability('weather.minute.summary').returns.shape, 'value');
  assert.equal(getCapability('weather.alerts.icon').returns.optional, true);
});

test('city administrative-area leaf getters return every area as a typed list', () => {
  for (const [field,type] of [['level','number'],['localizedName','string'],['chineseName','string'],['englishName','string']]) {
    const cap=getCapability(`weather.city.administrativeAreas.${field}`);
    assert.equal(cap.projection,`city.administrativeAreas[].${field}`);
    assert.equal(cap.returns.type,'array',field);
    assert.deepEqual(cap.returns.items,{type},field);
    assert.equal(cap.returns.shape,'list',field);
    assert.equal(cap.returns.optional,true,field);
    assert.equal(cap.output.type,type,`native element type ${field}`);
  }
});

test('original aggregate and write contracts retain broader native business fields', () => {
  assert.equal(validateArguments(getCapability('calendar.create'), {title:'午餐',starts_at:'明天中午12:00',description:'项目交流',is_all_day:false,timezone:'Asia/Shanghai',attendees:['ct_7'],recurrence:'每周三'}).valid,true);
  assert.equal(getCapability('calendar.create').inputs.timezone.resolver,'system_timezone');
  assert.equal(getCapability('calendar.update').inputs.changes.properties.timezone.resolver,undefined);
  assert.equal(validateArguments(getCapability('contacts.create'), {name:'张三',address:'上海',birthday:'10月10日',nickname:'小张',note:'同事',website:'https://example.com'}).valid,true);
  assert.equal(validateArguments(getCapability('files.preview'),{file_id:'file_9',mime_type:'',title:'预算'}).valid,true);
  assert.equal(getCapability('files.preview').inputs.mime_type.resolver,'mime_from_uri');
});

test('system resolver metadata distinguishes contextual defaults from required business facts', () => {
  const weather = getCapability('weather.query');
  assert.equal(weather.inputs.location.resolver, 'system_location');
  assert.equal(weather.inputs.time_ref.resolver, 'relative_time');
  assert.equal(weather.inputs.time_ref.default, 'today');
  assert.equal(getCapability('calendar.create').inputs.starts_at.required, true);
  assert.equal(getCapability('calendar.create').inputs.starts_at.default, undefined);
  assert.equal(getCapability('calendar.create').inputs.starts_at.resolver, 'datetime');
  assert.deepEqual(getCapability('materials.search').constraints.atLeastOne, ['keyword', 'meeting_id']);
});

test('frozen benchmark covers every domain and its gold arguments satisfy extraction contracts', async () => {
  const cases = JSON.parse(await readFile(new URL('../data/cases.json', import.meta.url), 'utf8'));
  assert.ok(cases.length >= 48);
  assert.equal(new Set(cases.map(item => item.id)).size, cases.length);
  assert.deepEqual(new Set(cases.slice(0, 6).map(item => item.expected.domain)), new Set(domains.map(domain => domain.id)));
  for (const category of ['explicit', 'default', 'relative', 'ambiguity', 'unsupported', 'injection', 'missing']) assert.ok(cases.some(item => item.category === category));
  for (const item of cases) {
    const expected = item.expected;
    if (expected.domain === 'unsupported') {
      assert.equal(expected.api, null, item.id);
      assert.equal(expected.status, 'unsupported', item.id);
      continue;
    }
    const cap = getCapability(expected.api);
    assert.ok(cap, item.id);
    assert.equal(cap.domain, expected.domain, item.id);
    const checked = validateArguments(cap, expected.arguments);
    assert.equal(checked.valid, true, `${item.id}: ${checked.issues.join('; ')}`);
  }
});
