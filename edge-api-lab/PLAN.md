# 第一阶段端侧语义 API 验证工程

> **2026-10-10 历史计划快照**：下文的六领域、372个API、验收项及模块契约描述当日方案，保留用于历史对照。现阶段为10领域、417个伪API、100条单服务用例；最新范围、原因分析与实测（含7B硬件限制）分别见[当前阶段说明](docs/current-feasibility.json)、[入参问题分析](docs/PARAMETER_CAUSE_ANALYSIS.md)及[当前单服务实测](docs/feasibility-final3.json)。

目标：在本机 Ollama 上完成中文提示词到可校验伪 API 调用的多领域实验，展示每次推理耗时和可复现评测；逐阶段预留 Jev 接口。业务接口只模拟，系统时间真实读取，位置可由浏览器授权提供或使用明确标注的固定实验夹具。

验收：交互页面、6 业务领域/372 个对象字段与操作 API、178 条样本、4 档 <10B 模型、分层/一次调用对照、系统补全来源与精度降级、拒识/澄清、批量评测/取消/历史/导出、11 个详细说明页签、双击 BAT 启动；真实 Ollama 运行证据与自动测试。

技术：Node >=22 内置 HTTP/fetch/test，原生 HTML/CSS/ES modules，无构建依赖；监听 127.0.0.1:3210；Ollama 127.0.0.1:11434；串行推理避免争抢 CPU。现有文件不修改。

共同契约（各模块可添加字段，不能更改命名）：
- registry.mjs exports domains [{id,name,description}], capabilities [{id,domain,name,description,inputs:{field:{type,description,required?,enum?,default?,resolver?}},risk}], getCapability(id), listCapabilities(domain), schemaFor(capability)；schemaFor 的对象属性可缺省，只包含显式参数，不填默认值。
- domains = weather/calendar/contacts/files/services/cloud，unsupported 作为拒识结果。
- providers.mjs exports createProviders({ollamaUrl,jevUrl}) -> {ollama,jev}; each provider.invoke({stage,model,messages,schema,options,signal}) -> {value,trace}; trace 包含 stage/provider/model/wallMs/loadMs/promptMs/generationMs/inputTokens/outputTokens/tokensPerSecond/messages/raw/schema/error?；失败抛错并携带 trace。
- prompts.mjs exports buildDomainPrompt(text), buildIntentPrompt(text,domain), buildArgumentsPrompt(text,capability), buildUnifiedPrompt(text)；返回 {messages,schema}，短中文提示词与受限 JSON。
- resolver.mjs exports resolveArguments(capability,args,context) -> {arguments,sources,missing,issues,status}; context={now:'ISO string',timezone:'Asia/Shanghai',location?:{latitude,longitude,label?,source:'browser'|'fixture'},locationError?}; status ready_mock/needs_clarification/resolution_failed；显式信息优先，时间相对值由代码解析，业务写动作缺关键字段禁止默认，定位失败不能猜。
- pipeline.mjs exports runPipeline({text,mode:'staged'|'unified',model,stages?:{domain:{provider,model},intent:{provider,model},arguments:{provider,model},unified:{provider,model}},context,options}, {providers,signal,onTrace}) -> {domain,api,extractedArguments,resolved,status,traces,totalMs,text,mode,model,context,mock}; 未知/多意图可 unsupported 或 needs_clarification，schema 验证失败保留 trace；不调用真实业务。
- data/cases.json = [{id,text,category,expected:{domain,api,arguments:{...显式参数},status,sources?:{field:source}}}]；固定 context 2026-10-10T08:00:00+08:00 Asia/Shanghai，location 上海固定坐标标记 fixture；基准只描述冻结输入，不代表当前真实状态。
- docs/guide.json = [{id,title,html}]，内部可信静态说明，5+ 页签：上手、架构、API、提示词、评测、Jev、边界。
- server endpoints: GET /api/health {ollama,models,recommendedModels}; GET /api/catalog {domains,capabilities}; GET /api/docs {sections}; GET /api/cases {cases,context}; POST /api/runs {text,mode,model,stages,context?,options?} -> run; GET /api/runs -> {runs}; GET /api/runs/:id -> run.
- POST /api/evaluations {models:[name],mode,caseIds?:[id],limit?:number,stages?,options?,warmup?:boolean,repeats?:number} -> {id,status}; GET /api/evaluations -> {evaluations}; GET /api/evaluations/:id -> job; POST /api/evaluations/:id/cancel -> job. job={id,status,progress:{done,total},results:[{caseId,text,model,expected,actual,score,run}],summary:[{model,total,domainAccuracy,apiAccuracy,argumentAccuracy,statusAccuracy,planAccuracy,p50Ms,p95Ms,errorCount}],error?}; score 布尔字段 domain/api/arguments/status/plan，empty args 也计分，错误不排除分母。
- GET /api/export?type=runs|evaluations&format=json|csv 下载本地记录；前端可直接 Blob 下载单份对象。
- 每个请求保存 traces，包括失败；duration 纳秒转毫秒。统一调用无路由耗时拆分，标记一次调用；冷加载与输入/输出计时独立展示。

状态对象：server 独占 job lifecycle queued -> running -> completed / cancelled / failed；取消 AbortController 终止当前推理，保留已完成样本；进程重启把未完成任务标记 interrupted。统一推理队列；只保存派生指标的原始记录，每次读取重新计算 summary。写记录用临时文件与 rename，串行存储。运行记录本地 data/runtime，.gitignore 排除。

执行：各模块先写行为测试并看到失败，再实现；独立 frontend/catalog/backend 并行；root 完成 server/jobs/evaluation 集成。全量 node --test；真实四模型小样本比较；浏览器桌面/窄屏、错误状态与页签验证；补齐交付说明和启动脚本。

2026-10-10 修订范围：
- 保留旧 15 个入口，新增对象字段 getter 与字段 setter；天气203、日历53、联系人76、文件12、服务7、云端21。复合对象进一步补齐48个官方叶字段，包括日程参会人/重复规则及联系人网站/关系/群组/IM/SIP等。
- 每项记录 object/field/projection/returns/sourceRef/support，明确官方字段、官方方法、适配契约、业务扩展。
- time.resolution 保存 requested/effective/dataset/precision/fallback；同字段与单位兼容才降级；严格策略不能降精度；current 不替代未来；保留请求范围。
- 地点区分坐标/城市代表点/粗定位，地理编码夹具标明来源；只读当前对象只使用 trusted user_selection，写目标不默认。
- 提示词先检索短候选；运行不读取金标。离线召回审计单独统计；模型真实错误与耗时持久保存。
- scoreCase 增加 expected.resolution 的递归部分匹配，数组长度一致；38 题标注补全条件。新版本 object-fields-v2 与 legacy-v1 历史分开；四档提示词对照保留324接口目录快照，最终新增字段另做冒烟验证。
- 交付 docs/guide.json（页面内11页签）、README、BAT、docs/VERIFICATION.md 和 evidence 截图。
