import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {finalizePlan,GROUNDING_VERSION} from '../src/grounding.mjs';
import {scoreExecutionSemantics} from '../src/semantic-evaluation.mjs';
import {saveReplaySourceSnapshot} from './replay-grounding.mjs';

// A rule-only replay of the corrected, immutable 24 live outputs. No provider calls.
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const read=async path=>JSON.parse(await readFile(join(root,path),'utf8'));
const original=await read('evidence/global-cities-final-audit.json');
if(original.rows.length!==24||original.scoringCorrections.length!==3)throw new Error('Expected corrected, closed 24-call evidence');
for(const [path,hash] of Object.entries(original.conditions.finalScoringSourceHashes)){
 const bytes=await readFile(join(root,'data/benchmark-global-cities-v1-final',path));
 if(createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error(`Final1 snapshot changed: ${path}`);
}
const paths=[...Object.keys(original.conditions.finalScoringSourceHashes),'scripts/finalize-global-cities-final3.mjs','tests/location-failclosed.test.mjs',
 'src/application.mjs','public/app.js','public/index.html','public/context-builder.mjs','tests/mock-phone-location.test.mjs'];
const snapshot=await saveReplaySourceSnapshot({root,snapshotDirectory:'data/benchmark-global-cities-v1-final3',paths});
const hashes=Object.fromEntries(snapshot.files.map(file=>[file.path,file.sha256]));
const final=structuredClone(original);
final.id=`${original.id}-final-phone-mock3`;
final.derivedAt=new Date().toISOString();
final.derivedFrom={id:original.id,path:'evidence/global-cities-final-audit.json',modelCalls:0,modelOutputsReused:true,ruleOnlyReplay:true};
final.conditions.finalRuleSourceHashes=hashes;
final.conditions.finalRuleSnapshot=snapshot.directory;
final.conditions.groundingVersion=GROUNDING_VERSION;
for(const row of final.rows){
 row.final3Run=row.error?structuredClone(row.run):finalizePlan({text:row.text,domain:row.raw.domain,api:row.raw.api,extractedArguments:structuredClone(row.raw.extractedArguments),context:row.context});
 row.final3Semantic=scoreExecutionSemantics(row.correctedExpected,row.final3Run,row.context);
 const field=row.correctedExpected.domain==='location'?'address':'location';
 row.final3NameExact=row.final3Run.groundedArguments?.[field]===row.city.name;
}
const rate=(rows,fn)=>({correct:rows.filter(fn).length,total:rows.length,accuracy:rows.length?rows.filter(fn).length/rows.length:null});
const summary=original.conditions.modelDetails.map(m=>m.name).map(model=>{const rows=final.rows.filter(r=>r.model===model);return {model,executed:rows.length>0,
 exclusionReason:rows.length?null:'recorded_7b_memory_pressure_timeout',api:rate(rows,r=>r.correctedRawScore.api),rawArguments:rate(rows,r=>r.correctedRawScore.arguments),
 rawNameExact:rate(rows,r=>r.rawNameExact),finalNameExact:rate(rows,r=>r.final3NameExact),semantics:rate(rows,r=>r.final3Semantic.plan),
 candidateRecall:rate(rows,r=>r.candidates.some(c=>c.id===r.correctedExpected.api)),errors:rows.filter(r=>r.error).length};});
const changes={improved:final.rows.filter(r=>!r.correctedSemantic.plan&&r.final3Semantic.plan).length,regressed:final.rows.filter(r=>r.correctedSemantic.plan&&!r.final3Semantic.plan).length};
const report={id:final.id,status:final.status,generatedAt:final.derivedAt,total:final.rows.length,modelCalls:0,summary,changes,scoringCorrections:original.scoringCorrections,
 conditions:final.conditions,auditPath:'evidence/global-cities-final3-audit.json',previousAuditPath:'evidence/global-cities-final-audit.json',initialAuditPath:'evidence/global-cities-live-audit.json',
 notes:['复用8个预先选定中文冷门城市×3档模型的24条原始输出，仅回放最终安全守卫；没有新增推理。7B因已记录的硬件内存压力未执行，准确率null而非0%。',
 '原expected/rawScore/semantic/raw/trace/候选/run以及final1的correctedExpected/Score全部保留。3条风速API名的既有评分修正单独列出，不算模型或规则收益。',
 '规则不改API，3B选错calendar.event.location的错误保留。未知天气地点resolution_failed是拒绝错误当前位置替代，不是坐标解析成功；地理编码伪API仅ready_mock，未调用SDK。',
 '60城×8中文模板回归不是全球覆盖率证明。中文标签来源GeoNames社区数据，有可用中文标签的采样偏倚；低人口只是冷门代理。仅全球地理范围，不评价多语言。',
 '当前实验台的本机位置指模拟手机当前位置，仅使用fixture，不读取电脑定位。历史原始数据和各次派生证据不改写；真实手机定位待鸿蒙宿主接入。']};
for(const [path,hash]of Object.entries(hashes))if(createHash('sha256').update(await readFile(join(root,path))).digest('hex')!==hash)throw new Error(`Source changed during replay: ${path}`);
await mkdir(join(root,'evidence'),{recursive:true});
await writeFile(join(root,'evidence/global-cities-final3-audit.json'),JSON.stringify(final,null,2)+'\n');
await writeFile(join(root,'docs/global-cities-final3.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({summary,changes},null,2));
