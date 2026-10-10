import { weatherCapabilities, weatherInputs, weatherFieldNames, weatherInputAlternatives } from './weather-capabilities.mjs';
import { extendedCapabilities } from './extended-capabilities.mjs';
/** Business contracts for a semantic-call experiment. No capability invokes a real service. */
export const domains = [
  { id: 'weather', name: '天气', description: '天气、降水、气温、天气预警；时间和位置可按规则补全。' },
  { id: 'calendar', name: '日历', description: '查日程、创建、修改、取消日程；会议资料归 cloud。' },
  { id: 'contacts', name: '联系人', description: '查询、创建、更新通讯录联系人；不打电话、不发消息。' },
  { id: 'files', name: '文件', description: '查找本地文件、预览明确文件；会议云资料归 cloud。' },
  { id: 'services', name: '服务入口', description: '明确要求打开已注册服务页面；查询服务内容归对应领域。' },
  { id: 'cloud', name: '云端业务', description: '会议资料、云文件、云数据库字段与统计、云函数调用、云端资源预加载的具体业务壳子。' }
];

const str = (description, extra = {}) => ({ type: 'string', description, minLength: 1, ...extra });
const integer = (description, extra = {}) => ({ type: 'integer', description, ...extra });
const changes = {
  title: str('日程新标题'), starts_at: str('新开始时间，保留用户相对时间', { resolver: 'datetime' }),
  ends_at: str('新结束时间，保留用户相对时间', { resolver: 'datetime' }),
  location: str('日程新地点'), reminder_minutes: integer('提前提醒分钟数，0 表示开始时提醒', { minimum: 0, maximum: 10080 }),
  description: str('日程新说明'), is_all_day: { type: 'boolean', description: '用户明确的新全天标记' }, timezone: str('用户明确的新时区'),
  attendees: { type: 'array', description: '明确的新参会人姓名或ID；不猜联系人ID', items: str('参会人姓名或ID'), minItems: 1 }, recurrence: str('用户明确的新重复规则，保留原文')
};
const contactDetails = { address: str('明确邮寄地址'), birthday: str('明确生日原文，不猜年份'), nickname: str('明确昵称'), note: str('明确备注'), website: str('明确网站地址') };

export const capabilities = [
  {
    id: 'weather.query', domain: 'weather', name: '查询天气', risk: 'read', aggregate: true, object: 'weather', field: '*', granularities: ['current', 'hourly', 'daily', 'minute'], sourceRef: 'https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/weather-service-weatherservice#weather',
    description: '查询地点与时间范围内的天气、降水、气温或预警；雨用 precipitation，气温用 temperature，预警用 alert。',
    inputAlternatives: structuredClone(weatherInputAlternatives),
    inputs: {
      location: str('城市或地点名称；“这里/当地/附近”可保留原文。未提地点由系统定位补全', { resolver: 'system_location' }),
      time_ref: str('保留原文时间，如今天/明天/后天/本周/2026-10-12；未提时间由系统时钟补今天', { default: 'today', resolver: 'relative_time' }),
      coordinates: weatherInputs().coordinates,
      data_needs: { type: 'array', description: '多种天气需求；单字段优先对象字段 getter。未明确细分默认为 weather', items: { type: 'string', enum: ['weather', 'precipitation', 'temperature', 'alert', 'humidity', 'wind', 'pressure', 'visibility', 'uv', 'aqi', 'sun', 'moon', 'indices', 'tides', 'city'] }, minItems: 1, uniqueItems: true, default: ['weather'] },
      fields: { type: 'array', description: '明确需要的官方字段路径；不得填写输出值', items: { type: 'string', enum: weatherFieldNames }, minItems: 1, uniqueItems: true },
      dataset: str('明确要求的数据集或时间粒度', { enum: ['current', 'hourly', 'daily', 'minute', 'alerts', 'indices', 'tides', 'city'] }),
      strict_time: weatherInputs().strict_time
    }
  },
  {
    id: 'calendar.search', domain: 'calendar', name: '查询日程', risk: 'read', description: '按时间或关键词查询日程；“安排/有哪些会”是查询。',
    inputs: { time_ref: str('原文时间范围；未提时间补今天', { default: 'today', resolver: 'relative_time' }), keyword: str('日程标题或内容关键词') }
  },
  {
    id: 'calendar.create', domain: 'calendar', name: '创建日程', risk: 'write', description: '新建日程。标题、开始时间必需，结束时间或时长可选，不替用户编造。',
    inputs: {
      title: str('用户给出的日程标题，不添加“会议”等未提文字', { required: true }),
      starts_at: str('开始时间原文，如明天下午三点；缺失必须澄清', { required: true, resolver: 'datetime' }),
      ends_at: str('结束时间原文；需有明确时刻', { resolver: 'datetime' }),
      duration_minutes: integer('明确给出的持续分钟数', { minimum: 1, maximum: 10080 }),
      location: str('明确日程地点，不能用当前位置默认'), reminder_minutes: integer('明确提前提醒分钟数', { minimum: 0, maximum: 10080 }),
      description: str('明确日程说明'), is_all_day: { type: 'boolean', description: '用户明确是否全天' }, timezone: str('明确时区；未提供时使用系统时区', { resolver: 'system_timezone' }),
      attendees: { type: 'array', description: '明确参会人姓名或ID；不猜联系人ID', items: str('参会人姓名或ID'), minItems: 1 }, recurrence: str('明确重复规则，保留用户原文')
    }
  },
  {
    id: 'calendar.update', domain: 'calendar', name: '修改日程', risk: 'write', description: '修改用户明确标识的日程。目标 event_id 与变更字段缺失必须澄清，不凭标题猜 ID。',
    inputs: { event_id: str('明确给出的日程 ID，如 ev_42', { required: true }), changes: { type: 'object', description: '明确要修改的字段', properties: changes, additionalProperties: false, required: true } },
    constraints: { nonEmptyObject: ['changes'] }
  },
  {
    id: 'calendar.cancel', domain: 'calendar', name: '取消日程', risk: 'write', description: '取消明确标识的日程；仅有模糊标题时缺少目标 ID，需要澄清。',
    inputs: { event_id: str('明确日程 ID', { required: true }) }
  },
  {
    id: 'contacts.search', domain: 'contacts', name: '查询联系人', risk: 'read', description: '按姓名、电话号码或组织查通讯录。',
    inputs: { query: str('用户给出的姓名、号码或组织查询词', { required: true }) }
  },
  {
    id: 'contacts.create', domain: 'contacts', name: '创建联系人', risk: 'write', description: '新建通讯录联系人；姓名必需，号码等字段只提取明确内容。',
    inputs: { name: str('联系人姓名', { required: true }), phone: str('电话号码，保留原文'), email: str('电子邮箱'), organization: str('组织名称'), ...contactDetails }
  },
  {
    id: 'contacts.update', domain: 'contacts', name: '更新联系人', risk: 'write', description: '修改已知联系人 ID 的字段；姓名不能替代 ID，不自动选同名对象。',
    inputs: { contact_id: str('明确联系人 ID，如 ct_7', { required: true }), name: str('新姓名'), phone: str('新电话号码'), email: str('新电子邮箱'), organization: str('新组织'), ...contactDetails },
    constraints: { atLeastOne: ['name', 'phone', 'email', 'organization', ...Object.keys(contactDetails)] }
  },
  {
    id: 'files.search', domain: 'files', name: '查找文件', risk: 'read', description: '按关键词查本地文件。明确云端会议资料归 materials.search。',
    inputs: { keyword: str('文件名或内容查询词', { required: true }), file_type: str('明确文件类型', { enum: ['pdf', 'docx', 'xlsx', 'pptx', 'image', 'text'] }) }
  },
  {
    id: 'files.preview', domain: 'files', name: '预览文件', risk: 'read', description: '预览明确文件 ID 或 URI；“那份文件”没有上下文时缺目标，需要澄清。',
    inputs: { file_id: str('明确文件 ID 或 URI；缺省只可使用用户可信选择的文件', { required: true, resolver: 'selected_object' }), mime_type: str('明确 MIME 类型；未提供时按文件URI后缀补全，无法识别保留空值', { minLength: 0, resolver: 'mime_from_uri' }), title: str('明确预览标题') }
  },
  {
    id: 'services.open', domain: 'services', name: '打开服务页面', risk: 'navigation', description: '打开已注册页面。仅支持 weather/calendar/contacts/files/materials，不能打开任意 URL 或执行系统命令。',
    inputs: { service: str('注册服务名：天气 weather、日历 calendar、通讯录 contacts、文件 files、会议资料 materials', { required: true, enum: ['weather', 'calendar', 'contacts', 'files', 'materials'] }), parameters: { type: 'object', description: '明确页面参数，只支持 query', properties: { query: str('页面搜索词') }, additionalProperties: false } }
  },
  {
    id: 'materials.search', domain: 'cloud', name: '查会议资料', risk: 'read', description: '按关键词或会议 ID 查询云端会议资料；至少明确一个筛选条件。',
    inputs: { keyword: str('资料查询词'), meeting_id: str('明确会议 ID，如 mt_8') }, constraints: { atLeastOne: ['keyword', 'meeting_id'] }
  },
  {
    id: 'materials.get', domain: 'cloud', name: '获取会议资料', risk: 'read', description: '读取或下载明确 ID 的云端会议资料；本实验仅返回模拟回执。',
    inputs: { material_id: str('明确资料 ID；缺省只可使用用户可信选择的资料', { required: true, resolver: 'selected_object' }) }
  },
  {
    id: 'materials.save', domain: 'cloud', name: '保存会议资料', risk: 'write', description: '保存用户明确给出的资料标题与内容到云端业务壳子，会议 ID 可选。',
    inputs: { title: str('资料标题', { required: true }), content: str('用户明确提供的资料正文，完整保留', { required: true }), meeting_id: str('关联会议 ID') }
  },
  {
    id: 'materials.share', domain: 'cloud', name: '分享会议资料', risk: 'write', description: '把明确资料 ID 分享给明确联系人 ID；不把姓名转换成 ID，不实际发送。',
    inputs: { material_id: str('明确资料 ID', { required: true }), contact_id: str('明确接收联系人 ID', { required: true }) }
  },
  ...weatherCapabilities,
  ...extendedCapabilities
];

const capabilityById = new Map(capabilities.map(cap => [cap.id, cap]));
export const getCapability = id => capabilityById.get(id);
export const listCapabilities = domain => capabilities.filter(cap => !domain || cap.domain === domain);

function cleanSchema(field) {
  const schema = {};
  for (const key of ['type', 'description', 'enum', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'uniqueItems', 'additionalProperties']) {
    if (field[key] !== undefined) schema[key] = structuredClone(field[key]);
  }
  if (field.items) schema.items = cleanSchema(field.items);
  if (field.properties) {
    schema.properties = Object.fromEntries(Object.entries(field.properties).map(([name, item]) => [name, cleanSchema(item)]));
    schema.additionalProperties = false;
    schema.required = [];
  }
  return schema;
}

/** Only explicit user information is extracted. The resolver enforces business requirements later. */
export function schemaFor(capability) {
  if (!capability?.inputs) throw new TypeError('Unknown capability');
  return { type: 'object', properties: Object.fromEntries(Object.entries(capability.inputs).map(([name, field]) => [name, cleanSchema(field)])), additionalProperties: false, required: [] };
}

/** Validate extraction syntax, not business completeness or environmental resolution. */
export function validateArguments(capability, args) {
  const issues = [];
  if (!capability?.inputs) return { valid: false, issues: ['Unknown capability'] };
  validateValue(args, schemaFor(capability), 'arguments', issues);
  return { valid: issues.length === 0, issues };
}

function validateValue(value, schema, path, issues) {
  const type = schema.type;
  const matches = type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : type === 'array' ? Array.isArray(value)
      : type === 'integer' ? Number.isInteger(value)
        : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
          : typeof value === type;
  if (!matches) { issues.push(`${path}: expected ${type}`); return; }
  if (schema.enum && !schema.enum.includes(value)) issues.push(`${path}: not in enum`);
  if (type === 'string' && value.trim().length < (schema.minLength ?? 0)) issues.push(`${path}: empty string`);
  if ((type === 'integer' || type === 'number') && schema.minimum !== undefined && value < schema.minimum) issues.push(`${path}: below minimum`);
  if ((type === 'integer' || type === 'number') && schema.maximum !== undefined && value > schema.maximum) issues.push(`${path}: above maximum`);
  if (type === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push(`${path}: insufficient items`);
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) issues.push(`${path}: duplicate items`);
    value.forEach((item, index) => validateValue(item, schema.items, `${path}[${index}]`, issues));
  }
  if (type === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (!(key in (schema.properties ?? {}))) { issues.push(`${path}.${key}: unknown property`); continue; }
      validateValue(item, schema.properties[key], `${path}.${key}`, issues);
    }
  }
}
