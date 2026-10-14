# Laya 独立千题选择补测实施计划

**Feature:** Laya 提示词到 API 的独立选择补测。
**Goal:** 在原冻结的十领域各100题上，由 Laya 自行选领域、生成候选并选 API，提供独立准确率及分阶段/整请求耗时。
**Acceptance Criteria:** 1000个唯一正式case完整；domain/API决策均来自Laya；API候选依赖Laya域和原检索规则；Qwen调用为0；金标不参与请求构造；记录两阶段请求、响应、候选、计时、来源SHA和环境；独立结果/页面不覆盖旧批次。
**Architecture cell:** edge-api-lab 本机评测工具与纯选择报告。
**Map delta:** none
**Map delta why:** 新增独立补测工具，复用冻结目录、提示与原生提供方。
**Architecture:** 新增独立choice-only流水线，输入只有原文与可信context。沿用adaptive词法候选上限12，在Laya自选领域中生成；Laya原生choice标签与旧影子请求保持一致。复用完整原生输入及部署profile完全相同且来源字节SHA验证的历史响应；缺失才调用当前本机Laya。全部评分在决策后执行。
**Tech Stack:** Node ESM/node:test、现有Laya provider、JSON证据、HTML报告。
**前端验证:** Yes — 独立静态页面与评测入口可见。

## 最终数据与口径

独立输出目录包含manifest.json、raw/<case>.json、results.json、audit.json、环境和源码快照；public/laya-independent.json及HTML是纯投影。单条记录包括caseId/testDomain/text/context/expected、selection（domain/api/candidates/traces/totalMs）和score。domain全1000分母；API全1000、答案可达子集、domain/API联合选择分别统计，不使用最终填参语义。API错误拆分为领域门控、正确领域预算漏选、候选内错选和提供方/协议失败。

实际访问HTTP与当前整题wall单列。当前原生推理只包含未复用的调用；历史来源原生推理单列，可计算每题来源推理耗时之和，但明确不是本轮完整冷推理实测；缺失保持null。每阶段及整题报告平均/P50/P95/累计，并保留样本数与复用计数。不得用缓存毫秒代表模型推理速度。

## 任务与职责

1. Runner/流水线：先用错误领域/缺候选/unsupported/取消/错误/金标泄漏/恢复重复的失败测试，新增独立工具和CLI。只接收Laya provider，不得调用Ollama或读取Qwen选择结果。
2. 已验证复用：只读旧entry以及其formal或service来源，检查request/response/source字节SHA、profile、协议；失败应停止或明确无效并新推理，不能静默使用。活跃旧批清单及服务配置不修改。
3. 报告页面：纯投影展示整体、领域、错误归因、两阶段与整请求耗时、当前推理/历史来源/读取区分、环境与来源链接。
4. root核验：核对冻结语料SHA/1000唯一、原1000题同序、全请求无expected数据、所有API候选域来自Laya域、0 Qwen调用、复用来源和重评分；生成独立审计，呈现页面及实际结果。

## 生命周期及恢复

唯一owner是CLI runner。planned→running→completed；运行异常→failed；显式中止→cancelled；resume仅接受相同语料/源码/profile/选项且已保存raw可复核。每raw不可变写入，manifest/report由raw纯投影；先raw后进度。completed要求1000且全部归属/分数/来源/计时验证通过。独占lock阻止并发runner；残留lock不能自动覆盖活进程。

不变量：INV1选择请求不含gold（检查native state/questions）；INV2后续domain等于Laya第一阶段有效选择（污染Qwen对照测试）；INV3候选ID及顺序由被冻结的目录/检索决定；INV4每case唯一且resume不重复推理；INV5历史来源SHA有效才计复用；INV6缓存wall不进入当前原生推理分位；INV7旧raw/基线/评分保持字节不变。

对抗验证：raw写入后进度未保存可恢复；重复启动拒绝；context/语料改动拒绝resume；响应来源篡改不计可信复用；unsupported域跳过API；无效协议/超时落盘为错误而非正确；部分批次报告显式进度不伪称完成。
