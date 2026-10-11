import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const read=async path=>JSON.parse(await readFile(join(root,path),'utf8'));
const hash=async path=>createHash('sha256').update(await readFile(join(root,path))).digest('hex');
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const key=r=>`${r.model}/${r.variant??''}/${r.caseId}`;
function unchanged(before,after,fields){
 const byKey=new Map(after.map(row=>[key(row),row]));
 check(before.length===after.length&&byKey.size===after.length,'Row coverage changed');
 for(const row of before)for(const field of fields)check(isDeepStrictEqual(row[field],byKey.get(key(row))?.[field]),`Original field changed: ${key(row)}/${field}`);
 return {rows:before.length,fields,unchanged:true};
}
async function snapshot(directory,hashes){
 for(const [path,expected]of Object.entries(hashes))check(await hash(join(directory,path))===expected,`Frozen snapshot changed: ${directory}/${path}`);
 return {directory,files:Object.keys(hashes).length,unchanged:true};
}
const initial=await read('evidence/feasibility-live-audit.json');
const finals=await Promise.all(['final','final2','final3'].map(v=>read(`evidence/feasibility-${v}-audit.json`)));
const fields=['model','variant','caseId','text','expected','context','raw','rawScore','trace','candidates','v1Run','v1Score','error'];
const formal=finals.map(a=>({id:a.id,...unchanged(initial.rows,a.rows,fields)}));
const sourceSnapshots=[await snapshot('data/benchmark-single-service-v3',initial.conditions.sourceHashes)];
for(const a of finals)sourceSnapshots.push(await snapshot(a.conditions.finalRuleSnapshot,a.conditions.sourceHashes));
const current=finals.at(-1);
for(const [path,expected]of Object.entries(current.conditions.sourceHashes))check(await hash(path)===expected,`Current source mismatch: ${path}`);
const replay=await read('docs/grounding-replay-v2-final3.json');
for(const [path,expected]of Object.entries(replay.conditions.frozenEvidenceHashes))check(await hash(path)===expected,`Historical source evidence changed: ${path}`);
const globalOriginal=await read('evidence/global-cities-live-audit.json');
const globalFinal1=await read('evidence/global-cities-final-audit.json');
const globalFinal2=await read('evidence/global-cities-final2-audit.json');
const globalFinal3=await read('evidence/global-cities-final3-audit.json');
const globalFields=['model','caseId','text','city','expected','rawScore','semantic','raw','trace','candidates','run','context','rawNameExact','finalNameExact','error'];
const globalPreservation=[globalFinal1,globalFinal2,globalFinal3].map(a=>({id:a.id,...unchanged(globalOriginal.rows,a.rows,globalFields)}));
unchanged(globalFinal1.rows,globalFinal3.rows,['correctedExpected','correctedRawScore','correctedSemantic']);
check(globalFinal3.scoringCorrections.length===3,'Scoring corrections changed');
sourceSnapshots.push(await snapshot('data/benchmark-global-cities-v1',globalOriginal.conditions.sourceHashes));
sourceSnapshots.push(await snapshot('data/benchmark-global-cities-v1-final',globalFinal1.conditions.finalScoringSourceHashes));
sourceSnapshots.push(await snapshot(globalFinal2.conditions.finalRuleSnapshot,globalFinal2.conditions.finalRuleSourceHashes));
sourceSnapshots.push(await snapshot(globalFinal3.conditions.finalRuleSnapshot,globalFinal3.conditions.finalRuleSourceHashes));
for(const [path,expected]of Object.entries(globalFinal3.conditions.finalRuleSourceHashes))check(await hash(path)===expected,`Current global replay source mismatch: ${path}`);
const appText=await readFile(join(root,'public/app.js'),'utf8'),html=await readFile(join(root,'public/index.html'),'utf8');
check(!appText.includes('navigator.geolocation')&&!html.includes('value="browser"'),'Computer location entry still exists');
check(replay.metrics.newExecutionSemantics.correct===959&&replay.metrics.newExecutionSemantics.total===1200,'Unexpected historical replay count');
const report={status:'passed',checkedAt:new Date().toISOString(),modelCalls:0,formal,globalPreservation,sourceSnapshots,
 currentSourcesMatch:true,historicalEvidence:{files:Object.keys(replay.conditions.frozenEvidenceHashes).length,unchanged:true},
 phoneLocationBoundary:{uiUsesFixtureOnly:true,noComputerGeolocationEntry:true,nativePhoneSDKConnected:false},
 notes:['只读核验原始推理、各次源码快照与历史输入；仅写出本核验报告，不改写原始记录。','这是证据一致性核验，不是新增模型测试或真机SDK验证；fixture-only HTTP 边界另由自动测试验证。']};
await writeFile(join(root,'evidence/final-evidence-verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,formalCalls:initial.rows.length,globalCalls:globalOriginal.rows.length,currentSourcesMatch:true,historicalFiles:report.historicalEvidence.files,snapshots:sourceSnapshots.length},null,2));
