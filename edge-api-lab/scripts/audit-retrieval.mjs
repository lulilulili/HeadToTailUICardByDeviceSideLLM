/** Offline coverage audit. Gold labels are never imported by runtime retrieval. */
import {readFile,writeFile} from 'node:fs/promises';
import {capabilities,getCapability} from '../src/registry.mjs';
import {PROMPT_VERSION,selectCandidates,buildIntentPrompt,buildArgumentsPrompt,buildUnifiedPrompt} from '../src/prompts.mjs';

const cases=JSON.parse(await readFile(new URL('../data/cases.json',import.meta.url),'utf8'));
const summary={promptVersion:PROMPT_VERSION,apiCount:capabilities.length,caseCount:cases.length,total:0,stagedHits:0,unifiedHits:0,byDomain:{},maxSystemChars:{intent:0,unified:0,arguments:0}};
const details=[];
for(const item of cases){
  const cap=getCapability(item.expected.api);if(!cap)continue;
  const context=item.context??{};
  const staged=selectCandidates(item.text,item.expected.domain,{limit:6,context}).map(candidate=>candidate.id);
  const unified=selectCandidates(item.text,undefined,{limit:12,context}).map(candidate=>candidate.id);
  const stagedHit=staged.includes(item.expected.api),unifiedHit=unified.includes(item.expected.api);
  summary.total++;summary.stagedHits+=Number(stagedHit);summary.unifiedHits+=Number(unifiedHit);
  const row=summary.byDomain[item.expected.domain]??={total:0,stagedHits:0,unifiedHits:0};
  row.total++;row.stagedHits+=Number(stagedHit);row.unifiedHits+=Number(unifiedHit);
  for(const [stage,prompt] of [['intent',buildIntentPrompt(item.text,item.expected.domain,context)],['unified',buildUnifiedPrompt(item.text,context)],['arguments',buildArgumentsPrompt(item.text,cap)]])summary.maxSystemChars[stage]=Math.max(summary.maxSystemChars[stage],prompt.messages[0].content.length);
  details.push({caseId:item.id,text:item.text,expectedApi:item.expected.api,stagedHit,unifiedHit,staged,unified});
}
const report={purpose:'只审查候选召回，不能当成模型准确率；gold仅本地评分，不送检索或模型',generatedAt:new Date().toISOString(),summary,cases:details};
await writeFile(new URL('../data/retrieval-audit.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(summary));
if(summary.stagedHits!==summary.total||summary.unifiedHits!==summary.total)process.exitCode=1;
