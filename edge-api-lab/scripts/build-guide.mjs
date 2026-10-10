import {readFile,writeFile} from 'node:fs/promises';
import {capabilities,domains} from '../src/registry.mjs';
import {PROMPT_VERSION} from '../src/prompts.mjs';
import {loadCases} from '../src/corpus.mjs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {resolve,sep} from 'node:path';
const cases=await loadCases(fileURLToPath(new URL('..',import.meta.url)));
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const table=(caption,head,rows)=>`<div class="table-wrap"><table><caption>${caption}</caption><thead><tr>${head.map(v=>`<th scope="col">${v}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const link=(url,text)=>`<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
const jsonBlock=value=>`<pre><code>${escape(JSON.stringify(value,null,2))}</code></pre>`;
const counts=domains.map(domain=>[domain.name,capabilities.filter(c=>c.domain===domain.id).length]);
const section=(id,title,html)=>({id,title,html});
let validation=null;try{validation=JSON.parse(await readFile(new URL('../docs/validation-v2.json',import.meta.url),'utf8'));}catch{}
let baseline=null;try{baseline=JSON.parse(await readFile(new URL('../docs/validation-v4.json',import.meta.url),'utf8'));}catch{}
let smoke=null;try{smoke=JSON.parse(await readFile(new URL('../docs/validation-final.json',import.meta.url),'utf8'));}catch{}
let domainReport=null;try{domainReport=JSON.parse(await readFile(new URL('../docs/validation-domain-50.json',import.meta.url),'utf8'));}catch{}
let domainAnalysis=null;try{domainAnalysis=JSON.parse(await readFile(new URL('../docs/domain-analysis.json',import.meta.url),'utf8'));}catch{}
// A current-protocol page must never reuse the cancelled round's result snapshot.
if(domainReport?.conditions?.promptVersion!==PROMPT_VERSION){domainReport=null;domainAnalysis=null;}
if(domainAnalysis?.manifestId!==domainReport?.id)domainAnalysis=null;
let groundingReport=null;try{groundingReport=JSON.parse(await readFile(new URL('../docs/grounding-replay.json',import.meta.url),'utf8'));}catch{}
if(groundingReport?.manifestId!==domainReport?.id)groundingReport=null;
if(groundingReport){
  try{
    const guideRoot=resolve(fileURLToPath(new URL('..',import.meta.url))),hashes=Object.entries(groundingReport.conditions?.replaySourceHashes??{});
    if(!hashes.length)groundingReport=null;
    for(const [file,hash] of hashes){
      const source=resolve(guideRoot,file);
      if(!source.startsWith(guideRoot+sep)||createHash('sha256').update(await readFile(source)).digest('hex')!==hash){groundingReport=null;break;}
    }
  }catch{groundingReport=null;}
}
let optimization=null;try{optimization=JSON.parse(await readFile(new URL('../docs/optimization-comparison.json',import.meta.url),'utf8'));}catch{}
if(optimization?.newId!==domainReport?.id)optimization=null;
const domainName=id=>domains.find(item=>item.id===id)?.name??id;
const percent=value=>value==null?'—':`${(value*100).toFixed(1)}%`;
const seconds=value=>value==null?'—':(value/1000).toFixed(2);
const verified=[baseline,validation].filter(Boolean);
const jobs=[...new Map(verified.flatMap(report=>report.jobs.map(job=>[job.id,{...job,promptVersion:job.promptVersion??report.promptVersion}]))).values()];
const summary=jobs.length?table('历史 retrieval-v4 / retrieval-v5 开发验证', ['当时提示词','模式','模型','样本数','完整计划','P50 秒','P95 秒'], jobs.flatMap(job=>job.summary.map(s=>[job.promptVersion,job.mode,s.model,s.total,`${(s.planAccuracy*100).toFixed(1)}%`,(s.p50Ms/1000).toFixed(2),(s.p95Ms/1000).toFixed(2)]))):'<p>历史开发验证快照尚未提供；原始调用记录继续保留。</p>';
const smokeVersions=[...new Set((smoke?.jobs??[]).map(job=>job.promptVersion??smoke.promptVersion??'见原始记录'))].join(' / ');
const smokeSummary=smoke?.jobs?.length?`<h3>历史目录冒烟验证</h3><p>${smoke.catalogCount} 接口目录点，3B 模型，公开开发样本，包含新增日程/联系人叶字段和六领域链路。当时提示词为 ${escape(smokeVersions)}，这些是本轮优化前的历史结果，未采用当前 ${escape(PROMPT_VERSION)} 协议。它与上面四档对照的题组不同，不能直接比较百分比。</p>${table('历史目录冒烟实测',['模式','模型','题数','完整计划','P50 秒','P95 秒'],smoke.jobs.flatMap(job=>job.summary.map(s=>[job.mode,s.model,s.total,`${(s.planAccuracy*100).toFixed(1)}%`,(s.p50Ms/1000).toFixed(2),(s.p95Ms/1000).toFixed(2)])))}<p>历史记录：${smoke.jobs.map(job=>`<code>${job.id}</code>（${job.mode}）`).join('；')}；详情保存于 <code>docs/validation-final.json</code>。</p>`:'';
const sections=[
section('start','上手与操作',`
<h2>把一句话变成可检查的字段调用</h2><p>本工程验证中文提示词的领域划分、API 选择、显式参数提取以及系统补全。现有六个领域共 ${capabilities.length} 个伪 API、${cases.length} 条冻结样本。业务接口仅生成调用计划与模拟回执，字段值为 null，便于先验证语义链路。</p>
<h3>双击启动</h3><ol><li>保持 Ollama 运行，使用 Node.js 22 或更新版本。</li><li>双击工作区的 <code>启动API验证工程.bat</code>，或项目内的 <code>启动实验室.bat</code>。脚本启动本机服务并打开浏览器，重复双击会复用已运行服务。</li><li>页面地址 <code>http://127.0.0.1:3210</code>，服务只监听本机。停止服务可运行 <code>stop.ps1</code>。</li><li>实验台运行一句话；批量评测比较模型；能力目录按领域、对象、时间粒度和字段筛选；运行记录查看原始结果；详细说明包含本页的 13 个页签。</li></ol>
<p>无需安装第三方工程依赖。启动故障可查看 <code>data/runtime/server-error.log</code>。主程序和启动脚本均支持带中文的目录。批量评测新增“领域与模型对照”，比较六领域各 50 条新增用例、四档模型；详细说明现在有 13 个页签。</p>
<h3>建议先试</h3><ul><li>“现在湿度是多少？”：直达实况湿度字段，缺地点用所选系统位置，缺时间用当前时间。</li><li>“明天下午三点上海的湿度”：逐小时湿度，保留明天下午三点的约束；上海城市坐标来自明确标注的地理编码夹具。</li><li>“这份文件叫什么名字”：先在系统上下文填写当前文件 ID，再读取名称；未选对象时要求澄清。</li><li>“帮我建个日程，标题是项目复盘”：缺开始时刻要求补充，不能用现在代替。</li></ul>
<h3>本机四档模型</h3><p>已安装 Qwen2.5 0.5B、1.5B、3B、7B，参数量均小于 10B；页面读取 Ollama 实际参数规格及量化信息。初次加载更慢，批量可启用独立预热。模型列表参考 ${link('https://ollama.com/library/qwen2.5','Ollama 官方条目')}。</p>
<h3>可控的系统上下文</h3><p>交互实验读取本机当前时间和时区。位置可选精确坐标夹具、城市粗位置、无位置或浏览器授权定位；夹具均为模拟环境，不能当作当前设备的真实位置。可关闭城市地理编码夹具或关闭天气某个数据集，验证缺失与降级。当前对象输入框代表用户明确选择的对象，留空时不会自动造 ID。</p><p>批量基准固定时间为 2026-10-10 08:00（Asia/Shanghai），系统位置为上海测试坐标；每条样本可覆写环境。所有上下文随运行记录保存。</p>`),
section('architecture','实验架构',`
<h2>扩展字段，限制每次模型看到的目录</h2><pre><code>用户提示词 → 领域识别 → 候选检索 → 模型选择 API
           → 显式参数提取 → 原文核对 → 时间/位置/对象补全 → 契约检查
           → 模拟回执 + 候选/原文/耗时记录</code></pre>
${table('两种调用模式',['模式','模型调用','对照意义'],[['分层 staged','领域、意图、参数，最多 3 次','每轮任务简单；可定位错误发生在哪层；往返更多。'],['一次 unified','候选内同时输出领域、API 和参数，1 次','减少往返；需要一轮理解相似接口及其参数。']])}
<p>候选检索依据当前文本、别名、对象字段与读写动作，不读取评测答案；分层意图最多 6 个候选，一次调用最多 12 个。最终 API 由模型从候选中选择。记录包含候选 ID、分数与检索规则，因此可分清候选遗漏和模型误选。</p>
<h3>模块职责</h3>${table('工程结构',['模块','职责'],[['registry / weather-capabilities / extended-capabilities','字段契约、官方来源、投影、返回类型、粒度与默认规则。'],['prompts / providers','短中文提示词、受限 JSON Schema、Ollama 与 Jev 单次调用、原始响应与计时。'],['resolver / fixtures','确定性时间解析、同字段精度降级、地点与当前对象补全；夹具标记。'],['pipeline / evaluation','串接模型与规则、模拟输出、显式参数和精度条件评分。'],['application / runtime','串行推理、批量预热与取消、原子保存、历史导出。'],['public / docs','交互页面、能力筛选、补全解释和详细说明页签。']])}
<p>当前 ${escape(PROMPT_VERSION)} 使用稀疏参数：模型仅提取用户明确提供的信息，未知字段完全省略；嵌套对象也仅包含用户提供的项，不填 null、空对象或占位文字。其余由系统规则补全并另存来源。原始 modelArguments、extractedArguments 和 trace.raw 保留；旧协议 null 仅作兼容省略。新增原文核对将有确定依据的修复另存 groundedArguments，并记录片段、理由与拦截；时间归一化呈现在 resolved.arguments 与 resolution.time。领域/API 选择保持模型原判断，ID 真实存在性仍需后续 SDK 接入。</p>`),
section('contracts','对象与字段',`
<h2>${capabilities.length} 个字段与操作壳子</h2><p>扁平化按照“对象 → 具体字段/操作 → 直达 API”建立目录。单个字段优先 getter；同一对象多个字段可选择总览/详情。嵌套字段保留原始路径，数组投影用 <code>[]</code> 标明，不伪造为单值。</p>
${table('当前覆盖',['领域','API 数量','主要对象与字段'],counts.map(([name,count],i)=>[name,count,[ '实况、小时、逐日、分钟、预警、指数、潮汐、城市；温度/湿度/风/气压/空气质量/日月等。','事件、位置、参会者、提醒、重复规则、服务链接、账户、配置；查询/创建/修改/取消。','电话、邮箱、姓名、地址、组织、纪念日、头像、分组、关系等及嵌套字段；创建和字段更新。','预览能力、预览状态/关闭/准备；文件名称、大小、类型、修改时间等拟定业务元数据。','注册服务目标、参数、可用性、直达链接；链接解析与延迟深链读取。','会议资料字段、存储下载链接与上传/下载、云函数、数据库字段/统计、预取结果/时间/token。'][i]]))}
<h3>典型直达入口</h3>${table('字段 API 示例',['API','查询对象/投影','主要入参'],[['weather.current.humidity','current.humidity，百分数','location 或 coordinates；time_ref；strict_time'],['weather.hourly.wind.speed','hourly.forecast[].wind.speed','地点、时间范围；字段单位见目录'],['weather.daily.sun.sunrise','daily.forecast[].sun.sunrise','地点、日期'],['calendar.event.location.latitude','Event.location.latitude','event_id，或 keyword/time_ref 查询候选'],['contacts.organization.title','Contact.organization.title','contact_id 或 query'],['files.metadata.size','业务文件对象 size','file_id，可用明确选择的当前文件补全'],['materials.permissions','业务会议资料 permissions','material_id，可用当前资料补全'],['cloud.database.field','业务集合中指定记录的指定字段','collection、record_id、field_name；zone 可选']])}
<h3>来源与实现边界</h3><p>每个目录卡片显示输入、输出类型、单位、投影、时间粒度及来源。标签区分“官方对象字段”“官方方法”“适配契约”“拟定业务扩展”。有官方参考链接并不代表所有业务字段都是 SDK 原生接口。</p>
<p>天气、日历和联系人 getter 投影于官方对象；字段 setter 需要未来组装 SDK 更新对象。Preview 提供预览 API，文件搜索与元数据需要单独文件索引。App Linking 提供深链能力，服务注册表由业务定义。Cloud Foundation 提供存储/数据库/函数/预取，会议资料需要另建业务模型。当前模拟回执的 <code>value:null</code> 明确表示尚未获取真实字段值。</p>
<h3>参数约束</h3><p>显式参数使用准确类型；号码是字符串；数组与枚举受 Schema 约束；未知字段、空白必填值、错误类型和结束早于开始会被检查。查询联系人时姓名是 query，不冒充唯一 contact_id；查询日程也可返回候选列表，不自动选中某个事件。</p>
<h3>同一个位置的两种输入表达</h3><p>天气输入表中的 <code>location</code> 接收地点原文（“上海”“这里”），<code>coordinates</code> 接收用户明确给出的经纬度；它们是同一个查询位置的替代输入，不要求提供两份。模型按用户本句提供的表达提取，不把系统坐标抄成用户参数。最终坐标查询需要完整的 latitude 和 longitude；用户只给一项时保留该项并要求补充，不猜另一项。都未提供时尝试系统位置；同时提供时明确坐标优先。解析成功后统一使用 <code>resolution.location.effective</code> 的坐标，并保留原文、来源、精度和地理编码说明。字段 getter 需要可靠坐标，旧聚合入口仍可保留待编码地点。模型提取契约与最终 SDK 查询契约分开呈现。</p>`),
section('precision','时间地点降级',`
<h2>先保留请求，再决定可用精度</h2><p>结果分别记录 requested 与 effective，保留原始时间表达、请求范围、地点名称、实际数据集、精度、实际接口和投影。任何降级都会解释原因；缺少可核验依据时失败或澄清。</p>
${table('天气原生粒度',['数据集','时间能力','限制'],[['current','当前实况；当前时间戳','不能冒充明天、历史或未来窗口。'],['hourly','逐小时预报；整点或小时范围','非整点请求可降至所属小时，保留原始分钟约束。'],['daily','逐日预报','不能把日值解释为下午或某分钟实况。'],['minute','短临逐分钟降水','只有 date、precipitation、precipitationIntensity；无分钟湿度/风速等。'],['alerts / indices / tides / city','预警更新时间、逐日指数、小时潮汐、城市信息','依据对应对象定义，不套用统一分钟精度。']])}
<p>天气官方介绍的范围为中国境内未来 48 小时、境外 24 小时逐小时预报、未来 10 天逐日预报、未来 2 小时短临降水（约 5 公里范围）。工程以契约范围检查时间窗口，界面可模拟数据集不可用；这不代表已请求真实服务。实验默认中国区（八城夹具均在中国）；请求上下文 weatherRegion=outside_CN 可切换境外 24 小时限制，不根据坐标推断国家。具体可用范围随地区与服务返回变化，接入后应使用实际响应。参考 ${link('https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V14/weather-service-introduction-V14','华为天气服务介绍')}。</p>
<h3>降级规则</h3><ol><li>根据用户时间与所选字段确定所需粒度。</li><li>检查该对象的原生粒度、实验可用性、预报范围。</li><li>只在目录明确列出的同字段兼容数据集间选择替代；保存 effective.api/projection。</li><li>分钟→小时可向下取整单个时刻、扩大窗口边界，日级可扩大到日期；标明仍需按原请求过滤，不能声称精度没变。</li><li>strict_time=true 或关闭允许降级时，不能满足精度就澄清。没有同单位、同语义字段替代时也澄清，例如分钟降水密度不能替换为小时降水量。</li></ol>
<h3>位置规则</h3><p>明确坐标优先；明确城市名使用开启的地理编码夹具（上海、北京、杭州、深圳、广州、成都、南京、武汉），其结果是城市代表点，标为 fixture/city。缺地点或“这里”取所选系统位置。粗位置保留误差和精度说明；未知城市、关闭夹具且无坐标、设备无位置时不会猜坐标。支持字符串地点的旧聚合契约可保存待编码地点，但需要坐标的字段 getter 必须补全成功。</p>
<p>授权定位仅在用户按浏览器定位按钮后进行，浏览器权限拒绝会显示原因。工程不使用 IP 自动猜当前位置。当前版本的地点降级解释适用于天气读取，其余领域的对象选择规则见下一页。</p>`),
section('defaults','各领域补全',`
<h2>默认信息必须有依据</h2>${table('可补信息',['领域','允许补全','不能代填'],[['天气','当前时钟、时区、只读默认时间窗、系统位置、已标记地理编码夹具、缺省严格策略。','真实湿度/雨量；未知城市坐标；不存在的粒度。'],['日历','未给目标或时间的只读查询默认今天；明确选择的当前事件/账户；创建时系统时区；明确结束时刻可继承开始日期。','缺开始时间不能用现在；修改/取消目标不得靠当前选择偷偷代填；不补标题或参会人。'],['联系人','只读从当前联系人补 ID；姓名保留为搜索词。','姓名不转唯一 ID；写字段不能补电话号码、邮箱或写目标。'],['文件','只读当前文件 ID；预览 MIME 可按 URI 扩展名推断，未知扩展为空交 SDK URI 检测；预览状态无需目标。','文件元数据真实值；未选“这份文件”的 ID；搜索关键词。'],['服务链接','用户选择的注册服务/链接；延迟深链读取无需输入。','任意网站不变成已注册服务；不猜打开页面参数。'],['云端业务','只读当前资料/云路径/记录/zone/资源；云函数官方默认版本 $latest、超时 70000ms；预取模式缺省 periodic 为工程规则。','上传/下载本地路径、云函数名、集合/字段名、资料内容或分享目标。']])}
<h3>当前对象的信任边界</h3><p>只有页面中明确填写或选择的对象才产生 <code>{value, trusted:true, source:"user_selection"}</code>。模型只知道已选对象的种类，不需要抄写 ID；解析器按每个输入的 selected_object 规则补入并记录 context 来源。缺对象仍澄清。</p><p>日程和联系人字段修改、分享、上传/下载等写操作需要用户明确的业务目标和参数。查询字段与修改字段分开，不能把一次只读当前对象选择推广为任意写操作授权。本阶段所有操作依然只模拟。</p>
<h3>结果状态与来源</h3>${table('状态',['状态','含义'],[['ready_mock','计划满足规则，返回模拟契约、投影和 null 值。'],['needs_clarification','缺业务字段、对象歧义、关系错误或无法满足精度。'],['resolution_failed','需要系统时间/位置等环境信息，但补全失败。'],['unsupported','目录外需求或多个独立动作。'],['error','模型响应或结构/服务错误，失败 trace 保存。']])}<p>来源包括 user、system_time、system_location、default、context；位置内部进一步保存 browser/fixture/user，当前对象保留 user_selection，MIME 与系统时区补全也有解释。</p>`),
section('prompts','提示词与模型',`
<h2>短候选、短任务、可审计输出</h2><p>当前提示词版本 <code>${PROMPT_VERSION}</code>。检索从完整目录缩小候选，再让模型选择；单字段 getter、多字段聚合、读写方向、时间对象优先级均有短规则。系统与用户消息分开，用户文本中的“忽略规则”仍是待理解内容。</p><ul><li>模型输出受限 JSON，不要求思维过程。</li><li>显式时间保留原文，日期换算交由代码；没有提到的地点、ID、默认值完全不输出，无明确参数时返回空的 arguments 对象。</li><li>参数为稀疏对象，字段按用户输入出现；嵌套对象仅保留有值项，地点文字和坐标按实际表达二选一。不填 null、字符串“null”、空对象或参数说明占位。业务必填标记由最终契约校验，不要求模型虚构缺失信息。</li><li>传输按实际 Schema 约束可选字段与类型；兼容旧 null 响应时仅递归省略 null。原模型参数不改写，新增确定性原文核对另存修复参数和审计；依据是请求原文与可信系统上下文，不读取评测金标。</li><li>staged 分层意图最多 6 个候选；unified 一次最多 12 个。原始 trace 保存实际消息与 Schema、候选和版本。</li><li>拒识提前结束，无隐藏重试、自动 JSON 修复或金标纠错。</li></ul>
<p>温度为 0；默认上下文 2048 token，可在页面调到 8192。输出预算：领域 32、意图 48、参数 160、一次 224 token。复杂参数可调整输出预算；截断、加载和生成耗时会记录。结构正确仍可能选错字段，必须结合语义评测。依据 ${link('https://docs.ollama.com/capabilities/structured-outputs','Ollama 结构化输出文档')}。</p>
<h3>候选召回与模型正确率</h3><p>候选检索若漏掉正确 API，模型无法选中它。因此独立保存 <code>data/retrieval-audit.json</code> 的候选召回审计。该离线审计可读取样本金标计算覆盖率，运行时检索不读取金标。候选检索分不是概率；召回率也不是模型准确率。现有样本用于工程验收，仍需真实表达留出集。</p>
<h3>本地费用与速度</h3><p>本机推理没有按调用 token 的云服务账单，但仍处理 token 并消耗时间、内存、计算资源。页面显示输入/输出 token、生成速率和加载时间。四档同家族模型便于比较规模，但不能先验保证大模型在每个样本更正确。</p>`),
section('evaluation','评测与耗时',`
<h2>${cases.length} 条样本，错误保留在分母</h2><p>覆盖显式字段、默认信息、相对时间、细粒度字段、降级、位置缺失、当前对象、有写目标/缺写目标、歧义、拒识与注入。旧 65 条样本另存 <code>data/cases-v1.json</code>，新版运行标记 <code>object-fields-v2</code>，旧记录标为 legacy-v1。</p>
${table('评分口径',['检查项','比较规则'],[['领域 / API','与冻结预期完全相同；API 包括具体数据集/字段 ID。'],['显式参数','仅包含明确输入的稀疏参数与金标深比较；不容忍额外猜测字段；不以系统补全后的参数替代模型输出评分。旧 null 协议作兼容省略，原文仍保留。'],['状态 / 来源','结果状态完全匹配；样本声明的来源约束逐项匹配。'],['精度与补全','expected.resolution 声明的 requested/effective 数据集、精度、降级及来源部分匹配；数组长度一致。'],['完整计划','上述所有声明条件同时满足；服务/解析错误均算失败。']])}
<h3>计时</h3><p>每次模型调用保存 wallMs、loadMs、promptMs、generationMs、inputTokens、outputTokens、tokensPerSecond。流水线总耗时、请求总耗时与队列等待分别记录；一次调用只显示一次实际推理。预热独立保存，排除准确率；失败样本仍在统计分母和耗时分布。P50/P95 使用排序后线性插值。</p><p>P50 是典型耗时（中位数），P95 是较慢请求耗时。可以近似理解为一半/95%请求在对应时间内完成；P90 同理为90%。例如 P50=2秒、P90=5秒，意味着一半不超过2秒，90%不超过5秒；本工程使用 P95 观察更慢的请求。</p>
<h3>可重复实验</h3><ol><li>固定样本、上下文、模型版本/量化、窗口、输出预算和模式。</li><li>推理串行，避免多模型抢 CPU。比较稳态可启用预热，比较首次体验需另测冷加载。</li><li>逐条检查候选、领域、API、参数、补全和失败 trace。</li><li>对独立新样本及更多重复做确认，公开小样本不能作为生产正确率。</li></ol><p>取消会中止当前推理，保留已完成结果和部分 trace；取消于预热时也有明确状态。重启留下的未完成评测标记 interrupted，不自动继续。JSON/CSV 导出位于运行记录及批量页。</p>`),
section('history','记录与排错',`
<h2>从错误记录定位问题</h2><p>实验结果按领域、模型选中的 API、显式参数、最终参数、补全说明、候选和每次调用依次展示。运行记录可重新打开历史，也可导出 JSON 与 CSV；每条记录保留目录版本，避免混用不同契约的正确率。</p><ol><li>若领域错，查看领域 trace 的实际提示词与响应。</li><li>若 API 错，先确认目标是否进入候选列表，再区分检索遗漏与模型误选。</li><li>若参数错，对比 modelArguments 原始提取参数和 extractedArguments；多出的默认值、空对象或占位文字也会判错。</li><li>若补全错，查看 requested/effective、来源、范围、位置精度及当前对象来源。</li><li>若响应慢，对比加载、输入处理、生成、队列等待；查看是否输出截断或服务超时。</li></ol><p>记录位于 <code>data/runtime</code>，可能包含输入文本、模型响应和用户选择的 ID，按本机实验资料保存。JSON 适合保留完整追踪，CSV 适合统计；导出仅生成本机文件，不发送给其他服务。</p><p>Jev 未配置、Ollama 断开、解析失败都会保留错误记录。取消的未完成样本不伪装成已评测结果，已完成样本保留；预热取消的部分 trace 可展开查看。</p>`),
section('jev','Jev 接入',`
<h2>按一次调用替换提供方</h2><p>Jev 尚未安装。本工程预留的是明确的 HTTP 桥接契约。桥接服务将一次请求转换为实际 Jev 调用，再把结果转换回来；页面可为领域、意图、参数或一次调用单独指定提供方。</p>
<h3>配置方式</h3><p>启动服务前设置 <code>JEV_URL</code> 为完整 HTTP 端点，例如 <code>http://127.0.0.1:8090/infer</code>。工程直接 POST 该地址，不自动拼路径；没有配置或调用失败时显示错误并保留 trace，不静默回退到 Ollama。</p>
<pre><code>$env:JEV_URL = "http://127.0.0.1:8090/infer"
node server.mjs</code></pre>
<h3>桥接请求与稀疏参数</h3><p><code>stage</code> 为 domain、intent、arguments 或 unified；<code>model</code> 是阶段模型名；<code>messages</code> 为角色消息；<code>schema</code> 是本次实际输出约束；<code>options</code> 为推理选项。桥接返回符合传入 Schema 与提取规则的 JSON，解释文字不能代替 value。该桥接是本工程的协议，接入时仍需转换为 Jev 实际接口。</p>
<p>当前 <code>${escape(PROMPT_VERSION)}</code> 仅提取用户明确提供的参数：未知字段省略，无明确参数时 arguments 为 {}；嵌套对象只提供有值项。location 与 coordinates 按用户表达使用替代输入，系统时间、位置与已选对象 ID 留给程序补全。参数阶段返回稀疏参数对象；unified 仍返回 domain、api、arguments 外层字段，只有 arguments 内的参数按需出现。不填 null、字符串“null”、空对象或占位值，也不把业务必填标记当成猜测缺失信息的许可。始终遵守本次传入的 Schema；旧 nullable 结构仅用于兼容，当前规则不要求填满参数。</p>
${jsonBlock({stage:'domain',model:'jev-local',messages:[{role:'system',content:'从给定业务领域中选择一个，仅返回 JSON。'},{role:'user',content:'查上海今天的天气'}],schema:{type:'object',properties:{domain:{type:'string',enum:['weather','calendar','contacts','files','services','cloud','unsupported']}},required:['domain'],additionalProperties:false},options:{temperature:0,num_ctx:2048,num_predict:32}})}
<h3>桥接响应</h3>${jsonBlock({value:{domain:'weather'},metrics:{loadMs:0,promptMs:18,generationMs:35,inputTokens:120,outputTokens:8}})}
<p><code>value</code> 必须存在。metrics 可省略或只提供已测字段；缺失项显示不可用，不伪造为零。时长以毫秒计；wallMs 由工程自行测量，tokensPerSecond 根据生成耗时与输出数量计算。请求取消时桥接也应尽可能取消下游推理。</p>
<h3>独立连通性检查</h3><p>将请求保存为 <code>jev-request.json</code> 后运行：</p><pre><code>curl.exe -X POST http://127.0.0.1:8090/infer -H "Content-Type: application/json" --data-binary "@jev-request.json"</code></pre>
<p>先只把领域阶段改为 Jev，保持其余阶段使用同一 Ollama 模型，核对输出、trace 和取消行为；再单独替换其他阶段，一次比较一个环节。</p>
<h3>调用本机实验服务</h3>${jsonBlock({text:'查上海今天的天气',mode:'staged',model:'qwen2.5:3b',stages:{domain:{provider:'jev',model:'jev-local'},intent:{provider:'ollama',model:'qwen2.5:3b'},arguments:{provider:'ollama',model:'qwen2.5:3b'}},options:{num_ctx:2048}})}
<p>这个对象可 POST 到 <code>/api/runs</code>。未指定的阶段使用主模型与 Ollama；批量评测也能携带同类阶段配置。比较时保留实际阶段配置，主模型名不能代表全部调用使用的模型。</p>`),
section('sources','官方映射与扩展',`
<h2>官方对象支持字段扁平化，适配层负责调用</h2><p>以开发者文档的具体对象、字段、方法为核对依据。天气分钟对象不承诺湿度；数组字段保留投影结构；单位和可空字段显示在目录。SDK 版本与权限以未来目标设备文档为准。</p>
${table('参考文档',['领域','一手资料','本工程处理'],[
['天气',link('https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/weather-service-weatherservice','WeatherService API'),'current/hourly/daily/minute/alerts/indices/tides/city 的对象与嵌套字段。'],
['日历',link('https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/js-apis-calendarmanager','CalendarManager API'),'事件、位置、服务、账户与配置；字段 getter/setter 由未来适配器组装。'],
['联系人',link('https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/js-apis-contact','Contact API'),'对象字段及嵌套路径；名称查询可能返回多个候选。'],
['文件',link('https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/preview-arkts','Preview API'),'openPreview/canPreview/hasDisplayed/closePreview/loadData；元数据与搜索明确为业务扩展。'],
['服务链接',link('https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/applinking-deferredlink-api','DeferredLink API'),'popDeferredLink 为官方方法，服务注册属性与链接解析为业务适配。'],
['云端存储',link('https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/cloudfoundation-cloudstorage','CloudStorage API'),'下载链接、上传/下载；不声称 SDK 直接提供业务文件全部元数据。'],
['云函数 / 数据库',`${link('https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/cloudfoundation-cloudfunction','CloudFunction')} / ${link('https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/cloudfoundation-clouddatabase','CloudDatabase')}`,'函数名/data/版本/超时；数据库集合、记录和字段由业务模型定义。'],
['云端预取',link('https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/cloudfoundation-cloudresprefetch','CloudResPrefetch API'),'PrefetchResult result/timestamp/token；periodic 默认值为实验规则。']])}
<h3>后续接入方式</h3><ol><li>保留目录的稳定 ID、输入、输出契约与投影，添加各 Kit 的适配器。</li><li>将设备时间、位置、地理编码、对象选择、服务可用性接为真实环境提供器。</li><li>天气从实际响应确认字段缺失与可用粒度；联系人与日程按检索结果供用户选对象。</li><li>写操作在真实权限与授权流程完成后执行；第一阶段模拟状态不代表真实 SDK 成功。</li><li>新增对象/字段时同步别名、候选召回审计、参数与精度金标，保留版本隔离。</li></ol><p>当前不支持多意图事务、自动跨 API 规划或多轮补槽。缺参结果已明确指出需要补充的信息，下一阶段可在此基础上增加问答。</p>`),
section('verification','实测与验证',`
<h2>历史开发验证与当前新轮分开解读</h2><p>本机为 i7-10700、32GB 内存、UHD630，Ollama 以 CPU 推理；Qwen2.5 四档为 Q4_K_M。当前字段目录为 object-fields-v2、提示词为 ${escape(PROMPT_VERSION)}。本页下方记录是历史 retrieval-v4 / retrieval-v5 开发验证，四档小样本对照在 324 接口冻结点完成，目录快照保存于 <code>data/catalog-benchmark-v2.json</code>；这些历史结果没有使用当前稀疏参数优化。当前协议的独立 1200 次运行见“领域模型实测”页签。历史样本公开、部分开发复用、单次重复，不能当作生产能力结论。</p>${summary}${smokeSummary}
${jobs.length?`<p>历史真实评测记录：${jobs.map(j=>`<code>${j.id}</code>（${j.promptVersion}，${j.mode}，${j.total} 条）`).join('；')}。各条原始消息、响应、候选和耗时均可在批量评测/运行记录中查看。</p>`:''}
<p>历史 v4 实测暴露当前对象占位 ID、显式时间遗漏及无关粒度总览误选；当时的 v5 缩短候选描述，并在旧全量可空参数协议中将指代 ID 留为 null，分钟天气只含降水字段。此处说明的是旧 v4/v5 行为与公开 12 题开发对照。当前 ${escape(PROMPT_VERSION)} 已改为省略未知参数，其准确率和耗时必须由新轮单独验证。</p>
<h3>旧版比较</h3><p>原 15 API / compact-v3 / 65 样本目录曾完成两组各 10 题×4模型、共80条真实记录。staged 完整计划率为40%/70%/70%/90%，unified为30%/30%/20%/90%。这些数据只对应 legacy-v1，不能作为新版 ${capabilities.length} 个接口的准确率；原始记录继续保留。</p><p>旧 staged：<code>ccc287f4-1852-4860-97e4-5005bf525bf2</code>；旧 unified：<code>fdd6b16d-7e12-4cb2-ac97-a0212142b9a6</code>。</p>
<h3>工程验证</h3><p>自动测试涵盖目录字段契约、全部样本金标的确定性补全、候选检索、JSON Schema、Ollama/Jev 计时与失败、精度降级、对象信任、串行队列、取消/重启、评分和页面渲染。验收证据另存 <code>docs/VERIFICATION.md</code>，包括本次测试数量、实际启动与浏览器检查；业务数据仍为模拟值。</p>`)
];
sections.push(section('domain-results','领域模型实测',`
<h2>优化后从零开始的六领域与四模型对照</h2><p>用户要求先中断旧测试、优化工程，再重新运行。旧 retrieval-v5 对照在 548/1200 次完成时已取消；已完成结果与当时源码隔离保存在 <code>data/runtime/domain-suite-before-alternatives.json</code>、<code>docs/validation-domain-50-before-alternatives.json</code> 和 <code>data/benchmark-before-alternatives/</code>。旧 548 条作为历史诊断证据保留，不进入新轮的准确率、耗时或错误数量。</p>
<p>新轮使用 <code>${escape(PROMPT_VERSION)}</code>，从 0/1200 开始，建立独立清单与冻结条件。模型只提取用户明确给出的稀疏参数，地点和坐标使用替代输入，其他信息交由系统规则补全；运行开始后不在同一轮中途改提示词或修改金标。只统计新清单登记的批次，不混历史调用。</p>
<p>原 178 条保留，新增 300 条，共 ${cases.length} 条可选样本。新增题组标记 domain-50-v1，六领域各有 50 条人工设计的不同条件；拒识题按测试领域分组。四档模型各跑 300 条、共 1200 次，固定 unified、temperature=0、上下文2048、输出上限224、每题一次、各模型首次独立预热。这是已用于公开诊断和工程优化的开发集，不是独立盲测集；新轮成绩用于验证优化后的工程表现，泛化仍需另设留出集。</p>
<p>页面入口：<strong>批量评测 → 领域与模型对照</strong>。按领域/模型查看准确率与典型/较慢耗时；场景筛选作用于下方明细和错例。展开错误组查看期待与实际，再打开单次调用原文与耗时。运行中显示实际完成 n/50，未跑的模型格留空。</p>
${domainReport?`<p>新轮状态 <strong>${escape({not_started:'待启动',running:'评测中',completed:'已完成',cancelled:'已取消',failed:'运行失败',interrupted:'已中断'}[domainReport.status]??domainReport.status)}</strong>，${domainReport.progress.done}/${domainReport.progress.total} 次完成，清单 ID <code>${escape(domainReport.id??'待创建')}</code>。提示词 ${escape(domainReport.conditions.promptVersion)}；硬件 ${escape(domainReport.conditions?.hardware?.cpu??'本机CPU')}。以下是生成文档时的独立新轮快照，实时进度以批量评测页为准；未运行样本不计为错误。</p>${table('独立新轮：按领域与模型的真实实测',['测试领域','模型','完成/50','领域','API','明确入参','完整计划','典型P50秒','较慢P95秒'],domainReport.summary.map(row=>[domainName(row.testDomain),escape(row.model),`${row.total}/50`,percent(row.domainAccuracy),percent(row.apiAccuracy),percent(row.argumentAccuracy),percent(row.planAccuracy),seconds(row.p50Ms),seconds(row.p95Ms)]))}`:`<p>尚未生成匹配 ${escape(PROMPT_VERSION)} 的独立新轮快照；实时进度在批量评测页显示。历史快照不会代填新轮结果。</p>`}
<h3>如何解释准确率的问题</h3><p>主错因依链路顺序互斥：调用或结构输出失败 → 领域/拒识错误 → 候选遗漏或候选内API选错 → 多填/漏填/入参值错 → 系统补全来源/精度错 → 状态错。一条错误不重复算多个主因。参数金标仅包含用户明确提供的内容，额外填默认值或抄写系统坐标也会失分；默认信息应交由代码补全。模型选择合法API并不等于完整计划正确。</p>
${domainReport?table('各领域主要错误来源',['领域','主错因','错误数量'],domains.flatMap(domain=>[...Map.groupBy(domainReport.errors.filter(row=>row.testDomain===domain.id),row=>row.code)].map(([,rows])=>[domain.name,escape(rows[0].label),rows.reduce((n,row)=>n+row.count,0)]))):''}
${domainAnalysis?`<h3>不同情况下的人工复核</h3>${domainAnalysis.paragraphs.map(p=>`<p>${escape(p)}</p>`).join('')}`:''}
${optimization?`<h3>优化前后：0.5B 同一开发集对照</h3><p>仅 0.5B 旧/新两轮均完整完成相同 300 题，旧轮其他模型未全完成，不作总体改善对照。以下单独引用旧轮，不混入新轮指标。</p>${table('优化前后0.5B完整对照',['版本','题数','API','明确入参','完整计划','典型P50秒','较慢P95秒'],[['旧 retrieval-v5',...optimization.old.map(r=>[r.total,percent(r.apiAccuracy),percent(r.argumentAccuracy),percent(r.planAccuracy),seconds(r.p50Ms),seconds(r.p95Ms)])[0]],['新 sparse-v6',...optimization.current.map(r=>[r.total,percent(r.apiAccuracy),percent(r.argumentAccuracy),percent(r.planAccuracy),seconds(r.p50Ms),seconds(r.p95Ms)])[0]]])}<p>${optimization.limits.map(escape).join(' ')}</p>`:''}
<h3>复现和证据</h3><p>用例：data/cases-domain-core.json、data/cases-domain-other.json；汇总：docs/validation-domain-50.json；完整介绍与错误例子：docs/DOMAIN_EVALUATION_RESULTS.md；清单与冻结哈希：data/runtime/domain-suite.json。每条原文、模型版本与量化、候选列表、原始输出及计时均保留。</p><p>首次运行 npm run benchmark:domains；已有记录用 node scripts/benchmark-domains.mjs --resume。脚本不自动覆盖本轮记录，也不混入历史批次。仅重新生成介绍文档可运行 node scripts/write-domain-results.mjs，再运行 node scripts/build-guide.mjs。</p>
<p>这是一套公开人工边界测试，单次重复、同一Qwen家族、本机CPU；结果衡量语义调用计划，业务值仍为伪API。候选缺失是检索层证据，不是模型本身失败；“领域或拒识”也可能来自API空选择。归因用于工程排查，后续要用独立留出集与真实SDK/系统响应确认。</p>`));
sections.push(section('grounding','原文核对与语义',`
<h2>从模型提取，到有原文依据的调用参数</h2><p>新增流程：<strong>模型原提取 → 原文核对 → 系统规则补全与时间归一化 → 契约检查 → 模拟回执</strong>。规则只处理已实现的检测范围，不重新选择领域或 API，不新增模型调用，也不读取评测金标来修正运行结果。模型的原始响应与 extractedArguments 始终保留。</p>
<h3>一次运行怎样查看</h3><ol><li>“模型原提取”显示模型本句给出的参数；原始消息、Schema 与响应在调用详情。</li><li>“原文核对后参数”显示 groundedArguments。有明确依据的复制修复显示原文片段、字符位置、模型取值、有效取值和理由；无法确定的关键目标按规则拦截或要求澄清。</li><li>“规则最终参数”显示 resolved.arguments，时间归一化与 requested/effective 条件见解析区。grounding.checks 不虚构不存在的归一化证据。</li><li>“目标 ID 来源核对”区分原文明确、用户选择、未核实、已拒绝。ID 来源可信不等于对象真实存在；第一阶段尚未接真实 SDK 验证存在性、权限或对象版本。</li><li>规则核对与解析耗时单列 deterministicMs；每个模型 trace 的 wallMs、加载、生成与 token 数据照旧。历史记录未做新核对时会明确标记。</li></ol>
<h3>为什么分开提取与执行语义</h3>${table('三种独立口径',['指标','含义与边界'],[['旧提取严格准确率','冻结模型 extractedArguments 与仅显式输入的金标严格比较。额外默认值、遗漏、类型或字符串不同仍会失分；新规则不能把模型提取分数改高。'],['旧执行语义准确率','使用冻结原输出与当时最终计划，按执行语义规则判断目标、参数、约束、状态与领域/API 是否满足请求；与严格提取口径不同。'],['核对后执行语义准确率','把同一原始输出交给新增确定性核对和解析，按相同执行语义规则再次评分。拦截本身不自动算正确，正确澄清仍须符合预期；ID 存在性未验证。']])}
<p>具体语义比较定义、容许的归一化、保留原始约束及评分差异以回放报告审计为准。结构合法、参数非空或“模拟调用就绪”不能替代语义正确。三种分数是不同检查，不可相乘。旧完整计划（严格）另列，不能冒充提取准确率；oldStrictAccuracy 保留完整计划口径，oldExtractionAccuracy 才是明确入参提取口径。</p>
<h3>冻结实测与规则回放分开看</h3><p>页面入口：<strong>批量评测 → 原文核对回放</strong>。24 个领域×模型格对应冻结 sparse-v6 的同一 1200 条原始输出。拒识题也按测试领域分组；仅按已处理样本计分。旧 548 条已取消并隔离，旧实测表与旧评分保持不变。新规则成绩是公开开发集上的离线回放，不能称作模型重测，也不能当作留出集泛化结果。</p>
<p>表内分别显示旧严格提取、旧完整计划（严格）、旧执行语义、核对后执行语义，以及改善/退步/不变数量。原模型 P50/P95 取冻结 run.totalMs，包含当时模型与解析链路，排除排队和预热；单次模型纯调用耗时仍在原 trace 可查。回放 P50/P95 仅为代码处理耗时，<strong>不是新模型耗时</strong>。错误、拦截与未改善样例仍可查；展开原文、原输出、修复及审计，再打开原 runId 的完整 trace。</p>
${groundingReport?.metrics?`<p>匹配当前规则源码的回放快照：严格提取 ${groundingReport.metrics.oldExtraction?.correct??'—'}/${groundingReport.metrics.oldExtraction?.total??'—'}（${percent(groundingReport.metrics.oldExtraction?.accuracy)}）；旧完整计划（严格）${groundingReport.metrics.oldStrict.correct}/${groundingReport.metrics.oldStrict.total}（${percent(groundingReport.metrics.oldStrict.accuracy)}）；旧执行语义 ${groundingReport.metrics.oldExecutionSemantics.correct}/${groundingReport.metrics.oldExecutionSemantics.total}（${percent(groundingReport.metrics.oldExecutionSemantics.accuracy)}）；核对后执行语义 ${groundingReport.metrics.newExecutionSemantics.correct}/${groundingReport.metrics.newExecutionSemantics.total}（${percent(groundingReport.metrics.newExecutionSemantics.accuracy)}）。改善 ${groundingReport.changes?.improved??'—'} 条、退步 ${groundingReport.changes?.regressed??'—'} 条、不变 ${groundingReport.changes?.unchanged??'—'} 条。这些数字仅对应该规则快照，不意味着原模型成绩发生改变。</p>`:''}
${groundingReport?`<p>文档快照：${escape(groundingReport.status)}，${groundingReport.progress?.done??0}/${groundingReport.progress?.total??1200} 条，清单 <code>${escape(groundingReport.manifestId)}</code>；实时结果以页面为准。</p>${table('同一冻结输出的规则回放',['领域','模型','样本','旧严格提取','旧完整计划（严格）','旧执行语义','核对后执行语义'],(groundingReport.cells??[]).map(row=>[domainName(row.testDomain),escape(row.model),row.total,percent(row.oldExtractionAccuracy),percent(row.oldStrictAccuracy),percent(row.oldSemanticAccuracy),percent(row.newSemanticAccuracy)]))}`:'<p>当前尚无匹配冻结清单的规则回放快照；页面明确显示待生成，文档不补造准确率。</p>'}
<h3>模型侧原因：已有证据与待验证假设</h3><p>冻结 1200 条实际 trace 的最大输入为 533 token，实际 num_ctx 为 2048。仅 1 条输出达到 224 token 上限且 doneReason=length（0.5B 云上传，JSON 被截断）；另一结构失败为 0.5B 经纬度互换后超范围，输出 34 token、doneReason=stop。现有证据不支持把主要错误归因于上下文窗口装不下；规则干扰或注意分配仍是待验证假设。四档全部为 Q4_K_M，没有量化对照，不能认定量化导致了这些错误。</p>
${table('需要另做对照的假设',['假设','当前可说什么','后续验证'],[['模型容量','不同档位观察到不同成绩，但参数量不是已证明的唯一原因。','同题、多次重复、另一模型家族并控制提示词与量化。'],['契约指令遵循','出现多填默认值、未知目标占位、遗漏必需项，属于可观察输出行为。','对比简化契约、分层提取与不同指令表达。'],['相似 API 区分','候选在场仍可能选错字段、读写方向或总览入口。','保持原文，单独改变候选数量与名称描述。'],['复制保真','URI、正文、ID 和嵌套值存在遗漏或改写。','用独立原文字串任务与嵌套结构留出集。'],['上下文规则干扰','窗口未满；多规则之间是否干扰尚未验证。','控制规则数量、顺序与提示长度。'],['量化','所有模型采用同一 Q4_K_M，缺少对照。','同一模型和提示，对比不同精度与硬件。']])}
<p>${link('https://docs.ollama.com/capabilities/structured-outputs','Ollama 官方结构化输出说明')}描述 JSON Schema 约束；本轮观察说明结构约束仍不能保证字段语义与原文一致，这是从工程证据作出的判断。${link('https://qwenlm.github.io/blog/qwen2.5-llm/','Qwen2.5 官方说明')}介绍其指令遵循与 JSON 能力改进，不能据此替代本地小模型在本工程中的实测。</p>
<h3>报告与审计</h3><p><code>GET /api/grounding-report</code> 读取页面报告；<code>docs/grounding-replay.json</code> 保存对照与例子；完整逐条审计见 <code>docs/grounding-replay-audit.json</code>；验收规则源码快照在 <code>data/benchmark-grounding-v1-final/</code>。批次或规则源码哈希不匹配时，页面显示快照过期并隐藏旧指标，文档构建也不引用不匹配的快照。冻结原始结果、金标、模型输出及耗时不覆盖。模拟回执仍保留 <code>value:null</code>，规则回放没有执行真实业务。</p>`));
await writeFile(new URL('../docs/guide.json',import.meta.url),JSON.stringify(sections,null,2)+'\n','utf8');
console.log(`说明已生成：${sections.length}页签，${capabilities.length} APIs，${cases.length}样本，${PROMPT_VERSION}`);
