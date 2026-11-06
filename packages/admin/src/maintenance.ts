import {readFile,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {adminMaintenancePackages,maintenancePackages,type MaintenancePackage,type MaintenanceRelease,type MaintenanceEntry,type MaintenanceReport,type MaintenancePlan} from '../../contracts/src/maintenance.ts';
export type {MaintenanceReport,MaintenancePlan} from '../../contracts/src/maintenance.ts';
const registry='https://registry.npmjs.org';
const printableVersion=(v:unknown)=>typeof v==='string'&&v.length<=100&&/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(v)?v:null;
const stable=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const object=(v:any):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
async function optional(file:string){try{return await readFile(file,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}}
function compare(a:string,b:string){const x=a.split('.').map(Number),y=b.split('.').map(Number);return x[0]-y[0]||x[1]-y[1]||x[2]-y[2];}
function declaredMatches(range:string,version:string){const match=range.trim().match(/^([~^]?)(\d+)\.(\d+)\.(\d+)$/);if(!match||!stable.test(version))return false;const base=match.slice(2).join('.'),v=version.split('.');if(compare(version,base)<0)return false;if(match[1]==='')return version===base;if(match[1]==='~')return v[0]===match[2]&&v[1]===match[3];return v[0]===match[2]&&(match[2]!=='0'||v[1]===match[3]&&(match[3]!=='0'||v[2]===match[4]));}
function change(a:string,b:string):MaintenanceEntry['change']{if(!stable.test(a)||!stable.test(b))return 'unknown';if(compare(a,b)>=0)return 'none';const x=a.split('.'),y=b.split('.');return x[0]!==y[0]||x[0]==='0'&&x[1]!==y[1]?'major':x[1]!==y[1]?'minor':'patch';}
async function release(name:MaintenancePackage,fetcher:typeof fetch):Promise<MaintenanceRelease>{
 const response=await fetcher(registry+'/'+encodeURIComponent(name)+'/latest',{redirect:'manual',headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});
 if(!response.ok){await response.body?.cancel();throw Error('Release unavailable');}
 const reader=response.body?.getReader();if(!reader)throw Error('Release unavailable');const parts:Uint8Array[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>131072)throw Error('Release metadata too large');parts.push(part.value);}}finally{await reader.cancel();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}const value=JSON.parse(new TextDecoder().decode(bytes));
 if(!object(value)||value.name!==name||!stable.test(value.version)||!object(value.dist)||typeof value.dist.integrity!=='string'||!/^sha512-[A-Za-z0-9+/]{86}==$/.test(value.dist.integrity)||typeof value.dist.tarball!=='string')throw Error('Invalid release identity');
 const url=new URL(value.dist.tarball),expected='/'+name+'/-/'+name.split('/')[1]+'-'+value.version+'.tgz';
 if(url.origin!==registry||url.pathname!==expected||url.search||url.hash||url.username||url.password)throw Error('Invalid release archive');
 return {name,version:value.version,integrity:value.dist.integrity,tarball:url.href};
}
/** Never loads npm credentials, executes release notes, installs packages or changes source. */
export async function checkPackageUpdates(directory:string,{fetcher=fetch}:{fetcher?:typeof fetch}={}):Promise<MaintenanceReport>{
 const root=await realpath(resolve(directory)),raw=await readFile(join(root,'package.json'),'utf8'),pkg=JSON.parse(raw),lockRaw=await optional(join(root,'package-lock.json')),lock=lockRaw?JSON.parse(lockRaw):null;
 if(!object(pkg))throw Error('Expected an installation package.json');
 const baseline:Record<string,string>={'package.json':digest(raw)};if(lockRaw)baseline['package-lock.json']=digest(lockRaw);
 for(const name of ['admin.config.json','launch.json','site-manager.json']){const text=await optional(join(root,name));if(text)baseline[name]=digest(text);}
 const results=await Promise.allSettled(maintenancePackages.map(name=>release(name,fetcher)));
 const packages:MaintenanceEntry[]=[];
 for(const [index,name]of maintenancePackages.entries()){
  const declared=pkg.dependencies?.[name]??pkg.devDependencies?.[name]??null;const installedRaw=await optional(join(root,'node_modules',name,'package.json'));const local=installedRaw?JSON.parse(installedRaw):null;
  const installed=local?.name===name&&typeof local.version==='string'?local.version:null,lockVersion=lock?.packages?.['node_modules/'+name]?.version??lock?.dependencies?.[name]?.version,locked=typeof lockVersion==='string'?lockVersion:null;
  const result=results[index],latest=result.status==='fulfilled'?result.value:null;
  let status:MaintenanceEntry['status']='current';
  if(declared===null)status='not-declared';
  else if(typeof declared!=='string'||!/^\s*[~^]?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\s*$/.test(declared))status='unmanaged';
  else if(!installed||!locked||installed!==locked||!stable.test(installed)||!declaredMatches(declared,installed))status='drift';
  else if(!latest)status='unavailable';
  else if(compare(installed,latest.version)<0)status='update-available';
  else if(compare(installed,latest.version)>0)status='ahead';
  packages.push({name,declared:declared===null?null:typeof declared==='string'&&/^\s*[~^]?\d+\.\d+\.\d+\s*$/.test(declared)?declared.trim():'[custom/local reference]',installed:declared===null?null:printableVersion(installed),locked:declared===null?null:printableVersion(locked),status,change:installed&&latest?change(installed,latest.version):'unknown',latest});
 }
 const versions=adminMaintenancePackages.map(name=>packages.find(p=>p.name===name)!.latest?.version),complete=!!versions[0]&&versions.every(v=>v===versions[0]);
 return {schemaVersion:1,checkedAt:new Date().toISOString(),policy:'prepare-and-test',adminRelease:{version:complete?versions[0]!:null,complete},packages,baseline,deployment:'not-checked'};
}
/** A plan contains pinned data/argv only. An agent must review, install, preserve and test it. */
export function planPackageUpdates(report:MaintenanceReport):MaintenancePlan{
 const declared=report.packages.filter(p=>p.status!=='not-declared');
 const hasAdmin=declared.some(p=>(adminMaintenancePackages as readonly string[]).includes(p.name));
 const installedAdmin=declared.filter(p=>(adminMaintenancePackages as readonly string[]).includes(p.name)).map(p=>p.installed);
 const skew=installedAdmin.length>1&&new Set(installedAdmin).size!==1;
 const held=declared.filter(p=>!['current','update-available'].includes(p.status)||p.change==='major'||hasAdmin&&(skew||!report.adminRelease.complete)&&(adminMaintenancePackages as readonly string[]).includes(p.name)).map(p=>p.name);
 const updates=declared.filter(p=>p.status==='update-available'&&!held.includes(p.name)).map(p=>p.latest!);
 const ready=held.length===0;return {schemaVersion:1,policy:'prepare-and-test',baseline:report.baseline,ready,held,updates:ready?updates:[],install:ready&&updates.length?{command:'npm',args:['install','--save-exact','--ignore-scripts','--no-audit','--no-fund',...updates.map(p=>p.name+'@'+p.version)]}:null,requiredChecks:['Recheck the source/lock/configuration baseline before installing; stop for overlapping edits.','Review release notes, engine compatibility, optional migrations and custom adapters.','Verify the installed lockfile integrity against each pinned release.','Refresh packaged UI and managed instructions only through this installation\'s existing build/provenance workflow.','Run installation checks and relevant account, permission, reporting, SSO, billing and desktop/mobile regressions.','Retain the previous package/lockfiles, accepted customizations and a rollback record. No automatic remote migration, secret rotation or account change.'],deployment:'follow-existing-permissions'};
}
