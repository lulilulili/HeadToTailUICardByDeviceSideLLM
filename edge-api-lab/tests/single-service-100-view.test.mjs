import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderSingleService100Report,renderSingleService100Rows,filterSingleService100Rows,shouldPollSingleService100Report,safeSingleService100DetailPath,singleService100ResultsPath} from '../public/single-service-100-view.mjs';

const m=(correct=1,total=2)=>({correct,total,accuracy:total?correct/total:null});
const cell=(model='qwen2.5:1.5b',testDomain=null)=>({model,testDomain,total:2,planned:testDomain?100:1000,complete:false,domain:m(2),api:m(),rawArguments:m(0),semantics:m(),readyRequestSemantics:m(0,1),safeNonReady:m(1,1),p50Ms:0,p95Ms:2000,providerErrors:1,retrievalMisses:0,wrongApiWithCandidate:1,primaryFailures:{correct:1,provider_timeout:1},origins:[{origin:'existing_100',total:1,api:m(1,1),rawArguments:m(0,1),semantics:m(1,1)},{origin:'new_900',total:1,api:m(0,1),rawArguments:m(0,1),semantics:m(0,1)}]});
const row=(id='e100-weather-011',overrides={})=>({caseId:id,text:'查询陌生城市气温',model:'qwen2.5:1.5b',testDomain:'weather',origin:'new_900',expectedApi:'weather.current.temperature',actualApi:'weather.current.humidity',expectedStatus:'ready_mock',status:'resolution_failed',expectedArguments:{location:'日杜布'},modelArguments:{location:'杜布'},extractedArguments:{location:'杜布'},groundedArguments:{location:'日杜布'},rawScore:{arguments:false,plan:false},execution:{plan:false},primary:'api',differences:[{kind:'value',path:'location'}],detailPath:`/api/single-service-100-run/qwen2.5-1.5b/${id}`,...overrides});
const report=()=>({id:'frozen-1000',status:'running',progress:{done:2,total:3000},active:{model:'qwen2.5:1.5b',caseId:'e100-weather-012',testDomain:'weather',phase:'inference'},summary:[cell('qwen2.5:0.5b'),cell('qwen2.5:3b'),cell()],cells:[cell('qwen2.5:1.5b','weather')],examples:[row()],notes:['原始参数不匹配但最终通过，不等于模型原始提取变好'],corpus:{coverage:{byDomain:[{testDomain:'weather',total:100}]},contractBoundaries:[{id:'e100-weather-088',reason:'当前时段规则边界'}]},conditions:{mode:'unified',locationSource:'fixture'}});

test('active-only polling stops on every terminal or not-started status',()=>{
  for(const status of ['queued','running']){assert.equal(shouldPollSingleService100Report(status,true),true);assert.equal(shouldPollSingleService100Report(status,false),false);}
  for(const status of ['not_started','completed','failed','cancelled','interrupted','partial','unknown'])assert.equal(shouldPollSingleService100Report(status,true),false);
});

test('not started has no fabricated zero accuracy even with stale summary values',()=>{
  const html=renderSingleService100Report({...report(),status:'not_started',progress:{done:0,total:3000},active:null});
  assert.match(html,/尚无实测数据/);assert.match(html,/0 \/ 3000/);assert.match(html,/3 模型/);
  assert.doesNotMatch(html,/50\.0%|100\.0%|0\.0%|模型对照/);
});

test('partial metrics distinguish strict raw arguments final semantics ready requests and safe non-ready',()=>{
  const html=renderSingleService100Report(report());
  assert.match(html,/2 \/ 3000/);assert.match(html,/未完成不计入分母/);assert.match(html,/0\.0%/);assert.match(html,/0 ms \/ 2\.00 s/);
  assert.match(html,/原始参数 · 严格/);assert.match(html,/最终执行语义/);assert.match(html,/可执行请求语义/);assert.match(html,/安全非就绪/);
  assert.match(html,/正确澄清/);assert.match(html,/不等于服务全执行成功率/);assert.match(html,/提供方失败计入/);
  assert.match(html,/existing_100/);assert.match(html,/new_900/);assert.match(html,/当前时段规则边界/);
  assert.ok(html.indexOf('qwen2.5:1.5b',html.indexOf('模型对照'))<html.indexOf('qwen2.5:3b',html.indexOf('模型对照')));
  assert.ok(html.indexOf('qwen2.5:3b',html.indexOf('模型对照'))<html.indexOf('qwen2.5:0.5b',html.indexOf('模型对照')));
});

test('zero completed model cells hide stale scores and latency instead of claiming success',()=>{
  const data=report();data.summary=[{...cell(),total:0,p50Ms:0,p95Ms:0,domain:m(2),api:m(2),rawArguments:m(2),semantics:m(2),readyRequestSemantics:m(1,1),safeNonReady:m(1,1)}];data.cells=[];data.examples=[];
  const html=renderSingleService100Report(data);
  assert.match(html,/0 \/ 1000/);assert.doesNotMatch(html,/100\.0%|0 ms/);
});

test('compact rows show expected actual API and original versus grounded args without rewriting records',()=>{
  const data=row(),copy=structuredClone(data),html=renderSingleService100Rows([data]);
  assert.match(html,/预期：/);assert.match(html,/实际：/);assert.match(html,/weather\.current\.temperature/);assert.match(html,/weather\.current\.humidity/);
  assert.match(html,/模型原始参数/);assert.match(html,/规则补全后参数/);assert.match(html,/杜布/);assert.match(html,/日杜布/);
  assert.match(html,/ready_mock → resolution_failed/);assert.deepEqual(data,copy);
  assert.match(renderSingleService100Rows([row(undefined,{modelArguments:null,extractedArguments:null,groundedArguments:null})]),/未取得/);
});

test('detail paths accept all four requested models and reject unsafe or unknown routes',()=>{
  assert.equal(safeSingleService100DetailPath(row().detailPath),row().detailPath);
  assert.equal(safeSingleService100DetailPath('/api/single-service-100-run/qwen2.5-3b/e100-calendar-100'),'/api/single-service-100-run/qwen2.5-3b/e100-calendar-100');
  assert.equal(safeSingleService100DetailPath('/api/single-service-100-run/qwen2.5-7b/e100-weather-011'),'/api/single-service-100-run/qwen2.5-7b/e100-weather-011');
  for(const path of ['https://evil.test/api/single-service-100-run/qwen2.5-1.5b/e100-weather-011','//evil.test/path','/api/runs','/api/single-service-100-run/qwen2.5-14b/e100-weather-011','/api/single-service-100-run/qwen2.5-3b/../../secret','/api/single-service-100-run/qwen2.5-3b/%65%31%30%30-weather-011','/api/single-service-100-run/qwen2.5-3b/e100-weather-011?x=1','\\api\\single-service-100-run\\qwen2.5-3b\\e100-weather-011'])assert.equal(safeSingleService100DetailPath(path),null,path);
});

test('four-model plan and table order come from report conditions without claiming future scores',()=>{
  const data=report();data.conditions.models=['qwen2.5:7b','qwen2.5:1.5b','qwen2.5:3b','qwen2.5:0.5b'];data.conditions.totalCalls=4000;data.corpus.total=1000;data.corpus.perDomain=100;
  data.progress={done:2,total:4000};data.summary.unshift(cell('qwen2.5:7b'));
  const html=renderSingleService100Report(data),matrix=html.slice(html.indexOf('模型对照'));
  assert.match(html,/2 \/ 4000/);assert.match(html,/10 领域 × 每领域 100 条 × 4 模型/);assert.match(html,/7B → 1\.5B → 3B → 0\.5B/);
  assert.ok(matrix.indexOf('qwen2.5:7b')<matrix.indexOf('qwen2.5:1.5b'));
  assert.doesNotMatch(html,/7B 明确排除|7B 不参加|× 3 模型/);
  const pending=renderSingleService100Report({...data,status:'not_started',progress:{done:0,total:4000}});
  assert.match(pending,/0 \/ 4000/);assert.doesNotMatch(pending,/50\.0%|100\.0%|0\.0%|模型对照/);
});

test('explicit planned calls take precedence while legacy three-model reports stay at 3000',()=>{
  const current=report();current.conditions={models:['qwen2.5:1.5b','qwen2.5:3b','qwen2.5:0.5b','qwen2.5:7b'],totalCalls:4000};
  assert.match(renderSingleService100Report(current),/2 \/ 4000/);
  assert.match(renderSingleService100Report(report()),/2 \/ 3000/);
});

test('model domain and failure filters preserve audited execution-pass raw mismatch and paginate after filtering',()=>{
  const rows=[row(),row('e100-weather-012',{primary:'correct',execution:{plan:true}}),row('e100-media-013',{testDomain:'media'}),row('e100-weather-014',{model:'qwen2.5:3b',error:'timeout'})];
  assert.deepEqual(filterSingleService100Rows(rows,{model:'qwen2.5:1.5b',domain:'weather'}).map(r=>r.caseId),['e100-weather-011']);
  assert.equal(filterSingleService100Rows(rows,{model:'qwen2.5:1.5b',domain:'weather',failed:false}).length,2);
  const list=Array.from({length:45},(_,index)=>row(`e100-weather-${String(index+1).padStart(3,'0')}`));
  const first=renderSingleService100Rows(list,{page:0,full:true}),last=renderSingleService100Rows(list,{page:999,full:true});
  assert.equal((first.match(/data-single100-detail=/g)||[]).length,20);assert.equal((last.match(/data-single100-detail=/g)||[]).length,5);
  assert.match(first,/1 \/ 3/);assert.match(last,/3 \/ 3/);assert.match(last,/e100-weather-045/);
});

test('read-only index requests encode filters and do not need a model inference endpoint',()=>{
  assert.equal(singleService100ResultsPath({}),'/api/single-service-100-results?failed=true');
  const path=singleService100ResultsPath({model:'qwen2.5:1.5b',domain:'weather',failed:false}),url=new URL(path,'http://127.0.0.1');
  assert.equal(url.pathname,'/api/single-service-100-results');assert.equal(url.searchParams.get('model'),'qwen2.5:1.5b');assert.equal(url.searchParams.get('domain'),'weather');assert.equal(url.searchParams.has('failed'),false);
  assert.equal(new URL(singleService100ResultsPath({manifestId:'batch-a'}),'http://127.0.0.1').searchParams.get('manifestId'),'batch-a');
});

test('detail paths allow one valid batch identity and reject arbitrary or duplicate query inputs',()=>{
  const path='/api/single-service-100-run/qwen2.5-7b/e100-cloud-011';
  assert.equal(safeSingleService100DetailPath(path+'?manifestId=batch-a'),path+'?manifestId=batch-a');
  for(const query of ['?manifestId=..','?manifestId=batch-a&manifestId=batch-b','?manifestId=batch-a&other=x','?manifestId=%2Foutside','?manifestId=batch-a#fragment','?manifestId='])assert.equal(safeSingleService100DetailPath(path+query),null,query);
});

test('report and row content escape HTML including source metadata and error messages',()=>{
  const data=report();data.notes=['<script>bad</script>'];data.conditions={unsafe:'<svg onload="bad">'};data.examples=[row(undefined,{text:'<img onerror="bad">',actualApi:'<script>bad</script>',modelArguments:{title:'<b>bad</b>'},error:'<svg onload="bad">'})];
  const html=renderSingleService100Report(data);
  assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);assert.match(html,/&lt;svg/);assert.doesNotMatch(html,/<script>|<img |<svg /);
});

test('app wires the accessible thousand-case tab defaults and exclusive guards without browser positioning',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8'),app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),workbench=await readFile(new URL('../public/evaluation-view.mjs',import.meta.url),'utf8'),view=await readFile(new URL('../public/single-service-100-view.mjs',import.meta.url),'utf8');
  assert.match(html,/id="single-service-100-tab"[^>]*aria-controls="single-service-100-content"[^>]*data-evaluation-view="single100"/);
  assert.match(html,/id="single-service-100-content"[^>]*role="tabpanel"[^>]*aria-labelledby="single-service-100-tab"/);
  assert.match(workbench,/<option value="single-service-100-v1">当前千题/);assert.match(workbench,/Math\.min\(1000,caseData\.cases\.length\)/);
  assert.match(workbench,/<option value="unified" selected>/);assert.match(html,/<option value="unified" selected>/);
  assert.match(app,/health\.lab\?\.exclusiveBenchmark/);assert.match(app,/if\(getExclusiveBenchmark\(\)\)/);assert.match(workbench,/if\(getExclusiveBenchmark\(\)\)/);
  assert.match(app,/singleService100\.setActive/);assert.match(view,/setTimeout\(load,7000\)/);
  assert.match(view,/showRun\(record\.run,\{expected:record\.expected,score:record\.rawScore,executionScore:record\.execution\}\)/);
  assert.doesNotMatch(view,/method:\s*['"]POST|\/api\/evaluations|\/api\/runs/);assert.doesNotMatch(app,/navigator\.geolocation|getCurrentPosition|browserLocation/);
});
