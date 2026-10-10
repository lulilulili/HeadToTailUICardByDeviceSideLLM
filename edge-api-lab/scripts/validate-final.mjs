import {readFile,writeFile} from 'node:fs/promises';
import {capabilities} from '../src/registry.mjs';
import {PROMPT_VERSION} from '../src/prompts.mjs';

const base=process.env.LAB_URL??'http://127.0.0.1:3210';
const cases=JSON.parse(await readFile(new URL('../data/cases.json',import.meta.url),'utf8'));
const added=cases.slice(166).map(item=>item.id);
if(!added.length)throw new Error('尚未加载新增叶字段样本');
const caseIds=[...new Set(['wx02','cx05','px06','fx09','sx02','mx09',...added])];
const models=['qwen2.5:3b'];
const report={purpose:'新增叶字段及六领域链路冒烟验证，公开开发样本，不能代替四档独立留出评测',catalogVersion:'object-fields-v2',catalogCount:capabilities.length,promptVersion:PROMPT_VERSION,createdAt:new Date().toISOString(),caseIds,models,warmup:true,repeats:1,jobs:[]};
for(const mode of ['unified','staged']){
  const response=await fetch(`${base}/api/evaluations`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({models,caseIds,mode,warmup:true})});
  let job=await response.json();if(!response.ok)throw new Error(job.error);
  console.log(`${mode}: ${job.id}, total ${job.progress.total}`);
  let done=-1;
  while(['queued','running'].includes(job.status)){
    await new Promise(resolve=>setTimeout(resolve,3000));
    job=await(await fetch(`${base}/api/evaluations/${job.id}`)).json();
    if(job.progress.done!==done){console.log(`${mode} ${job.progress.done}/${job.progress.total} ${job.status}`);done=job.progress.done;}
  }
  const promptVersion=job.results[0]?.run.traces[0]?.promptVersion;
  if(promptVersion!==PROMPT_VERSION)throw new Error(`服务与磁盘提示词版本不一致：${promptVersion}`);
  report.jobs.push({id:job.id,mode,promptVersion,status:job.status,total:job.progress.done,summary:job.summary});
  await writeFile(new URL('../docs/validation-final.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report.jobs.at(-1)));
  if(job.status!=='completed')throw new Error(`${mode} ${job.status}`);
}
