const base=process.env.LAB_URL??'http://127.0.0.1:3210';
const models=(process.env.LAB_MODELS??'qwen2.5:0.5b,qwen2.5:1.5b,qwen2.5:3b,qwen2.5:7b').split(',');
const mode=process.env.LAB_MODE??'staged';
const limit=Number(process.env.LAB_LIMIT??6);
const response=await fetch(`${base}/api/evaluations`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({models,mode,limit,warmup:true})});
let job=await response.json();if(!response.ok)throw new Error(job.error);
console.log(`评测 ${job.id}：${mode}，${job.progress.total} 次样本调用，模型 ${models.join(', ')}`);
let previous=-1;
while(['queued','running'].includes(job.status)) {
 await new Promise(resolve=>setTimeout(resolve,2000));
 job=await (await fetch(`${base}/api/evaluations/${job.id}`)).json();
 if(job.progress.done!==previous){console.log(`${job.progress.done}/${job.progress.total} ${job.status}`);previous=job.progress.done;}
}
console.log(JSON.stringify({id:job.id,status:job.status,summary:job.summary},null,2));
if(job.status!=='completed')process.exitCode=1;
