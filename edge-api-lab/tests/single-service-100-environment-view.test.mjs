import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSingleService100Report,singleService100ModelOptions} from '../public/single-service-100-view.mjs';

const models=['qwen2.5:1.5b','qwen2.5:3b','qwen2.5:0.5b','qwen2.5:7b'];
const report=conditions=>({status:'not_started',progress:{done:0,total:4000},corpus:{total:1000,perDomain:100},conditions:{models,totalCalls:4000,...conditions}});
const hardware={cpu:'Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz',physicalCores:8,logicalCores:16,totalMemoryBytes:34125086720,platform:'win32',os:{platform:'win32',name:'Windows 11 专业版',release:'10.0.28000',version:'10.0.28000',build:'28000',architecture:'x64'},nodeVersion:'25.2.1',ollamaVersion:'0.35.0',gpus:[{name:'Intel(R) UHD Graphics 630',driverVersion:'31.0.101.2140',adapterMemoryBytes:null}],gpuStatus:'observed',collection:{at:'2026-10-12T08:00:00.000Z',sources:['node:os','Win32_Processor','Win32_VideoController'],errors:[]}};

test('real PC environment is visible and separate from simulated phone state',()=>{
  const html=renderSingleService100Report(report({hardware}));
  assert.match(html,/真实推理电脑环境/);assert.match(html,/i7-10700/);assert.match(html,/8 核 \/ 16 线程/);assert.match(html,/31\.8 GiB/);
  assert.match(html.slice(0,html.indexOf('<details')),/Windows 11 专业版/);assert.match(html,/10\.0\.28000/);assert.match(html,/x64/);assert.match(html,/Node 25\.2\.1/);assert.match(html,/Ollama 0\.35\.0/);
  assert.match(html,/UHD Graphics 630/);assert.match(html,/31\.0\.101\.2140/);assert.match(html,/模拟手机上下文/);assert.match(html,/未连接 Harmony 真机/);
  assert.match(html,/推理设备未采样，不能判断 CPU \/ GPU 分担/);
  assert.doesNotMatch(html,/GPU 推理已确认|真机实测|D:\/OllamaModels|8GB/);
});

test('legacy environment uses only its saved fields and missing metadata stays unknown',()=>{
  const legacy=report({models:models.slice(0,3),totalCalls:3000,hardware:{cpu:'历史 CPU',logicalCores:4,totalMemoryBytes:8589934592,platform:'win32'}});
  const html=renderSingleService100Report(legacy);
  assert.match(html,/历史 CPU/);assert.match(html,/物理核数未采集 \/ 4 线程/);assert.match(html,/8\.0 GiB/);assert.match(html,/Node 未采集/);assert.match(html,/Ollama 未采集/);
  assert.doesNotMatch(html,/i7-10700|UHD Graphics 630|25\.2\.1|0\.35\.0/);
  const missing=renderSingleService100Report(report({}));
  assert.match(missing,/本报告未采集电脑环境/);assert.match(missing,/不能借用当前机器配置解释历史成绩/);
});

test('actual model specifications are expandable without invented size or digest',()=>{
  const html=renderSingleService100Report(report({hardware,options:{num_ctx:2048,num_predict:224,temperature:0},promptVersion:'explicit-v7',groundingVersion:'deterministic-grounding-v2',modelDetails:[{name:'qwen2.5:7b',digest:'sha256:verified-seven',size:4683075271,details:{parameter_size:'7.6B',quantization_level:'Q4_K_M',family:'qwen2'},model_info:{'general.architecture':'qwen2'}}]}));
  assert.match(html,/<summary>版本、参数、模型规格与环境采集详情<\/summary>/);assert.match(html,/7\.6B/);assert.match(html,/Q4_K_M/);assert.match(html,/sha256:verified-seven/);assert.match(html,/explicit-v7/);assert.match(html,/num_ctx/);
  assert.match(html,/规格未采集/);assert.doesNotMatch(html,/qwen2\.5:1\.5b<\/span>.*1\.5B · Q4_K_M/);
});

test('reported hardware and filter labels escape untrusted metadata',()=>{
  const html=renderSingleService100Report(report({hardware:{...hardware,cpu:'<img onerror="bad">',gpus:[{name:'<svg onload="bad">',driverVersion:'<script>bad</script>'}]},modelDetails:[{name:'qwen2.5:7b',digest:'<script>bad</script>',details:{parameter_size:'<svg>',quantization_level:'<img>'}}]}));
  assert.match(html,/&lt;img/);assert.match(html,/&lt;svg/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<img |<svg |<script>/);
  const options=singleService100ModelOptions({conditions:{models:['qwen2.5:7b','<img onerror="bad">']}},'qwen2.5:7b');
  assert.match(options,/value="qwen2\.5:7b" selected/);assert.match(options,/&lt;img/);assert.doesNotMatch(options,/<img /);
});

test('observed zero GPU residency is preserved and does not claim GPU inference from installed hardware',()=>{
  const data=report({hardware});data.inferenceEnvironment={source:'/api/ps',models:[{name:'qwen2.5:1.5b',sampleCount:3,observedSamples:2,status:'observed',at:'2026-10-12T08:00:10Z',cpuBytes:2147483648,gpuBytes:0,gpuFraction:0,contextLength:2048,minGpuFraction:0,maxGpuFraction:0}],notes:['sample evidence']};
  const html=renderSingleService100Report(data);
  assert.match(html,/CPU \/ GPU 驻留采样（offload）/);assert.match(html,/已取得 1 个模型的完整驻留采样/);
  assert.match(html,/2\.0 GiB/);assert.match(html,/0\.0 GiB/);assert.match(html,/0\.0%/);assert.match(html,/2 \/ 3/);assert.match(html,/2048/);
  assert.match(html,/不是 CPU \/ GPU 处理器利用率/);assert.match(html,/尚未采样/);assert.doesNotMatch(html,/GPU 推理已确认|推理设备未采样，不能判断 CPU \/ GPU 分担/);
});

test('GPU residency fraction ranges remain actual sample values and unknown models remain unverified',()=>{
  const data=report({hardware});data.inferenceEnvironment={source:'/api/ps',models:[{name:'qwen2.5:7b',sampleCount:5,observedSamples:3,status:'observed',at:'2026-10-12T08:00:10Z',cpuBytes:1073741824,gpuBytes:3221225472,gpuFraction:.75,contextLength:2048,minGpuFraction:.5,maxGpuFraction:.75},{name:'qwen2.5:3b',sampleCount:2,observedSamples:0,status:'unknown',cpuBytes:null,gpuBytes:null,gpuFraction:null,contextLength:null}],notes:['<script>bad</script>']};
  const html=renderSingleService100Report(data);
  assert.match(html,/75\.0%/);assert.match(html,/50\.0% ～ 75\.0%/);assert.match(html,/3 \/ 5/);assert.match(html,/采样未取得完整驻留信息/);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});

test('incomplete or malformed residency evidence never becomes a measured zero or GPU conclusion',()=>{
  const data=report({hardware});data.inferenceEnvironment={source:'/api/ps',models:[{name:'qwen2.5:7b',sampleCount:1,observedSamples:1,status:'observed',cpuBytes:null,gpuBytes:null,gpuFraction:null,contextLength:null}]};
  const html=renderSingleService100Report(data);
  assert.match(html,/推理设备未采样，不能判断 CPU \/ GPU 分担/);assert.match(html,/采样未取得完整驻留信息/);
  assert.doesNotMatch(html,/0\.0 GiB|0\.0%|已取得 1 个模型的完整驻留采样/);
});
