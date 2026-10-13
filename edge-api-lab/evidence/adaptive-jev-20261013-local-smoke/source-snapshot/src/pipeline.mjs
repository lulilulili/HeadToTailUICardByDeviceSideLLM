import { getCapability, domains } from './registry.mjs';
import { buildDomainPrompt, buildIntentPrompt, buildArgumentsPrompt, buildUnifiedPrompt, buildAdaptiveDomainPrompt, buildAdaptiveIntentPrompt, buildIntentArgumentsPrompt, buildAdaptiveArgumentsPrompt, buildJevDomainPrompt, buildJevIntentPrompt } from './prompts.mjs';
import { analyzeAdaptiveRoute, validateRoutingOverrides, stageSelection, hasApiInputs } from './adaptive-routing.mjs';
import {finalizePlan,groundArguments,GROUNDING_VERSION} from './grounding.mjs';
import {prepareSystemContext} from './system-context.mjs';
import { validateValue } from './providers.mjs';

const omitProtocolNulls = value => Array.isArray(value) ? value.map(omitProtocolNulls) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, child]) => child !== null).map(([key, child]) => [key, omitProtocolNulls(child)])) : value;

export async function runPipeline({ text, mode = 'staged', model, stages = {}, context = {}, options = {} }, { providers, systemContextProvider, signal, onTrace } = {}) {
  const start = performance.now();
  const traces = [];
  const result = { domain: null, api: null, modelArguments: {}, extractedArguments: {}, groundedArguments: null, grounding: null, ruleVersion: GROUNDING_VERSION, resolved: null, status: 'error', traces, totalMs: 0, text, mode, model, context, options: structuredClone(options), stages: structuredClone(stages), candidates: {}, mock: null };
  const adaptive = mode === 'adaptive' || mode === 'jev';
  if (adaptive) {
    const route = analyzeAdaptiveRoute(text);
    const typedIntent = mode === 'jev' || stages.intent?.provider === 'jev';
    result.routing = { policy: route.policy, path: typedIntent ? 'three_step' : route.path, triggerReasons: [...route.reasons, ...(typedIntent ? ['typed_decision_requires_arguments'] : [])], priorityDomains: [], skippedStages: [], actualCallCount: 0, actualStages: [] };
  }
  const emit = async trace => {
    traces.push(trace);
    if (result.routing) { result.routing.actualCallCount = traces.length; result.routing.actualStages = traces.map(item => item.stage); }
    if (onTrace) await onTrace(trace);
  };
  async function call(stage, prompt) {
    // Cancellation between stages must not create a trace for an uninvoked call.
    signal?.throwIfAborted();
    if (prompt.promptMeta?.candidates) result.candidates[stage] = structuredClone(prompt.promptMeta.candidates);
    if (result.routing && prompt.promptMeta?.priorityDomains) result.routing.priorityDomains = [...prompt.promptMeta.priorityDomains];
    const selection = stageSelection(stage, { mode, model, stages, providers });
    const provider = providers?.[selection.provider];
    const callStart = performance.now();
    let emitted = false;
    try {
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
    if (!['staged', 'unified', 'adaptive', 'jev'].includes(mode)) throw new Error(`未知实验模式：${mode}`);
    validateRoutingOverrides(mode, stages);
    if (mode === 'unified') {
      const unified = await call('unified', buildUnifiedPrompt(text, context));
      result.domain = unified.domain;
      result.api = unified.api === 'unsupported' ? null : unified.api;
      result.modelArguments = unified.arguments;
      result.extractedArguments = omitProtocolNulls(unified.arguments);
    } else {
      const domainProvider = stageSelection('domain', { mode, model, stages, providers }).provider;
      const domainPrompt = domainProvider === 'jev' ? buildJevDomainPrompt(text, context) : adaptive ? buildAdaptiveDomainPrompt(text, context) : buildDomainPrompt(text, context);
      result.domain = (await call('domain', domainPrompt)).domain;
      if (result.domain !== 'unsupported') {
        if (mode === 'adaptive' && result.routing.path === 'two_step') {
          const selected = await call('intent_arguments', buildIntentArgumentsPrompt(text, result.domain, context));
          result.api = selected.api === 'unsupported' ? null : selected.api;
          result.modelArguments = selected.arguments;
          result.extractedArguments = omitProtocolNulls(selected.arguments);
        } else {
          const intentProvider = stageSelection('intent', { mode, model, stages, providers }).provider;
          const prompt = intentProvider === 'jev' ? buildJevIntentPrompt(text, result.domain, context) : adaptive ? buildAdaptiveIntentPrompt(text, result.domain, context) : buildIntentPrompt(text, result.domain, context);
          const id = (await call('intent', prompt)).api;
          result.api = id === 'unsupported' ? null : id;
          if (result.api) {
            const capability = getCapability(result.api);
            if (adaptive && !hasApiInputs(capability)) result.routing.skippedStages.push({ stage: 'arguments', reason: 'api_has_no_inputs' });
            else {
              const prompt = adaptive ? buildAdaptiveArgumentsPrompt(text, capability, { mode }) : buildArgumentsPrompt(text, capability);
              result.modelArguments = await call('arguments', prompt);
              result.extractedArguments = omitProtocolNulls(result.modelArguments);
            }
          }
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
      Object.assign(result,finalizePlan({text,domain:result.domain,api:result.api,extractedArguments:result.extractedArguments,context:prepared.context,systemRequests:prepared.requests}));
    }
  } catch (error) {
    result.error = error.message;
    result.status = signal?.aborted ? 'cancelled' : 'error';
    if (signal?.aborted) { result.totalMs = performance.now() - start; error.traces = traces; error.partialRun = result; throw error; }
  }
  result.totalMs = performance.now() - start;
  return result;
}
