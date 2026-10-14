/** Read-only, single-service HarmonyOS contracts. No function here invokes a SDK. */
const str = (description, extra = {}) => ({ type: 'string', description, minLength: 1, ...extra });
const integer = (description, extra = {}) => ({ type: 'integer', description, ...extra });
const ref = name => `https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/${name}`;
const verification = (kit, file) => `https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/reference/apis-${kit}/${file}.md`;

export const systemDomains = [
  { id: 'device', name: '设备状态', description: '本机电量、充电、电池温度、型号、系统版本、屏幕属性、系统时间；设备温度不是天气气温。' },
  { id: 'connectivity', name: '网络连接', description: '本机当前网络、Wi-Fi名称与信号、蓝牙开关；查询状态，不开启或关闭连接。' },
  { id: 'location', name: '位置服务', description: '本机当前位置、定位开关、经纬度、定位精度、地理编码与逆地理编码；天气查询中的位置参数仍归天气。' },
  { id: 'media', name: '音频媒体', description: '本机音量、音频流静音、铃声模式、麦克风静音、可用音频输出设备；只读查询。' }
];

const sources = {
  battery: { sourceRef: ref('js-apis-battery-info'), verificationRef: verification('basic-services-kit', 'js-apis-battery-info'), kit: 'BasicServicesKit', category: '系统', module: 'batteryInfo', systemCapability: 'SystemCapability.PowerManager.BatteryManager.Core' },
  info: { sourceRef: ref('js-apis-device-info'), verificationRef: verification('basic-services-kit', 'js-apis-device-info'), kit: 'BasicServicesKit', category: '系统', module: 'deviceInfo', systemCapability: 'SystemCapability.Startup.SystemInfo' },
  display: { sourceRef: ref('js-apis-display'), verificationRef: verification('arkui', 'js-apis-display'), kit: 'ArkUI', category: '应用框架', module: 'display', systemCapability: 'SystemCapability.WindowManager.WindowManager.Core' },
  time: { sourceRef: ref('js-apis-date-time'), verificationRef: verification('basic-services-kit', 'js-apis-date-time'), kit: 'BasicServicesKit', category: '系统', module: 'systemDateTime', systemCapability: 'SystemCapability.MiscServices.Time' },
  network: { sourceRef: ref('js-apis-net-connection'), verificationRef: verification('network-kit', 'js-apis-net-connection'), kit: 'NetworkKit', category: '系统', module: 'connection', systemCapability: 'SystemCapability.Communication.NetManager.Core', permissions: ['ohos.permission.GET_NETWORK_INFO'] },
  wifi: { sourceRef: ref('js-apis-wifimanager'), verificationRef: verification('connectivity-kit', 'js-apis-wifiManager'), kit: 'ConnectivityKit', category: '系统', module: 'wifiManager', systemCapability: 'SystemCapability.Communication.WiFi.STA', permissions: ['ohos.permission.GET_WIFI_INFO'] },
  bluetooth: { sourceRef: ref('js-apis-bluetooth-access'), verificationRef: verification('connectivity-kit', 'js-apis-bluetooth-access'), kit: 'ConnectivityKit', category: '系统', module: 'access', systemCapability: 'SystemCapability.Communication.Bluetooth.Core' },
  location: { sourceRef: ref('js-apis-geolocationmanager'), verificationRef: verification('location-kit', 'js-apis-geoLocationManager'), kit: 'LocationKit', category: '应用服务', module: 'geoLocationManager', systemCapability: 'SystemCapability.Location.Location.Core' },
  volume: { sourceRef: ref('arkts-apis-audio-audiovolumemanager'), verificationRef: verification('audio-kit', 'arkts-apis-audio-AudioVolumeManager'), kit: 'AudioKit', category: '媒体', module: 'audio', systemCapability: 'SystemCapability.Multimedia.Audio.Volume' },
  group: { sourceRef: ref('arkts-apis-audio-audiovolumegroupmanager'), verificationRef: verification('audio-kit', 'arkts-apis-audio-AudioVolumeGroupManager'), kit: 'AudioKit', category: '媒体', module: 'audio', systemCapability: 'SystemCapability.Multimedia.Audio.Volume' },
  routing: { sourceRef: ref('arkts-apis-audio-audioroutingmanager'), verificationRef: verification('audio-kit', 'arkts-apis-audio-AudioRoutingManager'), kit: 'AudioKit', category: '媒体', module: 'audio', systemCapability: 'SystemCapability.Multimedia.Audio.Device' }
};

function read(id, domain, object, field, name, type, aliases, source, extra = {}) {
  const { section, ...contract } = extra;
  return {
    id, domain, object, field, name, risk: 'read', inputs: {}, aliases,
    description: `查询${name}；只读当前设备或指定对象的这一项。结果是输出，用户提及的结果数值不得当作入参。`,
    projection: `${object}.${field}`,
    returns: { type, nullable: true, shape: 'value', description: `${name}；伪API执行的 value 为 null，由未来端侧适配器取得真实值。` },
    support: 'official_object_projection',
    ...source, sourceRef: source.sourceRef + (section ? `#${section}` : ''),
    source: { kind: 'harmonyos_sdk_contract', ...source, verification: 'Native signatures cross-checked against official OpenHarmony documentation; target HarmonyOS SDK/permissions still require validation.' },
    note: '可行性验证契约；PC没有接入鸿蒙SDK，不将本机Windows数据或虚构值声明为鸿蒙结果。',
    ...contract
  };
}

export const audioStreamTypes = ['MUSIC', 'VOICE_COMMUNICATION', 'VOICE_ASSISTANT', 'ALARM', 'RINGTONE', 'NOTIFICATION', 'MOVIE', 'GAME', 'AUDIOBOOK'];
const audioInputs = () => ({
  stream_type: str('用户明确的音频流：音乐/媒体 MUSIC，通话 VOICE_COMMUNICATION，助手 VOICE_ASSISTANT，闹钟 ALARM，铃声 RINGTONE，通知 NOTIFICATION，电影 MOVIE，游戏 GAME，有声书 AUDIOBOOK；未提时从可信系统音频上下文取得当前流，不猜 MUSIC', { enum: audioStreamTypes, required: true, resolver: 'system_audio_stream' })
});
const networkInputs = () => ({
  net_id: integer('用户明确的网络句柄ID；未提时由系统 getDefaultNet() 获取当前默认网络，不能用SSID或随意数字代替', { minimum: 1, required: true, resolver: 'system_default_network' })
});
const coordinates = () => ({
  type: 'object', description: '用户明确的WGS84经纬度；完全未提坐标时可由授权系统定位补本机当前坐标。缺一个分量时不能猜另一个。', required: true, resolver: 'system_coordinates',
  properties: {
    latitude: { type: 'number', minimum: -90, maximum: 90, required: true, description: '纬度' },
    longitude: { type: 'number', minimum: -180, maximum: 180, required: true, description: '经度' }
  }, additionalProperties: false
});
const geocodeOptions = () => ({
  locale: str('用户明确的结果语言，如 zh 或 en；缺省交由SDK读取系统语言，不让模型编造'),
  country: str('用户明确的ISO 3166-1 alpha-2国家码，如 CN；缺省交由SDK读取系统地区'),
  max_items: integer('用户明确要求的最多返回条数；未提使用SDK默认1', { minimum: 0, default: 1 })
});

export const systemCapabilities = [
  ...[
    ['level', 'batterySOC', '剩余电量百分比', 'number', ['还剩多少电','剩余电量','电量百分比','手机电量','电池电量'], { unit: 'percent', minimum: 0, maximum: 100 }],
    ['charging_status', 'chargingStatus', '电池充电状态', 'number', ['正在充电吗','充电状态','充满了吗'], { sdkType: 'BatteryChargeState' }],
    ['plugged_type', 'pluggedType', '连接充电器类型', 'number', ['充电器类型','无线充电还是有线','接了什么充电器'], { sdkType: 'BatteryPluggedType' }],
    ['health_status', 'healthStatus', '电池健康状态', 'number', ['电池健康状态','电池健康','电池是否过热'], { sdkType: 'BatteryHealthState' }],
    ['temperature', 'batteryTemperature', '电池温度', 'number', ['电池温度','电池多少度','电池热不热'], { unit: '0.1 Celsius' }],
    ['voltage', 'voltage', '电池电压', 'number', ['电池电压','多少微伏'], { unit: 'microvolt' }]
  ].map(([id, field, name, type, aliases, output]) => read(`device.battery.${id}`, 'device', 'batteryInfo', field, name, type, aliases, sources.battery, { returns: { type, nullable: true, shape: 'value', ...output }, since: 6, section: '属性' })),
  ...[
    ['model', 'productModel', '设备认证型号', ['手机型号','设备型号','这是什么型号']],
    ['manufacturer', 'manufacture', '设备厂商', ['设备厂商','手机厂家']],
    ['device_type', 'deviceType', '设备类型', ['设备类型','手机还是平板']],
    ['os_version', 'osFullName', '操作系统完整版本', ['系统版本','鸿蒙版本','操作系统版本']]
  ].map(([id, field, name, aliases]) => read(`device.info.${id}`, 'device', 'deviceInfo', field, name, 'string', aliases, sources.info, { since: 6, section: '属性' })),
  ...[
    ['width','width','默认屏幕宽度',['屏幕宽度','屏幕横向像素'], 'pixel'],
    ['height','height','默认屏幕高度',['屏幕高度','屏幕纵向像素'], 'pixel'],
    ['refresh_rate','refreshRate','默认屏幕刷新率',['屏幕刷新率','屏幕多少赫兹'], 'hertz'],
    ['density','densityDPI','默认屏幕像素密度',['屏幕像素密度','屏幕DPI'], 'dpi']
  ].map(([id, field, name, aliases, unit]) => read(`device.display.${id}`, 'device', 'Display', field, name, 'number', aliases, sources.display, { since: 7, section: 'display', returns: { type: 'number', nullable: true, shape: 'value', unit }, adapter: { acquire: 'display.getDefaultDisplaySync()', project: field } })),
  read('device.time.current', 'device', 'systemDateTime', 'getTime', '当前系统时间戳', 'number', ['现在几点','当前时间','系统时间戳'], sources.time, { support: 'official_method', since: 10, section: 'systemdatetimegettime', adapter: { method: 'systemDateTime.getTime', fixedArguments: { isNanoseconds: false } }, returns: { type: 'number', nullable: true, unit: 'milliseconds since Unix epoch' } }),
  read('device.time.timezone', 'device', 'systemDateTime', 'getTimezoneSync', '系统时区', 'string', ['系统时区','当前时区','设备时区'], sources.time, { support: 'official_method', since: 10, section: 'systemdatetimegettimezonesync' }),

  read('connectivity.network.available', 'connectivity', 'connection', 'hasDefaultNet', '当前是否有可用网络', 'boolean', ['有没有网络','网络连接了吗','是否有可用网络','联网状态'], sources.network, { support: 'official_method', since: 8, section: 'connectionhasdefaultnet', note: 'hasDefaultNet只表示默认数据网络是否可用，不保证公网连通或网站可访问；不能用此方法回答测速。' }),
  read('connectivity.network.capabilities', 'connectivity', 'NetCapabilities', '*', '网络能力信息', 'object', ['网络能力信息','网络能力详情'], sources.network, { aggregate: true, inputs: networkInputs(), since: 8, section: 'netcapabilities', adapter: { acquire: 'connection.getNetCapabilities({ netId: net_id })' } }),
  read('connectivity.network.bearer_types', 'connectivity', 'NetCapabilities', 'bearerTypes', '网络承载类型', 'array', ['用的是WiFi还是流量','网络类型','当前是无线还是移动网络'], sources.network, { inputs: networkInputs(), since: 8, section: 'netcapabilities', returns: { type: 'array', items: { type: 'number', sdkType: 'NetBearType' }, nullable: true, shape: 'list' }, adapter: { acquire: 'connection.getNetCapabilities({ netId: net_id })', project: 'bearerTypes' } }),
  read('connectivity.wifi.active', 'connectivity', 'wifiManager', 'isWifiActive', 'Wi-Fi开关状态', 'boolean', ['WiFi开了吗','无线网络开关','WiFi是否开启'], sources.wifi, { support: 'official_method', since: 9, section: 'wifimanageriswifiactive' }),
  read('connectivity.wifi.linked_info', 'connectivity', 'WifiLinkedInfo', '*', '当前Wi-Fi连接信息', 'object', ['WiFi连接信息','无线网络连接详情'], sources.wifi, { aggregate: true, since: 9, section: 'wifilinkedinfo', adapter: { acquire: 'wifiManager.getLinkedInfo()' } }),
  ...[
    ['ssid','ssid','当前Wi-Fi名称','string',['WiFi叫什么','WiFi名称','连接的无线网络名称']],
    ['rssi','rssi','当前Wi-Fi信号强度','number',['WiFi信号强度','无线信号','WiFi RSSI']],
    ['frequency','frequency','当前Wi-Fi频率','number',['WiFi频率','WiFi频段频率']],
    ['link_speed','linkSpeed','当前Wi-Fi上行链路速率','number',['WiFi链路速率','WiFi上行速率']],
    ['ip_address','ipAddress','当前Wi-Fi本机IP地址','number',['WiFi IP地址','无线IP地址','本机IP地址']]
  ].map(([id, field, name, type, aliases]) => read(`connectivity.wifi.${id}`, 'connectivity', 'WifiLinkedInfo', field, name, type, aliases, sources.wifi, { since: 9, section: 'wifilinkedinfo', adapter: { acquire: 'wifiManager.getLinkedInfo()', project: field }, note: '返回SDK原值；链路速率不是互联网测速。ipAddress是SDK数值，未来适配器可按官方规则显示为IPv4文本。' })),
  read('connectivity.bluetooth.state', 'connectivity', 'access', 'getState', '蓝牙开关状态', 'number', ['蓝牙开了吗','蓝牙状态','蓝牙开关状态'], sources.bluetooth, { support: 'official_method', since: 10, section: 'accessgetstate', returns: { type: 'number', sdkType: 'BluetoothState', nullable: true } }),

  read('location.current', 'location', 'Location', '*', '本机当前位置', 'object', ['我在哪里','当前位置','我的位置','本机位置'], sources.location, { aggregate: true, since: 9, section: 'geolocationmanagergetcurrentlocation', permissions: ['ohos.permission.APPROXIMATELY_LOCATION'], adapter: { acquire: 'geoLocationManager.getCurrentLocation()' } }),
  read('location.enabled', 'location', 'geoLocationManager', 'isLocationEnabled', '定位开关状态', 'boolean', ['定位开了吗','位置服务开了吗','定位开关'], sources.location, { support: 'official_method', since: 9, section: 'geolocationmanagerislocationenabled' }),
  ...[
    ['latitude','latitude','当前位置纬度',['当前纬度','我这里的纬度'], 'degree'],
    ['longitude','longitude','当前位置经度',['当前经度','我这里的经度'], 'degree'],
    ['accuracy','accuracy','当前定位精度',['定位精度','定位误差多少米'], 'meter'],
    ['altitude','altitude','当前位置海拔',['当前海拔','这里海拔多少'], 'meter'],
    ['speed','speed','当前定位速度',['当前移动速度','定位速度'], 'meter per second'],
    ['direction','direction','当前定位航向',['当前航向','定位方向'], 'degree'],
    ['timestamp','timeStamp','当前定位时间戳',['定位时间戳','位置更新时间'], 'milliseconds since Unix epoch']
  ].map(([id, field, name, aliases, unit]) => read(`location.current.${id}`, 'location', 'Location', field, name, 'number', aliases, sources.location, { since: 9, section: 'location', permissions: ['ohos.permission.APPROXIMATELY_LOCATION'], returns: { type: 'number', nullable: true, unit }, adapter: { acquire: 'geoLocationManager.getCurrentLocation()', project: field } })),
  read('location.geocode', 'location', 'geoLocationManager', 'getAddressesFromLocationName', '地址转地理坐标', 'array', ['地址转坐标','查询地址经纬度','地理编码'], sources.location, { support: 'adapter_contract', since: 9, section: 'geolocationmanagergetaddressesfromlocationname', inputs: { address: str('用户明确提供的地理地址/地点名称；不替用户猜目的地', { required: true, maxLength: 100 }), ...geocodeOptions() }, systemCapability: 'SystemCapability.Location.Location.Geocoder', returns: { type: 'array', items: { type: 'object', sdkType: 'GeoAddress' }, nullable: true, shape: 'list' }, adapter: { method: 'geoLocationManager.getAddressesFromLocationName', arguments: { address: 'request.description', locale: 'request.locale', country: 'request.country', max_items: 'request.maxItems' } } }),
  read('location.reverse_geocode', 'location', 'geoLocationManager', 'getAddressesFromLocation', '地理坐标转地址', 'array', ['坐标转地址','逆地理编码','当前位置地址','这里是什么地址'], sources.location, { support: 'adapter_contract', since: 9, section: 'geolocationmanagergetaddressesfromlocation', inputs: { coordinates: coordinates(), ...geocodeOptions() }, systemCapability: 'SystemCapability.Location.Location.Geocoder', returns: { type: 'array', items: { type: 'object', sdkType: 'GeoAddress' }, nullable: true, shape: 'list' }, adapter: { method: 'geoLocationManager.getAddressesFromLocation', arguments: { 'coordinates.latitude': 'request.latitude', 'coordinates.longitude': 'request.longitude', locale: 'request.locale', country: 'request.country', max_items: 'request.maxItems' } } }),

  ...[
    ['level','getVolumeByStream','音频流当前音量','number',['当前音量','音量多少','音乐音量','媒体音量']],
    ['min','getMinVolumeByStream','音频流最小音量','number',['最小音量','最低音量']],
    ['max','getMaxVolumeByStream','音频流最大音量','number',['最大音量','最高音量']],
    ['muted','isSystemMutedForStream','音频流静音状态','boolean',['音乐静音了吗','媒体静音了吗','音频流是否静音']]
  ].map(([id, field, name, type, aliases]) => read(`media.volume.${id}`, 'media', 'AudioVolumeManager', field, name, type, aliases, sources.volume, { support: 'adapter_contract', since: 20, section: `${field.toLowerCase()}20`, inputs: audioInputs(), adapter: { acquire: 'audio.getAudioManager().getVolumeManager()', method: field, arguments: { stream_type: 'audio.StreamUsage.STREAM_USAGE_<stream_type>' } }, note: '音量是SDK等级，不假定0-100百分比。stream_type是语义枚举，按官方StreamUsage映射。系统没有单一通用的“当前音量”；无明确流且无可信上下文时需要澄清。' })),
  read('media.ringer_mode', 'media', 'AudioVolumeGroupManager', 'getRingerModeSync', '系统铃声模式', 'number', ['手机是静音还是振动','铃声模式','静音模式','振动模式'], sources.group, { support: 'official_method', since: 10, section: 'getringermodesync10', returns: { type: 'number', sdkType: 'AudioRingMode', nullable: true }, adapter: { acquire: 'getVolumeGroupManager(DEFAULT_VOLUME_GROUP_ID)' } }),
  read('media.microphone.muted', 'media', 'AudioVolumeGroupManager', 'isMicrophoneMuteSync', '系统麦克风静音状态', 'boolean', ['麦克风静音了吗','麦克风是否被静音'], sources.group, { support: 'official_method', since: 10, section: 'ismicrophonemutesync10', adapter: { acquire: 'getVolumeGroupManager(DEFAULT_VOLUME_GROUP_ID)' } }),
  read('media.output_devices', 'media', 'AudioRoutingManager', 'getDevices', '当前可用音频输出设备列表', 'array', ['可用音频输出设备','有哪些音频输出设备','音频设备列表'], sources.routing, { support: 'official_method', since: 9, section: 'getdevices9', returns: { type: 'array', items: { type: 'object', sdkType: 'AudioDeviceDescriptor' }, nullable: true, shape: 'list' }, adapter: { acquire: 'audio.getAudioManager().getRoutingManager()', fixedArguments: { deviceFlag: 'OUTPUT_DEVICES_FLAG' } }, note: '查询可用输出设备列表，不等于当前正在播放的路由；不包含其他应用歌曲或播放会话。' })
];
