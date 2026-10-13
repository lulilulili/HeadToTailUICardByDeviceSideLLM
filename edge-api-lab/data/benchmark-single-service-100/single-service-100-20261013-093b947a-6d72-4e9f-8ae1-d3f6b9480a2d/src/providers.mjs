import { createJevProvider } from './jev-provider.mjs';
import { createLayaProvider } from './laya-provider.mjs';

const budgets = { domain: 32, intent: 48, arguments: 160, intent_arguments: 224, unified: 224 };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const own = (object, key) => Object.hasOwn(object, key);

/** Small JSON Schema subset used by the catalog and the constrained model outputs. */
export function validateValue(schema, value) {
  const issues = [];
  function check(rule, item, path, errors) {
    if (!rule || rule === true) return;
    if (rule === false) { errors.push(`${path}: forbidden`); return; }
    if (rule.oneOf) {
      const valid = rule.oneOf.filter(branch => { const branchErrors = []; check(branch, item, path, branchErrors); return branchErrors.length === 0; });
      if (valid.length !== 1) errors.push(`${path}: does not match exactly one schema branch`);
    }
    if (rule.anyOf && !rule.anyOf.some(branch => { const branchErrors = []; check(branch, item, path, branchErrors); return branchErrors.length === 0; })) errors.push(`${path}: no matching schema branch`);
    if (rule.allOf) for (const branch of rule.allOf) check(branch, item, path, errors);
    if (own(rule, 'const') && !equal(rule.const, item)) errors.push(`${path}: const mismatch`);
    if (rule.enum && !rule.enum.some(option => equal(option, item))) errors.push(`${path}: enum mismatch`);
    const matches = type => type === 'null' ? item === null : type === 'object' ? item !== null && typeof item === 'object' && !Array.isArray(item)
      : type === 'array' ? Array.isArray(item) : type === 'integer' ? Number.isInteger(item) : type === 'number' ? typeof item === 'number' && Number.isFinite(item) : typeof item === type;
    if (rule.type && !(Array.isArray(rule.type) ? rule.type : [rule.type]).some(matches)) { errors.push(`${path}: expected ${rule.type}`); return; }
    if (typeof item === 'string') {
      if (rule.minLength !== undefined && item.trim().length < rule.minLength) errors.push(`${path}: insufficient string length`);
      if (rule.maxLength !== undefined && item.length > rule.maxLength) errors.push(`${path}: excessive string length`);
      if (rule.pattern && !new RegExp(rule.pattern).test(item)) errors.push(`${path}: pattern mismatch`);
    }
    if (typeof item === 'number') {
      if (rule.minimum !== undefined && item < rule.minimum) errors.push(`${path}: below minimum`);
      if (rule.maximum !== undefined && item > rule.maximum) errors.push(`${path}: above maximum`);
    }
    if (Array.isArray(item)) {
      if (rule.minItems !== undefined && item.length < rule.minItems) errors.push(`${path}: insufficient items`);
      if (rule.maxItems !== undefined && item.length > rule.maxItems) errors.push(`${path}: excessive items`);
      if (rule.uniqueItems && new Set(item.map(value => JSON.stringify(value))).size !== item.length) errors.push(`${path}: duplicate items`);
      if (rule.items) item.forEach((value, index) => check(rule.items, value, `${path}[${index}]`, errors));
    } else if (item !== null && typeof item === 'object') {
      const props = rule.properties ?? {};
      for (const key of rule.required ?? []) if (!own(item, key)) errors.push(`${path}.${key}: required`);
      for (const [key, value] of Object.entries(item)) {
        if (own(props, key)) check(props[key], value, `${path}.${key}`, errors);
        else if (rule.additionalProperties === false) errors.push(`${path}.${key}: extra property`);
        else if (typeof rule.additionalProperties === 'object') check(rule.additionalProperties, value, `${path}.${key}`, errors);
      }
    }
  }
  check(schema, value, '$', issues);
  return { valid: issues.length === 0, issues };
}

const millis = value => typeof value === 'number' && Number.isFinite(value) ? value / 1e6 : null;
const metric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const bounded = (value, fallback, low, high) => Math.max(low, Math.min(high, Number.isFinite(Number(value)) ? Number(value) : fallback));

export function createProviders({ ollamaUrl = 'http://127.0.0.1:11434', jevUrl, jev = {}, layaUrl, laya = {} } = {}) {
  function provider(name, url) {
    return {
      async invoke({ stage, model, messages, schema, promptMeta, options = {}, signal }) {
        const started = performance.now();
        const requestOptions = { temperature: 0, num_ctx: bounded(options.num_ctx ?? options.numCtx, 2048, 512, 8192), num_predict: bounded(options.num_predict ?? options.numPredict, budgets[stage] ?? 160, 16, 1024) };
        const timeoutMs = bounded(options.timeoutMs, 180000, 100, 1800000);
        const trace = { stage, provider: name, model, wallMs: 0, loadMs: null, promptMs: null, generationMs: null, inputTokens: null, outputTokens: null, tokensPerSecond: null, messages: structuredClone(messages), raw: '', schema: structuredClone(schema), startedAt: new Date().toISOString(), options: requestOptions, timeoutMs, promptVersion: promptMeta?.version ?? null, doneReason: null, truncated: false };
        if (promptMeta) trace.promptMeta = structuredClone(promptMeta);
        try {
          if (!url) throw new Error('Jev 接口未配置。请设置 JEV_URL 指向兼容的 HTTP 桥接服务。');
          if (!model || !schema || !Array.isArray(messages)) throw new TypeError('模型请求必须包含 model、messages 和 schema');
          const timeout = AbortSignal.timeout(timeoutMs);
          const activeSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
          const body = name === 'ollama' ? { model, messages, format: schema, stream: false, think: false, keep_alive: '5m', options: requestOptions }
            : { stage, model, messages, schema, options: requestOptions };
          const response = await fetch(name === 'ollama' ? `${url.replace(/\/$/, '')}/api/chat` : url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: activeSignal });
          const rawResponse = await response.text();
          trace.raw = rawResponse;
          if (!response.ok) throw new Error(`${name} HTTP ${response.status}: ${rawResponse.slice(0, 800)}`);
          let payload;
          try { payload = JSON.parse(rawResponse); } catch { throw new Error(`${name} 返回的 HTTP 内容不是有效 JSON`); }
          let value;
          if (name === 'ollama') {
            trace.doneReason = payload.done_reason ?? null;
            trace.truncated = trace.doneReason === 'length';
            trace.loadMs = millis(payload.load_duration);
            trace.promptMs = millis(payload.prompt_eval_duration);
            trace.generationMs = millis(payload.eval_duration);
            trace.inputTokens = metric(payload.prompt_eval_count);
            trace.outputTokens = metric(payload.eval_count);
            if (typeof payload.message?.content !== 'string') throw new Error('Ollama 响应缺少 message.content');
            trace.raw = payload.message.content;
            try { value = JSON.parse(trace.raw); } catch { throw new Error('模型输出不是有效 JSON；本实验不自动重试或修复输出'); }
          } else {
            const values = payload.metrics ?? payload.trace ?? payload;
            trace.doneReason = payload.doneReason ?? payload.done_reason ?? values.doneReason ?? null;
            trace.truncated = trace.doneReason === 'length' || payload.truncated === true;
            for (const key of ['loadMs', 'promptMs', 'generationMs', 'inputTokens', 'outputTokens']) trace[key] = metric(values[key]);
            value = payload.value;
            trace.raw = JSON.stringify(value) ?? rawResponse;
          }
          if (trace.outputTokens !== null && trace.generationMs > 0) trace.tokensPerSecond = trace.outputTokens / (trace.generationMs / 1000);
          const validation = validateValue(schema, value);
          if (!validation.valid) throw new Error(`输出 schema 结构校验失败：${validation.issues.join('；')}`);
          trace.wallMs = performance.now() - started;
          return { value, trace };
        } catch (cause) {
          trace.wallMs = performance.now() - started;
          if (trace.outputTokens !== null && trace.generationMs > 0) trace.tokensPerSecond = trace.outputTokens / (trace.generationMs / 1000);
          trace.error = cause.message;
          trace.errorType = cause.name;
          const error = new Error(cause.message, { cause });
          error.name = cause.name;
          error.trace = trace;
          throw error;
        }
      }
    };
  }
  return { ollama: provider('ollama', ollamaUrl), jev: createJevProvider({ ...jev, validateValue }), 'jev-bridge': provider('jev-bridge', jevUrl), laya: createLayaProvider({ url: layaUrl, ...laya, validateValue }) };
}
