import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const allowedModels=['qwen2.5:0.5b','qwen2.5:1.5b','qwen2.5:3b','qwen2.5:7b'];
const legacyModels=['qwen2.5:1.5b','qwen2.5:3b','qwen2.5:0.5b'];
function unavailable(message){const error=new Error(message);error.statusCode=503;return error;}

/** Select one immutable batch; an invalid pointer must never expose unrelated files. */
export async function resolveBenchmarkSelection({root,activePath,legacy={}}){
 let pointer;
 if(activePath)try{pointer=JSON.parse(await readFile(activePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw unavailable(`无法读取本轮评测指针：${error.message}`);}
 if(!pointer)return {...legacy,active:false,id:null,manifest:null,models:legacyModels};
 if(!root||!pointer.id||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/.test(pointer.id))throw unavailable('本轮评测指针缺少合法的批次标识。');
 const expected={manifestPath:`data/runtime/single-service-100/${pointer.id}/manifest.json`,reportPath:`docs/single-service-100/${pointer.id}/results.json`,evidenceRoot:`evidence/single-service-100/${pointer.id}`};
 for(const [key,value]of Object.entries(expected))if(pointer[key]!==value)throw unavailable('本轮评测指针路径与批次不匹配，拒绝读取其他目录。');
 let manifest;try{manifest=JSON.parse(await readFile(resolve(root,expected.manifestPath),'utf8'));}catch(error){throw unavailable(`无法读取本轮评测清单：${error.message}`);}
 const models=manifest.conditions?.models;
 if(manifest.id!==pointer.id||!Array.isArray(models)||!models.length||new Set(models).size!==models.length||models.some(model=>!allowedModels.includes(model)))throw unavailable('本轮评测清单与指针或模型集合不一致。');
 return {active:true,id:pointer.id,manifest,models,statePath:resolve(root,expected.manifestPath),reportPath:resolve(root,expected.reportPath),evidenceDirectory:resolve(root,expected.evidenceRoot)};
}

export function assertBenchmarkOwnership(selection,record,{kind='report',model,caseId}={}){
 if(!selection.active)return;
 const id=kind==='report'?record?.id:record?.manifestId;
 if(id!==selection.id||model&&record?.model!==model||caseId&&record?.caseId!==caseId)throw unavailable('评测报告或原始记录不属于当前批次，拒绝混用历史结果。');
}
