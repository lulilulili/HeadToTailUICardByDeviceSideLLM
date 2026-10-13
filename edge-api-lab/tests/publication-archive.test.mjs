import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import * as publication from '../scripts/publication-archive.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const source='evidence/single-service-100/unit-batch/index.json';
const out='evidence/publication-archives/unit-batch/index.json.gz';
const metadata='evidence/publication-archives/unit-batch/index.metadata.json';
const original=Buffer.from('{\r\n  "中文": "原始字节与换行保留", "rows": [1,2,3]\r\n}\r\n','utf8');
async function fixture(t){
 const base=resolve(tmpdir()),root=await mkdtemp(join(base,'publication-archive-'));
 const rel=relative(base,root);assert.ok(!isAbsolute(rel)&&!rel.startsWith('..')&&rel.startsWith('publication-archive-'));
 t.after(async()=>{const checked=relative(base,resolve(root));assert.ok(!isAbsolute(checked)&&!checked.startsWith('..')&&checked.startsWith('publication-archive-'));await rm(root,{recursive:true,force:true});});
 await mkdir(dirname(join(root,source)),{recursive:true});await writeFile(join(root,source),original);
 return root;
}
async function archive(root){return publication.archiveIndex({root,source,out});}

test('archive preserves original bytes and records original/compressed fingerprints outside batch evidence',async t=>{
 const root=await fixture(t),result=await archive(root),compressed=await readFile(join(root,out)),meta=JSON.parse(await readFile(join(root,metadata),'utf8'));
 assert.deepEqual(await readFile(join(root,source)),original);assert.deepEqual(gunzipSync(compressed),original);
 assert.equal(meta.version,'publication-index-gzip-v1');assert.equal(meta.encoding,'gzip');assert.equal(meta.relativeRestorePath,source);assert.equal(meta.archiveRelativePath,out);
 assert.equal(meta.originalBytes,original.length);assert.equal(meta.originalSha256,digest(original));assert.equal(meta.compressedBytes,compressed.length);assert.equal(meta.compressedSha256,digest(compressed));
 assert.equal(result.metadataPath,metadata);
});

test('restore to missing native path atomically produces exactly the original bytes',async t=>{
 const root=await fixture(t);await archive(root);await rm(join(root,source));
 const result=await publication.restoreIndex({root,metadata});
 assert.equal(result.status,'restored');assert.equal(result.relativeRestorePath,source);assert.deepEqual(await readFile(join(root,source)),original);
});

test('matching native index is skipped and a different existing file is never overwritten',async t=>{
 const root=await fixture(t);await archive(root);
 assert.equal((await publication.restoreIndex({root,metadata})).status,'already_present');
 const changed=Buffer.from('different saved index');await writeFile(join(root,source),changed);
 await assert.rejects(publication.restoreIndex({root,metadata}),/existing.*different|refus.*overwrit/i);
 assert.deepEqual(await readFile(join(root,source)),changed);
});

test('compressed corruption and original fingerprint mismatch fail before any restoration',async t=>{
 const root=await fixture(t);await archive(root);await rm(join(root,source));
 const meta=JSON.parse(await readFile(join(root,metadata),'utf8')),compressed=await readFile(join(root,out));compressed[10]^=255;await writeFile(join(root,out),compressed);
 await assert.rejects(publication.restoreIndex({root,metadata}),/compressed.*SHA|fingerprint/i);
 meta.compressedSha256=digest(compressed);await writeFile(join(root,metadata),JSON.stringify(meta));
 await assert.rejects(publication.restoreIndex({root,metadata}),/gzip|decompress|header|check|invalid|length|SHA/i);
 await assert.rejects(access(join(root,source)));
 await writeFile(join(root,out),gzipSync(original));meta.compressedBytes=(await readFile(join(root,out))).length;meta.compressedSha256=digest(await readFile(join(root,out)));meta.originalSha256='0'.repeat(64);await writeFile(join(root,metadata),JSON.stringify(meta));
 await assert.rejects(publication.restoreIndex({root,metadata}),/original.*SHA/i);await assert.rejects(access(join(root,source)));
});

test('metadata rejects invalid sizes digests encoding ownership and restore paths',async t=>{
 const root=await fixture(t);await archive(root);const meta=JSON.parse(await readFile(join(root,metadata),'utf8'));
 for(const patch of [{version:'unknown'},{encoding:'zip'},{originalBytes:-1},{originalBytes:1.5},{compressedBytes:null},{originalSha256:'wrong'},{relativeRestorePath:'../outside/index.json'},{relativeRestorePath:resolve(root,'index.json')},{archiveRelativePath:'evidence/single-service-100/unit-batch/index.json.gz'}]){
  await writeFile(join(root,metadata),JSON.stringify({...meta,...patch}));await assert.rejects(publication.restoreIndex({root,metadata}),/metadata|path|encoding|version|size|archive/i);
 }
});

test('archive never overwrites another gzip and rejects outputs outside the publication area',async t=>{
 const root=await fixture(t);await archive(root);const saved=await readFile(join(root,out));
 await writeFile(join(root,source),Buffer.from('new index'));
 await assert.rejects(archive(root),/existing.*different|refus.*overwrit/i);assert.deepEqual(await readFile(join(root,out)),saved);
 for(const target of ['../index.json.gz','evidence/single-service-100/unit-batch/index.json.gz','docs/index.json.gz'])await assert.rejects(publication.archiveIndex({root,source,out:target}),/path|publication|archive/i);
});

test('source or restoration through a symlink cannot escape the project',async t=>{
 const root=await fixture(t);await archive(root);const outside=await mkdtemp(join(resolve(tmpdir()),'publication-archive-outside-'));
 t.after(async()=>{const rel=relative(resolve(tmpdir()),resolve(outside));assert.ok(!isAbsolute(rel)&&!rel.startsWith('..')&&rel.startsWith('publication-archive-outside-'));await rm(outside,{recursive:true,force:true});});
 const alias=join(root,'alias');await symlink(outside,alias,'junction');await writeFile(join(outside,'index.json'),original);
 await assert.rejects(publication.archiveIndex({root,source:'alias/index.json',out}),/symlink|physical|escape/i);
 const meta=JSON.parse(await readFile(join(root,metadata),'utf8'));meta.relativeRestorePath='alias/index.json';await writeFile(join(root,metadata),JSON.stringify(meta));
 await assert.rejects(publication.restoreIndex({root,metadata}),/symlink|physical|escape/i);
 assert.deepEqual(await readFile(join(outside,'index.json')),original);
});

test('CLI requires explicit root and action-specific parameters',()=>{
 assert.equal(typeof publication.parseArchiveArguments,'function');
 assert.deepEqual(publication.parseArchiveArguments(['archive','--root','root','--source',source,'--out',out]),{action:'archive',root:'root',source,out,metadata:undefined,help:false});
 assert.equal(publication.parseArchiveArguments(['restore','--root','root','--metadata',metadata]).action,'restore');
 for(const args of [[],['archive','--source',source,'--out',out],['restore','--root','root'],['archive','--root','root','--source',source,'--out','--oops'],['delete','--root','root']])assert.throws(()=>publication.parseArchiveArguments(args));
});
