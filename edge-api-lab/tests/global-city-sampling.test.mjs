import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CONTINENTS,DEFAULT_SEED,parseCountries,parseCities,parseChineseAlternates,selectChineseSamples} from '../scripts/build-global-city-samples.mjs';

test('untagged Han, Japanese labels, historic Chinese names, and foreign spelling cannot stand in for current Chinese',()=>{
 const text=[
  '1\t100\tja\t同形漢字\t1\t0\t0\t0',
  '2\t100\t\t无标签\t1\t0\t0\t0',
  '3\t100\tzh\t旧中文名\t1\t0\t0\t1',
  '4\t100\tzh\tForeign市\t1\t0\t0\t0',
  '5\t100\tzh\t真实中文名\t1\t0\t0\t0',
  '6\t100\tzh-Hant\t真實中文名\t0\t0\t0\t0'
 ].join('\n');
 const names=parseChineseAlternates(text).get(100);
 assert.deepEqual(names.map(item=>item.alternateNameId),[5,6]);assert.ok(names.every(item=>item.language.startsWith('zh')&&item.historic===false));
});

test('cities500 Han aliases only prefilter locations and population/coordinates come from original columns',()=>{
 const countryFields=['ZZ','','','','Synthetic test country','','','','OC'];
 const countries=parseCountries(`# comment\n${countryFields.join('\t')}\n`);
 const row=['100','Original Name','Original Name','Only Latin,漢字候选','-12.5','178.25','P','PPLA3','ZZ','','','','','','987','','','Pacific/Fiji','2026-10-11'].join('\t');
 const parsed=parseCities(row,countries);assert.equal(parsed.sourceRows,1);assert.equal(parsed.rows.length,1);
 assert.equal(parsed.rows[0].population,987);assert.equal(parsed.rows[0].continent,'OC');assert.equal(parsed.rows[0].latitude,-12.5);assert.equal(parsed.rows[0].longitude,178.25);
 assert.equal(parsed.rows[0].canonicalName,'Original Name');assert.deepEqual(parsed.rows[0].hanAliases,['漢字候选']);assert.equal(Object.hasOwn(parsed.rows[0],'languageTagVerified'),false);
});

function syntheticRows(){
 let id=1;return CONTINENTS.flatMap(continent=>Array.from({length:12},()=>({geonameId:id++,canonicalName:'Synthetic locality (not a geographic fact)',asciiName:'Synthetic',hanAliases:['测试城'],latitude:1,longitude:2,countryCode:'ZZ',countryName:'Synthetic',continent,population:1000,featureCode:'PPL',timezone:'UTC',modificationDate:'2026-10-11'})));
}
const aliases=async(_country,id)=>[{geonameId:id,alternateNameId:id+10000,name:'测试城',language:'zh',preferred:true,historic:false}];
test('seeded selection gives 32 low-population plus 28 supplements, six continents, and eight precommitted live IDs',async()=>{
 const rows=syntheticRows(),first=await selectChineseSamples(rows,aliases),second=await selectChineseSamples([...rows].reverse(),aliases);
 assert.deepEqual(first,second);assert.equal(first.samples.length,60);assert.equal(new Set(first.samples.map(sample=>sample.id)).size,60);
 assert.equal(first.samples.filter(sample=>sample.stratum.startsWith('low_population/')).length,32);assert.equal(first.samples.filter(sample=>sample.stratum.startsWith('continent_supplement/')).length,28);
 for(const continent of CONTINENTS)assert.equal(first.samples.filter(sample=>sample.continent===continent).length,10);
 assert.equal(first.selectLiveIds.length,8);assert.equal(new Set(first.selectLiveIds).size,8);const live=first.samples.filter(sample=>first.selectLiveIds.includes(sample.id));
 assert.equal(new Set(live.map(sample=>sample.continent)).size,6);assert.ok(live.every(sample=>sample.population<50000));assert.ok(first.samples.every(sample=>sample.languageTagVerified&&sample.nameLanguage==='zh'));
 const changed=await selectChineseSamples(rows,aliases,{seed:`${DEFAULT_SEED}-other`});assert.notDeepEqual(first.samples.map(sample=>sample.id),changed.samples.map(sample=>sample.id));
});
test('lack of verified Chinese names fails rather than fabricating translations to reach sixty',async()=>{
 await assert.rejects(selectChineseSamples(syntheticRows(),async()=>[]),/refusing invented or untagged fallback/);
});
test('published test data keeps source hashes, tagged Chinese names, fixed live IDs and no runtime use',async()=>{
 const data=JSON.parse(await readFile(new URL('../data/global-city-samples.json',import.meta.url),'utf8'));
 assert.equal(data.samples.length,60);assert.equal(data.sampling.selectLiveIds.length,8);assert.equal(data.sampling.runtimeUse,false);assert.equal(data.sampling.modelCalls,0);
 assert.ok(data.provenance.sources.every(source=>/^https:\/\/download\.geonames\.org\//.test(source.url)&&/^[a-f0-9]{64}$/.test(source.sha256)&&Number.isFinite(Date.parse(source.downloadedAt))));
 assert.ok(data.samples.every(sample=>sample.languageTagVerified===true&&/^zh(?:-|$)/i.test(sample.nameLanguage)&&/\p{Script=Han}/u.test(sample.name)&&sample.nameSourceField==='alternateNames.alternateName'));
 const live=data.samples.filter(sample=>data.sampling.selectLiveIds.includes(sample.id));assert.equal(new Set(live.map(sample=>sample.continent)).size,6);assert.ok(live.every(sample=>sample.population<50000));
});
