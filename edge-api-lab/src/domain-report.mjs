import {isDeepStrictEqual} from 'node:util';
import {summarize} from './evaluation.mjs';

export const suite='domain-50-v1';
export const testDomains=['weather','calendar','contacts','files','services','cloud'];
export const suiteModels=['qwen2.5:0.5b','qwen2.5:1.5b','qwen2.5:3b','qwen2.5:7b'];
const labels={correct:'完全正确',service_error:'调用或结构输出失败',domain_error:'领域或拒识错误',candidate_missing:'目标 API 未进入候选',api_error:'候选内 API 选错',arguments_extra:'多填或猜测入参',arguments_missing:'遗漏明确入参',arguments_value:'入参值或类型错误',resolution_error:'补全来源或降级错误',status_error:'执行或澄清状态错误',other:'其他契约不一致'};

function argumentDiff(expected,actual,path='',result={extra:[],missing:[],value:[]}) {
 if(isDeepStrictEqual(expected,actual))return result;
 const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
 if(object(expected)&&object(actual)) {
  for(const key of Object.keys(actual))if(!Object.hasOwn(expected,key))result.extra.push(path?`${path}.${key}`:key);
  for(const key of Object.keys(expected)) {
   const name=path?`${path}.${key}`:key;
   if(!Object.hasOwn(actual,key))result.missing.push(name);else argumentDiff(expected[key],actual[key],name,result);
  }
 }else result.value.push(path||'arguments');
 return result;
}

// Diagnose the first observable failing stage, not hidden model reasoning.
export function diagnoseCase(row) {
 const run=row.run??{},score=row.score??{},expected=row.expected??{};
 const result=(code,reason,details)=>({code,label:labels[code],reason,...(details?{details}:{})});
 if(run.status==='error')return result('service_error',run.error??'模型调用或 JSON/schema 校验失败；见原始记录。');
 if(score.plan)return result('correct','领域、API、明确入参、状态、补全来源及标注精度均通过。');
 if(!score.domain)return result('domain_error',`预期领域 ${expected.domain}，实际 ${run.domain??'未输出'}；后续误差不重复作为主因。`);
 if(!score.api) {
  const candidates=run.candidates?.unified?.ids??run.candidates?.intent?.ids;
  if(expected.api&&Array.isArray(candidates)&&!candidates.includes(expected.api))return result('candidate_missing',`预期 ${expected.api} 未进入本次 ${candidates.length} 个候选，模型没有选择目标 API 的机会。`,{candidates});
  return result('api_error',`预期 ${expected.api??'拒识'}，实际 ${run.api??'拒识'}；目标候选存在或无候选证据。`);
 }
 if(!score.arguments) {
  const diff=argumentDiff(expected.arguments??{},run.extractedArguments??{});
  if(diff.extra.length)return result('arguments_extra',`出现提示词金标之外的明确入参：${diff.extra.join('、')}。系统状态应由解析器补全。`,diff);
  if(diff.missing.length)return result('arguments_missing',`遗漏用户明确给出的入参：${diff.missing.join('、')}。`,diff);
  return result('arguments_value',`入参值、类型或保留原文不一致：${diff.value.join('、')}。`,diff);
 }
 if(score.sources===false||score.resolution===false)return result('resolution_error','明确入参匹配，但补全来源或标注的时间/地点降级结果不一致；比较 resolved.sources 和 resolved.resolution。');
 if(!score.status)return result('status_error',`预期 ${expected.status}，实际 ${run.status}；可能错误放行、过度澄清或环境不可用判断不一致。`);
 return result('other','存在未通过的契约检查，详见逐项分数和调用记录。');
}

function metrics(rows) {
 if(!rows.length)return {total:0,domainAccuracy:null,apiAccuracy:null,argumentAccuracy:null,statusAccuracy:null,planAccuracy:null,p50Ms:null,p95Ms:null,errorCount:0,callCount:0,meanLoadMs:null};
 const value=summarize(rows)[0];
 const load=rows.flatMap(row=>row.run?.traces??[]).map(t=>t.loadMs).filter(Number.isFinite);
 return {...value,meanLoadMs:load.length?load.reduce((a,b)=>a+b,0)/load.length:null};
}

export function buildDomainReport(manifest={},cases=[],jobs=[]) {
 const models=manifest.models??suiteModels;
 const selected=cases.filter(item=>item.suite===suite);
 const byId=new Map(selected.map(item=>[item.id,item]));
 const ids=new Set((manifest.entries??[]).map(item=>item.jobId));
 const active=jobs.filter(job=>ids.has(job.id));
 const rows=active.flatMap(job=>(job.results??[]).filter(row=>byId.has(row.caseId)&&models.includes(row.model)).map(row=>({...row,testDomain:byId.get(row.caseId).testDomain,scenario:byId.get(row.caseId).scenario})));
 const summary=[],scenarios=[],errors=[];
 for(const testDomain of testDomains)for(const model of models) {
  const group=rows.filter(row=>row.testDomain===testDomain&&row.model===model);
  summary.push({testDomain,model,targetTotal:50,...metrics(group)});
  const conditions=[...new Set(selected.filter(item=>item.testDomain===testDomain).map(item=>item.scenario))];
  for(const scenario of conditions) {
   const subset=group.filter(row=>row.scenario===scenario);
   const targetTotal=selected.filter(item=>item.testDomain===testDomain&&item.scenario===scenario).length;
   const causes=Map.groupBy(subset.filter(row=>!row.score.plan),row=>diagnoseCase(row).code);
   const primaryErrors=[...causes].map(([code,entries])=>({code,label:labels[code],count:entries.length}));
   scenarios.push({testDomain,scenario,model,targetTotal,...metrics(subset),primaryErrors});
   for(const [code,entries]of causes)errors.push({testDomain,model,scenario,code,label:labels[code],count:entries.length,examples:entries.slice(0,3).map(row=>({caseId:row.caseId,scenario,text:row.text??byId.get(row.caseId).text,expected:row.expected,actual:row.actual??{domain:row.run.domain,api:row.run.api,arguments:row.run.extractedArguments,status:row.run.status},reason:diagnoseCase(row).reason,runId:row.run?.id}))});
  }
 }
 return {id:manifest.id??null,suite,mode:manifest.mode??'unified',status:manifest.status??'not_started',progress:{done:rows.length,total:testDomains.length*50*models.length},expectedCasesPerDomain:50,models,summary,scenarios,errors,caseCoverage:{byDomain:testDomains.map(testDomain=>({testDomain,count:selected.filter(item=>item.testDomain===testDomain).length,categories:[...Map.groupBy(selected.filter(item=>item.testDomain===testDomain),item=>item.scenario)].map(([scenario,entries])=>({scenario,category:entries[0]?.category,count:entries.length}))}))},notes:['每领域新增 50 条，使用同一套人工金标；拒识用例仍归所属测试领域。','准确率分母为已完成样本，调用/结构失败计为错误；未运行数值留空。','耗时为单条处理 totalMs 的中位数/P95，不含队列等待；每模型首次预热另存且不计分。','完整计划要求领域、API、明确入参、状态、标注来源和精度均正确。','主错因按调用→领域→候选/API→入参→补全/精度→状态顺序互斥归类，仅表示可观察错误证据。','人工边界测试集不代表真实用户分布；这是单次确定性运行、同一 Qwen 家族和本机 CPU 的结果。'],jobs:active.map(job=>({id:job.id,status:job.status,done:job.results?.length??0,total:job.progress?.total??50})),updatedAt:new Date().toISOString(),conditions:manifest.conditions??null,startedAt:manifest.startedAt,completedAt:manifest.completedAt,error:manifest.error};
}
