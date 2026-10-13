import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildLayaReuseReport,renderLayaReuseHtml} from '../src/laya-reuse-report.mjs';

/** Offline sidecar only: no frozen modules, providers or main-report writes. */
export async function generateLayaReuseReport({root,outputDirectory,transitionPath,cacheDirectory}){
  const pointer=JSON.parse(await readFile(join(root,'data/runtime/single-service-100-active.json'),'utf8'));
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/.test(pointer.id))throw new Error('Invalid active manifest ID');
  const manifestPath=`data/runtime/single-service-100/${pointer.id}/manifest.json`;
  if(pointer.manifestPath!==manifestPath||pointer.evidenceRoot!==`evidence/single-service-100/${pointer.id}`)throw new Error('Active pointer ownership/path mismatch');
  const manifest=JSON.parse(await readFile(join(root,manifestPath),'utf8'));if(manifest.id!==pointer.id)throw new Error('Manifest ownership mismatch');
  let transition=null;if(transitionPath)transition=JSON.parse(await readFile(resolve(transitionPath),'utf8'));
  const health=manifest.conditions?.shadow?.laya ?? manifest.conditions?.shadow?.layaStatus ?? {};
  const profile={namespace:transition?.namespace ?? manifest.id,modelRevision:health.modelRevision,layaVersion:health.version,threads:health.threads};
  const entries=[],serviceRecords=[],readErrors=[];
  const readRecord=async path=>{const raw=await readFile(path,'utf8');return {absolutePath:path,recordPath:relative(root,path).replaceAll('\\','/'),recordSha256:createHash('sha256').update(raw).digest('hex'),record:JSON.parse(raw)};};
  for(const model of manifest.conditions?.models ?? []){
    if(!/^qwen2\.5:(0\.5|1\.5|3|7)b$/.test(model))throw new Error('Unsupported manifest model');
    const directory=join(root,pointer.evidenceRoot,model.replace(':','-'));let files;
    try{files=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')continue;throw error;}
    for(const file of files.filter(file=>file.isFile()&&/^e100-[a-z]+-\d{3}\.json$/.test(file.name)).sort((a,b)=>a.name.localeCompare(b.name))){
      const path=join(directory,file.name);
      try{const entry=await readRecord(path);if(entry.record.manifestId!==manifest.id||entry.record.model!==model)throw new Error('Raw ownership mismatch');entries.push(entry);}catch(error){readErrors.push({path:relative(root,path),error:error.message});}
    }
  }
  async function readServices(directory){
    let files;try{files=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT'){readErrors.push({path:directory,error:'Service ledger missing'});return;}throw error;}
    for(const file of files){const path=join(directory,file.name);if(file.isDirectory())await readServices(path);else if(file.isFile()&&file.name.endsWith('.service.json'))try{serviceRecords.push(await readRecord(path));}catch(error){readErrors.push({path:relative(root,path),error:error.message});}}
  }
  if(cacheDirectory)await readServices(resolve(cacheDirectory));
  const report=buildLayaReuseReport(entries,{manifestId:manifest.id,profile,serviceRecords,transition,plannedDomainCases:manifest.corpus?.total ?? 1000});
  report.readErrors=readErrors;report.source={manifestPath,manifestUpdatedAt:manifest.updatedAt,formalFiles:entries.length,serviceFiles:serviceRecords.length,transitionPath:transitionPath ?? null,cacheDirectory:cacheDirectory ?? null};
  await mkdir(outputDirectory,{recursive:true});
  await writeFile(join(outputDirectory,'laya-reuse.json'),JSON.stringify(report,null,2)+'\n');await writeFile(join(outputDirectory,'laya-reuse.html'),renderLayaReuseHtml(report));
  return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),options={root:dirname(dirname(fileURLToPath(import.meta.url)))};
  for(let i=0;i<args.length;i++){const key={'--root':'root','--output-dir':'outputDirectory','--transition':'transitionPath','--cache-dir':'cacheDirectory'}[args[i]];if(!key||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Use --root/--output-dir/--transition/--cache-dir with an explicit path');options[key]=resolve(args[++i]);}
  options.outputDirectory ??=join(options.root,'public');
  const report=await generateLayaReuseReport(options);console.log(JSON.stringify({manifestId:report.manifestId,formalFiles:report.source.formalFiles,counts:report.counts,outputDirectory:options.outputDirectory}));
}
