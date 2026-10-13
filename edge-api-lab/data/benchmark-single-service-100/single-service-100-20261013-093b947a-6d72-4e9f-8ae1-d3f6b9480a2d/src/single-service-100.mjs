import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {coreSingleServiceCases} from '../data/single-service-core.mjs';
import {experimentDefaults,evaluationSystemDefaults} from './fixtures.mjs';
import {PROMPT_VERSION,ADAPTIVE_PROMPT_VERSION} from './prompts.mjs';
import {ADAPTIVE_ROUTING_VERSION} from './adaptive-routing.mjs';

export const SINGLE_SERVICE_100_SUITE='single-service-100-v1';
export const SINGLE_SERVICE_100_MODELS=['qwen2.5:0.5b','qwen2.5:1.5b','qwen2.5:3b','qwen2.5:7b'];
export const SINGLE_SERVICE_100_DOMAINS=['weather','calendar','contacts','files','services','cloud','device','connectivity','location','media'];
export const SINGLE_SERVICE_100_CONTEXT={...experimentDefaults,...evaluationSystemDefaults,now:'2026-10-10T08:00:00+08:00',timezone:'Asia/Shanghai',location:{latitude:31.2304,longitude:121.4737,precision:'coordinate',source:'fixture',label:'模拟手机当前位置（上海固定坐标）'}};
export const SINGLE_SERVICE_100_FILES=['data/single-service-100-weather-calendar-contacts.json','data/single-service-100-files-services-cloud.json','data/single-service-100-system.json'];

/** The saved manifest controls each report/audit, including historical three-model runs. */
export function singleService100Plan(manifest){
 const conditions=manifest?.conditions??{},models=conditions.models;
 if(!Array.isArray(models)||!models.length||new Set(models).size!==models.length)throw new Error('Manifest models missing or duplicate');
 if(models.some(model=>!SINGLE_SERVICE_100_MODELS.includes(model)))throw new Error('Manifest contains an unapproved model');
 if(['single-service-100-batch-v2','single-service-100-batch-v3'].includes(manifest.version)&&JSON.stringify(models)!==JSON.stringify(SINGLE_SERVICE_100_MODELS))throw new Error('New batch requires the approved four-model order');
 const mode=conditions.mode??'unified';
 if(!['unified','adaptive'].includes(mode))throw new Error('Benchmark mode must be unified or adaptive Qwen');
 if(manifest.version==='single-service-100-batch-v3'){
  if(conditions.mode!==mode)throw new Error('New batch requires explicit frozen mode');
  if(conditions.promptVersion!==(mode==='adaptive'?ADAPTIVE_PROMPT_VERSION:PROMPT_VERSION))throw new Error('Manifest prompt version differs from frozen mode');
  if(conditions.routingPolicy!==(mode==='adaptive'?ADAPTIVE_ROUTING_VERSION:'unified-single-v1'))throw new Error('Manifest routing policy differs from frozen mode');
 }
 const modelOrder=conditions.modelOrder??models;
 if(JSON.stringify(models)!==JSON.stringify(modelOrder))throw new Error('Manifest model order differs from declared models');
 const domains=conditions.domains??SINGLE_SERVICE_100_DOMAINS;
 if(JSON.stringify(domains)!==JSON.stringify(SINGLE_SERVICE_100_DOMAINS))throw new Error('Manifest domain set/order differs');
 const callsPerModel=manifest.corpus?.total??1000,perDomain=manifest.corpus?.perDomain??100;
 if(callsPerModel!==domains.length*perDomain||callsPerModel!==1000||perDomain!==100)throw new Error('Manifest corpus plan differs from 10 × 100');
 const totalCalls=models.length*callsPerModel;
 if(conditions.totalCalls!==undefined&&conditions.totalCalls!==totalCalls)throw new Error('Manifest totalCalls differs from model plan');
 if(conditions.callsPerModel!==undefined&&conditions.callsPerModel!==callsPerModel)throw new Error('Manifest callsPerModel differs');
 if(conditions.totalRequests!==undefined&&conditions.totalRequests!==totalCalls)throw new Error('Manifest totalRequests differs');
 if(conditions.requestsPerModel!==undefined&&conditions.requestsPerModel!==callsPerModel)throw new Error('Manifest requestsPerModel differs');
 if(conditions.repeats!==undefined&&conditions.repeats!==1)throw new Error('Manifest repeats must be one');
 return {models:[...models],modelOrder:[...modelOrder],domains:[...domains],callsPerModel,perDomain,totalCalls,mode,requestsPerModel:callsPerModel,totalRequests:totalCalls};
}

/** Hand-authored expectations are evaluation data; never supplied to model prompts. */
export async function loadSingleService100Cases(root,{allowMissing=false}={}){
 let extra;
 try{extra=(await Promise.all(SINGLE_SERVICE_100_FILES.map(path=>readFile(join(root,path),'utf8').then(JSON.parse)))).flat();}
 catch(error){if(allowMissing&&error.code==='ENOENT')return [];throw error;}
 const system=JSON.parse(await readFile(join(root,'data/cases-system-single.json'),'utf8'));
 const original=[...coreSingleServiceCases,...system].map(c=>({...structuredClone(c),id:`e100-${c.testDomain}-${c.id.slice(-2).padStart(3,'0')}`,suite:SINGLE_SERVICE_100_SUITE,originCaseId:c.id,origin:'previous-100-development',singleService:true}));
 const cases=[...original,...extra.map(c=>({...c,origin:'new-900-fixed-before-inference',singleService:true}))];
 if(cases.length!==1000||new Set(cases.map(c=>c.id)).size!==1000)throw new Error('Expanded suite must contain 1000 unique IDs');
 for(const domain of SINGLE_SERVICE_100_DOMAINS){
  const group=cases.filter(c=>c.testDomain===domain);
  if(group.length!==100||new Set(group.map(c=>c.text.trim())).size!==100)throw new Error(`Expanded ${domain} must contain 100 distinct single-service prompts`);
 }
 if(cases.some(c=>c.suite!==SINGLE_SERVICE_100_SUITE||!SINGLE_SERVICE_100_DOMAINS.includes(c.testDomain)||c.expected?.domain!==c.testDomain||!c.expected?.api||c.expected.api==='unsupported'))throw new Error('Expanded suite cannot include unsupported or cross-service expectations');
 return cases.sort((a,b)=>SINGLE_SERVICE_100_DOMAINS.indexOf(a.testDomain)-SINGLE_SERVICE_100_DOMAINS.indexOf(b.testDomain)||a.id.localeCompare(b.id));
}
