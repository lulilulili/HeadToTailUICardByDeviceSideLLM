# HarmonyOS 应用服务 Kit API 扁平化与主动服务可行性报告

> 研究日期：2026 年 10 月 10 日  
> 研究范围：华为开发者文档中“应用服务”目录下的 28 个 Kit 及其公开 ArkTS、C、REST API 入口  
> 目标：判断 Codex 在开发阶段批量生成业务语义 API 层的可行性，并评估这些能力是否足以构建预测用户行为的主动服务

## 一 结论摘要

### 1 API 扁平化总体可行，但不建议做成官方接口的一比一薄封装

Codex 可以在开发阶段读取官方文档、类型声明和示例代码，生成统一的能力描述、参数模型、适配器、错误映射、模拟实现和测试。技术上，28 个 Kit 都可以纳入同一条生产线。

但“全部 API 都生成一个同名直达接口”的收益有限。官方 API 中混合了查询、组件、扩展 Ability、回调、服务端接口、支付流程、合作伙伴接口和受限权限接口。若只消除调用层级，运行时模型仍要理解大量平台概念，也容易绕开前台界面、权限申请和用户确认等必要流程。

更合适的产物是**业务能力层**。一个能力不只包含调用函数，还要包含：

- 业务名称和适用场景；
- 输入参数及默认值来源；
- 设备类型、系统版本和地区限制；
- 权限、用户授权、前台界面和合作伙伴条件；
- 是否允许后台执行；
- 风险等级和是否必须二次确认；
- 幂等规则、超时、重试和统一错误码；
- 返回给模型的稳定数据结构；
- 官方文档版本和生成代码版本。

因此，结论是：**Codex 做能力生产线可行，而且适合平台团队；全量一比一封装可行但价值不高。应按高价值场景反推能力，先覆盖业务动作，再逐步扩充底层 API。**

### 2 主动服务可行，但 28 个应用服务 Kit 不是完整闭环

应用服务目录已经具备主动服务最重要的一组拼图：

- **上下文和触发信号**：位置与围栏、日历、天气、健康数据、钱包凭证、Push 业务事件；
- **信息加工与执行**：地图搜索和路线、联系人、文件和文档、账号、分享、支付和应用内支付；
- **前台呈现**：实况窗、通知、场景化组件、应用链接；
- **端云基础设施**：云函数、云数据库、云存储和 Push。

但是，要实现“持续感知环境并预测下一步需求”，还需要应用服务目录之外的系统能力：

- Background Tasks Kit：受系统调度约束的后台任务；
- Basic Services Kit：时间、设备、电量等基础状态；
- Multimodal Awareness Kit：运动、设备状态和用户状态感知；
- Connectivity Kit 与系统公共事件：蓝牙、Wi-Fi、USB、屏幕、电量和网络变化；
- Intents Kit：把能力注册为标准或自定义意图；
- Form Kit 或其他桌面入口：长驻服务卡片；
- 本地行为历史与反馈存储：形成个性化，而不是每次独立判断。

因此，准确表述不是“这些 API 已经足以直接做一个主动助手”，而是：**应用服务 Kit 已经能构成第一批高价值场景的业务闭环；若要做通用的预测式主动服务，还需要系统感知、后台调度、权限治理和用户反馈四层能力。**

### 3 最值得优先验证的场景

优先级建议如下：

1. **通勤出发助手**：日历、位置围栏、天气、地图、实况窗和通知组成完整闭环，价值清晰，合作方依赖较少。
2. **会议准备助手**：根据日历时间和地点准备路线、资料、联系人和会议入口，适合体现跨 Kit 编排。
3. **出行凭证助手**：结合钱包出行凭证、日历、位置、天气和实况窗，在航班、火车、酒店、活动票券场景提供高价值服务。
4. **运动建议助手**：结合天气、健康数据、位置和空闲日程，给出室内或户外运动建议。
5. **文件预取与阅读助手**：在会议或行程前准备云端文件、PDF 和预览入口，降低用户查找成本。

“上班地铁二维码”是一个正确的高价值场景方向，但目前公开 Wallet Kit 的交通卡能力面向 NFC 交通卡生态合作伙伴，覆盖开卡、查询、充值、更新和删卡，不是通用的地铁二维码读取接口。可落地的替代路径是：

- 有运营方 API 时，通过三方 API、MCP 或服务端接入二维码；
- 有应用深链时，通过 App Linking、Intents 或场景化按钮直达乘车码页面；
- 无开放接口时，只能预判并展示“打开乘车码”的快捷入口，不能声称系统能直接取得二维码。

## 二 研究口径和判断标准

### 1 官方目录范围

华为当前开发者文档的“应用服务”目录包含 28 个 Kit：Account、Ads、AppGallery、App Linking、Calendar、Call Service、Cloud Foundation、Contacts、Enterprise Space、File Manager Service、Health Service、IAP、Game Controller、Game Service、Live View、Location、Map、Notification、Payment、PDF、Preview、Push、Reader、Scenario Fusion、Screen Time Guard、Share、Wallet 和 Weather Service。

本报告检查的是每个 Kit 的公开 API 入口和主要模块族，不逐条抄录每个类、重载、字段和错误码。对扁平化工程而言，模块类型、调用流程、授权要求、设备版本、服务端依赖和风险等级比函数数量更重要。

官方目录：[HarmonyOS 开发者文档 应用服务](https://developer.huawei.com/consumer/cn/doc/)

### 2 评估等级

| 维度 | A | B | C | D |
|---|---|---|---|---|
| 扁平化适配 | 输入输出稳定，可直接生成业务动作 | 需要组合多个 API 或处理生命周期 | 强依赖 UI、授权、服务端或合作资质，只能生成受控流程 | 能封装但平台化收益低，适合垂直业务单独接入 |
| 主动服务价值 | 可作为核心信号或核心执行能力 | 可作为重要辅助能力 | 只适合用户确认后的执行或特定垂类 | 与通用主动服务关系较弱 |

### 3 主动服务中的四类角色

| 角色 | 定义 | 典型 Kit |
|---|---|---|
| 感知 | 提供时间、位置、状态、事件或用户数据 | Calendar、Location、Weather、Health、Wallet、Push |
| 决策支持 | 把上下文转换为路线、地点、文档或业务数据 | Map、Contacts、Cloud Foundation、PDF、Reader |
| 执行 | 完成登录、分享、通话、支付、购买、文件操作等动作 | Account、Share、Call、Payment、IAP、File Manager |
| 呈现 | 将预测结果放到用户容易看到和操作的位置 | Live View、Notification、Scenario Fusion、App Linking |

## 三 28 个 Kit 的 API 和可行性评估

### 1 Account Kit 到 Game Service Kit

| 序号 | Kit 和官方 API | 主要公开模块或接口族 | 建议生成的业务能力 | 扁平化 | 主动服务 | 关键约束 |
|---:|---|---|---|:---:|:---:|---|
| 1 | [Account Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/account-api) | `authentication`、`extendService`、`shippingAddress`、`minorsProtection`、`invoiceAssistant`、`realName`、`intimate`，登录组件及 REST API | 登录并取得用户授权资料、选择收货地址、选择发票抬头、实名状态检查、亲密圈相关服务 | B | B | 高敏感个人信息；部分能力必须使用系统组件或明确授权，不能静默读取 |
| 2 | [Ads Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/ads-api) | `advertising`、`oaid`、广告 ExtensionAbility、广告展示组件 | 请求广告、展示广告、查询广告能力状态 | B | D | 主要用于商业变现，不应作为用户行为预测信号；OAID 不能被误作通用用户画像标识 |
| 3 | [AppGallery Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/store-api) | `moduleInstallManager`、`productViewManager`、`sceneManager`、`updateManager`、`attributionManager`、`privacyManager`、`appInfoManager`、`commentManager`，C API 与归因 REST API | 检查更新、打开应用详情、按需安装模块、查询进入场景、管理隐私协议状态 | B | B | 安装、升级、评论等通常需要用户可见流程；归因和隐私数据不能混入个性化画像 |
| 4 | [App Linking Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/app-linking-api) | `deferredLink` | 解析延迟链接、直达应用页面或应用市场 | A | B | 更像执行入口而不是感知源；目标应用和链接必须存在 |
| 5 | [Calendar Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/calendar-api) | `calendarManager` | 查询下一日程、创建日程、更新日程、设置提醒、提取会议地点和服务入口 | A | A | 读取和写入均需用户授权；写入、修改、删除应由用户确认。官方权限包括 `READ_CALENDAR` 和 `WRITE_CALENDAR` |
| 6 | [Call Service Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/call-api) | `voipCall`、`CallerInfoQueryExtensionAbility`、`numberIdentify` | 准备或发起 VoIP 通话、查询来去电信息、号码识别 | C | C | 面向 VoIP 和号码识别垂类；通话属于高打扰动作，必须由用户确认，部分能力可能有准入要求 |
| 7 | [Cloud Foundation Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/cloud-foundation-api) | `cloudCommon`、`cloudFunction`、`cloudStorage`、`cloudDatabase`、`cloudResPrefetch` | 调用云函数、读写业务数据、获取文件、预取资源、同步个性化配置 | A | B | 它是基础设施而非端侧信号；需网络、鉴权、数据合规和服务成本治理 |
| 8 | [Contacts Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/contacts-api) | `contact` | 查找联系人、生成联系人候选、创建或更新联系人 | A | B | 通讯录是敏感数据；查询要最小化，写入和拨号前需确认，不应把全量通讯录发送给模型 |
| 9 | [Enterprise Space Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/enterprise-space-api) | `fileTransfer`、`spaceManager` | 企业空间切换、受控文件传输、企业策略下的资料准备 | B | C | 当前主要面向 PC/2in1 和企业 IT 管控场景，设备范围和组织策略限制明显 |
| 10 | [File Manager Service Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/file-manager-service-api) | `fileManagerService` | 获取文件图标、在文件管理器中定位文件、移入回收站等 | B | B | 删除或移动属于状态变更；需限定文件范围，进入回收站也应提示用户 |
| 11 | [Health Service Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/health-service-api) | `healthStore`、`healthService`、健康数据类型和模型、运动与健康记录辅助模块，含 Lite 版本 | 查询步数、睡眠、锻炼和健康记录，订阅数据变化，生成运动建议 | B | A | 需要用户授权，应用可操作范围受服务审批与用户授权交集限制；健康建议不能越界为医学诊断 |
| 12 | [IAP Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/iap-api) | `iap`、收银台组件、订单和订阅 REST API | 查询商品和订单、准备购买、打开收银台、查询订阅状态、处理发货和退款事件 | C | C | 支付界面和服务端验签不可省略；模型只能准备交易，不能静默购买或退款 |
| 13 | [Game Controller Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/game-controller-api) | C API `GameController`，手柄设备、按键和轴事件 | 查询手柄、监听手柄输入、映射控制能力 | D | D | 游戏垂类能力，C API 和实时事件模型不适合纳入通用自然语言能力库首批范围 |
| 14 | [Game Service Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/game-service-api) | `gamePlayer`、`gamePerformance`、`gameNearbyTransfer`，C API 和玩家标识 REST API | 玩家登录、性能场景配置、近场快传、玩家标识管理 | C | D | 对通用主动助手价值低；在游戏内可做主动性能调优和附近传输提示 |

### 2 Live View Kit 到 Weather Service Kit

| 序号 | Kit 和官方 API | 主要公开模块或接口族 | 建议生成的业务能力 | 扁平化 | 主动服务 | 关键约束 |
|---:|---|---|---|:---:|:---:|---|
| 15 | [Live View Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/live-view-api) | `liveViewManager`、锁屏和卡片 ExtensionAbility 与 Context | 创建、更新和结束订单、行程、赛事、倒计时等实况服务 | B | A | 本地创建要求前台及用户已经订阅相关服务；后续更新通常与 Push 配合，不能把它当任意后台弹窗 |
| 16 | [Location Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/location-api) | `geoLocationManager`、`FenceExtensionAbility`、`FenceExtensionContext`，C API | 获取当前地点、地理编码、反向地理编码、设置围栏、接收进入或离开事件 | B | A | 前后台定位权限不同；围栏 ExtensionAbility 可用模块受限。围栏回调适合触发轻量判断和通知，不适合承载完整系统编排 |
| 17 | [Map Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/map-api) | `map`、`mapCommon`、`navi`、`sceneMap`、`site`、`staticMap`、Petal Maps 拉起和离线地图相关能力 | 地点搜索、地址转坐标、路线规划、导航入口、静态地图 | B | A | 地图展示和导航常需要前台；天气等 API 只接受坐标时，可由本 Kit 完成城市名到坐标的组合解析 |
| 18 | [Notification Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/notification-api) | `notificationManager`、`notificationExtensionSubscription`、通知订阅 ExtensionAbility、通知数据模型，C API | 发布和管理本应用通知、提供动作按钮、申请通知订阅扩展授权 | B | A | 普通应用可稳定依赖的是本应用通知。不能因为存在订阅接口，就默认能静默读取和聚类所有应用通知；跨应用订阅要单独核验授权、系统版本和上架政策 |
| 19 | [Payment Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/payment-api) | `paymentService`、`realNameService`、`ecnyPaymentService`、`thirdPaymentService`、`promotionService`，券和订单 REST API | 创建支付意图、预下单、打开支付、查询订单、退款、领券和核销 | C | C | 实体商品和服务支付涉及商户、服务端、实名、支付渠道和用户确认；预测系统只能推荐或预填，不得自动付款 |
| 20 | [PDF Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/pdf-api) | `pdfService`、`pdfViewManager`、`PdfView` | 打开 PDF、定位页面、添加批注、水印、背景和书签 | B | B | 编辑会改变文档，需区分只读预览和写操作；来源文件访问权限需校验 |
| 21 | [Preview Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/preview-api) | `filePreview`、C API `Preview`，已废弃的 `openFileBoost` | 预览文件、预取预览资源 | A | B | 适合会议资料预热；需避免依赖已废弃接口，校验 URI 和文件权限 |
| 22 | [Push Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/push-api) | AAID、`pushCommon`、`pushService`、Push 和 RemoteNotification ExtensionAbility、服务通知，场景消息和回执 REST API | 接收业务事件、推送服务状态、撤回消息、取得回执、驱动实况窗更新 | B | A | 依赖服务端和推送通道；Push 是业务事件源，不等于端侧任意后台运行能力；消息频控和隐私策略必须纳入能力元数据 |
| 23 | [Reader Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/reader-api) | `bookParser`、`readerCore`、阅读组件 | 解析电子书、打开章节、恢复阅读位置、生成阅读入口 | B | B | 更适合内容消费垂类；需要本地阅读历史才能预测下一步阅读需求 |
| 24 | [Scenario Fusion Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/scenario-fusion-api) | `atomicService`、`fileUriService`、`FunctionalButton`、`FunctionalInput` 及管理组件 | 生成直达按钮、地址或发票填充、地图选点、文件路径转换、服务入口 | B | A | 很适合承担预测结果的可执行 UI；部分能力以组件交互为中心，不能简化为无界面的后台函数 |
| 25 | [Screen Time Guard Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/screen-time-guard-api) | `guardService`、`appPicker`、`TimeGuardExtensionAbility`、`TimeGuardExtensionContext` | 创建或管理屏幕时间守护策略、选择受控应用、响应策略生效或授权变化 | C | C | 需用户明确授权，适合专注或家庭守护垂类；扩展进程轻量且不能唤醒主进程，不是通用应用使用行为采集接口 |
| 26 | [Share Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/share-api) | `systemShare`、`harmonyShare` | 准备分享内容、打开系统分享、华为分享 | B | B | 分享对象和最终发送通常需要用户选择；模型可准备内容，不应无确认发送 |
| 27 | [Wallet Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/wallet-api) | `walletPass`、`walletTransitCard`，车钥匙、园区卡、会员卡、酒店房卡、出行凭证、活动门票和通用凭证 REST API | 查询和准备凭证、展示票券、更新行程凭证、管理合作方 NFC 交通卡 | C | A | 只支持手机；多类能力需要生态合作、服务端和安全资质。交通卡是 NFC 生态能力，不是任意城市地铁二维码 API |
| 28 | [Weather Service Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/weather-service-api) | `weatherService`，核心为 `getWeather` 和带 Context 的调用，支持实况、逐日、逐小时、分钟级、预警、指数、潮汐和城市信息等数据集 | 查询当前天气、未来天气、预警、生活指数、潮汐，生成出行参数 | A | A | 天气请求需要坐标；“上海今天的天气”需先解析城市并通过地理编码取得经纬度，再请求天气。日期“今天”由本地时区解析，不必交给天气 API |

## 四 Codex API 扁平化的正确实现方式

### 1 扁平化对象不是函数而是业务动作

建议把官方 API 转换为三层：

```text
官方 SDK 与 REST API
        ↓
稳定适配层 设备版本 权限 生命周期 错误码
        ↓
业务能力层 查询天气 规划路线 准备会议 打开票券
        ↓
Jev 领域与能力选择 生成式端侧模型参数提取 确定性执行器
```

官方 API 的变化由适配层消化，运行时模型只看到少量稳定的业务动作。这样既能降低 token 和时延，也能避免端侧模型理解 `ExtensionAbility`、`Context`、回调、组件生命周期等平台细节。

### 2 每个能力必须具备的元数据

```yaml
capability_id: travel.weather.query
display_name: 查询指定地点天气
domain: travel_weather

inputs:
  location_text:
    type: string
    required: false
    default_resolver: current_location
  date:
    type: local_date
    required: false
    default_resolver: today_in_device_timezone
  datasets:
    type: enum_array
    default: [CURRENT, DAILY]

preconditions:
  min_system_version: 5.0.0
  device_types: [phone, tablet, 2in1, wearable]
  permissions: []
  network_required: true

plan:
  - resolve_place_to_coordinates
  - weatherService.getWeather

risk:
  level: read_only
  confirmation: none

output_schema:
  location: string
  observation_time: datetime
  temperature_c: number
  condition: string
  alerts: array

provenance:
  official_doc: https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/weather-service-weatherservice
  generated_at: 2026-10-10
```

这个清单解决了原始设想中的关键问题：用户未说明地点时，系统可以按策略使用当前位置；用户说“上海”时，先做地理编码；用户说“今天”时，确定性时间解析器直接得到日期。端侧生成模型只负责从原始提示词提取显式参数，不负责猜 SDK 调用细节。

### 3 Codex 能力生产线

建议让 Codex 在开发阶段执行以下流水线：

1. 获取官方 API 根目录、具体文档、类型声明和示例代码，并记录版本和内容摘要。
2. 建立 API 图谱，识别模块、函数、组件、扩展 Ability、REST 接口、错误码和权限。
3. 按业务目标合并底层调用，生成稳定的能力 ID、输入输出 Schema 和默认参数解析器。
4. 生成 ArkTS、C 或服务端适配器，以及模拟实现和统一错误映射。
5. 生成权限、设备版本、前后台限制、地区、合作资质和用户确认策略。
6. 自动编译、静态检查，并基于官方示例和构造用例生成单元测试与集成测试。
7. 对支付、账号、联系人、健康、钱包和文件修改等高风险能力做人工审核。
8. 进入版本化能力注册表，供 Jev 和端侧模型使用。

Codex 适合自动化文档整理、重复适配代码和测试生成，但不能替代以下判断：

- 某项受限权限是否能够申请并通过上架审核；
- 钱包、交通卡、支付、实名等能力是否取得生态合作资质；
- 某个 UI 流程是否允许被跳过；
- 隐私告知、用户授权和数据保存是否满足公司合规要求；
- 主动服务的打扰强度是否符合产品体验要求。

### 4 运行时模型分工

此前提出的 Jev 与生成式端侧模型分工是合理的：

```text
原始提示词
   ↓
Jev 或 Laya 领域识别
   ↓
Jev 或 Laya 在领域内选择业务能力
   ↓
生成式端侧模型仅依据该能力的参数 Schema 抽取显式参数
   ↓
确定性解析器补全今天 当前地点 当前账号等默认值
   ↓
权限与风险门禁
   ↓
适配器执行并返回统一业务数据
```

这比让一个生成式模型同时阅读全部 API、决定调用链并生成参数更适合端侧：候选集合更小，输出空间受限，token 更少，也更容易测量每一层的准确率。

需要增加两个限制：

- Jev 不应一次在全部底层接口中选择。先选领域，再在该领域的 5 到 20 个业务能力中选择，必要时返回“不确定”。
- 高风险动作不能因为分类置信度高就直接执行。模型只负责理解意图，权限、确认和执行策略由确定性代码决定。

## 五 从提示词服务扩展到预测式主动服务

### 1 两种服务模式应共用能力层但使用不同输入

**提示词模式**从用户原始文本开始，适合“上海今天的天气怎么样”“帮我看看下一场会议在哪”等请求。

**主动模式**没有原始提示词。它从系统事件和用户历史开始，例如：

```json
{
  "event": "LEAVE_HOME_WINDOW",
  "local_time": "07:42",
  "weekday": true,
  "next_calendar_event": {
    "type": "work",
    "start_in_minutes": 68,
    "location": "公司"
  },
  "weather_alert": "RAIN_IN_45_MINUTES",
  "commute_pattern": "metro",
  "confidence": 0.91
}
```

对这种结构化输入，不必先改写成一段自然语言再让大模型解析。可以由规则和轻量排序模型生成候选服务，再让 Jev 或 Laya 在有限候选中做选择或打分。生成式模型只在地点别名、日程文本、消息文本等非结构化字段中参与。

### 2 主动服务闭环

```text
系统事件和业务事件
        ↓
上下文归一化与本地特征
        ↓
规则召回和候选服务生成
        ↓
Jev 或 Laya 排序 选择 拒识
        ↓
参数解析和默认值补全
        ↓
权限 风险 前后台策略
        ↓
查询或准备动作
        ↓
实况窗 通知 卡片 直达按钮
        ↓
点击 忽略 关闭 完成等反馈
        ↓
个性化策略更新
```

第一阶段可以用“规则召回加模型排序”，不必一开始就训练复杂的用户行为预测模型。只要持续记录触发条件、展示、点击、关闭、完成和重复使用，就能逐步从固定规则过渡到个性化排序。

### 3 应用服务之外必须补充的能力

| 缺口 | 为什么重要 | 官方能力方向 |
|---|---|---|
| 后台触发 | 应用退到后台后会被挂起，不能依靠常驻进程持续轮询 | Background Tasks Kit 的延迟任务、短时任务和合规长时任务 |
| 设备与环境状态 | 蓝牙、Wi-Fi、电量、屏幕和连接状态是预测的重要信号 | Connectivity Kit、Basic Services Kit、系统公共事件 |
| 用户与设备状态 | 行走、静止、驾车等状态能提高场景判断准确率 | Multimodal Awareness Kit、Sensor Service Kit |
| 系统意图入口 | 让能力被系统 AI 入口检索和执行 | Intents Kit 和 Ability Kit 的意图装饰器 |
| 长期反馈 | API 只提供当前数据，预测需要用户历史 | 本地数据库、端云同步、隐私预算和数据过期策略 |

官方延迟任务会受系统统一调度和应用活跃度约束。公开指南示例中，重复任务最小间隔为 2 小时，单次回调最长运行 2 分钟，系统还会根据功耗、温度和使用频率延迟或禁止调度。因此，主动服务应优先使用日历提醒、位置围栏、Push、健康订阅等事件驱动方式，而不是高频后台轮询。

## 六 高价值主动服务场景

### 1 推荐场景清单

| 场景 | 触发与上下文 | 主要能力 | 主动呈现 | 价值 | 可行性与边界 |
|---|---|---|---|---|---|
| 通勤出发助手 | 工作日、常用离家时段、下一日程在公司、天气变化 | Calendar、Location、Weather、Map | 通知或实况窗，包含天气、预计路程和快捷入口 | 高频且能节省操作 | 高。若要显示乘车码，需要运营方接口或深链；否则只提供直达入口 |
| 降雨出门提醒 | 围栏将离家、短时降雨或预警 | Location、Weather、Notification | “45 分钟内有雨，建议带伞”及路线入口 | 信息及时且模型负担低 | 很高。以事件和确定性规则为主即可 |
| 会议准备助手 | 日程开始前、用户尚未到达会议地点 | Calendar、Location、Map、Contacts、Cloud、Preview、PDF | 路线、参会人、会议入口和资料卡片 | 跨 Kit 组合价值高 | 高。资料访问需限定到用户已授权的文件 |
| 航班或火车出行助手 | 出行凭证、日程、出发时间、当前位置、天气 | Wallet、Calendar、Location、Map、Weather、Push、Live View | 证件和票券入口、出发倒计时、路线、天气 | 低频但高价值 | 高。凭证需要对应服务方接入，实时状态常由 Push 更新 |
| 酒店入住助手 | 临近入住时间并到达酒店附近 | Wallet、Calendar、Location、Map、Live View | 房卡或预订入口、导航、入住信息 | 操作链短，体验明显 | 中高。数字房卡需酒店和钱包生态合作 |
| 活动门票助手 | 活动开始前、接近场馆 | Wallet、Calendar、Location、Map、Live View | 门票、座位、入场口和路线 | 高时效、高价值 | 中高。票券数据由服务方提供 |
| 户外运动建议 | 空闲日程、适宜天气、历史运动习惯 | Health、Weather、Calendar、Location | 运动建议和开始入口 | 能体现个性化 | 中高。建议不应构成医学结论 |
| 异常久坐或恢复提醒 | 健康数据或设备状态达到用户设定阈值 | Health、Notification、Live View | 轻提醒和一键开始活动 | 高频健康价值 | 中。必须允许用户配置频率并降低打扰 |
| 会议资料预取 | 会议即将开始且日程含文件或云端入口 | Calendar、Cloud Foundation、PDF、Preview | 已准备资料列表 | 减少查找和等待 | 高。后台下载受任务与网络约束，优先预取小文件或缓存索引 |
| 订阅或订单状态提醒 | 服务端订单事件、订阅即将续费 | IAP、Payment、Push、Live View | 状态和管理入口 | 避免遗漏 | 中高。只能提醒或打开管理页，不能自动续费或退款 |
| 专注模式建议 | 固定学习时段、日程进入深度工作、用户明确启用 | Calendar、Screen Time Guard、Notification | 建议启用已配置的守护策略 | 对特定人群价值高 | 中。需用户主动授权和预配置，不应自动限制应用 |
| 联系人沟通准备 | 日程即将开始或用户经常在该时间联系某人 | Calendar、Contacts、Call、Share | 联系人和消息草稿入口 | 缩短沟通路径 | 中。拨打和发送必须确认，避免错误打扰 |
| 应用更新与能力按需安装 | 用户即将使用某项未安装能力 | AppGallery、App Linking | 更新或模块安装入口 | 降低临时等待 | 中。安装过程保持用户可见 |
| 阅读续接 | 常用阅读时段、存在未完成章节 | Reader、File/Cloud、Notification | 继续阅读入口 | 形成个人习惯服务 | 中。需要本地阅读历史，不能只靠 Reader API |

### 2 通勤出发助手的建议调用链

```text
工作日时间窗或离家围栏事件
        ↓
查询下一条工作相关日程
        ↓
判断目的地和开始时间
        ↓
取得当前位置并规划路线
        ↓
查询目的地和沿途天气
        ↓
查询可用的出行凭证或快捷入口
        ↓
计算是否值得展示
        ↓
发布通知或创建实况窗
```

这个场景的优势是：即使没有地铁二维码 API，天气、出发时间、路线和“打开乘车码”入口也能形成可验证的最小闭环。后续接入运营方 API、三方 API、MCP 或 Web Search 时，只需新增能力适配器，不需要重做上层决策架构。

## 七 权限和安全设计

### 1 动作风险分级

| 等级 | 动作 | 默认策略 |
|---|---|---|
| L0 | 读取非敏感公开数据，如天气、地图静态信息 | 满足权限和网络条件后可直接执行 |
| L1 | 读取用户授权数据，如日历、位置、健康和联系人候选 | 仅处理当前任务所需的最小字段，结果尽量留在端侧 |
| L2 | 准备动作，如生成路线、准备分享内容、打开支付页、生成日程草稿 | 可以主动准备，但展示给用户后再继续 |
| L3 | 改变状态或产生外部影响，如写日历、分享、拨号、购买、付款、退款、删文件 | 必须明确确认；确认对象、金额、收件人和内容要可见 |
| L4 | 无公开权限、无合作资质或政策不允许的能力 | 不进入运行时能力表，返回不可用原因和替代方案 |

### 2 主动服务的产品约束

- 必须让用户选择可用的数据源、主动场景和提醒频率。
- 默认只做推荐和准备，不自动执行不可逆或对外动作。
- 每张主动卡片都要说明触发原因，例如“根据 9:00 的会议和当前路程”。
- 提供“不再提示此场景”“减少此类提醒”和“数据来源管理”。
- 行为历史应有保存期限、撤销和清除机制。
- 端侧模型输入应去除不必要的姓名、完整地址、健康明细和支付信息。
- 通知聚类不得默认读取其他应用通知；如未来获得官方授权能力，应单独做隐私评估。

## 八 推荐的验证路线

### 阶段一 天气提示词闭环

目标是证明“原始提示词到业务数据”的端侧链路。

测试语料至少覆盖：

- “上海今天的天气怎么样”；
- “明早去杭州要不要带伞”；
- “当前位置未来两小时会下雨吗”；
- “周末青岛适合跑步吗”；
- 省略地点、日期、天气数据类型的提示词；
- 地点歧义、日期歧义和不支持的请求。

链路为：Jev 或 Laya 识别天气领域与查询能力，生成式端侧模型抽取地点和时间，确定性解析器处理“今天”“明早”和默认当前位置，Map 或 Location 完成地理编码，Weather Service 返回业务数据。

### 阶段二 多 Kit 通勤闭环

加入 Calendar、Location、Map、Live View 和 Notification，验证跨能力编排、权限和主动呈现。第一版不接交通码，只提供路线、天气、出发时间和可配置的深链入口。

### 阶段三 用户习惯学习

记录展示、点击、关闭、执行和重复使用反馈，验证不同时间、地点和场景下的排序变化。此阶段再引入个性化模型，避免把冷启动规则和长期学习混在第一版中。

### 阶段四 高价值生态场景

根据合作条件选择 Wallet 出行凭证、酒店房卡、活动门票或三方乘车码 API。该阶段验证外部能力扩展、服务端事件和实况窗更新，不应作为第一阶段可行性的前置条件。

## 九 验收指标

以下指标应作为 PoC 目标，不应在未测试前当作已有结论：

| 层级 | 指标 | 建议目标 |
|---|---|---|
| 领域识别 | 天气、日历、地图等领域 Top 1 准确率 | 受控测试集不低于 97% |
| 能力选择 | 正确业务能力选择率 | 不低于 95%，并单独统计拒识 |
| 参数提取 | 地点、日期、联系人等字段完全正确率 | 核心字段不低于 95% |
| 默认补全 | 未显式参数按策略正确补全率 | 不低于 99% |
| 执行 | 权限已满足时的端到端成功率 | 不低于 95% |
| 安全 | 未确认的 L3 动作执行次数 | 0 |
| 时延 | 端侧路由和参数解析 P50 | 以目标设备实测，优先控制在数百毫秒级 |
| 主动服务 | 卡片点击或完成率、关闭率、同类屏蔽率 | 按场景比较，不设单一总指标 |
| 打扰控制 | 每用户每日主动触达量和负反馈 | 必须设置硬上限并支持用户调整 |

测试集要按设备、系统版本、权限状态、网络状态和账户状态分层，不能只测试“所有条件都满足”的理想路径。

## 十 主要风险和应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 官方 API 版本变化 | 生成代码和文档脱节 | 保存文档版本和内容摘要，定期差异检测，适配器按系统版本分支 |
| 自动生成误解 API 语义 | 编译通过但运行流程错误 | 高风险能力人工审核；用真机契约测试而非只做单元测试 |
| 权限或合作资质缺失 | PoC 可写代码但无法发布 | 能力注册时标记 `public`、`user_grant`、`restricted`、`partner_only` |
| 后台执行受限 | 主动服务不能按预期准时运行 | 优先使用围栏、日历、Push、健康订阅等事件；延迟任务只做补偿 |
| 过度打扰 | 用户关闭通知和权限 | 先排序后触达，设置频控、置信度阈值和负反馈学习 |
| 隐私泄露 | 合规和信任风险 | 端侧处理、字段最小化、数据过期、敏感字段不进日志和模型训练 |
| 模型误选高风险动作 | 造成支付、发送或删除事故 | 模型无执行权；确定性门禁、显式确认、幂等键和审计日志 |
| 全量覆盖耗时过大 | 大量低价值 API 拖慢验证 | 以场景反推能力，首批控制在少量高复用业务动作，而非覆盖所有函数 |

## 十一 最终建议

### 1 方案定位

建议把项目定位为：

> 面向端侧模型的系统业务能力生成与主动服务框架。Codex 在开发阶段把系统、三方 API、MCP 和 Web Search 转换为统一的业务能力；运行时由轻量判别模型选择能力，生成式端侧模型提取参数，确定性代码补全默认值并执行；同一能力层同时服务用户提示词和预测式主动服务。

这个定位比“把系统 API 给模型调用”更完整，也比“生成业务卡片”更能体现平台价值。核心资产不再是模板库，而是：

- 可持续生成和更新的能力注册表；
- 跨系统 API 的业务语义层；
- 端侧低时延路由和参数解析方案；
- 权限、风险和前后台执行治理；
- 主动服务的反馈学习闭环；
- 可以扩展到三方 API、MCP 和 Web Search 的统一协议。

### 2 实施优先级

不建议第一阶段尝试把 28 个 Kit 的所有函数全部生成并上线。建议顺序为：

1. Weather、Location、Map：证明自然语言到业务数据；
2. Calendar、Notification、Live View：证明主动场景和呈现；
3. Cloud、Preview、PDF：证明跨 Kit 组合和资源预取；
4. Health、Wallet：验证高价值但高授权或高合作门槛的场景；
5. Account、Contacts、Share、Call：补全用户确认后的执行链；
6. Payment、IAP、Screen Time Guard：只在权限、资质和风控完成后接入；
7. Ads、Game Controller、Game Service、Enterprise Space：按具体业务垂类决定，不作为通用平台覆盖率目标。

### 3 对可行性的最终判断

- **Codex 扁平化 28 个 Kit：技术可行，工程上应采用能力生产线，不应采用简单的一比一包装。**
- **Jev 或 Laya 做领域识别和能力选择：可行，适合分层小候选集和拒识机制。**
- **生成式端侧模型做参数提取：可行，输入只包含已选能力的 Schema 时压力明显下降。**
- **应用服务 API 组织主动服务：可以完成第一批高价值闭环，但不足以独立支撑通用主动助手。**
- **最优 PoC：天气提示词闭环后，立即扩展为通勤出发助手，以跨 Kit 主动服务证明平台价值。**

## 十二 官方资料索引

### 应用服务 API 根目录

- [Account Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/account-api)
- [Ads Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/ads-api)
- [AppGallery Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/store-api)
- [App Linking Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/app-linking-api)
- [Calendar Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/calendar-api)
- [Call Service Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/call-api)
- [Cloud Foundation Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/cloud-foundation-api)
- [Contacts Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/contacts-api)
- [Enterprise Space Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/enterprise-space-api)
- [File Manager Service Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/file-manager-service-api)
- [Health Service Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/health-service-api)
- [IAP Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/iap-api)
- [Game Controller Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/game-controller-api)
- [Game Service Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/game-service-api)
- [Live View Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/live-view-api)
- [Location Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/location-api)
- [Map Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/map-api)
- [Notification Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/notification-api)
- [Payment Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/payment-api)
- [PDF Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/pdf-api)
- [Preview Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/preview-api)
- [Push Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/push-api)
- [Reader Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/reader-api)
- [Scenario Fusion Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/scenario-fusion-api)
- [Screen Time Guard Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/screen-time-guard-api)
- [Share Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/share-api)
- [Wallet Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/wallet-api)
- [Weather Service Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/weather-service-api)

### 关键约束资料

- [Weather Service weatherService API](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/weather-service-weatherservice)
- [获取指定城市天气的官方说明](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/weather-service-faq-1-V5)
- [Calendar Kit 权限说明](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-v5/permissions-for-all-V5)
- [Location Kit 围栏 ExtensionAbility](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/js-apis-app-ability-fenceextensionability)
- [Wallet Kit NFC 交通卡概述](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/wallet-transitcard-overview)
- [Screen Time Guard ExtensionAbility](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/screentimeguard-timeguardextensionability)
- [延迟任务和调度约束](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-v5/work-scheduler-V5)
- [通知管理 API](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-notificationmanager)
- [Intent 装饰器与天气意图示例](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/js-apis-app-ability-insightintentdecorator)
- [Scenario Fusion 智能填充数据源和推荐逻辑](https://developer.huawei.com/consumer/cn/doc/HarmonyOS-Guides/scenario-fusion-intelligentfilling-explain)
