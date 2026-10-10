import {writeFile} from 'node:fs/promises';
import {PROMPT_VERSION} from '../src/prompts.mjs';
const base=process.env.LAB_URL??'http://127.0.0.1:3210';
const models=['qwen2.5:0.5b','qwen2.5:1.5b','qwen2.5:3b','qwen2.5:7b'];
const caseIds=['wx02','wx13','wx44','wx50','cx05','cx07','px06','fx09','fx03','sx02','mx09','mx07'];
const result={catalogVersion:'object-fields-v2',promptVersion:PROMPT_VERSION,createdAt:new Date().toISOString(),caseIds,models,warmup:true,repeats:1,jobs:[]};
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
 if(promptVersion!==PROMPT_VERSION)throw new Error(`服务提示词 ${promptVersion} 与磁盘版本 ${PROMPT_VERSION} 不同，请重启后验证`);
 result.jobs.push({id:job.id,mode,promptVersion,status:job.status,total:job.progress.done,summary:job.summary});
 await writeFile(new URL('../docs/validation-v2.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result.jobs.at(-1)));
 if(job.status!=='completed')throw new Error(`${mode} ${job.status}`);
}
