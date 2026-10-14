# Laya 独立千题选择补测

批次：laya-independent-20261014-646d71bf-aef9-4093-ad37-494b7a484d55。同一冻结1000题（10领域各100），2026-10-14 09:54:22–09:56:28 北京时间执行完成；1000份raw及原生响应来源均通过离线校验。

链路：用户原文与可信context → Laya选领域 → 原adaptive检索规则在Laya自选领域取最多12个业务API（另含unsupported） → Laya选API。Qwen模型调用为0。本批仅测提示词到API选择，不生成参数，也不调用真实业务SDK；不是从417项直接一次选择。期待值只在模型选择返回后评分。

## 总体

- 领域：714/1000（71.4%）。
- API及联合选择：499/1000（49.9%）。
- 正确答案在候选内：499/699（71.39%）。
- 正确领域预算召回：699/714（97.90%）。
- 失败501：领域门控286、正确领域候选漏选15、候选内错选200、提供方/协议错误0。26题首阶段unsupported，跳过API，但仍进入全部1000题的分母。

| 领域 | 领域正确/100 | API正确/100 |
|---|---:|---:|
| 天气 | 70 | 29 |
| 日历 | 92 | 72 |
| 联系人 | 96 | 59 |
| 文件 | 90 | 65 |
| 服务入口 | 67 | 62 |
| 云端业务 | 52 | 38 |
| 设备 | 87 | 68 |
| 网络连接 | 93 | 63 |
| 位置 | 28 | 16 |
| 媒体 | 39 | 27 |

## 计时与复用

1974次逻辑选择（1000领域＋974API）；1792次已验证只读历史复用（1000＋792），182次新的本机推理全部属于API阶段。匹配键是完整native请求字节与九项部署profile，来源记录与请求、响应、文件SHA一并核验。旧文件名中含Qwen模型只表示保存位置，Qwen选择值从未进入独立路由。

- 本轮新API原生推理：182样本，平均388.98ms、P50 387.94ms、P95 468.44ms，累计70.794秒；不是全部API题的均匀冷推理样本。
- 本轮整题访问：平均74.39ms、P50 1.62ms、P95 421.32ms，包含大量客户端复用，不能当作模型速度。
- 按每题实际路径累加已验证来源原生耗时：平均1506.12ms、P50 1436.48ms、P95 2072.58ms。它混合历史CPU竞争条件与本轮新推理，不能称为本轮完整冷推理延迟，也不能用来计算对Qwen的因果速度提升。

部署：Laya multilingual 0.4.6，revision 7b928d828b7b0e022f929d9bd2e44165aa270148，CPU8线程，group16、maxChoices255、maxLen4096、headMaxLen768；本机i7-10700、约31.78GiB、Windows11。完整条件见manifest/environment及页面。该开发集此前用于诊断，各题仅一个独立选择结果，不代表独立盲测泛化率。

## 证据与展示

[正式raw](raw)、[原冻结清单](manifest.json)、[原审计](audit.json)、[结果](results.json)、[环境](environment.json)、[原28文件源码快照](source-snapshot)。

页面：[本机展示](http://127.0.0.1:3210/laya-independent.html)，也可从原evaluation/docs入口进入。完成后发现原inline分页脚本与现有script-src self策略冲突，仅修正展示加载方式；[修正证据](presentation-fix.json)保存前后HTML与新展示模块SHA。原raw、manifest、results、audit和benchmark源码快照保持原字节。当前展示层与原冻结快照的差异是该记录的呈现修复，不能用新源码哈希改写旧快照。

canary e100-calendar-012“帮我看看本周安排”：独立Laya选择calendar，随后只生成calendar候选并选择calendar.search；可在页面搜索该ID查看两阶段原始请求。

重现选择链路需本机Laya就绪，原生输入完全相同且来源校验通过的记录可复用。新模型调用命令：

```powershell
node scripts/benchmark-laya-independent.mjs --new --root . --baseline-manifest evidence/single-service-100/single-service-100-20261013-093b947a-6d72-4e9f-8ae1-d3f6b9480a2d/public-manifest.json --cache-directory data/runtime/laya-reuse/single-service-100-20261013-093b947a-6d72-4e9f-8ae1-d3f6b9480a2d/entries
```

该命令会新建独立批次，不覆盖本批。无需重复运行即可查看已保存页面/JSON。旧权威Qwen和影子Laya数据保留，跨批比较须分清选择准确率与最终执行语义。
