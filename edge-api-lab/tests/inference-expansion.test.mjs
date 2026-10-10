import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveArguments } from '../src/resolver.mjs';
import * as prompts from '../src/prompts.mjs';
import { getCapability } from '../src/registry.mjs';
import { runPipeline } from '../src/pipeline.mjs';
import { readFileSync } from 'node:fs';
import { validateValue } from '../src/providers.mjs';
import { capabilities } from '../src/registry.mjs';

const context = { now: '2026-10-10T08:00:00+08:00', timezone: 'Asia/Shanghai', location: { latitude: 31.2304, longitude: 121.4737, label: '上海', source: 'fixture' } };
const location = { type: 'string', required: true, resolver: 'system_location' };
const coordinates = { type: 'object', properties: { latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 } }, additionalProperties: false };
const weather = (object = 'daily', extra = {}) => ({ id: `weather.${object}.overview`, domain: 'weather', object, field: '*', risk: 'read', granularities: [object], aggregate: true, inputDefaults: { time_ref: object === 'current' ? '现在' : object === 'hourly' ? '未来48小时' : object === 'minute' ? '未来120分钟' : '今天' }, inputs: { location, coordinates, time_ref: { type: 'string', default: 'today', resolver: 'relative_time' }, strict_time: { type: 'boolean', default: false } }, ...extra });

test('current weather defaults to a real instant while hourly defaults preserve an explicit window', () => {
  const current = resolveArguments(weather('current'), {}, context);
  assert.equal(current.status, 'ready_mock');
  assert.equal(current.arguments.time_ref.precision, 'instant');
  assert.equal(current.arguments.time_ref.at, '2026-10-10T08:00:00+08:00');
  assert.equal(current.resolution.time.requested.dataset, 'current');
  const hourly = resolveArguments(weather('hourly'), {}, context);
  assert.equal(hourly.arguments.time_ref.precision, 'hour');
  assert.equal(hourly.arguments.time_ref.startAt, '2026-10-10T08:00:00+08:00');
  assert.equal(hourly.arguments.time_ref.endAt, '2026-10-12T08:00:00+08:00');
});

test('minute availability fallback keeps the requested bounds and records the effective granularity', () => {
  const result = resolveArguments(weather('minute'), { location: '上海', time_ref: '未来30分钟' }, { ...context, weatherAvailability: { minute: false, hourly: true, daily: true, current: true } });
  assert.equal(result.status, 'ready_mock');
  assert.equal(result.resolution.time.requested.dataset, 'minute');
  assert.equal(result.resolution.time.requested.range.endAt, '2026-10-10T08:30:00+08:00');
  assert.equal(result.resolution.time.effective.dataset, 'hourly');
  assert.equal(result.resolution.time.fallback.applied, true);
  assert.ok(result.resolution.time.fallback.reason);
  assert.equal(result.arguments.time_ref.expression, '未来30分钟');
});

test('strict weather time rejects unavailable minute detail instead of silently lowering precision', () => {
  const result = resolveArguments(weather('minute'), { time_ref: '未来30分钟', strict_time: true }, { ...context, weatherAvailability: { minute: false, hourly: true, daily: true } });
  assert.equal(result.status, 'needs_clarification');
  assert.equal(result.resolution.time.effective, null);
  assert.match(result.issues.join(' '), /精度|严格|minute/);
});

test('a period request remains hourly and a precise future clock remains timestamped', () => {
  const period = resolveArguments(weather('hourly'), { time_ref: '明早' }, context);
  assert.equal(period.resolution.time.requested.dataset, 'hourly');
  assert.equal(period.arguments.time_ref.precision, 'period');
  assert.deepEqual(period.arguments.time_ref.period, { id: 'morning', start: '06:00', end: '12:00' });
  const exact = resolveArguments(weather('hourly'), { time_ref: '明天下午3点15分' }, context);
  assert.equal(exact.status, 'ready_mock');
  assert.equal(exact.arguments.time_ref.at, '2026-10-11T15:15:00+08:00');
  assert.equal(exact.resolution.time.requested.dataset, 'minute');
  assert.equal(exact.resolution.time.effective.dataset, 'hourly');
  assert.ok(exact.resolution.time.fallback.reason);
});

test('explicit coordinates bypass device location without inventing an administrative name', () => {
  const point = { latitude: 22.5431, longitude: 114.0579 };
  const result = resolveArguments(weather(), { coordinates: point }, { ...context, location: null, locationError: 'denied' });
  assert.equal(result.status, 'ready_mock');
  assert.equal(result.sources.location, 'user');
  assert.equal(result.resolution.location.precision, 'coordinates');
  assert.equal(result.resolution.location.effective.latitude, point.latitude);
  assert.equal(result.resolution.location.requested.coordinates.longitude, point.longitude);
});

test('named city geocoding records fixture provenance while preserving the original request', () => {
  const result = resolveArguments(weather(), { location: '杭州' }, { ...context, geocodes: { 杭州: { latitude: 30.2741, longitude: 120.1551, precision: 'city', source: 'fixture', label: '杭州' } } });
  assert.equal(result.arguments.location, '杭州');
  assert.equal(result.sources.location, 'user');
  assert.equal(result.resolution.location.requested.location, '杭州');
  assert.equal(result.resolution.location.effective.latitude, 30.2741);
  assert.equal(result.resolution.location.geocoding.source, 'fixture');
  assert.equal(result.resolution.location.precision, 'city');
});

test('unresolved broad regions do not become the current device point', () => {
  const result = resolveArguments(weather('daily', { support: { requiresGeocoding: true } }), { location: '华东地区' }, context);
  assert.equal(result.status, 'resolution_failed');
  assert.equal(result.resolution.location.effective, null);
  assert.match(result.issues.join(' '), /地理|位置|区域/);
});

test('coarse device position exposes accuracy and any precision fallback', () => {
  const result = resolveArguments(weather(), {}, { ...context, location: { ...context.location, source: 'browser', accuracyMeters: 5000, precision: 'coarse' } });
  assert.equal(result.status, 'ready_mock');
  assert.equal(result.resolution.location.precision, 'coarse');
  assert.equal(result.resolution.location.effective.accuracyMeters, 5000);
  assert.equal(result.resolution.location.fallback.applied, true);
});

const fileRead = { id: 'files.get', domain: 'files', risk: 'read', inputs: { file_id: { type: 'string', required: true, resolver: 'selected_object' } } };
test('only a trusted user selected object may supply a read target', () => {
  const objects = { file_id: { value: 'file_selected', trusted: true, source: 'user_selection' } };
  const result = resolveArguments(fileRead, {}, { ...context, objects });
  assert.equal(result.status, 'ready_mock');
  assert.equal(result.arguments.file_id, 'file_selected');
  assert.equal(result.sources.file_id, 'context');
  assert.equal(result.resolution.context[0].source, 'user_selection');
  const explicit = resolveArguments(fileRead, { file_id: 'file_explicit' }, { ...context, objects });
  assert.equal(explicit.arguments.file_id, 'file_explicit');
  const untrusted = resolveArguments(fileRead, {}, { ...context, objects: { file_id: { value: 'invented', trusted: false, source: 'model' } } });
  assert.equal(untrusted.status, 'needs_clarification');
});

test('write target and required time never auto-fill from selected objects or defaults', () => {
  const write = { ...fileRead, id: 'files.update', risk: 'write' };
  const result = resolveArguments(write, {}, { ...context, objects: { file_id: { value: 'selected', trusted: true, source: 'user_selection' } } });
  assert.equal(result.status, 'needs_clarification');
  assert.ok(!('file_id' in result.arguments));
  const calendar = { id: 'calendar.create', domain: 'calendar', risk: 'write', inputs: { starts_at: { type: 'string', resolver: 'datetime', required: true, default: '现在' } } };
  const missing = resolveArguments(calendar, {}, context);
  assert.equal(missing.status, 'needs_clarification');
  assert.ok(!('starts_at' in missing.arguments));
});

test('lexical candidate retrieval remains bounded and lets the model choose the field API', () => {
  assert.equal(typeof prompts.selectCandidates, 'function');
  const catalog = [{ id: 'weather.query', domain: 'weather', risk: 'read', aggregate: true, name: '综合天气', aliases: ['天气'], inputs: {} }, ...Array.from({ length: 80 }, (_, index) => ({ id: `weather.current.field${index}`, domain: 'weather', object: 'current', field: `field${index}`, risk: 'read', name: `字段${index}`, aliases: [`指标${index}`], inputs: {} })), { id: 'weather.hourly.humidity', domain: 'weather', object: 'hourly', field: 'humidity', risk: 'read', name: '湿度', aliases: ['湿度', '空气湿度', '相对湿度'], inputs: {} }, { id: 'weather.hourly.temperature', domain: 'weather', object: 'hourly', field: 'temperature', risk: 'read', name: '气温', aliases: ['气温', '温度'], inputs: {} }];
  const selected = prompts.selectCandidates('明早空气湿度和气温多少', 'weather', { catalog, limit: 6 });
  assert.ok(selected.length <= 6);
  assert.ok(selected.some(item => item.id === 'weather.hourly.humidity'));
  assert.ok(selected.some(item => item.id === 'weather.query'));
});

test('candidate retrieval prioritizes explicit writes over matching read field names', () => {
  assert.equal(typeof prompts.selectCandidates, 'function');
  const catalog = [{ id: 'contacts.get.phone', domain: 'contacts', name: '电话号码', risk: 'read', aliases: ['电话号码', '号码'], inputs: {} }, { id: 'contacts.update', domain: 'contacts', name: '更新联系人', risk: 'write', aliases: ['修改', '更改', '改成'], inputs: {} }];
  const selected = prompts.selectCandidates('把联系人号码改成13900139000', 'contacts', { catalog, limit: 1 });
  assert.equal(selected[0].id, 'contacts.update');
});

test('ISO minutes and native minute defaults preserve requested precision', () => {
  const exact = resolveArguments(weather('hourly'), { time_ref: '2026-10-10T08:15:00+08:00', strict_time: true }, context);
  assert.equal(exact.status, 'needs_clarification');
  assert.equal(exact.resolution.time.requested.precision, 'minute');
  const minute = resolveArguments(weather('minute', { inputDefaults: { time_ref: '未来两小时' } }), {}, context);
  assert.equal(minute.resolution.time.requested.dataset, 'minute');
  assert.equal(minute.resolution.time.requested.precision, 'minute');
  assert.equal(minute.resolution.time.fallback.applied, false);
  const explicit = resolveArguments(weather('minute'), { time_ref: '未来两小时每分钟' }, context);
  assert.equal(explicit.status, 'ready_mock');
  assert.equal(explicit.arguments.time_ref.expression, '未来两小时每分钟');
  assert.equal(explicit.arguments.time_ref.precision, 'minute');
});

test('future current getter routes only to a compatible forecast and unavailable intensity never changes units', () => {
  const humidity = resolveArguments(getCapability('weather.current.humidity'), { time_ref: '明早' }, context);
  assert.equal(humidity.status, 'ready_mock');
  assert.equal(humidity.resolution.time.effective.dataset, 'hourly');
  assert.equal(humidity.resolution.time.effective.api, 'weather.hourly.humidity');
  assert.match(humidity.resolution.time.fallback.reason, /未来|current/);
  const summary = resolveArguments(getCapability('weather.current.summary'), { time_ref: '明早' }, context);
  assert.equal(summary.status, 'needs_clarification');
  const intensity = resolveArguments(getCapability('weather.minute.precipitationIntensity'), { time_ref: '未来20分钟' }, { ...context, weatherAvailability: { minute: false, hourly: true } });
  assert.equal(intensity.status, 'needs_clarification');
  assert.equal(intensity.resolution.time.effective, null);
});

test('current cannot replace a future hourly humidity window even if it is available', () => {
  const future = resolveArguments(getCapability('weather.hourly.humidity'), { time_ref: '明早' }, { ...context, weatherAvailability: { hourly: false, current: true } });
  assert.equal(future.status, 'needs_clarification');
  const now = resolveArguments(getCapability('weather.hourly.humidity'), { time_ref: '现在' }, { ...context, weatherAvailability: { hourly: false, current: true } });
  assert.equal(now.status, 'ready_mock');
  assert.equal(now.resolution.time.effective.dataset, 'current');
});

test('city device fixtures declare representative point approximation and experiment provenance', () => {
  const result = resolveArguments(weather(), {}, { ...context, availabilitySource: 'fixture', location: { ...context.location, precision: 'city', accuracyMeters: 20000 } });
  assert.equal(result.resolution.location.fallback.applied, true);
  assert.match(result.resolution.location.fallback.reason, /代表点|城市|粗位置/);
  assert.equal(result.resolution.time.availabilitySource, 'fixture');
});

test('timezone and URI MIME defaults remain explicit and never add update fields', () => {
  const created = resolveArguments(getCapability('calendar.create'), { title: '讨论', starts_at: '明天下午3点' }, context);
  assert.equal(created.arguments.timezone, 'Asia/Shanghai');
  assert.equal(created.sources.timezone, 'system_timezone');
  assert.ok(created.resolution.context.some(item => item.field === 'timezone'));
  const changed = resolveArguments(getCapability('calendar.update'), { event_id: 'ev_1', changes: { title: '新标题' } }, context);
  assert.ok(!('timezone' in changed.arguments.changes));
  const known = resolveArguments(getCapability('files.preview'), { file_id: 'file:///tmp/report.PDF?download=1' }, context);
  assert.equal(known.arguments.mime_type, 'application/pdf');
  assert.equal(known.sources.mime_type, 'context');
  assert.match(known.resolution.context.find(item => item.field === 'mime_type').reason, /URI|后缀/);
  const unknown = resolveArguments(getCapability('files.preview'), { file_id: 'file_1' }, context);
  assert.equal(unknown.arguments.mime_type, '');
  assert.equal(unknown.sources.mime_type, 'default');
  const explicit = resolveArguments(getCapability('files.preview'), { file_id: 'file:///tmp/report.pdf', mime_type: 'custom/type' }, context);
  assert.equal(explicit.arguments.mime_type, 'custom/type');
});

test('global weather candidates retain aggregate and unrelated fields do not consume a generic query', () => {
  const selected = prompts.selectCandidates('明天北京下雨吗', undefined, { limit: 12 });
  assert.ok(selected.some(cap => cap.id === 'weather.query'));
  const generic = prompts.selectCandidates('查上海今天的天气', 'weather', { limit: 6 });
  assert.ok(generic.some(cap => cap.id === 'weather.query'));
  assert.ok(generic.every(cap => cap.aggregate || cap.lexicalScore > 0));
  const file = prompts.selectCandidates('它多大', undefined, { limit: 12, context: { objects: { file_id: { value: 'f_1', trusted: true, source: 'user_selection' } } } });
  assert.ok(file.some(cap => cap.domain === 'files' && cap.field === 'size'));
  assert.ok(file.every(cap => cap.domain !== 'weather'));
});

test('pipeline retains candidate evidence and a null mock projection contract', async () => {
  const provided = { ...context, objects: { file_id: { value: 'f_1', trusted: true, source: 'user_selection' } } };
  const cap = getCapability('files.metadata.size');
  assert.ok(cap);
  const run = await runPipeline({ text: '这个文件多大', model: 'fixture', context: provided }, { providers: { ollama: { async invoke(request) {
    const value = request.stage === 'domain' ? { domain: 'files' } : request.stage === 'intent' ? { api: cap.id } : Object.fromEntries(Object.keys(request.schema.properties).map(field => [field, null]));
    return { value, trace: { stage: request.stage, wallMs: 1 } };
  } } } });
  assert.equal(run.status, 'ready_mock');
  assert.ok(run.candidates.intent.ids.includes(cap.id));
  assert.equal(run.mock.value, null);
  assert.equal(run.mock.projection, cap.projection);
  assert.deepEqual(run.mock.outputContract, cap.returns);
  assert.equal(run.resolved.arguments.file_id, 'f_1');
});

test('specific and nested weather fields survive short catalogs without promoting a single field to multi-field', () => {
  assert.ok(prompts.selectCandidates('后天最高温度是多少', 'weather').some(cap => cap.id === 'weather.daily.highTemperature'));
  assert.ok(prompts.selectCandidates('后天白天湿度多少', 'weather').some(cap => cap.id === 'weather.daily.daytimeForecast.humidity'));
  assert.ok(prompts.selectCandidates('今晚月相描述', 'weather').some(cap => cap.id === 'weather.daily.moon.phase.description'));
  assert.ok(prompts.selectCandidates('现在气温和湿度', 'weather').some(cap => cap.id === 'weather.query'));
});

test('field nouns and identifiers between object and field do not turn reads into writes or hide field writes', () => {
  assert.ok(prompts.selectCandidates('查看资料对象ma_99的更新时间', 'cloud').some(cap => cap.id === 'materials.updated_at'));
  assert.ok(prompts.selectCandidates('把联系人ct_99的备注修改为供应商', 'contacts').some(cap => cap.id === 'contacts.set.note'));
  assert.ok(prompts.selectCandidates('读取云数据库Customers表记录row_99的name字段', 'cloud').some(cap => cap.id === 'cloud.database.field'));
  assert.ok(prompts.selectCandidates('云数据库Sales表amount字段求平均', 'cloud').some(cap => cap.id === 'cloud.database.calculate'));
  assert.ok(prompts.selectCandidates('云文件test/report.pdf下载地址', 'cloud').some(cap => cap.id === 'cloud.storage.download_url'));
  assert.ok(prompts.selectCandidates('下载云文件test/report.pdf到本地D:/test/report.pdf', 'cloud').some(cap => cap.id === 'cloud.storage.download'));
});

test('offline corpus audit retains gold APIs in bounded staged and unified candidates', () => {
  // Gold is read only by this offline test. Runtime retrieval uses catalog metadata and user text only.
  const cases = JSON.parse(readFileSync(new URL('../data/cases.json', import.meta.url), 'utf8')).filter(item => item.expected.api);
  assert.ok(cases.length >= 151);
  for (const item of cases) for (const mode of ['staged', 'unified']) {
    const limit = mode === 'staged' ? 6 : 12;
    const selected = prompts.selectCandidates(item.text, mode === 'staged' ? item.expected.domain : undefined, { limit, context: item.context ?? {} });
    assert.ok(selected.length <= limit, `${item.id} ${mode} exceeds the catalog budget`);
    assert.ok(selected.some(cap => cap.id === item.expected.api), `${item.id} ${mode}: missing ${item.expected.api}; candidates ${selected.map(cap => cap.id).join(',')}`);
  }
});

test('compact schemas keep business description fields and every required property remains declared', () => {
  for (const cap of capabilities) {
    const schema = prompts.buildArgumentsPrompt('验证参数壳子', cap).schema;
    const value = Object.fromEntries(Object.keys(schema.properties).map(field => [field, null]));
    assert.equal(validateValue(schema, value).valid, true, cap.id);
  }
  const cap = getCapability('calendar.update');
  const schema = prompts.buildArgumentsPrompt('修改说明', cap).schema;
  const changes = Object.fromEntries(Object.keys(cap.inputs.changes.properties).map(field => [field, field === 'description' ? '新的业务说明' : null]));
  const value = Object.fromEntries(Object.keys(cap.inputs).map(field => [field, field === 'changes' ? changes : null]));
  assert.equal(validateValue(schema, value).valid, true);
  assert.equal(schema.properties.changes.anyOf[0].properties.description.anyOf[0].type, 'string');
});

test('weather mock projection follows the effective API and retains the requested route', async () => {
  const cap = getCapability('weather.current.humidity');
  const effective = getCapability('weather.hourly.humidity');
  const run = await runPipeline({ text: '查当前实况湿度，时间范围为明早', model: 'fixture', context }, { providers: { ollama: { async invoke(request) {
    const value = request.stage === 'domain' ? { domain: 'weather' } : request.stage === 'intent' ? { api: cap.id } : Object.fromEntries(Object.keys(request.schema.properties).map(field => [field, field === 'time_ref' ? '明早' : null]));
    return { value, trace: { stage: request.stage, wallMs: 1 } };
  } } } });
  assert.equal(run.status, 'ready_mock');
  assert.equal(run.api, cap.id);
  assert.equal(run.mock.requestedApi, cap.id);
  assert.equal(run.mock.api, effective.id);
  assert.equal(run.mock.projection, effective.projection);
  assert.deepEqual(run.mock.outputContract, effective.returns);
});

test('weather field routing excludes unavailable meanings rather than equating minute resolution with every weather field', () => {
  const minuteHumidity = prompts.selectCandidates('杭州精确到这一分钟的湿度，不接受小时数据', undefined, { limit: 12 });
  assert.ok(minuteHumidity.some(cap => cap.id === 'weather.hourly.humidity'));
  assert.ok(!minuteHumidity.some(cap => cap.id === 'weather.minute.overview'));
  const current = prompts.selectCandidates('现在湿度多少', undefined, { limit: 12 });
  assert.ok(current.length <= 4, `${current.length} weather candidates`);
  assert.equal(current[0].id, 'weather.current.humidity');
  assert.ok(!current.some(cap => cap.object === 'alerts' || cap.object === 'indices' || cap.object === 'tides'));
});

test('unified prompts teach sparse explicit extraction and only present relevant slot rules', () => {
  const weather = prompts.buildUnifiedPrompt('后天凌晨气温多少').messages[0].content;
  assert.ok(weather.includes('显式时间保留原文'));
  assert.ok(weather.includes('minute仅降水'));
  assert.ok(weather.includes('二选一'));
  assert.ok(!weather.includes('phone号码'));
  assert.ok(weather.length < 1200, `weather chars=${weather.length}`);
  const calendar = prompts.buildUnifiedPrompt('这个日程的地点', { objects: { event_id: { value: 'private_event_id', trusted: true, source: 'user_selection' } } }).messages[0].content;
  assert.ok(calendar.includes('指代不是ID'));
  assert.ok(calendar.includes('不输出ID'));
  assert.ok(calendar.includes('字段名不能作keyword/query'));
  assert.ok(!calendar.includes('private_event_id'));
  assert.ok(!calendar.includes('已选对象:event_id'));
  const cloud = prompts.buildUnifiedPrompt('调用云函数统计，正文是{"count":4}').messages[0].content;
  assert.ok(cloud.includes('version/timeout_ms未明说不输出'));
  assert.ok(cloud.includes('data完整复制正文'));
  assert.ok(!cloud.includes('天气data_needs'));
});

test('explicit field queries and actions remove irrelevant domains and competing catalog filler', () => {
  const database = prompts.selectCandidates('读取云数据库Customers表记录customer_1的title字段', undefined, { limit: 12 });
  assert.ok(database.some(cap => cap.id === 'cloud.database.field'));
  assert.ok(database.every(cap => cap.domain === 'cloud'));
  const service = prompts.selectCandidates('通讯录服务是否可用', undefined, { limit: 12 });
  assert.equal(service[0].id, 'services.availability');
  assert.ok(service.every(cap => cap.domain === 'services'));
  const cloud = prompts.selectCandidates('调用云函数计算', undefined, { limit: 12 });
  assert.ok(cloud.length <= 3);
  assert.equal(cloud[0].id, 'cloud.function.call');
});

test('special weather objects distinguish requested date windows from returned native data precision', () => {
  const tides = resolveArguments(getCapability('weather.tides.hourlyTides.height'), { time_ref: '今天' }, context);
  assert.equal(tides.status, 'ready_mock');
  assert.equal(tides.resolution.time.requested.precision, 'day');
  assert.equal(tides.resolution.time.effective.precision, 'hour');
  assert.equal(tides.resolution.time.effective.range.start, '2026-10-10');
  const indices = resolveArguments(getCapability('weather.indices.dailyItems.content'), {}, context);
  assert.equal(indices.resolution.time.effective.precision, 'day');
  const city = resolveArguments(getCapability('weather.city.timezone'), {}, context);
  assert.equal(city.resolution.time.effective.precision, 'instant');
});

test('conditional read defaults do not add a date filter to an explicit or trusted selected target', () => {
  const cap = { id: 'calendar.event.get', domain: 'calendar', risk: 'read', inputs: { event_id: { type: 'string', resolver: 'selected_object' }, time_ref: { type: 'string', resolver: 'relative_time', default: 'today', defaultUnlessPresent: ['event_id'] } } };
  const explicit = resolveArguments(cap, { event_id: 'e_1' }, context);
  assert.ok(!('time_ref' in explicit.arguments));
  assert.ok(!('time_ref' in explicit.sources));
  const selected = resolveArguments(cap, {}, { ...context, objects: { event_id: { value: 'e_2', trusted: true, source: 'user_selection' } } });
  assert.equal(selected.arguments.event_id, 'e_2');
  assert.ok(!('time_ref' in selected.arguments));
  const period = resolveArguments(cap, { event_id: 'e_1', time_ref: '后天' }, context);
  assert.equal(period.arguments.time_ref.expression, '后天');
  const unselected = resolveArguments(cap, {}, context);
  assert.equal(unselected.arguments.time_ref.start, '2026-10-10');
});

test('a single field inside an array does not look like two independent contact fields', () => {
  const catalog = [
    { id: 'contacts.phone', domain: 'contacts', object: 'Contact', field: 'phoneNumbers', name: '电话号码', risk: 'read', aliases: ['电话'], inputs: {} },
    { id: 'contacts.phoneNumbers.labelName', domain: 'contacts', object: 'Contact', field: 'phoneNumbers[].labelName', name: '号码标签', risk: 'read', aliases: ['电话标签'], inputs: {} },
    { id: 'contacts.get', domain: 'contacts', object: 'Contact', field: '*', aggregate: true, name: '联系人详情', risk: 'read', aliases: [], inputs: {} }
  ];
  const candidates = prompts.selectCandidates('查看电话号码的电话标签', 'contacts', { catalog });
  assert.equal(candidates[0].id, 'contacts.phoneNumbers.labelName');
});

test('new leaf scenarios prefer the explicit field while preserving the compact prompt budget', () => {
  const cases = JSON.parse(readFileSync(new URL('../data/cases.json', import.meta.url), 'utf8'));
  const addedIds = ['cx10', 'cx11', 'cx12', 'cx13', 'cx14', 'cx15', 'px13', 'px14', 'px15', 'px16', 'px17', 'px18'];
  for (const id of addedIds) {
    const item = cases.find(entry => entry.id === id);
    assert.ok(item, `missing offline leaf scenario ${id}`);
    for (const mode of ['staged', 'unified']) {
      const selected = prompts.selectCandidates(item.text, mode === 'staged' ? item.expected.domain : undefined, { limit: mode === 'staged' ? 6 : 12, context: item.context ?? {} });
      assert.equal(selected[0].id, item.expected.api, `${id} ${mode} must prefer the explicit leaf`);
    }
    const prompt = prompts.buildUnifiedPrompt(item.text, item.context ?? {});
    assert.equal(prompt.promptMeta.version, 'sparse-v6');
    assert.ok(prompt.promptMeta.systemChars < 1200, `${id} chars=${prompt.promptMeta.systemChars}`);
  }
});

test('leaf expansion retains the exact candidate lists used by the frozen 324 API validation scenarios', () => {
  // Both catalogs are compared by metadata alone; gold APIs remain offline assertions only.
  const frozen = JSON.parse(readFileSync(new URL('../data/catalog-benchmark-v2.json', import.meta.url), 'utf8')).capabilities;
  const caseIds = JSON.parse(readFileSync(new URL('../docs/validation-v4.json', import.meta.url), 'utf8')).caseIds;
  const cases = JSON.parse(readFileSync(new URL('../data/cases.json', import.meta.url), 'utf8'));
  assert.equal(frozen.length, 324);
  assert.equal(caseIds.length, 12);
  for (const id of caseIds) {
    const item = cases.find(entry => entry.id === id);
    for (const mode of ['staged', 'unified']) {
      const domain = mode === 'staged' ? item.expected.domain : undefined;
      const options = { limit: mode === 'staged' ? 6 : 12, context: item.context ?? {} };
      const before = prompts.selectCandidates(item.text, domain, { ...options, catalog: frozen }).map(cap => cap.id);
      const after = prompts.selectCandidates(item.text, domain, options).map(cap => cap.id);
      assert.deepEqual(after, before, `${id} ${mode} changed the benchmark candidate list`);
    }
  }
});
