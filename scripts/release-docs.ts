import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import type {PackageIdentity} from './release-types.ts';

interface PackageNote {title:string; notesScope:'package'|'admin-family'; notes:string[]}
interface HookConfiguration {url:string; token:string}
interface HookResult {status:'not-configured'|'updated'; checkedAt?:string; packages?:PackageIdentity[]}
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
function note(value:unknown):PackageNote {
 if(!object(value)||typeof value.title!=='string'||!value.title.trim()||value.title.length>200||!['package','admin-family'].includes(String(value.notesScope))||!Array.isArray(value.notes)||!value.notes.length||value.notes.length>40||value.notes.some(n=>typeof n!=='string'||!n.trim()||n.length>2000||/\bTODO\b|\[TBD\]/i.test(n)))throw Error('Write substantive package-specific release notes before packing');
 return {title:value.title,notesScope:value.notesScope as PackageNote['notesScope'],notes:value.notes as string[]};
}
export function assertReleaseDocumentation(value:unknown,name:string,version:string):void{
 if(!object(value)||value.schemaVersion!==1||value.name!==name||value.version!==version||typeof value.documentation!=='string'||!value.documentation.trim()||typeof value.documentationSha256!=='string'||createHash('sha256').update(value.documentation).digest('hex')!==value.documentationSha256)throw Error('Packed release documentation is missing or mismatched: '+name);
 note(value);
}
export async function prepareReleaseDocumentation(root:string,version:string){
 const raw:unknown=JSON.parse(await readFile(join(root,'docs/releases',version+'.json'),'utf8'));
 if(!object(raw)||raw.schemaVersion!==1||raw.version!==version||!object(raw.packages))throw Error('Release documentation version mismatch');
 for(const [directory,id,readmePath] of [['admin','runtime','packages/admin/README.md'],['contracts','contracts','packages/contracts/README.md'],['create-admin','initializer','packages/create-admin/README.md']]){
  const p=JSON.parse(await readFile(join(root,'packages',directory,'package.json'),'utf8')) as {name:string;version:string};if(p.version!==version)throw Error('Admin package versions differ');
  const details=note(raw.packages[id]),documentation=await readFile(join(root,readmePath),'utf8');
  const manifest={schemaVersion:1,name:p.name,version,...details,repository:'https://github.com/jackperrotta/website-admin-harness',readmePath,ref:'v'+version,documentation,documentationSha256:createHash('sha256').update(documentation).digest('hex')};
  await writeFile(join(root,'packages',directory,'vitris-release.json'),JSON.stringify(manifest,null,2)+'\n');
 }
}
export async function notifyDocumentation(root:string,packages:PackageIdentity[],options:{fetcher?:typeof fetch;configuration?:HookConfiguration}={}):Promise<HookResult>{
 let configuration:unknown=options.configuration;
 if(!configuration&&process.env.VITRIS_DOCS_WEBHOOK_URL)configuration={url:process.env.VITRIS_DOCS_WEBHOOK_URL,token:process.env.VITRIS_DOCS_WEBHOOK_TOKEN};
 const file=join(root,'.vitris/release-docs.json');if(!configuration&&existsSync(file))configuration=JSON.parse(await readFile(file,'utf8'));
 if(!configuration)return {status:'not-configured'};
 if(!object(configuration)||typeof configuration.url!=='string'||typeof configuration.token!=='string'||configuration.token.length<32)throw Error('Invalid private documentation hook configuration');
 const url=new URL(configuration.url);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error('Invalid documentation hook URL');
 const response=await (options.fetcher||fetch)(url,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+configuration.token,'content-type':'application/json'},body:JSON.stringify({packages}),signal:AbortSignal.timeout(120000)});
 if(response.status!==200)throw Error('npm publication is verified; documentation refresh needs retry (HTTP '+response.status+'). Run npm run release:docs without republishing packages.');
 const result:unknown=await response.json();
 if(!object(result)||!Array.isArray(result.verified)||!Array.isArray(result.failures)||result.failures.length||!Array.isArray(result.pending)||result.pending.length)throw Error('Documentation receipt is incomplete; run npm run release:docs without republishing packages.');
 const verified=result.verified;
 if(packages.some(p=>!verified.some((v:unknown)=>object(v)&&v.name===p.name&&v.version===p.version&&v.integrity===p.integrity)))throw Error('Documentation receipt does not cover all published packages');
 return {status:'updated',checkedAt:String(result.checkedAt),packages:verified as PackageIdentity[]};
}
export async function refreshPublishedDocumentation(root=resolve('.')){
 const packages:PackageIdentity[]=[];
 for(const directory of ['contracts','admin','create-admin']){
  const p=JSON.parse(await readFile(join(root,'packages',directory,'package.json'),'utf8')) as {name:string;version:string};
  const response=await fetch('https://registry.npmjs.org/'+encodeURIComponent(p.name)+'/'+p.version,{headers:{'cache-control':'no-cache'}});if(!response.ok)throw Error('Package version is not publicly available');
  const entry:unknown=await response.json();if(!object(entry)||entry.name!==p.name||entry.version!==p.version||!object(entry.dist)||typeof entry.dist.integrity!=='string')throw Error('Registry identity mismatch');
  packages.push({name:p.name,version:p.version,integrity:entry.dist.integrity});
 }
 const result=await notifyDocumentation(root,packages);await mkdir(join(root,'.vitris/docs-publications'),{recursive:true});await writeFile(join(root,'.vitris/docs-publications',packages[0].version+'.json'),JSON.stringify(result,null,2)+'\n');return result;
}
