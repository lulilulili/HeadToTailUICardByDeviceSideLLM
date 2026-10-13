import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {loadLocalEnvironment} from '../src/configuration.mjs';

test('local .env is optional and never returns or prints secret values',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'edge-config-'));
 try{
  const env={PORT:'3211'};assert.deepEqual(await loadLocalEnvironment(directory,{env}),{loaded:false,keys:[]});
  await writeFile(join(directory,'.env'),'TYPESAFE_API_KEY="test-not-real-key"\nJEV_MODEL=jev-latest\nPORT=3210\n');
  const result=await loadLocalEnvironment(directory,{env});assert.equal(env.TYPESAFE_API_KEY,'test-not-real-key');assert.equal(env.PORT,'3211');assert.equal(env.JEV_MODEL,'jev-latest');
  assert.deepEqual(result,{loaded:true,keys:['JEV_MODEL','PORT','TYPESAFE_API_KEY']});assert.ok(!JSON.stringify(result).includes('test-not-real-key'));
 }finally{assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith('edge-config-'));await rm(directory,{recursive:true,force:true});}
});
