import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROMPT_VERSION, buildArgumentsPrompt, buildIntentPrompt, buildUnifiedPrompt, selectCandidates } from '../src/prompts.mjs';
import { getCapability } from '../src/registry.mjs';
import { validateValue } from '../src/providers.mjs';

test('v7 exposes optional display arguments without changing frozen v6 evidence', () => {
  assert.equal(PROMPT_VERSION, 'explicit-v7');
  const frozen = readFileSync(new URL('../data/benchmark-sparse-v6/src/prompts.mjs', import.meta.url), 'utf8');
  assert.match(frozen, /PROMPT_VERSION = 'sparse-v6'/);
  const prompt = buildUnifiedPrompt('预览file:///D:/demo/figure.png，窗口标题为结果图');
  assert.match(prompt.messages[0].content, /files\.preview=.*\(file_id,mime_type,title\)/);
  assert.match(prompt.messages[0].content, /title=.*预览窗口标题/);
  assert.match(prompt.messages[0].content, /URI前缀.*#片段/);
  const branch = prompt.schema.oneOf.find(item => item.properties.api.const === 'files.preview');
  assert.equal(validateValue(branch, { domain: 'files', api: 'files.preview', arguments: { file_id: 'file:///D:/demo/figure.png', title: '结果图' } }).valid, true);
});

test('navigation query values are described inside parameters rather than as a contact search', () => {
  const prompt = buildUnifiedPrompt('打开通讯录服务页\nquery：张 三');
  assert.match(prompt.messages[0].content, /parameters=\{query=页面搜索词原文\}/);
  assert.match(prompt.messages[0].content, /parameters\.query.*不能放顶层query/);
  assert.equal(prompt.messages[1].content, '打开通讯录服务页\nquery：张 三');
  const branch = prompt.schema.oneOf.find(item => item.properties.api.const === 'services.open');
  assert.equal(validateValue(branch, { domain: 'services', api: 'services.open', arguments: { service: 'contacts', parameters: { query: '张 三' } } }).valid, true);
  assert.equal(validateValue(branch, { domain: 'services', api: 'services.open', arguments: { service: 'contacts', query: '张 三' } }).valid, false);
});

test('a setter describes its new value and nested changes instead of requiring query outputs', () => {
  const prompt = buildUnifiedPrompt('修改日程ev_20的标题为设计评审，提前15分钟提醒');
  assert.match(prompt.messages[0].content, /changes=\{title=日程新标题/);
  assert.match(prompt.messages[0].content, /reminder_minutes=.*分钟/);
  assert.ok(prompt.promptMeta.candidates.ids.includes('calendar.update'));
  const fields = buildArgumentsPrompt('读取日程ev_20的标题', getCapability('calendar.event.title'));
  assert.ok(!Object.hasOwn(fields.schema.properties, 'title'));
});

test('candidate labels distinguish a leaf, a compound object, and an aggregate', () => {
  const prompt = buildUnifiedPrompt('深圳当前风速');
  assert.match(prompt.messages[0].content, /weather\.current\.wind\.speed=.*\[字段\]/);
  assert.match(prompt.messages[0].content, /weather\.query=.*\[整体\]/);
  const object = buildUnifiedPrompt('杭州现在完整风信息');
  assert.match(object.messages[0].content, /weather\.current\.wind=.*\[对象\]/);
});

test('ordinary contact value nouns retain leaves while explicit whole objects retain parents', () => {
  for (const [text, api] of [
    ['读取联系人ID ct_7的电话号码', 'contacts.phoneNumbers.phoneNumber'],
    ['读取联系人ID ct_7的电子邮箱地址', 'contacts.emails.email'],
    ['读取联系人ID ct_7的主页网址', 'contacts.websites.website'],
    ['联系人ct_7完整邮箱对象', 'contacts.email'],
    ['联系人ct_7完整电话对象与标签', 'contacts.phone']
  ]) for (const [domain, limit] of [['contacts', 6], [undefined, 12]]) {
    assert.ok(selectCandidates(text, domain, { limit }).some(cap => cap.id === api), text);
  }
  const email = selectCandidates('读取联系人ID ct_7的电子邮箱地址', 'contacts', { limit: 6 });
  assert.equal(email[0].id, 'contacts.emails.email');
  const whole = selectCandidates('联系人ct_7完整邮箱对象', 'contacts', { limit: 6 });
  assert.equal(whole[0].id, 'contacts.email');
});

test('a negated scalar does not become positive multi-field evidence', () => {
  const found = selectCandidates('深圳现在的风速，不要风向', 'weather', { limit: 6 });
  assert.ok(found.some(cap => cap.id === 'weather.current.wind.speed'));
  assert.ok(!found.some(cap => cap.id === 'weather.current.wind.direction'));
  assert.ok(found.every(cap => !cap.matchedAliases.some(term => /风向/.test(term))));
});

test('quoted and labeled search payloads do not inject unrelated business domains', () => {
  for (const text of ['查找文件，关键词“天气和会议日程”', '查找文件，关键词：天气湿度']) {
    const prompt = buildUnifiedPrompt(text);
    assert.ok(prompt.promptMeta.candidates.ids.includes('files.search'));
    assert.ok(prompt.schema.oneOf.every(branch => ['files', 'unsupported'].includes(branch.properties.domain.const)));
    assert.equal(prompt.messages[1].content, text);
  }
});

test('quoting the requested field itself retains the intended weather getter', () => {
  const result = selectCandidates('杭州现在查“湿度”', undefined, { limit: 12 });
  assert.ok(result.some(cap => cap.id === 'weather.current.humidity'));
});

test('querying open-state remains a read while the negative action is ignored', () => {
  const prompt = buildIntentPrompt('这个服务能否打开，先不要打开它', 'services');
  assert.ok(prompt.promptMeta.candidates.ids.includes('services.availability'));
  assert.match(prompt.messages[0].content, /问能否打开.*是查状态/);
});

test('explicit values take priority over selected objects and preserve raw time precision', () => {
  const prompt = buildUnifiedPrompt('读取文件file_explicit的名称', { objects: { file_id: { value: 'file_other', source: 'user_selection', trusted: true } } });
  assert.match(prompt.messages[0].content, /本句明确值优先/);
  assert.match(prompt.messages[0].content, /明确给出的必提取.*不能因可补全而省略/);
  assert.ok(!prompt.messages[0].content.includes('file_other'));
  const temporal = buildArgumentsPrompt('深圳未来30分钟每分钟降水强度', getCapability('weather.minute.precipitationIntensity'));
  assert.match(temporal.messages[0].content, /未来\/每分钟.*精度词/);
});

test('explicit device battery temperature cannot acquire a weather temperature alternative', () => {
  const catalog = [
    { id: 'device.battery.temperature', name: '电池温度', domain: 'device', object: 'battery', field: 'temperature', risk: 'read', inputs: {}, aliases: ['电池温度'] },
    { id: 'weather.current.temperature', name: '天气温度', domain: 'weather', object: 'current', field: 'temperature', risk: 'read', inputs: {}, aliases: ['气温'] }
  ];
  const result = selectCandidates('查询手机电池温度', undefined, { catalog, limit: 12 });
  assert.ok(result.some(cap => cap.id === 'device.battery.temperature'));
  assert.ok(!result.some(cap => cap.domain === 'weather'));
});

test('single system-service corpus retains its API and records geocode relation evidence', () => {
  const cases = JSON.parse(readFileSync(new URL('../data/cases-system-single.json', import.meta.url), 'utf8'));
  for (const item of cases) for (const [domain, limit] of [[item.expected.domain, 6], [undefined, 12]]) {
    const candidates = selectCandidates(item.text, domain, { limit });
    assert.ok(candidates.some(cap => cap.id === item.expected.api), `${item.id}: ${item.expected.api}`);
  }
  const forward = buildUnifiedPrompt('把地址“上海市浦东新区世纪大道1号”转换成经纬度');
  assert.ok(forward.promptMeta.candidates.scores.find(cap => cap.id === 'location.geocode').matchedRelations.includes('地址→坐标'));
  const reverse = buildUnifiedPrompt('纬度31.2304、经度121.4737对应什么地址');
  assert.ok(reverse.promptMeta.candidates.scores.find(cap => cap.id === 'location.reverse_geocode').matchedRelations.includes('坐标/当前位置→地址'));
  assert.match(reverse.messages[0].content, /coordinates=\{latitude=纬度,longitude=经度\}/);
});

test('native status reads have empty input schemas and audio reads expose native stream meanings', () => {
  const battery = buildArgumentsPrompt('查询当前电池温度', getCapability('device.battery.temperature'));
  assert.deepEqual(battery.schema.properties, {});
  assert.equal(validateValue(battery.schema, { temperature: 30 }).valid, false);
  const audio = buildUnifiedPrompt('查询通话音量');
  assert.match(audio.messages[0].content, /通话VOICE_COMMUNICATION/);
  assert.match(audio.messages[0].content, /stream_type=.*未说由系统取当前音频流/);
});

test('semantic details stay bounded for common read and write candidate sets', () => {
  for (const text of ['查后天日程', '查张三联系人', '查找文件，关键词：合同修订稿', '修改日程ev_20的标题为评审', '深圳当前风速']) {
    const prompt = buildUnifiedPrompt(text);
    assert.ok(prompt.promptMeta.candidates.ids.length <= 12);
    assert.ok(prompt.promptMeta.systemChars <= 2800, `${text}: ${prompt.promptMeta.systemChars}`);
    assert.ok(!/"description":"/.test(JSON.stringify(prompt.schema)));
  }
});
