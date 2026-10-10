// Small development probe; its job is never registered in the comparison manifest.
import {writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:3210';
async function request(path,body){const r=await fetch(base+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const v=await r.json();if(!r.ok)throw new Error(v.error);return v;}
const ids=['d50-weather-001','d50-weather-003','d50-weather-018','d50-weather-035','d50-calendar-007','d50-contacts-001','d50-files-001','d50-services-001','d50-cloud-029'];
let job=await request('/api/evaluations',{models:['qwen2.5:0.5b'],caseIds:ids,mode:'unified',warmup:true,repeats:1,options:{num_ctx:2048,temperature:0}});
console.log('开发探针',job.id);
while(['queued','running'].includes(job.status)){await new Promise(r=>setTimeout(r,1000));job=await request('/api/evaluations/'+job.id);}
await writeFile(new URL('../docs/validation-sparse-final-probe.json',import.meta.url),JSON.stringify(job,null,2));
console.log(JSON.stringify({status:job.status,summary:job.summary,results:job.results.map(r=>({caseId:r.caseId,score:r.score,text:r.text,expected:r.expected,actual:{domain:r.run.domain,api:r.run.api,arguments:r.run.extractedArguments,status:r.run.status}}))},null,2));
