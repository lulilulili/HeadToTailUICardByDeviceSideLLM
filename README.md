# HeadToTailUICardByDeviceSideLLM

端侧小模型驱动的语义 API 调用验证工程，以及智能生成业务的研究与规划材料。

第一阶段验证流程：中文提示词 → 领域划分 → 对象字段 / 操作 API 识别 → 显式参数提取 → 确定性原文核对与系统状态补全 → 时间 / 地点解析与精度降级 → 伪 API 回执。业务接口目前全部模拟；Jev 预留逐次替换模型调用的 HTTP 桥接接口。

## 快速启动

需要 Node.js 22 或更新版本。查看已有报告不需要重新评测；实际模型调用需要本机 Ollama 和对应模型。

```powershell
git clone https://github.com/lulilulili/HeadToTailUICardByDeviceSideLLM.git
cd HeadToTailUICardByDeviceSideLLM
```

Windows 双击根目录的 [启动API验证工程.bat](启动API验证工程.bat)，自动启动服务并打开 http://127.0.0.1:3210。也可以在 `edge-api-lab` 中执行 `npm start`，再打开上述页面。工程没有第三方 npm 依赖，不需要先执行 `npm install`。

首次实际推理前，可通过 Ollama 准备四档模型：

```powershell
ollama pull qwen2.5:0.5b
ollama pull qwen2.5:1.5b
ollama pull qwen2.5:3b
ollama pull qwen2.5:7b
```

模型权重由 Ollama 管理，不随本仓库上传。实测所用模型 digest、量化规格、机器条件和逐次调用耗时已保存在评测记录中；同名模型未来下载可能与原 digest 不同。

页面提供实验台、批量评测、能力目录、运行记录和详细说明；说明内有 13 个页签。初始提交保留全部已有 JSON 运行记录，首次启动即可展示历史结果。新增本机运行记录默认忽略，避免日常实验自动进入版本管理。

## 内容导航

| 目录 / 文件 | 内容 |
|---|---|
| [edge-api-lab/README.md](edge-api-lab/README.md) | 工程使用、契约、参数补全、评测和 Jev 说明 |
| [edge-api-lab/src/](edge-api-lab/src/) / [public/](edge-api-lab/public/) | 后端、API 目录、提示词、规则处理、评分和网页 |
| [edge-api-lab/tests/](edge-api-lab/tests/) / [scripts/](edge-api-lab/scripts/) | 自动检查、批量实测、证据核验和规则回放 |
| [edge-api-lab/data/](edge-api-lab/data/) | 478 条案例、冻结源码 / 语料快照、原始模型调用与批次记录 |
| [edge-api-lab/docs/VERIFICATION.md](edge-api-lab/docs/VERIFICATION.md) | 当前与历史验收口径、真实调用和页面证据 |
| [edge-api-lab/docs/DOMAIN_EVALUATION_RESULTS.md](edge-api-lab/docs/DOMAIN_EVALUATION_RESULTS.md) | 六领域 × 四模型的准确率、耗时与错误分析 |
| [edge-api-lab/docs/grounding-replay.json](edge-api-lab/docs/grounding-replay.json) / [完整审计](edge-api-lab/docs/grounding-replay-audit.json) | 同一批 1,200 条输出的确定性规则回放及逐条对照 |
| [edge-api-lab/evidence/](edge-api-lab/evidence/) | 页面截图、自动检查输出、CPU 条件和新增真实模型调用 |
| [智能生成业务/](智能生成业务/) | 原始业务全景、天气 PoC、六个月路线图、HarmonyOS API 可行性报告和两张图 |
| [REPOSITORY_CONTENTS.md](REPOSITORY_CONTENTS.md) / [PROJECT_MANIFEST.json](PROJECT_MANIFEST.json) | 发布范围、复现方式及文件 SHA-256 校验清单 |

## 当前结果与适用范围

工程覆盖天气、日历、联系人、文件、服务链接、云端业务六领域，共 372 个伪 API。固定 300 条领域案例（每领域 50 条）分别使用 Qwen2.5 0.5B / 1.5B / 3B / 7B 实测，共 1,200 次正式调用，另有独立预热。

| 指标 | 通过 / 1,200 | 准确率 |
|---|---:|---:|
| 历史严格参数提取 | 659 | 54.92% |
| 历史严格完整计划 | 580 | 48.33% |
| 旧执行语义 | 621 | 51.75% |
| 原文核对后的执行语义 | 811 | 67.58% |

核对后改善 190 条、退步 0 条。后两项来自同一冻结模型输出的规则回放，新增模型调用 0 次，不改写原模型成绩或耗时。当前自动检查 264 项通过，另有 3 次新服务真实调用验收。各领域与模型差异、错误来源及证据边界见验收文档和页面。

这些结果支持“小模型识别意图 + 确定性参数处理”的第一阶段工程路径继续验证。当前使用已参与优化的开发集，业务回执为模拟结果，评分包含正确澄清 / 拒识；尚不能证明真实 SDK 执行、独立盲测或所有领域的生产可用性。下一阶段应使用独立留出表达、接入真实数据源并验证多轮补槽。

## 检查与复现

```powershell
cd edge-api-lab
npm test
node scripts/verify-domain-run.mjs
```

第二条检查会重算冻结实测证据并更新本机核验文档，不调用模型。不要把已有结果的重新导出误当作新实测。重新评测、规则回放和新调用验收的入口、覆盖保护及各版本差异，见工程 README 与验收文档。

关闭 Windows 后台服务使用 `edge-api-lab/stop.ps1`。临时日志、PID、缓存、凭据和模型权重不属于发布内容。
