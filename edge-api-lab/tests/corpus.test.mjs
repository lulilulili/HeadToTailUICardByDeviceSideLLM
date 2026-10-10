import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadCases} from '../src/corpus.mjs';
import {testDomains,suite} from '../src/domain-report.mjs';

test('combined corpus preserves 178 old cases and adds 50 per test domain with unique IDs',async()=>{
 const cases=await loadCases(fileURLToPath(new URL('..',import.meta.url)));
 assert.equal(cases.length,478);assert.equal(new Set(cases.map(item=>item.id)).size,478);
 const added=cases.filter(item=>item.suite===suite);assert.equal(added.length,300);
 for(const domain of testDomains)assert.equal(added.filter(item=>item.testDomain===domain).length,50);
 assert.ok(added.some(item=>item.expected.domain==='unsupported'&&testDomains.includes(item.testDomain)));
});
