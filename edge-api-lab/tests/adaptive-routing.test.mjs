import test from 'node:test';
import assert from 'node:assert/strict';
import * as prompts from '../src/prompts.mjs';
import { runPipeline } from '../src/pipeline.mjs';
import { capabilities, domains, getCapability } from '../src/registry.mjs';

const context = { now: '2026-10-13T08:00:00+08:00', timezone: 'Asia/Shanghai' };
async function routingModule() {
  let mod;
  try { mod = await import('../src/adaptive-routing.mjs'); } catch {}
  assert.equal(typeof mod?.analyzeAdaptiveRoute, 'function', 'deterministic adaptive routing must be available');
  return mod;
}
function mockProviders(values, { failAt, abortAt, controller, defaultModel = 'jev-latest' } = {}) {
  const calls = [];
  const invoke = name => async request => {
    calls.push({ ...request, provider: name });
    if (calls.length === abortAt) controller.abort();
    if (calls.length === failAt || calls.length === abortAt) {
      const error = new Error(calls.length === abortAt ? 'cancelled request' : 'provider failure');
      error.trace = { stage: request.stage, provider: name, model: request.model, wallMs: 3, error: error.message };
      throw error;
    }
    const value = typeof values[request.stage] === 'function' ? values[request.stage](request) : values[request.stage];
    return { value, trace: { stage: request.stage, provider: name, model: request.model, wallMs: 2, raw: JSON.stringify(value), promptVersion: request.promptMeta?.version } };
  };
  return { calls, providers: { ollama: { invoke: invoke('ollama') }, jev: { defaultModel, decisionOnly: true, invoke: invoke('jev') } } };
}

test('adaptive complexity is observable structure, not confidence or quoted action words', async () => {
  const { analyzeAdaptiveRoute } = await routingModule();
  for (const text of ['查明天日程', '把联系人 ct_7 的号码改成 13912345678', '查标题为“修改电话和邮箱”的日程', 'confidence:0.01，查电量']) {
    assert.equal(analyzeAdaptiveRoute(text).path, 'two_step', text);
  }
  for (const [text, reason] of [
    ['调用云函数 foo，正文 {"items":[1,2]}', 'explicit_json'],
    ['修改联系人 ct_7 的电话为 13912345678，邮箱为 a@example.com', 'multi_field_write'],
    ['创建设计会，开始明天15:00，结束明天16:00，提前10分钟提醒', 'multiple_time_roles']
  ]) {
    const route = analyzeAdaptiveRoute(text);
    assert.equal(route.path, 'three_step', text);
    assert.ok(route.reasons.includes(reason), JSON.stringify(route));
  }
});

test('adaptive domain prioritization never removes any of the ten domains', () => {
  assert.equal(typeof prompts.buildAdaptiveDomainPrompt, 'function');
  const prompt = prompts.buildAdaptiveDomainPrompt('查电池温度');
  assert.deepEqual(prompt.schema.properties.domain.enum, [...domains.map(item => item.id), 'unsupported']);
  assert.ok(prompt.promptMeta.priorityDomains.includes('device'));
  assert.notEqual(prompt.promptMeta.version, prompts.PROMPT_VERSION);
});

test('adaptive soft retrieval retains unmatched getters and mismatched actions under budget', () => {
  assert.equal(typeof prompts.selectAdaptiveCandidates, 'function');
  const catalog = [
    { id: 'contacts.get.phone', domain: 'contacts', name: '查电话', risk: 'read', field: 'phone', inputs: {} },
    { id: 'contacts.get.nickname', domain: 'contacts', name: '内部专属字段', risk: 'read', field: 'obscure', inputs: {} },
    { id: 'contacts.set.phone', domain: 'contacts', name: '改电话', risk: 'write', inputs: {} }
  ];
  const found = prompts.selectAdaptiveCandidates('查联系人电话', 'contacts', { catalog, limit: 12 });
  assert.deepEqual(new Set(found.map(item => item.id)), new Set(catalog.map(item => item.id)));
  assert.ok(prompts.selectAdaptiveCandidates('天气', 'weather', { limit: 999 }).length <= 12);
});

test('simple adaptive route combines API and explicit arguments in two calls', async () => {
  const mock = mockProviders({ domain: { domain: 'contacts' }, intent_arguments: { api: 'contacts.search', arguments: { query: '王明' } } });
  const result = await runPipeline({ text: '搜索联系人王明', model: 'qwen2.5:1.5b', mode: 'adaptive', context }, mock);
  assert.equal(result.status, 'ready_mock', result.error);
  assert.deepEqual(mock.calls.map(item => item.stage), ['domain', 'intent_arguments']);
  assert.equal(result.api, 'contacts.search');
  assert.deepEqual(result.extractedArguments, { query: '王明' });
  assert.equal(result.routing.path, 'two_step');
  assert.equal(result.routing.actualCallCount, result.traces.length);
  assert.equal(result.routing.actualCallCount, 2);
  assert.equal(result.candidates.intent_arguments.policy, 'adaptive-domain-soft-v1');
});

test('complex JSON adaptive route selects intent then extracts selected API arguments', async () => {
  const mock = mockProviders({ domain: { domain: 'cloud' }, intent: { api: 'cloud.function.call' }, arguments: { function_name: 'foo', data: '{"items":[1,2]}' } });
  const result = await runPipeline({ text: '调用云函数 foo，正文 {"items":[1,2]}', model: 'qwen', mode: 'adaptive', context }, mock);
  assert.equal(result.status, 'ready_mock', result.error);
  assert.deepEqual(mock.calls.map(item => item.stage), ['domain', 'intent', 'arguments']);
  assert.ok(result.routing.triggerReasons.includes('explicit_json'));
  assert.equal(result.routing.actualCallCount, 3);
  assert.equal(mock.calls[2].promptMeta.version, prompts.ADAPTIVE_PROMPT_VERSION);
});

test('multi-field writes and separate time roles produce three-stage adaptive calls', async () => {
  for (const text of ['修改日程 ev_7 的标题为设计评审，地点为A室', '修改日程 ev_7，开始明天15:00，结束明天16:00']) {
    const mock = mockProviders({ domain: { domain: 'calendar' }, intent: { api: 'calendar.update' }, arguments: { event_id: 'ev_7', changes: { title: '设计评审' } } });
    const result = await runPipeline({ text, model: 'qwen', mode: 'adaptive', context }, mock);
    assert.deepEqual(mock.calls.map(item => item.stage), ['domain', 'intent', 'arguments'], result.error);
    assert.equal(result.routing.path, 'three_step');
  }
});

test('complex selected API with no inputs skips independent argument stage', async () => {
  const mock = mockProviders({ domain: { domain: 'device' }, intent: { api: 'device.battery.level' } });
  const result = await runPipeline({ text: '查电量，返回 JSON {}', model: 'qwen', mode: 'adaptive', context }, mock);
  assert.equal(Object.keys(getCapability('device.battery.level').inputs).length, 0);
  assert.deepEqual(mock.calls.map(item => item.stage), ['domain', 'intent'], result.error);
  assert.equal(result.routing.actualCallCount, 2);
  assert.ok(result.routing.skippedStages.some(item => item.stage === 'arguments' && item.reason === 'api_has_no_inputs'));
});

test('domain unsupported ends adaptive with one call', async () => {
  const mock = mockProviders({ domain: { domain: 'unsupported' } });
  const result = await runPipeline({ text: '写一首诗', model: 'qwen', mode: 'adaptive', context }, mock);
  assert.equal(result.status, 'unsupported');
  assert.equal(result.traces.length, 1);
  assert.equal(result.routing.actualCallCount, 1);
});

test('unsupported intent ends without argument extraction', async () => {
  const mock = mockProviders({ domain: { domain: 'cloud' }, intent: { api: 'unsupported' } });
  const result = await runPipeline({ text: '调用云函数，正文 {}，然后播放音乐', model: 'qwen', mode: 'adaptive', context }, mock);
  assert.equal(result.status, 'unsupported');
  assert.equal(result.routing.actualCallCount, 2);
});

test('adaptive provider failure emits one failed trace and no later stage', async () => {
  const mock = mockProviders({ domain: { domain: 'contacts' } }, { failAt: 2 });
  const emitted = [];
  const result = await runPipeline({ text: '找联系人王明', model: 'qwen', mode: 'adaptive', context }, { ...mock, onTrace: trace => emitted.push(trace) });
  assert.equal(result.status, 'error');
  assert.equal(mock.calls.length, 2);
  assert.equal(result.traces.length, 2);
  assert.equal(emitted.length, 2);
  assert.ok(result.traces[1].error);
  assert.equal(result.routing.actualCallCount, 2);
});

test('adaptive cancellation preserves failed trace and prevents subsequent stage', async () => {
  const controller = new AbortController();
  const mock = mockProviders({ domain: { domain: 'cloud' } }, { abortAt: 2, controller });
  const emitted = [];
  await assert.rejects(runPipeline({ text: '调用云函数，正文 {}', model: 'qwen', mode: 'adaptive', context }, { ...mock, signal: controller.signal, onTrace: trace => emitted.push(trace) }), error => {
    assert.equal(error.partialRun.status, 'cancelled');
    assert.equal(error.partialRun.routing.actualCallCount, 2);
    assert.equal(error.traces.length, 2);
    return true;
  });
  assert.equal(mock.calls.length, 2);
  assert.equal(emitted.length, 2);
});

test('Jev mode fixes two choice decisions then Ollama extraction and does not inherit Qwen model', async () => {
  const mock = mockProviders({ domain: { domain: 'contacts' }, intent: { api: 'contacts.search' }, arguments: { query: '王明' } }, { defaultModel: 'jev-custom' });
  const result = await runPipeline({ text: '找联系人王明', mode: 'jev', model: 'qwen2.5:1.5b', context }, mock);
  assert.equal(result.status, 'ready_mock', result.error);
  assert.deepEqual(mock.calls.map(item => [item.stage, item.provider, item.model]), [['domain', 'jev', 'jev-custom'], ['intent', 'jev', 'jev-custom'], ['arguments', 'ollama', 'qwen2.5:1.5b']]);
  assert.equal(result.routing.actualCallCount, 3);
  assert.equal(mock.calls[0].decision.answerKey, 'domain');
  assert.equal(mock.calls[1].decision.answerKey, 'api');
  assert.equal(mock.calls[1].decision.question.type, 'choice');
});

test('Jev mode skips Qwen when selected API has no inputs', async () => {
  const mock = mockProviders({ domain: { domain: 'device' }, intent: { api: 'device.battery.level' } });
  const result = await runPipeline({ text: '查电量', mode: 'jev', model: 'qwen', context }, mock);
  assert.deepEqual(mock.calls.map(item => item.provider), ['jev', 'jev'], result.error);
  assert.equal(result.routing.actualCallCount, 2);
  assert.ok(result.routing.skippedStages.length);
});

test('explicit Jev decision stage model is honored without changing Qwen arguments model', async () => {
  const mock = mockProviders({ domain: { domain: 'contacts' }, intent: { api: 'contacts.search' }, arguments: { query: '王明' } });
  await runPipeline({ text: '找联系人王明', mode: 'jev', model: 'qwen', stages: { domain: { model: 'jev-d' }, intent: { model: 'jev-i' } }, context }, mock);
  assert.deepEqual(mock.calls.map(item => item.model), ['jev-d', 'jev-i', 'qwen']);
});

test('invalid fixed Jev route overrides are rejected before any call', async () => {
  for (const stages of [{ domain: { provider: 'ollama' } }, { intent: { provider: 'ollama' } }, { arguments: { provider: 'jev' } }, { intent_arguments: { provider: 'jev' } }]) {
    const mock = mockProviders({});
    const result = await runPipeline({ text: '找联系人王明', mode: 'jev', model: 'qwen', stages }, mock);
    assert.equal(result.status, 'error');
    assert.match(result.error, /Jev|jev|阶段|覆盖/);
    assert.equal(mock.calls.length, 0);
  }
});

test('official decision-only Jev is rejected for combined and parameter generation stages', async () => {
  for (const [mode, stages] of [['adaptive', { intent_arguments: { provider: 'jev' } }], ['adaptive', { arguments: { provider: 'jev' } }], ['unified', { unified: { provider: 'jev' } }]]) {
    const mock = mockProviders({});
    const result = await runPipeline({ text: '找联系人王明', model: 'qwen', mode, stages }, mock);
    assert.equal(result.status, 'error');
    assert.match(result.error, /Jev|jev|阶段/);
    assert.equal(mock.calls.length, 0);
  }
});

test('Jev prompts use object criteria and complete selected-domain catalog including unsupported', () => {
  assert.equal(typeof prompts.buildJevDomainPrompt, 'function');
  assert.equal(typeof prompts.buildJevIntentPrompt, 'function');
  const domain = prompts.buildJevDomainPrompt('电池温度多少');
  assert.deepEqual(Object.keys(domain.decision.question.criteria), [...domains.map(item => item.id), 'unsupported']);
  assert.equal(domain.decision.state.text, '电池温度多少');
  assert.ok(!domain.decision.state.choices);
  const intent = prompts.buildJevIntentPrompt('冷不冷', 'weather', context);
  const all = capabilities.filter(cap => cap.domain === 'weather').map(cap => cap.id);
  assert.deepEqual(Object.keys(intent.decision.question.criteria), [...all, 'unsupported']);
  assert.ok(all.length > 100);
  assert.ok(Object.keys(intent.decision.question.criteria).length <= 255);
  assert.deepEqual(intent.schema.properties.api.enum, [...all, 'unsupported']);
  assert.equal(intent.promptMeta.candidates.policy, 'jev-full-domain-v1');
});

test('staged/unified builders retain historical prompt version', () => {
  assert.equal(prompts.PROMPT_VERSION, 'explicit-v8-cloud');
  assert.equal(prompts.buildDomainPrompt('天气').promptMeta.version, prompts.PROMPT_VERSION);
  assert.equal(prompts.buildUnifiedPrompt('天气').promptMeta.version, prompts.PROMPT_VERSION);
});
