import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Laya guide separates local startup and tournament evidence from hosted Jev and frozen scores',async()=>{
  const markdown=await readFile(new URL('../docs/LAYA.md',import.meta.url),'utf8');
  const section=JSON.parse(await readFile(new URL('../docs/laya.json',import.meta.url),'utf8'));
  assert.equal(section.id,'laya');
  for(const text of [markdown,section.html]){
    for(const pattern of [/安装启动Laya\.bat/,/停止Laya\.bat/,/无需.*密钥.*充值/,/本机/,/multilingual/,/2 次/,/3 次/,/forward.*未观测/,/源码推导/,/淘汰.*全量.*联合/,/最后一轮/,/4,000.*unified/,/https:\/\/github\.com\/NandhaKishorM\/laya/])assert.match(text,pattern);
    assert.doesNotMatch(text,/优于 Jev|内部.*14 次|100%.*准确/);
  }
  const jev=await readFile(new URL('../docs/ADAPTIVE_JEV.md',import.meta.url),'utf8');assert.match(jev,/Laya/);
});
