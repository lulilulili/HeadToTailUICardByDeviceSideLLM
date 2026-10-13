import test from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../src/pipeline.mjs';
import { analyzeAdaptiveRoute } from '../src/adaptive-routing.mjs';
import { buildAdaptiveIntentPrompt, buildIntentArgumentsPrompt, buildJevIntentPrompt, ADAPTIVE_PROMPT_VERSION, JEV_PROMPT_VERSION } from '../src/prompts.mjs';
import { validateValue } from '../src/providers.mjs';
import { capabilities, domains } from '../src/registry.mjs';

const context = { now: '2026-10-13T08:00:00+08:00', timezone: 'Asia/Shanghai' };
function mocks(values) {
  const calls = [];
  const provider = name => ({ async invoke(request) {
    calls.push({ ...request, provider: name });
    const value = values[request.stage];
    return { value, trace: { stage: request.stage, model: request.model, provider: name, raw: JSON.stringify(value), wallMs: 2 } };
  } });
  return { calls, providers: { ollama: provider('ollama'), jev: provider('jev') } };
}

test('a read-only weather window is one time role, not separate start/end roles', () => {
  assert.equal(analyzeAdaptiveRoute('查上海从10点到11点的逐小时湿度').path, 'two_step');
});

test('calendar creation with explicit two endpoints separates API and arguments', () => {
  const route = analyzeAdaptiveRoute('明天10:00至11:00创建设计会');
  assert.equal(route.path, 'three_step');
  assert.ok(route.reasons.includes('multiple_time_roles'));
});

test('quoted JSON search targets do not trigger payload extraction complexity', () => {
  assert.equal(analyzeAdaptiveRoute('搜索本地文件，关键词“{"kind":"pdf"}”').path, 'two_step');
});

test('adaptive domain Jev override keeps simple joint Qwen path', async () => {
  const mock = mocks({ domain: { domain: 'contacts' }, intent_arguments: { api: 'contacts.search', arguments: { query: '王明' } } });
  const result = await runPipeline({ text: '找联系人王明', mode: 'adaptive', model: 'qwen', stages: { domain: { provider: 'jev' } }, context }, mock);
  assert.equal(result.status, 'ready_mock', result.error);
  assert.deepEqual(mock.calls.map(item => [item.stage, item.provider, item.model]), [['domain', 'jev', 'jev-latest'], ['intent_arguments', 'ollama', 'qwen']]);
  assert.equal(mock.calls[0].decision.answerKey, 'domain');
  assert.equal(result.routing.actualCallCount, 2);
});

test('adaptive intent Jev override forces typed choice then Qwen parameters', async () => {
  const mock = mocks({ domain: { domain: 'contacts' }, intent: { api: 'contacts.search' }, arguments: { query: '王明' } });
  const result = await runPipeline({ text: '找联系人王明', mode: 'adaptive', model: 'qwen', stages: { intent: { provider: 'jev' } }, context }, mock);
  assert.equal(result.status, 'ready_mock', result.error);
  assert.deepEqual(mock.calls.map(item => [item.stage, item.provider]), [['domain', 'ollama'], ['intent', 'jev'], ['arguments', 'ollama']]);
  assert.ok(result.routing.triggerReasons.includes('typed_decision_requires_arguments'));
  assert.equal(mock.calls[1].decision.answerKey, 'api');
  assert.equal(mock.calls[1].promptMeta.version, JEV_PROMPT_VERSION);
  assert.equal(mock.calls[2].promptMeta.version, ADAPTIVE_PROMPT_VERSION);
});

test('staged Jev overrides also receive complete official choice prompts', async () => {
  const mock = mocks({ domain: { domain: 'contacts' }, intent: { api: 'contacts.search' }, arguments: { query: '王明' } });
  const result = await runPipeline({ text: '找联系人王明', mode: 'staged', model: 'qwen', stages: { domain: { provider: 'jev' }, intent: { provider: 'jev' } }, context }, mock);
  assert.equal(result.status, 'ready_mock', result.error);
  assert.deepEqual(mock.calls.map(item => item.decision?.answerKey ?? null), ['domain', 'api', null]);
  assert.equal(Object.keys(mock.calls[1].decision.question.criteria).length, capabilities.filter(cap => cap.domain === 'contacts').length + 1);
});

test('official Jev rejects parameter override even in historical staged mode', async () => {
  const mock = mocks({});
  const result = await runPipeline({ text: '天气', model: 'qwen', stages: { arguments: { provider: 'jev' } } }, mock);
  assert.equal(result.status, 'error');
  assert.match(result.error, /Jev.*arguments/);
  assert.equal(mock.calls.length, 0);
});

test('all domains fit official Jev choice bound and API enum matches criteria', () => {
  for (const domain of domains) {
    const prompt = buildJevIntentPrompt('查询', domain.id);
    const ids = capabilities.filter(cap => cap.domain === domain.id).map(cap => cap.id);
    assert.deepEqual(Object.keys(prompt.decision.question.criteria), [...ids, 'unsupported']);
    assert.deepEqual(prompt.schema.properties.api.enum, [...ids, 'unsupported']);
    assert.ok(ids.length + 1 <= 255, domain.id);
    assert.ok(Object.values(prompt.decision.question.criteria).every(value => typeof value === 'string' && value.length));
  }
});

test('joint schema forbids cross-API arguments, foreign domain APIs and fabricated IDs', () => {
  const prompt = buildIntentArgumentsPrompt('找联系人王明', 'contacts');
  for (const value of [{ api: 'calendar.create', arguments: {} }, { api: 'contacts.search', arguments: { location: '上海' } }, { api: 'made.up', arguments: {} }]) assert.equal(validateValue(prompt.schema, value).valid, false);
  assert.equal(validateValue(prompt.schema, { api: 'contacts.search', arguments: { query: '王明' } }).valid, true);
});

test('invalid joint output preserves single failed trace and stops', async () => {
  const mock = mocks({ domain: { domain: 'contacts' }, intent_arguments: { api: 'contacts.search', arguments: { location: '上海' } } });
  const result = await runPipeline({ text: '找联系人王明', mode: 'adaptive', model: 'qwen', context }, mock);
  assert.equal(result.status, 'error');
  assert.equal(result.routing.actualCallCount, 2);
  assert.equal(mock.calls.length, 2);
  assert.match(result.traces[1].error, /schema/);
  assert.ok(result.traces[1].raw.includes('location'));
});

test('cancellation between stages does not invent a second invocation trace', async () => {
  const controller = new AbortController();
  const mock = mocks({ domain: { domain: 'contacts' } });
  await assert.rejects(runPipeline({ text: '找联系人王明', mode: 'adaptive', model: 'qwen', context }, { ...mock, signal: controller.signal, onTrace: () => controller.abort() }), error => {
    assert.equal(error.partialRun.status, 'cancelled');
    assert.equal(error.traces.length, 1);
    assert.equal(error.partialRun.routing.actualCallCount, 1);
    return true;
  });
  assert.equal(mock.calls.length, 1);
});

test('pre-cancelled run invokes no model and has no call trace', async () => {
  const mock = mocks({});
  await assert.rejects(runPipeline({ text: '找联系人王明', mode: 'adaptive', model: 'qwen', context }, { ...mock, signal: AbortSignal.abort() }), error => {
    assert.equal(error.partialRun.routing.actualCallCount, 0);
    assert.equal(error.traces.length, 0);
    return true;
  });
  assert.equal(mock.calls.length, 0);
});

test('unconfigured official Jev fails once without silently calling Ollama', async () => {
  const calls = [];
  const result = await runPipeline({ text: '找联系人王明', mode: 'jev', model: 'qwen' }, { providers: {
    jev: { async invoke(request) { calls.push('jev'); const error = new Error('Jev API Key 未配置'); error.trace = { stage: request.stage, wallMs: 1, error: error.message }; throw error; } },
    ollama: { async invoke() { calls.push('ollama'); throw new Error('must not fallback'); } }
  } });
  assert.equal(result.status, 'error');
  assert.deepEqual(calls, ['jev']);
  assert.equal(result.traces.length, 1);
  assert.equal(result.routing.actualCallCount, 1);
});

test('intent choice retains parameter role information without extracting a value', () => {
  const prompt = buildAdaptiveIntentPrompt('修改联系人ct_7的电话为13912345678', 'contacts');
  assert.ok(prompt.messages[0].content.includes('入参角色'));
  assert.deepEqual(Object.keys(prompt.schema.properties), ['api']);
});
