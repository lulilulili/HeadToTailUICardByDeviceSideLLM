import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {buildLayaIndependentReport,renderLayaIndependentHtml} from '../src/laya-independent-report.mjs';

const profile={modelRevision:'r1',layaVersion:'0.4.6',threads:8};
const manifest=(status='running',total=3)=>({id:'independent-1',status,progress:{done:total,total},conditions:{model:'multilingual',profile},environment:{cpu:'测试CPU'},storage:{rawDirectory:'evidence/laya-independent/independent-1/raw'}});
const trace=(stage,{hit=false,verified=true,native=5,source=9,wall=10}={})=>({stage,provider:'laya',httpCalls:hit?0:1,wallMs:wall,inferenceMs:hit?0:native,request:{state:{text:'用户原文'},questions:{[stage]:{type:'choice'}}},raw:'{"answers":{}}',independentReuse:{version:'laya-independent-replay-v1',hit,verified,sourceInferenceMs:hit?source:native,sourcePath:'evidence/source.json',sourceSha256:'abc',lookupMs:hit?.2:0,profile}});
const record=(id,score,traces)=>({version:'laya-independent-record-v1',manifestId:'independent-1',caseId:id,testDomain:id.split('-')[0],text:'用户原文',expected:{domain:'weather',api:'weather.current.temperature'},selection:{domain:'weather',api:'weather.current.temperature',status:'selected',totalMs:25,candidates:{domain:{ids:['weather','unsupported']},intent:{ids:['weather.current.temperature','unsupported']}},traces},score,createdAt:'2026-10-14T01:00:00Z'});
const correct={domain:true,api:true,joint:true,expectedInCandidates:true,candidateRecallEligible:true,domainGateMiss:false,retrievalMiss:false,candidateChoiceMiss:false,providerError:false,errorCategory:null};

test('partial completion uses saved unique cases, never pending cases as wrong',()=>{
 const r=buildLayaIndependentReport(manifest('completed'),[record('weather-1',correct,[trace('domain'),trace('intent')])]);
 assert.equal(r.status,'partial');assert.deepEqual(r.progress,{done:1,total:3});
 assert.deepEqual(r.metrics.domain,{correct:1,total:1,accuracy:1});assert.equal(r.metrics.apiReachable.total,1);
});
test('domain gate, budget miss and within-candidate failure remain distinct',()=>{
 const records=[record('weather-1',correct,[trace('domain'),trace('intent')]),record('calendar-1',{...correct,domain:false,api:false,joint:false,expectedInCandidates:false,candidateRecallEligible:false,domainGateMiss:true,errorCategory:'domain_gate'},[trace('domain'),trace('intent')]),record('cloud-1',{...correct,api:false,joint:false,expectedInCandidates:false,retrievalMiss:true,errorCategory:'retrieval_miss'},[trace('domain'),trace('intent')])];
 const r=buildLayaIndependentReport(manifest('completed'),records);
 assert.equal(r.status,'completed');assert.equal(r.metrics.api.total,3);assert.equal(r.metrics.apiReachable.total,1);
 assert.equal(r.errors.find(x=>x.code==='domain_gate').count,1);assert.equal(r.errors.find(x=>x.code==='retrieval_miss').count,1);
 assert.equal(r.cells.length,3);assert.equal(r.cases[1].candidates.intent.ids[0],'weather.current.temperature');
});
test('cache HTTP, historical source inference and fresh inference have different samples',()=>{
 const records=[record('weather-1',correct,[trace('domain',{native:5,wall:10}),trace('intent',{native:7,wall:12})]),record('weather-2',correct,[trace('domain',{hit:true,source:9,wall:.6}),trace('intent',{hit:true,source:11,wall:.7})])];
 const r=buildLayaIndependentReport(manifest('completed',2),records),d=r.timing.stages.find(s=>s.stage==='domain');
 assert.equal(d.access.samples,2);assert.equal(d.http.samples,1);assert.equal(d.currentNative.samples,1);assert.equal(d.currentNative.totalMs,5);
 assert.equal(d.historicalSource.samples,1);assert.equal(d.historicalSource.totalMs,9);
 assert.equal(r.timing.requests.mixedSources.totalMs,32);assert.equal(r.timing.requests.currentFreshNative.samples,1);
 assert.equal(r.reuse.verifiedHits,2);assert.equal(r.reuse.fresh,2);
});
test('client-side reuse has zero current HTTP calls; historical network timings stay separate',()=>{
 const cached=trace('domain',{hit:true,wall:.5,source:10});cached.independentReuse.sourceHttpMs=12;cached.independentReuse.sourceServiceMs=11;
 const r=buildLayaIndependentReport(manifest('completed',1),[record('weather-1',correct,[cached])]),stage=r.timing.stages[0];
 assert.equal(stage.calls,1);assert.equal(stage.httpCalls,0);assert.equal(stage.access.p50Ms,.5);
 assert.equal(stage.http.samples,0);assert.equal(stage.historicalSourceHttp.p50Ms,12);assert.equal(stage.historicalSourceService.p50Ms,11);
 const html=renderLayaIndependentHtml(r);assert.match(html,/本次选择访问/);assert.match(html,/本轮实际HTTP/);assert.match(html,/历史来源HTTP/);
});
test('unverified and unknown-version cache origins do not become native model latency',()=>{
 const invalid=trace('domain',{hit:true,verified:false,wall:1}),unknown=trace('intent',{hit:true,source:99,wall:1});unknown.independentReuse.version='future-version';
 const r=buildLayaIndependentReport(manifest('completed',1),[record('weather-1',correct,[invalid,unknown])]);
 assert.equal(r.timing.requests.mixedSources.samples,0);assert.equal(r.timing.requests.mixedSources.totalMs,null);
 assert.equal(r.timing.stages[0].currentNative.samples,0);assert.equal(r.timing.stages[0].historicalSource.samples,0);
 assert.equal(r.reuse.unverifiedHits,1);assert.equal(r.reuse.unknownMetadata,1);
});
test('unknown timing is unknown; cancelled reports retain terminal status',()=>{
 const t=trace('domain');t.wallMs=null;t.inferenceMs=null;t.independentReuse.sourceInferenceMs=null;
 const r0=record('weather-1',correct,[t]);r0.selection.totalMs=null;
 const r=buildLayaIndependentReport(manifest('cancelled',1),[r0]);
 assert.equal(r.status,'cancelled');assert.equal(r.timing.requests.wall.p50Ms,null);assert.equal(r.timing.requests.mixedSources.samples,0);
});
test('foreign or duplicate formal records cannot silently inflate denominator',()=>{
 const r=record('weather-1',correct,[trace('domain')]);
 assert.throws(()=>buildLayaIndependentReport(manifest(),[r,r]),/duplicate/i);
 assert.throws(()=>buildLayaIndependentReport(manifest(),[{...r,manifestId:'foreign'}]),/ownership/i);
});
test('empty report renders pending state without fake accuracy or completed label',()=>{
 const r=buildLayaIndependentReport(manifest('planned'),[]),html=renderLayaIndependentHtml(r);
 assert.equal(r.metrics.domain.accuracy,null);assert.match(html,/待启动/);assert.match(html,/0 \/ 3/);assert.doesNotMatch(html,/100\.0%/);
});
test('standalone page explains scope, safely embeds raw inputs and has discoverable paging',()=>{
 const r0=record('weather-1',correct,[trace('domain'),trace('intent')]);r0.text='</script><img src=x onerror=alert(1)>';
 const r=buildLayaIndependentReport(manifest(),[r0]),html=renderLayaIndependentHtml(r);
 assert.match(html,/纯选择/);assert.match(html,/不是本轮完整冷推理实测/);assert.match(html,/历史来源/);assert.match(html,/环境/);
 assert.match(html,/index\.html#evaluation/);assert.match(html,/laya-independent\.json/);assert.match(html,/上一页/);assert.match(html,/下一页/);
 assert.doesNotMatch(html,/<img src=x onerror=/);assert.match(html,/\\u003c\/script/);
 assert.match(html,/候选/);assert.match(html,/原始/);assert.match(html,/sourceSha256/);
});
test('page filters reset paging and do not render a thousand disclosures at once',()=>{
 const records=Array.from({length:45},(_,i)=>record(`${i<23?'weather':'calendar'}-${i}`,correct,[trace('domain'),trace('intent')]));
 const report=buildLayaIndependentReport(manifest('completed',45),records),html=renderLayaIndependentHtml(report);
 const elements=Object.fromEntries(['report-data','domain-filter','case-search','result-filter','case-list','previous','next','page-info'].map(id=>[id,{value:'',textContent:id==='report-data'?JSON.stringify(report):'',innerHTML:'',listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}}]));
 const script=[...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];
 runInNewContext(script,{document:{getElementById:id=>elements[id]}});
 assert.equal((elements['case-list'].innerHTML.match(/<article/g)??[]).length,20);assert.match(elements['page-info'].textContent,/1 \/ 3/);
 elements.next.listeners.click();assert.match(elements['page-info'].textContent,/2 \/ 3/);
 elements['domain-filter'].value='calendar';elements['domain-filter'].listeners.input();assert.match(elements['page-info'].textContent,/1 \/ 2/);
 assert.doesNotMatch(elements['case-list'].innerHTML,/<strong>weather-/);
 elements['case-search'].value='calendar-34';elements['case-search'].listeners.input();assert.match(elements['page-info'].textContent,/1 \/ 1/);assert.match(elements['case-list'].innerHTML,/<strong>calendar-34/);
});
test('independent result is discoverable from evaluation and docs without changing existing tabs',async()=>{
 const index=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 for(const id of ['page-evaluation','page-docs']){const section=index.match(new RegExp(`<section id="${id}"[\\s\\S]*?<\\/section>`))[0];assert.match(section,/href="\/laya-independent\.html"/);}
 assert.match(index,/data-evaluation-view="single100"/);
});
