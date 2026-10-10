// Verify the completed comparison against its frozen corpus and raw evidence.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {loadCases} from '../src/corpus.mjs';
import {buildDomainReport,testDomains,suiteModels,diagnoseCase} from '../src/domain-report.mjs';
import {scoreCase,summarize} from '../data/benchmark-sparse-v6/src/evaluation.mjs';
import {buildUnifiedPrompt} from '../data/benchmark-sparse-v6/src/prompts.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const json=async path=>JSON.parse(await readFile(join(root,path),'utf8'));
const manifest=await json('data/runtime/domain-suite.json');
assert.equal(manifest.status,'completed');assert.equal(manifest.entries.length,24);
const cases=(await loadCases(root)).filter(c=>c.suite===manifest.suite),byId=new Map(cases.map(c=>[c.id,c]));
assert.equal(cases.length,300);
const jobs=await Promise.all(manifest.entries.map(e=>json(`data/runtime/eval-${e.jobId}.json`)));
const pairs=new Set(),runIds=new Set();let warmups=0;
for(const model of suiteModels)for(const domain of testDomains){
 const entries=manifest.entries.filter(e=>e.model===model&&e.testDomain===domain);assert.equal(entries.length,1);
 assert.equal(entries[0].status,'completed');assert.equal(entries[0].done,50);
 const job=jobs.find(j=>j.id===entries[0].jobId);assert.equal(job.status,'completed');assert.equal(job.results.length,50);
 warmups+=(job.warmups??[]).length;
 for(const row of job.results){
  const sample=byId.get(row.caseId),run=row.run;assert.ok(sample);assert.equal(sample.testDomain,domain);
  assert.deepEqual(row.expected,sample.expected);assert.deepEqual(row.score,scoreCase(sample.expected,run));
  const pair=`${row.caseId}/${model}`;assert.ok(!pairs.has(pair));pairs.add(pair);assert.ok(!runIds.has(run.id));runIds.add(run.id);
  assert.equal(row.model,model);assert.equal(run.model,model);assert.equal(run.mode,'unified');assert.ok(!['cancelled','interrupted'].includes(run.status));
  assert.equal(run.environment.models.find(m=>m.name===model)?.digest,manifest.conditions.models.find(m=>m.name===model)?.digest);
  assert.equal(run.traces.length,1);assert.equal(run.traces[0].stage,'unified');assert.equal(run.traces[0].promptVersion,manifest.conditions.promptVersion);
  const prompt=buildUnifiedPrompt(run.text,run.context);assert.deepEqual(run.traces[0].messages,prompt.messages);assert.deepEqual(run.traces[0].schema,prompt.schema);assert.deepEqual(run.traces[0].promptMeta.candidates,prompt.promptMeta.candidates);
  assert.equal(run.traces[0].options.num_ctx,2048);assert.equal(run.traces[0].options.temperature,0);assert.equal(run.traces[0].options.num_predict,224);
  assert.ok(Number.isFinite(run.totalMs)&&run.totalMs>0);assert.ok(Number.isFinite(run.traces[0].wallMs)&&run.traces[0].wallMs>0);
  assert.equal(run.context.now,sample.context?.now??manifest.conditions.context.now);assert.equal(run.context.timezone,sample.context?.timezone??manifest.conditions.context.timezone);
  if(sample.expected.api)assert.ok(run.traces[0].promptMeta.candidates.ids.includes(sample.expected.api));
  assert.deepEqual(await json(`data/runtime/run-${run.id}.json`),run);
 }
}
assert.equal(pairs.size,1200);assert.equal(warmups,4);
const currentSourceChanges=[];
for(const [path,hash]of Object.entries(manifest.conditions.sourceHashes)){
 const file=`data/benchmark-sparse-v6/${path}`;
 assert.equal(createHash('sha256').update(await readFile(join(root,file))).digest('hex'),hash,`Frozen hash mismatch: ${file}`);
 const currentHash=createHash('sha256').update(await readFile(join(root,path))).digest('hex');
 if(currentHash!==hash)currentSourceChanges.push({path,frozenHash:hash,currentHash});
 // The historic corpus must remain identical even after runtime rule upgrades.
 if(path.startsWith('data/'))assert.equal(currentHash,hash,`Corpus hash mismatch: ${path}`);
}
const report=buildDomainReport(manifest,cases,jobs),rows=jobs.flatMap(j=>j.results);
assert.equal(report.progress.done,1200);assert.ok(report.summary.every(r=>r.total===50));
const failures=rows.filter(r=>!r.score.plan).length;assert.equal(report.errors.reduce((n,e)=>n+e.count,0),failures);
assert.equal(rows.filter(r=>diagnoseCase(r).code==='candidate_missing').length,0);
const evidence={verifiedAt:new Date().toISOString(),manifestId:manifest.id,promptVersion:manifest.conditions.promptVersion,entries:24,cases:300,runs:pairs.size,warmups,traceCalls:1200,failedPlans:failures,primaryErrorCount:report.errors.reduce((n,e)=>n+e.count,0),candidateMissing:0,sourceHashesVerified:true,sourceHashScope:'immutable sparse-v6 snapshot and unchanged historic corpus; current runtime differences are separately recorded',currentSourceChanges,rawRunCopiesVerified:true,actualPromptsVerified:true,modelDigestsVerified:true,overall:summarize(rows),checks:['24 domain/model cells contain exactly 50 unique cases','1200 unique model/case pairs and raw run files','four separate warmups excluded','immutable frozen corpus, prompts, resolver, provider and scoring hashes verified','all actual prompts and output schemas match frozen construction','model digests match the recorded installed versions','stored scores recomputed with the frozen scorer from raw runs','one real unified trace and measured duration per run','all supported targets in actual recorded candidates','mutually exclusive error counts equal failed plans','runtime source changes recorded separately; historic corpus remains identical']};
await writeFile(join(root,'docs/domain-run-verification.json'),JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence,null,2));
