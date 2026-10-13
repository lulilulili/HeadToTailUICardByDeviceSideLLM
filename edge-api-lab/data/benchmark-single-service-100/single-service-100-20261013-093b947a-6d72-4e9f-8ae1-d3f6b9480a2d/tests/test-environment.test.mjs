import test from 'node:test';
import assert from 'node:assert/strict';

test('environment collection preserves actual CIM facts and labels missing GPU facts unknown',async()=>{
 const env=await import('../src/test-environment.mjs');
 const collect=async facts=>env.collectTestEnvironment({platformName:'win32',cim:async()=>facts,fetchImpl:async()=>({ok:true,json:async()=>({version:'test-ollama'})}),now:()=>new Date('2026-10-12T00:00:00Z'),env:{}});
 const observed=await collect({cpu:[{Name:'Intel Core i7-10700',NumberOfCores:8,NumberOfLogicalProcessors:16}],os:{Caption:'Windows 11 Pro',Version:'10.0.28000',BuildNumber:'28000',OSArchitecture:'64-bit'},gpu:[{Name:'Intel UHD Graphics 630',AdapterRAM:1073741824,DriverVersion:'31.0.101.2140'}],memory:{TotalPhysicalMemory:34125086720}});
 assert.equal(observed.cpu,'Intel Core i7-10700');assert.equal(observed.physicalCores,8);assert.equal(observed.logicalCores,16);assert.equal(observed.totalMemoryBytes,34125086720);
 assert.equal(observed.os.build,'28000');assert.equal(observed.gpus[0].adapterMemoryBytes,1073741824);
 assert.equal(observed.gpuStatus,'observed');assert.equal(observed.ollamaVersion,'test-ollama');assert.equal(observed.modelDirectory.status,'unknown');
 const unknown=await collect({cpu:[],os:{},gpu:[],memory:{}});
 assert.equal(unknown.gpuStatus,'unknown');assert.deepEqual(unknown.gpus,[]);assert.equal(unknown.physicalCores,null);
});
test('offload is measured only from complete ps memory fields, never from installed GPU hardware',async()=>{
 const env=await import('../src/test-environment.mjs');
 const sample=env.normalizeOllamaSample({models:[{name:'qwen2.5:7b',digest:'digest',size:1000,size_vram:0,context_length:2048}]},'time');
 assert.equal(sample.models[0].offload.status,'observed');assert.equal(sample.models[0].offload.cpuBytes,1000);assert.equal(sample.models[0].offload.gpuFraction,0);
 const missing=env.normalizeOllamaSample({models:[{name:'qwen2.5:7b',size_vram:500}]},'time');
 assert.equal(missing.models[0].offload.status,'unknown');assert.equal(missing.models[0].offload.gpuFraction,null);
});
test('inference has periodic host and ps samples without overlapping sampling or repeated model calls',async()=>{
 const env=await import('../src/test-environment.mjs');let calls=0,active=0,maxActive=0;
 const result=await env.withInferenceSampling(async()=>{calls++;await new Promise(r=>setTimeout(r,30));return 'one-model-call';},{intervalMs:5,readPs:async()=>{active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,3));active--;return {at:'stub',source:'/api/ps',models:[],error:null};},hostSampler:()=>({freeMemoryBytes:123})});
 assert.equal(result.value,'one-model-call');assert.equal(calls,1);assert.equal(maxActive,1);assert.ok(result.samples.host.length>=3);assert.ok(result.samples.ollama.length>=2);
});
