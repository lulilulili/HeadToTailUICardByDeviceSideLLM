import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createProviders } from '../src/providers.mjs';

const testKey = 'typesafe-local-test-secret';
const decision = {
  state: { text: '明天上海的湿度', selectedObjectTypes: [] },
  answerKey: 'domain',
  question: { type: 'choice', instructions: '选择业务领域', criteria: { weather: '天气信息', unsupported: { description: '未支持请求' } } }
};
const schema = { type: 'object', properties: { domain: { enum: ['weather', 'unsupported'] } }, required: ['domain'], additionalProperties: false };
const request = { stage: 'domain', decision, schema, promptMeta: { version: 'jev-choice-test' } };
const response = () => ({ model: 'jev-1.13.0', answers: { domain: { type: 'choice', choice: 'weather', probabilities: { weather: 0.9, unsupported: 0.1 }, confidence: 0.8 } }, usage: { input_tokens: 98, output_tokens: 9 } });
const provider = (config = {}) => createProviders({ jev: { apiKey: testKey, ...config } }).jev;

async function serve(handler, fn) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const json = (res, value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };

test('official Jev exposes a credential-free status and cloud model default', () => {
  const jev = provider();
  assert.equal(jev.defaultModel, 'jev-latest');
  assert.deepEqual(jev.getStatus(), { provider: 'jev', configured: true, official: true, cloud: true, model: 'jev-latest', baseURL: 'https://api.typesafe.ai', sdkVersion: '0.6.0' });
  assert.ok(!JSON.stringify(jev).includes(testKey));
  assert.ok(!JSON.stringify(jev.getStatus()).includes(testKey));
});

test('official SDK dependency is pinned exactly and locked', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.dependencies?.['@typesafe-ai/sdk'], '0.6.0');
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url)));
  assert.equal(lock.packages['node_modules/@typesafe-ai/sdk'].version, '0.6.0');
  assert.ok(lock.packages['node_modules/@typesafe-ai/sdk'].integrity.startsWith('sha512-'));
});

test('official SDK sends one systemone choice request and retains actual model and probabilities', async () => {
  let body, headers, count = 0;
  await serve(async (req, res) => {
    count++; assert.equal(req.url, '/v1/systemone'); assert.equal(req.method, 'POST');
    headers = req.headers;
    body = JSON.parse(Buffer.concat(await Array.fromAsync(req)).toString());
    json(res, response());
  }, async baseURL => {
    const result = await provider({ baseURL }).invoke({ ...request, model: 'jev-pinned' });
    assert.deepEqual(body, { state: decision.state, model: 'jev-pinned', questions: { domain: decision.question } });
    assert.equal(headers.authorization, `Bearer ${testKey}`);
    assert.match(headers['x-typesafe-sdk'], /0\.6\.0/);
    assert.equal(count, 1);
    assert.deepEqual(result.value, { domain: 'weather' });
    assert.equal(result.trace.provider, 'jev');
    assert.equal(result.trace.model, 'jev-1.13.0');
    assert.equal(result.trace.requestedModel, 'jev-pinned');
    assert.deepEqual(result.trace.probabilities, { weather: 0.9, unsupported: 0.1 });
    assert.equal(result.trace.confidence, 0.8);
    assert.deepEqual(result.trace.usage, response().usage);
    assert.equal(result.trace.inputTokens, 98); assert.equal(result.trace.outputTokens, 9);
    assert.equal(result.trace.promptMs, null); assert.equal(result.trace.generationMs, null);
    assert.equal(result.trace.tokensPerSecond, null);
    assert.ok(result.trace.wallMs >= 0);
    assert.deepEqual(JSON.parse(result.trace.raw), response());
    assert.deepEqual(result.trace.request, body);
    assert.equal(result.trace.promptVersion, 'jev-choice-test');
    assert.ok(!JSON.stringify(result).includes(testKey));
  });
});

test('intent choice preserves object descriptions and maps answerKey api', async () => {
  const criteria = { 'weather.current.humidity': { object: 'current', field: 'humidity', description: '当前湿度' }, unsupported: '其他请求' };
  let received;
  const result = await provider({ fetch: async (url, init) => {
    received = JSON.parse(init.body);
    const payload = response(); payload.answers = { api: { type: 'choice', choice: 'weather.current.humidity', probabilities: { 'weather.current.humidity': 1, unsupported: 0 }, confidence: 1 } };
    return new Response(JSON.stringify(payload));
  } }).invoke({ stage: 'intent', decision: { state: { text: '当前湿度', domain: 'weather' }, answerKey: 'api', question: { type: 'choice', instructions: '选择 API', criteria } } });
  assert.deepEqual(result.value, { api: 'weather.current.humidity' });
  assert.deepEqual(received.questions.api.criteria, criteria);
});

test('unconfigured official Jev fails with its own trace before a network request', async () => {
  let called = false;
  const jev = provider({ apiKey: '', fetch: async () => { called = true; throw new Error('unreachable'); } });
  assert.equal(jev.getStatus().configured, false);
  await assert.rejects(jev.invoke(request), error => {
    assert.match(error.message, /TYPESAFE_API_KEY/);
    assert.equal(error.trace.provider, 'jev'); assert.ok(error.trace.wallMs >= 0);
    return true;
  });
  assert.equal(called, false);
});

test('official Jev only accepts domain and intent choice decisions', async () => {
  let called = 0;
  const jev = provider({ fetch: async () => { called++; return new Response(JSON.stringify(response())); } });
  for (const stage of ['arguments', 'unified', 'intent_arguments']) await assert.rejects(jev.invoke({ ...request, stage }), /domain.*intent/);
  for (const invalid of [undefined, { ...decision, answerKey: 'api' }, { ...decision, state: '天气' }, { ...decision, question: { ...decision.question, criteria: ['weather'] } }, { ...decision, question: { ...decision.question, criteria: {} } }, { ...decision, question: { ...decision.question, criteria: { weather: 42 } } }]) {
    await assert.rejects(jev.invoke({ ...request, decision: invalid }), /decision|criteria|state|answerKey/);
  }
  assert.equal(called, 0);
});

test('choice count accepts exactly 255 options and rejects 256 before transport', async () => {
  let called = 0;
  const criteria = Object.fromEntries(Array.from({ length: 255 }, (_, i) => [`api${i}`, `能力${i}`]));
  const jev = provider({ fetch: async () => {
    called++;
    const payload = response(); payload.answers.domain.probabilities = Object.fromEntries(Object.keys(criteria).map(key => [key, key === 'api0' ? 1 : 0])); payload.answers.domain.choice = 'api0';
    return new Response(JSON.stringify(payload));
  } });
  await jev.invoke({ stage: 'domain', decision: { ...decision, question: { ...decision.question, criteria } } });
  criteria.api255 = '超额能力';
  await assert.rejects(jev.invoke({ stage: 'domain', decision: { ...decision, question: { ...decision.question, criteria } } }), /255/);
  assert.equal(called, 1);
});

test('malformed official answers fail without correction and preserve response trace', async () => {
  const mutations = [
    p => { p.answers.domain.choice = 'not-in-criteria'; },
    p => { p.answers.domain.type = 'score'; },
    p => { p.answers.domain.probabilities.weather = -0.1; },
    p => { p.answers.domain.probabilities.weather = '0.9'; },
    p => { p.answers.domain.probabilities.extra = 0; },
    p => { delete p.answers.domain.probabilities.unsupported; },
    p => { p.answers.domain.probabilities.weather = 0.2; },
    p => { p.answers.domain.confidence = 1.1; },
    p => { delete p.answers.domain; },
    p => { p.usage.input_tokens = -1; },
    p => { delete p.model; }
  ];
  for (const mutate of mutations) {
    const payload = response(); mutate(payload);
    await assert.rejects(provider({ fetch: async () => new Response(JSON.stringify(payload)) }).invoke(request), error => {
      assert.match(error.message, /响应|choice|概率|confidence|usage|model/);
      assert.deepEqual(JSON.parse(error.trace.raw), payload);
      assert.ok(error.trace.wallMs >= 0);
      return true;
    });
  }
});

test('provided output schema is validated after the official answer', async () => {
  await assert.rejects(provider({ fetch: async () => new Response(JSON.stringify(response())) }).invoke({ ...request, schema: { ...schema, properties: { domain: { const: 'unsupported' } } } }), /schema/);
});

for (const status of [401, 429]) test(`HTTP ${status} makes exactly one SDK attempt and redacts reflected credentials`, async () => {
  let count = 0;
  await serve((req, res) => { count++; json(res, { error: { message: `Reflected ${testKey}`, authorization: `Bearer ${testKey}` } }, status); }, async baseURL => {
    await assert.rejects(provider({ baseURL }).invoke(request), error => {
      assert.equal(error.trace.httpStatus, status);
      assert.equal(error.trace.provider, 'jev');
      assert.ok(error.trace.wallMs >= 0);
      assert.ok(!JSON.stringify(error.trace).includes(testKey));
      assert.ok(!error.message.includes(testKey));
      assert.ok(!error.stack.includes(testKey));
      assert.ok(!error.cause || !JSON.stringify(error.cause).includes(testKey));
      assert.ok(error.trace.raw.includes('[REDACTED]'));
      return true;
    });
    assert.equal(count, 1);
  });
});

test('SDK timeout remains visible without retry or provider fallback', async () => {
  let count = 0;
  await serve(() => { count++; }, async baseURL => {
    await assert.rejects(provider({ baseURL }).invoke({ ...request, options: { timeoutMs: 100 } }), error => {
      assert.equal(error.name, 'APITimeoutError'); assert.equal(error.trace.timeoutMs, 100);
      assert.ok(error.trace.wallMs >= 90); return true;
    });
    assert.equal(count, 1);
  });
});

test('SDK caller abort retains one trace and no retries', async () => {
  const controller = new AbortController(); let count = 0;
  await serve(() => { count++; controller.abort(); }, async baseURL => {
    await assert.rejects(provider({ baseURL }).invoke({ ...request, signal: controller.signal }), error => {
      assert.equal(error.name, 'APIUserAbortError'); assert.ok(error.trace.wallMs >= 0); return true;
    });
    assert.equal(count, 1);
  });
});

test('injected clients receive explicit timeout and zero retry policy', async () => {
  let observed;
  const client = { async systemOne(body, options) { observed = { body, options }; return response(); } };
  await provider({ client }).invoke({ ...request, options: { timeoutMs: 500 } });
  assert.equal(observed.options.timeout, 500);
  assert.deepEqual(observed.options.retry, { maxRetries: 0 });
  assert.deepEqual(observed.body.questions.domain, decision.question);
});

test('known credential is also redacted if reflected in a successful raw response or request state', async () => {
  const payload = response(); payload.extra = { text: testKey };
  const result = await provider({ fetch: async () => new Response(JSON.stringify(payload)) }).invoke({ ...request, decision: { ...decision, state: { text: `讨论文本 ${testKey}` } } });
  assert.ok(!JSON.stringify(result.trace).includes(testKey));
  assert.ok(result.trace.raw.includes('[REDACTED]'));
  assert.ok(JSON.stringify(result.trace.request).includes('[REDACTED]'));
});

test('a choice contradicting its probability maximum is a visible response error', async () => {
  const payload = response(); payload.answers.domain.probabilities = { weather: 0.1, unsupported: 0.9 };
  await assert.rejects(provider({ fetch: async () => new Response(JSON.stringify(payload)) }).invoke(request), /choice.*概率/);
});

test('all trace metadata is redacted, including a reflected prompt version', async () => {
  const result = await provider({ fetch: async () => new Response(JSON.stringify(response())) }).invoke({ ...request, promptMeta: { version: testKey } });
  assert.ok(!JSON.stringify(result.trace).includes(testKey));
});

test('status never exposes embedded URL credentials or query strings even for invalid configuration', async () => {
  const jev = provider({ baseURL: 'https://localuser:localpass@api.typesafe.ai/v1?api_key=localpass' });
  const status = JSON.stringify(jev.getStatus());
  assert.ok(!status.includes('localuser')); assert.ok(!status.includes('localpass'));
  await assert.rejects(jev.invoke(request), /baseURL/);
});

test('malformed JSON retains the physical SDK response text', async () => {
  await serve((req, res) => { res.end('{bad json'); }, async baseURL => {
    await assert.rejects(provider({ baseURL }).invoke(request), error => {
      assert.match(error.message, /有效 JSON/); assert.equal(error.trace.raw, '{bad json');
      assert.equal(error.trace.httpStatus, 200); return true;
    });
  });
});

test('SDK timeout covers a partially delivered response body', async () => {
  let calls = 0;
  await serve((req, res) => { calls++; res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); }, async baseURL => {
    await assert.rejects(provider({ baseURL }).invoke({ ...request, options: { timeoutMs: 100 } }), error => {
      assert.equal(error.name, 'APITimeoutError'); assert.equal(error.trace.timeoutMs, 100); return true;
    });
    assert.equal(calls, 1);
  });
});

test('caller cancellation before transport cannot make a physical request', async () => {
  let calls = 0; const controller = new AbortController(); controller.abort();
  await assert.rejects(provider({ fetch: async () => { calls++; throw new Error('unexpected'); } }).invoke({ ...request, signal: controller.signal }), error => {
    assert.equal(error.name, 'AbortError'); assert.equal(error.trace.provider, 'jev'); return true;
  });
  assert.equal(calls, 0);
});

test('SDK connection errors cannot reflect known credentials through causes', async () => {
  await assert.rejects(provider({ fetch: async () => { throw new Error(`connection ${testKey}`); } }).invoke(request), error => {
    assert.equal(error.name, 'APIConnectionError');
    assert.ok(!error.message.includes(testKey)); assert.ok(!JSON.stringify(error.trace).includes(testKey));
    assert.equal(error.cause, undefined); return true;
  });
});

test('environment configuration honors JEV_MODEL and keeps TYPESAFE_API_KEY server-side', async () => {
  const names = ['TYPESAFE_API_KEY', 'JEV_MODEL', 'TYPESAFE_BASE_URL'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.TYPESAFE_API_KEY = testKey; process.env.JEV_MODEL = 'jev-test-env'; process.env.TYPESAFE_BASE_URL = 'https://api.typesafe.ai';
    const jev = createProviders().jev;
    assert.equal(jev.defaultModel, 'jev-test-env'); assert.equal(jev.getStatus().configured, true);
    assert.ok(!JSON.stringify(jev.getStatus()).includes(testKey));
    assert.equal(provider({ apiKey: '', model: 'explicit-model' }).defaultModel, 'explicit-model');
    assert.equal(provider({ apiKey: '' }).getStatus().configured, false);
  } finally { for (const name of names) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
});

test('known credentials encoded as JSON Unicode escapes cannot be recovered from trace.raw', async () => {
  const payload = response(); payload.extra = testKey;
  const raw = JSON.stringify(payload).replace(testKey, [...testKey].map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''));
  const result = await provider({ fetch: async () => new Response(raw) }).invoke(request);
  assert.ok(!JSON.stringify(JSON.parse(result.trace.raw)).includes(testKey));
});

test('SDK logging stays off even when its environment requests debug logging', async () => {
  const previous = process.env.TYPESAFE_LOG_LEVEL;
  const original = Object.fromEntries(['debug', 'info', 'warn', 'error'].map(key => [key, console[key]]));
  const entries = [];
  try {
    process.env.TYPESAFE_LOG_LEVEL = 'debug';
    for (const key of Object.keys(original)) console[key] = (...args) => entries.push(args);
    await assert.rejects(provider({ fetch: async () => { throw new Error(testKey); } }).invoke(request));
    assert.deepEqual(entries, []);
  } finally {
    for (const key of Object.keys(original)) console[key] = original[key];
    if (previous === undefined) delete process.env.TYPESAFE_LOG_LEVEL; else process.env.TYPESAFE_LOG_LEVEL = previous;
  }
});

test('Ollama combined intent and arguments stage receives the joint output budget', async () => {
  let received;
  await serve(async (req, res) => {
    received = JSON.parse(Buffer.concat(await Array.fromAsync(req)).toString());
    json(res, { message: { content: '{"api":"weather.query","arguments":{}}' } });
  }, async ollamaUrl => {
    await createProviders({ ollamaUrl }).ollama.invoke({ stage: 'intent_arguments', model: 'local-test', messages: [{ role: 'user', content: '天气' }], schema: { type: 'object', properties: { api: { const: 'weather.query' }, arguments: { type: 'object' } }, required: ['api', 'arguments'], additionalProperties: false } });
    assert.equal(received.options.num_predict, 224);
  });
});
