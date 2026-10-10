import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getCapability, validateArguments } from '../src/registry.mjs';
import { resolveArguments } from '../src/resolver.mjs';
import { experimentDefaults } from '../src/fixtures.mjs';

const readCases = () => JSON.parse(readFileSync(new URL('../data/cases-domain-other.json', import.meta.url), 'utf8'));
const baseContext = { ...experimentDefaults, now: '2026-10-10T08:00:00+08:00', timezone: 'Asia/Shanghai', location: { latitude: 31.2304, longitude: 121.4737, label: '上海（固定实验位置）', source: 'fixture' } };

test('other-domain suite has exactly fifty distinct, annotated cases for each assigned domain', () => {
  const cases = readCases();
  assert.equal(cases.length, 150);
  const ids = new Set(), texts = new Set();
  for (const item of cases) {
    assert.equal(item.suite, 'domain-50-v1');
    assert.ok(['files', 'services', 'cloud'].includes(item.testDomain));
    assert.match(item.id, new RegExp(`^d50-${item.testDomain}-\\d{3}$`));
    assert.match(item.scenario, /^[a-z][a-z_]+$/);
    assert.ok(/[\u3400-\u9fff]/.test(item.category));
    assert.ok(item.note.length >= 8, `${item.id} needs its distinguishing condition`);
    assert.ok(!ids.has(item.id), `duplicate id ${item.id}`); ids.add(item.id);
    assert.ok(!texts.has(item.text), `duplicate text ${item.id}`); texts.add(item.text);
    assert.ok(item.expected.arguments && !Object.values(item.expected.arguments).includes(null), `${item.id} gold represents omission as absent keys`);
    if (!item.expected.api) {
      assert.equal(item.expected.domain, 'unsupported');
      assert.equal(item.expected.status, 'unsupported');
      assert.deepEqual(item.expected.arguments, {});
    } else assert.equal(item.expected.domain, item.testDomain);
  }
  for (const domain of ['files', 'services', 'cloud']) {
    const rows = cases.filter(item => item.testDomain === domain);
    assert.equal(rows.length, 50, domain);
    assert.ok(new Set(rows.map(item => item.scenario)).size >= 8, `${domain} needs structural scenario variety`);
    for (let index = 1; index <= 50; index++) assert.ok(ids.has(`d50-${domain}-${String(index).padStart(3, '0')}`));
    assert.ok(rows.some(item => item.expected.status === 'needs_clarification'), `${domain} needs missing-input scenarios`);
    assert.ok(rows.some(item => item.expected.status === 'unsupported'), `${domain} needs rejection scenarios`);
    assert.ok(rows.some(item => item.scenario === 'prompt_injection'), `${domain} needs injection scenarios`);
  }
});

test('manual argument and source gold agrees with contracts without fabricating selected write targets or model defaults', () => {
  const mismatches = [];
  for (const item of readCases()) {
    if (!item.expected.api) continue;
    const capability = getCapability(item.expected.api);
    assert.ok(capability, `${item.id}: unregistered API`);
    assert.equal(capability.domain, item.expected.domain, item.id);
    const validation = validateArguments(capability, item.expected.arguments);
    assert.ok(validation.valid, `${item.id}: ${validation.issues.join('; ')}`);
    const actual = resolveArguments(capability, item.expected.arguments, { ...baseContext, ...item.context });
    if (actual.status !== item.expected.status) mismatches.push(`${item.id} status ${actual.status}, expected ${item.expected.status}: ${actual.issues.join('; ')}`);
    for (const [field, source] of Object.entries(item.expected.sources ?? {})) {
      if (actual.sources[field] !== source) mismatches.push(`${item.id}.${field} source ${actual.sources[field]}, expected ${source}`);
    }
    // Every automatic fill is manually annotated, even when arguments remain empty.
    for (const [field, source] of Object.entries(actual.sources)) if (source !== 'user') {
      assert.equal(item.expected.sources?.[field], source, `${item.id}.${field}: missing manual default/context source gold`);
    }
    for (const [field, spec] of Object.entries(capability.inputs)) {
      if (spec.resolver === 'selected_object' && item.expected.arguments[field] === undefined && actual.sources[field] === 'context') {
        const selected = item.context?.objects?.[spec.contextKey ?? field];
        assert.equal(capability.risk, 'read', `${item.id}: selection must not complete writes/navigation`);
        assert.equal(selected?.trusted, true);
        assert.equal(selected?.source, 'user_selection');
      }
    }
  }
  assert.deepEqual(mismatches, []);
});
