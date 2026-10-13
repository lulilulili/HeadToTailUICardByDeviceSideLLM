import {readFile,writeFile,mkdir,lstat,realpath,link,unlink} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname,basename,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {gzip,gunzip} from 'node:zlib';
import {promisify} from 'node:util';

const compress=promisify(gzip),decompress=promisify(gunzip);
const VERSION='publication-index-gzip-v1';
const check=(valid,message)=>{if(!valid)throw new Error(message);};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const slash=path=>path.replaceAll('\\','/');
const sameBytes=(a,b)=>a.length===b.length&&digest(a)===digest(b);
const relativePath=value=>typeof value==='string'&&value.length>0&&!isAbsolute(value)&&!value.includes('\\')&&!/^[A-Za-z]:/.test(value)&&value.split('/').every(part=>part.length&&part!=='.'&&part!=='..');
const archivePath=value=>relativePath(value)&&/^evidence\/publication-archives\/[A-Za-z0-9][A-Za-z0-9_-]*\/index\.json\.gz$/.test(value);

async function workspace(root){
 check(typeof root==='string'&&root.length>0,'Explicit project root is required');
 const physical=await realpath(resolve(root));check((await lstat(physical)).isDirectory(),'Project root must be a directory');return physical;
}
function inside(root,path){
 check(typeof path==='string'&&path.length>0,'Path must be nonempty');
 const target=resolve(root,path),rel=relative(root,target);
 check(rel&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel),'Path escapes project root');
 return {target,rel:slash(rel)};
}
async function checkComponents(root,target){
 const rel=relative(root,target);check(rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel),'Physical path escapes project root');
 let current=root;
 for(const part of rel.split(sep)){
  current=join(current,part);
  try{const info=await lstat(current);check(!info.isSymbolicLink(),'Symlink path is not allowed: '+current);}
  catch(error){if(error.code==='ENOENT')break;throw error;}
 }
}
async function regularRead(root,path){
 await checkComponents(root,path);const info=await lstat(path);
 check(info.isFile()&&!info.isSymbolicLink(),'Expected a regular project file');
 return readFile(path);
}
async function readIfPresent(root,path){
 try{return await regularRead(root,path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function atomicCreate(root,path,bytes){
 await checkComponents(root,path);await mkdir(dirname(path),{recursive:true});await checkComponents(root,path);
 const existing=await readIfPresent(root,path);
 if(existing!==null){check(sameBytes(existing,bytes),'Existing file has different bytes; refusing overwrite: '+path);return 'already_present';}
 const temporary=path+'.pending-'+randomUUID();await writeFile(temporary,bytes,{flag:'wx'});
 try{
  await checkComponents(root,path);
  try{await link(temporary,path);return 'created';}
  catch(error){if(error.code!=='EEXIST')throw error;const appeared=await regularRead(root,path);check(sameBytes(appeared,bytes),'Existing file has different bytes; refusing overwrite: '+path);return 'already_present';}
 }finally{await unlink(temporary);}
}
function validateMetadata(value){
 check(value&&typeof value==='object'&&!Array.isArray(value),'Invalid metadata object');
 check(value.version===VERSION&&value.encoding==='gzip','Invalid metadata version or encoding');
 check(archivePath(value.archiveRelativePath),'Invalid metadata archive path');
 check(relativePath(value.relativeRestorePath)&&basename(value.relativeRestorePath)==='index.json','Invalid metadata restore path');
 check(!value.relativeRestorePath.startsWith('evidence/publication-archives/'),'Invalid metadata restoration inside archive area');
 for(const key of ['originalBytes','compressedBytes'])check(Number.isSafeInteger(value[key])&&value[key]>=0&&value[key]<2147483647,'Invalid metadata size: '+key);
 for(const key of ['originalSha256','compressedSha256'])check(typeof value[key]==='string'&&/^[a-f0-9]{64}$/.test(value[key]),'Invalid metadata SHA-256: '+key);
 return value;
}

/** Lossless publication packaging only; source index bytes are never changed. */
export async function archiveIndex({root,source,out,metadata:metadataOption}={}){
 root=await workspace(root);
 const originalPath=inside(root,source),archive=inside(root,out);
 check(basename(originalPath.rel)==='index.json','Source must be the original index.json');
 check(!originalPath.rel.startsWith('evidence/publication-archives/'),'Source index cannot be an archive artifact');
 check(archivePath(archive.rel),'Archive output must be evidence/publication-archives/<batch>/index.json.gz');
 const metadata=inside(root,metadataOption??join(dirname(archive.rel),'index.metadata.json'));
 check(metadata.rel===slash(join(dirname(archive.rel),'index.metadata.json')),'Metadata must be beside its publication archive');
 const bytes=await regularRead(root,originalPath.target),compressed=await compress(bytes,{level:9});
 const value=validateMetadata({version:VERSION,encoding:'gzip',archiveRelativePath:archive.rel,relativeRestorePath:originalPath.rel,originalBytes:bytes.length,originalSha256:digest(bytes),compressedBytes:compressed.length,compressedSha256:digest(compressed)});
 const metadataBytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
 const previous=await readIfPresent(root,metadata.target);
 if(previous!==null)check(sameBytes(previous,metadataBytes),'Existing metadata has different bytes; refusing overwrite');
 const status=await atomicCreate(root,archive.target,compressed);await atomicCreate(root,metadata.target,metadataBytes);
 return {status:status==='created'?'archived':'already_archived',metadataPath:metadata.rel,...value};
}

/** Validate all archive bytes before restoring the original native storage path. */
export async function restoreIndex({root,metadata}={}){
 root=await workspace(root);const manifest=inside(root,metadata);
 check(/^evidence\/publication-archives\/[A-Za-z0-9][A-Za-z0-9_-]*\/index\.metadata\.json$/.test(manifest.rel),'Metadata path must be in the publication archive area');
 let value;try{value=JSON.parse(await regularRead(root,manifest.target));}catch(error){if(error instanceof SyntaxError)throw new Error('Invalid archive metadata JSON');throw error;}
 validateMetadata(value);
 check(dirname(manifest.rel)===dirname(value.archiveRelativePath),'Metadata/archive ownership path mismatch');
 const archive=inside(root,value.archiveRelativePath),target=inside(root,value.relativeRestorePath);
 const compressed=await regularRead(root,archive.target);
 check(compressed.length===value.compressedBytes&&digest(compressed)===value.compressedSha256,'Compressed size/SHA-256 fingerprint mismatch');
 let bytes;try{bytes=await decompress(compressed,{maxOutputLength:Math.max(1,value.originalBytes+1)});}catch(error){throw new Error('Gzip decompression validation failed: '+error.message);}
 check(bytes.length===value.originalBytes,'Original byte length mismatch');check(digest(bytes)===value.originalSha256,'Original SHA-256 mismatch');
 const status=await atomicCreate(root,target.target,bytes);
 return {status:status==='created'?'restored':'already_present',relativeRestorePath:value.relativeRestorePath,originalBytes:value.originalBytes,originalSha256:value.originalSha256};
}

export function parseArchiveArguments(args){
 const result={action:args[0],root:undefined,source:undefined,out:undefined,metadata:undefined,help:false};
 if(args.length===1&&args[0]==='--help')return {...result,help:true};
 check(['archive','restore'].includes(result.action),'Choose archive or restore');
 for(let index=1;index<args.length;index++){
  const flag=args[index];check(['--root','--source','--out','--metadata'].includes(flag),'Unknown archive argument: '+flag);
  check(args[index+1]&&!args[index+1].startsWith('--'),flag+' requires a value');
  const key=flag.slice(2);check(result[key]===undefined,'Duplicate archive argument: '+flag);result[key]=args[++index];
 }
 check(result.root,'Explicit --root is required');
 if(result.action==='archive')check(result.source&&result.out,'archive requires --source and --out');
 else check(result.metadata&&!result.source&&!result.out,'restore requires --metadata only');
 return result;
}
async function main(){
 const input=parseArchiveArguments(process.argv.slice(2));
 if(input.help){console.log('archive --root <project> --source <native index.json> --out evidence/publication-archives/<batch>/index.json.gz\nrestore --root <project> --metadata evidence/publication-archives/<batch>/index.metadata.json');return;}
 const result=input.action==='archive'?await archiveIndex(input):await restoreIndex(input);console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
