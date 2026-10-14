/** Native paths verified from Huawei's advertised Markdown API reference. These are mock business getters. */
export const WEATHER_SOURCE = 'https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/weather-service-weatherservice';
export const WEATHER_INTRO_SOURCE = 'https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V14/weather-service-introduction-V14';
const field = (label, type = 'number', unit, aliases = [], extra = {}) => ({ label, type, unit, aliases, ...extra });
const obj = (label, children, sourceClass, aliases = []) => ({ label, type: 'object', children, sourceClass, aliases });
const list = (label, children, sourceClass, aliases = [], extra = {}) => ({ ...obj(label, children, sourceClass, aliases), type: 'array', ...extra });
const Wind = {
  direction: field('风向', 'enum', undefined, ['吹什么方向的风']), speed: field('风速', 'number', 'km/h', ['风有多快']), level: field('风力级别', 'number', '级', ['风力', '几级风']),
  gustDirection: field('阵风风向', 'enum', undefined, [], { optional: true }), gustSpeed: field('阵风风速', 'number', 'km/h', [], { optional: true }), gustLevel: field('阵风风力级别', 'number', '级', [], { optional: true })
};
const Condition = { type: field('天气现象类型', 'enum'), description: field('天气现象描述', 'string', undefined, ['晴雨状况']), icon: field('天气图标', 'resource') };
const Uv = { category: field('紫外线暴露类别', 'enum'), value: field('紫外线指数值', 'number', undefined, ['紫外线强度']), description: field('紫外线等级描述', 'string') };
const Aqi = {
  aqiValue: field('空气质量指数', 'number', undefined, ['空气质量', 'AQI']), aqiCategory: field('空气质量类别', 'enum'), aqiDescription: field('空气质量描述', 'string'),
  pm25: field('PM2.5浓度', 'number', 'μg/m³', ['PM2.5', '细颗粒物'], { optional: true }), pm10: field('PM10浓度', 'number', 'μg/m³', ['PM10'], { optional: true }),
  no2: field('二氧化氮浓度', 'number', 'μg/m³', [], { optional: true }), o3: field('臭氧浓度', 'number', 'μg/m³', [], { optional: true }),
  so2: field('二氧化硫浓度', 'number', 'μg/m³', [], { optional: true }), co: field('一氧化碳浓度', 'number', 'μg/m³', [], { optional: true })
};
const atmospheric = {
  humidity: field('相对湿度', 'number', '%', ['湿度', '空气湿不湿']), wind: obj('风力风向', Wind, 'wind', ['风况']),
  cloudCover: field('云量', 'number', '%'), condition: obj('天气现象', Condition, 'weathercondition', ['天气状况']),
};
const uvAqi = { uvIndex: obj('紫外线指数', Uv, 'uvindex'), aqi: { ...obj('空气质量', Aqi, 'weatheraqi', ['空气污染']), optional: true } };
const DayPart = {
  ...atmospheric, precipitationProbability: field('降水概率', 'number', undefined, ['下雨概率']), precipitationAmount: field('降水量', 'number', 'mm'),
  rainfallProbability: field('降雨概率', 'number', undefined, [], { optional: true }), rainfallAmount: field('降雨量', 'number', 'mm', [], { optional: true }),
  snowfallProbability: field('降雪概率', 'number', undefined, [], { optional: true }), snowfallAmount: field('降雪量', 'number', 'mm', [], { optional: true })
};
const timestamps = { updateTime: field('数据更新时间', 'date'), expirationTime: field('数据失效时间', 'date') };
const forecastTimestamps = Object.fromEntries(Object.entries(timestamps).map(([name,spec])=>[name,{...spec,container:'forecast',sourceClass:'forecastt'}]));
const dateField = field('预报日期', 'date');

export const weatherObjects = {
  current: { label: '实况天气', sourceClass: 'currentweather', defaultTime: '现在', precision: 'current', fields: {
    temperature: field('温度', 'number', '℃', ['气温']), apparentTemperature: field('体感温度', 'number', '℃'), ...atmospheric,
    pressure: field('地面气压', 'number', 'hPa', ['气压']), pressureTrend: field('气压趋势', 'enum'), ...uvAqi,
    visibility: field('能见度', 'number', 'km'), ...timestamps, summary: field('实况天气一句话描述', 'string', undefined, ['天气摘要'], { optional: true }), alertTitle: field('预警标题', 'string', undefined, [], { optional: true, since: '6.1.0(23)' })
  } },
  hourly: { label: '逐小时天气', sourceClass: 'hourlyweather', defaultTime: '未来24小时', precision: 'hour', horizon: { chinaHours: 48, outsideChinaHours: 24, sourceRef: WEATHER_INTRO_SOURCE }, fields: {
    date: dateField, temperature: field('温度', 'number', '℃', ['气温']), apparentTemperature: field('体感温度', 'number', '℃'), ...atmospheric, ...uvAqi,
    visibility: field('能见度', 'number', 'km'), precipitationProbability: field('降水概率', 'number', undefined, ['下雨概率']), precipitationAmount: field('降水量', 'number', 'mm'), ...forecastTimestamps
  } },
  daily: { label: '多日天气', sourceClass: 'dailyweather', defaultTime: '今天', precision: 'day', horizon: { days: 10, sourceRef: WEATHER_INTRO_SOURCE }, fields: {
    date: dateField, highTemperature: field('最高温度', 'number', '℃', ['最高气温']), lowTemperature: field('最低温度', 'number', '℃', ['最低气温']),
    highApparentTemperature: field('最高体感温度', 'number', '℃'), lowApparentTemperature: field('最低体感温度', 'number', '℃'), ...uvAqi,
    visibility: field('能见度', 'number', 'km'), pressure: field('地面气压', 'number', 'hPa', ['气压']),
    sun: obj('日出日落', { sunrise: field('日出时间', 'date', undefined, ['几点日出']), sunset: field('日落时间', 'date', undefined, ['几点日落']) }, 'sunevents'),
    moon: obj('月亮信息', {
      moonrise: field('月出时间', 'date'), moonset: field('月落时间', 'date'), illuminatedFraction: field('月面照亮比例', 'number', '%', [], { optional: true }), age: field('月龄', 'number', undefined, [], { optional: true }),
      phase: obj('月相', { type: field('月相类型', 'enum'), description: field('月相描述', 'string'), icon: field('月相图标', 'resource') }, 'moonphase')
    }, 'moonevents'),
    daytimeForecast: obj('白天天气', DayPart, 'daypartforecast', ['白天', '日间']), overnightForecast: obj('夜晚天气', DayPart, 'daypartforecast', ['夜间', '晚上']), ...forecastTimestamps
  } },
  minute: { label: '分钟降水', sourceClass: 'minuteweather', defaultTime: '未来两小时', precision: 'minute', horizon: { minutes: 120, radiusKm: 5, sourceRef: WEATHER_INTRO_SOURCE }, absence: '短期无降水时 minute 字段可能不返回，不能把字段缺失当作确定无雨。', fields: {
    date: field('分钟降水时间', 'date'), precipitation: field('降水类型', 'enum', undefined, ['雨雪类型']), precipitationIntensity: field('降水密度', 'number', '0..1', ['降水强度', '雨势']), ...forecastTimestamps,
    summary: field('分钟降水一句话描述','string',undefined,['分钟降水摘要'],{optional:true,container:'forecast',sourceClass:'forecastt',semantic:'precipitation_summary'})
  } },
  alerts: { label: '天气预警', sourceClass: 'weatheralert', defaultTime: '现在', precision: 'current', absence: '当前无预警时该字段可能不返回。', fields: {
    ...timestamps, id: field('预警ID', 'string'), title: field('预警标题', 'string'), region: field('预警区域', 'string', undefined, [], { optional: true }),
    level: field('预警等级', 'enum'), levelDescription: field('预警等级描述', 'string'), type: field('预警类型', 'enum'), typeDescription: field('预警类型描述', 'string'),
    content: field('预警正文', 'string'), guide: field('预警防御指南', 'string', undefined, [], { optional: true }), detailsUrl: field('预警详情链接', 'string', undefined, [], { optional: true }), source: field('预警来源', 'string'), icon: field('预警图标', 'resource', undefined, [], {optional:true})
  } },
  indices: { label: '天气指数', sourceClass: 'weatherindex', defaultTime: '未来3天', precision: 'day', fields: {
    ...timestamps, type: field('指数类型', 'enum'), name: field('指数名称', 'string'),
    dailyItems: list('每天指数详情', { date: field('指数日期', 'date'), level: field('指数级别', 'number'), levelDescription: field('指数级别描述', 'string'), content: field('指数内容', 'string') }, 'dailyindex', ['穿衣指数', '运动指数', '洗车指数', '钓鱼指数', '防晒指数'])
  } },
  tides: { label: '潮汐', sourceClass: 'tide', defaultTime: '今天', precision: 'hour', absence: '无潮汐站点时该字段可能不返回。', fields: {
    ...timestamps, stationId: field('潮汐站点ID', 'string'), stationName: field('潮汐站点名称', 'string'),
    hourlyTides: list('小时潮汐', { date: field('潮汐小时日期', 'date'), category: field('潮汐类型', 'enum', undefined, [], { optional: true }), height: field('潮汐高度', 'number', 'cm', ['潮位']) }, 'hourlytide')
  } },
  city: { label: '天气城市信息', sourceClass: 'city', defaultTime: '现在', precision: 'current', since: '6.1.0(23)', fields: {
    countryCode: field('国家编码', 'string'), level: field('行政区划等级', 'number'), localizedName: field('本地化城市名称', 'string'), chineseName: field('中文城市名称', 'string', undefined, [], { optional: true }), englishName: field('英文城市名称', 'string', undefined, [], { optional: true }), timezone: field('城市时区', 'string', undefined, [], { optional: true }),
    administrativeAreas: list('行政区域列表', { level: field('行政区划等级', 'number'), localizedName: field('本地化行政区域名称', 'string'), chineseName: field('行政区域中文名', 'string', undefined, [], { optional: true }), englishName: field('行政区域英文名', 'string', undefined, [], { optional: true }) }, 'administrativearea', [], { optional: true })
  } }
};

const str = (description, extra = {}) => ({ type: 'string', minLength: 1, description, ...extra });
export function weatherInputs(defaultTime = 'today') {
  return {
    location: str('明确地点名称或这里；缺省时使用系统位置。命名地点需未来地理编码映射', { resolver: 'system_location' }),
    coordinates: { type: 'object', description: '用户明确给出的经纬度；不由模型猜测', properties: { latitude: { type: 'number', required: true, minimum: -90, maximum: 90, description: '纬度' }, longitude: { type: 'number', required: true, minimum: -180, maximum: 180, description: '经度' } }, additionalProperties: false },
    time_ref: str('明确时间、范围及粒度，保留原文，如明天下午三点或未来两小时每分钟', { resolver: 'relative_time', default: defaultTime }),
    strict_time: { type: 'boolean', description: '只有用户要求不得降低时间精度时为 true；缺省允许同字段的明确降级', default: false }
  };
}

export const weatherInputAlternatives = [{ fields: ['location', 'coordinates'], resolvedField: 'location', resolver: 'system_location', description: '地点原文或经纬度任选一种；都未提供时取系统位置。最终查询统一使用解析坐标，保留原文、来源及精度；同时提供时明确坐标优先。' }];

const allFields = [];
export const weatherCapabilities = [];
function addFields(object, info, entries, parentPath = '', parentLabel = '', inheritedClass = info.sourceClass, inheritedOptional = false, sdkParentPath = '') {
  for (const [name, spec] of Object.entries(entries)) {
    const path = parentPath ? `${parentPath}.${name}` : name;
    const label = parentLabel ? `${parentLabel}·${spec.label}` : spec.label;
    const optional = Boolean(spec.optional || inheritedOptional);
    const sdkFieldPath = sdkParentPath ? `${sdkParentPath}.${name}` : name;
    const projection = `${object}${spec.container === 'forecast' ? '' : ['hourly', 'daily', 'minute'].includes(object) ? '.forecast[]' : ['alerts', 'indices', 'tides'].includes(object) ? '[]' : ''}.${sdkFieldPath}`;
    const series = spec.container !== 'forecast' && ['hourly', 'daily', 'minute', 'alerts', 'indices', 'tides'].includes(object);
    const arrayLeaf = !series && sdkFieldPath.includes('[]');
    allFields.push({ object, path, label, type: spec.type, unit: spec.unit, optional, sourceRef: `${WEATHER_SOURCE}#${spec.sourceClass ?? inheritedClass}` });
    weatherCapabilities.push({
      id: `weather.${object}.${path}`, domain: 'weather', name: `${info.label}·${label}`, description: `获取${info.label}的${label}${spec.unit ? `，单位 ${spec.unit}` : ''}。仅模拟；字段对应官方路径 ${object}.${path}。`, risk: 'read',
      object, field: path, action: 'get', aggregate: false, granularities: [object], sourceRef: `${WEATHER_SOURCE}#${spec.sourceClass ?? inheritedClass}`,
      inputDefaults: { time_ref: info.defaultTime }, inputs: weatherInputs(info.defaultTime), constraints: { coordinateOrLocation: true },
      aliases: [label, spec.label, ...(spec.aliases ?? [])], keywords: [spec.label, ...(spec.aliases ?? []), object, path],
      projection,
      returns: { type: arrayLeaf ? 'array' : spec.type, ...(arrayLeaf ? { items: { type: spec.type } } : {}), unit: spec.unit ?? null, shape: series ? 'series' : arrayLeaf ? 'list' : 'value', optional },
      output: { path: `${object}.${path}`, sdkPath: projection, type: spec.type, unit: spec.unit, optional, semantic:spec.semantic, since: spec.since ?? info.since ?? '5.0.0(12)' },
      availability: { ...(info.horizon ?? {}), precision: info.precision, absence: info.absence ?? null }
    });
    if (spec.children) addFields(object, info, spec.children, path, label, spec.sourceClass ?? inheritedClass, optional, `${sdkFieldPath}${spec.type === 'array' ? '[]' : ''}`);
  }
}
for (const [object, info] of Object.entries(weatherObjects)) {
  weatherCapabilities.push({ id: `weather.${object}.overview`, domain: 'weather', name: `${info.label}总览`, description: `获取${info.label}对象总览。仅在用户要该对象整体内容时选择，指定单字段优先字段 getter。`, risk: 'read', object, field: '*', action: 'get', aggregate: true, granularities: [object], sourceRef: `${WEATHER_SOURCE}#${info.sourceClass}`, inputDefaults: { time_ref: info.defaultTime }, inputs: weatherInputs(info.defaultTime), constraints: { coordinateOrLocation: true }, aliases: [`${info.label}总览`, info.label], keywords: [info.label, object], availability: { ...(info.horizon ?? {}), precision: info.precision, absence: info.absence ?? null } });
  addFields(object, info, info.fields);
}
export const weatherNativeFields = allFields;
export const weatherFieldNames = [...new Set(allFields.map(item => item.path))];
export const weatherFieldMatrix = Object.fromEntries(weatherFieldNames.map(path => [path, allFields.filter(item => item.path === path).map(item => item.object)]));
for (const capability of weatherCapabilities) {
  capability.inputAlternatives = structuredClone(weatherInputAlternatives);
  const forecastDatasets = ['current', 'hourly', 'daily', 'minute'];
  const compatible = capability.aggregate ? forecastDatasets.filter(dataset => dataset !== capability.object)
    : weatherCapabilities.filter(other => !other.aggregate && other.object !== capability.object && forecastDatasets.includes(other.object) && other.field === capability.field && other.output.type === capability.output.type && other.output.unit === capability.output.unit && other.output.semantic === capability.output.semantic).map(other => other.object);
  capability.support = { requiresGeocoding: true, fallbackDatasets: forecastDatasets.includes(capability.object) ? [...new Set(compatible)] : [] };
}
