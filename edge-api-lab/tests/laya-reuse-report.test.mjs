import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename,resolve} from 'node:path';
import {generateLayaReuseReport} from '../scripts/generate-laya-reuse-report.mjs';
const view=await import('../src/laya-reuse-report.mjs').catch(()=>({}));
const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const profile={namespace:'batch-a',modelRevision:'revision-fixed',layaVersion:'0.4.6',threads:8};
const request={state:{text:'查电量'},model:'multilingual',questions:{domain:{type:'choice',criteria:{device:'设备',unsupported:'拒识'}}}};
const entry=(id,wallMs,meta=null,overrides={})=>({recordPath:`evidence/batch-a/${id}.json`,recordSha256:sha(id),record:{manifestId:'batch-a',caseId:'e100-device-001',model:id,shadow:{decisions:[{stage:'domain',candidateIds:['device','unsupported'],expectedInCandidates:true,laya:{selected:'device',selectionCorrect:true,contractValid:true,error:null,wallMs,trace:{request,wallMs,inferenceMs:meta?.hit?0:80,startedAt:'2026-10-13T01:00:00Z',raw:JSON.stringify({model:'multilingual',answers:{domain:{type:'choice',choice:'device'}},...(meta?{x_benchmark_reuse:meta}:{})})}}}]},...overrides}});
const meta=(hit,origin)=>({version:'laya-benchmark-reuse-v1',policy:'exact-native-request-v1',...profile,requestSha256:sha(request),hit,inFlightMerged:false,inferenceExecuted:!hit,origin,originalWallMs:100,originalInferenceMs:80,originalServiceWallMs:null,lookupMs:.3});
const build=(entries,options={})=>view.buildLayaReuseReport?.(entries,{manifestId:'batch-a',profile,...options}) ?? {};

test('unique selector inputs do not repeat across Qwen models, legacy duplication and current cache use are separate',()=>{
  const first=entry('model-a',100),oldRepeat=entry('model-b',110),hit=entry('model-c',2,meta(true,{manifestId:'batch-a',recordPath:first.recordPath,recordSha256:first.recordSha256,traceIndex:0}));
  const report=build([first,oldRepeat,hit]);
  assert.equal(report.counts?.cacheHits,1);assert.equal(report.counts?.legacyAttempts,2);assert.equal(report.counts?.legacyRepeatedRequests,1);assert.equal(report.stages?.domain?.uniqueRequests,1);
  assert.equal(report.stages.domain.caseSelection.total,3);assert.equal(report.stages.domain.uniqueSelection.total,1);
  assert.equal(report.stages.domain.firstClientHttp.p50Ms,100);assert.equal(report.stages.domain.accessHttp.totalMs,212);assert.equal(report.stages.domain.lookup.p50Ms,.3);
});

test('different API candidates are distinct request scopes and records remain immutable',()=>{
  const a=entry('a',100),b=entry('b',150);for(const [e,key]of [[a,'current'],[b,'hourly']]){const d=e.record.shadow.decisions[0];d.stage='intent';d.candidateIds=[`weather.${key}.temperature`];d.laya.trace.request={...request,questions:{api:{type:'choice',criteria:{c0:key}}}};}
  const copy=structuredClone([a,b]),report=build([a,b]);assert.equal(report.stages?.api?.uniqueRequests,2);assert.deepEqual([a,b],copy);
});

test('unknown cache versions and wrong request hashes are rejected instead of counted as fresh inference',()=>{
  const a=entry('a',2,{...meta(true,{}),version:'future'}),b=entry('b',2,{...meta(false,{}),requestSha256:'0'.repeat(64)});
  const report=build([a,b]);assert.equal(report.counts?.invalidMetadata,2);assert.equal(report.counts?.cacheHits,0);assert.equal(report.counts?.newInferences,0);assert.equal(report.stages?.domain?.uniqueRequests,0);
});

test('service origins prove first native inference without relabeling server wall as client HTTP',()=>{
  const service={recordPath:'/cache/first.service.json',recordSha256:sha('service'),record:{version:'laya-benchmark-reuse-v1',namespace:'batch-a',profile,request,requestSha256:sha(request),responseRaw:'{}',serviceWallMs:90,inferenceMs:80,observedAt:'2026-10-13T01:00:00Z'}};
  const hit=entry('hit',2,meta(true,{type:'service_inference',namespace:'batch-a',serviceRecordPath:service.recordPath,serviceRecordSha256:service.recordSha256}));
  const report=build([hit],{serviceRecords:[service]});assert.equal(report.stages?.domain?.firstClientHttp?.p50Ms,null);assert.equal(report.stages?.domain?.firstNativeInference?.p50Ms,80);assert.equal(report.stages?.domain?.firstServerRequest?.p50Ms,90);
  const invalid=build([hit]);assert.equal(invalid.counts?.unverifiedOrigins,1);assert.equal(invalid.stages?.domain?.firstNativeInference?.p50Ms,null);
});

test('standalone HTML states metric boundaries policy change and safe return link without fabricated missing times',()=>{
  const report=build([entry('a',100)],{transition:{at:'2026-10-13T03:00:00Z',policy:'exact-native-request-v1'},profile});
  const html=view.renderLayaReuseHtml?.({...report,manifestId:'<script>bad</script>'}) || '';
  assert.match(html,/原评测页.*HTTP 访问/);assert.match(html,/领域.*1000/);assert.match(html,/API.*Qwen.*候选/);assert.match(html,/首次模型/);assert.match(html,/政策切换/);assert.match(html,/CPU.*竞争/);assert.match(html,/href="\/#evaluation"/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|Laya 完整流程成功率[： ]*100%/);
});

test('malformed origin data stays unverified instead of crashing or borrowing lookup time',()=>{
  const first=entry('hit',2,meta(true,{type:'service_inference',serviceRecordPath:'/cache/bad.service.json',serviceRecordSha256:sha('bad')}));
  const report=build([first],{serviceRecords:[{recordPath:'/cache/bad.service.json',recordSha256:sha('bad'),record:{version:'laya-benchmark-reuse-v1',namespace:'batch-a',requestSha256:sha(request)}}]});
  assert.equal(report.counts?.unverifiedOrigins,1);assert.equal(report.stages.domain.firstNativeInference.p50Ms,null);
});

test('offline CLI projection reads frozen layaShadow health and writes only separate sidecar files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'laya-reuse-report-test-'));assert.equal(dirname(root),resolve(tmpdir()));assert.match(basename(root),/^laya-reuse-report-test-/);
  try{
    const id='batch-a',manifestPath=`data/runtime/single-service-100/${id}/manifest.json`,evidenceRoot=`evidence/single-service-100/${id}`;
    for(const directory of ['data/runtime',dirname(manifestPath),evidenceRoot+'/qwen2.5-0.5b','public'])await mkdir(join(root,directory),{recursive:true});
    await writeFile(join(root,'data/runtime/single-service-100-active.json'),JSON.stringify({id,manifestPath,evidenceRoot}));
    await writeFile(join(root,manifestPath),JSON.stringify({id,conditions:{models:['qwen2.5:0.5b'],layaShadow:{observedStatus:{modelRevision:profile.modelRevision,version:profile.layaVersion,threads:8}}},corpus:{total:1000}}));
    const record=entry('test',100).record;record.model='qwen2.5:0.5b';await writeFile(join(root,evidenceRoot,'qwen2.5-0.5b/e100-device-001.json'),JSON.stringify(record));
    await writeFile(join(root,'public/index.html'),'frozen-main');
    const report=await generateLayaReuseReport({root,outputDirectory:join(root,'public')});assert.equal(report.stages.domain.uniqueRequests,1);
    assert.equal(await readFile(join(root,'public/index.html'),'utf8'),'frozen-main');assert.match(await readFile(join(root,'public/laya-reuse.html'),'utf8'),/返回千题结果/);
  }finally{await rm(root,{recursive:true,force:true});}
});
