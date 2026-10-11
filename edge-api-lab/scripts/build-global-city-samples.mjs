import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {dirname,join,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

export const VERSION='global-chinese-city-samples-v1';
export const DEFAULT_SEED='global-chinese-city-feasibility-2026-10-11-v1';
export const CONTINENTS=['AF','AS','EU','NA','OC','SA'];
const root=dirname(dirname(fileURLToPath(import.meta.url))),run=promisify(execFile);
const base='https://download.geonames.org/export/dump/';
const hash=value=>createHash('sha256').update(value).digest('hex');
const priority=(seed,group,id)=>hash(JSON.stringify([seed,group,String(id)]));
const chineseDisplay=name=>typeof name==='string'&&name===name.trim()&&name.length>=2&&name.length<=60&&/^[\p{Script=Han}·．・ \-—（）()]+$/u.test(name);
const compare=(a,b)=>a.rank<b.rank?-1:a.rank>b.rank?1:a.row.geonameId-b.row.geonameId;
// Avoid a huge split-line array and do not retain a giant text backing store in a small field.
function* sourceLines(text){let start=0;while(start<text.length){const end=text.indexOf('\n',start);if(end<0){yield text.slice(start).replace(/\r$/,'');return;}yield text.slice(start,end).replace(/\r$/,'');start=end+1;}}
const ownText=value=>Buffer.from(value??'','utf8').toString('utf8');

/** Only inflate a single named TXT member; no filesystem extraction or path traversal. */
export function zipTextMember(buffer,preferred){
 let end=-1;for(let index=buffer.length-22;index>=Math.max(0,buffer.length-65557);index--)if(buffer.readUInt32LE(index)===0x06054b50){end=index;break;}
 if(end<0)throw new Error('Invalid ZIP end record');
 const count=buffer.readUInt16LE(end+10);let offset=buffer.readUInt32LE(end+16),fallback;
 for(let index=0;index<count;index++){
  if(buffer.readUInt32LE(offset)!==0x02014b50)throw new Error('Invalid ZIP central entry');
  const nameLength=buffer.readUInt16LE(offset+28),extraLength=buffer.readUInt16LE(offset+30),commentLength=buffer.readUInt16LE(offset+32);
  const name=buffer.subarray(offset+46,offset+46+nameLength).toString('utf8');
  const entry={name,method:buffer.readUInt16LE(offset+10),compressed:buffer.readUInt32LE(offset+20),size:buffer.readUInt32LE(offset+24),local:buffer.readUInt32LE(offset+42)};
  if(name===preferred)fallback=entry;
  else if(!fallback&&name.endsWith('.txt'))fallback=entry;
  offset+=46+nameLength+extraLength+commentLength;
 }
 if(!fallback)throw new Error('ZIP does not contain a TXT member');
 const entry=fallback,local=entry.local;if(buffer.readUInt32LE(local)!==0x04034b50)throw new Error('Invalid ZIP local entry');
 const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28),compressed=buffer.subarray(start,start+entry.compressed);
 const bytes=entry.method===8?inflateRawSync(compressed):entry.method===0?compressed:null;
 if(!bytes||bytes.length!==entry.size)throw new Error('Unsupported or damaged ZIP member');
 return {name:entry.name,bytes,text:bytes.toString('utf8')};
}
export function parseCountries(text){
 return new Map(text.split(/\r?\n/).filter(line=>line&&!line.startsWith('#')).map(line=>{const fields=line.split('\t');return [fields[0],{name:fields[4],continent:fields[8]}];}));
}
export function parseCities(text,countries){
 const rows=[];let sourceRows=0;
 for(const line of sourceLines(text)){
  if(!line)continue;sourceRows++;const fields=line.split('\t'),country=countries.get(fields[8]);
  const population=Number(fields[14]),latitude=Number(fields[4]),longitude=Number(fields[5]);
  if(!CONTINENTS.includes(country?.continent)||fields[6]!=='P'||!/^PPL(?:A[1-4]?|C)?$/.test(fields[7])||!Number.isInteger(population)||population<=0||!Number.isFinite(latitude)||Math.abs(latitude)>90||!Number.isFinite(longitude)||Math.abs(longitude)>180)continue;
  const names=[fields[1],...(fields[3]??'').split(',')].filter(chineseDisplay);
  if(!names.length)continue; // Candidate prefilter, NOT a Chinese-language claim.
  rows.push({geonameId:Number(fields[0]),canonicalName:ownText(fields[1]),asciiName:ownText(fields[2]),hanAliases:[...new Set(names)].map(ownText),latitude,longitude,countryCode:ownText(fields[8]),countryName:country.name,continent:country.continent,population,featureCode:ownText(fields[7]),timezone:ownText(fields[17]),modificationDate:ownText(fields[18])});
 }
 return {rows,sourceRows};
}
export function parseChineseAlternates(text){
 const names=new Map();
 for(const line of sourceLines(text)){
  const fields=line.split('\t');
  if(!/^zh(?:-|$)/i.test(fields[2]??'')||!chineseDisplay(fields[3])||fields[7]==='1')continue;
  const entry={alternateNameId:Number(fields[0]),geonameId:Number(fields[1]),language:ownText(fields[2]),name:ownText(fields[3]),preferred:fields[4]==='1',short:fields[5]==='1',colloquial:fields[6]==='1',historic:false};
  if(!Number.isInteger(entry.geonameId))continue;if(!names.has(entry.geonameId))names.set(entry.geonameId,[]);names.get(entry.geonameId).push(entry);
 }
 return names;
}
function chosenName(aliases,seed,id){
 const languageRank=language=>/^zh-(?:CN|Hans)$/i.test(language)?0:language==='zh'?1:2;
 return [...aliases].sort((a,b)=>Number(b.preferred)-Number(a.preferred)||languageRank(a.language)-languageRank(b.language)||priority(seed,`name/${id}`,a.alternateNameId).localeCompare(priority(seed,`name/${id}`,b.alternateNameId)))[0];
}
/** Lazy country downloads follow random order, never extraction/model success. */
export async function selectChineseSamples(rows,getChineseNames,{seed=DEFAULT_SEED}={}){
 const samples=[],used=new Set(),attempts=[],strata=[];
 const lowQuotas=[6,6,5,5,5,5];
 for(const kind of ['low_population','continent_supplement'])for(const [index,continent]of CONTINENTS.entries()){
  const quota=kind==='low_population'?lowQuotas[index]:10-lowQuotas[index],group=`${kind}/${continent}`;
  const eligible=rows.filter(row=>row.continent===continent&&(kind!=='low_population'||row.population<50000));
  const pool=eligible.map(row=>({row,rank:priority(seed,group,row.geonameId)})).sort(compare);let selected=0,rejected=0;
  for(const {row,rank}of pool){
   if(used.has(row.geonameId))continue;
   const aliases=await getChineseNames(row.countryCode,row.geonameId);attempts.push({geonameId:row.geonameId,countryCode:row.countryCode,stratum:group,hasVerifiedChineseName:aliases.length>0});
   if(!aliases.length){rejected++;continue;}const alias=chosenName(aliases,seed,row.geonameId);
   used.add(row.geonameId);selected++;
   samples.push({id:`geonames-${row.geonameId}`,name:alias.name,canonicalName:row.canonicalName,asciiName:row.asciiName,nameSourceField:'alternateNames.alternateName',nameLanguage:alias.language,languageTagVerified:true,
    alternateNameId:alias.alternateNameId,namePreferred:alias.preferred,nameHistoric:false,nameAlsoInCities500:row.hanAliases.includes(alias.name),countryCode:row.countryCode,countryName:row.countryName,continent:row.continent,population:row.population,
    latitude:row.latitude,longitude:row.longitude,timezone:row.timezone,featureCode:row.featureCode,geonameId:row.geonameId,sourceModificationDate:row.modificationDate,sourceURL:`https://www.geonames.org/${row.geonameId}`,
    stratum:group,randomPriority:rank,lowPopulation:row.population<50000,smallPopulation:row.population<5000});
   if(selected===quota)break;
  }
  if(selected!==quota)throw new Error(`${group}: only ${selected}/${quota} verified Chinese names; refusing invented or untagged fallback`);
  strata.push({id:group,quota,selected,hanCandidatePool:pool.length,rejectedForNoCurrentZhName:rejected});
 }
 // Precommit eight LOW-population live samples: one per continent, then two random extras.
 const livePool=samples.filter(sample=>sample.stratum.startsWith('low_population/'));
 const live=[];
 for(const continent of CONTINENTS)live.push([...livePool.filter(sample=>sample.continent===continent)].sort((a,b)=>priority(seed,`live/${continent}`,a.id).localeCompare(priority(seed,`live/${continent}`,b.id)))[0].id);
 live.push(...livePool.filter(sample=>!live.includes(sample.id)).sort((a,b)=>priority(seed,'live/extra',a.id).localeCompare(priority(seed,'live/extra',b.id))).slice(0,2).map(sample=>sample.id));
 return {samples,strata,attempts,selectLiveIds:live};
}
async function cachedResource(cacheDirectory,file,url){
 const path=join(cacheDirectory,file);let bytes;
 try{bytes=await readFile(path);if(!bytes.length)bytes=null;}catch(error){if(error.code!=='ENOENT')throw error;}
 if(!bytes){
  console.log(`Downloading official source: ${url}`);await mkdir(cacheDirectory,{recursive:true});
  await run('curl.exe',['--fail','--location','--silent','--show-error','--ipv4','--connect-timeout','15','--max-time','120','--retry','1','--dump-header',`${path}.headers.txt`,'--output',`${path}.download.tmp`,url],{maxBuffer:2**20});
  await rename(`${path}.download.tmp`,path);bytes=await readFile(path);
 }
 let headers='';for(const candidate of [`${path}.headers.txt`,join(cacheDirectory,file.replace(/\.[^.]+$/,'.headers.txt'))])try{headers=await readFile(candidate,'utf8');if(headers)break;}catch(error){if(error.code!=='ENOENT')throw error;}
 const info=await stat(path);
 return {bytes,metadata:{url,cachePath:relative(root,path).replaceAll('\\','/'),downloadedAt:info.mtime.toISOString(),serverLastModified:headers.match(/^Last-Modified:\s*(.+)$/im)?.[1]?.trim()??null,sha256:hash(bytes),bytes:bytes.length}};
}
export async function generateGlobalCitySamples({cacheDirectory=join(root,'data','runtime','geonames-global'),outputPath=join(root,'data','global-city-samples.json'),seed=DEFAULT_SEED}={}){
 const sources=[];
 let archive=await cachedResource(cacheDirectory,'cities500.zip',`${base}cities500.zip`),cities=zipTextMember(archive.bytes,'cities500.txt');
 const countries=await cachedResource(cacheDirectory,'countryInfo.txt',`${base}countryInfo.txt`),readme=await cachedResource(cacheDirectory,'readme.txt',`${base}readme.txt`);
 sources.push({...archive.metadata,member:cities.name,memberSha256:hash(cities.bytes),memberBytes:cities.bytes.length},countries.metadata,readme.metadata);
 const parsed=parseCities(cities.text,parseCountries(countries.bytes.toString('utf8'))),countryMaps=new Map();
 archive=null;cities=null; // Country ZIPs are read one at a time; the global source is no longer needed.
 console.log(`GeoNames snapshot: ${parsed.sourceRows} source rows; ${parsed.rows.length} Han-name candidates before zh verification`);
 const selected=await selectChineseSamples(parsed.rows,async(countryCode,id)=>{
  if(!countryMaps.has(countryCode)){
   const source=await cachedResource(cacheDirectory,`alternatenames-${countryCode}.zip`,`${base}alternatenames/${countryCode}.zip`),member=zipTextMember(source.bytes,`${countryCode}.txt`);
   sources.push({...source.metadata,member:member.name,memberSha256:hash(member.bytes),memberBytes:member.bytes.length});countryMaps.set(countryCode,parseChineseAlternates(member.text));
  }
  return countryMaps.get(countryCode).get(id)??[];
 },{seed});
 const document={version:VERSION,provenance:{publisher:'GeoNames',sourceURL:base,readmeURL:`${base}readme.txt`,alternateNamesDirectoryURL:`${base}alternatenames/`,license:'CC BY 4.0',licenseURL:'https://creativecommons.org/licenses/by/4.0/',generatedAt:new Date().toISOString(),sources,
  nameVerification:'Every display name is copied verbatim from a GeoNames alternate-name record whose isolanguage is zh or zh-*. Historic names are excluded. Untagged Han aliases only prefilter candidates; they never become final names.',
  geospatialVerification:'geonameId joins cities500 coordinates/population to country-scoped alternate-name records. Continent is the GeoNames countryInfo country classification, not a coordinate/polygon inference.',
  limitations:['GeoNames is community data supplied as-is; language tags and population figures may contain errors or be stale. A zh tag is source evidence, not an authoritative official Chinese transliteration standard.','cities500 includes populated places and administrative seats, not a legal definition of city.','No Wikidata verification was used: its SPARQL endpoint was unreachable here. No manual translation or inferred language fallback.']},
  sampling:{seed,method:'SHA256(seed, stratum, geonameId) priority sampling without replacement. 32 positive-population places below 50,000, then 28 continent supplements; six continents have ten samples each.',languageScope:'Chinese only, including source-attested overseas Chinese names; no multilingual-language capability claim.',reproducibleGivenSourceHashes:true,
   eligibility:'PPL/PPLA/PPLA1-4/PPLC; positive recorded population, valid WGS84 coordinates; Han-only name candidate in cities500 and a current zh/zh-* alternate-name record.',
   selectionBias:'Not uniform over all world cities or countries. Geography quotas, the positive-population cities500 subset, and availability of source-tagged Chinese/Han names condition the pool. Population <50,000 is a cold-place proxy, not measured familiarity.',
   sourceRows:parsed.sourceRows,hanCandidateRows:parsed.rows.length,strata:selected.strata,attemptedCandidateCount:selected.attempts.length,attemptsSha256:hash(JSON.stringify(selected.attempts)),selectLiveIds:selected.selectLiveIds,
   liveSelectionMethod:'Selected before any grounding/model test: seed-ranked one low-population city per inhabited continent plus two seed-ranked extra low-population cities. Eight IDs are fixed for 4-model / 32-call evidence.',
   runtimeUse:false,modelCalls:0},samples:selected.samples};
 await mkdir(dirname(outputPath),{recursive:true});await writeFile(outputPath,JSON.stringify(document,null,2)+'\n','utf8');
 await writeFile(join(cacheDirectory,'sampling-attempts.json'),JSON.stringify({seed,attempts:selected.attempts},null,2)+'\n','utf8');
 console.log(JSON.stringify({outputPath,samples:document.samples.length,lowPopulation:document.samples.filter(sample=>sample.lowPopulation).length,continents:Object.fromEntries(CONTINENTS.map(code=>[code,document.samples.filter(sample=>sample.continent===code).length])),selectLiveIds:document.sampling.selectLiveIds,sourceFiles:sources.length},null,2));
 return document;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};for(let index=2;index<process.argv.length;index++){const flag=process.argv[index];if(!['--cache','--output','--seed'].includes(flag)||!process.argv[index+1])throw new Error('Usage: node scripts/build-global-city-samples.mjs [--cache D-path] [--output path] [--seed value]');options[flag==='--cache'?'cacheDirectory':flag==='--output'?'outputPath':'seed']=process.argv[++index];}
 try{await generateGlobalCitySamples(options);}catch(error){console.error(error.message);process.exitCode=1;}
}
