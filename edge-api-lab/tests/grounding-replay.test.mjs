import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveArguments} from '../src/resolver.mjs';
import {getCapability} from '../src/registry.mjs';
import {experimentDefaults} from '../src/fixtures.mjs';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
const module=await import('../scripts/replay-grounding.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const build=(...args)=>{assert.equal(typeof module.buildGroundingReplay,'function','offline replay builder is not implemented');return module.buildGroundingReplay(...args);};
const context={...experimentDefaults,now:'2026-10-10T08:00:00+08:00',timezone:'Asia/Shanghai',location:{latitude:31.2304,longitude:121.4737,source:'fixture'}};
function fixture(){const api='weather.current.pressure',cap=getCapability(api),args={};const r={caseId:'w1',testDomain:'weather',model:'m1',text:'广州当前气压',expected:{domain:'weather',api,arguments:{location:'广州',time_ref:'当前'},status:'ready_mock'},score:{plan:false},run:{id:'original-run',text:'广州当前气压',domain:'weather',api,extractedArguments:args,modelArguments:{},resolved:resolveArguments(cap,args,context),status:'ready_mock',traces:[{raw:'{"arguments":{}}',wallMs:9000}],totalMs:9100,context}};return{manifest:{id:'manifest-1',status:'completed',models:['m1'],conditions:{promptVersion:'sparse-v6',context},entries:[{model:'m1',testDomain:'weather',jobId:'job-1',status:'completed',done:1,total:1}]},jobs:[{id:'job-1',status:'completed',results:[r]}]};}
test('replay preserves raw and strict evidence while measuring deterministic processing separately',async()=>{
 const f=fixture(),before=JSON.stringify(f);let calls=0;
 const out=await build({...f,finalize:({text,domain,api,context})=>{calls++;assert.equal(text,'广州当前气压');const groundedArguments={location:'广州',time_ref:'当前'};const resolved=resolveArguments(getCapability(api),groundedArguments,context);return{domain,api,groundedArguments,grounding:{version:'deterministic-grounding-v1'},resolved,status:resolved.status,mock:{executed:false}};}});
 assert.equal(calls,1);assert.equal(JSON.stringify(f),before);assert.equal(out.report.version,'deterministic-grounding-v1');assert.equal(out.report.metrics.oldStrict.correct,0);assert.equal(out.report.metrics.oldExecutionSemantics.correct,0);assert.equal(out.report.metrics.newExecutionSemantics.correct,1);assert.equal(out.rows[0].runId,'original-run');assert.equal(out.rows[0].raw[0],'{"arguments":{}}');assert.equal(out.rows[0].oldScore.plan,false);assert.equal(out.report.cells[0].oldModelP50Ms,9100);assert.ok(out.report.cells[0].replayP50Ms<9100);assert.equal(out.report.cells[0].improved,1);
});
test('original model output errors are not repaired or finalized offline',async()=>{
 const f=fixture();f.jobs[0].results[0].run.status='error';f.jobs[0].results[0].run.error='model schema failure';let calls=0;
 const out=await build({...f,finalize:()=>{calls++;throw new Error('must not execute');}});
 assert.equal(calls,0);assert.equal(out.rows[0].newSemantic.plan,false);assert.equal(out.rows[0].replay.skipped,true);assert.equal(out.report.cells[0].errors,1);
});
test('only manifest registered job IDs may enter the offline report',async()=>{
 const f=fixture();f.jobs.push({id:'unregistered-old-job',results:[{...f.jobs[0].results[0],caseId:'old'}]});
 const out=await build({...f,finalize:({domain,api,extractedArguments,context})=>{const resolved=resolveArguments(getCapability(api),extractedArguments,context);return{domain,api,groundedArguments:extractedArguments,grounding:{},resolved,status:resolved.status};}});
 assert.equal(out.rows.length,1);assert.equal(out.report.manifestId,'manifest-1');
});
test('historical extraction accuracy is a different counter from the historical complete plan',async()=>{
 const f=fixture();f.jobs[0].results[0].score.arguments=true;
 const out=await build({...f,finalize:({domain,api,extractedArguments,context})=>{const resolved=resolveArguments(getCapability(api),extractedArguments,context);return{domain,api,groundedArguments:extractedArguments,grounding:{},resolved,status:resolved.status};}});
 assert.equal(out.report.metrics.oldStrict.correct,0);assert.equal(out.report.metrics.oldExtraction.correct,1);assert.equal(out.report.cells[0].oldExtractionAccuracy,1);assert.equal(out.report.cells[0].oldExtractionCorrect,1);
});
test('examples preserve an improvement from every available model-domain cell',async()=>{
 const f=fixture(),base=f.jobs[0].results[0];f.manifest.entries[0].total=f.manifest.entries[0].done=9;
 f.jobs[0].results=Array.from({length:9},(_,i)=>({...structuredClone(base),caseId:`w${i}`,run:{...structuredClone(base.run),id:`weather-run-${i}`}}));
 const api='contacts.phone',args={},resolved=resolveArguments(getCapability(api),args,context);
 f.manifest.entries.push({model:'m1',testDomain:'contacts',jobId:'contacts-job',status:'completed',done:1,total:1});
 f.jobs.push({id:'contacts-job',status:'completed',results:[{caseId:'c1',testDomain:'contacts',model:'m1',text:'读取联系人ct_7电话',expected:{domain:'contacts',api,arguments:{contact_id:'ct_7'},status:'ready_mock'},score:{plan:false},run:{id:'contacts-run',domain:'contacts',api,extractedArguments:{},status:resolved.status,resolved,context,traces:[],totalMs:9000}}]});
 const out=await build({...f,finalize:({domain,api,context})=>{const groundedArguments=domain==='weather'?{location:'广州',time_ref:'当前'}:{contact_id:'ct_7'};const resolved=resolveArguments(getCapability(api),groundedArguments,context);return{domain,api,groundedArguments,grounding:{},resolved,status:resolved.status};}});
 assert.ok(out.report.examples.some(row=>row.testDomain==='contacts'&&row.exampleType==='improved'));
 assert.ok(out.report.examples.some(row=>row.testDomain==='weather'&&row.exampleType==='improved'));
});
test('source snapshots verify hashes and refuse to overwrite a different frozen version',async t=>{
 assert.equal(typeof module.saveReplaySourceSnapshot,'function','snapshot saver is not implemented');
 const directory=await mkdtemp(join(tmpdir(),'edge-api-snapshot-'));
 t.after(async()=>{const rel=relative(tmpdir(),directory);assert.ok(rel.startsWith('edge-api-snapshot-')&&!rel.startsWith('..'));await rm(directory,{recursive:true,force:true});});
 await mkdir(join(directory,'src'));await writeFile(join(directory,'src/example.mjs'),'export const version=1;');
 const opts={root:directory,snapshotDirectory:'data/frozen-v1',paths:['src/example.mjs']};
 const first=await module.saveReplaySourceSnapshot(opts);assert.equal(first.files[0].verified,true);assert.equal(await readFile(join(directory,'data/frozen-v1/src/example.mjs'),'utf8'),'export const version=1;');
 await module.saveReplaySourceSnapshot(opts);
 await writeFile(join(directory,'src/example.mjs'),'export const version=2;');
 await assert.rejects(module.saveReplaySourceSnapshot(opts),/快照.*不一致/);
 assert.equal(await readFile(join(directory,'data/frozen-v1/src/example.mjs'),'utf8'),'export const version=1;');
});
