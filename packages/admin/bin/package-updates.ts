import {readFile,writeFile,mkdir,realpath,lstat} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {checkPackageUpdates,planPackageUpdates} from '../src/maintenance.ts';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const optional=async(file:string)=>{try{return await readFile(file,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return '';throw e;}};
const command='vitris-admin updates check --dir . --json --out .vitris/updates/latest.json';
const instructions='\n<!-- vitris-package-updates:v1 -->\nBefore maintenance and publication, run `npm run updates:check`. Read `node_modules/@tryvitris/website-admin-harness/agent/refs/package-updates.md`. Check the published stable admin release family, prepare and test compatible exact-version updates, and follow this installation\'s existing publishing permissions. Keep authored modules, accounts, permissions, reporting, SSO, billing, bindings and secrets. Reuse the website\'s existing daily care task; a local instruction file does not activate a schedule.\n<!-- /vitris-package-updates:v1 -->\n';
export async function saveUpdateEvidence(root:string,file:string,value:unknown){
 root=await realpath(root);const base=resolve(root,'.vitris/updates'),target=resolve(root,file),inside=relative(base,target);if(!inside||inside.startsWith('..')||isAbsolute(inside))throw Error('Update evidence must be a file under .vitris/updates/');
 for(const part of [root,...relative(root,target).split(/[\\/]/).map((_,i,parts)=>join(root,...parts.slice(0,i+1)))]){try{if((await lstat(part)).isSymbolicLink())throw Error('Update evidence path contains a symlink; preserve it and choose an installation-owned path.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 await mkdir(dirname(target),{recursive:true});await writeFile(target,JSON.stringify(value,null,2)+'\n');
}
export async function setupPackageMaintenance(root:string,mode:'plan'|'apply'|'initialize'){
 root=await realpath(root);for(const file of ['package.json','AGENTS.md','.gitignore']){try{if((await lstat(join(root,file))).isSymbolicLink())throw Error('Preserve linked installation instructions/configuration; integrate maintenance explicitly.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}const config=JSON.parse(await readFile(join(root,'admin.config.json'),'utf8'));if(!config.installationId||!config.site?.id||!config.adminOrigin)throw Error('Maintenance setup needs an existing admin installation');const pkgFile=join(root,'package.json'),raw=await readFile(pkgFile,'utf8'),pkg=JSON.parse(raw),agents=await optional(join(root,'AGENTS.md')),ignore=await optional(join(root,'.gitignore'));
 if(pkg.scripts?.['updates:check']&&pkg.scripts['updates:check']!==command)throw Error('An authored updates:check script exists. Preserve it and integrate explicitly.');
 if(agents.includes('<!-- vitris-package-updates:v1 -->')&&!agents.includes(instructions.trim()))throw Error('The package update instructions were customized; merge explicitly.');
 const prepared={schemaVersion:1,policy:'prepare-and-test',baseline:{package:hash(raw),agents:hash(agents),ignore:hash(ignore)},script:command,scheduleActivated:false};
 if(mode==='plan'){await saveUpdateEvidence(root,'.vitris/updates/setup-plan.json',prepared);return prepared;}
 if(mode==='apply'){const previous=JSON.parse(await readFile(join(root,'.vitris/updates/setup-plan.json'),'utf8'));if(JSON.stringify(previous)!==JSON.stringify(prepared))throw Error('The installation changed; prepare a new maintenance setup plan.');}
 const updated={...pkg,scripts:{...pkg.scripts,'updates:check':command}};const nextAgents=agents.includes(instructions.trim())?agents:agents+(agents&&!agents.endsWith('\n')?'\n':'')+instructions;
 await writeFile(pkgFile,JSON.stringify(updated,null,2)+'\n');await writeFile(join(root,'AGENTS.md'),nextAgents);
 if(!ignore.split(/\r?\n/).includes('.vitris/'))await writeFile(join(root,'.gitignore'),ignore+(ignore&&!ignore.endsWith('\n')?'\n':'')+'.vitris/\n');
 return {...prepared,configured:true};
}
export async function packageUpdates(action:string,options:{dir?:string;json?:boolean;out?:string;plan?:boolean;apply?:boolean}){
 const root=resolve(options.dir||'.');let result:unknown;
 if(action==='setup'){if(!!options.plan===!!options.apply)throw Error('Use updates setup --dir EXISTING_ADMIN --plan or --apply');result=await setupPackageMaintenance(root,options.apply?'apply':'plan');}
 else if(action==='check'||action==='plan'){const report=await checkPackageUpdates(root);result=action==='plan'?planPackageUpdates(report):report;if(options.out)await saveUpdateEvidence(root,options.out,result);}
 else throw Error('Use updates check|plan|setup');
 console.log(JSON.stringify(result,null,options.json?undefined:2));
}
