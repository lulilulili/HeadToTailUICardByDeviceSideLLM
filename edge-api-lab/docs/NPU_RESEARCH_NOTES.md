# 华为鸿蒙旗舰 NPU 可行性研究笔记

核验日期：2026-10-11。范围：中文、单服务、Qwen2.5 0.5B / 1.5B / 3B 的未来手机端部署。本笔记仅查询官方产品资料、开发文档及厂商原始性能记录；未连接手机、未调用模型、未改变源码、金标或已保存的实测记录。

## 结论与参照设备

目前可以确认“存在可供验证的华为手机 NPU 接入路线”，不能确认“现有 Ollama + Q4_K_M 权重可以直接使用该 NPU”，也没有查到足以预测本项目在该机型上 token/s、首字延迟或 API 准确率的公开对照。NPU 主要改变执行效率；它不自动纠正选错 API、遗漏参数或把用户地点替换为当前位置的问题。更换量化或运行时后，准确率也需要重新验收。

截至核验日，[华为中国手机总览](https://consumer.huawei.com/cn/phones/)主推 Mate 90 Pro Max。本笔记固定使用可核验的 **Mate 90 Pro Max 典藏版：麒麟 9050 Pro、16 GB RAM、HarmonyOS 7.0** 作为“最新旗舰”参照，避免把同名普通版不同芯片混为一谈。普通 Pro Max 规格列有麒麟 9050 / 9050 Pro、12 / 16 GB RAM；RS 非凡大师列为 9050 Pro、16 GB RAM。官网展示与规格支持上述参照选择，但不额外推断未查证的发布日期或其他机型排位。[Pro Max 官方规格](https://consumer.huawei.com/cn/phones/mate90-pro-max/specs/)、[RS 官方规格](https://consumer.huawei.com/cn/phones/mate90-rs-ultimate-design/specs/)

华为官方新闻材料提及麒麟 9050 Pro 的新达芬奇架构 NPU，但没有给出本项目所需的“Qwen2.5 各档 + 明确量化 + 明确运行时 + prefill/decode”对照。本笔记不填传闻 TOPS，不把整机提升或其他系统 AI 功能的宣传百分比当作本项目加速比。[华为官方影像技术新闻](https://consumer.huawei.com/cn/press/news/2026/all-new-xmage/)

## 已核实的开发路线与边界

### 1. HarmonyOS NNRT / MindSpore Lite Kit

官方 NNRT 介绍提供在线构图、芯片驱动编译、编译缓存和硬件执行接口；MindSpore Lite Kit 通过 Delegate → NNRT 连接底层 AI 芯片，并提供模型转换及端侧部署流程。它们是实际接入方向，不是 GGUF 文件自动启用 NPU 的证明。[NNRT 官方功能](https://developer.huawei.com/consumer/cn/sdk/neural-network-runtime-kit)、[MindSpore Lite Kit 官方架构](https://developer.huawei.com/consumer/cn/sdk/mindspore-lite-kit/)

华为 V14 官方 C/C++ 示例明确优先调度 NNRT，不支持的算子交由 CPU 执行。短引用："If certain operators are not supported by NNRT"。这说明“选择 NPU”不等于“整个网络在 NPU”；真实收益取决于算子覆盖率、图切分和搬运开销。V14 是可读的版本化证据，不据此保证 HarmonyOS 7 任意模型的行为相同，落地需核对目标 SDK 和设备运行时。[官方异构推理示例](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V14/mindspore-lite-guidelines-V14)

该版本 API 文档将直接 `OH_AI_DEVICETYPE_KIRIN_NPU` 标为上游配置，在 HarmonyOS 上应使用 NNRT；模型类型为 MindIR（`.ms`）。文档提供 NNRT 设备枚举/按类型选择、模型构建和算子回调监测接口。应先检查目标机上实际注册的 accelerator，而不是看到麒麟型号就判定模型已用 NPU。[MindSpore Lite 版本化 API](https://developer.huawei.com/consumer/en/doc/harmonyos-references-V14/_mind_spore-V14)

当前 NNRT 文档的数据类型和算子列表只是接口合同，不等于每个芯片驱动支持其全部组合；尤其不能从 FP16/INT8 枚举列表推断 GGUF K-quants 已有原生内核，或反向断言所有 4bit 路线都不支持。[NNRT 数据类型/算子参考](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/api/capi-neural-network-runtime-type-h)

MindSpore Lite 官方 FAQ 给出图构建、动态形状、内存申请以及子图过多导致回退或性能下降的故障情景。其中旧 HiAI/EMUI 路线的 200 MB 子图、示例 1 GB NPU 内存及 3 GB 内存池限制，不能直接当作 Mate 90 / HarmonyOS 7 的确定上限；需要按具体运行时、驱动和实际可分配内存确认。[官方 FAQ](https://www.mindspore.cn/lite/docs/en/r2.9.0/reference/faq.html)

### 2. 华为已提供 LLM 4bit 工具，但仍需适配

2026-07-28 更新的官方“LLM 模型一站式量化”提供权重量化、激活量化、参数提取三阶段，输入是 Hugging Face 浮点模型和校准文本，输出包括量化权重及量化参数，附 Qwen2 量化仿真示例。另一官方概述将低位 LLM 策略列为 Quant_INT16-4，即 4bit 权重、16bit 数据；工具产物可以进入专用模型转换路线。[LLM 一站式量化](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/cannkit-large-language-one-stop)、[轻量化工具概述](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/cannkit-lightweight-tool-overview)

这两份文档证明有 LLM 适配工具，不证明本项目的 Qwen2.5 0.5B / 1.5B / 3B 已编译成功、在 9050 Pro 完整执行或保持 API/参数准确率。仿真 demo 也不是手机端性能报告。需要使用原浮点模型、独立校准集、对应芯片工具链重新转换；不能把当前 Q4_K_M 直接改名为华为 4bit 产物。

华为 CANN 官方资料还明确列出 Kirin 与 Ascend 在数据类型和基础 API 上的差异，例如所列 Kirin 平台不支持 `bfloat16_t`。这是“昇腾服务器跑通不等于麒麟手机跑通”的具体证据；文档所列 Kirin9020/9030/X90 不能自行映射为 9050 Pro 兼容确认。[CANN 数据类型兼容说明](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/cannkit-basic-datatype)

### 3. 当前 Ollama 与 GGUF 的边界

Ollama 官方硬件文档描述 Nvidia、AMD ROCm、Apple Metal 和 Vulkan GPU 路线，未给出本项目可用的 Huawei / Qualcomm 手机 NPU 接入步骤。准确表述是“官方文档尚未证明当前部署可调用手机 NPU”，而不是“所有软件永远不支持 NPU”。[Ollama Hardware support](https://docs.ollama.com/gpu)

作为反例，Qualcomm 官方 GenieX 的 GGUF / llama.cpp 路线可以使用 Hexagon NPU，但量化表区分 `Q4_0`（NPU）和 `Q4_K_M/Q5_K_M`（GPU/CPU）。短引用："Not optimized for Hexagon NPU." 预编译 QAIRT bundle 常见 `w4a16`，精度在编译时固定。因此 GGUF 能否用 NPU 取决于后端、芯片及量化，不能只看扩展名；Qualcomm 路线也不等于华为 HarmonyOS 支持。[官方量化与后端约束](https://geniex.aihub.qualcomm.com/en/models/supported)

## 外部性能证据：可作方向参考，不能迁移成华为预测

下表来自 Qualcomm `ai-hub-models v0.64.0` 的原始 `perf.yaml`，统一取 **Samsung Galaxy S25、w4a16、4096 上下文、geniex_qairt、目标单元 NPU、GenieX v0.8.0 / QAIRT 2.45**。数值按原记录四舍五入，两种速度不可混用；它们不是本项目实测或华为手机成绩。

| 厂商测试模型 | Prefill tokens/s | 生成 tokens/s | 厂商 TTFT 范围（ms） | 原始证据 |
| --- | ---: | ---: | ---: | --- |
| Qwen3-0.6B | 2225.08 | 30.53 | 57.53–1840.83 | [原始记录](https://raw.githubusercontent.com/qualcomm/ai-hub-models/v0.64.0/src/qai_hub_models/models/qwen3_0_6b/perf.yaml) |
| Qwen3-1.7B | 1493.86 | 21.61 | 85.68–2741.88 | [原始记录](https://raw.githubusercontent.com/qualcomm/ai-hub-models/v0.64.0/src/qai_hub_models/models/qwen3_1_7b/perf.yaml) |
| Llama-v3.2-3B-Instruct | 1347.31 | 17.20 | 95.00–3040.13 | [原始记录](https://raw.githubusercontent.com/qualcomm/ai-hub-models/v0.64.0/src/qai_hub_models/models/llama_v3_2_3b_instruct/perf.yaml) |

Qualcomm 的 TTFT 下限对应短提示（最多 128 tokens），上限对应完整 4096 上下文；不是延迟 p50/p95，不能拿下限作为每次业务请求耗时。原记录未提供本项目中文题组、结构化输出准确率、长时间运行温升或能耗。模型架构、量化、手机芯片和后端均不同，不能把 17–31 tokens/s 写成麒麟或 Qwen2.5 的预测区间。[官方指标定义](https://aihub.qualcomm.com/models/llama_v3_2_3b_instruct)

Arm 官方 2024 年演示则是 **1500 万参数** Tiny Llama2、512 MAC 的 Ethos-U85 FPGA、32 MHz、整数 int8/int16、固定形状 TFLite、TFLite Micro / Ethos 后端，实测生成 7.5–8 tokens/s。其“真实 SoC 最高十倍”属于预期，不是测量；这比本项目 0.5B–3B 小很多，也不是麒麟 NPU，不能用于规模线性外推。[Arm 官方演示](https://newsroom.arm.com/blog/small-language-model-generative-ai-edge)

## 条件化推算：内存与耗时必须分开

### 内存粗算（工程推断，不是设备测量）

按模型名称的名义参数档位计算，理想纯权重大小 `参数数 × 位宽 / 8` 如下，单位为十进制 GB。实际参数数、混合精度层、尺度/零点、布局对齐、编译产物可能增加大小；这不是现有 GGUF 文件大小，也不是完整运行内存。

| 名义档位 | 理想 4bit 权重 | 理想 FP16 权重 |
| --- | ---: | ---: |
| 0.5B | 0.25 GB | 1 GB |
| 1.5B | 0.75 GB | 3 GB |
| 3B | 1.50 GB | 6 GB |

完整预算还要加 KV cache、激活、临时工作区、图编译/缓存、CPU 与 NPU 间可能的复制，以及系统/应用自身占用。16 GB 是整机 RAM，不是应用或 NPU 独享容量。推断：0.5B / 1.5B 是较低内存成本的首轮适配对象，3B 也值得验证；能否装载及持续运行仍由转换后布局与驱动预算决定，不能保证。7B 不在当前新增三模型实验范围内；[已有 PC 资源限制报告](feasibility-final3.json)的连续超时只能说明当时 8 GB 电脑资源限制，不证明该模型在手机上可行或不可行。

### 时间推算（仅情景，不是旗舰成绩）

单次请求应拆成：`加载/编译 + prefill(输入 tokens) + decode(输出 tokens) + 检索/校验/系统取参 + 搬运/调度`。TOPS 没有包含实际位宽、访存、形状、图切分、KV cache、解码串行性与热降频，不能直接换成 token/s。Prefill 的矩阵并行收益也不能代替逐 token 的 decode 收益。

| 情景 | 必要条件 | 当前能说什么 |
| --- | --- | --- |
| 未适配或大面积回退 | 模型未编译、量化不兼容、核心算子回 CPU | NPU 不产生可确认收益，甚至因搬运而更慢；不能承诺秒数 |
| 部分有效加速 | 部分计算在 NPU，CPU 回退及数据搬运仍明显 | 有改善可能，但需分开测首字与生成速度，不可套统一倍数 |
| 较完整适配并持续运行 | 核心算子、形状/KV、量化、内存及缓存均通过，设备没有严重降频 | 才能形成手机业务延迟分布；目前数值未评估 |

用于报告敏感性分析的数学例子：在**同一设备同一负载**中，若可加速部分占原总耗时 `f`，该部分提速 `S` 倍，忽略新增开销，则整体加速为 `1 / ((1-f) + f/S)`。假设 `f=50%, S=3` 得 1.50 倍；`f=80%, S=3` 得 2.14 倍；`f=95%, S=5` 得 4.17 倍。这些是人为条件，不是 Huawei 或本项目性能证据；新增搬运开销会降低收益。

当前 i5-8265U 电脑的秒数不能直接按该公式变成 Mate 90 秒数，因为 CPU 架构、带宽、运行时与量化都变了。可复用电脑试验中的输入/输出 token 负载与正确性题组，但必须先获取手机 CPU/NNRT 的匹配基线。没有该基线时，华为 NPU token/s、业务 p50/p95 以及相对本机加速比应标为“待真机适配实测”，而非填 0 或伪造区间。

### 本项目短 JSON 意图路由的填数模板

本项目不是长文写作：实际输出是一个 API 及少量参数的 JSON。输出较短不代表输入较短，候选 API、槽位说明、系统指令和 chat template 都要计入 `Tin`；首字处理与加载开销可能比逐 token 生成更重要，这是需由正式记录验证的假设，不能预先断言哪个阶段占主导。

每条请求可使用下式做解释性预算，全部时间统一为秒、速度为 tokens/s：

```text
T ≈ Tload + Tin / rprefill + Tout / rdecode + Thostrule + Tfallback
```

- `Tload`：实际模型装载/必要编译，区分冷启动、编译缓存命中和模型常驻；不能把每次调用都算成重新编译。
- `Tin / rprefill`：以实际 tokenizer 计数的完整输入及对应 prefill 阶段速度，不用汉字数或候选 API 个数代替。
- `Tout / rdecode`：实际生成的全部 tokens，包括无效 JSON 或额外文字，不用金标 JSON 的长度代替模型输出长度。
- `Thostrule`：候选检索、JSON/合同校验、参数原文校对和系统取参等宿主开销；真实系统调用时延与当前 fixture 开销需要分别测量。
- `Tfallback`：尚未包含在阶段速度中的 CPU 回退、格式转换及搬运开销。如果 `rprefill/rdecode` 来自完整异构阶段实测，它们已含回退成本，此项只填额外残差，不能重复相加。

未来本机正式结果先填 `Tin/Tout`、实际加载/prefill/decode 时长、宿主时长及端到端时长，并保存模型 digest、提示版本和量化/后端。若 provider 返回纳秒时长，先除以 `10^9` 再计算阶段速度；未返回或不能拆分的项标 `null/未测量`，不倒推成想要的值。非流式完整响应中的 prefill 时长不直接等于实测 TTFT，应保留指标名称。

手机估算复用的是相同题组的负载和计数；`Tload/rprefill/rdecode/Thostrule/Tfallback` 仍须填同一 SKU、量化、上下文和运行时的手机实测值。0.5B / 1.5B / 3B 手机各项当前都未测量，不能套上表 Qualcomm 的速度，也不填手机 API/参数分数。完成实测后逐条计算或直接统计端到端 p50/p95；不能将若干组件的 p50 相加冒充总 p50。成功、schema 失败、provider 失败及超时的数量和计时口径分开报告，避免将失败响应较快解释为模型更高效。

## 下一阶段最小验收（建议，尚未执行）

1. 固定目标 SKU、HarmonyOS/SDK、NNRT/CANN 版本及注册设备；保存模型转换产物、原权重与量化配置的 digest。
2. 先以 0.5B / 1.5B 做转换和基本推理，核验核心算子、静态/动态形状、KV cache 与输入输出一致性，再验证 3B；记录回退及失败，不把硬件失败当选错 API。
3. 匹配中文单服务提示、tokenizer/chat template、采样参数、结构化输出协议；新量化需要独立校准集和盲测集，不把验收金标喂给模型或校准程序。
4. 同一手机测 CPU 与实际 accelerator 路线：冷启动、暖启动、prefill tokens/s、decode tokens/s、端到端 p50/p95、峰值应用内存、持续温升/能耗与错误率分别记录。编译缓存和模型常驻收益独立报告。
5. 手机 SDK 的位置/电量/网络取参与模型推理加速是两条独立验证线。本机仍指未来鸿蒙手机，当前只用手机位置 fixture mock；不得把电脑定位或外部厂商性能加入已有 raw 记录。

可以向用户承诺的是“按上述明确旗舰配置开展下一阶段适配与测量”；现阶段不应承诺固定 token/s、某个加速倍数或由 NPU 导致准确率提升。
