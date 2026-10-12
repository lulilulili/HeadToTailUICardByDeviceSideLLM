import { isDeepStrictEqual } from 'node:util';

function matchesAnnotated(expected, actual) {
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length===actual.length && expected.every((item,index)=>matchesAnnotated(item,actual[index]));
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    return actual != null && Object.entries(expected).every(([key,value]) => matchesAnnotated(value,actual[key]));
  }
  return isDeepStrictEqual(expected,actual);
}

export function scoreCase(expected, actual) {
  const failed=actual.status==='error';
  const score={
    domain:!failed&&expected.domain===actual.domain,
    api:!failed&&(expected.api??null)===(actual.api??null),
    arguments:!failed&&isDeepStrictEqual(expected.arguments??{},actual.extractedArguments??{}),
    status:!failed&&expected.status===actual.status,
    sources:!failed&&Object.entries(expected.sources??{}).every(([key,value])=>actual.resolved?.sources?.[key]===value),
    resolution:!failed&&matchesAnnotated(expected.resolution??{},actual.resolved?.resolution??{}),
  };
  score.plan=Object.values(score).every(Boolean);
  return score;
}

function quantile(values,p) {
  if(!values.length) return null;
  const sorted=[...values].sort((a,b)=>a-b), index=(sorted.length-1)*p;
  const lower=Math.floor(index), fraction=index-lower;
  return Math.round((sorted[lower]+((sorted[lower+1]??sorted[lower])-sorted[lower])*fraction)*100)/100;
}

export function summarize(results) {
  const groups=Map.groupBy(results,row=>row.model);
  return [...groups].map(([model,rows])=>{
    const total=rows.length;
    const rate=key=>rows.filter(row=>row.score[key]).length/total;
    const durations=rows.map(row=>row.run?.totalMs).filter(Number.isFinite);
    const calls=rows.flatMap(row=>row.run?.traces??[]);
    return {model,total,domainAccuracy:rate('domain'),apiAccuracy:rate('api'),argumentAccuracy:rate('arguments'),statusAccuracy:rate('status'),planAccuracy:rate('plan'),p50Ms:quantile(durations,0.5),p95Ms:quantile(durations,0.95),errorCount:rows.filter(row=>row.run?.status==='error').length,callCount:calls.length,meanLoadMs:calls.length?calls.reduce((sum,t)=>sum+(t.loadMs??0),0)/calls.length:0};
  });
}
