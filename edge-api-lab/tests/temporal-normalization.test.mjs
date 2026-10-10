import test from 'node:test';
import assert from 'node:assert/strict';
import * as resolver from '../src/resolver.mjs';
import { getCapability } from '../src/registry.mjs';
import { experimentDefaults } from '../src/fixtures.mjs';

const context = { ...experimentDefaults, now: '2026-10-10T08:00:00+08:00', timezone: 'Asia/Shanghai', location: { latitude: 31.2304, longitude: 121.4737, source: 'fixture' } };
const read = (text, cap = 'calendar.search', override = {}) => resolver.resolveArguments(getCapability(cap), { time_ref: text }, { ...context, ...override });

test('daytime intervals retain original wording, actual clock bounds and weather downgrade provenance', () => {
  const result = read('今天白天', 'weather.daily.daytimeForecast.humidity');
  assert.equal(result.status, 'ready_mock');
  assert.equal(result.arguments.time_ref.expression, '今天白天');
  assert.equal(result.arguments.time_ref.precision, 'period');
  assert.deepEqual(result.arguments.time_ref.period, { id: 'daytime', start: '06:00', end: '18:00' });
  assert.equal(result.arguments.time_ref.startAt, '2026-10-10T06:00:00+08:00');
  assert.equal(result.arguments.time_ref.endAt, '2026-10-10T18:00:00+08:00');
  assert.equal(result.resolution.time.requested.precision, 'period');
  assert.equal(result.resolution.time.effective.precision, 'day');
  assert.equal(result.resolution.time.fallback.applied, true);
  assert.ok(result.resolution.time.fallback.reason);
  const evening = read('今晚');
  assert.equal(evening.arguments.time_ref.startAt, '2026-10-10T18:00:00+08:00');
  assert.equal(evening.arguments.time_ref.endAt, '2026-10-11T00:00:00+08:00');
});

test('explicit daily, hourly and minute wording preserves the requested window and sampling precision', () => {
  const daily = read('未来3天逐日');
  assert.equal(daily.status, 'ready_mock');
  assert.equal(daily.arguments.time_ref.start, '2026-10-10');
  assert.equal(daily.arguments.time_ref.end, '2026-10-12');
  assert.equal(daily.arguments.time_ref.precision, 'day');
  for (const expression of ['未来20分钟逐分钟', '未来30分钟，每分钟']) {
    const result = read(expression);
    assert.equal(result.status, 'ready_mock', expression);
    assert.equal(result.arguments.time_ref.precision, 'minute');
    assert.equal(result.arguments.time_ref.expression, expression);
    assert.equal(result.arguments.time_ref.startAt, '2026-10-10T08:00:00+08:00');
    assert.equal(result.arguments.time_ref.endAt, expression.includes('20') ? '2026-10-10T08:20:00+08:00' : '2026-10-10T08:30:00+08:00');
  }
  const hourly = read('未来3小时逐小时');
  assert.equal(hourly.status, 'ready_mock');
  assert.equal(hourly.arguments.time_ref.precision, 'hour');
  assert.equal(hourly.arguments.time_ref.endAt, '2026-10-10T11:00:00+08:00');
});

test('current-year dates and equivalent 24-hour write instants resolve without filling an omitted date', () => {
  const currentYear = read('当前年10月12日');
  assert.equal(currentYear.status, 'ready_mock');
  assert.equal(currentYear.arguments.time_ref.start, '2026-10-12');
  assert.equal(currentYear.sources.time_ref, 'system_time');
  const cap = getCapability('calendar.create');
  const first = resolver.resolveArguments(cap, { title: '评审', starts_at: '明天下午4点' }, context);
  const second = resolver.resolveArguments(cap, { title: '评审', starts_at: '明天16:00' }, context);
  assert.equal(first.arguments.starts_at, '2026-10-11T16:00:00+08:00');
  assert.equal(second.arguments.starts_at, first.arguments.starts_at);
  const yearClock = resolver.resolveArguments(cap, { title: '评审', starts_at: '当前年10月12日下午4点' }, context);
  assert.equal(yearClock.arguments.starts_at, '2026-10-12T16:00:00+08:00');
  const missingDate = resolver.resolveArguments(cap, { title: '评审', starts_at: '下午4点' }, context);
  assert.equal(missingDate.status, 'needs_clarification');
  assert.ok(!Object.hasOwn(missingDate.arguments, 'starts_at'));
});

test('normalization compares real instants and parsed ranges while retaining different sampling precision', () => {
  assert.equal(typeof resolver.normalizeTemporalValue, 'function');
  const normalize = resolver.normalizeTemporalValue;
  assert.deepEqual(normalize('starts_at', '明天下午4点', context), normalize('changes.starts_at', '明天16:00', context));
  assert.deepEqual(normalize('starts_at', '明天16:00', context), { kind: 'instant', at: '2026-10-11T08:00:00.000Z', precision: 'instant' });
  const parsed = read('未来3天逐日').arguments.time_ref;
  assert.deepEqual(normalize('time_ref', '未来3天逐日', context), normalize('time_ref', parsed, context));
  assert.deepEqual(normalize('time_ref', parsed, context), { kind: 'range', start: '2026-10-10', end: '2026-10-12', precision: 'day' });
  assert.notDeepEqual(normalize('time_ref', '未来30分钟每分钟', context), normalize('time_ref', '未来30分钟逐小时', context));
  assert.deepEqual(normalize('ends_at', '下午5点', { ...context, inheritedDay: '2026-10-11' }), { kind: 'instant', at: '2026-10-11T09:00:00.000Z', precision: 'instant' });
});

test('only a matching daily forecast projection can express the same date through its built-in period', () => {
  const normalize = resolver.normalizeTemporalValue;
  assert.equal(typeof normalize, 'function');
  const daytime = { ...context, capability: getCapability('weather.daily.daytimeForecast.humidity') };
  const overnight = { ...context, capability: getCapability('weather.daily.overnightForecast.humidity') };
  assert.deepEqual(normalize('time_ref', '今天白天', daytime), normalize('time_ref', '今天', daytime));
  assert.deepEqual(normalize('time_ref', read('今天白天').arguments.time_ref, daytime), normalize('time_ref', '今天', daytime));
  assert.deepEqual(normalize('time_ref', '今天夜间', overnight), normalize('time_ref', '今天', overnight));
  assert.notDeepEqual(normalize('time_ref', '今天下午', daytime), normalize('time_ref', '今天', daytime));
  assert.notDeepEqual(normalize('time_ref', '今天白天', context), normalize('time_ref', '今天', context));
  assert.notDeepEqual(normalize('time_ref', '今晚', daytime), normalize('time_ref', '今天', daytime));
});

test('unknown or absent temporal information cannot normalize into a plan or turn future into current weather', () => {
  const normalize = resolver.normalizeTemporalValue;
  assert.equal(typeof normalize, 'function');
  for (const value of [undefined, null, '', '稍后', '每分钟', '逐小时', '当前年2月30日', '明天25:00']) assert.equal(normalize('time_ref', value, context), null, String(value));
  assert.equal(normalize('starts_at', '下午4点', context), null);
  assert.equal(normalize('time_ref', '明天', {}), null);
  assert.equal(normalize('keyword', '明天', context), null);
  assert.equal(read('每分钟').status, 'needs_clarification');
  const future = read('未来20分钟每分钟', 'weather.current.humidity', { weatherAvailability: { current: true, minute: false, hourly: false, daily: false } });
  assert.equal(future.status, 'needs_clarification');
  assert.equal(future.resolution.time.effective, null);
  assert.equal(future.arguments.time_ref.precision, 'minute');
  assert.match(future.resolution.time.fallback.reason, /current|未来/);
});

test('absolute offsets need no device clock and malformed stored values are not repaired from expression text', () => {
  const normalize = resolver.normalizeTemporalValue;
  assert.deepEqual(normalize('starts_at', '2026-10-11T16:00+08:00'), { kind: 'instant', at: '2026-10-11T08:00:00.000Z', precision: 'instant' });
  assert.equal(normalize('time_ref', { start: '2026-10-10', end: '2026-10-10', precision: 'day', at: 'invalid', expression: '今天' }, context), null);
  const capContext = { ...context, capability: getCapability('weather.daily.daytimeForecast.humidity') };
  const period = { start: '2026-10-10', end: '2026-10-10', precision: 'period', period: { id: 'daytime', start: '06:00', end: '18:00' }, startAt: 'invalid', endAt: '2026-10-10T18:00:00+08:00', expression: '今天白天' };
  assert.equal(normalize('time_ref', period, capContext), null);
  assert.equal(normalize('time_ref', { precision: 'day', expression: '今天' }, context), null);
});
