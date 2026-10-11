import { getCapability, domains } from './registry.mjs';
import { buildDomainPrompt, buildIntentPrompt, buildArgumentsPrompt, buildUnifiedPrompt } from './prompts.mjs';
import {finalizePlan,groundArguments,GROUNDING_VERSION} from './grounding.mjs';
import {prepareSystemContext} from './system-context.mjs';
import { validateValue } from './providers.mjs';

const omitProtocolNulls = value => Array.isArray(value) ? value.map(omitProtocolNulls) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, child]) => child !== null).map(([key, child]) => [key, omitProtocolNulls(child)])) : value;

export async function runPipeline({ text, mode = 'staged', model, stages = {}, context = {}, options = {} }, { providers, systemContextProvider, signal, onTrace } = {}) {
  const start = performance.now();
  const traces = [];
  const result = { domain: null, api: null, modelArguments: {}, extractedArguments: {}, groundedArguments: null, grounding: null, ruleVersion: GROUNDING_VERSION, resolved: null, status: 'error', traces, totalMs: 0, text, mode, model, context, options: structuredClone(options), stages: structuredClone(stages), candidates: {}, mock: null };
  const emit = async trace => { traces.push(trace); if (onTrace) await onTrace(trace); };
  async function call(stage, prompt) {
    if (prompt.promptMeta?.candidates) result.candidates[stage] = structuredClone(prompt.promptMeta.candidates);
    const selection = { provider: 'ollama', model, ...stages[stage] };
    const provider = providers?.[selection.provider];
    const callStart = performance.now();
    let emitted = false;
    try {
      signal?.throwIfAborted();
      if (!provider?.invoke) throw new Error(`未知推理提供方：${selection.provider}`);
      const response = await provider.invoke({ stage, model: selection.model, ...prompt, options, signal });
      const validation = validateValue(prompt.schema, response.value);
      if (!validation.valid) {
        const error = new Error(`输出 schema 结构校验失败：${validation.issues.join('；')}`);
        error.trace = { ...response.trace, error: error.message };
        throw error;
      }
      emitted = true;
      await emit(response.trace);
      return response.value;
    } catch (error) {
      if (!emitted) await emit(error.trace ?? { stage, provider: selection.provider, model: selection.model, wallMs: performance.now() - callStart, loadMs: null, promptMs: null, generationMs: null, inputTokens: null, outputTokens: null, tokensPerSecond: null, messages: prompt.messages, schema: prompt.schema, promptMeta: prompt.promptMeta, promptVersion: prompt.promptMeta?.version, raw: '', error: error.message });
      throw error;
    }
  }
  try {
    if (!text?.trim()) throw new Error('请输入用户提示词');
    if (!['staged', 'unified'].includes(mode)) throw new Error(`未知实验模式：${mode}`);
    if (mode === 'unified') {
      const unified = await call('unified', buildUnifiedPrompt(text, context));
      result.domain = unified.domain;
      result.api = unified.api === 'unsupported' ? null : unified.api;
      result.modelArguments = unified.arguments;
      result.extractedArguments = omitProtocolNulls(unified.arguments);
    } else {
      result.domain = (await call('domain', buildDomainPrompt(text, context))).domain;
      if (result.domain !== 'unsupported') {
        const id = (await call('intent', buildIntentPrompt(text, result.domain, context))).api;
        result.api = id === 'unsupported' ? null : id;
        if (result.api) {
          result.modelArguments = await call('arguments', buildArgumentsPrompt(text, getCapability(result.api)));
          result.extractedArguments = omitProtocolNulls(result.modelArguments);
        }
      }
    }
    if (result.domain === 'unsupported' || !result.api) {
      result.domain = 'unsupported'; result.api = null; result.status = 'unsupported';
      result.resolved = { arguments: {}, sources: {}, missing: [], issues: ['请求不属于单个已注册业务能力，或包含多个独立动作。'], status: 'unsupported' };
    } else {
      const capability = getCapability(result.api);
      if (!capability || capability.domain !== result.domain || !domains.some(domain => domain.id === result.domain)) throw new Error('领域与 API 不一致');
      // Recover explicit omissions first, then ask the system only for genuinely absent state.
      const grounded = groundArguments(capability, text, result.extractedArguments, context);
      const prepared = await prepareSystemContext(capability, grounded.groundedArguments, context, systemContextProvider, signal, grounded.grounding.blockers.map(item => item.field));
      result.context = prepared.context;
      result.systemRequests = prepared.requests;
      Object.assign(result,finalizePlan({text,domain:result.domain,api:result.api,extractedArguments:result.extractedArguments,context:prepared.context}));
    }
  } catch (error) {
    result.error = error.message;
    result.status = signal?.aborted ? 'cancelled' : 'error';
    if (signal?.aborted) { result.totalMs = performance.now() - start; error.traces = traces; error.partialRun = result; throw error; }
  }
  result.totalMs = performance.now() - start;
  return result;
}
