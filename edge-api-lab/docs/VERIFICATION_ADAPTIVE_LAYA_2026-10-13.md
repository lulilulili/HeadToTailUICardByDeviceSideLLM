# 2026-10-13 分步路由与本机 Laya 验收

用户要求的 Qwen 简单两次主路径、复杂按需三次已经接入。因官方 Jev 账号需要充值，用户改用 Laya：本机 Laya 选择领域和 API，Qwen 填参；官方 Jev SDK 适配保留为云端可选，没有实际云端调用或充值。

## 工程范围与验收对应

| 要求 | 已实现与证据 |
| --- | --- |
| 简单两次、复杂三次 | `adaptive` 路由及可观察语法触发；实际阶段/次数、失败与跳过保留；Qwen v1/v2 各六条真实烟测 |
| 时间、参数处理 | 原始提取、原文核对、规则补全继续分列；不以新模式重写旧输出 |
| 领域与 API 选择 | 全 10 域＋拒识；Qwen 域内最多 12 项软排序，仍可能预算漏召回；Laya/Jev 完整域内 API |
| 本机 Laya | 官方作者发布包 0.4.6，多语言 bundle revision `7b928d828b7b0e022f929d9bd2e44165aa270148`；实际健康状态确认 CPU 驻留 |
| 填参提供方 | Laya/Jev profile 前两阶段为 choice；参数由本地 Ollama 提取，无输入 API 跳过填参 |
| 真实计时 | 每条 trace 的 wallMs；Ollama 原生分段指标；Laya 服务推理 header；不虚构 Jev 分段时间或底层 forward 数 |
| 多候选 | 天气 203＋拒识完整映射；Laya 每组 16，通过官方分组淘汰；短键与真实 API 一一映射，淘汰概率不等于全量联合校准 |
| 配置与错误 | 官方密钥仅后端读取；Laya 仅本机 HTTP，无 Key/云端充值；无隐式重试或静默换模型；截断/折叠明示 |
| 页面与文档 | 默认 adaptive；Laya、Jev、unified、staged 可选；Laya 就绪卡、阶段配置、概率、耗时和独立说明页签 |
| 既有证据 | 原 4000 条 unified、4 预热、57 冻结文件和报告不变；完成批次使用自身冻结评分引擎重算，当前源码差异另列 |

## 实际验证

基线开发前 621 项测试通过；加入分步、官方 SDK 和本机 Laya 后，完整 `npm test` 为 765/765 通过，0 失败、0 跳过，26.28 秒；详见发布证据目录的最终日志。测试不执行模型，实际模型验证另列。

- Qwen adaptive-v1：六条工程烟测，实际调用路径 5/6 符合预期，API 4/6、最终计划 4/6；包含多字段 API 错选和拒识失败。
- Qwen adaptive-v2：增加通用多字段修改与拒识边界后再次六条烟测，API/最终计划仍 4/6；没有得到这六例上的准确率收益。
- 同版本 Qwen 3B 的两条失败案例 HTTP 复核仍失败；不能把单纯增大模型或提示说明视为已修复。
- Laya＋Qwen 1.5B：六条真实烟测，按现有冻结评分，领域 4/6、API 2/6、原始完整计划 1/6、最终计划 2/6，四条最终计划评分未通过。天气例原选 `weather.hourly.temperature` 错误，但规则恢复“现在”后，`resolved.resolution.time.effective.api` / `mock.api` 已回退 `weather.current.temperature`；冻结 `executionScore.api` / `precision` 仍为 false。2/6 是现有评分通过数，不表示该例实际 mock 仍读小时天气；评分与原始记录未改。包括全部天气候选与分组；没有报告末轮原文截断或候选折叠，中间轮诊断仍未全量透传。
- 页面真实提交“修改日程 ev_7，标题为设计评审，地点为A室”：得到 `calendar.update`，Laya→Laya→Qwen，三次尝试，链路 7.34 秒；模型漏 ID 由确定性原文核对恢复，业务仍 mock。
- 既有 4000 条离线审核再次为 `verified_completed`：4000 个原始哈希、原始/执行评分、索引、报告与冻结源码通过；模型调用 0，派生写入 0。

这些是工程烟测，案例公开且极少，不是独立盲测、配对统计实验或完整四模型重测。能说明接入与路由可以运行，不能说明 Laya 与 Jev 质量等价、新模式普遍更准/快，或真实业务已经成功执行。

## 文件与环境

- Qwen v1/v2：`evidence/adaptive-jev-20261013-local-smoke/`、`evidence/adaptive-jev-20261013-v2-local-smoke/`，失败与关键源码快照保留。
- Laya：`evidence/laya-smoke-20261013024041271/`，六条原始记录、阶段指标、实际服务配置和关键源码快照。
- 部署/页面：`evidence/laya-20261013-deployment/`，实际健康状态、已安装作者源码哈希、页面请求、截图与最终验收日志。
- 本机 Windows 11 / i7-10700 / 8 核 16 线程 / 31.8 GiB；Node 25.2.1、Ollama 0.35.0；Laya CPU 8 线程，Python 3.12.10、Torch 2.14.1、Transformers 5.19.0，依赖完整锁定在 `integrations/laya/requirements.txt`。

Laya 运行使用独立 Python 环境和固定权重缓存；权重、环境、日志/PID与凭据不提交。安装/启动/停止入口和概率限制见 [Laya 指南](LAYA.md)，Qwen 分步与官方 SDK 见 [分步指南](ADAPTIVE_JEV.md)。关键源码快照不宣称是包含全部依赖的独立应用镜像；完整工程版本及文件 SHA 随仓库发布。
