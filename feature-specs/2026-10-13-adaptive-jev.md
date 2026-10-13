# 自适应分层与官方 Jev 实施计划

**Feature:** 自适应两次主路径、复杂参数三次路径，以及官方 Jev + 本机 Qwen。
**Goal:** 页面可运行两次为主的自适应 Qwen 流程，或官方 Jev 选择领域和 API、本机 Qwen 提取参数的混合流程；各阶段可检查、计时，历史 4000 次基线独立保留。
**Acceptance Criteria:** 下方 AC-1 至 AC-9。
**Architecture cell:** 现有 edge-api-lab 推理提供方、提示词、流水线、HTTP 与网页模块。
**Map delta:** none。
**Map delta why:** 复用已有模块边界，不新增应用或数据服务。
**Architecture:** 保留 unified 与 staged；新增 adaptive 与 jev 模式。Qwen adaptive 先选择完整领域，再在域内联合选择 API 和提取简单参数；有可检查的复杂结构信号时改为 API 选择、独立参数提取。Jev 使用 TypeSafe 官方 SDK / System One choice 协议，只做领域和 API 决策，生成参数由 Ollama 完成。
**Tech Stack:** Node.js、原生 HTTP、Ollama、TypeSafe 官方 JavaScript SDK、现有静态页面、node:test。
**前端验证:** Yes，独立开发服务与浏览器实测。

## 验收要求

- AC-1：adaptive 简单请求完整路径为 domain → intent_arguments 两次；复杂参数请求为 domain → intent → arguments 三次。提前拒识/失败及无入参跳过均记录实际调用数。
- AC-2：第三次触发依据、阶段提供方、实际模型、耗时、输入输出 token 与总耗时落盘并在页面呈现；不用模型自报置信度决定 Qwen 路由。
- AC-3：领域候选使用规则作优先提示，模型仍可选择全部 10 域或 unsupported。新增域内召回使用软排序，不复用旧跨域/动作/字段硬删除作为唯一候选依据；旧 unified/staged 行为用于历史对照保留。
- AC-4：jev 模式强制 domain / intent 使用官方 Jev choice，arguments 使用本机 Qwen；官方 Jev 不承担自由文本/任意 JSON 参数生成。无入参 API 可省略 Qwen 参数调用并说明原因。
- AC-5：Jev API 决策使用完整所选领域 API 集合及 unsupported，目前最大天气 203 个接口在官方 255 个 choice 选项限制内；不将 417 个 API 放进一个问题。完整保存候选、官方响应、概率分布、confidence、usage、实际模型与请求耗时。
- AC-6：使用 TypeSafe 官方 JS SDK 与 https://api.typesafe.ai/v1/systemone，密钥只由本机环境或忽略的 .env 提供；不进入页面、trace、日志、提交。关闭 SDK 隐式重试，取消/超时/401/429/结构失败明示，不静默换提供方。
- AC-7：前端默认 adaptive，提供 unified、固定 staged 与 Jev + Qwen 选择；工作台、批量评测、阶段替换、等待提示、调用详情与文档同步。未配置密钥时清楚显示就绪条件，不伪造 Jev 实测。
- AC-8：新模式使用独立运行/评测记录；不覆盖已发布原始记录、金标、4000 报告、audit 与冻结源码。当前源码变化后，完成基线应可用绑定的冻结评分引擎离线核验。
- AC-9：有测试先行的完整路径、复杂触发、无参数省略、失败/取消、官方 SDK 契约、凭据脱敏、HTTP 输入与 UI 回归验证；用真实 Qwen 做小规模运行验证。官方 Jev 真实能力评测以可用 API Key 为前提，单列尚未执行与实测状态。

## 现有证据与分工

2026-10-12 已完成的四模型/4000 正式调用均为 unified；不能作为两次/三次或 Jev 成绩。共同 99 条候选漏选中 70 条提前硬过滤、29 条排序截断，原始正确参数仍可能被后处理误修。新流程需独立验证，不据架构宣称准确率/速度已提升。

官方来源：https://docs.typesafe.ai/api；https://github.com/typesafe-ai/typesafe-sdk-js。Laya 与第三方兼容服务不在本次实现中。

## 状态、所有权与不变量

- 运行对象沿用现有 application / SerialQueue 所有者：queued → running → completed/error/cancelled；取消中断当前 SDK / Ollama 请求，trace 保留，不发后续阶段。
- Jev 配置由服务启动时读取，仅保存是否就绪和非敏感模型/端点信息；缺失或错误配置不得回退到本地桥接。
- 实际阶段序列由 pipeline 决定，前端只展示派生值。每次 invoke 最多产生一个 trace；不另存与 traces 不一致的调用次数。
- 已完成基线不可重新推理或重新 grounding；审核使用冻结引擎重算已保存输出，必要时标注当前源码不同。
- 对抗验证包括重复取消、阶段失败后禁止继续、未提供密钥、响应选项越界、正文/参数被当作动作、错误旧领域词干扰及历史结果混用。

## 实施步骤

1. 在 main 记录计划，创建隔离 worktree；开发端口使用 3211，保留 3210 已发布页面。
2. 先写失败测试，再实现软领域提示、域内召回、联合意图/参数提示、复杂输入判定与 adaptive 流水线。
3. 先写官方响应与错误契约失败测试，安装并接入官方 SDK，保留旧桥接为明确独立的兼容提供方。
4. 同步 HTTP 模式/提供方校验、健康状态、服务端 .env 配置、前端选择器、阶段详情、说明与密钥配置指引。
5. 核验已完成基线的冻结引擎审核兼容性；新能力测试使用新记录，旧证据保持不变。
6. 运行相关测试与全部检查，在独立页面验证；进行少量真实 Qwen 请求，API Key 可用后进行少量官方 Jev 请求。
7. 完成代码与文档复核，交付可使用页面、验证证据和明确的真实 Jev 就绪状态。
