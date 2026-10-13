// Local author-provided server: https://github.com/NandhaKishorM/laya/blob/main/laya/serve.py
// Laya is a separately identified local backend; it is not TypeSafe's hosted Jev model.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const metric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const count = value => Number.isInteger(value) && value >= 0 ? value : null;
const probability = value => metric(value) !== null && value <= 1;
const jsonValue = value => value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
  || (Array.isArray(value) && value.every(jsonValue)) || (object(value) && Object.values(value).every(jsonValue));
const copy = value => value === undefined ? null : structuredClone(value);
const timeout = value => Math.max(100, Math.min(1800000, Number.isFinite(Number(value)) ? Number(value) : 180000));

function endpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError('Laya URL 必须是有效的本机 loopback HTTP 地址'); }
  const local = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
  if (url.protocol !== 'http:' || !local || url.username || url.password || url.search || url.hash) throw new TypeError('Laya 只允许无凭据和查询参数的本机 loopback HTTP URL');
  return url;
}
function publicURL(value) {
  try { const url = new URL(value); return `${url.origin}${url.pathname}`; }
  catch { return '[INVALID URL]'; }
}
function choices(stage, decision) {
  if (!['domain', 'intent'].includes(stage)) throw new TypeError('Laya 只支持 domain 和 intent 的 choice 决策，不能生成自由参数');
  if (!object(decision) || decision.answerKey !== (stage === 'domain' ? 'domain' : 'api')) throw new TypeError('Laya decision.answerKey 与阶段不一致');
  if (!object(decision.state) || !nonempty(decision.state.text) || !jsonValue(decision.state) || Object.keys(decision.state).some(key => !['text', 'domain', 'selectedObjectTypes'].includes(key))
    || (decision.state.domain !== undefined && !nonempty(decision.state.domain))
    || (decision.state.selectedObjectTypes !== undefined && (!Array.isArray(decision.state.selectedObjectTypes) || !decision.state.selectedObjectTypes.every(nonempty)))) throw new TypeError('Laya decision.state 只允许用户原文 text、domain 和 selectedObjectTypes');
  const question = decision.question;
  if (!object(question) || question.type !== 'choice' || !nonempty(question.instructions) || !object(question.criteria) || Object.keys(question).some(key => !['type', 'instructions', 'criteria'].includes(key))) throw new TypeError('Laya decision.question.criteria 必须是 choice 候选对象映射，不能添加其他控制字段');
  const keys = Object.keys(question.criteria);
  if (!keys.length || keys.length > 255) throw new TypeError('Laya choice criteria 需要 1 至 255 个候选；服务端须开启 tournament 才支持超过 100 个');
  if (keys.some(key => !nonempty(key)) || Object.values(question.criteria).some(value => !(typeof value === 'string' || object(value)) || !jsonValue(value))) throw new TypeError('Laya criteria 描述必须是字符串或 JSON 对象');
  const map = decision.choiceMap;
  if (map !== undefined && (stage !== 'intent' || !object(map) || Object.keys(map).length !== keys.length || keys.some(key => !Object.hasOwn(map, key) || !nonempty(map[key])) || new Set(Object.values(map)).size !== keys.length)) throw new TypeError('Laya choiceMap 必须完整且唯一地映射每个 wire 候选，不能遗漏、重复或添加未知候选');
  return keys;
}
function validateAnswer(payload, key, keys) {
  const answer = payload?.answers?.[key];
  if (!object(payload) || !nonempty(payload.model) || !object(answer) || answer.type !== 'choice' || !keys.includes(answer.choice)) throw new TypeError('Laya 响应 choice 必须属于请求 criteria，且包含实际 model');
  if (!object(answer.probabilities) || Object.keys(answer.probabilities).length !== keys.length || keys.some(option => !Object.hasOwn(answer.probabilities, option) || !probability(answer.probabilities[option]))) throw new TypeError('Laya 响应概率必须完整覆盖 wire criteria，且在 0 至 1 之间');
  // Laya's published decoder rounds each probability to four decimals. Preserve values,
  // allowing the maximum aggregate rounding error rather than renormalizing them.
  const total = Object.values(answer.probabilities).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > Math.max(0.001, keys.length * 0.00005 + 1e-8)) throw new TypeError('Laya 响应概率之和无效');
  if (!probability(answer.confidence) || answer.probabilities[answer.choice] + 1e-9 < Math.max(...Object.values(answer.probabilities))) throw new TypeError('Laya 响应 confidence 或最高概率 choice 无效');
  return answer;
}
function budget(value, fallback, name) {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 16 || result > 8192) throw new TypeError(`Laya ${name} 预算必须是 16 至 8192 的整数`);
  return result;
}

/** One local HTTP request per decision; CPU execution may contain multiple tournament rounds. */
export function createLayaProvider({ url = process.env.LAYA_URL || 'http://127.0.0.1:8765/v1/systemone', model = process.env.LAYA_MODEL || 'multilingual', fetch: fetchImpl, maxLen = 4096, headMaxLen = 768, healthTimeoutMs = 2000, validateValue } = {}) {
  const defaultModel = model;
  const transport = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  return {
    defaultModel,
    async getStatus() {
      const status = { provider: 'laya', configured: true, ready: false, ok: false, local: true, cloud: false, model: defaultModel, url: publicURL(url), version: null, modelRevision: null, tournamentGroup: null, maxChoices: null, device: null, loaded: [], maxLen, headMaxLen };
      try {
        const target = endpoint(url);
        const response = await transport(new URL('/health', target).href, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeout(healthTimeoutMs)) });
        if (!response.ok) throw new Error(`Laya health HTTP ${response.status}`);
        const payload = await response.json();
        if (!object(payload)) throw new TypeError('Laya health 响应必须为对象');
        status.ok = payload.status === 'ok' || payload.ok === true;
        status.loaded = Array.isArray(payload.loaded) ? copy(payload.loaded) : [];
        status.ready = status.ok && status.loaded.includes(defaultModel) && payload.ready !== false;
        const deployment = object(payload.deployment) ? payload.deployment : {};
        status.deployment = object(payload.deployment) ? copy(payload.deployment) : null;
        status.metadataSource = typeof deployment.source === 'string' ? deployment.source : null;
        status.version = typeof (payload.version ?? deployment.version) === 'string' ? (payload.version ?? deployment.version) : null;
        status.modelRevision = payload.revisions?.[defaultModel] ?? payload.modelRevision ?? null;
        status.tournamentGroup = count(payload.tournamentGroup ?? deployment.tournamentGroup);
        status.maxChoices = count(payload.maxChoices ?? deployment.maxChoices);
        status.maxLen = count(deployment.maxLen) ?? maxLen;
        status.headMaxLen = count(deployment.headMaxLen) ?? headMaxLen;
        status.threads = count(deployment.threads);
        status.device = payload.device ?? null;
        status.deviceIsPreference = payload.device_is_preference ?? null;
        status.checkpointDevices = copy(payload.checkpoint_devices);
        status.cpuFallbacks = copy(payload.cpu_fallbacks);
        if (!status.ok) status.error = 'Laya health 未报告正常状态';
        else if (!status.ready) status.error = 'Laya 多语言模型尚未驻留或服务未就绪';
      } catch (error) {
        status.ok = false; status.ready = false; status.error = error.message;
      }
      return status;
    },
    async invoke({ stage, model: requestedModel = defaultModel, decision, schema, promptMeta, options = {}, signal } = {}) {
      const started = performance.now();
      const timeoutMs = timeout(options.timeoutMs);
      const trace = { stage, provider: 'laya', local: true, cloud: false, model: requestedModel, requestedModel, url: publicURL(url), wallMs: 0, loadMs: null, promptMs: null, generationMs: null, inferenceMs: null, inputTokens: null, outputTokens: null, tokensPerSecond: null, httpCalls: 0, forwardPasses: null, internalPredictCalls: null, internalPredictCallsBasis: null, raw: '', request: null, schema: copy(schema), startedAt: new Date().toISOString(), timeoutMs, promptVersion: promptMeta?.version ?? null, doneReason: null, truncated: false, probabilities: null, wireProbabilities: null, confidence: null, answerConfidence: null, jevConfidence: null, usage: null, routing: null, tournament: null, choiceMap: copy(decision?.choiceMap) };
      try {
        const keys = choices(stage, decision);
        const target = endpoint(url);
        if (!nonempty(requestedModel)) throw new TypeError('Laya model 必须为非空字符串');
        const actualMaxLen = budget(options.laya_max_len ?? options.layaMaxLen, maxLen, 'max_len');
        const actualHeadMaxLen = budget(options.laya_head_max_len ?? options.layaHeadMaxLen, headMaxLen, 'head_max_len');
        if (actualHeadMaxLen >= actualMaxLen) throw new TypeError('Laya head_max_len 预算必须小于 max_len，保留用户原文空间');
        const body = { state: copy(decision.state), model: requestedModel, questions: { [decision.answerKey]: copy(decision.question) }, max_len: actualMaxLen, head_max_len: actualHeadMaxLen, lang: 'zh' };
        trace.request = copy(body);
        trace.options = { max_len: actualMaxLen, head_max_len: actualHeadMaxLen, lang: 'zh', retries: 0 };
        if (promptMeta) trace.promptMeta = copy(promptMeta);
        signal?.throwIfAborted();
        const activeSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
        trace.httpCalls = 1;
        const response = await transport(target.href, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: activeSignal });
        trace.httpStatus = response.status;
        const inferenceHeader = response.headers.get('x-inference-time-ms');
        trace.inferenceMs = inferenceHeader !== null && inferenceHeader.trim() !== '' ? metric(Number(inferenceHeader)) : null;
        trace.raw = await response.text();
        if (!response.ok) throw new Error(`Laya HTTP ${response.status}: ${trace.raw.slice(0, 800)}`);
        let payload;
        try { payload = JSON.parse(trace.raw); } catch { throw new TypeError('Laya 响应不是有效 JSON'); }
        if (nonempty(payload?.model)) trace.model = payload.model;
        trace.usage = copy(payload?.usage);
        trace.inputTokens = count(payload?.usage?.input_tokens);
        trace.outputTokens = count(payload?.usage?.output_tokens);
        trace.routing = copy(payload?.routing);
        trace.tournament = copy(payload?.answers?.[decision.answerKey]?.x_tournament);
        trace.forwardPasses = count(payload?.forwardPasses);
        if (Number.isInteger(trace.tournament?.rounds) && trace.tournament.rounds >= 0) {
          // Official shortlist.py batches each round's group questions into one predict call.
          // This is a source-derived predict-call count, not measured low-level torch forwards.
          trace.internalPredictCalls = trace.tournament.rounds + 1;
          trace.internalPredictCallsBasis = 'official_tournament_rounds_plus_final';
        }
        const answer = validateAnswer(payload, decision.answerKey, keys);
        trace.wireProbabilities = copy(answer.probabilities);
        trace.probabilities = decision.choiceMap ? Object.fromEntries(Object.entries(answer.probabilities).map(([key, value]) => [decision.choiceMap[key], value])) : copy(answer.probabilities);
        trace.confidence = answer.confidence;
        trace.answerConfidence = metric(answer.answer_confidence);
        trace.jevConfidence = metric(answer.x_jev_confidence);
        const usage = payload.usage ?? {};
        const collapsed = object(usage.options) && Object.values(usage.options).some(option => object(option) && typeof option.distinct === 'number' && typeof option.total === 'number' && option.distinct < option.total);
        trace.truncated = usage.truncated === true || (metric(usage.state_tokens_dropped) ?? 0) > 0 || (Array.isArray(usage.truncated_questions) && usage.truncated_questions.length > 0) || collapsed;
        if (trace.truncated) throw new Error('Laya 报告用户原文截断或候选折叠；本次决策不能作为完整输入下的正常结果');
        const value = { [decision.answerKey]: decision.choiceMap ? decision.choiceMap[answer.choice] : answer.choice };
        if (schema) {
          const validate = validateValue ?? (await import('./providers.mjs')).validateValue;
          const validation = validate(schema, value);
          if (!validation.valid) throw new TypeError(`输出 schema 结构校验失败：${validation.issues.join('；')}`);
        }
        trace.wallMs = performance.now() - started;
        return { value, trace };
      } catch (cause) {
        trace.wallMs = performance.now() - started;
        trace.error = cause.message; trace.errorType = cause.name;
        const error = new Error(cause.message); error.name = cause.name; error.trace = trace;
        throw error;
      }
    }
  };
}
