import {readFile,realpath,lstat} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {SINGLE_SERVICE_100_DOMAINS as domains} from '../src/single-service-100.mjs';
const check=(ok,message)=>{if(!ok)throw new Error('Comparison baseline: '+message);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity=details=>details.map(({name,digest})=>({name,digest}));
const close=(actual,wanted)=>Number.isFinite(actual)&&Number.isFinite(wanted)&&Math.abs(actual-wanted)<=1e-12*Math.max(1,Math.abs(actual),Math.abs(wanted));
const quantile=(rows,p)=>{const values=rows.map(row=>row.wallMs).sort((a,b)=>a-b);return values[Math.round((values.length-1)*p)];};
function validateStatistics(saved,rows,{model,testDomain=null,total}){
 check(saved?.model===model&&(saved.testDomain??null)===testDomain&&saved.planned===total&&saved.total===total&&saved.complete===true&&rows.length===total,'summary/cell scope or completion differs');
 for(const [key,predicate] of [['domain',row=>row.rawScore.domain],['api',row=>row.rawScore.api],['rawArguments',row=>row.rawScore.arguments],['semantics',row=>row.execution.plan]]){
  const correct=rows.filter(predicate).length,metric=saved[key];
  check(metric?.correct===correct&&metric.total===total&&close(metric.accuracy,correct/total),`${model}/${testDomain??'all'} ${key} metric differs from index`);
 }
 check(close(saved.p50Ms,quantile(rows,.5))&&close(saved.p95Ms,quantile(rows,.95)),`${model}/${testDomain??'all'} request quantiles differ from index`);
}
export function validateBaselineBinding({manifest,report,index},expected){
 check(manifest.status==='completed'&&report.status==='completed'&&index.status==='completed','must be completed');
 check((manifest.conditions.mode??'unified')==='unified','must be the single-call baseline');
 check(report.id===manifest.id&&index.manifestId===manifest.id,'mixed ownership');
 check(manifest.corpus.sha256===expected.corpusHash&&report.corpus.sha256===expected.corpusHash,'corpus hash differs');
 for(const [actual,wanted,label] of [[manifest.corpus.caseOrder,expected.caseOrder,'case order'],[manifest.conditions.models,expected.models,'models'],[identity(manifest.conditions.modelDetails),identity(expected.modelDetails),'model digests'],[manifest.conditions.options,expected.options,'options'],[manifest.conditions.context,expected.context,'context']])check(isDeepStrictEqual(actual,wanted),label+' differs');
 check(isDeepStrictEqual(report.conditions,manifest.conditions),'report settings differ from manifest');
 check(expected.models.length===4&&new Set(expected.models).size===4&&expected.caseOrder.length===1000&&new Set(expected.caseOrder).size===1000,'requires four models and one thousand unique cases');
 check(isDeepStrictEqual(manifest.conditions.domains,domains)&&manifest.corpus.total===1000&&manifest.corpus.perDomain===100,'domain plan differs');
 const caseDomains=new Map(expected.caseOrder.map(id=>[id,domains.find(domain=>new RegExp(`^e100-${domain}-\\d{3}$`).test(id))]));
 check([...caseDomains.values()].every(Boolean)&&domains.every(domain=>[...caseDomains.values()].filter(value=>value===domain).length===100),'frozen case identities do not contain ten domains of one hundred');
 const planned=expected.models.flatMap(model=>expected.caseOrder.map(id=>model+'/'+id));
 check(index.rows.length===planned.length&&index.rows.every((r,i)=>r.model+'/'+r.caseId===planned[i]),'raw index must be the complete unique model/case order');
 check(index.rows.every(r=>Number.isFinite(r.wallMs)&&r.wallMs>=0),'missing or invalid saved request timing');
 check(index.rows.every(row=>row.testDomain===caseDomains.get(row.caseId)),'index domain differs from frozen case identity');
 check(index.rows.every(row=>['domain','api','arguments'].every(key=>typeof row.rawScore?.[key]==='boolean')&&typeof row.execution?.plan==='boolean'),'missing/non-boolean common score evidence');
 check(Array.isArray(report.summary)&&report.summary.length===4&&report.summary.every((r,i)=>r.model===expected.models[i]),'summary is incomplete or duplicated');
 check(Array.isArray(report.cells)&&report.cells.length===40&&new Set(report.cells.map(cell=>cell.model+'/'+cell.testDomain)).size===40,'requires forty unique model/domain cells');
 const cellMap=new Map(report.cells.map(cell=>[cell.model+'/'+cell.testDomain,cell]));
 for(const model of expected.models){
  const rows=index.rows.filter(row=>row.model===model);
  validateStatistics(report.summary.find(saved=>saved.model===model),rows,{model,total:1000});
  for(const testDomain of domains)validateStatistics(cellMap.get(model+'/'+testDomain),rows.filter(row=>row.testDomain===testDomain),{model,testDomain,total:100});
 }
 return true;
}
export function buildComparisonBaseline({manifest,report,index},{sourcePath,reportPath,reportSha256,indexSha256}){
 const timing=list=>({requestTotalMs:list.reduce((s,r)=>s+r.wallMs,0),requestMeanMs:list.length?list.reduce((s,r)=>s+r.wallMs,0)/list.length:null});
 const add=r=>({...structuredClone(r),timing:timing(index.rows.filter(row=>row.model===r.model&&(!r.testDomain||row.testDomain===r.testDomain)))});
 const c=manifest.conditions;
 return{id:manifest.id,mode:'unified',sourcePath,reportPath,reportSha256,indexSha256,corpusSha256:manifest.corpus.sha256,
  conditions:{mode:'unified',models:c.models,modelOrder:c.modelOrder,modelDetails:identity(c.modelDetails),options:c.options,context:c.context,hardware:c.hardware,promptVersion:c.promptVersion,groundingVersion:c.groundingVersion,catalogVersion:c.catalogVersion},summary:report.summary.map(add),cells:report.cells.map(add)};
}
async function inside(root,path){
 const target=resolve(root,path),rel=relative(root,target);check(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..\\')&&!rel.startsWith('../'),'path escapes project');
 const physicalRoot=await realpath(root),physical=await realpath(target),realRel=relative(physicalRoot,physical);
 check(!isAbsolute(realRel)&&realRel!=='..'&&!realRel.startsWith('..\\')&&!realRel.startsWith('../')&&(await lstat(target)).isFile(),'must be a regular project file');return target;
}
export async function loadComparisonBaseline({root,manifestPath,...expected}){
 root=resolve(root);const source=await inside(root,manifestPath),sourceBytes=await readFile(source),manifest=JSON.parse(sourceBytes);
 const reportPath=manifest.storage?.reportPath,indexPath=manifest.storage?.indexPath;
 check(typeof reportPath==='string'&&typeof indexPath==='string','unique storage is required');
 const rp=await inside(root,reportPath),ip=await inside(root,indexPath),[reportBytes,indexBytes]=await Promise.all([readFile(rp),readFile(ip)]);
 const values={manifest,report:JSON.parse(reportBytes),index:JSON.parse(indexBytes)};validateBaselineBinding(values,expected);
 const result=buildComparisonBaseline(values,{sourcePath:relative(root,source).replaceAll('\\','/'),reportPath,reportSha256:hash(reportBytes),indexSha256:hash(indexBytes)});
 const reread=await Promise.all([readFile(source),readFile(rp),readFile(ip)]);check(reread[0].equals(sourceBytes)&&reread[1].equals(reportBytes)&&reread[2].equals(indexBytes),'files changed during load');return result;
}
