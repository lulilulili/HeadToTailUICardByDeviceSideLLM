export class SerialQueue {
  #tail=Promise.resolve();
  pending=0;
  async run(task,signal) {
    this.pending++;
    const previous=this.#tail;
    let release;
    this.#tail=new Promise(resolve=>{release=resolve;});
    try { await previous; signal?.throwIfAborted(); return await task(); }
    finally { this.pending--; release(); }
  }
}

export class RuntimeStore {
  constructor(directory) { this.directory=directory; this.queue=new SerialQueue(); }
  async init() {
    const {mkdir,readdir,readFile}=await import('node:fs/promises');
    await mkdir(this.directory,{recursive:true});
    this.runs=[]; this.evaluations=[];
    for(const file of await readdir(this.directory)) {
      if(!/^(run|eval)-[a-z0-9-]+\.json$/.test(file)) continue;
      try {
        const item=JSON.parse(await readFile(`${this.directory}/${file}`,'utf8'));
        if(file.startsWith('run-')) this.runs.push(item);
        else {
          if(['queued','running'].includes(item.status)) {item.status='interrupted'; item.error='服务重启，任务未自动恢复；可重新发起。';}
          this.evaluations.push(item);
        }
      } catch { /* A damaged individual record cannot hide other records. */ }
    }
    this.runs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    this.evaluations.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    return this;
  }
  async save(kind,item) {
    return this.queue.run(async()=>{
      const {writeFile,rename}=await import('node:fs/promises');
      const path=`${this.directory}/${kind}-${item.id}.json`;
      await writeFile(`${path}.tmp`,JSON.stringify(item,null,2),'utf8');
      await rename(`${path}.tmp`,path);
      const list=kind==='run'?this.runs:this.evaluations;
      const index=list.findIndex(row=>row.id===item.id);
      const snapshot=structuredClone(item);
      if(index>=0) list[index]=snapshot; else list.unshift(snapshot);
    });
  }
}
