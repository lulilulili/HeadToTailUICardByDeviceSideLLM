// Same-origin controller: compatible with the server's script-src 'self' policy.
// Node renders without a DOM; the import also keeps this asset in source snapshots.
if(typeof document!=='undefined'&&document.getElementById('report-data')){
const data=JSON.parse(document.getElementById('report-data').textContent),pageSize=20;
let page=0;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const domain=document.getElementById('domain-filter'),search=document.getElementById('case-search'),result=document.getElementById('result-filter'),list=document.getElementById('case-list'),previous=document.getElementById('previous'),next=document.getElementById('next');
const fold=(name,value)=>'<details><summary>'+escape(name)+'</summary><pre>'+escape(JSON.stringify(value,null,2))+'</pre></details>';
function render(){
 const query=search.value.toLowerCase();
 const rows=(data.cases??[]).filter(r=>(!domain.value||r.testDomain===domain.value)&&(!query||(r.text+' '+r.caseId).toLowerCase().includes(query))&&(!result.value||(result.value==='pass')===Boolean(r.score.joint)));
 const pages=Math.max(1,Math.ceil(rows.length/pageSize));
 page=Math.min(page,pages-1);previous.disabled=page===0;next.disabled=page>=pages-1;
 document.getElementById('page-info').textContent=(page+1)+' / '+pages+' 页 · '+rows.length+' 条';
 list.innerHTML=rows.slice(page*pageSize,(page+1)*pageSize).map(r=>'<article class="case"><strong>'+escape(r.caseId)+'</strong> <span class="pill '+(r.score.joint?'pass':'fail')+'">'+(r.score.joint?'联合选择通过':'联合选择未通过')+'</span><p>'+escape(r.text)+'</p><p>领域：'+escape(r.domain??'未知')+' · API：'+escape(r.api??'未知')+' · 本轮整题 '+(typeof r.totalMs==='number'?r.totalMs.toFixed(2)+' ms':'未知')+'</p>'+fold('期待与原始选择评分',{expected:r.expected,score:r.score,status:r.status,error:r.error})+fold('候选范围与请求输入',{candidates:r.candidates,context:r.context,decisions:r.decisions})+fold('两阶段原始响应、计时与来源SHA',{rawPath:r.rawPath,traces:r.traces})+'</article>').join('')||'<p class="muted">当前筛选无已保存结果。</p>';
}
for(const element of[domain,search,result])element.addEventListener('input',()=>{page=0;render();});
previous.addEventListener('click',()=>{page--;render();});
next.addEventListener('click',()=>{page++;render();});
render();
}
