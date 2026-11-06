import process from 'node:process';
import type {PackedPackage} from './release-types.ts';
import {stableRelease,type ReleasePackageManifest} from './release-policy.ts';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {assertSafeArchive,credentialIssue} from './publication-safety.ts';
import {prepareReleaseDocumentation} from './release-docs.ts';
const names=['contracts','admin','create-admin'];
const manifests=await Promise.all(names.map(dir=>readFile(`packages/${dir}/package.json`,'utf8').then(text=>JSON.parse(text) as ReleasePackageManifest)));
const {version,tag}=stableRelease(manifests);
await prepareReleaseDocumentation(resolve('.'),version);
const destination=resolve('artifacts/releases',version);await mkdir(destination,{recursive:true});
const npmCLI=process.env.npm_execpath||join(resolve(process.execPath,'..'),'node_modules/npm/bin/npm-cli.js');
const packages=[];
for(const [index,dir]of names.entries()){
  const [packed]=JSON.parse(execFileSync(process.execPath,[npmCLI,'pack','--json','--ignore-scripts','--pack-destination',destination],{cwd:resolve('packages',dir),encoding:'utf8'})) as PackedPackage[];
  if(packed.name!==manifests[index].name||packed.version!==version)throw Error('Unexpected package identity');
  for(const file of packed.files){
    if(/(^|\/)(node_modules|\.wrangler|\.vitris|artifacts|tests)(\/|$)|\.env|\.dev\.vars|bootstrap-owner|\.sqlite|\.tgz$/.test(file.path))throw Error('Private file in package: '+file.path);
    const text=await readFile(join('packages',dir,file.path),'utf8');
    if(credentialIssue(text)||/perrottabuilt\.com|jack@tryvitris\.com/.test(text))throw Error('Unexpected credential or customer identifier in '+file.path);
  }
  await assertSafeArchive(join(destination,packed.filename));
  packages.push({...packed,directory:`packages/${dir}`});
}
await writeFile(join(destination,'manifest.json'),JSON.stringify({version,tag,packages},null,2)+'\n');
console.log(JSON.stringify({destination,packages:packages.map(p=>({name:p.name,version:p.version,filename:p.filename,size:p.size,integrity:p.integrity}))},null,2));
