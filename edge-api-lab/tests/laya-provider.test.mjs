import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createProviders } from '../src/providers.mjs';

const decision = { state: { text: '上海当前湿度', domain: 'weather', selectedObjectTypes: [] }, answerKey: 'api', question: { type: 'choice', instructions: '选择业务功能', criteria: { a0: '当前湿度', unsupported: '无法支持' } } };
const request = { stage: 'intent', decision, schema: { type: 'object', properties: { api: { enum: ['a0', 'unsupported'] } }, required: ['api'], additionalProperties: false }, promptMeta: { version: 'laya-local-test' } };
const payload = () => ({ model: 'laya-rl-agent', answers: { api: { type: 'choice', choice: 'a0', probabilities: { a0: 0.9, unsupported: 0.1 }, confidence: 0.53, answer_confidence: 0.9, x_jev_confidence: 0.8, x_tournament: { finalists: ['a0', 'unsupported'], rounds: [{ groups: 2 }] } } }, usage: { input_tokens: 120, output_tokens: 0, state_tokens: 20, state_tokens_dropped: 0, truncated: false, truncated_questions: [] }, routing: { model: 'multilingual', reason: 'explicit' } });
const provider = (config = {}) => createProviders({ laya: config }).laya;
const json = (res, value, status = 200, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(value)); };
async function serve(handler, fn) {
  const server = createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('Laya is a separately registered local provider with multilingual default', () => {
  assert.ok(provider()); assert.equal(provider().defaultModel, 'multilingual');
  assert.ok(createProviders().jev); assert.ok(createProviders()['jev-bridge']);
});

test('official-compatible local HTTP request uses no key and preserves Laya evidence', async () => {
  let received, headers, calls = 0;
  await serve(async (req, res) => {
    calls++; assert.equal(req.url, '/v1/systemone'); headers = req.headers;
    received = JSON.parse(Buffer.concat(await Array.fromAsync(req)).toString());
    json(res, payload(), 200, { 'x-inference-time-ms': '12.25' });
  }, async origin => {
    const result = await provider({ url: `${origin}/v1/systemone`, maxLen: 1024, headMaxLen: 512 }).invoke(request);
    assert.deepEqual(received, { state: decision.state, model: 'multilingual', questions: { api: decision.question }, max_len: 1024, head_max_len: 512, lang: 'zh' });
    assert.equal(headers.authorization, undefined); assert.equal(calls, 1);
    assert.deepEqual(result.value, { api: 'a0' });
    assert.equal(result.trace.provider, 'laya'); assert.equal(result.trace.cloud, false); assert.equal(result.trace.local, true);
    assert.equal(result.trace.model, 'laya-rl-agent'); assert.equal(result.trace.requestedModel, 'multilingual');
    assert.deepEqual(result.trace.routing, payload().routing);
    assert.deepEqual(result.trace.tournament, payload().answers.api.x_tournament);
    assert.equal(result.trace.httpCalls, 1); assert.equal(result.trace.forwardPasses, null);
    assert.equal(result.trace.inferenceMs, 12.25); assert.equal(result.trace.generationMs, null);
    assert.equal(result.trace.outputTokens, 0); assert.equal(result.trace.tokensPerSecond, null);
    assert.equal(result.trace.answerConfidence, 0.9); assert.equal(result.trace.jevConfidence, 0.8);
    assert.deepEqual(result.trace.usage, payload().usage);
    assert.deepEqual(JSON.parse(result.trace.raw), payload()); assert.deepEqual(result.trace.request, received);
    assert.ok(result.trace.wallMs >= 0);
  });
});

test('async health reports actual installed version, revision, tournament and device', async () => {
  await serve((req, res) => {
    assert.equal(req.url, '/health'); assert.equal(req.headers.authorization, undefined);
    json(res, { status: 'ok', ready: true, version: '0.4.6', loaded: ['multilingual'], revisions: { multilingual: 'frozen-sha' }, device: 'cpu', device_is_preference: false, tournamentGroup: 16, maxChoices: 255, maxLen: 1024, headMaxLen: 512 });
  }, async origin => {
    const status = await provider({ url: `${origin}/v1/systemone` }).getStatus();
    assert.equal(status.provider, 'laya'); assert.equal(status.configured, true); assert.equal(status.ok, true); assert.equal(status.ready, true);
    assert.equal(status.model, 'multilingual'); assert.equal(status.version, '0.4.6'); assert.equal(status.modelRevision, 'frozen-sha');
    assert.equal(status.tournamentGroup, 16); assert.equal(status.maxChoices, 255); assert.equal(status.device, 'cpu');
    assert.equal(status.local, true); assert.equal(status.cloud, false);
  });
});

test('stock official health can establish residency without inventing unavailable version or option cap', async () => {
  await serve((req, res) => json(res, { status: 'ok', loaded: ['multilingual'], revisions: { multilingual: 'rev' }, device: 'cpu', device_is_preference: false }), async origin => {
    const status = await provider({ url: `${origin}/v1/systemone` }).getStatus();
    assert.equal(status.ready, true); assert.equal(status.version, null); assert.equal(status.tournamentGroup, null); assert.equal(status.maxChoices, null);
    assert.equal(status.modelRevision, 'rev');
  });
});

test('unreachable or unready health is visible and cannot claim installed readiness', async () => {
  const failed = await provider({ fetch: async () => { throw new Error('local service unavailable'); } }).getStatus();
  assert.equal(failed.configured, true); assert.equal(failed.ok, false); assert.equal(failed.ready, false); assert.match(failed.error, /unavailable/);
  await serve((req, res) => json(res, { status: 'ok', ready: false, loaded: ['multilingual'] }), async origin => {
    const status = await provider({ url: `${origin}/v1/systemone` }).getStatus(); assert.equal(status.ok, true); assert.equal(status.ready, false);
  });
  await serve((req, res) => json(res, { status: 'ok' }), async origin => {
    const status = await provider({ url: `${origin}/v1/systemone` }).getStatus(); assert.equal(status.ready, false);
  });
});

test('external HTTPS hosts, URL credentials and query parameters are rejected before fetch', async () => {
  let calls = 0;
  for (const url of ['https://api.typesafe.ai/v1/systemone', 'http://example.com/v1/systemone', 'http://127.0.0.1.example.com/v1/systemone', 'http://name:pass@127.0.0.1:8765/v1/systemone', 'http://127.0.0.1:8765/v1/systemone?key=secret']) {
    await assert.rejects(provider({ url, fetch: async () => { calls++; throw new Error('unexpected'); } }).invoke(request), /loopback|本机|URL/);
  }
  assert.equal(calls, 0);
});

test('loopback requests forbid redirecting inference to another host', async () => {
  let redirectMode;
  await provider({ fetch: async (url, init) => { redirectMode = init.redirect; return new Response(JSON.stringify(payload())); } }).invoke(request);
  assert.equal(redirectMode, 'error');
});

test('only domain and intent choices can reach Laya', async () => {
  let calls = 0; const laya = provider({ fetch: async () => { calls++; return new Response(JSON.stringify(payload())); } });
  for (const stage of ['arguments', 'unified', 'intent_arguments']) await assert.rejects(laya.invoke({ ...request, stage }), /domain.*intent/);
  await assert.rejects(laya.invoke({ ...request, decision: { ...decision, answerKey: 'domain' } }), /answerKey/);
  await assert.rejects(laya.invoke({ ...request, decision: { ...decision, question: { ...decision.question, criteria: ['a0'] } } }), /criteria/);
  assert.equal(calls, 0);
});

test('native usage missing metrics stays null rather than invented token counts', async () => {
  const data = payload(); delete data.usage;
  const result = await provider({ fetch: async () => new Response(JSON.stringify(data)) }).invoke(request);
  assert.equal(result.trace.inputTokens, null); assert.equal(result.trace.outputTokens, null); assert.equal(result.trace.usage, null);
});

test('explicit bridge forward counts are preserved without treating tournament rounds as forwards', async () => {
  const data = payload(); data.forwardPasses = 14;
  const result = await provider({ fetch: async () => new Response(JSON.stringify(data)) }).invoke(request);
  assert.equal(result.trace.forwardPasses, 14); assert.equal(result.trace.httpCalls, 1);
});

test('malformed choices, invalid probabilities and forbidden schema values fail with raw evidence', async () => {
  for (const mutate of [p => { p.answers.api.choice = 'outside'; }, p => { p.answers.api.probabilities.a0 = -1; }, p => { delete p.answers.api.probabilities.unsupported; }, p => { p.answers.api.confidence = 5; }]) {
    const data = payload(); mutate(data);
    await assert.rejects(provider({ fetch: async () => new Response(JSON.stringify(data)) }).invoke(request), error => {
      assert.ok(error.trace.raw); assert.equal(error.trace.provider, 'laya'); return true;
    });
  }
  await assert.rejects(provider({ fetch: async () => new Response(JSON.stringify(payload())) }).invoke({ ...request, schema: { type: 'object', properties: { api: { const: 'unsupported' } } } }), /schema/);
});

test('HTTP 413 and 503 fail once without retries or cloud fallback', async () => {
  for (const status of [413, 503]) {
    let calls = 0;
    await serve((req, res) => { calls++; json(res, { detail: 'candidate or capacity limit' }, status); }, async origin => {
      await assert.rejects(provider({ url: `${origin}/v1/systemone` }).invoke(request), error => {
        assert.equal(error.trace.httpStatus, status); assert.equal(error.trace.httpCalls, 1); assert.equal(error.trace.local, true); return true;
      });
      assert.equal(calls, 1);
    });
  }
});

test('timeout and abort keep local failed traces without additional requests', async () => {
  await serve(() => {}, async origin => {
    await assert.rejects(provider({ url: `${origin}/v1/systemone` }).invoke({ ...request, options: { timeoutMs: 100 } }), error => {
      assert.equal(error.name, 'TimeoutError'); assert.equal(error.trace.timeoutMs, 100); return true;
    });
  });
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(provider({ fetch: async () => { calls++; return new Response(''); } }).invoke({ ...request, signal: controller.signal }), error => {
    assert.equal(error.name, 'AbortError'); assert.equal(error.trace.httpCalls, 0); return true;
  });
  assert.equal(calls, 0);
});

test('head/state budgets are explicit and invalid relationships do not reach the server', async () => {
  let observed;
  await provider({ fetch: async (url, init) => { observed = JSON.parse(init.body); return new Response(JSON.stringify(payload())); } }).invoke({ ...request, options: { layaMaxLen: 2048, layaHeadMaxLen: 768 } });
  assert.equal(observed.max_len, 2048); assert.equal(observed.head_max_len, 768);
  await assert.rejects(provider().invoke({ ...request, options: { layaMaxLen: 512, layaHeadMaxLen: 1024 } }), /预算|budget/);
});

test('255 candidates are admitted to the configured tournament protocol but 256 are rejected', async () => {
  const criteria = Object.fromEntries(Array.from({ length: 255 }, (_, i) => [`c${i}`, `功能${i}`])); let calls = 0;
  const laya = provider({ fetch: async () => { calls++; const data = payload(); data.answers.api.choice = 'c0'; data.answers.api.probabilities = Object.fromEntries(Object.keys(criteria).map(key => [key, key === 'c0' ? 1 : 0])); return new Response(JSON.stringify(data)); } });
  await laya.invoke({ ...request, schema: undefined, decision: { ...decision, question: { ...decision.question, criteria } } });
  criteria.c255 = '多余';
  await assert.rejects(laya.invoke({ ...request, decision: { ...decision, question: { ...decision.question, criteria } } }), /255/);
  assert.equal(calls, 1);
});

test('compact choiceMap maps choice and probabilities to actual API IDs while retaining wire evidence', async () => {
  const result = await provider({ fetch: async () => new Response(JSON.stringify(payload())) }).invoke({ ...request,
    decision: { ...decision, choiceMap: { a0: 'weather.current.humidity', unsupported: 'unsupported' } },
    schema: { type: 'object', properties: { api: { enum: ['weather.current.humidity', 'unsupported'] } }, required: ['api'], additionalProperties: false }
  });
  assert.deepEqual(result.value, { api: 'weather.current.humidity' });
  assert.deepEqual(result.trace.probabilities, { 'weather.current.humidity': 0.9, unsupported: 0.1 });
  assert.deepEqual(result.trace.wireProbabilities, { a0: 0.9, unsupported: 0.1 });
  assert.deepEqual(result.trace.choiceMap, { a0: 'weather.current.humidity', unsupported: 'unsupported' });
  assert.equal(JSON.parse(result.trace.raw).answers.api.choice, 'a0');
  assert.deepEqual(result.trace.tournament, payload().answers.api.x_tournament);
});

test('choice maps cannot omit, duplicate or invent a wire candidate', async () => {
  let calls = 0;
  const laya = provider({ fetch: async () => { calls++; return new Response(JSON.stringify(payload())); } });
  for (const choiceMap of [{ a0: 'a' }, { a0: 'a', unsupported: 'a' }, { a0: 'a', unsupported: 'b', unknown: 'c' }]) {
    await assert.rejects(laya.invoke({ ...request, decision: { ...decision, choiceMap } }), /choiceMap/);
  }
  assert.equal(calls, 0);
});

test('model replies using foreign probability keys cannot bypass compact mapping', async () => {
  const data = payload(); data.answers.api.probabilities = { 'weather.current.humidity': 0.9, unsupported: 0.1 };
  await assert.rejects(provider({ fetch: async () => new Response(JSON.stringify(data)) }).invoke({ ...request, decision: { ...decision, choiceMap: { a0: 'weather.current.humidity', unsupported: 'unsupported' } } }), /概率|probabilit/);
});

test('reported state truncation and collapsed candidates fail visibly with complete native usage', async () => {
  for (const partial of [{ truncated: true, state_tokens_dropped: 2 }, { truncated_questions: ['api'] }, { options: { api: { total: 2, distinct: 1, tokens_per_option: 4 } } }]) {
    const data = payload(); data.usage = { ...data.usage, ...partial };
    await assert.rejects(provider({ fetch: async () => new Response(JSON.stringify(data)) }).invoke(request), error => {
      assert.match(error.message, /截断|折叠/); assert.deepEqual(error.trace.usage, data.usage); assert.ok(error.trace.raw); return true;
    });
  }
});

test('managed-launcher health metadata is identified separately from native readiness', async () => {
  const deployment = { source: 'edge-api-lab-managed-launcher', version: '0.4.6', tournamentGroup: 16, maxChoices: 255, maxLen: 4096, headMaxLen: 768, threads: 8, defaultModel: 'multilingual' };
  await serve((req, res) => json(res, { status: 'ok', loaded: ['multilingual'], revisions: { multilingual: 'frozen' }, device: 'cpu', deployment }), async origin => {
    const status = await provider({ url: `${origin}/v1/systemone` }).getStatus();
    assert.equal(status.ready, true); assert.equal(status.version, '0.4.6');
    assert.equal(status.tournamentGroup, 16); assert.equal(status.maxChoices, 255);
    assert.equal(status.maxLen, 4096); assert.equal(status.headMaxLen, 768); assert.equal(status.threads, 8);
    assert.deepEqual(status.deployment, deployment); assert.equal(status.metadataSource, 'edge-api-lab-managed-launcher');
  });
});

test('managed decisions cannot inject option_order or duplicate choices into state', async () => {
  const laya = provider({ fetch: async () => new Response(JSON.stringify(payload())) });
  await assert.rejects(laya.invoke({ ...request, decision: { ...decision, question: { ...decision.question, option_order: [1, 0] } } }), /question/);
  await assert.rejects(laya.invoke({ ...request, decision: { ...decision, state: { ...decision.state, choices: ['a0'] } } }), /state/);
  await assert.rejects(laya.invoke({ ...request, decision: { ...decision, question: { ...decision.question, criteria: { a0: { score: Infinity }, unsupported: '其他' } } } }), /criteria/);
});
