import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('the live guide registers adaptive thousand-case shadow timing and its honest comparison scope',async()=>{
 const guide=JSON.parse(await readFile(new URL('../docs/adaptive-1000-rerun.json',import.meta.url),'utf8'));
 const server=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(server,/adaptive-1000-rerun\.json/);assert.equal(guide.id,'adaptive-1000-rerun');
 for(const text of ['4,000','Qwen控制下游','联合完成时间','并行竞争','无域外拒识金标'])assert.ok(guide.html.includes(text),text);
});
