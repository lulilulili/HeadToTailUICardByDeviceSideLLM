import {cpus,totalmem,freemem,platform,release,version,arch} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile),list=value=>Array.isArray(value)?value:value?[value]:[];
async function windowsFacts(){
 const command='$ErrorActionPreference="Stop"; $OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); @{cpu=@(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors);os=(Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture);gpu=@(Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,AdapterCompatibility);memory=(Get-CimInstance Win32_ComputerSystem | Select-Object TotalPhysicalMemory)} | ConvertTo-Json -Depth 5 -Compress';
 const {stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:15000,maxBuffer:1024*1024});
 return JSON.parse(stdout.replace(/^\uFEFF/,''));
}
export async function collectTestEnvironment({platformName=platform(),cim=windowsFacts,fetchImpl=fetch,ollamaUrl='http://127.0.0.1:11434',now=()=>new Date(),env=process.env}={}){
 const errors=[],sources=['node:os','process.version'];let facts={};
 if(platformName==='win32')try{facts=await cim();sources.push('Windows CIM: Win32_Processor/OperatingSystem/VideoController/ComputerSystem');}catch(error){errors.push({source:'Windows CIM',error:error.message});}
 let ollamaVersion=null;
 try{const response=await fetchImpl(ollamaUrl+'/api/version',{signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('HTTP '+response.status);ollamaVersion=(await response.json()).version??null;sources.push('Ollama /api/version');}catch(error){errors.push({source:'Ollama /api/version',error:error.message});}
 const processors=list(facts.cpu),gpus=list(facts.gpu).filter(item=>item.Name).map(item=>({name:item.Name,vendor:item.AdapterCompatibility??null,driverVersion:item.DriverVersion??null,adapterMemoryBytes:item.AdapterRAM!==null&&item.AdapterRAM!==undefined&&Number.isFinite(Number(item.AdapterRAM))?Number(item.AdapterRAM):null}));
 return {cpu:processors.map(item=>item.Name).filter(Boolean).join(' / ')||cpus()[0]?.model||null,
  physicalCores:processors.length?processors.reduce((sum,item)=>sum+Number(item.NumberOfCores??0),0)||null:null,
  logicalCores:processors.length?processors.reduce((sum,item)=>sum+Number(item.NumberOfLogicalProcessors??0),0)||cpus().length:cpus().length,
  totalMemoryBytes:Number(facts.memory?.TotalPhysicalMemory)||totalmem(),platform:platformName,
  os:{platform:platformName,name:facts.os?.Caption??null,release:facts.os?.Version??release(),version:platformName==='win32'?facts.os?.Version??version():version(),build:facts.os?.BuildNumber??null,architecture:facts.os?.OSArchitecture??arch()},
  nodeVersion:process.version,ollamaVersion,gpus,gpuStatus:gpus.length?'observed':'unknown',
  modelDirectory:env.OLLAMA_MODELS?{status:'configured',path:env.OLLAMA_MODELS,source:'process.env.OLLAMA_MODELS'}:{status:'unknown',path:null,management:'Ollama默认管理，实际路径未采集',source:'process.env.OLLAMA_MODELS absent'},
  collection:{at:now().toISOString(),sources,errors}};
}
export const sampleHost=()=>({at:new Date().toISOString(),freeMemoryBytes:freemem(),totalMemoryBytes:totalmem(),runnerRssBytes:process.memoryUsage().rss,cpuTicks:cpus().map(item=>item.times)});
export function normalizeOllamaSample(body,at=new Date().toISOString()){
 return {at,source:'/api/ps',error:null,models:list(body?.models).map(item=>{
  const sizeBytes=Number.isFinite(item.size)?item.size:null,sizeVramBytes=Number.isFinite(item.size_vram)?item.size_vram:null,contextLength=Number.isFinite(item.context_length)?item.context_length:null;
  const complete=sizeBytes>0&&sizeVramBytes!==null&&sizeVramBytes>=0&&sizeVramBytes<=sizeBytes&&contextLength>0;
  return {name:item.name??item.model??null,digest:item.digest??null,sizeBytes,sizeVramBytes,contextLength,
   offload:{status:complete?'observed':'unknown',cpuBytes:complete?sizeBytes-sizeVramBytes:null,gpuBytes:complete?sizeVramBytes:null,gpuFraction:complete?sizeVramBytes/sizeBytes:null},
   details:item.details??null,expiresAt:item.expires_at??null};
 })};
}
export async function readOllamaSample({fetchImpl=fetch,ollamaUrl='http://127.0.0.1:11434'}={}){
 const at=new Date().toISOString();
 try{const response=await fetchImpl(ollamaUrl+'/api/ps',{signal:AbortSignal.timeout(3000)});if(!response.ok)throw new Error('HTTP '+response.status);return normalizeOllamaSample(await response.json(),at);}
 catch(error){return {at,source:'/api/ps',models:[],error:error.message};}
}
export async function withInferenceSampling(invoke,{intervalMs=1000,readPs=readOllamaSample,hostSampler=sampleHost}={}){
 const samples={host:[],ollama:[]};let pending=null;
 const poll=()=>{if(pending)return pending;const host=hostSampler();delete host.cpuTicks;samples.host.push(host);
  pending=Promise.resolve().then(readPs).catch(error=>({at:new Date().toISOString(),source:'/api/ps',models:[],error:error.message})).then(value=>samples.ollama.push(value)).finally(()=>{pending=null;});return pending;};
 await poll();const timer=setInterval(poll,intervalMs);
 try{return {value:await invoke(),samples};}
 catch(error){error.measurementSamples=samples;throw error;}
 finally{clearInterval(timer);if(pending)await pending;await poll();}
}
