import { validateValue } from './providers.mjs';

// The native host supplies read(). Node never impersonates a HarmonyOS device.
const bindings = {
  system_location: { capability: 'location.current', contextKey: 'location' },
  system_coordinates: { capability: 'location.current', contextKey: 'location' },
  system_timezone: { capability: 'device.time.timezone', contextKey: 'timezone' },
  relative_time: { capability: 'device.time.current', contextKey: 'now' },
  datetime: { capability: 'device.time.current', contextKey: 'now' },
  system_default_network: { capability: 'system.default_network', contextKey: 'defaultNetwork', sdkMethod: 'connection.getDefaultNet', sourceKind: 'native_dependency' },
  // StreamUsage belongs to the host's active audio scenario; there is no universal current-stream SDK getter.
  system_audio_stream: { capability: 'host.audio_stream', contextKey: 'audioStream', sourceKind: 'app_audio_context' }
};
const currentPlace = value => value === undefined || typeof value === 'string' && /^(这里|当地|附近|本地|当前位置|此地|current|current_location)$/.test(value);
const validPoint = value => value && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
const trustedPoint = value => validPoint(value) && ['browser','fixture','harmony'].includes(value.source);
const auditTimes = response => {
  const metadata={};
  for(const key of ['observedAt','expiresAt']) if(response[key]!==undefined) {
    if(typeof response[key]!=='string'||!Number.isFinite(Date.parse(response[key]))) throw new Error(`系统 ${key} 必须为有效时间字符串`);
    metadata[key]=response[key];
  }
  return metadata;
};

/** Recover explicit slots before calling this function. Missing model output alone is never default evidence. */
export async function prepareSystemContext(capability, args, providedContext = {}, adapter, signal, blockedFields = []) {
  const context = structuredClone(providedContext);
  const requests = [];
  const seen = new Set();
  // A named place is not the current device position. Resolve the name, never substitute it.
  const place = args.location;
  if (capability.domain === 'weather' && typeof place === 'string' && place.trim() && !currentPlace(place) && args.coordinates === undefined && !blockedFields.includes('location')) {
    const known = context.geocodes?.[place] ?? context.geocodes?.[place.replace(/市$/, '')];
    if (!validPoint(known) || !['fixture','harmony'].includes(known.source)) {
      const request = {field:'location',capability:'location.geocode',sourceKind:'native_dependency',sdkMethod:'geoLocationManager.getAddressesFromLocationName',arguments:{address:place},reason:'用户明确指定地点，需要解析该地点，不能替换为当前位置',status:'pending',executed:false};
      requests.push(request);
      if (adapter?.read) {
        try {
          signal?.throwIfAborted();
          const response=await adapter.read({capability:request.capability,field:'location',arguments:request.arguments,signal});
          if (!response || !['harmony','fixture'].includes(response.source)) throw new Error('地理编码须标记 harmony 或 fixture 来源');
          const metadata=auditTimes(response);
          const value=Array.isArray(response.value) ? response.value.length===1 ? response.value[0] : null : response.value;
          if (!validPoint(value)) throw new Error('指定地点未得到唯一可核验坐标，不能使用当前位置代替');
          context.geocodes ??= {};
          context.geocodes[place]={...value,...metadata,precision:value.precision??'city',source:response.source};
          Object.assign(request,{status:'resolved',executed:true,source:response.source,method:response.method??null,...metadata});
        } catch (error) {
          if (signal?.aborted) throw error;
          Object.assign(request,{status:'failed',executed:true,error:error.message});
        }
      }
    }
  }
  const inputs=capability.inputs??{};
  const needsClock=Object.values(inputs).some(field=>['relative_time','datetime'].includes(field.resolver));
  // Timezone is a parsing dependency even when it is not an API extraction slot (e.g. weather).
  const dependencies=needsClock&&!inputs.timezone?{...inputs,timezone:{type:'string',resolver:'system_timezone'}}:inputs;
  for (const [field, definition] of Object.entries(dependencies)) {
    if (blockedFields.includes(field)) continue;
    const binding = bindings[definition.resolver];
    if (!binding) continue;
    if (definition.resolver === 'system_location' && (!currentPlace(args[field]) || args.coordinates !== undefined)) continue;
    if (definition.resolver === 'system_coordinates' && args[field] !== undefined) continue;
    if (['system_default_network', 'system_audio_stream', 'system_media_session', 'system_timezone'].includes(definition.resolver) && args[field] !== undefined) continue;
    if (['datetime', 'relative_time'].includes(definition.resolver) && context.now) continue;
    if (binding.contextKey === 'timezone' && context.timezone) continue;
    if (binding.contextKey === 'location' && trustedPoint(context.location)) continue;
    const existing = context.systemValues?.[field];
    if (existing && ['fixture','harmony'].includes(existing.source) && validateValue(definition,existing.value).valid) continue;
    if (seen.has(binding.capability)) continue;
    seen.add(binding.capability);
    const request = { field, capability: binding.capability, sourceKind: binding.sourceKind ?? 'native_dependency', sdkMethod: binding.sdkMethod ?? null, reason: '用户未提供可直接执行的系统参数', status: 'pending', executed: false };
    requests.push(request);
    if (!adapter?.read) continue;
    try {
      signal?.throwIfAborted();
      const response = await adapter.read({ capability: binding.capability, field, sdkMethod:binding.sdkMethod??null, signal });
      if (!response || !['harmony', 'fixture'].includes(response.source)) throw new Error('系统读取须标记 harmony 或 fixture 来源');
      const metadata=auditTimes(response);
      const value = binding.contextKey === 'now' && typeof response.value === 'number' && Number.isFinite(response.value) ? new Date(response.value).toISOString() : response.value;
      if (binding.contextKey === 'location') {
        if (!validPoint(value)) throw new Error('系统定位没有返回有效经纬度');
        // LocationKit names this field accuracy (metres); browser context uses accuracyMeters.
        const accuracyMeters = value.accuracyMeters ?? value.accuracy;
        if (accuracyMeters !== undefined && (!Number.isFinite(accuracyMeters) || accuracyMeters < 0)) throw new Error('系统定位精度必须为非负米数');
        context.location = { ...value, ...metadata, ...(accuracyMeters !== undefined ? {accuracyMeters} : {}), source: response.source };
      } else if (binding.contextKey === 'now') {
        if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('系统时钟无效');
        context.now = value;
      } else if (binding.contextKey === 'timezone') {
        if (typeof value !== 'string') throw new Error('系统时区无效');
        new Intl.DateTimeFormat('en', { timeZone: value });
        context.timezone = value;
      } else {
        if (!validateValue(definition, value).valid) throw new Error('系统参数不符合能力类型');
        context.systemValues ??= {};
        context.systemValues[field] = { value, source: response.source, ...metadata };
      }
      Object.assign(request, { status: 'resolved', executed: true, source: response.source, method: response.method ?? null, ...metadata });
    } catch (error) {
      if (signal?.aborted) throw error;
      Object.assign(request, { status: 'failed', executed: true, error: error.message });
      if (binding.contextKey === 'location') context.locationError = error.message;
      if (binding.contextKey === 'now') context.now = null;
    }
  }
  return { context, requests };
}
