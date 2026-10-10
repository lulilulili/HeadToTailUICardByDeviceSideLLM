import { schemaFor, getCapability } from './registry.mjs';
import { validateValue } from './providers.mjs';

const pad = value => String(value).padStart(2, '0');
const dayMs = 86400000;
const localParts = (date, timezone) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
const dayString = parts => `${parts.year}-${parts.month}-${parts.day}`;
const addDays = (day, count) => new Date(Date.parse(`${day}T00:00:00Z`) + count * dayMs).toISOString().slice(0, 10);
const validDay = day => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
const weatherDatasets = new Set(['current', 'hourly', 'daily', 'minute', 'alerts', 'indices', 'tides', 'city']);
const coordinateValid = point => point && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;

function number(text) {
  if (/^\d+$/.test(text)) return Number(text);
  const digit = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (text.includes('十')) { const [tens, ones] = text.split('十'); return (tens ? digit[tens] : 1) * 10 + (ones ? digit[ones] : 0); }
  return digit[text];
}

function dateRange(expression, context) {
  const text = expression.trim().replace(/\s/g, '').toLowerCase();
  const periodNames = { 早上: { id: 'morning', start: '06:00', end: '12:00' }, 上午: { id: 'morning', start: '06:00', end: '12:00' }, 下午: { id: 'afternoon', start: '12:00', end: '18:00' }, 晚上: { id: 'evening', start: '18:00', end: '24:00' }, 夜间: { id: 'evening', start: '18:00', end: '24:00' } };
  const shortPeriods = { 今早: '今天早上', 明早: '明天早上', 今晚: '今天晚上', 明晚: '明天晚上' };
  const periodMatch = (shortPeriods[text] ?? text).match(/^(.+?)(早上|上午|下午|晚上|夜间)$/);
  if (periodMatch) return { ...dateRange(periodMatch[1], context), period: periodNames[periodMatch[2]] };
  if (validDay(text)) return { start: text, end: text, source: 'user' };
  const range = text.match(/^(\d{4}-\d{2}-\d{2})(?:\/|至|到)(\d{4}-\d{2}-\d{2})$/);
  if (range && validDay(range[1]) && validDay(range[2]) && range[1] <= range[2]) return { start: range[1], end: range[2], source: 'user' };
  const now = new Date(context.now);
  if (!Number.isFinite(now.getTime())) throw new Error('系统时间无效，无法解析相对时间');
  const today = dayString(localParts(now, context.timezone));
  const offsets = { today: 0, 今天: 0, 今日: 0, 当天: 0, tomorrow: 1, 明天: 1, 明日: 1, 后天: 2, day_after_tomorrow: 2, yesterday: -1, 昨天: -1 };
  if (Object.hasOwn(offsets, text)) { const day = addDays(today, offsets[text]); return { start: day, end: day, source: 'system_time' }; }
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addDays(today, -weekday);
  if (['this_week', '本周', '这周', '本星期'].includes(text)) return { start: monday, end: addDays(monday, 6), source: 'system_time' };
  if (['next_week', '下周', '下星期'].includes(text)) return { start: addDays(monday, 7), end: addDays(monday, 13), source: 'system_time' };
  if (['周末', '本周末', '这周末', 'weekend'].includes(text)) return { start: addDays(monday, 5), end: addDays(monday, 6), source: 'system_time' };
  if (['下周末'].includes(text)) return { start: addDays(monday, 12), end: addDays(monday, 13), source: 'system_time' };
  const dayOfWeek = text.match(/^(下|本|这)?(?:周|星期)(一|二|三|四|五|六|日|天)$/);
  if (dayOfWeek) {
    const target = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 }[dayOfWeek[2]];
    const week = dayOfWeek[1] === '下' ? 7 : dayOfWeek[1] ? 0 : target < weekday ? 7 : 0;
    const day = addDays(monday, target + week);
    return { start: day, end: day, source: 'system_time' };
  }
  const future = text.match(/^(?:未来|接下来)([\d一二两三四五六七八九十]+)天$/);
  if (future) { const count = number(future[1]); if (count >= 1 && count <= 30) return { start: today, end: addDays(today, count - 1), source: 'system_time' }; }
  const date = text.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})(?:日|号)?$/);
  if (date) {
    const day = `${date[1] ?? today.slice(0, 4)}-${pad(date[2])}-${pad(date[3])}`;
    if (validDay(day)) return { start: day, end: day, source: date[1] ? 'user' : 'system_time' };
  }
  throw new Error(`时间“${expression}”无法确定，请给出明确日期或支持的相对时间`);
}

function localISO(day, hour, minute, second, timezone) {
  if (!validDay(day) || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) throw new Error('日期或时刻无效');
  const target = Date.parse(`${day}T${pad(hour)}:${pad(minute)}:${pad(second)}Z`);
  let stamp = target;
  let offset = 0;
  for (let pass = 0; pass < 3; pass++) {
    const parts = localParts(new Date(stamp), timezone);
    offset = (Date.parse(`${dayString(parts)}T${parts.hour}:${parts.minute}:${parts.second}Z`) - stamp) / 60000;
    stamp = target - offset * 60000;
  }
  const actual = localParts(new Date(stamp), timezone);
  if (dayString(actual) !== day || Number(actual.hour) !== hour || Number(actual.minute) !== minute) throw new Error('该本地时刻在此时区不存在或不明确');
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${day}T${pad(hour)}:${pad(minute)}:${pad(second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function datetime(expression, context, inheritedDay) {
  const text = expression.trim().replace(/\s/g, '');
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/);
  if (iso) {
    if (!validDay(iso[1]) || Number(iso[2]) > 23 || Number(iso[3]) > 59 || Number(iso[4] ?? 0) > 59 || !Number.isFinite(Date.parse(`${iso[1]}T${iso[2]}:${iso[3]}:${iso[4] ?? '00'}${iso[5] ?? 'Z'}`))) throw new Error('开始或结束日期时刻无效');
    return { value: iso[5] ? `${iso[1]}T${iso[2]}:${iso[3]}:${iso[4] ?? '00'}${iso[5]}` : localISO(iso[1], Number(iso[2]), Number(iso[3]), Number(iso[4] ?? 0), context.timezone), source: 'user' };
  }
  const relative = text.match(/^([\d一二两三四五六七八九十]+)(分钟|小时)后$/);
  if (relative || ['现在', 'now'].includes(text)) {
    const count = relative ? number(relative[1]) * (relative[2] === '小时' ? 60 : 1) : 0;
    const stamp = new Date(new Date(context.now).getTime() + count * 60000);
    if (!Number.isFinite(stamp.getTime())) throw new Error('系统时间无效');
    const parts = localParts(stamp, context.timezone);
    return { value: localISO(dayString(parts), Number(parts.hour), Number(parts.minute), Number(parts.second), context.timezone), source: 'system_time' };
  }
  const time = text.match(/(凌晨|早上|上午|中午|下午|晚上|傍晚)?([\d零〇一二两三四五六七八九十]+)(?:点|时|:|：)(?:([\d零〇一二两三四五六七八九十]+)(?:分)?)?(半|一刻|三刻)?$/);
  if (!time) throw new Error(`时间“${expression}”缺少明确时刻或无法解析`);
  let hour = number(time[2]);
  let minute = time[4] ? { 半: 30, 一刻: 15, 三刻: 45 }[time[4]] : time[3] ? number(time[3]) : 0;
  if (!time[1] && hour <= 12 && time[0].includes('点')) throw new Error('时刻有上午/下午歧义，请明确时段或使用 24 小时格式');
  if (['下午', '晚上', '傍晚'].includes(time[1]) && hour < 12) hour += 12;
  if (time[1] === '中午' && hour < 11) hour += 12;
  if (['凌晨', '上午', '早上'].includes(time[1]) && hour === 12) hour = 0;
  const dateText = text.slice(0, time.index);
  const range = dateText ? dateRange(dateText, context) : inheritedDay ? { start: inheritedDay, end: inheritedDay, source: 'context' } : null;
  if (!range || range.start !== range.end) throw new Error(`时间“${expression}”缺少明确日期，需澄清`);
  return { value: localISO(range.start, hour, minute, 0, context.timezone), source: range.source };
}

function stampAt(date, context) {
  if (!Number.isFinite(date.getTime())) throw new Error('系统时间无效');
  const parts = localParts(date, context.timezone);
  return localISO(dayString(parts), Number(parts.hour), Number(parts.minute), Number(parts.second), context.timezone);
}

/** Read requests may express date windows and coarse periods; business write dates never use these defaults. */
function readTime(expression, context) {
  const original = expression.trim().replace(/\s/g, '').toLowerCase();
  const granularity = /(?:每分钟|分钟级|按分钟)$/.test(original) ? 'minute' : /(?:每小时|小时级|按小时)$/.test(original) ? 'hour' : null;
  const text = original.replace(/(?:每分钟|分钟级|按分钟|每小时|小时级|按小时)$/, '');
  if (['现在', '当前', '此刻', '实时', 'now', 'current'].includes(text)) {
    const at = stampAt(new Date(context.now), context);
    return { start: at.slice(0, 10), end: at.slice(0, 10), at, precision: 'instant', source: 'system_time' };
  }
  const window = text.match(/^(?:未来|接下来)([\d一二两三四五六七八九十]+)(分钟|小时)$/);
  if (window) {
    const count = number(window[1]);
    if (!Number.isFinite(count) || count <= 0 || count > 10000) throw new Error('时间窗口长度无效');
    const startAt = stampAt(new Date(context.now), context);
    const endAt = stampAt(new Date(new Date(context.now).getTime() + count * (window[2] === '小时' ? 3600000 : 60000)), context);
    return { start: startAt.slice(0, 10), end: endAt.slice(0, 10), startAt, endAt, precision: granularity ?? (window[2] === '小时' ? 'hour' : 'minute'), source: 'system_time' };
  }
  const hasClock = /(?:点|时\d|:\d{2}|：\d{2}|分钟后|小时后)/.test(text);
  if (hasClock) {
    const parsed = datetime(text, context);
    const clock = parsed.value.match(/T\d{2}:(\d{2}):(\d{2})/);
    const fine = Number(clock?.[1]) !== 0 || Number(clock?.[2]) !== 0;
    return { start: parsed.value.slice(0, 10), end: parsed.value.slice(0, 10), at: parsed.value, precision: granularity ?? (fine ? 'minute' : 'hour'), source: parsed.source };
  }
  const range = dateRange(expression, context);
  const value = { ...range, precision: range.period ? 'period' : 'day' };
  if (range.period) {
    const [startHour, startMinute] = range.period.start.split(':').map(Number);
    const [endHour, endMinute] = range.period.end.split(':').map(Number);
    value.startAt = localISO(range.start, startHour, startMinute, 0, context.timezone);
    value.endAt = localISO(endHour === 24 ? addDays(range.end, 1) : range.end, endHour === 24 ? 0 : endHour, endMinute, 0, context.timezone);
  }
  return value;
}

function weatherTimePlan(capability, args, time, context) {
  const special = weatherDatasets.has(capability.object) && !['current', 'hourly', 'daily', 'minute'].includes(capability.object);
  const inferred = time.precision === 'instant' ? 'current' : time.precision === 'minute' ? 'minute' : ['hour', 'period'].includes(time.precision) ? 'hourly' : 'daily';
  const requestedDataset = args.dataset ?? (special ? capability.object : inferred);
  const nativeDataset = weatherDatasets.has(capability.object) ? capability.object : requestedDataset;
  const availability = context.weatherAvailability ?? {};
  const requested = { dataset: requestedDataset, precision: time.precision, range: structuredClone(time) };
  const plan = { requested, effective: null, precision: time.precision, availabilitySource: context.weatherAvailabilitySource ?? context.availabilitySource ?? availability.source ?? (context.weatherAvailability ? 'provided_experiment' : 'contract_unspecified'), fallback: { applied: false, reason: null } };
  const reasons = [];
  let effectiveDataset = nativeDataset;
  if (nativeDataset !== requestedDataset) reasons.push(`请求 ${requestedDataset} 精度；所选字段接口属于 ${nativeDataset} 数据集`);
  const presentInstant = time.precision === 'instant' && Number.isFinite(Date.parse(time.at)) && Math.abs(Date.parse(time.at) - Date.parse(context.now)) < 60000;
  const compatible = dataset => dataset === nativeDataset || !capability.support?.fallbackDatasets || capability.support.fallbackDatasets.includes(dataset);
  const supportsTime = dataset => dataset !== 'current' || presentInstant;
  const contractFor = dataset => dataset === nativeDataset ? capability : getCapability(`weather.${dataset}.${capability.aggregate ? 'overview' : capability.field}`);
  const withinHorizon = dataset => {
    const horizon = contractFor(dataset)?.availability;
    if (!horizon || !['minute', 'hourly', 'daily'].includes(dataset)) return true;
    const start = Date.parse(time.at ?? time.startAt ?? localISO(time.start, 0, 0, 0, context.timezone));
    const end = Date.parse(time.at ?? time.endAt ?? localISO(addDays(time.end, 1), 0, 0, 0, context.timezone));
    const now = Date.parse(context.now);
    const hours = context.weatherRegion === 'outside_CN' ? horizon.outsideChinaHours : horizon.chinaHours ?? horizon.outsideChinaHours;
    const length = horizon.minutes ? horizon.minutes * 60000 : hours ? hours * 3600000 : horizon.days ? horizon.days * dayMs : null;
    return length === null || (end > now && start < now + length && end <= now + length + (dataset === 'daily' ? dayMs : 0));
  };
  const usable = dataset => availability[dataset] !== false && supportsTime(dataset) && withinHorizon(dataset);
  if (!usable(effectiveDataset)) {
    if (!supportsTime(effectiveDataset)) reasons.push('current 仅能表达当前实况，不能代替未来预测或时间窗口');
    if (availability[effectiveDataset] === false) reasons.push(`${effectiveDataset} 数据集在当前实验状态不可用`);
    if (!withinHorizon(effectiveDataset)) reasons.push(`${effectiveDataset} 数据集的官方预报范围无法覆盖请求时间窗口`);
    const choices = [...new Set([requestedDataset, 'minute', 'hourly', 'daily', 'current'])].filter(dataset => dataset !== nativeDataset && ['minute', 'hourly', 'daily', 'current'].includes(dataset));
    effectiveDataset = choices.find(dataset => compatible(dataset) && usable(dataset));
    if (!effectiveDataset) { plan.fallback.reason = `${reasons.join('；')}；没有兼容的可用数据集`; return plan; }
  }
  const rank = { instant: 0, minute: 1, hour: 2, period: 2, day: 3 };
  const datasetPrecision = { current: 'instant', minute: 'minute', hourly: 'hour', daily: 'day' }[effectiveDataset] ?? { current: 'instant', hour: 'hour', day: 'day', minute: 'minute' }[capability.availability?.precision] ?? time.precision;
  const coarser = rank[datasetPrecision] > rank[time.precision];
  if (coarser && !reasons.length) reasons.push(`${effectiveDataset} 数据只能提供 ${datasetPrecision} 精度`);
  const strict = args.strict_time === true || context.resolutionPolicy?.allowApproximation === false;
  if (strict && (coarser || availability[nativeDataset] === false)) { plan.fallback.reason = `严格时间策略拒绝降级：${reasons.join('；')}`; return plan; }
  const effectiveRange = structuredClone(time);
  if (coarser && effectiveDataset === 'daily') {
    delete effectiveRange.at; delete effectiveRange.startAt; delete effectiveRange.endAt; delete effectiveRange.period;
    effectiveRange.precision = 'day';
  } else if (coarser && effectiveDataset === 'hourly') {
    const floor = stamp => stampAt(new Date(Math.floor(Date.parse(stamp) / 3600000) * 3600000), context);
    const ceil = stamp => stampAt(new Date(Math.ceil(Date.parse(stamp) / 3600000) * 3600000), context);
    if (effectiveRange.at) effectiveRange.at = floor(effectiveRange.at);
    if (effectiveRange.startAt) effectiveRange.startAt = floor(effectiveRange.startAt);
    if (effectiveRange.endAt) effectiveRange.endAt = ceil(effectiveRange.endAt);
    effectiveRange.precision = 'hour';
  }
  const effectiveContract = contractFor(effectiveDataset);
  plan.effective = { dataset: effectiveDataset, api: effectiveContract?.id ?? capability.id, projection: effectiveContract?.projection ?? capability.projection ?? null, precision: datasetPrecision, range: effectiveRange, requiresFilteringToRequestedRange: coarser };
  plan.fallback = { applied: reasons.length > 0, reason: reasons.length ? reasons.join('；') : null, requestedConstraintsPreserved: true };
  return plan;
}

function locationPlan(capability, args, resolvedLocation, context) {
  const requested = { ...(args.location !== undefined ? { location: structuredClone(args.location) } : {}), ...(args.coordinates !== undefined ? { coordinates: structuredClone(args.coordinates) } : {}) };
  const plan = { requested, effective: null, precision: null, geocoding: null, fallback: { applied: false, reason: null } };
  if (coordinateValid(args.coordinates)) { plan.effective = { ...args.coordinates, source: 'user' }; plan.precision = 'coordinates'; return plan; }
  if (resolvedLocation && typeof resolvedLocation === 'object') {
    plan.effective = structuredClone(resolvedLocation);
    plan.precision = resolvedLocation.precision ?? (resolvedLocation.accuracyMeters > 1000 ? 'coarse' : 'coordinates');
    if (['coarse', 'city', 'district', 'region'].includes(plan.precision) || resolvedLocation.accuracyMeters > 1000) plan.fallback = { applied: true, reason: `${resolvedLocation.source === 'fixture' ? '固定实验位置仅表示城市/区域代表点' : '设备仅提供粗位置'}${resolvedLocation.accuracyMeters ? `，误差约 ${resolvedLocation.accuracyMeters} 米` : ''}，保留位置精度限制` };
    return plan;
  }
  if (typeof resolvedLocation !== 'string') return plan;
  const coordinateText = resolvedLocation.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coordinateText) {
    const point = { latitude: Number(coordinateText[1]), longitude: Number(coordinateText[2]), source: 'user' };
    if (coordinateValid(point)) { plan.effective = point; plan.precision = 'coordinates'; }
    else plan.fallback.reason = '用户坐标超出地理范围';
    return plan;
  }
  const fixtures = context.geocodes ?? {};
  const entry = fixtures[resolvedLocation] ?? fixtures[resolvedLocation.replace(/市$/, '')];
  if (coordinateValid(entry) && entry.source === 'fixture') {
    plan.effective = structuredClone(entry); plan.precision = entry.precision ?? 'city';
    plan.geocoding = { source: 'fixture', query: resolvedLocation, simulated: true };
    plan.fallback = { applied: plan.precision !== 'coordinates', reason: '固定实验地理编码返回区域代表点，保留原始地点约束' };
  } else if (capability.support?.requiresGeocoding) plan.fallback.reason = `地点/区域“${resolvedLocation}”缺少可核验地理编码，不能猜坐标`;
  else { plan.effective = { name: resolvedLocation, kind: 'named_place', coordinatesResolved: false }; plan.precision = /地区|区域|华东|华南|西北|附近/.test(resolvedLocation) ? 'region' : 'named_place'; plan.geocoding = { source: null, pending: true }; }
  return plan;
}

export function resolveArguments(capability, args = {}, providedContext = {}) {
  const context = { now: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...providedContext };
  const parseContext = args.timezone ? { ...context, timezone: args.timezone } : context;
  const result = { arguments: structuredClone(args), sources: {}, missing: [], issues: [], warnings: [], resolution: { context: [] }, status: 'ready_mock' };
  const invalid = validateValue(schemaFor(capability), args);
  if (!invalid.valid) result.issues.push(...invalid.issues);
  let environmentFailed = false;
  const weatherCapability = capability.domain === 'weather' || capability.id.startsWith('weather.');
  if (weatherCapability && args.coordinates !== undefined) {
    if (coordinateValid(args.coordinates)) result.arguments.location = { ...args.coordinates, source: 'user' };
    else result.issues.push('coordinates 必须包含有效 latitude 和 longitude，不能猜缺失坐标');
  }
  const missing = field => { if (!result.missing.includes(field)) result.missing.push(field); };
  function resolveField(name, field, target, path, inheritedDay) {
    let value = target[name];
    let source = Object.hasOwn(target, name) ? 'user' : undefined;
    if (value === undefined && field.resolver === 'selected_object' && capability.risk === 'read') {
      const selected = context.objects?.[field.contextKey ?? name];
      const rule = schemaFor({ inputs: { value: field } }).properties.value;
      if (selected?.trusted === true && selected.source === 'user_selection' && validateValue(rule, selected.value).valid) {
        value = structuredClone(selected.value); source = 'context';
        result.resolution.context.push({ field: path, source: selected.source, trusted: true });
      }
    }
    if (value === undefined && !(capability.risk === 'write' && field.required)) {
      const boundField = (field.defaultUnlessPresent ?? []).find(reference => target[reference] !== undefined);
      const fallback = boundField ? undefined : weatherCapability && Object.hasOwn(capability.inputDefaults ?? {}, name) ? capability.inputDefaults[name] : field.default;
      if (fallback !== undefined) { value = structuredClone(fallback); source = 'default'; }
    }
    if (value === undefined && field.resolver === 'system_timezone') {
      try {
        new Intl.DateTimeFormat('en', { timeZone: context.timezone }).format(new Date());
        value = context.timezone; source = 'system_timezone';
        result.resolution.context.push({ field: path, source, reason: '用户未提供时区，使用当前系统时区解析创建/读取时间' });
      } catch {
        missing(path); environmentFailed = true; result.issues.push('系统时区无效，无法补全 timezone'); return;
      }
    }
    if (value === undefined && field.resolver === 'mime_from_uri') {
      const types = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', txt: 'text/plain', csv: 'text/csv', html: 'text/html', htm: 'text/html', json: 'application/json', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', mp3: 'audio/mpeg', mp4: 'video/mp4' };
      const uri = String(target.file_id ?? '');
      const extension = uri.split(/[?#]/, 1)[0].match(/\.([a-z\d]+)$/i)?.[1].toLowerCase();
      value = types[extension] ?? ''; source = value ? 'context' : 'default';
      result.resolution.context.push({ field: path, source, reason: value ? `根据用户文件 URI 后缀 .${extension} 推导 MIME` : '文件 URI 没有可识别后缀；保留空 MIME 供 SDK 根据 URI 判断', inferredFrom: 'file_id' });
    }
    if (field.resolver === 'system_location' && (value === undefined || /^(这里|当地|附近|本地|当前位置|此地|current|current_location)$/.test(value))) {
      const location = context.location;
      if (location && ['browser', 'fixture'].includes(location.source) && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90 && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180) {
        value = structuredClone(location); source = 'system_location';
      } else {
        delete target[name]; missing(path); environmentFailed = true;
        result.issues.push(`当前位置获取失败：${context.locationError ?? '未提供浏览器授权位置或固定位置夹具'}。请提供地点或授权定位。`);
        return;
      }
    }
    if (value === undefined) { if (field.required) missing(path); return; }
    try {
      if (field.resolver === 'relative_time') {
        const range = readTime(value, parseContext);
        if (weatherCapability && args[name] === undefined && capability.object === 'minute') range.precision = 'minute';
        const { source: timeSource, ...time } = range;
        value = { ...time, timezone: parseContext.timezone, expression: value };
        source = timeSource;
      } else if (field.resolver === 'datetime') {
        const parsed = datetime(value, parseContext, inheritedDay);
        value = parsed.value; source = parsed.source;
      } else if (field.type === 'object' && field.properties && value && typeof value === 'object') {
        value = structuredClone(value);
        for (const [childName, child] of Object.entries(field.properties)) resolveField(childName, child, value, `${path}.${childName}`, value.starts_at?.slice(0, 10));
      }
      target[name] = value;
      result.sources[path] = source;
    } catch (error) {
      delete target[name]; missing(path); result.issues.push(`${path}: ${error.message}`);
      if (/系统时间无效|Invalid time zone/.test(error.message)) environmentFailed = true;
    }
  }
  for (const [name, field] of Object.entries(capability.inputs)) resolveField(name, field, result.arguments, name, name === 'ends_at' ? result.arguments.starts_at?.slice(0, 10) : undefined);
  if (weatherCapability) {
    result.resolution.location = locationPlan(capability, args, result.arguments.location, context);
    if (!result.resolution.location.effective) { environmentFailed = true; missing('location'); if (result.resolution.location.fallback.reason) result.issues.push(result.resolution.location.fallback.reason); }
    else if (result.resolution.location.fallback.applied) result.warnings.push(result.resolution.location.fallback.reason);
    if (result.arguments.time_ref && typeof result.arguments.time_ref === 'object') {
      result.resolution.time = weatherTimePlan(capability, { ...result.arguments, ...args }, result.arguments.time_ref, context);
      if (!result.resolution.time.effective) { missing('time_ref'); result.issues.push(result.resolution.time.fallback.reason ?? '没有可用时间数据集'); }
      else if (result.resolution.time.fallback.applied) result.warnings.push(result.resolution.time.fallback.reason);
    }
  }
  for (const name of capability.constraints?.nonEmptyObject ?? []) {
    if (!result.arguments[name] || Object.keys(result.arguments[name]).length === 0) { missing(name); result.issues.push(`${name} 需要至少一个变更字段`); }
  }
  if (capability.constraints?.atLeastOne && !capability.constraints.atLeastOne.some(name => result.arguments[name] !== undefined)) {
    missing(capability.constraints.atLeastOne.join('|'));
    result.issues.push(`至少需要一个字段：${capability.constraints.atLeastOne.join('、')}`);
  }
  for (const object of [result.arguments, result.arguments.changes].filter(Boolean)) {
    if (object.starts_at && object.ends_at && Date.parse(object.ends_at) <= Date.parse(object.starts_at)) result.issues.push('结束时间必须晚于开始时间');
  }
  if (result.missing.length || result.issues.length) result.status = environmentFailed ? 'resolution_failed' : 'needs_clarification';
  return result;
}
