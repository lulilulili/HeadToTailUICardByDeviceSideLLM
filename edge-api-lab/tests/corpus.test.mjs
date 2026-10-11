import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadCases} from '../src/corpus.mjs';
import {testDomains,suite} from '../src/domain-report.mjs';

test('combined corpus preserves 178 old cases and adds 50 per test domain with unique IDs',async()=>{
 const cases=await loadCases(fileURLToPath(new URL('..',import.meta.url)));
 assert.equal(cases.length,1578);assert.equal(new Set(cases.map(item=>item.id)).size,1578);
 const expanded=cases.filter(item=>item.suite==='single-service-100-v1');assert.equal(expanded.length,1000);
 for(const domain of ['weather','calendar','contacts','files','services','cloud','device','connectivity','location','media'])assert.equal(expanded.filter(item=>item.testDomain===domain).length,100);
 const single=cases.filter(item=>item.suite==='single-service-v1');assert.equal(single.length,100);
 for(const domain of ['weather','calendar','contacts','files','services','cloud','device','connectivity','location','media'])assert.equal(single.filter(item=>item.testDomain===domain).length,10);
 const added=cases.filter(item=>item.suite===suite);assert.equal(added.length,300);
 for(const domain of testDomains)assert.equal(added.filter(item=>item.testDomain===domain).length,50);
 assert.ok(added.some(item=>item.expected.domain==='unsupported'&&testDomains.includes(item.testDomain)));
});
