// Official API: https://docs.typesafe.ai/api
// SDK contract: https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/client.ts
export const JEV_SDK_VERSION = '0.6.0';
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const tokenCount = value => Number.isInteger(value) && value >= 0;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const jsonValue = value => value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
  || (Array.isArray(value) && value.every(jsonValue)) || (plainObject(value) && Object.values(value).every(jsonValue));
const trim = value => typeof value === 'string' ? value.trim() : '';
const timeout = value => Math.max(100, Math.min(1800000, Number.isFinite(Number(value)) ? Number(value) : 180000));

function validateDecision(stage, decision) {
  if (!['domain', 'intent'].includes(stage)) throw new TypeError('官方 Jev 只支持 domain 和 intent 的 choice 决策，不能生成自由参数');
  if (!plainObject(decision)) throw new TypeError('Jev 请求必须包含有效 decision');
  if (decision.answerKey !== (stage === 'domain' ? 'domain' : 'api')) throw new TypeError('decision.answerKey 与阶段不一致');
  if (!plainObject(decision.state) || !nonempty(decision.state.text) || !jsonValue(decision.state)) throw new TypeError('decision.state 必须包含用户原文 text');
  if (Object.keys(decision.state).some(key => !['text', 'domain', 'selectedObjectTypes'].includes(key))
    || (decision.state.domain !== undefined && !nonempty(decision.state.domain))
    || (decision.state.selectedObjectTypes !== undefined && (!Array.isArray(decision.state.selectedObjectTypes) || !decision.state.selectedObjectTypes.every(nonempty)))) throw new TypeError('decision.state 只允许 text、domain 和 selectedObjectTypes');
  const question = decision.question;
  if (!plainObject(question) || question.type !== 'choice' || !nonempty(question.instructions)) throw new TypeError('decision.question 必须是带 instructions 的 choice');
  if (!plainObject(question.criteria)) throw new TypeError('decision.question.criteria 必须是候选键到描述的对象映射');
  const keys = Object.keys(question.criteria);
  if (!keys.length || keys.length > 255) throw new TypeError('choice criteria 需要 1 至 255 个候选');
  if (keys.some(key => !nonempty(key)) || Object.values(question.criteria).some(value => !(typeof value === 'string' || plainObject(value)) || !jsonValue(value))) throw new TypeError('choice criteria 的描述必须为字符串或 JSON 对象');
  return keys;
}

function validateResponse(payload, key, keys) {
  if (!plainObject(payload) || !nonempty(payload.model)) throw new TypeError('Jev 响应缺少有效 model');
  const answer = payload.answers?.[key];
  if (!plainObject(answer) || answer.type !== 'choice' || !keys.includes(answer.choice)) throw new TypeError('Jev 响应 choice 必须属于请求 criteria');
  if (!plainObject(answer.probabilities) || Object.keys(answer.probabilities).length !== keys.length || keys.some(option => !Object.hasOwn(answer.probabilities, option) || !unit(answer.probabilities[option]))) throw new TypeError('Jev 响应概率分布必须完整覆盖 criteria，且值在 0 至 1 之间');
  const total = Object.values(answer.probabilities).reduce((sum, value) => sum + value, 0);
  // Permit floating-point/serialization rounding, without normalizing the returned distribution.
  if (Math.abs(total - 1) > 0.001) throw new TypeError('Jev 响应概率之和必须为 1');
  if (answer.probabilities[answer.choice] + 1e-9 < Math.max(...Object.values(answer.probabilities))) throw new TypeError('Jev 响应 choice 必须对应最高概率候选');
  if (!unit(answer.confidence)) throw new TypeError('Jev 响应 confidence 必须在 0 至 1 之间');
  if (!plainObject(payload.usage) || !tokenCount(payload.usage.input_tokens) || !tokenCount(payload.usage.output_tokens)) throw new TypeError('Jev 响应 usage 必须包含非负整数 input_tokens 和 output_tokens');
  return answer;
}

/** Server-side official Jev choice adapter. Client/fetch injection is for local contract tests. */
export function createJevProvider({ apiKey, baseURL, model, fetch: fetchImpl, client, validateValue } = {}) {
  const key = trim(apiKey === undefined ? process.env.TYPESAFE_API_KEY : apiKey);
  const apiBase = trim(baseURL === undefined ? process.env.TYPESAFE_BASE_URL : baseURL) || 'https://api.typesafe.ai';
  const defaultModel = trim(model === undefined ? process.env.JEV_MODEL : model) || 'jev-latest';
  let sdkClient = client;
  let sdk;
  const redact = text => {
    let result = String(text);
    if (key) for (const secret of new Set([key, JSON.stringify(key).slice(1, -1)])) result = result.split(secret).join('[REDACTED]');
    return result;
  };
  const safe = value => value === undefined ? undefined : JSON.parse(redact(JSON.stringify(value)));
  const safeRaw = raw => {
    try {
      const payload = JSON.parse(raw);
      const normalized = JSON.stringify(payload);
      const redacted = redact(normalized);
      // Decode JSON escapes before checking for a reflected secret; otherwise the UI's
      // JSON viewer could recover a credential that was invisible to a literal scan.
      if (redacted !== normalized) return redacted;
    } catch { /* Malformed/non-JSON HTTP responses still retain their redacted text. */ }
    return redact(raw);
  };
  const configured = () => !!key || typeof client?.systemOne === 'function';
  const publicBase = () => {
    try { const url = new URL(apiBase); return redact(`${url.origin}${url.pathname}`.replace(/\/+$/, '')); }
    catch { return '[INVALID URL]'; }
  };
  async function getClient() {
    // Do not load or construct the SDK until this provider is invoked: Ollama can start independently.
    sdk ??= await import('@typesafe-ai/sdk');
    const transport = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    // SDK 0.6.0 clones a streamed Response while buffering it. Cancelling both tee branches
    // on a mid-body timeout can leave an unhandled rejection in Node's fetch implementation.
    // Buffer under the SDK's own abort signal before returning a Response to that code.
    // Authentication, endpoint construction, timeout and retries remain owned by the SDK.
    const bufferedFetch = async (input, init) => {
      const response = await transport(input, init);
      const body = await response.arrayBuffer();
      return new Response([204, 205, 304].includes(response.status) ? null : body, { status: response.status, statusText: response.statusText, headers: response.headers });
    };
    sdkClient ??= new sdk.TypeSafeClient({ apiKey: key, baseURL: apiBase, defaultModel, fetch: bufferedFetch, logLevel: 'off', retry: { maxRetries: 0 } });
    return sdkClient;
  }
  return {
    defaultModel,
    getStatus() { return { provider: 'jev', configured: configured(), official: true, cloud: true, model: redact(defaultModel), baseURL: publicBase(), sdkVersion: JEV_SDK_VERSION }; },
    async invoke({ stage, model: requestedModel = defaultModel, decision, schema, promptMeta, options = {}, signal } = {}) {
      const started = performance.now();
      const timeoutMs = timeout(options.timeoutMs);
      const trace = { stage, provider: 'jev', official: true, cloud: true, sdkVersion: JEV_SDK_VERSION, model: redact(requestedModel), requestedModel: redact(requestedModel), wallMs: 0, loadMs: null, promptMs: null, generationMs: null, inputTokens: null, outputTokens: null, tokensPerSecond: null, raw: '', request: null, schema: safe(schema), startedAt: new Date().toISOString(), options: { retry: { maxRetries: 0 } }, timeoutMs, promptVersion: promptMeta?.version ?? null, doneReason: null, truncated: false, probabilities: null, confidence: null, usage: null };
      try {
        const keys = validateDecision(stage, decision);
        if (!configured()) throw new Error('官方 Jev 未配置。请设置 TYPESAFE_API_KEY');
        if (!nonempty(requestedModel)) throw new TypeError('Jev model 必须为非空字符串');
        const url = new URL(apiBase);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new TypeError('Jev baseURL 必须是无凭据和查询参数的 HTTP(S) API 根地址');
        const activeClient = await getClient();
        const body = { state: structuredClone(decision.state), model: requestedModel, questions: { [decision.answerKey]: sdk.choice(decision.question.instructions, structuredClone(decision.question.criteria)) } };
        trace.request = safe(body);
        if (promptMeta) trace.promptMeta = safe(promptMeta);
        signal?.throwIfAborted();
        const pending = activeClient.systemOne(body, { signal, timeout: timeoutMs, retry: { maxRetries: 0 } });
        let payload;
        if (typeof pending.asResponse === 'function') {
          const response = await pending.asResponse();
          trace.httpStatus = response.status;
          const raw = await response.text();
          trace.raw = safeRaw(raw);
          try { payload = JSON.parse(raw); } catch { throw new TypeError('Jev 响应不是有效 JSON'); }
        } else {
          payload = await pending;
          trace.raw = redact(JSON.stringify(payload) ?? '');
        }
        // Metrics are observed, not invented: the official API does not expose prefill/generation time.
        if (nonempty(payload?.model)) trace.model = redact(payload.model);
        trace.inputTokens = tokenCount(payload?.usage?.input_tokens) ? payload.usage.input_tokens : null;
        trace.outputTokens = tokenCount(payload?.usage?.output_tokens) ? payload.usage.output_tokens : null;
        trace.usage = safe(payload?.usage) ?? null;
        const answer = validateResponse(payload, decision.answerKey, keys);
        trace.probabilities = safe(answer.probabilities);
        trace.confidence = answer.confidence;
        const value = { [decision.answerKey]: answer.choice };
        if (schema) {
          // createProviders injects the shared validator; a standalone adapter lazily loads it.
          const validate = validateValue ?? (await import('./providers.mjs')).validateValue;
          const result = validate(schema, value);
          if (!result.valid) throw new TypeError(`输出 schema 结构校验失败：${result.issues.join('；')}`);
        }
        trace.wallMs = performance.now() - started;
        return { value, trace: safe(trace) };
      } catch (cause) {
        trace.wallMs = performance.now() - started;
        if (Number.isInteger(cause?.status)) trace.httpStatus = cause.status;
        if (cause?.body !== undefined) trace.raw = safeRaw(typeof cause.body === 'string' ? cause.body : JSON.stringify(cause.body));
        trace.error = redact(cause?.message ?? cause);
        trace.errorType = redact(cause?.name ?? 'Error');
        // SDK errors can contain request/response credentials. Do not retain the original cause or headers.
        const error = new Error(trace.error);
        error.name = trace.errorType;
        error.trace = safe(trace);
        throw error;
      }
    }
  };
}
