# 项目发布范围与证据说明

## 2026-10-14 最终多轮结果发布

最新批次 `single-service-100-20261013-093b947a-6d72-4e9f-8ae1-d3f6b9480a2d` 已完成四模型 × 十领域 × 每领域100题，正式4000条、Qwen实际8298次模型调用，预热独立。发布本批完整raw、报告、自动审计、稳定公开清单、72文件源码冻结快照，以及Laya复用切换证据和原相对路径下完整seed/cache/service来源。模型权重、虚拟环境、密钥、当前机器的缓存启用配置、PID和临时日志不发布。

216,018,118字节的原索引在本机保持原样；仓库改为发布独立 `evidence/publication-archives/<本批ID>/index.json.gz` 和双层SHA元数据。恢复指令与校验边界见该目录README，恢复后原UI和离线审核器继续读取原 `storage.indexPath`。完整[结果总结](edge-api-lab/docs/single-service-100/single-service-100-20261013-093b947a-6d72-4e9f-8ae1-d3f6b9480a2d/README.md)逐模型、逐领域呈现准确率、每阶段耗时、昨日基线与失败分布。

`PROJECT_MANIFEST.json` 保留其2026-10-13启动发布快照，历史SHA不回写；最终Git发布字节与SHA另登记在 `PROJECT_FINAL_MANIFEST_2026-10-14.json`。下文为先前发布的历史说明，不能把历史快照清单视作最新文件清单。

初始发布日期：2026-10-10；本轮结果更新：2026-10-12。目标仓库：<https://github.com/lulilulili/HeadToTailUICardByDeviceSideLLM>。

本仓库保留工作区中的工程源码、网页、脚本、自动检查、原始方案材料、图片、案例、提示词与源码冻结快照、评测报告、完整回放审计、全部已有 JSON 运行记录和验收证据。

## 原始方案材料

`智能生成业务/` 包含：材料包使用说明、智能生成业务全景图、天气场景端侧智能调用 PoC 技术方案、六个月路线图、HarmonyOS 应用服务 Kit API 扁平化与主动服务可行性报告，以及两张原始图片。它们是规划与研究材料；实现现状和真实成绩以 `edge-api-lab/README.md`、`docs/VERIFICATION.md` 和绑定版本的原始记录为准。

## 历史实验与当前结果

2026-10-12 本轮 `single-service-100-20261012-17ad2cee-68f0-4700-ab84-97cd89343965` 已完成十领域四模型共 4,000 次正式调用，另保存 4 次预热。发布完整原始调用、索引、审核、公开清单、报告，以及推理前冻结的 57 个源码 / 语料文件：

- `edge-api-lab/evidence/single-service-100/<id>/`：4,000 个逐条 JSON、4 个预热 JSON、`index.json`、`audit.json` 和 `public-manifest.json`。
- `edge-api-lab/docs/single-service-100/<id>/results.json`：四模型总体、40 个领域 / 模型组合、示例、环境和计时统计。
- `edge-api-lab/data/benchmark-single-service-100/<id>/`：57 个绑定 SHA-256 的冻结文件。
- `edge-api-lab/docs/RETEST_2026-10-12.md` 与 `TEST_ENVIRONMENT_2026-10-12.md`：完成说明、逐领域比较、硬件及固定模拟手机上下文。

完整离线审核为 `verified_completed`，确认 4,000 条唯一记录、归属、顺序、原始哈希、重新计算的评分、索引与报告一致；审核没有调用模型。结果文件包含原始请求、候选、消息、JSON Schema、响应、模型 digest、token、耗时和资源采样，预热不计正式分母。

为使克隆后的页面直接显示本轮，显式纳入 `edge-api-lab/data/runtime/single-service-100-active.json` 与该批次的 `manifest.json`。发布完成清单与 `public-manifest.json` 一致，移除本机 runner / active / updatedAt 元数据。本地完整进程清单另留在忽略目录，不上传日志或 PID。默认 runtime 忽略规则保持有效。

以下为初始发布的历史记录，不与本轮 4,000 次混算。

`edge-api-lab/data/runtime/` 初始发布包含 2,109 个 `run-*.json`、49 个 `eval-*.json` 以及 3 份 `domain-suite*.json` 清单。记录包含早期尝试、被中断的旧评测、最终正式评测、独立预热和交互 / 验收运行；不能把整个运行历史混成一个准确率分母。

正式六领域四模型结果绑定 `domain-suite.json` 中的清单 `0b5941eb-729e-4e59-9d9d-70f6ae8eed92`，固定 `domain-50-v1`、300 题、24 个领域 / 模型组合、1,200 次调用。原始请求、响应、候选 API、Schema、模型 digest、token 计数和逐次耗时随记录保留。旧轮中断到 548 条的记录与快照另存，不混入该清单。

`data/benchmark-sparse-v6/` 保存正式实测时的源码与语料；`data/benchmark-before-alternatives/` 保存旧轮条件；`data/benchmark-grounding-v1/` 与 `data/benchmark-grounding-v1-final/` 分别保存核对规则的审阅与最终快照。历史 `legacy-v1` 和其他试验也保留。各快照及报告均按自身版本解读。

`docs/grounding-replay-audit.json` 包含全部 1,200 条规则回放的原始提取、修复证据及语义评分。`docs/grounding-replay.json` 是页面使用的轻量报告。规则回放没有重新调用模型，原模型准确率和耗时保持历史口径。

`evidence/` 保存测试输出、页面截图、推理设备条件和 3 次新服务真实调用。截图是交付时的页面状态，不代表未来机器上的推理速度。

## 文件完整性

`PROJECT_MANIFEST.json` 按本次待发布的全部 Git 跟踪文件重新生成，使用相对路径记录字节数和 SHA-256。清单不递归包含自身；Git 元数据也不计入。`.gitattributes` 禁止 Git 自动转换行尾，确保绑定源码哈希的冻结证据在 Windows 与其他平台之间保持原始字节。

可以使用文件 SHA-256 检查下载副本，也可以执行 `node scripts/verify-domain-run.mjs` 核验正式评测中实际提示词、冻结源码、分数和运行副本的一致性。该脚本更新本机核验文档，建议在独立副本中运行。

## 未发布的本机文件

排除服务日志、PID、临时文件、缓存、第三方依赖目录和环境凭据。模型权重不在工程目录中，由 Ollama 独立下载。没有上传浏览器登录状态、系统凭据或用户目录。

已有运行 JSON 作为历史证据显式纳入初始提交；`data/runtime/` 的默认忽略规则仍保留，之后新增本机实验记录不会自动被 Git 收集。如需发布新实验，应先检查数据来源和内容，再显式添加对应记录及清单。

## 2026-10-13 分步路由与本机 Laya

- edge-api-lab/src/adaptive-routing.mjs：两次/三次路径与阶段约束。
- edge-api-lab/src/jev-provider.mjs / laya-provider.mjs：官方云端与本机 choice 分开适配。
- edge-api-lab/integrations/laya/：固定发布依赖和本机启动包装；权重、venv、运行日志不提交。
- edge-api-lab/docs/ADAPTIVE_JEV.md 与 LAYA.md：页面内说明的文档版本。
- edge-api-lab/evidence/adaptive-jev-20261013-local-smoke/、adaptive-jev-20261013-v2-local-smoke/：Qwen两版小样本与源码快照；失败保留。
- edge-api-lab/evidence/laya-smoke-20261013024041271/：本机Laya+Qwen六条真实烟测与源码快照；不是Jev成绩或准确率改善对照。
- edge-api-lab/evidence/laya-20261013-deployment/：实际服务健康状态和已安装作者源码的SHA。
