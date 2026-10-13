/** Observable syntax determines stage separation; model confidence never does. */
export const ADAPTIVE_ROUTING_VERSION = 'adaptive-routing-v1';

const withoutQuotedValues = text => String(text).replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|“[^”]*”|「[^」]*」|『[^』]*』/g, ' ');
const writeSignals = /修改|更改|更新(?!时间)|改成|改为|改到|设置|创建|新建|新增|添加|保存|上传|调用/;
const writeFields = [
  /标题|名称|姓名/, /电话|手机(?:号|号码)|号码/, /邮箱|电子邮件/, /地点|会议室|地址/,
  /说明|描述|备注/, /开始|起始/, /结束|截止/, /时长|持续/, /提前.+提醒|提醒.+提前/,
  /参会|与会|参与者/, /重复|循环/, /生日/, /组织|公司/, /昵称/, /网站|网址/,
  /正文|请求体|body|\bdata\b/i, /版本|version/i, /超时|timeout/i
];

export function analyzeAdaptiveRoute(text) {
  const original = String(text ?? '');
  const lexical = withoutQuotedValues(original);
  const structured = original.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|“[^”]*”|「[^」]*」|『[^』]*』/g, (quoted, offset) => {
    const prefix = original.slice(0, offset).split(/[，。；！？\n]/).at(-1);
    return /关键词|搜索词|标题|名为|名叫/.test(prefix) ? ' ' : quoted;
  });
  const reasons = [];
  // An explicit structured payload is expensive to combine with API selection.
  // This is a routing signal only: it does not parse, repair, or copy any values.
  if (/(?:JSON|正文|请求体|参数|body|\bdata\b)[\s:：=]*(?:为|是)?\s*[\[{]/i.test(structured) || /[\[{]\s*"[^"\n]+"\s*:/.test(structured)) reasons.push('explicit_json');
  if (writeSignals.test(lexical) && writeFields.filter(pattern => pattern.test(lexical)).length >= 2) reasons.push('multi_field_write');
  const roles = [/(?:开始|起始).*(?:\d|[一二两三四五六七八九十])(?:[:：点]|月|日|小时)/, /(?:结束|截止).*(?:\d|[一二两三四五六七八九十])(?:[:：点]|月|日|小时)/, /(?:时长|持续).*(?:分钟|小时)/, /(?:提前.*提醒|提醒.*提前)/].filter(pattern => pattern.test(lexical));
  const writeTimeRange = writeSignals.test(lexical) && /(?:\d{1,2}[:：]\d{2}|[零〇一二两三四五六七八九十\d]+点)[^，。；\n]{0,12}(?:至|到|[-—~～])[^，。；\n]{0,12}(?:\d{1,2}[:：]\d{2}|[零〇一二两三四五六七八九十\d]+点)/.test(lexical);
  if (roles.length >= 2 || writeTimeRange) reasons.push('multiple_time_roles');
  return { policy: ADAPTIVE_ROUTING_VERSION, path: reasons.length ? 'three_step' : 'two_step', reasons };
}

/** Fail before invoking any provider when an explicit configuration is invalid. */
export function validateRoutingOverrides(mode, stages = {}) {
  for (const [stage, selection] of Object.entries(stages)) {
    if (selection?.provider === 'jev' && !['domain', 'intent'].includes(stage)) throw new Error(`Jev 只支持 domain/intent 选择阶段，不能用于 ${stage}`);
    if (mode === 'jev') {
      if (['domain', 'intent'].includes(stage) && selection?.provider && selection.provider !== 'jev') throw new Error(`Jev 模式的 ${stage} 提供方固定为 jev，不能覆盖`);
      if (stage === 'arguments' && selection?.provider && selection.provider !== 'ollama') throw new Error('Jev 模式的 arguments 提供方固定为 ollama，不能覆盖');
      if (['intent_arguments', 'unified'].includes(stage)) throw new Error(`Jev 模式不存在 ${stage} 阶段覆盖`);
    }
  }
}

export function stageSelection(stage, { mode, model, stages = {}, providers = {} }) {
  const defaultProvider = mode === 'jev' && ['domain', 'intent'].includes(stage) ? 'jev' : 'ollama';
  const selection = { provider: defaultProvider, ...stages[stage] };
  selection.model = stages[stage]?.model ?? (selection.provider === 'jev' ? providers.jev?.defaultModel ?? 'jev-latest' : model);
  return selection;
}

export function hasApiInputs(capability) {
  return Object.keys(capability?.inputs ?? {}).length > 0;
}
