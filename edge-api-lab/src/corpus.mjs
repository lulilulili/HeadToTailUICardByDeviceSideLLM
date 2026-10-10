import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function loadCases(root) {
 const files=['cases.json','cases-domain-core.json','cases-domain-other.json'];
 const lists=await Promise.all(files.map(file=>readFile(join(root,'data',file),'utf8').then(JSON.parse)));
 const cases=lists.flat(),ids=new Set();
 for(const item of cases) {
  if(!item.id||ids.has(item.id))throw new Error(`用例 ID 缺失或重复：${item.id}`);
  ids.add(item.id);
 }
 return cases;
}
