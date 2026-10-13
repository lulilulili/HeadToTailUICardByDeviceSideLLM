import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256,auditEnginePolicy,verifyFrozenSourceBytes,verifySourceBytes} from '../scripts/verify-single-service-100.mjs';

test('only completed current batches may use their own frozen engine after source updates',()=>{
 assert.deepEqual(auditEnginePolicy({version:'single-service-100-batch-v2',status:'completed'}),{legacyFormat:false,useFrozenEngine:true});
 for(const status of ['running','failed','cancelled'])assert.deepEqual(auditEnginePolicy({version:'single-service-100-batch-v2',status}),{legacyFormat:false,useFrozenEngine:false});
 assert.deepEqual(auditEnginePolicy({version:'historical',status:'completed'}),{legacyFormat:true,useFrozenEngine:true});
});
test('completed frozen verification pins snapshot while reporting current changes honestly',()=>{
 const frozen=Buffer.from('frozen baseline'),current=Buffer.from('new implementation'),expected=sha256(frozen);
 assert.deepEqual(verifyFrozenSourceBytes('src/example.mjs',expected,current,frozen),{path:'src/example.mjs',sha256:expected,currentMatches:false,historical:true});
 assert.throws(()=>verifySourceBytes('src/example.mjs',expected,current,frozen),/Current source differs/);
 assert.throws(()=>verifyFrozenSourceBytes('src/example.mjs',expected,current,current),/Frozen snapshot differs/);
});
