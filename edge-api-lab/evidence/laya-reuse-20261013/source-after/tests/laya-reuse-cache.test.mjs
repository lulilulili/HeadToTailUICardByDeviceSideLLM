import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';

test('stdlib Python cache and ASGI regressions run without importing or loading Laya',()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const result=spawnSync(process.env.LAYA_REUSE_TEST_PYTHON??'python',['-B','tests/laya-reuse-cache.test.py'],{cwd:root,encoding:'utf8',timeout:30000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 assert.match(result.stderr,/OK/);
});

test('managed launcher enables only the fixed runtime cache config and wraps the author app',async()=>{
 const source=await readFile(new URL('../integrations/laya/server.py',import.meta.url),'utf8');
 assert.match(source,/from reusable_cache import ReuseMiddleware, load_reuse_from_config/);
 assert.match(source,/laya-reuse-config\.json/);
 assert.match(source,/app = ReuseMiddleware\(app, reuse_cache\)/);
 assert.match(source,/benchmarkReuse/);
});
