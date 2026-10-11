import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {getCapability} from '../src/registry.mjs';
import {scoreCase} from '../src/evaluation.mjs';
import {scoreExecutionSemantics} from '../src/semantic-evaluation.mjs';
import {saveReplaySourceSnapshot} from './replay-grounding.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const original=JSON.parse(await readFile(join(root,'evidence/global-cities-live-audit.json'),'utf8'));
if(!['completed','completed_with_model_exclusion'].includes(original.status)||original.rows.length!==original.conditions.actualScheduledCalls)throw new Error('Global calls must be closed');
for(const [path,hash]of Object.entries(original.conditions.sourceHashes)){
 const bytes=await readFile(join(root,'data/benchmark-global-cities-v1',path));
 if(createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error(`Inference snapshot changed: ${path}`);
}
const final=structuredClone(original);
final.id=`${original.id}-corrected-api-id`;
final.derivedAt=new Date().toISOString();
final.derivedFrom={id:original.id,path:'evidence/global-cities-live-audit.json',modelCalls:0,
 reason:'风速样本的expected API误写weather.current.windSpeed；真实目录为weather.current.wind.speed。expected从未传入模型、prompt或grounding，纠正仅重新计分。'};
final.conditions.inferenceSourceHashes=original.conditions.sourceHashes;
const changes=[];
for(const row of final.rows){
 const correctedExpected=structuredClone(row.expected);
 if(correctedExpected.api==='weather.current.windSpeed'){
  correctedExpected.api='weather.current.wind.speed';
  changes.push({model:row.model,caseId:row.caseId,field:'expected.api',before:row.expected.api,after:correctedExpected.api});
 }
 const capability=getCapability(correctedExpected.api);
 if(!capability||capability.domain!==correctedExpected.domain)throw new Error('Expected API must exist in the registered domain');
 row.correctedExpected=correctedExpected;
 row.correctedRawScore=scoreCase(correctedExpected,{...row.raw,status:row.error?'error':'parsed'});
 row.correctedSemantic=scoreExecutionSemantics(correctedExpected,row.run,row.context);
}
if(changes.length!==original.conditions.activeModels.length)throw new Error('Only the one known misspelled wind-speed expectation per active model may change');
final.scoringCorrections=changes;
const paths=[...Object.keys(original.conditions.sourceHashes),'scripts/finalize-global-cities.mjs','tests/global-city-candidates.test.mjs','tests/global-city-extraction.test.mjs','tests/global-city-sampling.test.mjs'];
const snapshot=await saveReplaySourceSnapshot({root,snapshotDirectory:'data/benchmark-global-cities-v1-final',paths});
const hashes=Object.fromEntries(snapshot.files.map(file=>[file.path,file.sha256]));
final.conditions.finalScoringSourceHashes=hashes;
const rate=(rows,fn)=>({correct:rows.filter(fn).length,total:rows.length,accuracy:rows.length?rows.filter(fn).length/rows.length:null});
const models=original.conditions.modelDetails.map(m=>m.name);
const summary=models.map(model=>{const rows=final.rows.filter(row=>row.model===model);return {model,executed:rows.length>0,
 exclusionReason:rows.length?null:'recorded_7b_memory_pressure_timeout',api:rate(rows,r=>r.correctedRawScore.api),rawArguments:rate(rows,r=>r.correctedRawScore.arguments),
 rawNameExact:rate(rows,r=>r.rawNameExact),finalNameExact:rate(rows,r=>r.finalNameExact),semantics:rate(rows,r=>r.correctedSemantic.plan),
 candidateRecall:rate(rows,r=>r.candidates.some(c=>c.id===r.correctedExpected.api)),errors:rows.filter(r=>r.error).length};});
const report={id:final.id,status:final.status,generatedAt:final.derivedAt,total:final.rows.length,modelCalls:0,summary,scoringCorrections:changes,
 conditions:final.conditions,auditPath:'evidence/global-cities-final-audit.json',initialAuditPath:'evidence/global-cities-live-audit.json',
 notes:['24条为8个预先选定中文冷门城市×3档可运行模型；7B依据先前连续超时证据排除，准确率null而非0%。','原expected/rawScore/semantic/raw/trace/候选/run完全保留；correctedExpected/Score仅纠正3条风速API名拼写错误，不算模型或规则改善。','原prompt和grounding没有接收expected；未重新调用模型，未重新构造调用计划。','地点抽取与API选择分开；规则不改选API，因此3B选成calendar.event.location的错误仍保留。','未知天气地点resolution_failed是正确拒绝当前位置替代，不是坐标解析成功；location.geocode仍仅ready_mock，未执行SDK。','60城×8中文模板的规则回归通过，不构成小模型全球覆盖率证明；全球仅地理范围，不评价多语言。']};
for(const [path,hash]of Object.entries(hashes))if(createHash('sha256').update(await readFile(join(root,path))).digest('hex')!==hash)throw new Error(`Scoring source changed: ${path}`);
await mkdir(join(root,'evidence'),{recursive:true});
await writeFile(join(root,'evidence/global-cities-final-audit.json'),JSON.stringify(final,null,2)+'\n');
await writeFile(join(root,'docs/global-cities-final.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({summary,corrections:changes.length},null,2));
