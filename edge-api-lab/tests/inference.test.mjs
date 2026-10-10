import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

async function module(name) {
  try { return await import(`../src/${name}.mjs`); }
  catch (error) { assert.fail(`${name} module must be available: ${error.message}`); }
}

async function serve(handler, fn) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

const schema = { type: 'object', properties: { api: { type: 'string', enum: ['weather.query'] } }, required: ['api'], additionalProperties: false };
const messages = [{ role: 'system', content: '只输出 JSON' }, { role: 'user', content: '天气' }];
function wireSlots(schema, value) {
  if (schema.oneOf) schema = schema.oneOf.find(branch => branch.properties.api.const === value.api);
  if (schema.anyOf) schema = schema.anyOf.find(branch => branch.type !== 'null');
  if (schema.type !== 'object') return value;
  return Object.fromEntries(Object.entries(schema.properties).map(([key, child]) => [key, value[key] === undefined ? null : wireSlots(child, value[key])]));
}

test('Ollama uses bounded structured requests and records separate timing metrics', async () => {
  const { createProviders } = await module('providers');
  let request;
  await serve(async (req, res) => {
    request = JSON.parse(await Array.fromAsync(req).then(chunks => Buffer.concat(chunks).toString()));
    assert.equal(req.url, '/api/chat');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ message: { content: '{"api":"weather.query"}' }, load_duration: 2e6, prompt_eval_duration: 4e6, eval_duration: 8e6, prompt_eval_count: 10, eval_count: 4 }));
  }, async url => {
    const { value, trace } = await createProviders({ ollamaUrl: url }).ollama.invoke({ stage: 'intent', model: 'small', messages, schema });
    assert.deepEqual(value, { api: 'weather.query' });
    assert.equal(request.stream, false);
    assert.equal(request.think, false);
    assert.deepEqual(request.format, schema);
    assert.equal(request.options.temperature, 0);
    assert.equal(request.options.num_ctx, 2048);
    assert.ok(request.options.num_predict <= 64);
    assert.equal(trace.provider, 'ollama');
    assert.equal(trace.stage, 'intent');
    assert.equal(trace.loadMs, 2);
    assert.equal(trace.promptMs, 4);
    assert.equal(trace.generationMs, 8);
    assert.equal(trace.inputTokens, 10);
    assert.equal(trace.outputTokens, 4);
    assert.equal(trace.tokensPerSecond, 500);
    assert.ok(trace.wallMs >= 0);
    assert.deepEqual(trace.messages, messages);
    assert.deepEqual(trace.schema, schema);
    assert.equal(trace.raw, '{"api":"weather.query"}');
  });
});

test('trace preserves effective options, prompt version, timeout and truncation on output failure', async () => {
  const { createProviders } = await module('providers');
  await serve((req, res) => res.end(JSON.stringify({ message: { content: '{"api":' }, done_reason: 'length', eval_count: 16, eval_duration: 16e6 })), async url => {
    await assert.rejects(createProviders({ ollamaUrl: url }).ollama.invoke({ stage: 'intent', model: 'small', messages, schema, promptMeta: { version: 'test-version' }, options: { numCtx: 9000, numPredict: 16, timeoutMs: 1000, temperature: 1 } }), error => {
      assert.deepEqual(error.trace.options, { temperature: 0, num_ctx: 8192, num_predict: 16 });
      assert.equal(error.trace.timeoutMs, 1000);
      assert.equal(error.trace.promptVersion, 'test-version');
      assert.equal(error.trace.doneReason, 'length');
      assert.equal(error.trace.truncated, true);
      assert.equal(error.trace.outputTokens, 16);
      assert.equal(error.trace.tokensPerSecond, 1000);
      return true;
    });
  });
});

test('provider rejects fabricated enums and extra properties with a failed trace', async () => {
  const { createProviders } = await module('providers');
  for (const content of ['{"api":"made.up"}', '{"api":"weather.query","extra":1}']) {
    await serve((req, res) => res.end(JSON.stringify({ message: { content }, eval_count: 2 })), async url => {
      await assert.rejects(createProviders({ ollamaUrl: url }).ollama.invoke({ stage: 'intent', model: 'small', messages, schema }), error => {
        assert.match(error.message, /schema|结构|enum|额外/i);
        assert.equal(error.trace.raw, content);
        assert.ok(error.trace.error);
        assert.ok(error.trace.wallMs >= 0);
        assert.equal(error.trace.outputTokens, 2);
        return true;
      });
    });
  }
});

test('schema validation constrains nested arguments and union branches', async () => {
  const { validateValue } = await module('providers');
  const nested = { oneOf: [{ type: 'object', properties: { api: { const: 'a' }, arguments: { type: 'object', properties: { count: { type: 'integer', minimum: 1 }, kind: { type: 'string', enum: ['good'] } }, additionalProperties: false } }, required: ['api', 'arguments'], additionalProperties: false }] };
  assert.equal(validateValue(nested, { api: 'a', arguments: { count: 1, kind: 'good' } }).valid, true);
  for (const value of [{ api: 'b', arguments: {} }, { api: 'a', arguments: { count: 0 } }, { api: 'a', arguments: { kind: 'bad' } }, { api: 'a', arguments: { extra: 2 } }]) assert.equal(validateValue(nested, value).valid, false);
});

test('unconfigured Jev fails explicitly and preserves trace', async () => {
  const { createProviders } = await module('providers');
  await assert.rejects(createProviders({}).jev.invoke({ stage: 'arguments', model: 'jev-test', messages, schema }), error => {
    assert.match(error.message, /Jev.*未配置/i);
    assert.equal(error.trace.provider, 'jev');
    assert.equal(error.trace.stage, 'arguments');
    assert.ok(error.trace.error);
    return true;
  });
});

test('Jev bridge receives the same stage contract and validates its returned value', async () => {
  const { createProviders } = await module('providers');
  let request;
  await serve(async (req, res) => {
    request = JSON.parse(await Array.fromAsync(req).then(chunks => Buffer.concat(chunks).toString()));
    res.end(JSON.stringify({ value: { api: 'weather.query' }, metrics: { inputTokens: 8, outputTokens: 3, generationMs: 10 } }));
  }, async url => {
    const result = await createProviders({ jevUrl: url }).jev.invoke({ stage: 'intent', model: 'jev-test', messages, schema, options: { num_predict: 32 } });
    assert.equal(request.stage, 'intent');
    assert.deepEqual(request.schema, schema);
    assert.equal(request.model, 'jev-test');
    assert.deepEqual(result.value, { api: 'weather.query' });
    assert.equal(result.trace.inputTokens, 8);
    assert.equal(result.trace.tokensPerSecond, 300);
  });
});

const context = { now: '2026-10-10T08:00:00+08:00', timezone: 'Asia/Shanghai', location: { latitude: 31.2304, longitude: 121.4737, label: '上海', source: 'fixture' } };
const weather = { id: 'weather.query', inputs: { location: { type: 'string', required: true, resolver: 'system_location' }, time_ref: { type: 'string', default: 'today', resolver: 'relative_time' }, data_needs: { type: 'array', default: ['weather'] } } };
const calendar = { id: 'calendar.create', inputs: { title: { type: 'string', required: true }, starts_at: { type: 'string', required: true, resolver: 'datetime' }, ends_at: { type: 'string', resolver: 'datetime' }, duration_minutes: { type: 'integer', minimum: 1 } } };

test('resolver fills weather state and tracks fixture location separately from source labels', async () => {
  const { resolveArguments } = await module('resolver');
  const result = resolveArguments(weather, {}, context);
  assert.equal(result.status, 'ready_mock');
  assert.equal(result.arguments.location.source, 'fixture');
  assert.equal(result.arguments.time_ref.start, '2026-10-10');
  assert.equal(result.arguments.time_ref.end, '2026-10-10');
  assert.deepEqual(result.sources, { location: 'system_location', time_ref: 'system_time', data_needs: 'default' });
});

test('explicit location wins and relative time is computed using frozen device context', async () => {
  const { resolveArguments } = await module('resolver');
  const result = resolveArguments(weather, { location: '北京', time_ref: '明天', data_needs: ['precipitation'] }, { ...context, locationError: 'denied' });
  assert.equal(result.arguments.location, '北京');
  assert.equal(result.arguments.time_ref.start, '2026-10-11');
  assert.equal(result.sources.location, 'user');
  assert.equal(result.sources.time_ref, 'system_time');
  assert.equal(result.sources.data_needs, 'user');
  assert.equal(result.status, 'ready_mock');
});

test('weather tomorrow morning retains deterministic subday period instead of collapsing to all day', async () => {
  const { resolveArguments } = await module('resolver');
  for (const expression of ['明早', '明天早上', '明天上午']) {
    const result = resolveArguments(weather, { location: '北京', time_ref: expression }, context);
    assert.equal(result.status, 'ready_mock');
    assert.equal(result.arguments.time_ref.start, '2026-10-11');
    assert.equal(result.arguments.time_ref.end, '2026-10-11');
    assert.equal(result.arguments.time_ref.expression, expression);
    assert.deepEqual(result.arguments.time_ref.period, { id: 'morning', start: '06:00', end: '12:00' });
    assert.equal(result.sources.time_ref, 'system_time');
  }
});

test('weather tonight and explicit date periods retain declared ranges and provenance', async () => {
  const { resolveArguments } = await module('resolver');
  const tonight = resolveArguments(weather, { location: '北京', time_ref: '今晚' }, context);
  assert.equal(tonight.arguments.time_ref.start, '2026-10-10');
  assert.deepEqual(tonight.arguments.time_ref.period, { id: 'evening', start: '18:00', end: '24:00' });
  const absolute = resolveArguments(weather, { location: '北京', time_ref: '2026-10-12下午' }, context);
  assert.equal(absolute.status, 'ready_mock');
  assert.equal(absolute.arguments.time_ref.start, '2026-10-12');
  assert.deepEqual(absolute.arguments.time_ref.period, { id: 'afternoon', start: '12:00', end: '18:00' });
  assert.equal(absolute.sources.time_ref, 'user');
});

test('failed location resolution never invents a city', async () => {
  const { resolveArguments } = await module('resolver');
  const result = resolveArguments(weather, {}, { ...context, location: undefined, locationError: '用户拒绝定位' });
  assert.equal(result.status, 'resolution_failed');
  assert.ok(!('location' in result.arguments));
  assert.ok(result.missing.includes('location'));
  assert.match(result.issues.join(' '), /定位|位置/);
});

test('calendar writes never default missing business start time', async () => {
  const { resolveArguments } = await module('resolver');
  const result = resolveArguments(calendar, { title: '会议' }, context);
  assert.equal(result.status, 'needs_clarification');
  assert.deepEqual(result.missing, ['starts_at']);
  assert.ok(!('starts_at' in result.arguments));
});

test('calendar relative datetime normalizes deterministically and checks end order', async () => {
  const { resolveArguments } = await module('resolver');
  const result = resolveArguments(calendar, { title: '会议', starts_at: '明天下午3点', duration_minutes: 30 }, context);
  assert.equal(result.status, 'ready_mock');
  assert.equal(result.arguments.starts_at, '2026-10-11T15:00:00+08:00');
  assert.equal(result.sources.starts_at, 'system_time');
  const invalid = resolveArguments(calendar, { title: '会议', starts_at: '2026-10-11T15:00:00+08:00', ends_at: '2026-10-11T14:00:00+08:00' }, context);
  assert.equal(invalid.status, 'needs_clarification');
  assert.ok(invalid.issues.length > 0);
});

test('unknown relative dates require clarification instead of guessing', async () => {
  const { resolveArguments } = await module('resolver');
  const result = resolveArguments(weather, { location: '北京', time_ref: '以后某一天' }, context);
  assert.equal(result.status, 'needs_clarification');
  assert.ok(result.issues.length > 0);
});

test('ambiguous short clock times require a period instead of guessing AM', async () => {
  const { resolveArguments } = await module('resolver');
  const ambiguous = resolveArguments(calendar, { title: '会议', starts_at: '明天三点' }, context);
  assert.equal(ambiguous.status, 'needs_clarification');
  assert.ok(ambiguous.issues.some(issue => /上午|下午|24/.test(issue)));
  const explicitClock = resolveArguments(calendar, { title: '会议', starts_at: '明天03:00' }, context);
  assert.equal(explicitClock.status, 'ready_mock');
  assert.equal(explicitClock.arguments.starts_at, '2026-10-11T03:00:00+08:00');
});

test('end time inherits a resolved explicit start date and records context provenance', async () => {
  const { resolveArguments } = await module('resolver');
  const result = resolveArguments(calendar, { title: '会议', starts_at: '明天下午三点', ends_at: '下午四点' }, context);
  assert.equal(result.status, 'ready_mock');
  assert.equal(result.arguments.ends_at, '2026-10-11T16:00:00+08:00');
  assert.equal(result.sources.ends_at, 'context');
});

test('absolute invalid calendar dates fail rather than rolling into a later month', async () => {
  const { resolveArguments } = await module('resolver');
  const result = resolveArguments(calendar, { title: '会议', starts_at: '2026-02-30T15:00:00+08:00' }, context);
  assert.equal(result.status, 'needs_clarification');
  assert.ok(result.missing.includes('starts_at'));
});

test('prompts expose only selected capabilities and disallow context guesses', async () => {
  const { buildDomainPrompt, buildIntentPrompt, buildArgumentsPrompt, buildUnifiedPrompt } = await module('prompts');
  const domain = buildDomainPrompt('今天下雨吗');
  assert.equal(domain.schema.additionalProperties, false);
  assert.ok(domain.schema.properties.domain.enum.includes('unsupported'));
  const intent = buildIntentPrompt('今天下雨吗', 'weather');
  assert.ok(intent.schema.properties.api.enum.includes('weather.query'));
  assert.ok(intent.schema.properties.api.enum.includes('unsupported'));
  assert.ok(intent.schema.properties.api.enum.length <= 7);
  assert.ok(intent.messages[0].content.length < 1200);
  assert.ok(!intent.messages[0].content.includes('contacts.create'));
  const args = buildArgumentsPrompt('今天下雨吗', weather);
  assert.ok(args.messages[0].content.includes('null'));
  assert.equal(args.schema.additionalProperties, false);
  assert.deepEqual(args.schema.required, []);
  assert.ok(args.schema.properties.location.anyOf.some(branch => branch.type === 'null'));
  assert.ok(buildUnifiedPrompt('今天下雨吗').schema.oneOf.length <= 13);
});

test('unified catalog prompt remains compact and arguments only show relevant examples', async () => {
  const { buildUnifiedPrompt, buildArgumentsPrompt } = await module('prompts');
  const { getCapability } = await module('registry');
  const unified = buildUnifiedPrompt('任意输入');
  assert.ok(unified.messages[0].content.length <= 2800, `unified chars=${unified.messages[0].content.length}`);
  assert.ok(!JSON.stringify(unified.schema).includes('"description":"'));
  assert.ok(!buildArgumentsPrompt('查联系人', getCapability('contacts.search')).messages[0].content.includes('precipitation'));
});

test('extraction prompts teach omission without leaking sample IDs or business defaults', async () => {
  const { buildArgumentsPrompt, PROMPT_VERSION } = await module('prompts');
  const { getCapability } = await module('registry');
  const cloud = buildArgumentsPrompt('查会议资料', getCapability('materials.search')).messages[0].content;
  assert.ok(!cloud.includes('mt_8'));
  assert.ok(!buildArgumentsPrompt('修改日程', getCapability('calendar.update')).messages[0].content.includes('ev_42'));
  const weatherPrompt = buildArgumentsPrompt('天气', getCapability('weather.query')).messages[0].content;
  assert.ok(weatherPrompt.includes('没说的字段不输出'));
  assert.ok(!weatherPrompt.includes('weather|'));
  assert.ok(!weatherPrompt.includes('default'));
  const search = buildArgumentsPrompt('查日程', getCapability('calendar.search')).messages[0].content;
  assert.ok(search.includes('→{"time_ref":"后天"}'));
  assert.ok(!search.includes('安排/有哪些会'));
  assert.equal(PROMPT_VERSION, 'sparse-v6');
});

test('abort propagates after retaining each partial trace once', async () => {
  const { runPipeline } = await module('pipeline');
  const controller = new AbortController();
  const traces = [];
  await assert.rejects(runPipeline({ text: '天气', mode: 'staged', model: 'small', context }, { signal: controller.signal, onTrace: trace => traces.push(trace), providers: { ollama: { async invoke(request) { controller.abort(); const error = new Error('调用已取消'); error.trace = { stage: request.stage, error: error.message, wallMs: 3 }; throw error; } } } }), error => {
    assert.equal(error.traces.length, 1);
    assert.equal(error.partialRun.status, 'cancelled');
    assert.equal(traces.length, 1);
    return true;
  });
});

test('staged pipeline runs three calls, permits per-stage Jev, and emits each trace once', async () => {
  const { runPipeline } = await module('pipeline');
  const calls = [];
  const events = [];
  const invoke = provider => async request => {
    calls.push({ provider, ...request });
    const value = request.stage === 'domain' ? { domain: 'weather' } : request.stage === 'intent' ? { api: 'weather.query' } : { time_ref: '今天', data_needs: ['precipitation'] };
    return { value: request.stage === 'arguments' ? wireSlots(request.schema, value) : value, trace: { stage: request.stage, provider, model: request.model, wallMs: 1 } };
  };
  const result = await runPipeline({ text: '今天下雨吗', model: 'small', mode: 'staged', stages: { arguments: { provider: 'jev', model: 'bridge' } }, context }, { providers: { ollama: { invoke: invoke('ollama') }, jev: { invoke: invoke('jev') } }, onTrace: trace => events.push(trace) });
  assert.deepEqual(calls.map(call => [call.stage, call.provider, call.model]), [['domain', 'ollama', 'small'], ['intent', 'ollama', 'small'], ['arguments', 'jev', 'bridge']]);
  assert.equal(result.api, 'weather.query');
  assert.equal(result.status, 'ready_mock');
  assert.equal(result.traces.length, 3);
  assert.equal(events.length, 3);
  assert.equal(result.mock.executed, false);
});

test('unified pipeline runs one call and preserves extracted explicit arguments', async () => {
  const { runPipeline } = await module('pipeline');
  let count = 0;
  const result = await runPipeline({ text: '明天北京下雨吗', model: 'small', mode: 'unified', context }, { providers: { ollama: { async invoke(request) { count++; assert.equal(request.stage, 'unified'); return { value: wireSlots(request.schema, { domain: 'weather', api: 'weather.query', arguments: { location: '北京', time_ref: '明天', data_needs: ['precipitation'] } }), trace: { stage: 'unified', wallMs: 1 } }; } } } });
  assert.equal(count, 1);
  assert.deepEqual(result.extractedArguments, { location: '北京', time_ref: '明天', data_needs: ['precipitation'] });
  assert.equal(result.resolved.arguments.time_ref.start, '2026-10-11');
});

test('unsupported domain short-circuits without hidden retries', async () => {
  const { runPipeline } = await module('pipeline');
  let count = 0;
  const result = await runPipeline({ text: '给我写一首诗', model: 'small', mode: 'staged', context }, { providers: { ollama: { async invoke() { count++; return { value: { domain: 'unsupported' }, trace: { stage: 'domain', wallMs: 1 } }; } } } });
  assert.equal(count, 1);
  assert.equal(result.status, 'unsupported');
  assert.equal(result.api, null);
});

test('run persists requested options and stage selections independently of caller mutations', async () => {
  const { runPipeline } = await module('pipeline');
  const options = { numCtx: 4096 };
  const stages = { domain: { provider: 'ollama', model: 'other-small' } };
  const result = await runPipeline({ text: '写首诗', model: 'small', stages, options, context }, { providers: { ollama: { async invoke() { return { value: { domain: 'unsupported' }, trace: { stage: 'domain', wallMs: 1 } }; } } } });
  options.numCtx = 8192;
  stages.domain.model = 'mutated';
  assert.deepEqual(result.options, { numCtx: 4096 });
  assert.deepEqual(result.stages, { domain: { provider: 'ollama', model: 'other-small' } });
});

test('nullable inference wire values normalize only nulls while retaining visible model arguments', async () => {
  const { runPipeline } = await module('pipeline');
  const value = { domain: 'weather', api: 'weather.query', arguments: { location: null, time_ref: '今天', data_needs: ['precipitation'] } };
  let wireValue;
  const result = await runPipeline({ text: '今天下雨吗', model: 'small', mode: 'unified', context }, { providers: { ollama: { async invoke(request) { wireValue = wireSlots(request.schema, value); return { value: wireValue, trace: { stage: 'unified', raw: JSON.stringify(wireValue), wallMs: 1 } }; } } } });
  assert.equal(result.status, 'ready_mock');
  assert.deepEqual(result.modelArguments, wireValue.arguments);
  assert.deepEqual(result.extractedArguments, { time_ref: '今天', data_needs: ['precipitation'] });
  assert.equal(result.resolved.sources.location, 'system_location');
  assert.ok(result.traces[0].raw.includes('"location":null'));
});

test('pipeline errors retain prior and failed traces for the page', async () => {
  const { runPipeline } = await module('pipeline');
  const events = [];
  let count = 0;
  const result = await runPipeline({ text: '天气', model: 'small', mode: 'staged', context }, { providers: { ollama: { async invoke(request) { count++; if (count === 2) { const error = new Error('坏 JSON'); error.trace = { stage: request.stage, wallMs: 2, error: '坏 JSON' }; throw error; } return { value: { domain: 'weather' }, trace: { stage: 'domain', wallMs: 1 } }; } } }, onTrace: trace => events.push(trace) });
  assert.equal(result.status, 'error');
  assert.equal(result.traces.length, 2);
  assert.equal(events.length, 2);
  assert.match(result.error, /坏 JSON/);
});
