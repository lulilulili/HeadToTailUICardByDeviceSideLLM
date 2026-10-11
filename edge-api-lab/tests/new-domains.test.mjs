import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { domains, getCapability, schemaFor, validateArguments } from '../src/registry.mjs';
import { systemCapabilities, audioStreamTypes } from '../src/system-capabilities.mjs';
import { resolveArguments } from '../src/resolver.mjs';

test('ten domains expose read-only single-service system contracts with traceable native sources', () => {
  assert.deepEqual(domains.map(domain => domain.id), ['weather', 'calendar', 'contacts', 'files', 'services', 'cloud', 'device', 'connectivity', 'location', 'media']);
  assert.equal(new Set(systemCapabilities.map(cap => cap.id)).size, systemCapabilities.length);
  for (const cap of systemCapabilities) {
    assert.equal(cap.risk, 'read', cap.id);
    assert.ok(cap.object && cap.field && cap.projection, cap.id);
    assert.match(cap.sourceRef, /^https:\/\/developer\.huawei\.com\/consumer\/cn\/doc\/doccenter-references\/api\//, cap.id);
    assert.match(cap.verificationRef, /^https:\/\/github\.com\/openharmony\/docs\//, cap.id);
    assert.ok(['official_method', 'official_object_projection', 'adapter_contract'].includes(cap.support), cap.id);
    assert.equal(cap.source.kind, 'harmonyos_sdk_contract', cap.id);
    assert.equal(cap.returns.nullable, true, cap.id);
  }
});

test('battery native output properties never become extraction inputs or hallucinated arguments', () => {
  for (const [id, field] of [['level', 'batterySOC'], ['charging_status', 'chargingStatus'], ['health_status', 'healthStatus'], ['plugged_type', 'pluggedType'], ['temperature', 'batteryTemperature'], ['voltage', 'voltage']]) {
    const cap = getCapability(`device.battery.${id}`);
    assert.equal(cap.field, field);
    assert.deepEqual(schemaFor(cap).properties, {});
    assert.equal(validateArguments(cap, {}).valid, true);
    assert.equal(validateArguments(cap, { [field]: 80 }).valid, false);
  }
  assert.equal(getCapability('device.battery.temperature').returns.unit, '0.1 Celsius');
  assert.equal(getCapability('device.battery.voltage').returns.unit, 'microvolt');
  assert.equal(getCapability('device.battery.health_status').returns.sdkType, 'BatteryHealthState');
});

test('system default targets are contextual inputs, and outputs remain separate', () => {
  assert.equal(getCapability('connectivity.network.bearer_types').inputs.net_id.resolver, 'system_default_network');
  assert.equal(getCapability('connectivity.network.bearer_types').inputs.net_id.required, true);
  assert.equal(validateArguments(getCapability('connectivity.network.bearer_types'), { net_id: 23 }).valid, true);
  assert.equal(validateArguments(getCapability('connectivity.network.bearer_types'), { net_id: '23' }).valid, false);
  assert.equal(validateArguments(getCapability('connectivity.network.bearer_types'), { ssid: 'Home' }).valid, false);
  assert.equal(validateArguments(getCapability('connectivity.wifi.ssid'), { ssid: 'Home' }).valid, false);
  assert.equal(getCapability('connectivity.wifi.ip_address').returns.type, 'number');
  assert.equal(getCapability('connectivity.network.bearer_types').returns.items.sdkType, 'NetBearType');
});

test('coordinate transformations declare actual inputs and preserve SDK field mapping', () => {
  const geocode = getCapability('location.geocode');
  const reverse = getCapability('location.reverse_geocode');
  assert.equal(geocode.inputs.address.required, true);
  assert.equal(geocode.inputs.address.resolver, undefined);
  assert.equal(reverse.inputs.coordinates.resolver, 'system_coordinates');
  assert.equal(reverse.inputs.coordinates.properties.latitude.required, true);
  assert.equal(reverse.inputs.coordinates.properties.longitude.required, true);
  assert.equal(validateArguments(reverse, { coordinates: { latitude: 31.23, longitude: 121.47 } }).valid, true);
  assert.equal(validateArguments(reverse, { coordinates: { latitude: 91, longitude: 121.47 } }).valid, false);
  assert.equal(validateArguments(reverse, { address: '上海' }).valid, false);
  assert.equal(validateArguments(geocode, { address: '上海', max_items: 2, locale: 'zh' }).valid, true);
  assert.equal(geocode.adapter.arguments.address, 'request.description');
  assert.equal(getCapability('location.current.timestamp').field, 'timeStamp');
  assert.deepEqual(getCapability('location.current.latitude').inputs, {});
});

test('audio volume uses current API20 stream methods without guessing a default stream or percentage', () => {
  const cap = getCapability('media.volume.level');
  assert.equal(cap.field, 'getVolumeByStream');
  assert.equal(cap.since, 20);
  assert.equal(cap.inputs.stream_type.resolver, 'system_audio_stream');
  assert.equal(cap.inputs.stream_type.default, undefined);
  for (const stream of audioStreamTypes) assert.equal(validateArguments(cap, { stream_type: stream }).valid, true);
  assert.equal(validateArguments(cap, { stream_type: 'VOICE_CALL' }).valid, false);
  assert.equal(validateArguments(cap, { volume: 50 }).valid, false);
  assert.equal(getCapability('media.volume.muted').field, 'isSystemMutedForStream');
  assert.equal(getCapability('media.output_devices').adapter.fixedArguments.deviceFlag, 'OUTPUT_DEVICES_FLAG');
  assert.equal(getCapability('media.playback.title'), undefined);
});

test('system parameter resolution keeps explicit user targets ahead of trusted current-device values', () => {
  const context = {
    location: { latitude: 22.54, longitude: 114.05, source: 'fixture' },
    systemValues: { net_id: { value: 23, source: 'fixture' }, stream_type: { value: 'MUSIC', source: 'fixture' } }
  };
  const network = resolveArguments(getCapability('connectivity.network.bearer_types'), {}, context);
  assert.equal(network.status, 'ready_mock');
  assert.equal(network.arguments.net_id, 23);
  assert.equal(network.sources.net_id, 'system_capability');
  assert.equal(resolveArguments(getCapability('connectivity.network.bearer_types'), { net_id: 37 }, context).arguments.net_id, 37);
  const audio = resolveArguments(getCapability('media.volume.level'), { stream_type: 'ALARM' }, context);
  assert.equal(audio.status, 'ready_mock');
  assert.equal(audio.arguments.stream_type, 'ALARM');
  assert.equal(audio.sources.stream_type, 'user');
  assert.equal(resolveArguments(getCapability('media.volume.level'), {}, {}).status, 'resolution_failed');
  assert.equal(resolveArguments(getCapability('media.volume.level'), {}, { systemValues: { stream_type: { value: 'MUSIC', source: 'model' } } }).status, 'resolution_failed');
  const fallback = resolveArguments(getCapability('location.reverse_geocode'), {}, context);
  assert.equal(fallback.status, 'ready_mock');
  assert.deepEqual(fallback.arguments.coordinates, { latitude: 22.54, longitude: 114.05 });
  const explicit = resolveArguments(getCapability('location.reverse_geocode'), { coordinates: { latitude: 31.23, longitude: 121.47 } }, context);
  assert.equal(explicit.status, 'ready_mock');
  assert.deepEqual(explicit.arguments.coordinates, { latitude: 31.23, longitude: 121.47 });
  const partial = resolveArguments(getCapability('location.reverse_geocode'), { coordinates: { latitude: 31.23 } }, context);
  assert.equal(partial.status, 'needs_clarification');
  assert.equal(partial.arguments.coordinates.longitude, undefined);
});

test('new-domain corpus has forty independent single-service cases with schema-valid explicit user inputs', async () => {
  const cases = JSON.parse(await readFile(new URL('../data/cases-system-single.json', import.meta.url), 'utf8'));
  assert.equal(cases.length, 40);
  assert.equal(new Set(cases.map(item => item.id)).size, 40);
  for (const domain of ['device', 'connectivity', 'location', 'media']) assert.equal(cases.filter(item => item.testDomain === domain).length, 10);
  for (const item of cases) {
    assert.equal(item.suite, 'single-service-v1');
    assert.equal(item.expected.domain, item.testDomain);
    const cap = getCapability(item.expected.api);
    assert.ok(cap, item.id);
    assert.equal(cap.domain, item.testDomain, item.id);
    assert.equal(validateArguments(cap, item.expected.arguments).valid, true, item.id);
    assert.equal(Array.isArray(item.expected.api), false, item.id);
  }
});
