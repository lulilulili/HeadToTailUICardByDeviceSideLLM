# Laya 本机决策

新增 **Laya 本机选择 + Qwen 填参**：Laya 在本机分别选择领域和 API，Qwen 在本机提取用户明确给出的参数。有入参通常 3 次，无入参 API 省略 Qwen 参数调用，实际 2 次；拒识、失败或取消可能更早停止。业务仍返回模拟回执，不是手机 SDK 真机执行。

默认仍为 **Qwen 智能分步（adaptive）**，保留用户需要的简单两次主路径、复杂三次路径。Laya 模式可直接选择，也可在“逐次调用替换”中只替换领域或 API 选择。Laya 不生成自由参数，联合 API/参数、参数提取与 unified 继续使用本机 Ollama。用 Laya 选择 API 时会分离 Qwen 参数阶段；接口没有入参时可省略该阶段。

## 安装、启动与就绪

Laya 无需 API 密钥或充值；首次安装和权重下载需要网络，推理仍消耗本机内存、电力与 CPU 计算。它是独立本机服务，不是 Ollama 的一个模型，也不是官方 Jev 云端结果。

1. 准备 Python 3.12 或更高版本（排除 3.14.1；本机已验证 3.12.10），双击工程的 **安装启动Laya.bat**。脚本建立独立 Python 环境，安装锁定依赖并下载固定多语言权重。
2. 等待下载和模型加载完成。已有模型时使用同一入口启动；重复点击会复用受管进程。若有问题，可查看 `data/runtime/laya-server-error.log`。
3. 回到实验页面点击“刷新状态”。只有后端明确报告 `ready:true` 才允许提交 Laya 请求；“配置存在”或服务仅能响应都不代表模型就绪。
4. 选 Laya 模式并保留一个已安装的基础 Qwen 模型用于填参。关闭本机服务可使用 **停止Laya.bat**；不会关闭 Ollama。

受管服务使用作者提供的 `laya.serve`，工程锁定 Laya 0.4.6；中文选择固定 `multilingual`。固定权重 revision 为 `7b928d828b7b0e022f929d9bd2e44165aa270148`。默认在 `127.0.0.1:8765` 运行，受管配置为 CPU / 8 线程、分组 16、最多 255 选项。请求预算 `max_len=4096`、`head_max_len=768` 用来给用户原文留空间。当前实际版本、模型驻留、设备、revision 与设置以页面服务元数据为准，未报告字段显示未知，不从默认配置虚构观测。

## 如何读 Laya 调用详情

一次领域或 API 决策产生一条本机 HTTP 调用轨迹，页面显示实际请求耗时、服务返回的推理耗时、完整请求与响应。API 短候选键通过 `choiceMap` 映射回真实 API，短键概率与映射后概率都保留，不能把短键当业务接口名。

分组淘汰会把多个组的问题批量交给一次内部 `predict`，再对入围候选做最终选择；**淘汰后的概率不是全量候选的联合校准概率**。被淘汰选项的 0 分不表示它在全量比较中必然不正确。页面区分三种计数：HTTP 请求数来自请求记录；内部 predict 数是根据返回的淘汰轮数加最终轮做源码推导；底层 forward 次数未观测时显示“未观测”，不能把组数当底层前向次数。

例如当前每组 16 的策略下，203 个天气 API 加拒识选项可通过一轮批量淘汰加最终轮完成；应按返回元数据计算 predict 数，不能把各分组分别当一次 HTTP 或一次 predict。实际每次轨迹的轮数和计数仍单独保留。

`usage.input_tokens` 累计内部轮的输入 token；`state_tokens`、`truncated_questions`、`options` 等诊断主要反映最后一轮。中间轮截断尚未全量透传，不能保证已完整检查所有内部轮。输出 token 通常为 0，不据此计算生成速度；这类本机选择不做自回归参数生成。Laya confidence 基于归一化熵，**不是准确率**，也不能与 Jev 云端 confidence 直接混比。`answer_confidence` 和 `x_jev_confidence` 按响应原值保留，后者的名称不表示进行了官方 Jev 云端调用。

若响应报告用户原文截断、问题截断或候选折叠，工程将本次标为失败并保留证据，不静默当作完整输入下的正常决策。参数原提取、原文核对与系统补全仍分别展示，业务目标不猜测。

## 六条真实本机烟测

2026-10-13 已完成六条 Laya + Qwen 1.5B 请求，固定多语言 checkpoint 在本机 CPU / 8 线程运行。领域匹配 **4/6**，API 匹配 **2/6**，原始严格完整计划 **1/6**，最终执行语义计划 **2/6**。这是小样本链路验证，证明两阶段和三阶段完整路径可运行；四条最终计划仍错误，不能视为可靠识别，更不能等价官方 Jev 质量。

| 场景 | 预期 → 实际选择 | 实际调用 | 原始严格完整计划 | 最终计划 | 链路耗时（ms） |
| --- | --- | ---: | --- | --- | ---: |
| 查本机电量 | `device.battery.level` → 同接口 | 2 | 通过 | 通过 | 1597 |
| 上海现在气温 | `weather.current.temperature` → `weather.hourly.temperature` | 3 | 失败 | 失败 | 12128 |
| 修改日程多个字段 | `calendar.update` → 同接口，规则补全后匹配 | 3 | 失败 | 通过 | 5164 |
| 云函数与 JSON 正文 | `cloud.function.call` → `services.availability` | 3 | 失败 | 失败 | 2831 |
| 写一首秋天的诗 | `unsupported` → `calendar.event.lunar` | 3 | 失败 | 失败 | 4868 |
| 电量请求加 JSON {} | `device.battery.level` → `device.info.device_type` | 2 | 失败 | 失败 | 1523 |

耗时为整条链路，含已发生的 Laya/Qwen 请求与规则处理，不是一次 Laya 决策耗时。失败请求仍计入；诗歌本应提前拒识，却实际进入三阶段，不能把“三次调用完成”当识别正确。最终通过也不等于真实业务执行成功，回执仍为 mock。

完整原文、期望、评分与每次调用证据见 [manifest.json](../evidence/laya-smoke-20261013024041271/manifest.json)；逐例文件为 [simple-no-input.json](../evidence/laya-smoke-20261013024041271/simple-no-input.json)、[simple-weather.json](../evidence/laya-smoke-20261013024041271/simple-weather.json)、[complex-write.json](../evidence/laya-smoke-20261013024041271/complex-write.json)、[complex-json.json](../evidence/laya-smoke-20261013024041271/complex-json.json)、[unsupported.json](../evidence/laya-smoke-20261013024041271/unsupported.json)、[no-input-skip.json](../evidence/laya-smoke-20261013024041271/no-input-skip.json)。证据目录为 `evidence/laya-smoke-20261013024041271/`，含独立源码快照。

## 与 Jev、历史基线的区别

Jev 官方云端适配继续作为可选项，仍需要官方可用账号、密钥及相应计费条件；本机 Laya 不需要这些条件。选择 Laya 时，不会把 Jev 未配置提示作为该模式的运行阻碍。

已完成的 **4,000 条 unified** 是一次调用 Qwen 历史基线，不是 Laya 或新分步路径分数。已有 Qwen adaptive v1/v2 小样本验证包含失败，不能据这些记录证明 Laya 更好；尚无真实 Jev 能力评测，也不能作优劣结论。新的 Laya 记录另行保存，实际效果需在相同案例、上下文和评分条件下单独测量。

当前仍是公开开发集、固定模拟手机 fixture、有限领域和单服务 API 计划验证。严格原始提取与最终执行语义分开计分，执行语义不能等同真实业务完成率。默认位置不是电脑 GPS 或手机真机定位。

## 作者资料

- [Laya 作者项目与安装说明](https://github.com/NandhaKishorM/laya)
- [作者提供的 HTTP 服务源码](https://github.com/NandhaKishorM/laya/blob/main/laya/serve.py)
