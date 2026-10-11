import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getCapability, listCapabilities, validateArguments} from '../src/registry.mjs';
import {resolveArguments} from '../src/resolver.mjs';
import {experimentDefaults, evaluationSystemDefaults} from '../src/fixtures.mjs';
import {coreSingleServiceCases} from '../data/single-service-core.mjs';

// The JSON contains independently handwritten gold. These checks do not invoke
// a model, candidate retrieval or grounding, and never generate/update gold.
const cases = JSON.parse(readFileSync(new URL('../data/single-service-100-files-services-cloud.json', import.meta.url), 'utf8'));
const domains = ['files', 'services', 'cloud'];
const base = {
  ...experimentDefaults, ...evaluationSystemDefaults,
  now: '2026-10-10T08:00:00+08:00', timezone: 'Asia/Shanghai',
  location: {latitude: 31.2304, longitude: 121.4737, source: 'fixture'}
};
const byScenario = scenario => {
  const row = cases.find(item => item.scenario === scenario);
  assert.ok(row, scenario);
  return row;
};

test('270 new single-service rows provide exactly IDs 011–100 in the three assigned domains', () => {
  assert.equal(cases.length, 270);
  assert.equal(new Set(cases.map(item => item.id)).size, 270);
  assert.equal(new Set(cases.map(item => item.text)).size, 270);
  const originalTexts = new Set(coreSingleServiceCases.map(item => item.text));
  for (const domain of domains) {
    const rows = cases.filter(item => item.testDomain === domain);
    assert.equal(rows.length, 90, domain);
    assert.ok(new Set(rows.map(item => item.category)).size >= 12, `${domain}: meaningful boundary categories`);
    for (let index = 0; index < rows.length; index++) {
      assert.equal(rows[index].id, `e100-${domain}-${String(index + 11).padStart(3, '0')}`);
    }
  }
  for (const item of cases) {
    assert.equal(item.suite, 'single-service-100-v1', item.id);
    assert.equal(item.singleService, true, item.id);
    assert.ok(domains.includes(item.testDomain), item.id);
    assert.match(item.category, /[\u3400-\u9fff]/, item.id);
    assert.match(item.scenario, /^[a-z][a-z_]+$/, item.id);
    assert.match(item.text, /[\u3400-\u9fff]/, item.id);
    assert.equal(originalTexts.has(item.text), false, `${item.id}: not a duplicate of the existing ten`);
    assert.equal(item.expected.domain, item.testDomain, item.id);
    assert.equal(typeof item.expected.api, 'string', item.id);
    assert.ok(['ready_mock', 'needs_clarification'].includes(item.expected.status), item.id);
    assert.ok(item.expected.arguments && typeof item.expected.arguments === 'object' && !Array.isArray(item.expected.arguments), item.id);
  }
});

test('hand-authored new rows cover every registered API in files, services and cloud', () => {
  for (const domain of domains) {
    const covered = [...new Set(cases.filter(item => item.testDomain === domain).map(item => item.expected.api))].sort();
    const available = listCapabilities(domain).map(item => item.id).sort();
    assert.deepEqual(covered, available, domain);
    assert.ok(cases.some(item => item.testDomain === domain && item.expected.status === 'needs_clarification'), `${domain}: omission boundaries`);
    assert.ok(cases.some(item => item.testDomain === domain && item.category === '可信选中'), `${domain}: trusted read selection`);
    assert.ok(cases.some(item => item.testDomain === domain && item.category === '引用载荷'), `${domain}: payload words are not extra actions`);
    assert.ok(cases.some(item => item.testDomain === domain && item.category === '否定目标'), `${domain}: negated target distractors`);
  }
});

test('manual gold fits schemas and independently annotated resolver statuses and sources', () => {
  const failures = [];
  for (const item of cases) {
    const capability = getCapability(item.expected.api);
    assert.ok(capability, item.id);
    assert.equal(capability.domain, item.testDomain, item.id);
    const original = structuredClone(item.expected.arguments);
    const syntax = validateArguments(capability, item.expected.arguments);
    assert.ok(syntax.valid, `${item.id}: ${syntax.issues.join('; ')}`);
    const resolved = resolveArguments(capability, item.expected.arguments, {...base, ...item.context});
    assert.deepEqual(item.expected.arguments, original, `${item.id}: no mutation or repair of gold`);
    if (resolved.status !== item.expected.status) failures.push(`${item.id}: ${resolved.status} != ${item.expected.status}; ${resolved.issues.join('; ')}`);
    for (const [field, source] of Object.entries(item.expected.sources ?? {})) {
      if (resolved.sources[field] !== source) failures.push(`${item.id}.${field}: ${resolved.sources[field]} != ${source}`);
    }
    for (const [field, source] of Object.entries(resolved.sources)) {
      if (source !== 'user') assert.equal(item.expected.sources?.[field], source, `${item.id}.${field}: manually annotate every automatic source`);
      if (source === 'context' && capability.inputs[field]?.resolver === 'selected_object') {
        assert.equal(capability.risk, 'read', `${item.id}: no selected navigation/write target`);
        const selection = item.context?.objects?.[capability.inputs[field].contextKey ?? field];
        assert.equal(selection?.trusted, true, item.id);
        assert.equal(selection?.source, 'user_selection', item.id);
      }
    }
    if (capability.risk === 'write') assert.ok(!Object.values(resolved.sources).includes('context'), `${item.id}: never infer a write target`);
  }
  assert.deepEqual(failures, []);
});

test('explicit text gold retains URI components, quoted JSON, whitespace and multiline payloads', () => {
  assert.equal(byScenario('preview_uri_components').expected.arguments.file_id, 'file:///data/a%20b.PDF?rev=7&key=A%2BB#page=4');
  assert.equal(byScenario('search_quote_inside').expected.arguments.keyword, '他说"确认"');
  assert.equal(byScenario('search_multiline').expected.arguments.keyword, '第一行\n第二行');
  assert.equal(byScenario('open_nested_text').expected.arguments.parameters.query, '{"action":"share"}');
  assert.equal(byScenario('parse_repeated_keys').expected.arguments.url, 'https://example.com/app?tag=a&tag=b&empty=');
  assert.equal(byScenario('save_multiline_body').expected.arguments.content, '第一项：验收。\n第二项：归档。');
  assert.equal(byScenario('function_body_metadata_not_outer').expected.arguments.data, '{"version":"body-v9","timeout_ms":0,"ok":false}');
  assert.equal(byScenario('function_body_metadata_not_outer').expected.arguments.version, undefined);
  assert.equal(byScenario('function_body_metadata_not_outer').expected.arguments.timeout_ms, undefined);
});

test('manual boundary gold separates path roles, read defaults, opaque targets and navigation', () => {
  const upload = byScenario('storage_upload_literal_paths').expected.arguments;
  assert.equal(upload.local_path, '/data/My Docs/A+B.txt');
  assert.equal(upload.cloud_path, 'team/My Docs/A+B.txt');
  for (const scenario of ['share_name_not_id', 'share_title_not_id', 'share_selected_not_allowed', 'storage_upload_missing_local', 'storage_download_selection_not_allowed', 'open_selection_not_allowed']) {
    assert.equal(byScenario(scenario).expected.status, 'needs_clarification', scenario);
  }
  assert.deepEqual(byScenario('preview_unknown_suffix').expected.sources, {mime_type: 'default'});
  assert.deepEqual(byScenario('preview_selected_uri').expected.sources, {file_id: 'context', mime_type: 'context'});
  assert.deepEqual(byScenario('prefetch_result_default_mode').expected.sources, {mode: 'default'});
  for (const scenario of ['is_open_context_independent', 'close_context_independent', 'deferred_ignore_selected_url']) {
    assert.deepEqual(byScenario(scenario).expected.arguments, {}, scenario);
  }
});
