import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {coreSingleServiceCases} from '../data/single-service-core.mjs';
import {loadSingleService100Cases} from './single-service-100.mjs';

export async function loadCases(root) {
 const files=['cases.json','cases-domain-core.json','cases-domain-other.json'];
 const lists=await Promise.all(files.map(file=>readFile(join(root,'data',file),'utf8').then(JSON.parse)));
 const systemCases=await readFile(join(root,'data/cases-system-single.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
 const expanded=await loadSingleService100Cases(root,{allowMissing:true});
 const cases=[...lists.flat(),...coreSingleServiceCases,...systemCases,...expanded],ids=new Set();
 for(const item of cases) {
  if(!item.id||ids.has(item.id))throw new Error(`用例 ID 缺失或重复：${item.id}`);
  ids.add(item.id);
 }
 return cases;
}
