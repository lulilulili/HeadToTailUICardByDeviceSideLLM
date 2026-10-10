import test from 'node:test';
import assert from 'node:assert/strict';
import {SerialQueue,RuntimeStore} from '../src/runtime.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('failed inference releases queue; queued cancelled request does not start',async()=>{
  const queue=new SerialQueue(); const controller=new AbortController(); let started=false;
  const a=queue.run(async()=>{throw new Error('provider failed');});
  const b=queue.run(async()=>{started=true;},controller.signal); controller.abort();
  await assert.rejects(a,/provider failed/); await assert.rejects(b); assert.equal(started,false); assert.equal(queue.pending,0);
});
test('store reload marks unfinished evaluation interrupted and preserves completed runs',async()=>{
  const path=await mkdtemp(join(tmpdir(),'edge-lab-test-'));
  try {
    const store=await new RuntimeStore(path).init();
    await store.save('run',{id:'one',createdAt:'2026-10-10',status:'ready_mock'});
    await store.save('eval',{id:'two',createdAt:'2026-10-10',status:'running',results:[]});
    const loaded=await new RuntimeStore(path).init();
    assert.equal(loaded.runs[0].status,'ready_mock'); assert.equal(loaded.evaluations[0].status,'interrupted');
  } finally {await rm(path,{recursive:true,force:true});}
});
