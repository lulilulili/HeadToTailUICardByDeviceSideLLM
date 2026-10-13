import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseEnv} from 'node:util';

// Local credentials stay in the ignored .env. Existing process settings win,
// including PORT for isolated previews. Return names only, never secret values.
export async function loadLocalEnvironment(root,{env=process.env}={}){
 let source;
 try{source=await readFile(join(root,'.env'),'utf8');}catch(error){if(error.code==='ENOENT')return {loaded:false,keys:[]};throw error;}
 const values=parseEnv(source);
 for(const [key,value]of Object.entries(values))if(!Object.hasOwn(env,key))env[key]=value;
 return {loaded:true,keys:Object.keys(values)};
}
