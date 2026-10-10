# 六领域 × 四模型：每领域 50 条新增用例实测

状态：completed；1200/1200 次完成。开始 2026-10-10T04:58:00.282Z；结束 2026-10-10T06:09:15.574Z。

## 测试范围与评分

原有 178 条开发用例保留，新增 300 条手工金标：每领域 50 条。这里只统计新增题组 domain-50-v1，不混入历史结果。每题覆盖一种明确的条件，另存 scenario、category、note、上下文、期望 API/明确入参/状态/来源和已标注精度。

- 每领域新增 50 条，使用同一套人工金标；拒识用例仍归所属测试领域。
- 准确率分母为已完成样本，调用/结构失败计为错误；未运行数值留空。
- 耗时为单条处理 totalMs 的中位数/P95，不含队列等待；每模型首次预热另存且不计分。
- 完整计划要求领域、API、明确入参、状态、标注来源和精度均正确。
- 主错因按调用→领域→候选/API→入参→补全/精度→状态顺序互斥归类，仅表示可观察错误证据。
- 人工边界测试集不代表真实用户分布；这是单次确定性运行、同一 Qwen 家族和本机 CPU 的结果。

准确率使用严格契约匹配：等价的默认值若被模型当作“用户明确提供”输出，也计为参数错误；原时间表达被模型自行改写计为值错误。合法 JSON 并不代表契约或调用计划正确。对明确求完整对象的用例，父对象和叶字段不互换。

P50 是耗时中位数，P95 是较慢请求的参考：按耗时排序后，用线性插值计算 50% 和 95% 百分位。近似可理解为一半/95% 的请求在对应时间内完成；有限样本不保证实际恰有该比例。耗时单元为秒，整条处理含模型和解析、不含队列与预热。单次调用的 wall/load/prompt/generation 耗时、token 数和原始输出均在运行记录。

## 冻结运行条件

| 项目 | 值 |
| --- | --- |
| 模式 | unified |
| 模型 | qwen2.5:0.5b / qwen2.5:1.5b / qwen2.5:3b / qwen2.5:7b |
| 参数 | temperature=0；num_ctx=2048；单轮输出上限=224；每题1次 |
| 提示词 / 目录 | sparse-v6 / object-fields-v2 |
| Ollama / Node | 0.35.0 / v25.2.1 |
| CPU / 内存 | Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz / 32 GB |
| 位置/时间 | 2026-10-10T08:00:00+08:00，Asia/Shanghai，上海固定坐标夹具；逐题覆写另存 |
| 预热 | 每个模型第一次领域批次前单独预热，不计分 |

模型实际规格/量化/digest 与用例和关键源码 SHA256 见 validation-domain-50.json 的 conditions；完整原始批次为 data/runtime/eval-<jobId>.json，单条记录为 run-<runId>.json。

## 各模型总体结果

| 模型 | 题数 | 领域 | API | 明确入参 | 完整计划 | P50秒 | P95秒 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| qwen2.5:0.5b | 300 | 84.3% | 71.7% | 45.3% | 37.3% | 1.11 | 1.77 |
| qwen2.5:1.5b | 300 | 90.0% | 83.3% | 48.0% | 42.0% | 1.87 | 2.86 |
| qwen2.5:3b | 300 | 88.0% | 80.0% | 57.0% | 49.7% | 3.50 | 5.85 |
| qwen2.5:7b | 300 | 91.7% | 84.7% | 69.3% | 64.3% | 7.67 | 12.86 |

## 每领域、每模型对照

| 测试领域 | 模型 | 完成/50 | 领域 | API | 明确入参 | 状态 | 完整计划 | P50秒 | P95秒 | 调用异常 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 天气 | qwen2.5:0.5b | 50/50 | 92.0% | 86.0% | 50.0% | 82.0% | 46.0% | 1.50 | 1.82 | 1 |
| 天气 | qwen2.5:1.5b | 50/50 | 96.0% | 94.0% | 16.0% | 92.0% | 14.0% | 2.32 | 2.93 | 0 |
| 天气 | qwen2.5:3b | 50/50 | 96.0% | 90.0% | 68.0% | 94.0% | 68.0% | 5.17 | 6.54 | 0 |
| 天气 | qwen2.5:7b | 50/50 | 98.0% | 94.0% | 68.0% | 84.0% | 68.0% | 11.38 | 14.01 | 0 |
| 日历 | qwen2.5:0.5b | 50/50 | 88.0% | 70.0% | 32.0% | 74.0% | 24.0% | 1.31 | 2.01 | 0 |
| 日历 | qwen2.5:1.5b | 50/50 | 94.0% | 86.0% | 58.0% | 84.0% | 54.0% | 2.08 | 3.05 | 0 |
| 日历 | qwen2.5:3b | 50/50 | 94.0% | 90.0% | 44.0% | 74.0% | 40.0% | 3.72 | 5.24 | 0 |
| 日历 | qwen2.5:7b | 50/50 | 94.0% | 86.0% | 66.0% | 78.0% | 62.0% | 8.50 | 10.46 | 0 |
| 联系人 | qwen2.5:0.5b | 50/50 | 92.0% | 68.0% | 56.0% | 84.0% | 46.0% | 1.15 | 1.78 | 0 |
| 联系人 | qwen2.5:1.5b | 50/50 | 94.0% | 84.0% | 64.0% | 78.0% | 58.0% | 1.91 | 2.65 | 0 |
| 联系人 | qwen2.5:3b | 50/50 | 94.0% | 76.0% | 62.0% | 84.0% | 56.0% | 3.73 | 4.96 | 0 |
| 联系人 | qwen2.5:7b | 50/50 | 94.0% | 86.0% | 84.0% | 94.0% | 80.0% | 8.24 | 10.83 | 0 |
| 文件 | qwen2.5:0.5b | 50/50 | 82.0% | 68.0% | 52.0% | 62.0% | 40.0% | 0.78 | 1.56 | 0 |
| 文件 | qwen2.5:1.5b | 50/50 | 86.0% | 86.0% | 52.0% | 60.0% | 48.0% | 1.53 | 2.55 | 0 |
| 文件 | qwen2.5:3b | 50/50 | 86.0% | 86.0% | 72.0% | 74.0% | 60.0% | 2.54 | 4.30 | 0 |
| 文件 | qwen2.5:7b | 50/50 | 92.0% | 92.0% | 80.0% | 84.0% | 76.0% | 5.61 | 9.67 | 0 |
| 服务入口 | qwen2.5:0.5b | 50/50 | 76.0% | 68.0% | 60.0% | 70.0% | 48.0% | 0.69 | 1.52 | 0 |
| 服务入口 | qwen2.5:1.5b | 50/50 | 82.0% | 76.0% | 60.0% | 60.0% | 52.0% | 1.47 | 2.62 | 0 |
| 服务入口 | qwen2.5:3b | 50/50 | 80.0% | 76.0% | 66.0% | 68.0% | 56.0% | 2.47 | 4.93 | 0 |
| 服务入口 | qwen2.5:7b | 50/50 | 80.0% | 74.0% | 72.0% | 76.0% | 60.0% | 5.35 | 11.15 | 0 |
| 云端业务 | qwen2.5:0.5b | 50/50 | 76.0% | 70.0% | 22.0% | 66.0% | 20.0% | 0.95 | 1.73 | 1 |
| 云端业务 | qwen2.5:1.5b | 50/50 | 88.0% | 74.0% | 38.0% | 58.0% | 26.0% | 1.75 | 2.61 | 0 |
| 云端业务 | qwen2.5:3b | 50/50 | 78.0% | 62.0% | 30.0% | 56.0% | 18.0% | 3.17 | 5.59 | 0 |
| 云端业务 | qwen2.5:7b | 50/50 | 92.0% | 76.0% | 46.0% | 72.0% | 40.0% | 6.77 | 12.58 | 0 |

## 错误来源与排查顺序

每条失败仅分配一个主错因，按调用链中最早可观察失败归类：调用/结构输出 → 领域/拒识 → 目标候选缺失或选错 → 多填/漏填/值错 → 来源/精度补全 → 状态。一次上游错误引发的 API、入参、状态连带错误不重复计数。若领域被错误拒识，API 遗漏只作次级证据；“领域或拒识”并不能单独证明模型的内部领域判断出错。

目标 API 不在候选列表属于检索层证据；候选存在却选错属于 API 选择证据。参数检查按递归字段路径比较。多填、漏填、值错可以同时发生，主因按该顺序取一个，原始逐项分数仍完整保留。该归因是工程定位规则，不是模型内部因果证明。

| 模型 | 主错因 | 数量 |
| --- | --- | --- |
| qwen2.5:0.5b | 多填或猜测入参 | 63 |
| qwen2.5:0.5b | 领域或拒识错误 | 45 |
| qwen2.5:0.5b | 候选内 API 选错 | 38 |
| qwen2.5:0.5b | 遗漏明确入参 | 29 |
| qwen2.5:0.5b | 入参值或类型错误 | 11 |
| qwen2.5:0.5b | 调用或结构输出失败 | 2 |
| qwen2.5:1.5b | 遗漏明确入参 | 78 |
| qwen2.5:1.5b | 领域或拒识错误 | 30 |
| qwen2.5:1.5b | 多填或猜测入参 | 30 |
| qwen2.5:1.5b | 候选内 API 选错 | 20 |
| qwen2.5:1.5b | 入参值或类型错误 | 16 |
| qwen2.5:3b | 遗漏明确入参 | 47 |
| qwen2.5:3b | 领域或拒识错误 | 36 |
| qwen2.5:3b | 多填或猜测入参 | 35 |
| qwen2.5:3b | 候选内 API 选错 | 24 |
| qwen2.5:3b | 入参值或类型错误 | 9 |
| qwen2.5:7b | 遗漏明确入参 | 30 |
| qwen2.5:7b | 领域或拒识错误 | 25 |
| qwen2.5:7b | 候选内 API 选错 | 21 |
| qwen2.5:7b | 多填或猜测入参 | 20 |
| qwen2.5:7b | 入参值或类型错误 | 11 |

### 天气：具体情况

50 条，17 个场景类别。当前主要错误：遗漏明确入参 57 次；入参值或类型错误 26 次；候选内 API 选错 9 次。

| 场景 | 模型 | 完成/目标 | 完整计划 | P50秒 | 主错因 |
| --- | --- | --- | --- | --- | --- |
| basic_field | qwen2.5:0.5b | 6/6 | 83.3% | 1.51 | 遗漏明确入参 1 |
| system_defaults | qwen2.5:0.5b | 3/3 | 33.3% | 0.47 | 遗漏明确入参 1；入参值或类型错误 1 |
| compound_object | qwen2.5:0.5b | 1/1 | 0.0% | 1.24 | 遗漏明确入参 1 |
| nested_field | qwen2.5:0.5b | 12/12 | 83.3% | 1.62 | 遗漏明确入参 1；入参值或类型错误 1 |
| precision | qwen2.5:0.5b | 6/6 | 0.0% | 1.48 | 入参值或类型错误 2；遗漏明确入参 2；候选内 API 选错 2 |
| relative_time | qwen2.5:0.5b | 3/3 | 100.0% | 1.56 |  |
| explicit_time | qwen2.5:0.5b | 1/1 | 100.0% | 0.59 |  |
| boundary | qwen2.5:0.5b | 3/3 | 0.0% | 0.89 | 遗漏明确入参 3 |
| multifield | qwen2.5:0.5b | 3/3 | 0.0% | 1.71 | 候选内 API 选错 1；遗漏明确入参 2 |
| coordinates | qwen2.5:0.5b | 2/2 | 0.0% | 1.08 | 调用或结构输出失败 1；遗漏明确入参 1 |
| environment_failure | qwen2.5:0.5b | 2/2 | 100.0% | 0.49 |  |
| ambiguity | qwen2.5:0.5b | 1/1 | 0.0% | 0.64 | 入参值或类型错误 1 |
| availability | qwen2.5:0.5b | 3/3 | 0.0% | 0.65 | 遗漏明确入参 3 |
| refusal | qwen2.5:0.5b | 1/1 | 0.0% | 0.66 | 领域或拒识错误 1 |
| injection | qwen2.5:0.5b | 1/1 | 0.0% | 1.73 | 领域或拒识错误 1 |
| multi_intent | qwen2.5:0.5b | 1/1 | 0.0% | 2.24 | 领域或拒识错误 1 |
| wording | qwen2.5:0.5b | 1/1 | 100.0% | 1.83 |  |
| basic_field | qwen2.5:1.5b | 6/6 | 16.7% | 2.38 | 遗漏明确入参 5 |
| system_defaults | qwen2.5:1.5b | 3/3 | 33.3% | 2.19 | 遗漏明确入参 2 |
| compound_object | qwen2.5:1.5b | 1/1 | 0.0% | 2.05 | 遗漏明确入参 1 |
| nested_field | qwen2.5:1.5b | 12/12 | 8.3% | 2.72 | 遗漏明确入参 10；入参值或类型错误 1 |
| precision | qwen2.5:1.5b | 6/6 | 16.7% | 2.38 | 入参值或类型错误 1；遗漏明确入参 4 |
| relative_time | qwen2.5:1.5b | 3/3 | 0.0% | 2.41 | 遗漏明确入参 2；入参值或类型错误 1 |
| explicit_time | qwen2.5:1.5b | 1/1 | 0.0% | 2.72 | 入参值或类型错误 1 |
| boundary | qwen2.5:1.5b | 3/3 | 0.0% | 1.19 | 遗漏明确入参 1；入参值或类型错误 2 |
| multifield | qwen2.5:1.5b | 3/3 | 0.0% | 2.59 | 候选内 API 选错 1；遗漏明确入参 2 |
| coordinates | qwen2.5:1.5b | 2/2 | 0.0% | 1.86 | 遗漏明确入参 2 |
| environment_failure | qwen2.5:1.5b | 2/2 | 50.0% | 0.83 | 遗漏明确入参 1 |
| ambiguity | qwen2.5:1.5b | 1/1 | 0.0% | 1.18 | 入参值或类型错误 1 |
| availability | qwen2.5:1.5b | 3/3 | 33.3% | 1.30 | 遗漏明确入参 1；入参值或类型错误 1 |
| refusal | qwen2.5:1.5b | 1/1 | 0.0% | 0.84 | 领域或拒识错误 1 |
| injection | qwen2.5:1.5b | 1/1 | 100.0% | 2.14 |  |
| multi_intent | qwen2.5:1.5b | 1/1 | 0.0% | 1.64 | 领域或拒识错误 1 |
| wording | qwen2.5:1.5b | 1/1 | 0.0% | 2.58 | 遗漏明确入参 1 |
| basic_field | qwen2.5:3b | 6/6 | 83.3% | 5.33 | 遗漏明确入参 1 |
| system_defaults | qwen2.5:3b | 3/3 | 33.3% | 4.54 | 遗漏明确入参 2 |
| compound_object | qwen2.5:3b | 1/1 | 100.0% | 4.72 |  |
| nested_field | qwen2.5:3b | 12/12 | 83.3% | 5.67 | 候选内 API 选错 1；遗漏明确入参 1 |
| precision | qwen2.5:3b | 6/6 | 66.7% | 5.38 | 入参值或类型错误 1；遗漏明确入参 1 |
| relative_time | qwen2.5:3b | 3/3 | 100.0% | 5.55 |  |
| explicit_time | qwen2.5:3b | 1/1 | 100.0% | 6.18 |  |
| boundary | qwen2.5:3b | 3/3 | 66.7% | 2.79 | 候选内 API 选错 1 |
| multifield | qwen2.5:3b | 3/3 | 100.0% | 5.73 |  |
| coordinates | qwen2.5:3b | 2/2 | 0.0% | 3.47 | 遗漏明确入参 2 |
| environment_failure | qwen2.5:3b | 2/2 | 50.0% | 1.37 | 遗漏明确入参 1 |
| ambiguity | qwen2.5:3b | 1/1 | 100.0% | 2.02 |  |
| availability | qwen2.5:3b | 3/3 | 33.3% | 2.50 | 入参值或类型错误 2 |
| refusal | qwen2.5:3b | 1/1 | 0.0% | 1.59 | 领域或拒识错误 1 |
| injection | qwen2.5:3b | 1/1 | 100.0% | 4.44 |  |
| multi_intent | qwen2.5:3b | 1/1 | 0.0% | 5.51 | 领域或拒识错误 1 |
| wording | qwen2.5:3b | 1/1 | 0.0% | 5.09 | 候选内 API 选错 1 |
| basic_field | qwen2.5:7b | 6/6 | 83.3% | 11.49 | 遗漏明确入参 1 |
| system_defaults | qwen2.5:7b | 3/3 | 66.7% | 10.90 | 入参值或类型错误 1 |
| compound_object | qwen2.5:7b | 1/1 | 100.0% | 10.16 |  |
| nested_field | qwen2.5:7b | 12/12 | 75.0% | 12.63 | 入参值或类型错误 2；候选内 API 选错 1 |
| precision | qwen2.5:7b | 6/6 | 66.7% | 11.30 | 入参值或类型错误 2 |
| relative_time | qwen2.5:7b | 3/3 | 100.0% | 12.04 |  |
| explicit_time | qwen2.5:7b | 1/1 | 0.0% | 14.64 | 入参值或类型错误 1 |
| boundary | qwen2.5:7b | 3/3 | 66.7% | 6.04 | 入参值或类型错误 1 |
| multifield | qwen2.5:7b | 3/3 | 33.3% | 12.81 | 候选内 API 选错 1；入参值或类型错误 1 |
| coordinates | qwen2.5:7b | 2/2 | 0.0% | 8.08 | 遗漏明确入参 1；入参值或类型错误 1 |
| environment_failure | qwen2.5:7b | 2/2 | 100.0% | 3.67 |  |
| ambiguity | qwen2.5:7b | 1/1 | 100.0% | 4.40 |  |
| availability | qwen2.5:7b | 3/3 | 33.3% | 5.07 | 入参值或类型错误 1；多填或猜测入参 1 |
| refusal | qwen2.5:7b | 1/1 | 0.0% | 3.35 | 领域或拒识错误 1 |
| injection | qwen2.5:7b | 1/1 | 100.0% | 10.75 |  |
| multi_intent | qwen2.5:7b | 1/1 | 100.0% | 7.06 |  |
| wording | qwen2.5:7b | 1/1 | 100.0% | 13.34 |  |

**遗漏明确入参**（本领域共 57 次）

样例 d50-weather-015 / qwen2.5:0.5b / basic_field：深圳未来12小时逐小时降水量

遗漏用户明确给出的入参：location。

```json
{
  "expected": {
    "domain": "weather",
    "api": "weather.hourly.precipitationAmount",
    "arguments": {
      "location": "深圳",
      "time_ref": "未来12小时"
    },
    "status": "ready_mock"
  },
  "actual": {
    "domain": "weather",
    "api": "weather.hourly.precipitationAmount",
    "arguments": {
      "time_ref": "未来12小时"
    },
    "status": "ready_mock"
  },
  "runId": "8e06144b-fef2-4226-947b-6cf63b0093b3"
}
```

**入参值或类型错误**（本领域共 26 次）

样例 d50-weather-037 / qwen2.5:0.5b / system_defaults：今天白天湿度预报

入参值、类型或保留原文不一致：time_ref。

```json
{
  "expected": {
    "domain": "weather",
    "api": "weather.daily.daytimeForecast.humidity",
    "arguments": {
      "time_ref": "今天"
    },
    "status": "ready_mock",
    "sources": {
      "location": "system_location",
      "time_ref": "system_time"
    }
  },
  "actual": {
    "domain": "weather",
    "api": "weather.daily.daytimeForecast.humidity",
    "arguments": {
      "time_ref": "今天白天"
    },
    "status": "needs_clarification"
  },
  "runId": "7cc1e53f-fdfd-4d19-817f-4f597c4eab4b"
}
```

**候选内 API 选错**（本领域共 9 次）

样例 d50-weather-028 / qwen2.5:0.5b / precision：深圳今天逐小时潮汐高度

预期 weather.tides.hourlyTides.height，实际 weather.tides.hourlyTides；目标候选存在或无候选证据。

```json
{
  "expected": {
    "domain": "weather",
    "api": "weather.tides.hourlyTides.height",
    "arguments": {
      "location": "深圳",
      "time_ref": "今天"
    },
    "status": "ready_mock",
    "resolution": {
      "time": {
        "requested": {
          "dataset": "tides",
          "precision": "day"
        },
        "effective": {
          "dataset": "tides",
          "precision": "hour"
        },
        "fallback": {
          "applied": false
        }
      }
    }
  },
  "actual": {
    "domain": "weather",
    "api": "weather.tides.hourlyTides",
    "arguments": {
      "location": "深圳",
      "time_ref": "今天"
    },
    "status": "ready_mock"
  },
  "runId": "14af4a34-85ef-46d1-bc8d-5eeb2264d18d"
}
```

**领域或拒识错误**（本领域共 8 次）

样例 d50-weather-047 / qwen2.5:0.5b / refusal：把上海室外气温调到25度

预期领域 unsupported，实际 weather；后续误差不重复作为主因。

```json
{
  "expected": {
    "domain": "unsupported",
    "api": null,
    "arguments": {},
    "status": "unsupported"
  },
  "actual": {
    "domain": "weather",
    "api": "weather.current.temperature",
    "arguments": {
      "location": "上海"
    },
    "status": "ready_mock"
  },
  "runId": "e1b0d9e3-8d12-4c6d-b0bc-ef76d81a3384"
}
```

**调用或结构输出失败**（本领域共 1 次）

样例 d50-weather-035 / qwen2.5:0.5b / coordinates：查看纬度31.2经度121.5处当前湿度

输出 schema 结构校验失败：$: does not match exactly one schema branch

```json
{
  "expected": {
    "domain": "weather",
    "api": "weather.current.humidity",
    "arguments": {
      "coordinates": {
        "latitude": 31.2,
        "longitude": 121.5
      },
      "time_ref": "当前"
    },
    "status": "ready_mock",
    "sources": {
      "location": "user"
    },
    "resolution": {
      "location": {
        "precision": "coordinates",
        "effective": {
          "source": "user"
        },
        "fallback": {
          "applied": false
        }
      }
    }
  },
  "actual": {
    "domain": null,
    "api": null,
    "arguments": {},
    "status": "error"
  },
  "runId": "be5a1d2e-95ee-4957-8b07-356a6863d4e2"
}
```

**多填或猜测入参**（本领域共 1 次）

样例 d50-weather-043 / qwen2.5:7b / availability：北京未来40分钟每分钟降水总览，可以降精度

出现提示词金标之外的明确入参：strict_time。系统状态应由解析器补全。

```json
{
  "expected": {
    "domain": "weather",
    "api": "weather.minute.overview",
    "arguments": {
      "location": "北京",
      "time_ref": "未来40分钟每分钟"
    },
    "status": "ready_mock",
    "resolution": {
      "time": {
        "requested": {
          "dataset": "minute",
          "precision": "minute"
        },
        "effective": {
          "dataset": "hourly",
          "precision": "hour"
        },
        "fallback": {
          "applied": true
        }
      }
    }
  },
  "actual": {
    "domain": "weather",
    "api": "weather.minute.overview",
    "arguments": {
      "location": "北京",
      "time_ref": "未来40分钟",
      "strict_time": true
    },
    "status": "needs_clarification"
  },
  "runId": "558b1505-0dd7-4538-bac6-b224d4a3e131"
}
```

### 日历：具体情况

50 条，21 个场景类别。当前主要错误：多填或猜测入参 41 次；遗漏明确入参 28 次；候选内 API 选错 19 次。

| 场景 | 模型 | 完成/目标 | 完整计划 | P50秒 | 主错因 |
| --- | --- | --- | --- | --- | --- |
| system_defaults | qwen2.5:0.5b | 1/1 | 0.0% | 1.58 | 候选内 API 选错 1 |
| relative_time | qwen2.5:0.5b | 1/1 | 0.0% | 0.74 | 候选内 API 选错 1 |
| search | qwen2.5:0.5b | 3/3 | 33.3% | 1.25 | 候选内 API 选错 2 |
| explicit_time | qwen2.5:0.5b | 2/2 | 0.0% | 1.33 | 多填或猜测入参 2 |
| wording | qwen2.5:0.5b | 3/3 | 33.3% | 1.34 | 领域或拒识错误 1；候选内 API 选错 1 |
| basic_field | qwen2.5:0.5b | 5/5 | 60.0% | 1.10 | 候选内 API 选错 1；遗漏明确入参 1 |
| selected_object | qwen2.5:0.5b | 3/3 | 0.0% | 1.29 | 多填或猜测入参 2；领域或拒识错误 1 |
| nested_field | qwen2.5:0.5b | 6/6 | 50.0% | 1.34 | 多填或猜测入参 2；领域或拒识错误 1 |
| compound_object | qwen2.5:0.5b | 2/2 | 0.0% | 1.45 | 候选内 API 选错 1；多填或猜测入参 1 |
| multifield | qwen2.5:0.5b | 1/1 | 0.0% | 1.49 | 多填或猜测入参 1 |
| create | qwen2.5:0.5b | 3/3 | 0.0% | 2.26 | 多填或猜测入参 3 |
| boundary | qwen2.5:0.5b | 3/3 | 33.3% | 1.33 | 多填或猜测入参 1；候选内 API 选错 1 |
| missing_target | qwen2.5:0.5b | 5/5 | 20.0% | 0.97 | 多填或猜测入参 4 |
| ambiguity | qwen2.5:0.5b | 1/1 | 0.0% | 1.34 | 多填或猜测入参 1 |
| conflict | qwen2.5:0.5b | 1/1 | 0.0% | 1.44 | 入参值或类型错误 1 |
| update | qwen2.5:0.5b | 2/2 | 0.0% | 1.50 | 候选内 API 选错 1；入参值或类型错误 1 |
| write_target | qwen2.5:0.5b | 4/4 | 50.0% | 1.32 | 遗漏明确入参 1；多填或猜测入参 1 |
| environment_failure | qwen2.5:0.5b | 1/1 | 0.0% | 1.13 | 多填或猜测入参 1 |
| refusal | qwen2.5:0.5b | 1/1 | 0.0% | 0.66 | 领域或拒识错误 1 |
| injection | qwen2.5:0.5b | 1/1 | 0.0% | 0.61 | 领域或拒识错误 1 |
| multi_intent | qwen2.5:0.5b | 1/1 | 0.0% | 0.55 | 领域或拒识错误 1 |
| system_defaults | qwen2.5:1.5b | 1/1 | 100.0% | 2.11 |  |
| relative_time | qwen2.5:1.5b | 1/1 | 0.0% | 1.05 | 入参值或类型错误 1 |
| search | qwen2.5:1.5b | 3/3 | 0.0% | 2.25 | 候选内 API 选错 3 |
| explicit_time | qwen2.5:1.5b | 2/2 | 50.0% | 2.34 | 多填或猜测入参 1 |
| wording | qwen2.5:1.5b | 3/3 | 33.3% | 2.50 | 入参值或类型错误 1；候选内 API 选错 1 |
| basic_field | qwen2.5:1.5b | 5/5 | 80.0% | 1.94 | 遗漏明确入参 1 |
| selected_object | qwen2.5:1.5b | 3/3 | 100.0% | 1.93 |  |
| nested_field | qwen2.5:1.5b | 6/6 | 100.0% | 2.09 |  |
| compound_object | qwen2.5:1.5b | 2/2 | 100.0% | 2.09 |  |
| multifield | qwen2.5:1.5b | 1/1 | 100.0% | 2.17 |  |
| create | qwen2.5:1.5b | 3/3 | 0.0% | 3.31 | 遗漏明确入参 2；多填或猜测入参 1 |
| boundary | qwen2.5:1.5b | 3/3 | 66.7% | 1.68 | 入参值或类型错误 1 |
| missing_target | qwen2.5:1.5b | 5/5 | 40.0% | 1.40 | 多填或猜测入参 3 |
| ambiguity | qwen2.5:1.5b | 1/1 | 0.0% | 2.17 | 多填或猜测入参 1 |
| conflict | qwen2.5:1.5b | 1/1 | 0.0% | 1.27 | 遗漏明确入参 1 |
| update | qwen2.5:1.5b | 2/2 | 50.0% | 2.50 | 入参值或类型错误 1 |
| write_target | qwen2.5:1.5b | 4/4 | 75.0% | 2.02 | 多填或猜测入参 1 |
| environment_failure | qwen2.5:1.5b | 1/1 | 0.0% | 2.33 | 多填或猜测入参 1 |
| refusal | qwen2.5:1.5b | 1/1 | 0.0% | 0.79 | 领域或拒识错误 1 |
| injection | qwen2.5:1.5b | 1/1 | 0.0% | 1.08 | 领域或拒识错误 1 |
| multi_intent | qwen2.5:1.5b | 1/1 | 0.0% | 1.34 | 领域或拒识错误 1 |
| system_defaults | qwen2.5:3b | 1/1 | 100.0% | 3.98 |  |
| relative_time | qwen2.5:3b | 1/1 | 100.0% | 1.58 |  |
| search | qwen2.5:3b | 3/3 | 33.3% | 4.05 | 候选内 API 选错 1；遗漏明确入参 1 |
| explicit_time | qwen2.5:3b | 2/2 | 0.0% | 3.74 | 多填或猜测入参 1；遗漏明确入参 1 |
| wording | qwen2.5:3b | 3/3 | 33.3% | 4.23 | 遗漏明确入参 2 |
| basic_field | qwen2.5:3b | 5/5 | 80.0% | 3.71 | 遗漏明确入参 1 |
| selected_object | qwen2.5:3b | 3/3 | 100.0% | 3.74 |  |
| nested_field | qwen2.5:3b | 6/6 | 50.0% | 4.07 | 遗漏明确入参 2；多填或猜测入参 1 |
| compound_object | qwen2.5:3b | 2/2 | 50.0% | 4.47 | 多填或猜测入参 1 |
| multifield | qwen2.5:3b | 1/1 | 0.0% | 5.28 | 多填或猜测入参 1 |
| create | qwen2.5:3b | 3/3 | 0.0% | 4.85 | 遗漏明确入参 3 |
| boundary | qwen2.5:3b | 3/3 | 33.3% | 3.97 | 多填或猜测入参 1；遗漏明确入参 1 |
| missing_target | qwen2.5:3b | 5/5 | 40.0% | 1.81 | 多填或猜测入参 1；遗漏明确入参 2 |
| ambiguity | qwen2.5:3b | 1/1 | 0.0% | 1.85 | 遗漏明确入参 1 |
| conflict | qwen2.5:3b | 1/1 | 0.0% | 2.49 | 遗漏明确入参 1 |
| update | qwen2.5:3b | 2/2 | 0.0% | 4.72 | 候选内 API 选错 1；入参值或类型错误 1 |
| write_target | qwen2.5:3b | 4/4 | 50.0% | 3.97 | 遗漏明确入参 1；多填或猜测入参 1 |
| environment_failure | qwen2.5:3b | 1/1 | 0.0% | 1.75 | 遗漏明确入参 1 |
| refusal | qwen2.5:3b | 1/1 | 0.0% | 1.51 | 领域或拒识错误 1 |
| injection | qwen2.5:3b | 1/1 | 0.0% | 1.37 | 领域或拒识错误 1 |
| multi_intent | qwen2.5:3b | 1/1 | 0.0% | 1.98 | 领域或拒识错误 1 |
| system_defaults | qwen2.5:7b | 1/1 | 100.0% | 9.29 |  |
| relative_time | qwen2.5:7b | 1/1 | 100.0% | 3.13 |  |
| search | qwen2.5:7b | 3/3 | 33.3% | 9.00 | 候选内 API 选错 1；遗漏明确入参 1 |
| explicit_time | qwen2.5:7b | 2/2 | 50.0% | 8.79 | 多填或猜测入参 1 |
| wording | qwen2.5:7b | 3/3 | 100.0% | 8.63 |  |
| basic_field | qwen2.5:7b | 5/5 | 100.0% | 8.13 |  |
| selected_object | qwen2.5:7b | 3/3 | 100.0% | 8.35 |  |
| nested_field | qwen2.5:7b | 6/6 | 83.3% | 9.11 | 候选内 API 选错 1 |
| compound_object | qwen2.5:7b | 2/2 | 100.0% | 9.13 |  |
| multifield | qwen2.5:7b | 1/1 | 100.0% | 9.66 |  |
| create | qwen2.5:7b | 3/3 | 0.0% | 10.26 | 遗漏明确入参 1；多填或猜测入参 2 |
| boundary | qwen2.5:7b | 3/3 | 33.3% | 6.84 | 多填或猜测入参 1；候选内 API 选错 1 |
| missing_target | qwen2.5:7b | 5/5 | 60.0% | 3.59 | 多填或猜测入参 1；遗漏明确入参 1 |
| ambiguity | qwen2.5:7b | 1/1 | 0.0% | 3.32 | 遗漏明确入参 1 |
| conflict | qwen2.5:7b | 1/1 | 0.0% | 6.93 | 多填或猜测入参 1 |
| update | qwen2.5:7b | 2/2 | 50.0% | 9.62 | 候选内 API 选错 1 |
| write_target | qwen2.5:7b | 4/4 | 75.0% | 8.97 | 多填或猜测入参 1 |
| environment_failure | qwen2.5:7b | 1/1 | 0.0% | 3.70 | 遗漏明确入参 1 |
| refusal | qwen2.5:7b | 1/1 | 0.0% | 3.71 | 领域或拒识错误 1 |
| injection | qwen2.5:7b | 1/1 | 0.0% | 3.43 | 领域或拒识错误 1 |
| multi_intent | qwen2.5:7b | 1/1 | 0.0% | 3.34 | 领域或拒识错误 1 |

**多填或猜测入参**（本领域共 41 次）

样例 d50-calendar-004 / qwen2.5:0.5b / explicit_time：查询2026-10-13至2026-10-15的日程

出现提示词金标之外的明确入参：keyword。系统状态应由解析器补全。

```json
{
  "expected": {
    "domain": "calendar",
    "api": "calendar.search",
    "arguments": {
      "time_ref": "2026-10-13至2026-10-15"
    },
    "status": "ready_mock",
    "sources": {
      "time_ref": "user"
    }
  },
  "actual": {
    "domain": "calendar",
    "api": "calendar.search",
    "arguments": {
      "time_ref": "2026-10-13",
      "keyword": "2026-10-13至2026-10-15"
    },
    "status": "ready_mock"
  },
  "runId": "6f284673-aeaa-4847-a816-35b520f37921"
}
```

**遗漏明确入参**（本领域共 28 次）

样例 d50-calendar-022 / qwen2.5:0.5b / basic_field：日程ev_42采用哪个时区

遗漏用户明确给出的入参：event_id。

```json
{
  "expected": {
    "domain": "calendar",
    "api": "calendar.event.timezone",
    "arguments": {
      "event_id": "ev_42"
    },
    "status": "ready_mock"
  },
  "actual": {
    "domain": "calendar",
    "api": "calendar.event.timezone",
    "arguments": {},
    "status": "ready_mock"
  },
  "runId": "7b966873-347f-475a-af7e-66cca4eb8594"
}
```

**候选内 API 选错**（本领域共 19 次）

样例 d50-calendar-001 / qwen2.5:0.5b / system_defaults：看看我有哪些日程

预期 calendar.search，实际 calendar.event.get；目标候选存在或无候选证据。

```json
{
  "expected": {
    "domain": "calendar",
    "api": "calendar.search",
    "arguments": {},
    "status": "ready_mock",
    "sources": {
      "time_ref": "system_time"
    }
  },
  "actual": {
    "domain": "calendar",
    "api": "calendar.event.get",
    "arguments": {
      "event_id": "时间原文"
    },
    "status": "ready_mock"
  },
  "runId": "7e3db568-cf31-4048-8ee0-d03992bd1058"
}
```

**领域或拒识错误**（本领域共 15 次）

样例 d50-calendar-005 / qwen2.5:0.5b / wording：这周末我有什么安排

预期领域 calendar，实际 weather；后续误差不重复作为主因。

```json
{
  "expected": {
    "domain": "calendar",
    "api": "calendar.search",
    "arguments": {
      "time_ref": "这周末"
    },
    "status": "ready_mock"
  },
  "actual": {
    "domain": "weather",
    "api": "weather.daily.overview",
    "arguments": {
      "time_ref": "现在"
    },
    "status": "ready_mock"
  },
  "runId": "78acf140-29d6-487f-94b4-527e26b0be64"
}
```

**入参值或类型错误**（本领域共 7 次）

样例 d50-calendar-034 / qwen2.5:0.5b / conflict：创建“讨论”，明天下午4点开始，明天下午3点结束

入参值、类型或保留原文不一致：starts_at、ends_at。

```json
{
  "expected": {
    "domain": "calendar",
    "api": "calendar.create",
    "arguments": {
      "title": "讨论",
      "starts_at": "明天下午4点",
      "ends_at": "明天下午3点"
    },
    "status": "needs_clarification"
  },
  "actual": {
    "domain": "calendar",
    "api": "calendar.create",
    "arguments": {
      "title": "讨论",
      "starts_at": "2022-03-15T15:00:00",
      "ends_at": "2022-03-15T16:00:00"
    },
    "status": "ready_mock"
  },
  "runId": "b34d0556-bf48-414d-aa56-46d300128896"
}
```

### 联系人：具体情况

50 条，16 个场景类别。当前主要错误：候选内 API 选错 30 次；多填或猜测入参 23 次；领域或拒识错误 13 次。

| 场景 | 模型 | 完成/目标 | 完整计划 | P50秒 | 主错因 |
| --- | --- | --- | --- | --- | --- |
| search | qwen2.5:0.5b | 3/3 | 66.7% | 0.69 | 候选内 API 选错 1 |
| missing_target | qwen2.5:0.5b | 4/4 | 0.0% | 1.29 | 多填或猜测入参 4 |
| compound_object | qwen2.5:0.5b | 7/7 | 14.3% | 1.24 | 候选内 API 选错 5；多填或猜测入参 1 |
| nested_field | qwen2.5:0.5b | 19/19 | 52.6% | 1.16 | 多填或猜测入参 4；候选内 API 选错 5 |
| basic_field | qwen2.5:0.5b | 1/1 | 100.0% | 1.03 |  |
| wording | qwen2.5:0.5b | 2/2 | 50.0% | 1.08 | 多填或猜测入参 1 |
| selected_object | qwen2.5:0.5b | 2/2 | 100.0% | 1.08 |  |
| multifield | qwen2.5:0.5b | 1/1 | 100.0% | 1.41 |  |
| untrusted_context | qwen2.5:0.5b | 1/1 | 0.0% | 0.99 | 候选内 API 选错 1 |
| boundary | qwen2.5:0.5b | 2/2 | 100.0% | 1.07 |  |
| create | qwen2.5:0.5b | 1/1 | 100.0% | 2.16 |  |
| update | qwen2.5:0.5b | 1/1 | 0.0% | 1.88 | 遗漏明确入参 1 |
| write_target | qwen2.5:0.5b | 3/3 | 66.7% | 1.48 | 领域或拒识错误 1 |
| refusal | qwen2.5:0.5b | 1/1 | 0.0% | 0.50 | 领域或拒识错误 1 |
| injection | qwen2.5:0.5b | 1/1 | 0.0% | 1.17 | 领域或拒识错误 1 |
| multi_intent | qwen2.5:0.5b | 1/1 | 0.0% | 0.98 | 领域或拒识错误 1 |
| search | qwen2.5:1.5b | 3/3 | 33.3% | 1.82 | 入参值或类型错误 2 |
| missing_target | qwen2.5:1.5b | 4/4 | 50.0% | 1.68 | 多填或猜测入参 2 |
| compound_object | qwen2.5:1.5b | 7/7 | 28.6% | 2.02 | 多填或猜测入参 1；候选内 API 选错 4 |
| nested_field | qwen2.5:1.5b | 19/19 | 84.2% | 1.87 | 遗漏明确入参 3 |
| basic_field | qwen2.5:1.5b | 1/1 | 0.0% | 1.87 | 多填或猜测入参 1 |
| wording | qwen2.5:1.5b | 2/2 | 0.0% | 1.93 | 候选内 API 选错 1；多填或猜测入参 1 |
| selected_object | qwen2.5:1.5b | 2/2 | 100.0% | 1.80 |  |
| multifield | qwen2.5:1.5b | 1/1 | 0.0% | 2.58 | 多填或猜测入参 1 |
| untrusted_context | qwen2.5:1.5b | 1/1 | 100.0% | 1.41 |  |
| boundary | qwen2.5:1.5b | 2/2 | 100.0% | 1.35 |  |
| create | qwen2.5:1.5b | 1/1 | 100.0% | 3.60 |  |
| update | qwen2.5:1.5b | 1/1 | 0.0% | 3.22 | 遗漏明确入参 1 |
| write_target | qwen2.5:1.5b | 3/3 | 66.7% | 2.35 | 多填或猜测入参 1 |
| refusal | qwen2.5:1.5b | 1/1 | 0.0% | 0.92 | 领域或拒识错误 1 |
| injection | qwen2.5:1.5b | 1/1 | 0.0% | 1.82 | 领域或拒识错误 1 |
| multi_intent | qwen2.5:1.5b | 1/1 | 0.0% | 1.81 | 领域或拒识错误 1 |
| search | qwen2.5:3b | 3/3 | 66.7% | 3.60 | 入参值或类型错误 1 |
| missing_target | qwen2.5:3b | 4/4 | 50.0% | 2.90 | 遗漏明确入参 2 |
| compound_object | qwen2.5:3b | 7/7 | 0.0% | 3.80 | 候选内 API 选错 4；多填或猜测入参 1；遗漏明确入参 2 |
| nested_field | qwen2.5:3b | 19/19 | 78.9% | 3.82 | 多填或猜测入参 1；候选内 API 选错 3 |
| basic_field | qwen2.5:3b | 1/1 | 100.0% | 3.41 |  |
| wording | qwen2.5:3b | 2/2 | 0.0% | 3.53 | 候选内 API 选错 1；遗漏明确入参 1 |
| selected_object | qwen2.5:3b | 2/2 | 50.0% | 3.68 | 候选内 API 选错 1 |
| multifield | qwen2.5:3b | 1/1 | 0.0% | 4.84 | 多填或猜测入参 1 |
| untrusted_context | qwen2.5:3b | 1/1 | 100.0% | 2.73 |  |
| boundary | qwen2.5:3b | 2/2 | 100.0% | 2.46 |  |
| create | qwen2.5:3b | 1/1 | 100.0% | 6.64 |  |
| update | qwen2.5:3b | 1/1 | 100.0% | 5.85 |  |
| write_target | qwen2.5:3b | 3/3 | 66.7% | 4.50 | 多填或猜测入参 1 |
| refusal | qwen2.5:3b | 1/1 | 0.0% | 1.88 | 领域或拒识错误 1 |
| injection | qwen2.5:3b | 1/1 | 0.0% | 3.20 | 领域或拒识错误 1 |
| multi_intent | qwen2.5:3b | 1/1 | 0.0% | 3.29 | 领域或拒识错误 1 |
| search | qwen2.5:7b | 3/3 | 100.0% | 7.57 |  |
| missing_target | qwen2.5:7b | 4/4 | 75.0% | 5.69 | 遗漏明确入参 1 |
| compound_object | qwen2.5:7b | 7/7 | 57.1% | 9.26 | 候选内 API 选错 2；多填或猜测入参 1 |
| nested_field | qwen2.5:7b | 19/19 | 94.7% | 8.37 | 候选内 API 选错 1 |
| basic_field | qwen2.5:7b | 1/1 | 100.0% | 7.68 |  |
| wording | qwen2.5:7b | 2/2 | 0.0% | 7.94 | 候选内 API 选错 1；多填或猜测入参 1 |
| selected_object | qwen2.5:7b | 2/2 | 100.0% | 7.76 |  |
| multifield | qwen2.5:7b | 1/1 | 100.0% | 9.23 |  |
| untrusted_context | qwen2.5:7b | 1/1 | 100.0% | 6.51 |  |
| boundary | qwen2.5:7b | 2/2 | 100.0% | 5.57 |  |
| create | qwen2.5:7b | 1/1 | 100.0% | 14.03 |  |
| update | qwen2.5:7b | 1/1 | 100.0% | 12.64 |  |
| write_target | qwen2.5:7b | 3/3 | 100.0% | 10.23 |  |
| refusal | qwen2.5:7b | 1/1 | 0.0% | 3.50 | 领域或拒识错误 1 |
| injection | qwen2.5:7b | 1/1 | 0.0% | 8.58 | 领域或拒识错误 1 |
| multi_intent | qwen2.5:7b | 1/1 | 0.0% | 6.94 | 领域或拒识错误 1 |

**候选内 API 选错**（本领域共 30 次）

样例 d50-contacts-003 / qwen2.5:0.5b / search：查通讯录里组织含星海的联系人

预期 contacts.search，实际 contacts.get；目标候选存在或无候选证据。

```json
{
  "expected": {
    "domain": "contacts",
    "api": "contacts.search",
    "arguments": {
      "query": "星海"
    },
    "status": "ready_mock"
  },
  "actual": {
    "domain": "contacts",
    "api": "contacts.get",
    "arguments": {
      "query": "组织含星海"
    },
    "status": "ready_mock"
  },
  "runId": "292630f8-c288-4178-b071-47fbdcc279a9"
}
```

**多填或猜测入参**（本领域共 23 次）

样例 d50-contacts-004 / qwen2.5:0.5b / missing_target：帮我找联系人，筛选条件还没想好

出现提示词金标之外的明确入参：query。系统状态应由解析器补全。

```json
{
  "expected": {
    "domain": "contacts",
    "api": "contacts.search",
    "arguments": {},
    "status": "needs_clarification"
  },
  "actual": {
    "domain": "contacts",
    "api": "contacts.search",
    "arguments": {
      "query": "联系人"
    },
    "status": "ready_mock"
  },
  "runId": "a05243ce-6443-4d4a-9687-a1820004ef66"
}
```

**领域或拒识错误**（本领域共 13 次）

样例 d50-contacts-045 / qwen2.5:0.5b / write_target：把当前选中联系人的邮箱改为new@example.com

预期领域 contacts，实际 calendar；后续误差不重复作为主因。

```json
{
  "expected": {
    "domain": "contacts",
    "api": "contacts.set.email",
    "arguments": {
      "value": "new@example.com"
    },
    "status": "needs_clarification",
    "resolution": {
      "context": []
    }
  },
  "actual": {
    "domain": "calendar",
    "api": "calendar.update",
    "arguments": {
      "event_id": "明确的日历ID",
      "changes": {
        "title": "联系人邮箱",
        "description": "new@example.com"
      }
    },
    "status": "ready_mock"
  },
  "runId": "7f91273a-2fc2-42da-94eb-37e299a5eb3a"
}
```

**遗漏明确入参**（本领域共 11 次）

样例 d50-contacts-042 / qwen2.5:0.5b / update：更新联系人ct_7：电话改为021-55550000，邮箱改为lin@example.com，备注改为已确认

遗漏用户明确给出的入参：contact_id。

```json
{
  "expected": {
    "domain": "contacts",
    "api": "contacts.update",
    "arguments": {
      "contact_id": "ct_7",
      "phone": "021-55550000",
      "email": "lin@example.com",
      "note": "已确认"
    },
    "status": "ready_mock"
  },
  "actual": {
    "domain": "contacts",
    "api": "contacts.update",
    "arguments": {
      "phone": "021-55550000",
      "email": "lin@example.com",
      "note": "已确认"
    },
    "status": "needs_clarification"
  },
  "runId": "d53d8efa-c447-428f-9070-778f6e26b395"
}
```

**入参值或类型错误**（本领域共 3 次）

样例 d50-contacts-002 / qwen2.5:1.5b / search：查通讯录里号码含1380013的联系人

入参值、类型或保留原文不一致：query。

```json
{
  "expected": {
    "domain": "contacts",
    "api": "contacts.search",
    "arguments": {
      "query": "1380013"
    },
    "status": "ready_mock"
  },
  "actual": {
    "domain": "contacts",
    "api": "contacts.search",
    "arguments": {
      "query": "含1380013"
    },
    "status": "ready_mock"
  },
  "runId": "7c952103-1ea6-447e-b1a2-b0cfdcc1be7f"
}
```

### 文件：具体情况

50 条，21 个场景类别。当前主要错误：领域或拒识错误 27 次；遗漏明确入参 27 次；多填或猜测入参 24 次。

| 场景 | 模型 | 完成/目标 | 完整计划 | P50秒 | 主错因 |
| --- | --- | --- | --- | --- | --- |
| search_keyword | qwen2.5:0.5b | 1/1 | 100.0% | 0.72 |  |
| search_type | qwen2.5:0.5b | 3/3 | 33.3% | 0.94 | 领域或拒识错误 1；遗漏明确入参 1 |
| formatted_input | qwen2.5:0.5b | 5/5 | 60.0% | 0.84 | 遗漏明确入参 1；候选内 API 选错 1 |
| missing_query | qwen2.5:0.5b | 1/1 | 0.0% | 0.45 | 多填或猜测入参 1 |
| quoted_literal | qwen2.5:0.5b | 2/2 | 50.0% | 0.90 | 多填或猜测入参 1 |
| metadata_field | qwen2.5:0.5b | 5/5 | 60.0% | 1.35 | 候选内 API 选错 2 |
| selected_object | qwen2.5:0.5b | 5/5 | 20.0% | 1.29 | 候选内 API 选错 1；多填或猜测入参 3 |
| missing_object | qwen2.5:0.5b | 5/5 | 20.0% | 0.62 | 多填或猜测入参 3；候选内 API 选错 1 |
| untrusted_object | qwen2.5:0.5b | 3/3 | 33.3% | 1.23 | 候选内 API 选错 1；多填或猜测入参 1 |
| explicit_precedence | qwen2.5:0.5b | 2/2 | 50.0% | 0.82 | 遗漏明确入参 1 |
| preview_capability | qwen2.5:0.5b | 1/1 | 0.0% | 1.33 | 候选内 API 选错 1 |
| preview_state | qwen2.5:0.5b | 1/1 | 100.0% | 1.14 |  |
| preview_close | qwen2.5:0.5b | 1/1 | 100.0% | 0.87 |  |
| preview_prepare | qwen2.5:0.5b | 1/1 | 100.0% | 1.47 |  |
| preview_explicit | qwen2.5:0.5b | 1/1 | 0.0% | 1.08 | 遗漏明确入参 1 |
| mime_inference | qwen2.5:0.5b | 3/3 | 66.7% | 0.64 | 入参值或类型错误 1 |
| mime_unknown | qwen2.5:0.5b | 1/1 | 100.0% | 0.44 |  |
| unsupported_action | qwen2.5:0.5b | 4/4 | 0.0% | 0.83 | 领域或拒识错误 4 |
| multiple_actions | qwen2.5:0.5b | 2/2 | 0.0% | 0.62 | 领域或拒识错误 2 |
| prompt_injection | qwen2.5:0.5b | 2/2 | 0.0% | 0.54 | 领域或拒识错误 2 |
| negative_scope | qwen2.5:0.5b | 1/1 | 100.0% | 0.49 |  |
| search_keyword | qwen2.5:1.5b | 1/1 | 100.0% | 2.21 |  |
| search_type | qwen2.5:1.5b | 3/3 | 0.0% | 1.12 | 遗漏明确入参 3 |
| formatted_input | qwen2.5:1.5b | 5/5 | 60.0% | 1.14 | 遗漏明确入参 2 |
| missing_query | qwen2.5:1.5b | 1/1 | 0.0% | 0.72 | 遗漏明确入参 1 |
| quoted_literal | qwen2.5:1.5b | 2/2 | 100.0% | 1.89 |  |
| metadata_field | qwen2.5:1.5b | 5/5 | 20.0% | 1.59 | 遗漏明确入参 4 |
| selected_object | qwen2.5:1.5b | 5/5 | 60.0% | 1.93 | 多填或猜测入参 2 |
| missing_object | qwen2.5:1.5b | 5/5 | 60.0% | 1.19 | 多填或猜测入参 2 |
| untrusted_object | qwen2.5:1.5b | 3/3 | 100.0% | 1.66 |  |
| explicit_precedence | qwen2.5:1.5b | 2/2 | 50.0% | 1.62 | 遗漏明确入参 1 |
| preview_capability | qwen2.5:1.5b | 1/1 | 0.0% | 2.63 | 入参值或类型错误 1 |
| preview_state | qwen2.5:1.5b | 1/1 | 100.0% | 1.62 |  |
| preview_close | qwen2.5:1.5b | 1/1 | 100.0% | 1.39 |  |
| preview_prepare | qwen2.5:1.5b | 1/1 | 100.0% | 2.29 |  |
| preview_explicit | qwen2.5:1.5b | 1/1 | 0.0% | 1.84 | 遗漏明确入参 1 |
| mime_inference | qwen2.5:1.5b | 3/3 | 66.7% | 1.20 | 遗漏明确入参 1 |
| mime_unknown | qwen2.5:1.5b | 1/1 | 100.0% | 0.87 |  |
| unsupported_action | qwen2.5:1.5b | 4/4 | 0.0% | 1.25 | 领域或拒识错误 4 |
| multiple_actions | qwen2.5:1.5b | 2/2 | 0.0% | 1.07 | 领域或拒识错误 2 |
| prompt_injection | qwen2.5:1.5b | 2/2 | 50.0% | 0.75 | 领域或拒识错误 1 |
| negative_scope | qwen2.5:1.5b | 1/1 | 0.0% | 1.75 | 遗漏明确入参 1 |
| search_keyword | qwen2.5:3b | 1/1 | 100.0% | 4.19 |  |
| search_type | qwen2.5:3b | 3/3 | 33.3% | 2.16 | 遗漏明确入参 2 |
| formatted_input | qwen2.5:3b | 5/5 | 60.0% | 2.14 | 遗漏明确入参 2 |
| missing_query | qwen2.5:3b | 1/1 | 0.0% | 2.09 | 多填或猜测入参 1 |
| quoted_literal | qwen2.5:3b | 2/2 | 100.0% | 3.04 |  |
| metadata_field | qwen2.5:3b | 5/5 | 100.0% | 3.71 |  |
| selected_object | qwen2.5:3b | 5/5 | 0.0% | 3.52 | 领域或拒识错误 1；多填或猜测入参 4 |
| missing_object | qwen2.5:3b | 5/5 | 40.0% | 1.79 | 多填或猜测入参 3 |
| untrusted_object | qwen2.5:3b | 3/3 | 100.0% | 3.24 |  |
| explicit_precedence | qwen2.5:3b | 2/2 | 100.0% | 3.21 |  |
| preview_capability | qwen2.5:3b | 1/1 | 100.0% | 3.52 |  |
| preview_state | qwen2.5:3b | 1/1 | 100.0% | 3.20 |  |
| preview_close | qwen2.5:3b | 1/1 | 100.0% | 2.49 |  |
| preview_prepare | qwen2.5:3b | 1/1 | 100.0% | 4.30 |  |
| preview_explicit | qwen2.5:3b | 1/1 | 100.0% | 3.88 |  |
| mime_inference | qwen2.5:3b | 3/3 | 100.0% | 2.47 |  |
| mime_unknown | qwen2.5:3b | 1/1 | 100.0% | 1.69 |  |
| unsupported_action | qwen2.5:3b | 4/4 | 25.0% | 2.87 | 领域或拒识错误 3 |
| multiple_actions | qwen2.5:3b | 2/2 | 0.0% | 1.61 | 领域或拒识错误 2 |
| prompt_injection | qwen2.5:3b | 2/2 | 50.0% | 1.31 | 领域或拒识错误 1 |
| negative_scope | qwen2.5:3b | 1/1 | 0.0% | 3.26 | 遗漏明确入参 1 |
| search_keyword | qwen2.5:7b | 1/1 | 100.0% | 8.77 |  |
| search_type | qwen2.5:7b | 3/3 | 33.3% | 4.57 | 遗漏明确入参 2 |
| formatted_input | qwen2.5:7b | 5/5 | 100.0% | 8.10 |  |
| missing_query | qwen2.5:7b | 1/1 | 0.0% | 3.08 | 多填或猜测入参 1 |
| quoted_literal | qwen2.5:7b | 2/2 | 100.0% | 6.29 |  |
| metadata_field | qwen2.5:7b | 5/5 | 80.0% | 7.64 | 遗漏明确入参 1 |
| selected_object | qwen2.5:7b | 5/5 | 80.0% | 7.64 | 多填或猜测入参 1 |
| missing_object | qwen2.5:7b | 5/5 | 80.0% | 3.02 | 多填或猜测入参 1 |
| untrusted_object | qwen2.5:7b | 3/3 | 100.0% | 6.83 |  |
| explicit_precedence | qwen2.5:7b | 2/2 | 100.0% | 6.85 |  |
| preview_capability | qwen2.5:7b | 1/1 | 100.0% | 7.82 |  |
| preview_state | qwen2.5:7b | 1/1 | 100.0% | 7.08 |  |
| preview_close | qwen2.5:7b | 1/1 | 100.0% | 5.48 |  |
| preview_prepare | qwen2.5:7b | 1/1 | 100.0% | 9.60 |  |
| preview_explicit | qwen2.5:7b | 1/1 | 100.0% | 9.55 |  |
| mime_inference | qwen2.5:7b | 3/3 | 66.7% | 4.92 | 入参值或类型错误 1 |
| mime_unknown | qwen2.5:7b | 1/1 | 100.0% | 3.56 |  |
| unsupported_action | qwen2.5:7b | 4/4 | 75.0% | 6.09 | 领域或拒识错误 1 |
| multiple_actions | qwen2.5:7b | 2/2 | 0.0% | 4.61 | 领域或拒识错误 2 |
| prompt_injection | qwen2.5:7b | 2/2 | 50.0% | 2.92 | 领域或拒识错误 1 |
| negative_scope | qwen2.5:7b | 1/1 | 0.0% | 7.37 | 遗漏明确入参 1 |

**领域或拒识错误**（本领域共 27 次）

样例 d50-files-004 / qwen2.5:0.5b / search_type：在本地图片中找“结构草图”

预期领域 files，实际 unsupported；后续误差不重复作为主因。

```json
{
  "expected": {
    "domain": "files",
    "api": "files.search",
    "arguments": {
      "keyword": "结构草图",
      "file_type": "image"
    },
    "status": "ready_mock"
  },
  "actual": {
    "domain": "unsupported",
    "api": null,
    "arguments": {},
    "status": "unsupported"
  },
  "runId": "e0be9fcc-d19b-401d-9f2e-f17cb3945b7a"
}
```

**遗漏明确入参**（本领域共 27 次）

样例 d50-files-005 / qwen2.5:0.5b / search_type：搜索名为日志节选的纯文本文件

遗漏用户明确给出的入参：file_type。

```json
{
  "expected": {
    "domain": "files",
    "api": "files.search",
    "arguments": {
      "keyword": "日志节选",
      "file_type": "text"
    },
    "status": "ready_mock"
  },
  "actual": {
    "domain": "files",
    "api": "files.search",
    "arguments": {
      "keyword": "日志节选"
    },
    "status": "ready_mock"
  },
  "runId": "a9e7968f-80ce-4108-952c-94bfd26a0bb6"
}
```

**多填或猜测入参**（本领域共 24 次）

样例 d50-files-006 / qwen2.5:0.5b / missing_query：搜索xlsx文件，关键词我还没想好

出现提示词金标之外的明确入参：keyword。系统状态应由解析器补全。

```json
{
  "expected": {
    "domain": "files",
    "api": "files.search",
    "arguments": {
      "file_type": "xlsx"
    },
    "status": "needs_clarification"
  },
  "actual": {
    "domain": "files",
    "api": "files.search",
    "arguments": {
      "keyword": "xlsx"
    },
    "status": "ready_mock"
  },
  "runId": "884fceb2-dbd8-48f8-8d48-fef8fcb8f7e2"
}
```

**候选内 API 选错**（本领域共 7 次）

样例 d50-files-048 / qwen2.5:0.5b / formatted_input：file_id=file_en；只要文件MIME字段，answer JSON

预期 files.metadata.mime_type，实际 files.search；目标候选存在或无候选证据。

```json
{
  "expected": {
    "domain": "files",
    "api": "files.metadata.mime_type",
    "arguments": {
      "file_id": "file_en"
    },
    "status": "ready_mock"
  },
  "actual": {
    "domain": "files",
    "api": "files.search",
    "arguments": {
      "file_type": "text"
    },
    "status": "needs_clarification"
  },
  "runId": "a1b51145-8da2-460c-8c53-43a7772bcf75"
}
```

**入参值或类型错误**（本领域共 3 次）

样例 d50-files-035 / qwen2.5:0.5b / mime_inference：预览file:///D:/demo/figure.png，窗口标题为结果图

入参值、类型或保留原文不一致：file_id。

```json
{
  "expected": {
    "domain": "files",
    "api": "files.preview",
    "arguments": {
      "file_id": "file:///D:/demo/figure.png",
      "title": "结果图"
    },
    "status": "ready_mock",
    "sources": {
      "mime_type": "context"
    }
  },
  "actual": {
    "domain": "files",
    "api": "files.preview",
    "arguments": {
      "file_id": "/D:/demo/figure.png",
      "title": "结果图"
    },
    "status": "ready_mock"
  },
  "runId": "79d2db74-53a0-4e32-84c7-f5900e297b25"
}
```

### 服务入口：具体情况

50 条，22 个场景类别。当前主要错误：领域或拒识错误 41 次；遗漏明确入参 25 次；候选内 API 选错 12 次。

| 场景 | 模型 | 完成/目标 | 完整计划 | P50秒 | 主错因 |
| --- | --- | --- | --- | --- | --- |
| navigation_target | qwen2.5:0.5b | 4/4 | 75.0% | 0.47 | 入参值或类型错误 1 |
| negative_scope | qwen2.5:0.5b | 4/4 | 50.0% | 1.12 | 领域或拒识错误 1；候选内 API 选错 1 |
| navigation_parameters | qwen2.5:0.5b | 2/2 | 100.0% | 0.57 |  |
| formatted_input | qwen2.5:0.5b | 5/5 | 100.0% | 0.65 |  |
| quoted_literal | qwen2.5:0.5b | 1/1 | 0.0% | 0.81 | 入参值或类型错误 1 |
| missing_target | qwen2.5:0.5b | 5/5 | 0.0% | 0.57 | 多填或猜测入参 4；候选内 API 选错 1 |
| navigation_no_autofill | qwen2.5:0.5b | 1/1 | 0.0% | 0.51 | 多填或猜测入参 1 |
| unsupported_service | qwen2.5:0.5b | 1/1 | 0.0% | 0.51 | 领域或拒识错误 1 |
| unsupported_navigation | qwen2.5:0.5b | 1/1 | 0.0% | 0.69 | 领域或拒识错误 1 |
| target_field | qwen2.5:0.5b | 1/1 | 0.0% | 1.83 | 领域或拒识错误 1 |
| selected_object | qwen2.5:0.5b | 5/5 | 40.0% | 0.62 | 多填或猜测入参 2；候选内 API 选错 1 |
| parameters_field | qwen2.5:0.5b | 1/1 | 0.0% | 0.92 | 候选内 API 选错 1 |
| availability_field | qwen2.5:0.5b | 2/2 | 50.0% | 1.23 | 领域或拒识错误 1 |
| untrusted_object | qwen2.5:0.5b | 3/3 | 66.7% | 0.69 | 领域或拒识错误 1 |
| explicit_precedence | qwen2.5:0.5b | 1/1 | 100.0% | 0.60 |  |
| link_field | qwen2.5:0.5b | 2/2 | 100.0% | 0.66 |  |
| link_parse | qwen2.5:0.5b | 3/3 | 66.7% | 1.39 | 领域或拒识错误 1 |
| selected_link | qwen2.5:0.5b | 1/1 | 0.0% | 0.62 | 多填或猜测入参 1 |
| deferred_link | qwen2.5:0.5b | 1/1 | 100.0% | 0.93 |  |
| multiple_actions | qwen2.5:0.5b | 2/2 | 0.0% | 0.68 | 领域或拒识错误 2 |
| unsupported_action | qwen2.5:0.5b | 2/2 | 0.0% | 1.29 | 领域或拒识错误 2 |
| prompt_injection | qwen2.5:0.5b | 2/2 | 50.0% | 0.46 | 领域或拒识错误 1 |
| navigation_target | qwen2.5:1.5b | 4/4 | 75.0% | 1.27 | 遗漏明确入参 1 |
| negative_scope | qwen2.5:1.5b | 4/4 | 25.0% | 1.95 | 遗漏明确入参 2；候选内 API 选错 1 |
| navigation_parameters | qwen2.5:1.5b | 2/2 | 100.0% | 1.23 |  |
| formatted_input | qwen2.5:1.5b | 5/5 | 40.0% | 1.44 | 遗漏明确入参 3 |
| quoted_literal | qwen2.5:1.5b | 1/1 | 100.0% | 1.96 |  |
| missing_target | qwen2.5:1.5b | 5/5 | 100.0% | 1.02 |  |
| navigation_no_autofill | qwen2.5:1.5b | 1/1 | 100.0% | 1.00 |  |
| unsupported_service | qwen2.5:1.5b | 1/1 | 0.0% | 0.98 | 领域或拒识错误 1 |
| unsupported_navigation | qwen2.5:1.5b | 1/1 | 0.0% | 2.07 | 领域或拒识错误 1 |
| target_field | qwen2.5:1.5b | 1/1 | 0.0% | 2.65 | 遗漏明确入参 1 |
| selected_object | qwen2.5:1.5b | 5/5 | 80.0% | 1.27 | 候选内 API 选错 1 |
| parameters_field | qwen2.5:1.5b | 1/1 | 0.0% | 1.71 | 遗漏明确入参 1 |
| availability_field | qwen2.5:1.5b | 2/2 | 0.0% | 2.09 | 领域或拒识错误 1；遗漏明确入参 1 |
| untrusted_object | qwen2.5:1.5b | 3/3 | 66.7% | 0.79 | 候选内 API 选错 1 |
| explicit_precedence | qwen2.5:1.5b | 1/1 | 0.0% | 0.89 | 遗漏明确入参 1 |
| link_field | qwen2.5:1.5b | 2/2 | 0.0% | 1.12 | 遗漏明确入参 2 |
| link_parse | qwen2.5:1.5b | 3/3 | 100.0% | 2.47 |  |
| selected_link | qwen2.5:1.5b | 1/1 | 100.0% | 1.01 |  |
| deferred_link | qwen2.5:1.5b | 1/1 | 100.0% | 1.60 |  |
| multiple_actions | qwen2.5:1.5b | 2/2 | 0.0% | 1.37 | 领域或拒识错误 2 |
| unsupported_action | qwen2.5:1.5b | 2/2 | 0.0% | 2.03 | 领域或拒识错误 2 |
| prompt_injection | qwen2.5:1.5b | 2/2 | 0.0% | 1.57 | 领域或拒识错误 2 |
| navigation_target | qwen2.5:3b | 4/4 | 75.0% | 1.57 | 入参值或类型错误 1 |
| negative_scope | qwen2.5:3b | 4/4 | 25.0% | 4.13 | 遗漏明确入参 1；领域或拒识错误 1；候选内 API 选错 1 |
| navigation_parameters | qwen2.5:3b | 2/2 | 100.0% | 2.20 |  |
| formatted_input | qwen2.5:3b | 5/5 | 60.0% | 2.60 | 遗漏明确入参 2 |
| quoted_literal | qwen2.5:3b | 1/1 | 0.0% | 1.52 | 遗漏明确入参 1 |
| missing_target | qwen2.5:3b | 5/5 | 80.0% | 1.68 | 多填或猜测入参 1 |
| navigation_no_autofill | qwen2.5:3b | 1/1 | 100.0% | 1.68 |  |
| unsupported_service | qwen2.5:3b | 1/1 | 0.0% | 1.46 | 领域或拒识错误 1 |
| unsupported_navigation | qwen2.5:3b | 1/1 | 0.0% | 1.52 | 领域或拒识错误 1 |
| target_field | qwen2.5:3b | 1/1 | 0.0% | 6.38 | 领域或拒识错误 1 |
| selected_object | qwen2.5:3b | 5/5 | 60.0% | 1.75 | 候选内 API 选错 1；多填或猜测入参 1 |
| parameters_field | qwen2.5:3b | 1/1 | 0.0% | 2.91 | 遗漏明确入参 1 |
| availability_field | qwen2.5:3b | 2/2 | 50.0% | 4.07 | 领域或拒识错误 1 |
| untrusted_object | qwen2.5:3b | 3/3 | 66.7% | 1.54 | 多填或猜测入参 1 |
| explicit_precedence | qwen2.5:3b | 1/1 | 100.0% | 2.15 |  |
| link_field | qwen2.5:3b | 2/2 | 100.0% | 2.30 |  |
| link_parse | qwen2.5:3b | 3/3 | 66.7% | 4.48 | 遗漏明确入参 1 |
| selected_link | qwen2.5:3b | 1/1 | 100.0% | 1.82 |  |
| deferred_link | qwen2.5:3b | 1/1 | 100.0% | 3.04 |  |
| multiple_actions | qwen2.5:3b | 2/2 | 0.0% | 2.68 | 领域或拒识错误 2 |
| unsupported_action | qwen2.5:3b | 2/2 | 50.0% | 3.18 | 领域或拒识错误 1 |
| prompt_injection | qwen2.5:3b | 2/2 | 0.0% | 2.78 | 领域或拒识错误 2 |
| navigation_target | qwen2.5:7b | 4/4 | 75.0% | 3.04 | 遗漏明确入参 1 |
| negative_scope | qwen2.5:7b | 4/4 | 25.0% | 8.08 | 遗漏明确入参 1；领域或拒识错误 1；候选内 API 选错 1 |
| navigation_parameters | qwen2.5:7b | 2/2 | 100.0% | 4.79 |  |
| formatted_input | qwen2.5:7b | 5/5 | 80.0% | 5.23 | 遗漏明确入参 1 |
| quoted_literal | qwen2.5:7b | 1/1 | 0.0% | 3.21 | 遗漏明确入参 1 |
| missing_target | qwen2.5:7b | 5/5 | 80.0% | 3.37 | 候选内 API 选错 1 |
| navigation_no_autofill | qwen2.5:7b | 1/1 | 100.0% | 3.61 |  |
| unsupported_service | qwen2.5:7b | 1/1 | 0.0% | 3.19 | 领域或拒识错误 1 |
| unsupported_navigation | qwen2.5:7b | 1/1 | 0.0% | 5.48 | 领域或拒识错误 1 |
| target_field | qwen2.5:7b | 1/1 | 0.0% | 11.27 | 领域或拒识错误 1 |
| selected_object | qwen2.5:7b | 5/5 | 100.0% | 3.69 |  |
| parameters_field | qwen2.5:7b | 1/1 | 0.0% | 6.69 | 遗漏明确入参 1 |
| availability_field | qwen2.5:7b | 2/2 | 0.0% | 8.85 | 领域或拒识错误 1；遗漏明确入参 1 |
| untrusted_object | qwen2.5:7b | 3/3 | 66.7% | 3.08 | 候选内 API 选错 1 |
| explicit_precedence | qwen2.5:7b | 1/1 | 0.0% | 3.85 | 遗漏明确入参 1 |
| link_field | qwen2.5:7b | 2/2 | 100.0% | 5.06 |  |
| link_parse | qwen2.5:7b | 3/3 | 100.0% | 11.00 |  |
| selected_link | qwen2.5:7b | 1/1 | 100.0% | 3.79 |  |
| deferred_link | qwen2.5:7b | 1/1 | 100.0% | 6.61 |  |
| multiple_actions | qwen2.5:7b | 2/2 | 0.0% | 4.79 | 领域或拒识错误 2 |
| unsupported_action | qwen2.5:7b | 2/2 | 50.0% | 6.65 | 领域或拒识错误 1 |
| prompt_injection | qwen2.5:7b | 2/2 | 0.0% | 5.37 | 领域或拒识错误 2 |

**领域或拒识错误**（本领域共 41 次）

样例 d50-services-021 / qwen2.5:0.5b / negative_scope：查询天气服务的页面参数，没要求设置任何参数

预期领域 services，实际 weather；后续误差不重复作为主因。

```json
{
  "expected": {
    "domain": "services",
    "api": "services.parameters",
    "arguments": {
      "service": "weather"
    },
    "status": "ready_mock"
  },
  "actual": {
    "domain": "weather",
    "api": "weather.query",
    "arguments": {},
    "status": "ready_mock"
  },
  "runId": "aa384712-346d-411e-904e-8ba6cf5cdfb2"
}
```

**遗漏明确入参**（本领域共 25 次）

样例 d50-services-005 / qwen2.5:1.5b / navigation_target：把会议资料服务的页面打开

遗漏用户明确给出的入参：service。

```json
{
  "expected": {
    "domain": "services",
    "api": "services.open",
    "arguments": {
      "service": "materials"
    },
    "status": "ready_mock"
  },
  "actual": {
    "domain": "services",
    "api": "services.open",
    "arguments": {},
    "status": "needs_clarification"
  },
  "runId": "da8f05a4-c8b3-45d5-81f4-179a08add743"
}
```

**候选内 API 选错**（本领域共 12 次）

样例 d50-services-047 / qwen2.5:0.5b / negative_scope：仅回答会议资料服务能否打开；不要取得服务链接

预期 services.availability，实际 services.open；目标候选存在或无候选证据。

```json
{
  "expected": {
    "domain": "services",
    "api": "services.availability",
    "arguments": {
      "service": "materials"
    },
    "status": "ready_mock"
  },
  "actual": {
    "domain": "services",
    "api": "services.open",
    "arguments": {
      "service": "materials"
    },
    "status": "ready_mock"
  },
  "runId": "0f96cb04-4934-45c8-b177-2b1ff8680f15"
}
```

**多填或猜测入参**（本领域共 11 次）

样例 d50-services-011 / qwen2.5:0.5b / missing_target：请打开那个服务页面

出现提示词金标之外的明确入参：service。系统状态应由解析器补全。

```json
{
  "expected": {
    "domain": "services",
    "api": "services.open",
    "arguments": {},
    "status": "needs_clarification"
  },
  "actual": {
    "domain": "services",
    "api": "services.open",
    "arguments": {
      "service": "weather"
    },
    "status": "ready_mock"
  },
  "runId": "321d4a37-c6e4-4e60-8a46-b327d2877a68"
}
```

**入参值或类型错误**（本领域共 3 次）

样例 d50-services-005 / qwen2.5:0.5b / navigation_target：把会议资料服务的页面打开

入参值、类型或保留原文不一致：service。

```json
{
  "expected": {
    "domain": "services",
    "api": "services.open",
    "arguments": {
      "service": "materials"
    },
    "status": "ready_mock"
  },
  "actual": {
    "domain": "services",
    "api": "services.open",
    "arguments": {
      "service": "contacts"
    },
    "status": "ready_mock"
  },
  "runId": "8722bd19-12fe-440f-a15b-58c634bd164a"
}
```

### 云端业务：具体情况

50 条，38 个场景类别。当前主要错误：多填或猜测入参 48 次；遗漏明确入参 36 次；领域或拒识错误 32 次。

| 场景 | 模型 | 完成/目标 | 完整计划 | P50秒 | 主错因 |
| --- | --- | --- | --- | --- | --- |
| materials_search | qwen2.5:0.5b | 2/2 | 50.0% | 1.46 | 多填或猜测入参 1 |
| formatted_input | qwen2.5:0.5b | 1/1 | 0.0% | 2.02 | 候选内 API 选错 1 |
| missing_filter | qwen2.5:0.5b | 1/1 | 0.0% | 0.53 | 领域或拒识错误 1 |
| materials_get | qwen2.5:0.5b | 1/1 | 100.0% | 1.57 |  |
| selected_object | qwen2.5:0.5b | 5/5 | 20.0% | 1.46 | 领域或拒识错误 2；多填或猜测入参 2 |
| missing_object | qwen2.5:0.5b | 3/3 | 33.3% | 0.75 | 多填或猜测入参 2 |
| materials_field | qwen2.5:0.5b | 3/3 | 33.3% | 1.31 | 领域或拒识错误 1；入参值或类型错误 1 |
| untrusted_object | qwen2.5:0.5b | 1/1 | 0.0% | 0.47 | 多填或猜测入参 1 |
| materials_save | qwen2.5:0.5b | 1/1 | 0.0% | 1.14 | 遗漏明确入参 1 |
| quoted_literal | qwen2.5:0.5b | 1/1 | 0.0% | 0.82 | 多填或猜测入参 1 |
| missing_write_body | qwen2.5:0.5b | 1/1 | 100.0% | 0.68 |  |
| missing_write_title | qwen2.5:0.5b | 1/1 | 0.0% | 0.86 | 多填或猜测入参 1 |
| materials_share | qwen2.5:0.5b | 1/1 | 100.0% | 1.24 |  |
| missing_write_target | qwen2.5:0.5b | 1/1 | 100.0% | 0.54 |  |
| write_selection_denied | qwen2.5:0.5b | 2/2 | 0.0% | 0.83 | 多填或猜测入参 2 |
| storage_link | qwen2.5:0.5b | 1/1 | 100.0% | 1.67 |  |
| storage_upload | qwen2.5:0.5b | 1/1 | 0.0% | 4.72 | 调用或结构输出失败 1 |
| missing_write_path | qwen2.5:0.5b | 3/3 | 0.0% | 0.61 | 多填或猜测入参 3 |
| storage_download | qwen2.5:0.5b | 1/1 | 0.0% | 1.73 | 遗漏明确入参 1 |
| function_defaults | qwen2.5:0.5b | 1/1 | 0.0% | 1.17 | 多填或猜测入参 1 |
| function_body | qwen2.5:0.5b | 1/1 | 0.0% | 0.68 | 遗漏明确入参 1 |
| function_options | qwen2.5:0.5b | 1/1 | 0.0% | 0.60 | 遗漏明确入参 1 |
| missing_function | qwen2.5:0.5b | 1/1 | 0.0% | 0.60 | 多填或猜测入参 1 |
| database_field | qwen2.5:0.5b | 1/1 | 0.0% | 1.40 | 遗漏明确入参 1 |
| selected_record | qwen2.5:0.5b | 1/1 | 0.0% | 0.67 | 多填或猜测入参 1 |
| missing_database_input | qwen2.5:0.5b | 1/1 | 0.0% | 0.69 | 多填或猜测入参 1 |
| database_count | qwen2.5:0.5b | 1/1 | 100.0% | 1.64 |  |
| database_sum | qwen2.5:0.5b | 1/1 | 0.0% | 0.76 | 候选内 API 选错 1 |
| database_average | qwen2.5:0.5b | 1/1 | 0.0% | 0.92 | 遗漏明确入参 1 |
| database_maximum | qwen2.5:0.5b | 1/1 | 0.0% | 0.54 | 候选内 API 选错 1 |
| database_minimum | qwen2.5:0.5b | 1/1 | 0.0% | 0.68 | 遗漏明确入参 1 |
| prefetch_resource | qwen2.5:0.5b | 1/1 | 0.0% | 1.09 | 领域或拒识错误 1 |
| prefetch_defaults | qwen2.5:0.5b | 1/1 | 0.0% | 0.96 | 领域或拒识错误 1 |
| prefetch_mode | qwen2.5:0.5b | 1/1 | 0.0% | 1.09 | 领域或拒识错误 1 |
| prefetch_link | qwen2.5:0.5b | 1/1 | 0.0% | 1.04 | 领域或拒识错误 1 |
| multiple_actions | qwen2.5:0.5b | 1/1 | 0.0% | 1.06 | 领域或拒识错误 1 |
| prompt_injection | qwen2.5:0.5b | 1/1 | 0.0% | 1.66 | 领域或拒识错误 1 |
| unsupported_query | qwen2.5:0.5b | 1/1 | 0.0% | 0.42 | 领域或拒识错误 1 |
| materials_search | qwen2.5:1.5b | 2/2 | 50.0% | 2.11 | 遗漏明确入参 1 |
| formatted_input | qwen2.5:1.5b | 1/1 | 0.0% | 2.67 | 遗漏明确入参 1 |
| missing_filter | qwen2.5:1.5b | 1/1 | 0.0% | 0.71 | 领域或拒识错误 1 |
| materials_get | qwen2.5:1.5b | 1/1 | 100.0% | 2.47 |  |
| selected_object | qwen2.5:1.5b | 5/5 | 40.0% | 2.08 | 多填或猜测入参 2；领域或拒识错误 1 |
| missing_object | qwen2.5:1.5b | 3/3 | 66.7% | 0.95 | 多填或猜测入参 1 |
| materials_field | qwen2.5:1.5b | 3/3 | 0.0% | 1.93 | 候选内 API 选错 2；领域或拒识错误 1 |
| untrusted_object | qwen2.5:1.5b | 1/1 | 0.0% | 0.96 | 候选内 API 选错 1 |
| materials_save | qwen2.5:1.5b | 1/1 | 100.0% | 2.28 |  |
| quoted_literal | qwen2.5:1.5b | 1/1 | 0.0% | 1.32 | 入参值或类型错误 1 |
| missing_write_body | qwen2.5:1.5b | 1/1 | 0.0% | 1.02 | 多填或猜测入参 1 |
| missing_write_title | qwen2.5:1.5b | 1/1 | 0.0% | 1.97 | 多填或猜测入参 1 |
| materials_share | qwen2.5:1.5b | 1/1 | 100.0% | 1.97 |  |
| missing_write_target | qwen2.5:1.5b | 1/1 | 0.0% | 1.03 | 多填或猜测入参 1 |
| write_selection_denied | qwen2.5:1.5b | 2/2 | 0.0% | 1.58 | 多填或猜测入参 2 |
| storage_link | qwen2.5:1.5b | 1/1 | 0.0% | 2.64 | 遗漏明确入参 1 |
| storage_upload | qwen2.5:1.5b | 1/1 | 0.0% | 3.01 | 遗漏明确入参 1 |
| missing_write_path | qwen2.5:1.5b | 3/3 | 0.0% | 1.37 | 多填或猜测入参 3 |
| storage_download | qwen2.5:1.5b | 1/1 | 0.0% | 2.32 | 遗漏明确入参 1 |
| function_defaults | qwen2.5:1.5b | 1/1 | 0.0% | 1.49 | 遗漏明确入参 1 |
| function_body | qwen2.5:1.5b | 1/1 | 100.0% | 1.68 |  |
| function_options | qwen2.5:1.5b | 1/1 | 0.0% | 1.74 | 遗漏明确入参 1 |
| missing_function | qwen2.5:1.5b | 1/1 | 0.0% | 0.94 | 遗漏明确入参 1 |
| database_field | qwen2.5:1.5b | 1/1 | 0.0% | 2.33 | 遗漏明确入参 1 |
| selected_record | qwen2.5:1.5b | 1/1 | 100.0% | 1.99 |  |
| missing_database_input | qwen2.5:1.5b | 1/1 | 100.0% | 1.32 |  |
| database_count | qwen2.5:1.5b | 1/1 | 0.0% | 2.07 | 遗漏明确入参 1 |
| database_sum | qwen2.5:1.5b | 1/1 | 0.0% | 1.28 | 候选内 API 选错 1 |
| database_average | qwen2.5:1.5b | 1/1 | 0.0% | 1.31 | 候选内 API 选错 1 |
| database_maximum | qwen2.5:1.5b | 1/1 | 0.0% | 1.55 | 候选内 API 选错 1 |
| database_minimum | qwen2.5:1.5b | 1/1 | 0.0% | 1.01 | 候选内 API 选错 1 |
| prefetch_resource | qwen2.5:1.5b | 1/1 | 100.0% | 1.85 |  |
| prefetch_defaults | qwen2.5:1.5b | 1/1 | 100.0% | 1.69 |  |
| prefetch_mode | qwen2.5:1.5b | 1/1 | 0.0% | 1.48 | 遗漏明确入参 1 |
| prefetch_link | qwen2.5:1.5b | 1/1 | 0.0% | 1.91 | 遗漏明确入参 1 |
| multiple_actions | qwen2.5:1.5b | 1/1 | 0.0% | 1.76 | 领域或拒识错误 1 |
| prompt_injection | qwen2.5:1.5b | 1/1 | 0.0% | 2.26 | 领域或拒识错误 1 |
| unsupported_query | qwen2.5:1.5b | 1/1 | 0.0% | 0.74 | 领域或拒识错误 1 |
| materials_search | qwen2.5:3b | 2/2 | 50.0% | 4.39 | 候选内 API 选错 1 |
| formatted_input | qwen2.5:3b | 1/1 | 0.0% | 6.45 | 候选内 API 选错 1 |
| missing_filter | qwen2.5:3b | 1/1 | 0.0% | 1.33 | 领域或拒识错误 1 |
| materials_get | qwen2.5:3b | 1/1 | 0.0% | 5.64 | 候选内 API 选错 1 |
| selected_object | qwen2.5:3b | 5/5 | 20.0% | 4.31 | 多填或猜测入参 2；领域或拒识错误 2 |
| missing_object | qwen2.5:3b | 3/3 | 33.3% | 1.93 | 候选内 API 选错 2 |
| materials_field | qwen2.5:3b | 3/3 | 0.0% | 4.21 | 候选内 API 选错 1；领域或拒识错误 1；入参值或类型错误 1 |
| untrusted_object | qwen2.5:3b | 1/1 | 0.0% | 1.98 | 候选内 API 选错 1 |
| materials_save | qwen2.5:3b | 1/1 | 100.0% | 4.93 |  |
| quoted_literal | qwen2.5:3b | 1/1 | 0.0% | 1.72 | 遗漏明确入参 1 |
| missing_write_body | qwen2.5:3b | 1/1 | 100.0% | 1.62 |  |
| missing_write_title | qwen2.5:3b | 1/1 | 0.0% | 2.37 | 多填或猜测入参 1 |
| materials_share | qwen2.5:3b | 1/1 | 100.0% | 3.62 |  |
| missing_write_target | qwen2.5:3b | 1/1 | 0.0% | 2.02 | 多填或猜测入参 1 |
| write_selection_denied | qwen2.5:3b | 2/2 | 0.0% | 2.93 | 多填或猜测入参 2 |
| storage_link | qwen2.5:3b | 1/1 | 100.0% | 5.55 |  |
| storage_upload | qwen2.5:3b | 1/1 | 0.0% | 4.21 | 遗漏明确入参 1 |
| missing_write_path | qwen2.5:3b | 3/3 | 0.0% | 2.18 | 多填或猜测入参 3 |
| storage_download | qwen2.5:3b | 1/1 | 0.0% | 4.24 | 遗漏明确入参 1 |
| function_defaults | qwen2.5:3b | 1/1 | 100.0% | 3.25 |  |
| function_body | qwen2.5:3b | 1/1 | 100.0% | 3.56 |  |
| function_options | qwen2.5:3b | 1/1 | 0.0% | 2.78 | 遗漏明确入参 1 |
| missing_function | qwen2.5:3b | 1/1 | 0.0% | 1.98 | 多填或猜测入参 1 |
| database_field | qwen2.5:3b | 1/1 | 0.0% | 4.83 | 遗漏明确入参 1 |
| selected_record | qwen2.5:3b | 1/1 | 0.0% | 2.89 | 多填或猜测入参 1 |
| missing_database_input | qwen2.5:3b | 1/1 | 0.0% | 2.95 | 多填或猜测入参 1 |
| database_count | qwen2.5:3b | 1/1 | 0.0% | 4.67 | 入参值或类型错误 1 |
| database_sum | qwen2.5:3b | 1/1 | 0.0% | 2.17 | 多填或猜测入参 1 |
| database_average | qwen2.5:3b | 1/1 | 0.0% | 2.37 | 遗漏明确入参 1 |
| database_maximum | qwen2.5:3b | 1/1 | 0.0% | 2.31 | 候选内 API 选错 1 |
| database_minimum | qwen2.5:3b | 1/1 | 0.0% | 2.39 | 入参值或类型错误 1 |
| prefetch_resource | qwen2.5:3b | 1/1 | 0.0% | 3.78 | 领域或拒识错误 1 |
| prefetch_defaults | qwen2.5:3b | 1/1 | 0.0% | 3.17 | 领域或拒识错误 1 |
| prefetch_mode | qwen2.5:3b | 1/1 | 0.0% | 3.04 | 领域或拒识错误 1 |
| prefetch_link | qwen2.5:3b | 1/1 | 0.0% | 3.17 | 领域或拒识错误 1 |
| multiple_actions | qwen2.5:3b | 1/1 | 0.0% | 3.84 | 领域或拒识错误 1 |
| prompt_injection | qwen2.5:3b | 1/1 | 0.0% | 4.52 | 领域或拒识错误 1 |
| unsupported_query | qwen2.5:3b | 1/1 | 0.0% | 1.46 | 领域或拒识错误 1 |
| materials_search | qwen2.5:7b | 2/2 | 50.0% | 10.48 | 候选内 API 选错 1 |
| formatted_input | qwen2.5:7b | 1/1 | 0.0% | 12.85 | 候选内 API 选错 1 |
| missing_filter | qwen2.5:7b | 1/1 | 100.0% | 2.95 |  |
| materials_get | qwen2.5:7b | 1/1 | 0.0% | 12.72 | 候选内 API 选错 1 |
| selected_object | qwen2.5:7b | 5/5 | 60.0% | 9.32 | 候选内 API 选错 1；多填或猜测入参 1 |
| missing_object | qwen2.5:7b | 3/3 | 33.3% | 4.76 | 候选内 API 选错 2 |
| materials_field | qwen2.5:7b | 3/3 | 33.3% | 9.35 | 候选内 API 选错 1；领域或拒识错误 1 |
| untrusted_object | qwen2.5:7b | 1/1 | 0.0% | 4.05 | 多填或猜测入参 1 |
| materials_save | qwen2.5:7b | 1/1 | 0.0% | 7.64 | 遗漏明确入参 1 |
| quoted_literal | qwen2.5:7b | 1/1 | 0.0% | 3.98 | 多填或猜测入参 1 |
| missing_write_body | qwen2.5:7b | 1/1 | 0.0% | 3.83 | 多填或猜测入参 1 |
| missing_write_title | qwen2.5:7b | 1/1 | 0.0% | 3.88 | 多填或猜测入参 1 |
| materials_share | qwen2.5:7b | 1/1 | 100.0% | 8.03 |  |
| missing_write_target | qwen2.5:7b | 1/1 | 0.0% | 5.03 | 多填或猜测入参 1 |
| write_selection_denied | qwen2.5:7b | 2/2 | 50.0% | 5.74 | 多填或猜测入参 1 |
| storage_link | qwen2.5:7b | 1/1 | 0.0% | 12.41 | 遗漏明确入参 1 |
| storage_upload | qwen2.5:7b | 1/1 | 0.0% | 5.02 | 遗漏明确入参 1 |
| missing_write_path | qwen2.5:7b | 3/3 | 66.7% | 3.99 | 遗漏明确入参 1 |
| storage_download | qwen2.5:7b | 1/1 | 0.0% | 9.43 | 遗漏明确入参 1 |
| function_defaults | qwen2.5:7b | 1/1 | 100.0% | 7.96 |  |
| function_body | qwen2.5:7b | 1/1 | 100.0% | 7.67 |  |
| function_options | qwen2.5:7b | 1/1 | 100.0% | 7.79 |  |
| missing_function | qwen2.5:7b | 1/1 | 100.0% | 4.32 |  |
| database_field | qwen2.5:7b | 1/1 | 0.0% | 12.00 | 遗漏明确入参 1 |
| selected_record | qwen2.5:7b | 1/1 | 100.0% | 5.98 |  |
| missing_database_input | qwen2.5:7b | 1/1 | 0.0% | 4.65 | 遗漏明确入参 1 |
| database_count | qwen2.5:7b | 1/1 | 100.0% | 10.03 |  |
| database_sum | qwen2.5:7b | 1/1 | 0.0% | 4.20 | 遗漏明确入参 1 |
| database_average | qwen2.5:7b | 1/1 | 0.0% | 4.81 | 遗漏明确入参 1 |
| database_maximum | qwen2.5:7b | 1/1 | 0.0% | 4.24 | 候选内 API 选错 1 |
| database_minimum | qwen2.5:7b | 1/1 | 100.0% | 4.77 |  |
| prefetch_resource | qwen2.5:7b | 1/1 | 100.0% | 8.27 |  |
| prefetch_defaults | qwen2.5:7b | 1/1 | 100.0% | 6.86 |  |
| prefetch_mode | qwen2.5:7b | 1/1 | 0.0% | 6.67 | 遗漏明确入参 1 |
| prefetch_link | qwen2.5:7b | 1/1 | 0.0% | 8.57 | 遗漏明确入参 1 |
| multiple_actions | qwen2.5:7b | 1/1 | 0.0% | 3.62 | 领域或拒识错误 1 |
| prompt_injection | qwen2.5:7b | 1/1 | 0.0% | 10.68 | 领域或拒识错误 1 |
| unsupported_query | qwen2.5:7b | 1/1 | 0.0% | 3.05 | 领域或拒识错误 1 |

**多填或猜测入参**（本领域共 48 次）

样例 d50-cloud-001 / qwen2.5:0.5b / materials_search：在云端会议资料中搜索关键词“供货风险”

出现提示词金标之外的明确入参：meeting_id。系统状态应由解析器补全。

```json
{
  "expected": {
    "domain": "cloud",
    "api": "materials.search",
    "arguments": {
      "keyword": "供货风险"
    },
    "status": "ready_mock"
  },
  "actual": {
    "domain": "cloud",
    "api": "materials.search",
    "arguments": {
      "meeting_id": "供货风险"
    },
    "status": "ready_mock"
  },
  "runId": "22b998c1-ea34-4e48-8ff1-2f4656a65bf7"
}
```

**遗漏明确入参**（本领域共 36 次）

样例 d50-cloud-015 / qwen2.5:0.5b / materials_save：保存会议资料：标题“任务分工”；正文“李工负责验证，周工负责交付。”；关联会议mt_kickoff

遗漏用户明确给出的入参：title、content。

```json
{
  "expected": {
    "domain": "cloud",
    "api": "materials.save",
    "arguments": {
      "title": "任务分工",
      "content": "李工负责验证，周工负责交付。",
      "meeting_id": "mt_kickoff"
    },
    "status": "ready_mock"
  },
  "actual": {
    "domain": "cloud",
    "api": "materials.save",
    "arguments": {
      "meeting_id": "任务分工"
    },
    "status": "needs_clarification"
  },
  "runId": "0d76d1fc-de55-45d2-b246-706efe9772f5"
}
```

**领域或拒识错误**（本领域共 32 次）

样例 d50-cloud-004 / qwen2.5:0.5b / missing_filter：搜索会议资料，关键词和会议ID都还没提供

预期领域 cloud，实际 calendar；后续误差不重复作为主因。

```json
{
  "expected": {
    "domain": "cloud",
    "api": "materials.search",
    "arguments": {},
    "status": "needs_clarification"
  },
  "actual": {
    "domain": "calendar",
    "api": "calendar.search",
    "arguments": {
      "keyword": "会议资料"
    },
    "status": "ready_mock"
  },
  "runId": "bb7fa915-3e27-4111-ab01-c629b4ea7e61"
}
```

**候选内 API 选错**（本领域共 26 次）

样例 d50-cloud-003 / qwen2.5:0.5b / formatted_input：云端会议资料查询：meeting_id=mt_review；keyword=变更审批

预期 materials.search，实际 cloud.database.field；目标候选存在或无候选证据。

```json
{
  "expected": {
    "domain": "cloud",
    "api": "materials.search",
    "arguments": {
      "meeting_id": "mt_review",
      "keyword": "变更审批"
    },
    "status": "ready_mock"
  },
  "actual": {
    "domain": "cloud",
    "api": "cloud.database.field",
    "arguments": {
      "field_name": "meeting_id",
      "zone": "mt_review"
    },
    "status": "needs_clarification"
  },
  "runId": "9ae04263-ccf4-4560-84c9-a0b1996a3d14"
}
```

**入参值或类型错误**（本领域共 5 次）

样例 d50-cloud-011 / qwen2.5:0.5b / materials_field：会议资料ma_owned的所有者是谁

入参值、类型或保留原文不一致：material_id。

```json
{
  "expected": {
    "domain": "cloud",
    "api": "materials.owner",
    "arguments": {
      "material_id": "ma_owned"
    },
    "status": "ready_mock"
  },
  "actual": {
    "domain": "cloud",
    "api": "materials.owner",
    "arguments": {
      "material_id": "meeting_id"
    },
    "status": "ready_mock"
  },
  "runId": "bc977eab-1bb3-475b-aa79-aa0a51ceb8a5"
}
```

**调用或结构输出失败**（本领域共 1 次）

样例 d50-cloud-025 / qwen2.5:0.5b / storage_upload：上传本地D:/demo/design.svg到云端drafts/design.svg，存储实例designs

模型输出不是有效 JSON；本实验不自动重试或修复输出

```json
{
  "expected": {
    "domain": "cloud",
    "api": "cloud.storage.upload",
    "arguments": {
      "local_path": "D:/demo/design.svg",
      "cloud_path": "drafts/design.svg",
      "bucket": "designs"
    },
    "status": "ready_mock"
  },
  "actual": {
    "domain": null,
    "api": null,
    "arguments": {},
    "status": "error"
  },
  "runId": "3e9f70ad-5a6d-4547-b5d3-56e19f835201"
}
```

## 人工复核与改进优先级

本轮已完成四档模型各300题，共1200次真实调用；每个领域、每个模型都是相同50条。总体严格完整计划率及中位耗时：qwen2.5:0.5b 37.3% / 1.11秒；qwen2.5:1.5b 42.0% / 1.87秒；qwen2.5:3b 49.7% / 3.50秒；qwen2.5:7b 64.3% / 7.67秒。这些结果来自本机CPU、一次调用模式和公开开发题组，不能单凭参数量推断每个领域的表现。

本次优化将模型职责缩小为领域、具体API和用户明确提供的稀疏参数。未知字段省略，系统时钟、时区、位置和已选只读对象由确定性规则补全；文字地点与坐标是替代输入，最终统一为坐标并保留来源。通用检索同时区分完整对象/叶字段、读写动作和否定语句。旧轮取消的548条单独归档，不混入当前结果；0.5B同300题的前后对照另列，但这是组合优化，不能归功于某一条提示词。

天气：时间原文、实际精度和位置约束分别评估。四档模型的天气严格通过率依次为46%、14%、68%、68%；本机3B与7B中位耗时约5.17秒和11.38秒，相同通过率不代表相同错误。实质问题包括明确广州被漏后补成系统上海、20分钟变成默认两小时，以及7B自行给10月12日补出2023年。严格分数也受原文接口规范影响：1.5B的12条嵌套字段题全部选对API，只有1条整条通过，其中7条省略现在或今天仍得到同一窗口；3B保留未来30分钟时仍是分钟窗口，但7B删成30分钟则无法解析。完整保留今天白天或未来3天逐日又会碰到冻结解析器的分词覆盖限制。7B夜间表达引入18至24点范围，与官方overnight字段是否等价尚无真实SDK证据；可以降精度却填strict_time:true则确实反转策略。这些人工区别不加回严格分数，结果仅代表本次开发集、单次CPU运行。

日历：真实目标、标题与全部变更必须保留。四档模型的日历严格通过率依次为24%、54%、40%、62%，7B中位耗时约8.50秒。稳定错因包括字段说明进入keyword、明确事件ID被省略后变成今天的列表、创建标题被遗漏或写入description，以及双字段修改只保留一个字段。3B晨会已保留时间、参会人和重复规则，单独漏标题仍需澄清；7B同题又丢参会人并猜时长提醒，不能笼统归为相同复杂参数错误。默认补全由代码完成，但模型填当前选中的日程ID仍能绕过缺目标澄清；壳子不检查ID真实存在。严格原文变化有时不改实际时间，如3B明天16:00与下午4点；也有状态相同但机制错误，如7B把冲突起止时间交换成合法顺序，只因标题缺失继续澄清。7B能正确保留提醒[0,15]和显式false，却仍把删除桌面文件命令转成伪取消。未执行真实日程写入，原始参数、解析问题和状态需要同时阅读。

联系人：对象层级与姓名、ID、可信选择来源。四档模型的联系人严格通过率依次为46%、58%、56%、80%，7B中位耗时约8.24秒。7B在本组19条嵌套字段题中严格通过18条，也正确处理可信选中对象读补全和缺ID写操作澄清，但完整邮箱对象被选整个联系人、完整地址对象被选单个地址文本、主页或群组ID被选父对象的边界仍存在。姓名林晓、陈雨、张三还会被放进contact_id而非query；没有真实身份映射或对象存在性验证，ready_mock不说明查对了人。3B读当前选中邮箱时猜占位ID，7B同题则输出空参数让代码从可信context补ct_7，实际来源可以直接核对。7B三字段更新可完整提取，却仍把拨号和查邮箱后发邮件缩成读接口，将上传命令转成伪上传并猜路径。父对象可能包含所需字段，但尚无SDK响应和裁剪证据可把它等同字段直达；严格分数保持原样，不能外推为生产准确率。

文件：接口更稳，目标和过滤条件仍会错。四档文件完整计划依次为 20/50（40%）、24/50（48%）、30/50（60%）、38/50（76%）；典型耗时 P50 依次约 0.78、1.53、2.54、5.61 秒，较慢耗时 P95 约 1.56、2.55、4.30、9.67 秒。每档都是同一批 50 条，较大模型在本领域整体改善，代价是更长耗时。

200 条中 112 条完整通过；88 条失败的最早可观察环节为领域/拒识 27、API 7、多填 24、漏填 27、值差异 3。支持 API 的 168 次目标均在实际候选中；候选存在不代表能正确选取或填写。原文的否定、未知说明、文件 ID、类型过滤和窗口标题仍会被遗漏或混用。

需要特别区分两类结果：1.5B 漏掉明确 file_explicit 后补为 file_other，和 7B 把窗口标题待审稿当 file_id，都会改变目标；0.5B 改写 file URI、7B 丢 URL 的 #part2 则属于严格原文保留失败，真实 SDK 是否将其规范为同一文件或使用片段定位未验证。后者不会加回正确率，也不直接描述为已查错文件。

四档对 8 条文件边界拒识用例分别只完整通过 0、1、2、4 条；搜索后预览、读取大小同时关闭窗口均仍可能只生成其中一个动作。模拟状态 ready_mock 只能说明输入通过本实验解析，不能证明来自用户的目标和全部约束都正确。

服务入口：服务元信息、业务数据和页面动作仍容易混淆。四档服务入口完整计划依次为 24/50（48%）、26/50（52%）、28/50（56%）、30/50（60%）；典型耗时 P50 约 0.69、1.47、2.47、5.35 秒，较慢耗时 P95 约 1.52、2.62、4.93、11.15 秒。7B 比 3B 多通过 2 条，但 API 准确率由 76% 降到 74%，单看参数量不能断言每个环节都更准。

200 条中 108 条完整通过；92 条失败的最早可观察环节为领域/拒识 41、API 12、多填 11、漏填 25、值差异 3。支持 API 的 168 次目标均在实际候选中。天气服务的可用状态、页面参数或目标页面，仍可能被路由成天气数据查询；“能否打开”也可能被当成“打开”。

嵌套参数的主要损失是整段 parameters.query 被遗漏，不能解释为中文空格或 URL 转义的严格评分。1.5B、3B、7B 均出现只打开 contacts 页面而丢掉 query='张 三' 的例子；7B 同样丢掉 query='A&B 合并'。其余正确案例能生成嵌套对象，故应描述为条件提取不稳定，而非一律不支持嵌套数据。

明确 files 被漏掉后补为已选 weather、未知服务被猜成 weather，都能出现 ready_mock。四档 8 条边界拒识用例分别完整通过 1、0、1、1 条；取得链接再打开、打开日历再查天气经常只保留一个动作。当前只是模拟计划，服务可执行状态无法代替路由、目标、来源和全部参数正确。

云端业务：正文有所改善，对象、字段、路径和默认值仍不稳定。四档云端完整计划依次为 10/50（20%）、13/50（26%）、9/50（18%）、20/50（40%）；典型耗时 P50 约 0.95、1.75、3.17、6.77 秒，较慢耗时 P95 约 1.73、2.61、5.59、12.58 秒。3B 低于 1.5B，7B 在本批改善，但不存在参数量与准确率全程单调关系。

200 条中 52 条完整通过；148 条失败的最早可观察环节为调用/结构 1、领域/拒识 32、API 26、多填 48、漏填 36、值差异 5。支持 API 的 188 次目标均在本次候选中。会议资料对象/字段会与云数据库、存储下载链接或本地文件元信息混淆；同属云端领域并不意味着使用了正确对象和返回投影。

本测试的云函数 data 是保留原样的字符串，字符串内部可含对象和数组；服务 parameters 则是真正嵌套对象，二者不能混称。0.5B 将嵌套 JSON 正文置 null 或截断，1.5B 和 3B 能通过一条较复杂 JSON 字符串却遗漏另一条正文；7B 的四个函数用例均通过，包含明确版本/超时和函数名缺失后的澄清。成功样本证明能力存在，样本数不足以证明普遍可靠。

未知信息仍会被猜成字符串 null、参数说明、当前对象名称或本地 './' 路径。JSON null 被兼容清除，字符串 'null' 是有值的字符串；把前者与后者混为一谈会掩盖错误放行。明确 install/link 被漏掉后默认 periodic，存储 bucket 和数据库 zone 被遗漏，则会改变操作模式或目标范围。

严格格式差异不能掩盖独立错误：0.5B 一条正文句号改写同时编造会议 ID；1.5B 一条云路径增加前导斜线同时漏存储实例；3B 把 count(eventId) 填作字段名而另传 operation=count，是字段契约错误。四档的三条云端拒识用例均未完整通过，多动作保存后分享经常只剩一个保存计划。全部结果来自模拟业务壳子，未实际读写云端服务。

错误归类依据实际候选、原始提取、有效参数和状态，而不是模型内部原因猜测。核验1200条原始记录后，支持题的目标API全部进入实际候选，候选遗漏为0；本题组的主要剩余问题位于拒识/选API和参数保留。每个失败只计一个主错因，其他连带失败仍能在逐项分数与原始记录中查看。

严格分数与实际业务语义要一起读。原文时间的等价改写、与系统默认相同的冗余值也会扣分；漏地点后补到其他城市、漏事件ID后读取列表、漏明确写字段则会实际改变计划。今天白天等原文还暴露了冻结时间解析器和金标切分的局限。文档保留全部原分数，只在人工复核中解释差异；尚未接SDK的URI、父对象与字段返回形态不能擅自宣布等价。

下一阶段应优先保留显式约束并验证目标身份，扩展确定性时间规范化和解析覆盖，检查写操作的占位ID、缺字段与冲突信息，再以独立新表达做盲测及重复计时。当前ready_mock只表示伪接口计划通过部分契约，没有读取或修改真实业务数据；夹具位置、地理编码、天气可用性及所选对象都明确标记。


## 优化前后：同题组 0.5B 完整对照

仅同一公开开发集300题的0.5B旧/新完整对照；其余模型旧轮未全完成，不作完整对照。

| 领域 | 旧完整计划 | 新完整计划 | 旧P50秒 | 新P50秒 |
| --- | --- | --- | --- | --- |
| 天气 | 0.0% | 46.0% | 1.98 | 1.50 |
| 日历 | 8.0% | 24.0% | 1.50 | 1.31 |
| 联系人 | 12.0% | 46.0% | 1.22 | 1.15 |
| 文件 | 34.0% | 40.0% | 0.97 | 0.78 |
| 服务入口 | 32.0% | 48.0% | 0.82 | 0.69 |
| 云端业务 | 14.0% | 20.0% | 1.07 | 0.95 |

| 版本 | 题数 | API | 明确入参 | 完整计划 | P50秒 | P95秒 |
| --- | --- | --- | --- | --- | --- | --- |
| 旧 retrieval-v5 | 300 | 64.7% | 18.3% | 16.7% | 1.20 | 2.77 |
| 新 sparse-v6 | 300 | 71.7% | 45.3% | 37.3% | 1.11 | 1.77 |

- 综合包含检索与稀疏协议改动，不能将全部收益单独归因于某一提示词规则。
- 公开开发集经过错误诊断优化，不是独立盲测。
- 单次CPU推理耗时受系统负载影响。

旧轮其余模型未全部完成，保留部分记录但不用于总体改善对照。主结果仍只统计当前独立清单的 1200 次。

## 复现与页面阅读

页面：批量评测 → 领域与模型对照。选择测试领域和模型，查看完整领域 50 题对照；场景筛选仅作用于下方明细和错误例子。展开错误组查看预期/实际，再点调用详情查看模型实际看到的候选、提示词、原始 JSON 和单次耗时。报告可导出 JSON。

首次执行：npm run benchmark:domains。已有本轮记录时脚本不覆盖：node scripts/benchmark-domains.mjs --resume 按已登记批次继续；冻结条件改变会拒绝混跑。只导出：node scripts/benchmark-domains.mjs --export-only。node scripts/write-domain-results.mjs 从原始批次重新生成此文档，无模型调用。

本轮不为提高成绩修改已冻结提示词、候选或金标，也不重试失败、补答案或过滤服务错误。新题组涉及公开开发契约、人工边界、fixture 系统状态、伪业务执行，后续需要独立盲测集、不同模型家族、重复运行、真实设备位置/SDK响应及真实用户分布验证。

## 批次索引

| 领域 | 模型 | 状态 | 完成数 | 批次ID |
| --- | --- | --- | --- | --- |
| 天气 | qwen2.5:0.5b | completed | 50 | 6b75420a-9c00-4622-a7ac-aaeed097518a |
| 日历 | qwen2.5:0.5b | completed | 50 | af261b45-95d4-44b0-855b-0cecc1420a07 |
| 联系人 | qwen2.5:0.5b | completed | 50 | 31cc732b-ca28-4412-bf21-bac905484aad |
| 文件 | qwen2.5:0.5b | completed | 50 | ae120a8a-0a95-4722-8c42-1f2762714b6f |
| 服务入口 | qwen2.5:0.5b | completed | 50 | 46dec7ac-07a7-4b67-92fe-b2d0ee93a0fe |
| 云端业务 | qwen2.5:0.5b | completed | 50 | 0d928fe6-7923-430e-ab94-4f5d9ecdd075 |
| 天气 | qwen2.5:1.5b | completed | 50 | d9a681ab-612c-47e4-b681-2d1edb26ed79 |
| 日历 | qwen2.5:1.5b | completed | 50 | 8c154771-34d8-4032-a542-afb802a8c51c |
| 联系人 | qwen2.5:1.5b | completed | 50 | f66e68c8-9080-436d-ab32-173b0f054a8b |
| 文件 | qwen2.5:1.5b | completed | 50 | 0fcb3e5f-71e1-46e3-87a9-cf046541ee1f |
| 服务入口 | qwen2.5:1.5b | completed | 50 | f5b0f5be-4b8e-4779-875f-9e1f041336e1 |
| 云端业务 | qwen2.5:1.5b | completed | 50 | d83e758d-9113-4eab-adba-118299b38f2e |
| 天气 | qwen2.5:3b | completed | 50 | fc92b364-e09f-456c-86b1-b7626213df8b |
| 日历 | qwen2.5:3b | completed | 50 | 209bbbed-d192-4f88-9115-7c2dbcc2d01a |
| 联系人 | qwen2.5:3b | completed | 50 | 5ec58b55-5dfc-49df-8d83-a1e46e3311f1 |
| 文件 | qwen2.5:3b | completed | 50 | ca560722-56a4-4798-83e5-168f9afaf51c |
| 服务入口 | qwen2.5:3b | completed | 50 | 6e545fa4-938e-45bf-b4a4-cfb61d9626f4 |
| 云端业务 | qwen2.5:3b | completed | 50 | b46a8ce1-a9fe-4016-a9bf-72c2825f4727 |
| 天气 | qwen2.5:7b | completed | 50 | 19dcb581-2443-4b16-851d-d6eeed4b9830 |
| 日历 | qwen2.5:7b | completed | 50 | 7cf94c42-f866-4292-b824-32f2293c2a41 |
| 联系人 | qwen2.5:7b | completed | 50 | 61fae402-8497-4ea4-a1d1-f432e17118c7 |
| 文件 | qwen2.5:7b | completed | 50 | b60358ec-067c-4563-9504-b8a108ab159c |
| 服务入口 | qwen2.5:7b | completed | 50 | de60b2e0-3c2b-40d1-8a0a-cb104f925390 |
| 云端业务 | qwen2.5:7b | completed | 50 | 11fa30c4-9afa-4f8d-8f8d-d37ef0a9db6b |
