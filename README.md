# HeadToTailUICardByDeviceSideLLM

端侧小模型驱动的语义 API 调用验证工程，以及智能生成业务的研究与规划材料。

项目理念、完整流程、参数溯源设计，以及第三方能力与主动／预测式服务的判断和建议，见 [项目 Wiki](WIKI.md)。Wiki 明确区分当前实现与未来设想。

当前及未来一段时间均处于可行性验证阶段。第一阶段只验证一个领域、一个 API 的单服务请求：中文提示词 → 领域 / API 选择 → 显式参数提取 → 确定性原文核对 → 缺失系统参数读取 → 契约检查 → 伪 API 回执。组合服务留待第二阶段；Jev 预留逐次替换模型调用的 HTTP 桥接接口。

## 当前阶段（2026-10-11）

已扩展为天气、日历、联系人、文件、服务入口、云端业务、设备状态、网络连接、位置服务和音频媒体 **10 个领域、417 个伪 API**。当前默认题组 `single-service-100-v1` 为每领域 100 条、共 1000 条中文单服务用例，原 100 条与新增 900 条分层统计；全部语料共 1578 条，旧题组独立保留，默认题组不包含组合服务。

本轮按 **1.5B → 3B → 0.5B** 各测试 1000 条，计划 3000 条正式调用，7B 不参与。网页“批量评测 → 千题单服务实测”同步展示真实进度、逐领域成绩及原始调用，未跑到的模型不计为失败。实时报告为 `edge-api-lab/docs/single-service-100-v1-results.json`；原始证据独立保存，旧 final3 及历史回放不覆盖。工程冻结代码、提示词、模型 digest、用例和固定手机 mock 后测试，运行中不调规则。

当前提示词为 `explicit-v7`，目录为 `single-service-v3`，原文核对为 `deterministic-grounding-v2`。优化重点是准确保留用户明确给出的搜索词、标题、正文、目标 ID、路径、时间和结构化参数；只有用户未提供可补的系统参数时，才按接口读取当前系统状态。关键业务信息缺失或系统读取不可用时保留澄清 / 失败，不猜测。

当前电脑为 Intel Core i5-8265U；四档 Qwen2.5 0.5B / 1.5B / 3B / 7B 已安装，均为 Q4_K_M，权重放在 `D:\OllamaModels`。用户级 `OLLAMA_MODELS` 指向该目录，原 C 盘模型路径用目录联接转到 D 盘。历史 1,200 次调用使用的机器条件独立保存在旧报告中，耗时不能直接与这台电脑比较。

尚未接入 HarmonyOS 真机。系统参数读取接口可注入鸿蒙宿主适配器，并记录来源；这里的本机指未来的鸿蒙手机，而非这台电脑；当前只使用明确标记为 fixture 的模拟手机位置，不读取电脑定位。默认网络句柄依赖原生 `connection.getDefaultNet()`；当前音频流需要宿主提供音频场景上下文，不能宣称存在通用原生“当前音频流”getter。设备电量等查询结果目前仍为 `null`。

用户明确指定地点而夹具未登记时，`system-context` 已支持请求 `location.geocode` 原生依赖，由宿主调用 `geoLocationManager.getAddressesFromLocationName()` 解析该地点；这不是读取当前位置。未知“漠河”未得到可信地理编码时保留地点并报告解析失败，不得改用本机坐标。

优先阅读 [当前阶段说明](edge-api-lab/docs/current-feasibility.json)、[问题与实测分析](edge-api-lab/docs/PARAMETER_CAUSE_ANALYSIS.md) 和 [工程使用说明](edge-api-lab/README.md)。最终规则回放与本机模型结果分别另存 [grounding-replay-v2-final3.json](edge-api-lab/docs/grounding-replay-v2-final3.json) 和 [feasibility-final3.json](edge-api-lab/docs/feasibility-final3.json)：历史同输出回放为 959/1,200；本机前三档各完成 40 条主样本，7B 受内存压力限制，整轮明确标记部分完成，不作为其路由能力证据。初始推理、final1、final2、旧 1,200 次调用及 v1 回放不覆盖。当前样本属于已参与优化的开发集，尚不能证明盲测泛化、真机执行或量化影响。

全球地点仅测试中文名称或中文译名，不测试多语言。独立分层采样 60 城、六洲各 10 城，并以其中预先固定的 8 城对前三档完成 24 次真实推理；[结果](edge-api-lab/docs/global-cities-final3.json)保留原始输出与错误。城市样本不作为运行时白名单；中文标签可用性造成采样偏倚，低人口只是“冷门”的代理，不代表全球识别率。疑似有地点但未核验时要求澄清，不能当成用户没说而使用当前位置。

## 快速启动

需要 Node.js 22 或更新版本。查看已有报告不需要重新评测；实际模型调用需要本机 Ollama 和对应模型。

```powershell
git clone https://github.com/lulilulili/HeadToTailUICardByDeviceSideLLM.git
cd HeadToTailUICardByDeviceSideLLM
```

Windows 双击根目录的 [启动API验证工程.bat](启动API验证工程.bat)，自动启动服务并打开 http://127.0.0.1:3210。也可以在 `edge-api-lab` 中执行 `npm start`，再打开上述页面。工程没有第三方 npm 依赖，不需要先执行 `npm install`。

这台电脑的四档模型权重均已安装，前三档完成当前实测。7B 在约 8GB 内存的本机连续超时，保留 D 盘权重但尚未跑通本轮验证，不能评价其准确率。在其他电脑首次实际推理前，可通过 Ollama 准备四档模型：

```powershell
ollama pull qwen2.5:0.5b
ollama pull qwen2.5:1.5b
ollama pull qwen2.5:3b
ollama pull qwen2.5:7b
```

模型权重由 Ollama 管理，不随本仓库上传。实测所用模型 digest、量化规格、机器条件和逐次调用耗时已保存在评测记录中；同名模型未来下载可能与原 digest 不同。

页面提供实验台、批量评测、能力目录、运行记录和详细说明；说明优先展示当前阶段，再保留 13 个历史页签并标记快照时间。初始提交保留全部已有 JSON 运行记录，首次启动即可展示历史结果。新增本机运行记录默认忽略，避免日常实验自动进入版本管理。

## 内容导航

| 目录 / 文件 | 内容 |
|---|---|
| [项目 Wiki](WIKI.md) | 项目理念、处理流程、参数溯源、扩展方向与主动／预测式服务建议 |
| [edge-api-lab/README.md](edge-api-lab/README.md) | 工程使用、契约、参数补全、评测和 Jev 说明 |
| [edge-api-lab/src/](edge-api-lab/src/) / [public/](edge-api-lab/public/) | 后端、API 目录、提示词、规则处理、评分和网页 |
| [edge-api-lab/tests/](edge-api-lab/tests/) / [scripts/](edge-api-lab/scripts/) | 自动检查、批量实测、证据核验和规则回放 |
| [edge-api-lab/data/](edge-api-lab/data/) | 1578 条案例，含当前默认 1000 条单服务题组；冻结源码 / 语料快照、原始模型调用与批次记录 |
| [当前阶段说明](edge-api-lab/docs/current-feasibility.json) | 十领域单服务范围、当前版本、模型存储和系统接口边界 |
| [问题与实测分析](edge-api-lab/docs/PARAMETER_CAUSE_ANALYSIS.md) | 原文校对定义、参数与 API 错因、受控提示词对照及下一步 |
| [grounding-replay-v2-final3.json](edge-api-lab/docs/grounding-replay-v2-final3.json) / [feasibility-final3.json](edge-api-lab/docs/feasibility-final3.json) | 最终规则回放 / 当前本机部分实测；原推理与各版本证据独立保留 |
| [global-cities-final3.json](edge-api-lab/docs/global-cities-final3.json) / [中文城市样本](edge-api-lab/data/global-city-samples.json) | 全球中文冷门城市专项；24 次真实推理与规则回归分开 |
| [edge-api-lab/docs/VERIFICATION.md](edge-api-lab/docs/VERIFICATION.md) | 当前与历史验收口径、真实调用和页面证据 |
| [edge-api-lab/docs/DOMAIN_EVALUATION_RESULTS.md](edge-api-lab/docs/DOMAIN_EVALUATION_RESULTS.md) | 六领域 × 四模型的准确率、耗时与错误分析 |
| [edge-api-lab/docs/grounding-replay.json](edge-api-lab/docs/grounding-replay.json) / [完整审计](edge-api-lab/docs/grounding-replay-audit.json) | 同一批 1,200 条输出的确定性规则回放及逐条对照 |
| [edge-api-lab/evidence/](edge-api-lab/evidence/) | 页面截图、自动检查输出、CPU 条件和新增真实模型调用 |
| [智能生成业务/](智能生成业务/) | 原始业务全景、天气 PoC、六个月路线图、HarmonyOS API 可行性报告和两张图 |
| [REPOSITORY_CONTENTS.md](REPOSITORY_CONTENTS.md) / [PROJECT_MANIFEST.json](PROJECT_MANIFEST.json) | 发布范围、复现方式及文件 SHA-256 校验清单 |

## 历史结果与适用范围（2026-10-10）

以下为冻结 `sparse-v6`、`object-fields-v2` 的历史记录，当时覆盖天气、日历、联系人、文件、服务链接、云端业务六领域，共 372 个伪 API。固定 300 条领域案例（每领域 50 条）分别使用 Qwen2.5 0.5B / 1.5B / 3B / 7B 实测，共 1,200 次正式调用，另有独立预热；不代表当前十领域版本的成绩。

| 指标 | 通过 / 1,200 | 准确率 |
|---|---:|---:|
| 历史严格参数提取 | 659 | 54.92% |
| 历史严格完整计划 | 580 | 48.33% |
| 旧执行语义 | 621 | 51.75% |
| 原文核对后的执行语义 | 811 | 67.58% |

核对后改善 190 条、退步 0 条。后两项来自同一冻结模型输出的 v1 规则回放，新增模型调用 0 次，不改写原模型成绩或耗时。该历史验收时自动检查 264 项通过，另有 3 次模型真实调用验收（业务执行仍为伪 API）。各领域与模型差异、错误来源及证据边界见验收文档和页面。

这些历史结果支持“小模型识别意图 + 确定性参数处理”的工程路径继续验证。评分包含正确澄清 / 拒识；尚不能证明真实 SDK 执行、独立盲测或所有领域的生产可用性。当前先验证单服务中的领域 / API 选择和参数保真，再逐步增加独立留出表达、重复测试及受控提示词 / 模型 / 量化对照。

## 检查与复现

```powershell
cd edge-api-lab
npm test
node scripts/verify-domain-run.mjs
```

第二条检查会重算冻结实测证据并更新本机核验文档，不调用模型。不要把已有结果的重新导出误当作新实测。重新评测、规则回放和新调用验收的入口、覆盖保护及各版本差异，见工程 README 与验收文档。

关闭 Windows 后台服务使用 `edge-api-lab/stop.ps1`。临时日志、PID、缓存、凭据和模型权重不属于发布内容。
