import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname, basename} from 'node:path';
import {createApplication} from '../src/application.mjs';
import {RuntimeStore} from '../src/runtime.mjs';

// All provider health and pipeline operations are stubs. This suite never sends
// a request to Ollama, executes a real model or writes benchmark evidence.
const fixedPhone = {latitude: 31.2304, longitude: 121.4737, source: 'fixture', label: '模拟手机当前位置'};
const jsonFile = async (path, value) => {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, JSON.stringify(value), 'utf8');
};
const post = (url, value) => fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(value)});

async function setup({configured = true, pipelineImpl} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'edge-single100-http-'));
  const store = await new RuntimeStore(join(directory, 'runtime')).init();
  const reportPath = join(directory, 'report.json');
  const statePath = join(directory, 'state.json');
  const evidenceDirectory = join(directory, 'evidence');
  const inputs = [], healthCalls = [];
  const fetchImpl = async url => {
    healthCalls.push(url);
    assert.ok(url.endsWith('/api/tags') || url.endsWith('/api/version'), 'only stubbed provider health queries');
    return {ok: true, json: async () => url.endsWith('/api/tags') ? {models: [
      {name: 'qwen2.5:0.5b', details: {parameter_size: '0.5B'}},
      {name: 'qwen2.5:1.5b', details: {parameter_size: '1.5B'}},
      {name: 'qwen2.5:3b', details: {parameter_size: '3.1B'}},
      {name: 'qwen2.5:7b', details: {parameter_size: '7.6B'}}
    ]} : {version: 'stub-only'}};
  };
  const pipeline = async input => {
    inputs.push(structuredClone(input));
    if (pipelineImpl) return pipelineImpl(input);
    return {domain: 'device', api: 'device.battery.level', extractedArguments: {}, modelArguments: {}, groundedArguments: {}, status: 'ready_mock', totalMs: 1, traces: [], resolved: {arguments: {}, sources: {}, missing: [], issues: [], status: 'ready_mock'}};
  };
  const handler = createApplication({store, runPipeline: pipeline, providers: {}, fetchImpl,
    catalog: {version: 'single-service-v3', domains: [], capabilities: []}, docs: [],
    cases: [{id: 'http-stub', text: '读取手机电量', expected: {domain: 'device', api: 'device.battery.level', arguments: {}, status: 'ready_mock'}}],
    baseContext: {now: '2026-10-10T08:00:00+08:00', timezone: 'Asia/Shanghai', location: fixedPhone},
    contextDefaults: {location: fixedPhone},
    ...(configured ? {singleService100ReportPath: reportPath, singleService100StatePath: statePath, singleService100EvidenceDirectory: evidenceDirectory} : {})
  });
  const server = createServer(handler);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {url, store, directory, reportPath, statePath, evidenceDirectory, inputs, healthCalls,
    close: async () => {
      await new Promise(done => server.close(done));
      await store.queue.run(async () => {});
      // Recursive cleanup is confined to the exact mkdtemp directory created by
      // this test; validate its resolved parent/name before any deletion.
      const target = resolve(directory);
      assert.equal(dirname(target), resolve(tmpdir()));
      assert.ok(basename(target).startsWith('edge-single100-http-'));
      await rm(target, {recursive: true, force: true, maxRetries: 5, retryDelay: 10});
    }
  };
}

test('single-service-100 HTTP is empty/not-started without configured or generated evidence', async () => {
  for (const configured of [false, true]) {
    const app = await setup({configured});
    try {
      const report = await (await fetch(`${app.url}/api/single-service-100-report`)).json();
      assert.equal(report.status, 'not_started');
      assert.deepEqual(report.progress, {done: 0, total: 3000});
      assert.deepEqual(report.summary, []);
      assert.deepEqual(report.cells, []);
      assert.deepEqual(report.examples, []);
      assert.deepEqual(await (await fetch(`${app.url}/api/single-service-100-results`)).json(), {rows: []});
      assert.equal((await fetch(`${app.url}/api/single-service-100-run/qwen2.5-1.5b/e100-files-011`)).status, 404);
      assert.equal(app.inputs.length, 0);
      assert.equal(app.healthCalls.length, 0);
    } finally {await app.close();}
  }
});

test('static report and result filters preserve actual partial denominators without invoking providers', async () => {
  const app = await setup();
  try {
    const report = {id: 'fixture-manifest', status: 'running', progress: {done: 3, total: 3000}, summary: [
      {model: 'qwen2.5:1.5b', total: 2, planned: 1000, api: {correct: 1, total: 2, accuracy: 0.5}},
      {model: 'qwen2.5:3b', total: 1, planned: 1000, api: {correct: 1, total: 1, accuracy: 1}}
    ], cells: [], examples: []};
    const rows = [
      {model: 'qwen2.5:1.5b', testDomain: 'files', caseId: 'e100-files-011', primary: 'correct'},
      {model: 'qwen2.5:1.5b', testDomain: 'files', caseId: 'e100-files-012', primary: 'parameters'},
      {model: 'qwen2.5:3b', testDomain: 'cloud', caseId: 'e100-cloud-011', primary: 'correct'}
    ];
    await jsonFile(app.reportPath, report);
    await jsonFile(join(app.evidenceDirectory, 'index.json'), {manifestId: report.id, status: 'running', rows});
    assert.deepEqual(await (await fetch(`${app.url}/api/single-service-100-report`)).json(), report);
    const failed = await (await fetch(`${app.url}/api/single-service-100-results?model=qwen2.5%3A1.5b&domain=files&failed=true`)).json();
    assert.equal(failed.manifestId, report.id);
    assert.deepEqual(failed.rows, [rows[1]]);
    assert.deepEqual((await (await fetch(`${app.url}/api/single-service-100-results?domain=cloud`)).json()).rows, [rows[2]]);
    assert.deepEqual((await (await fetch(`${app.url}/api/single-service-100-results?model=qwen2.5%3A7b`)).json()).rows, []);
    assert.deepEqual((await (await fetch(`${app.url}/api/single-service-100-results?domain=..%2Fsecret`)).json()).rows, []);
    assert.equal(app.inputs.length, 0);
    assert.equal(app.healthCalls.length, 0);
  } finally {await app.close();}
});

test('raw detail is read-only, model/domain scoped, and rejects 7B and path traversal', async () => {
  const app = await setup();
  try {
    const path = join(app.evidenceDirectory, 'qwen2.5-1.5b', 'e100-files-011.json');
    const record = {manifestId: 'fixture-manifest', model: 'qwen2.5:1.5b', caseId: 'e100-files-011', run: {traces: [{raw: '{"api":"files.search"}', schema: {type: 'object'}, messages: [{role: 'user', content: '本地文件'}]}]}};
    await jsonFile(path, record);
    await jsonFile(join(app.directory, 'secret.json'), {secret: 'must-not-be-served'});
    const before = await readFile(path, 'utf8');
    assert.deepEqual(await (await fetch(`${app.url}/api/single-service-100-run/qwen2.5-1.5b/e100-files-011`)).json(), record);
    for (const suffix of [
      'qwen2.5-7b/e100-files-011',
      'qwen2.5-1.5b/e100-unknown-011',
      'qwen2.5-1.5b/e100-files-999',
      'qwen2.5-1.5b/e100-files-011/extra',
      'qwen2.5-1.5b/e100-files-011%2F..%2Fsecret',
      'qwen2.5-1.5b/..%5C..%5Csecret',
      '%2e%2e/secret.json'
    ]) {
      const response = await fetch(`${app.url}/api/single-service-100-run/${suffix}`);
      assert.equal(response.status, 404, suffix);
      assert.equal(JSON.stringify(await response.json()).includes('must-not-be-served'), false, suffix);
    }
    assert.equal((await post(`${app.url}/api/single-service-100-run/qwen2.5-1.5b/e100-files-011`, {})).status, 404);
    assert.equal(await readFile(path, 'utf8'), before, 'detail endpoint must not rewrite original evidence');
    assert.equal(app.inputs.length, 0);
  } finally {await app.close();}
});

test('fresh running manifest with a live process locks POST runs and evaluations with 409', async () => {
  const app = await setup();
  try {
    await jsonFile(app.statePath, {id: 'live-benchmark', status: 'running', updatedAt: new Date().toISOString(), runner: {pid: process.pid}, progress: {done: 7, total: 3000}, active: {model: 'qwen2.5:1.5b'}});
    const health = await (await fetch(`${app.url}/api/health`)).json();
    assert.equal(health.lab.exclusiveBenchmark.id, 'live-benchmark');
    for (const [path, input] of [
      ['/api/runs', {text: '读取手机电量', model: 'qwen2.5:3b'}],
      ['/api/evaluations', {models: ['qwen2.5:3b'], limit: 1}]
    ]) {
      const response = await post(app.url + path, input);
      assert.equal(response.status, 409, path);
      assert.match((await response.json()).error, /独占|千题/);
    }
    assert.equal(app.inputs.length, 0);
    assert.equal(app.store.runs.length, 0);
    assert.equal(app.store.evaluations.length, 0);
  } finally {await app.close();}
});

test('a validated request waiting in the serial queue is rejected by the second gate before model invocation', async () => {
  let enteredFirst, releaseFirst;
  const firstEntered = new Promise(done => {enteredFirst = done;});
  const firstHeld = new Promise(done => {releaseFirst = done;});
  const app = await setup({pipelineImpl: async input => {
    if (input.text === '读取手机电量，第一请求') {enteredFirst(); await firstHeld;}
    return {domain: 'device', api: 'device.battery.level', extractedArguments: {}, status: 'ready_mock', totalMs: 1, traces: []};
  }});
  let first, second;
  try {
    first = post(`${app.url}/api/runs`, {text: '读取手机电量，第一请求', model: 'qwen2.5:3b'});
    await firstEntered;
    second = post(`${app.url}/api/runs`, {text: '读取手机电量，已验证的待调用请求', model: 'qwen2.5:3b'});
    let state;
    for (let index = 0; index < 100; index++) {
      state = await (await fetch(`${app.url}/api/health`)).json();
      if (state.queueDepth === 2) break;
      await new Promise(done => setTimeout(done, 5));
    }
    assert.equal(state.queueDepth, 2, 'second request has passed validation and entered the queue');
    assert.equal(state.lab.exclusiveBenchmark, null, 'there was no gate during validation');
    assert.equal(app.inputs.length, 1, 'only first stub call has started');
    await jsonFile(app.statePath, {id: 'gate-started-after-validation', status: 'running', updatedAt: new Date().toISOString(), runner: {pid: process.pid}, progress: {done: 0, total: 3000}});
    releaseFirst();
    assert.equal((await first).status, 200);
    const rejected = await second;
    assert.equal(rejected.status, 409);
    assert.match((await rejected.json()).error, /未发给模型|独占/);
    assert.equal(app.inputs.length, 1, 'queued request never reaches the pipeline stub');
    assert.equal(app.store.runs.length, 1, 'the rejected request is not stored as a model call');
  } finally {
    releaseFirst();
    await Promise.allSettled([first, second].filter(Boolean));
    await app.close();
  }
});

test('expired or dead runner state releases the lock and does not permanently block stub runs', async () => {
  const app = await setup();
  try {
    for (const state of [
      {updatedAt: new Date(Date.now() - 301000).toISOString(), runner: {pid: process.pid}},
      {updatedAt: new Date().toISOString(), runner: {pid: 2147483647}}
    ]) {
      await jsonFile(app.statePath, {id: 'stale-benchmark', status: 'running', ...state});
      assert.equal((await (await fetch(`${app.url}/api/health`)).json()).lab.exclusiveBenchmark, null);
      assert.equal((await post(`${app.url}/api/runs`, {text: '读取手机电量', model: 'qwen2.5:3b'})).status, 200);
    }
    assert.equal(app.inputs.length, 2);
  } finally {await app.close();}
});

test('invalid or far-future runner timestamps cannot create a permanent benchmark lock', async () => {
  const app = await setup();
  try {
    for (const updatedAt of ['not-a-date', undefined, new Date(Date.now() + 86400000).toISOString()]) {
      await jsonFile(app.statePath, {id: 'bad-clock', status: 'running', updatedAt, runner: {pid: process.pid}});
      assert.equal((await (await fetch(`${app.url}/api/health`)).json()).lab.exclusiveBenchmark, null, String(updatedAt));
    }
  } finally {await app.close();}
});

test('phone position stays fixture-only at HTTP boundary and never accepts browser/PC/native provenance', async () => {
  const app = await setup();
  try {
    const input = {text: '读取手机电量', model: 'qwen2.5:3b'};
    assert.equal((await post(`${app.url}/api/runs`, input)).status, 200);
    assert.deepEqual(app.inputs[0].context.location, fixedPhone);
    const alternateMock = {latitude: 39.9, longitude: 116.4, source: 'fixture', label: '另一模拟手机位置'};
    assert.equal((await post(`${app.url}/api/runs`, {...input, context: {location: alternateMock}})).status, 200);
    assert.deepEqual(app.inputs[1].context.location, alternateMock);
    for (const source of ['browser', 'pc', 'harmony', undefined]) {
      const response = await post(`${app.url}/api/runs`, {...input, context: {location: {latitude: 39.9, longitude: 116.4, source}}});
      assert.equal(response.status, 400, String(source));
      assert.match((await response.json()).error, /fixture|电脑|内部/);
    }
    assert.equal(app.inputs.length, 2, 'rejected provenance never reaches even the stub pipeline');
  } finally {await app.close();}
});
