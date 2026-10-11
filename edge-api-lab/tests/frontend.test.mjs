import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import { escapeHtml, percent, duration, statusInfo, selectCaseIds, flattenInputs, fieldConstraint, locationFresh } from '../public/ui-utils.mjs';
import { renderRun } from '../public/run-view.mjs';
import { renderEmptyEvaluation,renderAuxiliaryRuns,renderCaseScores,renderExecutionScores,renderEvaluationSummary } from '../public/evaluation-view.mjs';
import { renderResolution,renderCandidates } from '../public/resolution-view.mjs';
import { filterCapabilities,renderCapability,granularityLabel } from '../public/capability-view.mjs';
import { buildContext } from '../public/context-builder.mjs';
import { weatherCapabilities } from '../src/weather-capabilities.mjs';
import { renderGrounding } from '../public/grounding-view.mjs';
import { renderGroundingReport,groundingReportRows,shouldPollGroundingReport } from '../public/grounding-report-view.mjs';

test('renders externally supplied text as safe plain text', () => {
  assert.equal(escapeHtml('<img onerror="bad"> &'), '&lt;img onerror=&quot;bad&quot;&gt; &amp;');
});
test('missing metrics remain unavailable and zero latency is preserved', () => {
  assert.equal(percent(undefined), '—');
  assert.equal(percent(0.825), '82.5%');
  assert.equal(duration(null), '—');
  assert.equal(duration(0), '0 ms');
});
test('failed and incomplete calls are never labeled successful', () => {
  assert.equal(statusInfo('error').tone, 'danger');
  assert.equal(statusInfo('needs_clarification').tone, 'warning');
  assert.equal(statusInfo('resolution_failed').tone, 'danger');
  assert.equal(statusInfo('ready_mock').label, '模拟调用就绪');
});
test('batch sample cap applies to explicit checked cases', () => {
  assert.deepEqual(selectCaseIds(['weather','calendar','contacts'],2),['weather','calendar']);
});
test('failure result states business execution did not occur', () => {
  const html=renderRun({text:'<script>bad</script>',status:'error',error:'Jev 未配置',traces:[],extractedArguments:{}});
  assert.match(html,/业务执行：未执行/);
  assert.doesNotMatch(html,/<script>bad/);
});
test('catalogue exposes nested editable fields and array enum constraints', () => {
  assert.deepEqual(flattenInputs({changes:{type:'object',properties:{title:{type:'string'}}}}).map(([name])=>name),['changes','changes.title']);
  assert.match(fieldConstraint({type:'array',items:{type:'string',enum:['weather','precipitation']}}),/weather \/ precipitation/);
});
test('run detail explains explicit extraction and preserves legacy null output for inspection', () => {
  const html=renderRun({text:'查天气',status:'ready_mock',modelArguments:{location:null},extractedArguments:{},context:{location:{source:'fixture'}},traces:[{stage:'arguments',promptVersion:'compact-v3',options:{num_predict:160},truncated:true,wallMs:0}]});
  assert.match(html,/模型仅提取用户明确提供的信息；确实缺省且契约允许的环境参数才由系统补全/);
  assert.match(html,/&quot;location&quot;: null/);
  assert.doesNotMatch(html,/原始空槽 null 已省略|模型原始参数 · 包含空槽/);
  assert.match(html,/实际推理配置与版本/);
  assert.match(html,/compact-v3/);
  assert.match(html,/达到输出预算/);
});
test('browser location expires rather than being reused indefinitely', () => {
  const now=Date.parse('2026-10-10T01:30:00Z');
  assert.equal(locationFresh({source:'browser',capturedAt:'2026-10-10T01:29:30Z'},now),true);
  assert.equal(locationFresh({source:'browser',capturedAt:'2026-10-10T01:20:00Z'},now),false);
  assert.equal(locationFresh({source:'fixture'},now),true);
});
test('cancelled empty evaluation stops waiting and explains preserved traces', () => {
  const html=renderEmptyEvaluation({status:'cancelled',results:[],warmups:[{status:'cancelled',traces:[{}]}]});
  assert.match(html,/评测已停止/);
  assert.match(html,/调用轨迹/);
  assert.doesNotMatch(html,/模型正在准备|首个样本完成后/);
});
test('interrupted warmup has a labeled trace action and no empty disclosure', () => {
  const html=renderAuxiliaryRuns({warmups:[null,{status:'cancelled',warmup:true,model:'qwen2.5:7b',totalMs:800,traces:[{}]}]});
  assert.match(html,/中断的预热/);
  assert.match(html,/查看调用轨迹/);
  assert.match(html,/800 ms/);
  assert.doesNotMatch(html,/<summary>\s*<\/summary>/);
});
test('degraded weather resolution preserves requested range and labels precision', () => {
  const html=renderResolution({time:{requested:{dataset:'minute',precision:'minute',range:{expression:'未来30分钟',startAt:'2026-10-10T08:00:00+08:00',endAt:'2026-10-10T08:30:00+08:00'}},effective:{dataset:'hourly',precision:'hour',range:{startAt:'2026-10-10T08:00:00+08:00',endAt:'2026-10-10T09:00:00+08:00'},requiresFilteringToRequestedRange:true},fallback:{applied:true,reason:'分钟数据不可用',requestedConstraintsPreserved:true}},location:{requested:{location:'杭州'},effective:{latitude:30.27,longitude:120.15,label:'杭州',precision:'city',source:'fixture'},geocoding:{simulated:true},fallback:{applied:true,reason:'城市代表点'}}});
  assert.match(html,/分钟粒度/);
  assert.match(html,/小时粒度/);
  assert.match(html,/未来30分钟/);
  assert.match(html,/08:30/);
  assert.match(html,/按原始时间范围筛选/);
  assert.match(html,/城市级/);
  assert.match(html,/模拟地理编码/);
});
test('missing location remains unresolved and candidates are safely rendered', () => {
  const html=renderResolution({location:{requested:{location:'火星'},effective:null,fallback:{applied:false,reason:'没有地理编码结果'}}});
  assert.match(html,/尚未解析/);
  assert.match(html,/没有地理编码结果/);
  assert.match(renderCandidates({intent:{ids:['weather.current.humidity','<script>'],scores:[3,1],policy:'lexical',limit:16}}),/候选 API/);
  assert.doesNotMatch(renderCandidates({intent:{ids:['<script>']}}),/<script>/);
});
test('effective weather route and system-derived context are visible after fallback', () => {
  const html=renderResolution({time:{requested:{dataset:'current',precision:'instant'},effective:{dataset:'hourly',api:'weather.hourly.temperature',projection:'hourly.forecast[].temperature',precision:'hour'}},context:[{field:'timezone',source:'system_timezone',reason:'未给时区时使用系统状态'},{field:'mime_type',source:'context',reason:'根据文件扩展名推断',inferredFrom:'demo.pdf'}]});
  assert.match(html,/weather.hourly.temperature/);
  assert.match(html,/hourly.forecast\[\].temperature/);
  assert.match(html,/系统时区/);
  assert.match(html,/根据文件扩展名推断/);
});
test('field catalogue filters object and granularity and rejects unsafe source links', () => {
  const items=[{id:'weather.current.humidity',domain:'weather',object:'current',field:'humidity',name:'湿度',granularities:['current']},{id:'weather.hourly.humidity',domain:'weather',object:'hourly',field:'humidity',name:'小时湿度',granularities:['hourly']}];
  assert.deepEqual(filterCapabilities(items,{domain:'weather',object:'hourly',granularity:'hourly',search:'humidity'}).map(item=>item.id),['weather.hourly.humidity']);
  const html=renderCapability({...items[0],projection:'current.humidity',returns:{type:'number',unit:'%',shape:'value'},sourceRef:'javascript:alert(1)',support:{evidence:'sdk_mapping'},inputs:{}});
  assert.match(html,/current.humidity/);
  assert.match(html,/SDK 字段映射/);
  assert.doesNotMatch(html,/href="javascript:/);
  assert.equal(granularityLabel('hourly'),'小时粒度');
});
test('business extension does not inherit official SDK authority from a reference link', () => {
  const html=renderCapability({id:'files.metadata.name',domain:'files',name:'文件名称',inputs:{},support:'business_extension',sourceRef:'https://developer.huawei.com/consumer/cn/doc/example',note:'文件元数据需要额外数据源',returns:{type:'string',nullable:true}});
  assert.match(html,/拟定业务契约/);
  assert.match(html,/文件元数据需要额外数据源/);
  assert.match(html,/参考文档/);
  assert.doesNotMatch(html,/SDK 字段映射/);
});
test('system experiment controls never create a trusted object without explicit selection', () => {
  const context=buildContext({now:'2026-10-10T01:30:00Z',timezone:'Asia/Shanghai',locationMode:'none',geocoding:false,weatherAvailability:{minute:false},selectedObjects:{file_id:' file_9 ',contact_id:' ',injected:'bad'}});
  assert.equal(context.location,null);
  assert.deepEqual(context.geocodes,{});
  assert.equal(context.weatherAvailability.minute,false);
  assert.equal(context.weatherAvailability.hourly,true);
  assert.deepEqual(context.objects,{file_id:{value:'file_9',trusted:true,source:'user_selection'}});
  assert.equal(buildContext({selectedObjects:{file_id:' '}}).objects,undefined);
  const coarse=buildContext({locationMode:'coarse'}).location;
  assert.equal(coarse.source,'fixture');assert.equal(coarse.precision,'city');assert.equal(coarse.accuracyMeters,20000);
});
test('legacy browser inputs cannot become the simulated phone current position', () => {
  const context=buildContext({now:'2026-10-10T01:30:00Z',locationMode:'browser',browserLocation:{source:'browser',latitude:31,longitude:121,accuracy:12000,capturedAt:'2026-10-10T01:29:30Z'}});
  assert.equal(context.location,null);
  assert.match(context.locationError,/模拟手机位置|不读取电脑位置/);
});
test('evaluation exposes resolution scores without assigning failure to unscored historical runs', () => {
  assert.match(renderCaseScores({resolution:false,plan:false}),/× 补全精度/);
  assert.match(renderCaseScores({resolution:true}),/✓ 补全精度/);
  assert.doesNotMatch(renderCaseScores({domain:true,plan:true}),/补全精度/);
});
test('official weather range labels follow the actual catalogue metadata keys', () => {
  const hourly=renderCapability(weatherCapabilities.find(item=>item.id==='weather.hourly.humidity'));
  assert.match(hourly,/中国地区预报范围：48 小时/);
  assert.match(hourly,/其他地区预报范围：24 小时/);
  const minute=renderCapability(weatherCapabilities.find(item=>item.id==='weather.minute.precipitationIntensity'));
  assert.match(minute,/短期范围：120 分钟/);
  assert.match(minute,/坐标覆盖半径：5 公里/);
});
test('location alternatives are one fillable input and coordinate members are conditionally required', () => {
  const html=renderCapability({id:'weather.current.humidity',domain:'weather',name:'湿度',inputs:{location:{type:'string',required:true,resolver:'system_location'},coordinates:{type:'object',properties:{latitude:{type:'number',required:true,minimum:-90,maximum:90},longitude:{type:'number',required:true,minimum:-180,maximum:180}}}},inputAlternatives:[{fields:['location','coordinates'],resolvedField:'location',resolver:'system_location',description:'地点名称或坐标二选一；未给位置时按规则获取系统位置。'}]});
  const rows=[...html.matchAll(/<tr>(.*?)<\/tr>/gs)].map(match=>match[1]);
  const row=field=>rows.find(value=>value.includes(`<code>${field}</code>`));
  for(const field of ['location','coordinates']) {
    assert.match(row(field),/位置输入二选一 · 可由系统补全/);
    assert.doesNotMatch(row(field),/>必填<|>可选/);
  }
  for(const field of ['coordinates.latitude','coordinates.longitude']) {
    assert.match(row(field),/提供坐标时必填/);
    assert.doesNotMatch(row(field),/>可选/);
  }
  assert.match(html,/提取入参/);
  assert.match(html,/最终解析坐标/);
  assert.match(html,/位置来源/);
  assert.match(row('coordinates.latitude'),/-90 ～ 90/);
});
test('ordinary required fields and nested schema requirements retain their own conditions', () => {
  const html=renderCapability({id:'plain',name:'普通接口',inputs:{title:{type:'string',required:true},target:{type:'object',required:['id'],properties:{id:{type:'string'},label:{type:'string'}}}}});
  const rows=[...html.matchAll(/<tr>(.*?)<\/tr>/gs)].map(match=>match[1]);
  assert.match(rows.find(row=>row.includes('<code>title</code>')),/>必填</);
  assert.doesNotMatch(rows.find(row=>row.includes('<code>target</code>')),/>必填</);
  assert.match(rows.find(row=>row.includes('<code>target.id</code>')),/提供 target 时必填/);
  assert.match(rows.find(row=>row.includes('<code>target.label</code>')),/>可选/);
});

const reportFixture=()=>({id:'suite-1',status:'running',suite:'domain-50-v1',mode:'unified',progress:{done:10,total:1200},expectedCasesPerDomain:50,models:['small','large'],caseCoverage:{byDomain:[{testDomain:'weather',count:50,categories:[{scenario:'拒识',category:'unsupported',count:5}]},{testDomain:'calendar',count:50,categories:[]}]},summary:[{testDomain:'weather',model:'small',total:10,targetTotal:50,domainAccuracy:0.9,apiAccuracy:0.8,argumentAccuracy:0.7,statusAccuracy:0.9,planAccuracy:0.6,p50Ms:800,p95Ms:2000,errorCount:0}],scenarios:[{testDomain:'weather',model:'small',scenario:'拒识',total:2,planAccuracy:0.5,p50Ms:700,p95Ms:900,primaryErrors:[{code:'domain_error',label:'领域错误',count:1}]}],errors:[],notes:[]});
test('domain comparison keeps test-domain groups and absent model cells without fabricated metrics', async () => {
  const {domainReportRows}=await import('../public/domain-report-view.mjs');
  const report=reportFixture();report.summary[0].domain='unsupported';
  const rows=domainReportRows(report);
  assert.equal(rows.length,4);
  assert.deepEqual(rows.map(row=>[row.testDomain,row.model,row.total,row.targetTotal]),[['weather','small',10,50],['weather','large',0,50],['calendar','small',0,50],['calendar','large',0,50]]);
  assert.equal(rows[0].planAccuracy,0.6);
  assert.equal(rows[1].planAccuracy,null);
  assert.equal(rows[1].p50Ms,null);
  assert.equal(domainReportRows(report,{domain:'weather',model:'large'}).length,1);
});
test('partial domain report uses completed denominators and not-started reports have no accuracy', async () => {
  const {renderDomainReport}=await import('../public/domain-report-view.mjs');
  const html=renderDomainReport(reportFixture());
  assert.match(html,/10 \/ 50/);
  assert.match(html,/60\.0%/);
  assert.match(html,/仅按已完成样本计算/);
  assert.match(html,/待运行/);
  assert.match(html,/0\.80 s|800 ms/);
  const waiting=renderDomainReport({...reportFixture(),status:'not_started',summary:[]});
  assert.match(waiting,/领域评测待启动/);
  assert.doesNotMatch(waiting,/0\.0%|60\.0%/);
});
test('domain error examples safely preserve expected actual reason and single trace actions', async () => {
  const {renderReportErrors}=await import('../public/domain-report-view.mjs');
  const report=reportFixture();report.errors=[{testDomain:'weather',model:'small',code:'domain_error',label:'领域错误',count:1,examples:[{caseId:'deny-1',text:'<img onerror="bad">',expected:{domain:'unsupported'},actual:{domain:'weather',api:'<script>bad</script>'},reason:'<svg onload="bad">',runId:'run-1'}]}];
  const html=renderReportErrors(report);
  assert.match(html,/unsupported/);assert.match(html,/期待/);assert.match(html,/实际/);assert.match(html,/原因/);assert.match(html,/查看调用原文与耗时/);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|<img |<svg /);
  assert.doesNotMatch(renderReportErrors(report,{domain:'calendar'}),/deny-1/);
});
test('scene selection narrows scene errors while retaining full-domain summary denominators', async () => {
  const {reportScenarioRows,renderDomainReport,renderReportErrors}=await import('../public/domain-report-view.mjs');
  const report=reportFixture();
  report.scenarios.push({testDomain:'weather',model:'small',scenario:'明确指令',total:8,planAccuracy:0.625,primaryErrors:[]});
  report.errors=['拒识','明确指令'].map((scenario,index)=>({testDomain:'weather',model:'small',scenario,code:'api_error',label:'API错误',count:1,examples:[{scenario,caseId:`scene-${index}`,text:scenario,expected:{api:null},actual:{api:'wrong'},reason:'API错误'}]}));
  assert.equal(reportScenarioRows(report,{scenario:'拒识'}).length,1);
  const filtered=renderReportErrors(report,{scenario:'拒识'});
  assert.match(filtered,/scene-0/);assert.doesNotMatch(filtered,/scene-1/);
  const html=renderDomainReport(report,{scenario:'拒识'});
  assert.match(html,/10 \/ 50/);assert.match(html,/60\.0%/);assert.match(html,/完整领域的 50 题口径/);
});
test('zero completed cells suppress stale metrics but actual zero accuracy and latency remain visible', async () => {
  const {domainReportRows,renderDomainReport}=await import('../public/domain-report-view.mjs');
  const report=reportFixture();
  report.summary.push({testDomain:'weather',model:'large',total:0,targetTotal:50,planAccuracy:1,p50Ms:0,errorCount:3});
  assert.equal(domainReportRows(report)[1].planAccuracy,null);
  assert.equal(domainReportRows(report)[1].errorCount,0);
  report.summary[0].planAccuracy=0;report.summary[0].p50Ms=0;
  const html=renderDomainReport(report,{domain:'weather',model:'small'});
  assert.match(html,/0\.0%/);assert.match(html,/0 ms/);
});
test('latency comparison uses a shared domain scale and never invents pending latency', async () => {
  const {renderLatencyCharts}=await import('../public/domain-report-view.mjs');
  const html=renderLatencyCharts(reportFixture());
  assert.match(html,/P50 \/ P95 耗时对照/);assert.match(html,/P50 耗时 800 ms/);assert.match(html,/P95 耗时 2\.00 s/);
  assert.match(html,/width:40%/);assert.match(html,/width:100%/);assert.match(html,/待运行，暂无耗时/);
});
test('workbench trace polling pauses on the domain report and resumes only for unfinished jobs', async () => {
  const {shouldPollEvaluation}=await import('../public/evaluation-view.mjs');
  assert.equal(shouldPollEvaluation('running',false),true);
  assert.equal(shouldPollEvaluation('queued',false),true);
  assert.equal(shouldPollEvaluation('running',true),false);
  assert.equal(shouldPollEvaluation('completed',false),false);
  assert.equal(shouldPollEvaluation('cancelled',false),false);
});
test('latency percentiles explain typical and slower requests in plain Chinese', async () => {
  const {renderLatencyCharts}=await import('../public/domain-report-view.mjs');
  const html=renderLatencyCharts(reportFixture());
  assert.match(html,/典型耗时（P50）/);assert.match(html,/较慢耗时（P95）/);
  assert.match(html,/50% \/ 95% 请求在该时间内完成/);assert.match(html,/样本百分位插值/);
});
test('scene pagination bounds pages and applies filters before slicing the full report', async () => {
  const {reportScenarioPage}=await import('../public/domain-report-view.mjs');
  const report=reportFixture();report.scenarios=Array.from({length:45},(_,index)=>({testDomain:'weather',model:'small',scenario:`scene-${index}`,total:1}));
  const first=reportScenarioPage(report),last=reportScenarioPage(report,{scenarioPage:99});
  assert.equal(first.rows.length,20);assert.equal(first.pages,3);assert.equal(first.total,45);assert.equal(first.page,0);
  assert.equal(last.rows.length,5);assert.equal(last.page,2);
  const filtered=reportScenarioPage(report,{scenario:'scene-21',scenarioPage:2});
  assert.equal(filtered.page,0);assert.equal(filtered.total,1);assert.equal(filtered.rows[0].scenario,'scene-21');
  assert.equal(reportScenarioPage(report,{domain:'calendar'}).total,0);
});
test('error examples initially show twelve groups and offer the remainder without discarding data', async () => {
  const {renderReportErrors}=await import('../public/domain-report-view.mjs');
  const report=reportFixture();report.errors=Array.from({length:15},(_,index)=>({testDomain:'weather',model:'small',scenario:`scene-${index}`,code:'api_error',label:'API错误',count:1,examples:[{caseId:`error-${index}`,text:'示例',reason:'API错误'}]}));
  const html=renderReportErrors(report);
  assert.match(html,/error-11/);assert.doesNotMatch(html,/error-12/);assert.match(html,/剩余 3/);
  assert.match(renderReportErrors(report,{errorLimit:24}),/error-14/);assert.equal(report.errors.length,15);
});
test('all frozen three hundred case scenario codes have Chinese labels', async () => {
  const {scenarioLabel}=await import('../public/domain-report-view.mjs');
  for(const file of ['cases-domain-core.json','cases-domain-other.json']) {
    const data=JSON.parse(await readFile(new URL(`../data/${file}`,import.meta.url),'utf8'));
    for(const scenario of new Set(data.map(row=>row.scenario)))assert.match(scenarioLabel(scenario),/[\u4e00-\u9fff]/,`missing label: ${scenario}`);
  }
});
test('sparse parameter extraction is explained even when raw argument metadata is absent', () => {
  const html=renderRun({text:'查上海湿度',status:'ready_mock',extractedArguments:{location:'上海'},resolved:{arguments:{location:'上海',time_ref:'现在'}},traces:[]});
  assert.match(html,/模型仅提取用户明确提供的信息；确实缺省且契约允许的环境参数才由系统补全/);
  assert.doesNotMatch(html,/包含空槽/);
});
test('terminal domain report states preserve partial results and stop automatic polling', async () => {
  const {renderDomainReport,shouldPollDomainReport}=await import('../public/domain-report-view.mjs');
  for(const [status,title] of [['cancelled','领域对照已取消'],['failed','领域对照运行失败'],['interrupted','领域对照已中断']]) {
    const html=renderDomainReport({...reportFixture(),status});
    assert.match(html,new RegExp(title));assert.match(html,/自动更新已停止/);assert.match(html,/手动刷新/);
    assert.match(html,/10 \/ 50/);assert.match(html,/60\.0%/);assert.doesNotMatch(html,/领域对照进行中/);
    assert.equal(shouldPollDomainReport(status),false);
  }
  assert.equal(shouldPollDomainReport('completed'),false);
  assert.equal(shouldPollDomainReport('running'),true);
  assert.equal(shouldPollDomainReport('not_started'),true);
});

const groundingFixture=()=>({version:'deterministic-grounding-v1',scope:'仅核对已实现字段，不推定 ID 存在',checks:[{field:'title',code:'literal_copy',severity:'repair',original:'「<复盘>」',modelValue:'复盘',effectiveValue:'<复盘>',span:{start:3,end:7,text:'<复盘>'},message:'按原文恢复引号内内容'}],identity:[{field:'event_id',value:'event_9',status:'explicit',existenceVerified:false,source:'user',message:'原文明确给出，未验证真实存在'}],blockers:[],repairs:['literal_copy'],coverage:['title']});
test('grounding evidence preserves safe source spans and distinguishes ID provenance from existence',()=>{
  const html=renderGrounding(groundingFixture());
  assert.match(html,/按原文恢复引号内内容/);assert.match(html,/原文片段/);assert.match(html,/&lt;复盘&gt;/);
  assert.doesNotMatch(html,/<复盘>/);assert.match(html,/event_9/);assert.match(html,/原文明确/);
  assert.match(html,/ID 存在性尚未接真实 SDK/);assert.match(html,/未验证/);
});
test('run shows immutable extraction before grounding and rule-resolved parameters',()=>{
  const html=renderRun({text:'标题「<复盘>」，事件 event_9',status:'ready_mock',extractedArguments:{title:'复盘'},groundedArguments:{title:'<复盘>'},grounding:groundingFixture(),resolved:{arguments:{title:'<复盘>',event_id:'event_9'}},traces:[]});
  assert.ok(html.indexOf('模型原提取')<html.indexOf('原文核对后参数'));
  assert.ok(html.indexOf('原文核对后参数')<html.indexOf('规则最终参数'));
  assert.match(html,/&quot;title&quot;: &quot;复盘&quot;/);assert.match(html,/&quot;title&quot;: &quot;&lt;复盘&gt;&quot;/);
  assert.match(html,/原始输出保留/);assert.match(html,/未验证/);
});
test('grounding blockers are explicit and legacy runs do not pretend to have passed new checks',()=>{
  const blocked=renderGrounding({...groundingFixture(),checks:[{field:'file_id',code:'id_rejected',severity:'block',modelValue:'当前文件ID',span:{start:0,end:4,text:'当前文件'},message:'占位文字不能作为目标 ID'}],blockers:['id_rejected'],repairs:[]});
  assert.match(blocked,/已拦截/);assert.match(blocked,/占位文字不能作为目标 ID/);
  const legacy=renderRun({text:'旧记录',status:'ready_mock',extractedArguments:{},resolved:{arguments:{}},traces:[]});
  assert.match(legacy,/此记录未执行原文核对/);assert.doesNotMatch(legacy,/原文核对后参数/);
});
const replayFixture=()=>({version:'deterministic-grounding-v1',manifestId:'frozen-suite',status:'completed',progress:{done:10,total:1200},expectedCasesPerDomain:50,models:['small','large'],domains:['files'],cells:[{testDomain:'files',model:'small',total:10,oldExtractionAccuracy:0.4,oldStrictAccuracy:0.3,oldSemanticAccuracy:0.5,newSemanticAccuracy:0.7,oldModelP50Ms:1500,oldModelP95Ms:2200,replayP50Ms:0.23,replayP95Ms:0.8,improved:2,regressed:0,unchanged:8}],examples:[{testDomain:'files',model:'small',caseId:'file-1',runId:'trace-1',text:'<img onerror="bad">',raw:'<script>raw</script>',groundedArguments:{file_id:'id1'},grounding:groundingFixture(),oldSemantic:false,newSemantic:true}],notes:['同一原始输出，规则回放']});
test('replay keeps extraction and execution semantics separate from model timing',()=>{
  const html=renderGroundingReport(replayFixture());
  for(const text of ['冻结模型实测','同一原始输出','旧提取严格准确率','旧执行语义准确率','核对后执行语义准确率','40.0%','50.0%','70.0%','10 / 50','原模型耗时','规则回放耗时'])assert.ok(html.includes(text),text);
  assert.match(html,/不是新模型耗时/);assert.match(html,/0\.23 ms/);assert.match(html,/查看原调用与耗时/);
  assert.match(html,/&lt;script&gt;raw&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>|<img /);
});
test('replay pending cells never fabricate accuracy and filters retain domain grouping',()=>{
  const report=replayFixture(),rows=groundingReportRows(report);
  assert.equal(rows.length,2);assert.equal(rows[1].total,0);assert.equal(rows[1].newSemanticAccuracy,null);
  assert.equal(groundingReportRows(report,{model:'large'}).length,1);
  const pending=renderGroundingReport({...report,status:'not_started',cells:[],examples:[]});
  assert.match(pending,/原文核对回放待生成/);assert.doesNotMatch(pending,/0\.0%|40\.0%/);
  assert.equal(shouldPollGroundingReport('running'),true);
  for(const status of ['completed','failed','cancelled','interrupted'])assert.equal(shouldPollGroundingReport(status),false);
});
test('existing model report remains a frozen inference benchmark alongside the replay',async()=>{
  const {renderDomainReport}=await import('../public/domain-report-view.mjs');
  const report=reportFixture(),before=structuredClone(report),html=renderDomainReport(report);
  assert.match(html,/冻结模型实测/);assert.match(html,/原文核对回放独立呈现/);
  assert.match(html,/60\.0%/);assert.deepEqual(report,before);
});
test('deterministic rule time is labeled separately and preserves sub-millisecond values',()=>{
  const html=renderRun({text:'查文件',status:'needs_clarification',deterministicMs:0.23,grounding:groundingFixture(),groundedArguments:{},resolved:{arguments:{}},traces:[{stage:'unified',wallMs:1500}]});
  assert.match(html,/原文核对与补全耗时/);assert.match(html,/0\.23 ms/);
  assert.match(html,/与下方模型调用耗时分别记录/);assert.match(html,/1\.50 s/);
});
test('ordinary evaluations show execution semantics independently and leave historical scores unavailable',()=>{
  const execution=renderExecutionScores({domain:true,api:true,finalArguments:false,status:false,precision:true,sources:true,blocking:{match:false},plan:false});
  assert.match(execution,/执行语义/);assert.match(execution,/× 最终参数/);assert.match(execution,/× 整体/);assert.match(execution,/× 拦截状态/);
  assert.match(renderExecutionScores(),/执行语义：—/);
  const table=renderEvaluationSummary([{model:'<small>',total:2,argumentAccuracy:0.5,executionAccuracy:0,planAccuracy:0.5},{model:'old',total:50,argumentAccuracy:0.8}]);
  assert.match(table,/严格提取/);assert.match(table,/执行语义/);assert.match(table,/0\.0%/);assert.match(table,/50\.0%/);assert.match(table,/&lt;small&gt;/);
  assert.match(table,/旧记录未计算执行语义/);
});
test('replay semantic object uses its plan outcome and preserves audit differences',()=>{
  const report=replayFixture();report.examples[0].oldSemantic={plan:false,differences:['目标错误']};report.examples[0].newSemantic={plan:true,differences:[]};
  const html=renderGroundingReport(report);assert.match(html,/旧执行语义 未通过 → 核对后 通过/);assert.match(html,/目标错误/);
});
test('replay extraction accuracy cannot silently borrow strict complete-plan accuracy',()=>{
  const report=replayFixture();delete report.cells[0].oldExtractionAccuracy;
  const html=renderGroundingReport(report);
  assert.match(html,/旧完整计划（严格）/);
  assert.match(html,/<td>—<\/td><td>30\.0%<\/td><td>50\.0%<\/td>/);
  const pending=groundingReportRows({...report,cells:[{testDomain:'files',model:'small',total:0,oldExtractionAccuracy:1}]});
  assert.equal(pending[0].oldExtractionAccuracy,null);
});
test('new model errors without grounding do not masquerade as audited or historical calls',()=>{
  const html=renderRun({text:'新调用',status:'error',error:'响应截断',traces:[]});
  assert.match(html,/此记录未执行原文核对/);assert.doesNotMatch(html,/此历史记录|核对已通过/);
});
test('stale replay snapshots show their mismatch and cannot lend scores to the current batch',()=>{
  const html=renderGroundingReport({...replayFixture(),status:'stale',notes:['规则源码不匹配 <unsafe>']});
  assert.match(html,/快照与当前批次不匹配/);assert.match(html,/手动刷新/);assert.match(html,/&lt;unsafe&gt;/);
  assert.doesNotMatch(html,/40\.0%|50\.0%|70\.0%|trace-1/);assert.equal(shouldPollGroundingReport('stale'),false);
});
test('replay examples make effective rule parameters visible beside original and grounded input',()=>{
  const report=replayFixture();report.examples[0].newSemantic={plan:true,actualResolved:{arguments:{file_id:'id1',time_ref:{startAt:'2026-10-11T06:00:00+08:00'}}}};
  const html=renderGroundingReport(report);
  assert.match(html,/规则最终参数 · 回放/);assert.match(html,/2026-10-11T06:00:00\+08:00/);
  assert.match(html,/原模型输出与耗时保持不变/);
});
test('replay overview preserves independently supplied extraction and execution denominators',()=>{
  const report=replayFixture();report.metrics={oldExtraction:{total:10,correct:4,accuracy:0.4},oldStrict:{total:10,correct:3,accuracy:0.3},oldExecutionSemantics:{total:10,correct:5,accuracy:0.5},newExecutionSemantics:{total:10,correct:7,accuracy:0.7}};
  const html=renderGroundingReport(report);
  for(const text of ['4 / 10','3 / 10','5 / 10','7 / 10'])assert.ok(html.includes(text),text);
  assert.match(html,/整体对照 · 同一冻结输出/);
});
test('execution semantics exposes a gold contract inconsistency instead of unexplained overall failure',()=>{
  const html=renderExecutionScores({domain:true,api:true,finalArguments:true,status:true,precision:true,sources:true,blocking:{match:true},expectedResolverStatusMatchesGold:false,plan:false});
  assert.match(html,/× 预期契约/);assert.match(html,/用例期望状态与当前契约不一致/);
  assert.match(html,/不能计为正确/);
});
test('replay improvements cannot conceal regressed execution plans',()=>{
  const html=renderGroundingReport({...replayFixture(),changes:{improved:3,regressed:1,unchanged:6}});
  assert.match(html,/发现 1 条执行语义退步/);assert.match(html,/改善 3 条/);assert.match(html,/不变 6 条/);
});
