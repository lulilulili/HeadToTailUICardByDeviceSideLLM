import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {cpus,totalmem,platform,release} from 'node:os';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {suite,suiteModels,testDomains} from '../src/domain-report.mjs';
import {PROMPT_VERSION} from '../src/prompts.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const base=process.env.LAB_URL??'http://127.0.0.1:3210';
const manifestPath=join(root,'data/runtime/domain-suite.json');
async function request(path,body) {
 const response=await fetch(`${base}${path}`,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
 const value=await response.json();if(!response.ok)throw new Error(value.error??`${path}: HTTP ${response.status}`);return value;
}
async function save(manifest) {await writeFile(`${manifestPath}.tmp`,JSON.stringify(manifest,null,2));await rename(`${manifestPath}.tmp`,manifestPath);}
async function exportReport() {
 const report=await request('/api/domain-report');
 await writeFile(join(root,'docs/validation-domain-50.json'),JSON.stringify(report,null,2));
 console.log(`报告保存：${report.progress.done}/${report.progress.total}，${report.status}`);
 return report;
}
if(process.argv.includes('--export-only')) {await exportReport();process.exit(0);}
const {cases,context}=await request('/api/cases');
const selected=cases.filter(item=>item.suite===suite);
if(selected.length!==300||testDomains.some(domain=>selected.filter(item=>item.testDomain===domain).length!==50))throw new Error('新增题组必须六领域各 50 条，共 300 条');
const health=await request('/api/health');
if(suiteModels.some(name=>!health.models.some(m=>m.name===name&&m.eligible)))throw new Error('四档规定模型未全部安装或不满足 <10B');
const sourceFiles=['data/cases-domain-core.json','data/cases-domain-other.json','src/registry.mjs','src/weather-capabilities.mjs','src/extended-capabilities.mjs','src/prompts.mjs','src/providers.mjs','src/pipeline.mjs','src/resolver.mjs','src/fixtures.mjs','src/evaluation.mjs'];
const hashes={};for(const path of sourceFiles)hashes[path]=createHash('sha256').update(await readFile(join(root,path))).digest('hex');
const conditions={catalogVersion:health.lab.catalogVersion,promptVersion:PROMPT_VERSION,mode:'unified',temperature:0,num_ctx:2048,outputBudget:224,repeats:1,warmup:'每个模型第一次领域批次前单独预热，不计分',context,models:health.models.filter(m=>suiteModels.includes(m.name)),hardware:{cpu:cpus()[0]?.model,logicalCores:cpus().length,memoryGB:Math.round(totalmem()/1024**3),os:`${platform()} ${release()}`,inference:'Ollama 本机 CPU（实际 offload 信息另见 Ollama ps）'},node:process.version,ollama:health.ollama.version,sourceHashes:hashes};
let manifest;
try{manifest=JSON.parse(await readFile(manifestPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(manifest&&!process.argv.includes('--resume'))throw new Error('已有本轮记录；使用 --resume 恢复或 --export-only 导出，不自动覆盖');
if(manifest&&(!Object.entries(hashes).every(([path,hash])=>manifest.conditions.sourceHashes[path]===hash)||JSON.stringify(manifest.models)!==JSON.stringify(suiteModels)))throw new Error('冻结源码/用例或模型配置改变，不能混入同一对照');
manifest??={id:randomUUID(),suite,mode:'unified',models:suiteModels,status:'running',startedAt:new Date().toISOString(),conditions,entries:[]};
manifest.status='running';delete manifest.error;await save(manifest);
try {
 for(const model of suiteModels)for(const testDomain of testDomains) {
  let entry=manifest.entries.find(e=>e.model===model&&e.testDomain===testDomain);
  let job=entry?await request(`/api/evaluations/${entry.jobId}`):null;
  if(!job) {
   job=await request('/api/evaluations',{models:[model],caseIds:selected.filter(item=>item.testDomain===testDomain).map(item=>item.id),mode:'unified',warmup:testDomain===testDomains[0],repeats:1,options:{num_ctx:2048,temperature:0}});
   entry={model,testDomain,jobId:job.id,status:job.status,done:0,total:50};manifest.entries.push(entry);await save(manifest);
  }
  console.log(`${model} / ${testDomain} ${job.id} ${job.status}`);
  let previous=-1;
  while(['queued','running'].includes(job.status)) {
   await new Promise(resolve=>setTimeout(resolve,3000));job=await request(`/api/evaluations/${job.id}`);
   Object.assign(entry,{status:job.status,done:job.progress.done,total:job.progress.total});await save(manifest);
   if(job.progress.done!==previous){console.log(`${model} ${testDomain}: ${job.progress.done}/50`);previous=job.progress.done;}
  }
  Object.assign(entry,{status:job.status,done:job.progress.done,total:job.progress.total});await save(manifest);
  if(job.status!=='completed')throw new Error(`批次 ${job.id} ${job.status}: ${job.error??'未完整完成；部分记录已保留'}`);
  await exportReport();
 }
 manifest.status='completed';manifest.completedAt=new Date().toISOString();await save(manifest);
 const report=await exportReport();
 if(report.progress.done!==1200||report.summary.some(row=>row.total!==50))throw new Error('最终完成数不符合24格各50条');
 console.log('全部 1,200 次真实对照完成。');
}catch(error){manifest.status='failed';manifest.error=error.message;await save(manifest);await exportReport();throw error;}
