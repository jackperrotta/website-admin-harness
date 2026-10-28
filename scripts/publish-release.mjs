import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';

async function main(){
const dryRun=process.argv.includes('--dry-run')||process.env.npm_config_dry_run==='true';
const version=JSON.parse(await readFile('packages/admin/package.json','utf8')).version;
const directory=resolve('artifacts/releases',version);
const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
if(manifest.version!==version||manifest.tag!=='alpha'||manifest.packages.length!==3)throw Error('Pack a matching alpha release with npm run release:pack first');
const npmCLI=process.env.npm_execpath||join(resolve(process.execPath,'..'),'node_modules/npm/bin/npm-cli.js');
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
// Verify every archive before the first publish. Only exact reviewed archives are sent.
for(const pkg of manifest.packages){
  if(!pkg.name.startsWith('@tryvitris/')||pkg.version!==version||pkg.filename!==pkg.filename.split(/[\\/]/).at(-1))throw Error('Unexpected release package');
  const archive=await readFile(join(directory,pkg.filename));
  if('sha512-'+createHash('sha512').update(archive).digest('base64')!==pkg.integrity)throw Error('Release archive changed: '+pkg.name);
}
const results=[];
for(const pkg of manifest.packages){
  const url=`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(version)}`;
  let response=await fetch(url,{headers:{'cache-control':'no-cache'}});
  if(response.status===404){
    const args=['publish',join(directory,pkg.filename),'--tag','alpha','--access','public','--ignore-scripts',...(dryRun?['--dry-run']:[])];
    const child=spawnSync(process.execPath,[npmCLI,...args],{stdio:'inherit',env:process.env});
    if(child.status!==0)throw Error(`Publish stopped at ${pkg.name}. If npm asks for two-factor authentication, run npm run release:publish in your own terminal and enter the code there. Already verified publications will be skipped on retry.`);
    if(dryRun){results.push({name:pkg.name,version,dryRun:true,integrity:pkg.integrity});continue;}
    for(const delay of [0,500,1000,2000,3000]){
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      response=await fetch(url,{headers:{'cache-control':'no-cache'}});
      if(response.status!==404)break;
      await response.arrayBuffer();
    }
  }
  if(!response.ok)throw Error('Cannot verify registry publication: '+pkg.name+' HTTP '+response.status);
  const published=await response.json();
  if(published.name!==pkg.name||published.version!==version||published.dist?.integrity!==pkg.integrity)throw Error('Registry bytes do not match reviewed archive: '+pkg.name);
  results.push({name:pkg.name,version,integrity:published.dist.integrity,verified:true});
}
const receipt={commit,version,tag:'alpha',dryRun,packages:results,verifiedAt:new Date().toISOString()};
await writeFile(join(directory,dryRun?'publication-dry-run.json':'publication-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
