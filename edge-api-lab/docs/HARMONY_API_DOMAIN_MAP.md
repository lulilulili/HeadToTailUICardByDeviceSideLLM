# 10 领域单服务验证：鸿蒙高频能力映射

范围冻结于 2026-10-11。保留天气、日历、联系人、文件、服务入口、云端业务，增加设备状态、网络连接、位置服务、音频媒体，共 10 个领域。此次新增 45 个只读伪API，均属于一次业务请求、一个API的验证，不包含跨领域组合服务。

鸿蒙入口是[能力与 API 文档中心](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/ability-kit)。按用户截图的应用框架、系统、媒体、应用服务筛选高频能力。官方类别不等于业务领域：例如设备状态横跨 Basic Services Kit 和 ArkUI，音频媒体以 Audio Kit 为主。不要仅按 Kit 名称推断业务领域。

当前 Huawei 页面使用动态加载；本次浏览时部分页面只能取得目录壳。`sourceRef`保留对应 Huawei API 页面，`verificationRef`记录可读取的 OpenHarmony 官方文档用于交叉核对原生字段与签名。两者不能代替目标 HarmonyOS SDK 上的设备支持、版本、权限核验。代码的 `source.verification` 明确记录了这一限制。新增项不包含 Windows 本机状态代替鸿蒙结果，也不声称已经调用真实 SDK。

| 新领域 | 单服务伪API | 映射的原生字段/方法 | 真实入参边界 |
| --- | --- | --- | --- |
| device（16） | battery.level / charging_status / plugged_type / health_status / temperature / voltage | batteryInfo.batterySOC / chargingStatus / pluggedType / healthStatus / batteryTemperature / voltage | 无用户入参；电量、温度、电压都是输出 |
| device | info.model / manufacturer / device_type / os_version | deviceInfo.productModel / manufacture / deviceType / osFullName | 当前设备属性，无用户入参 |
| device | display.width / height / refresh_rate / density | getDefaultDisplaySync()取得Display，再读width / height / refreshRate / densityDPI | 固定本机默认显示设备 |
| device | time.current / timezone | systemDateTime.getTime(false) / getTimezoneSync() | 时间戳固定毫秒；当前时区，无用户入参 |
| connectivity（11） | network.available | connection.hasDefaultNet() | 无用户入参；默认网络可用不代表网站一定可访问 |
| connectivity | network.capabilities / bearer_types | connection.getNetCapabilities(NetHandle) / NetCapabilities.bearerTypes | 明确net_id优先；缺省由getDefaultNet()取得默认网络 |
| connectivity | wifi.active / linked_info / ssid / rssi / frequency / link_speed / ip_address | isWifiActive()；getLinkedInfo()的WifiLinkedInfo字段 | 当前设备Wi-Fi；不是搜索任意Wi-Fi或测速 |
| connectivity | bluetooth.state | access.getState() | 查询开关，未增加开启/关闭操作 |
| location（11） | current / enabled | getCurrentLocation() / isLocationEnabled() | 当前设备定位或定位开关，无目的地输入 |
| location | current.latitude / longitude / accuracy / altitude / speed / direction / timestamp | Location相应字段，timestamp投影timeStamp | 当前定位数据，输出值不当入参 |
| location | geocode | getAddressesFromLocationName(GeoCodeRequest) | address映射description；支持locale、country、max_items |
| location | reverse_geocode | getAddressesFromLocation(ReverseGeoCodeRequest) | 完整WGS84坐标优先；完全缺省时可用授权当前位置；支持locale、country、max_items |
| media（7） | volume.level / min / max / muted | AudioVolumeManager.getVolumeByStream / getMinVolumeByStream / getMaxVolumeByStream / isSystemMutedForStream | stream_type映射StreamUsage；未提时需可信当前音频上下文 |
| media | ringer_mode / microphone.muted | 默认音量组getRingerModeSync() / isMicrophoneMuteSync() | 无用户入参 |
| media | output_devices | AudioRoutingManager.getDevices(OUTPUT_DEVICES_FLAG) | 固定输出设备标记；返回可用列表，未声明正在播放的路由 |

## 参数提取与系统补参

小模型只提取用户明确表达的参数，Schema对“缺少信息”允许稀疏输出。执行准备阶段才检查业务必需字段和获取环境值。

1. 用户说“网络ID 37用的是Wi-Fi还是流量”，提取 `{ "net_id": 37 }`，不得改用默认网络。
2. 用户只问“现在用的是Wi-Fi还是流量”，抽取 `{}`，由 `system_default_network` 获取本机默认网络句柄；不能让模型猜 `net_id`。
3. 用户说“音乐音量是多少”，提取 `{ "stream_type": "MUSIC" }`。只说“音量是多少”时，没有通用的单一系统“当前音量”API，需要可信当前音频流上下文；缺少上下文时澄清，不默认音乐流。
4. 用户给出完整经纬度，逆地理编码严格保留坐标。完全未给坐标时 `system_coordinates` 可读取授权当前位置；只给一个分量时必须澄清，不能拼接当前位置的另一个分量。
5. 用户问“电池温度是多少”，抽取 `{}`，投影batteryTemperature；文本中的猜测温度、电量不是此只读API的输入。电池健康状态是状态枚举，不是容量健康百分比。

| resolver ID | 所需可信上下文 | 将来鸿蒙获取方式 | 失败策略 |
| --- | --- | --- | --- |
| system_default_network | 默认网络句柄netId | connection.getDefaultNet()，需要GET_NETWORK_INFO | 环境失败，不猜网络ID |
| system_audio_stream | 当前明确的音频业务流 | 应用持有的音频上下文/可信系统适配器；不存在通用万能当前流getter | 缺省失败或澄清，不默认为MUSIC |
| system_coordinates | 授权本机当前位置 | geoLocationManager.getCurrentLocation()；APPROXIMATELY_LOCATION，精确定位按SDK要求另核验 | 未授权/超时失败；不得伪造定位 |

无入参API直接声明本机当前对象的数据获取计划；不在模型提示词中填入“电量80”等输出。伪执行的 `value` 为 `null`。网络、坐标、流类型的固定夹具必须标记 `fixture`，不能标记真实系统来源。SDK默认的locale/country交由适配器处理；地理编码最大返回条数的默认1来自官方请求结构。

当前位置中的“本机”指未来运行应用的手机，不是开发电脑。现阶段只使用明确标记为 `fixture` 的手机位置mock，不读取PC或浏览器定位；未来由鸿蒙真机宿主获取手机授权定位。当前只是系统依赖契约与模拟验证，不代表已取得真实手机位置。

## 原生参考

- 电池：[Huawei batteryInfo](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/js-apis-battery-info)，[OpenHarmony官方交叉核对](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/reference/apis-basic-services-kit/js-apis-battery-info.md)。batteryTemperature单位为0.1摄氏度，voltage为微伏，保留SDK原值。
- 设备：[Huawei deviceInfo](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/js-apis-device-info)，[官方字段表](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/reference/apis-basic-services-kit/js-apis-device-info.md)。本次未加入系统权限限制的UDID/序列号。
- 显示：[Huawei display](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/js-apis-display)，[官方Display结构](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/reference/apis-arkui/js-apis-display.md)。屏幕属性归用户截图的应用框架。
- 时间：[Huawei systemDateTime](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/js-apis-date-time)，[官方日期时间签名](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/reference/apis-basic-services-kit/js-apis-date-time.md)。使用getTime/getTimezoneSync，避免已废弃的systemTime接口。
- 网络：[Huawei connection](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/js-apis-net-connection)，[官方网络接口](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/reference/apis-network-kit/js-apis-net-connection.md)。bearerTypes为原生枚举数组。
- Wi-Fi：[Huawei wifiManager](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/js-apis-wifimanager)，[官方WifiLinkedInfo](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/reference/apis-connectivity-kit/js-apis-wifiManager.md)。RSSI单位dBm；IP地址返回number，需要显示转换；linkSpeed是链路速率，不能当作互联网测速结果。
- 蓝牙：[Huawei access](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/js-apis-bluetooth-access)，[官方蓝牙开关接口](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/reference/apis-connectivity-kit/js-apis-bluetooth-access.md)。读取状态与修改开关是不同能力。
- 位置：[Huawei geoLocationManager](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/js-apis-geolocationmanager)，[官方请求/返回结构](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/reference/apis-location-kit/js-apis-geoLocationManager.md)。地理编码返回GeoAddress列表，不假设结果唯一。
- 音量：[Huawei AudioVolumeManager](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/arkts-apis-audio-audiovolumemanager)，[官方API20接口](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/reference/apis-audio-kit/arkts-apis-audio-AudioVolumeManager.md)，[官方StreamUsage枚举](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/reference/apis-audio-kit/arkts-apis-audio-e.md)。音量是SDK等级，不预设百分比；VOICE_COMMUNICATION对应通话，不虚构VOICE_CALL枚举。
- 铃声/麦克风：[Huawei AudioVolumeGroupManager](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/arkts-apis-audio-audiovolumegroupmanager)，[官方音量组接口](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/reference/apis-audio-kit/arkts-apis-audio-AudioVolumeGroupManager.md)。默认音量组的取得由未来适配器实现。
- 输出设备：[Huawei AudioRoutingManager](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/arkts-apis-audio-audioroutingmanager)，[官方设备列表接口](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/reference/apis-audio-kit/arkts-apis-audio-AudioRoutingManager.md)。未加入读取其他应用歌曲/播放会话的假设。

## 评测边界

新增 `data/cases-system-single.json` 为40条开发验证用例，每个新领域10条，统一 `suite: single-service-v1`。每条只有一个期望API，覆盖明确参数、完全未提参数的系统补参、输出字段与入参分离，以及电池温度/天气气温、位置查询/天气地点参数的领域边界。

新增契约测试检查原生字段、类型、引用、坐标边界和稀疏输入，不证明模型已经达到特定正确率。10领域能力目录增加了路由干扰项；四模型的新评测应单独出报告，不与旧6领域开发集的百分比直接比较。当前允许从多个领域、多个候选API中选择一个单服务API；单次请求跨域/多API编排留待二阶段，包括天气+日程+通勤等组合服务。
