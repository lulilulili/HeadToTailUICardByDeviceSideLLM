import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderRun} from '../public/run-view.mjs';
import {stageName} from '../public/ui-utils.mjs';

test('joint API and argument stage has a Chinese label and actual trace count is shown',()=>{
  assert.equal(stageName('intent_arguments'),'API 选择与参数提取');
  const html=renderRun({text:'查现在天气',mode:'adaptive',status:'ready_mock',traces:[{stage:'domain',provider:'ollama',wallMs:50},{stage:'intent_arguments',provider:'ollama',wallMs:80}],routing:{policy:'adaptive-routing-v1',path:'two_step',triggerReasons:[],actualCallCount:2,actualStages:['domain','intent_arguments'],skippedStages:[]}});
  assert.match(html,/实际 2 次模型调用/);assert.match(html,/Qwen 智能分步/);assert.match(html,/API 选择与参数提取/);assert.match(html,/50 ms/);assert.match(html,/80 ms/);
});

test('complex branch shows trigger reasons safely and counts completed traces on failure',()=>{
  const html=renderRun({text:'修改复杂日程',mode:'adaptive',status:'error',error:'取消前失败',traces:[{stage:'domain',wallMs:10},{stage:'intent',wallMs:20}],routing:{path:'three_step',triggerReasons:['包含嵌套对象','<script>bad</script>'],actualCallCount:3,skippedStages:[]}});
  assert.match(html,/参数独立提取的原因/);assert.match(html,/包含嵌套对象/);assert.match(html,/&lt;script&gt;/);assert.match(html,/实际 2 次模型调用/);
  assert.doesNotMatch(html,/实际 3 次模型调用|<script>|业务执行：模拟/);
});

test('complex trigger codes are explained in Chinese while their original codes remain inspectable',()=>{
  const html=renderRun({mode:'adaptive',status:'ready_mock',traces:[],routing:{path:'three_step',triggerReasons:['explicit_json','multi_field_write','multiple_time_roles','typed_decision_requires_arguments']}});
  assert.match(html,/明确的 JSON 结构/);assert.match(html,/多个需要写入的字段/);assert.match(html,/多个时间角色或时间范围/);assert.match(html,/Jev 选择 API 后需要本机提取参数/);
  assert.match(html,/explicit_json/);
});

test('Jev route explains cloud selection local filling and no-input argument skip without inventing traces',()=>{
  const html=renderRun({text:'读取手机电量',mode:'jev',status:'ready_mock',traces:[{stage:'domain',provider:'jev',wallMs:100},{stage:'intent',provider:'jev',wallMs:120}],routing:{path:'three_step',actualCallCount:2,skippedStages:[{stage:'arguments',reason:'api_has_no_inputs'}]}});
  assert.match(html,/Jev 官方云端选择/);assert.match(html,/Qwen 本机填参/);assert.match(html,/该 API 没有输入参数，已省略 Qwen 参数调用/);assert.match(html,/实际 2 次模型调用/);
});

test('historical unified records remain labeled one-call and missing routing is not fabricated',()=>{
  const html=renderRun({text:'历史单次',mode:'unified',status:'ready_mock',traces:[{stage:'unified',wallMs:0}]});
  assert.match(html,/实际 1 次模型调用/);assert.match(html,/一次调用/);assert.doesNotMatch(html,/参数独立提取的原因/);
});

test('official Jev details expose typed decision request and usage without treating confidence as accuracy',()=>{
  const request={state:{text:'查湿度',domain:'weather'},model:'jev-latest',questions:{api:{type:'choice',instructions:'选择一个 API',criteria:{'weather.current.humidity':'实况湿度',unsupported:'不支持'}}}};
  const html=renderRun({text:'查湿度',mode:'jev',status:'ready_mock',traces:[{stage:'intent',provider:'jev',model:'jev-1.13.0',requestedModel:'jev-latest',wallMs:234,request,raw:JSON.stringify({model:'jev-1.13.0',answers:{api:{type:'choice',choice:'weather.current.humidity',probabilities:{'weather.current.humidity':.9,unsupported:.1},confidence:.8}},usage:{input_tokens:318,output_tokens:34}}),probabilities:{'weather.current.humidity':.9,unsupported:.1},confidence:.8,usage:{input_tokens:318,output_tokens:34}}]});
  assert.match(html,/Jev 官方决策/);assert.match(html,/问题与判断标准/);assert.match(html,/输入状态/);assert.match(html,/官方 typed answer/);assert.match(html,/官方请求 JSON/);
  assert.match(html,/confidence 不是正确率/);assert.match(html,/0\.800/);assert.match(html,/318/);assert.match(html,/34/);assert.match(html,/jev-1\.13\.0/);
  assert.match(html,/未提供分段耗时/);assert.match(html,/234 ms/);
});

test('experiment defaults to adaptive and retains fixed legacy modes plus Jev profile',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const options=html.match(/<select id="run-mode">([\s\S]*?)<\/select>/)?.[1] || '';
  assert.match(options,/<option value="adaptive" selected>/);for(const mode of ['jev','unified','staged'])assert.match(options,new RegExp('<option value="'+mode+'"'));
  assert.match(html,/id="jev-status"/);assert.match(html,/id="run-mode-description"/);
});
