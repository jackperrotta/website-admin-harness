import process from 'node:process';
import type {ReleaseManifest, PublicationProgress, VerifiedPackage} from './release-types.ts';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {registryPackage,waitForRegistry} from './release-registry.ts';

async function main(){
const dryRun=process.argv.includes('--dry-run')||process.env.npm_config_dry_run==='true';
const version=(JSON.parse(await readFile('packages/admin/package.json','utf8')) as {version: string}).version;
const directory=resolve('artifacts/releases',version);
const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8')) as ReleaseManifest;
if(manifest.version!==version||manifest.tag!=='alpha'||manifest.packages.length!==3)throw Error('Pack a matching alpha release with npm run release:pack first');
const npmCLI=process.env.npm_execpath||join(resolve(process.execPath,'..'),'node_modules/npm/bin/npm-cli.js');
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
// Verify every archive before the first publish. Only exact reviewed archives are sent.
for(const pkg of manifest.packages){
  if(!pkg.name.startsWith('@tryvitris/')||pkg.version!==version||pkg.filename!==pkg.filename.split(/[\\/]/).at(-1))throw Error('Unexpected release package');
  const archive=await readFile(join(directory,pkg.filename));
  if('sha512-'+createHash('sha512').update(archive).digest('base64')!==pkg.integrity)throw Error('Release archive changed: '+pkg.name);
}
const results: (VerifiedPackage | {name: string; version: string; dryRun: true; integrity: string})[]=[];
const progressFile=join(directory,'publication-progress.json');
let progress: Record<string, Omit<PublicationProgress, 'name'>>={};try{progress=JSON.parse(await readFile(progressFile,'utf8'));}catch(error){if(!(error instanceof Error && 'code' in error && error.code==='ENOENT'))throw error;}
const saveProgress=()=>writeFile(progressFile,JSON.stringify(progress,null,2)+'\n');
for(const pkg of manifest.packages){
  let published=await registryPackage(pkg);
  const accepted=progress[pkg.name];
  if(accepted&&(accepted.version!==version||accepted.integrity!==pkg.integrity))throw Error('Recorded upload differs from reviewed archive: '+pkg.name);
  if(!published&&!accepted){
    const args=['publish',join(directory,pkg.filename),'--tag','alpha','--access','public','--ignore-scripts',...(dryRun?['--dry-run']:[])];
    const child=spawnSync(process.execPath,[npmCLI,...args],{stdio:'inherit',env:process.env});
    if(child.status!==0)throw Error(`Publish stopped at ${pkg.name}. If npm asks for two-factor authentication, run npm run release:publish in your own terminal and enter the code there. Already verified publications will be skipped on retry.`);
    if(dryRun){results.push({name:pkg.name,version,dryRun:true,integrity:pkg.integrity});continue;}
    progress[pkg.name]={version,integrity:pkg.integrity,status:'accepted',acceptedAt:new Date().toISOString()};await saveProgress();
  }
  if(!published)published=await waitForRegistry(pkg,{onPending:()=>console.log(`Waiting for npm processing: ${pkg.name}. Upload is recorded; no re-upload will occur.`)});
  if(!dryRun){progress[pkg.name]={...progress[pkg.name],version,integrity:pkg.integrity,status:'verified',verifiedAt:new Date().toISOString()};await saveProgress();}
  results.push(published);
}
const receipt={commit,version,tag:'alpha',dryRun,packages:results,verifiedAt:new Date().toISOString()};
await writeFile(join(directory,dryRun?'publication-dry-run.json':'publication-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
}
main().catch(error=>{console.error(error instanceof Error ? error.message : String(error));process.exitCode=1;});
