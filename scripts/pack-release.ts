import process from 'node:process';
import type {PackedPackage} from './release-types.ts';
interface PackageManifest {name: string; version: string; publishConfig?: {access: string; tag: string}}
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const names=['contracts','admin','create-admin'];
const manifests=await Promise.all(names.map(dir=>readFile(`packages/${dir}/package.json`,'utf8').then(text=>JSON.parse(text) as PackageManifest)));
const version=manifests[0].version;
if(!/^\d+\.\d+\.\d+-alpha\.\d+$/.test(version)||manifests.some(p=>p.version!==version||p.publishConfig?.access!=='public'||p.publishConfig?.tag!=='alpha'||!p.name.startsWith('@tryvitris/')))throw Error('Expected synchronized public alpha packages');
const destination=resolve('artifacts/releases',version);await mkdir(destination,{recursive:true});
const npmCLI=process.env.npm_execpath||join(resolve(process.execPath,'..'),'node_modules/npm/bin/npm-cli.js');
const packages=[];
for(const [index,dir]of names.entries()){
  const [packed]=JSON.parse(execFileSync(process.execPath,[npmCLI,'pack','--json','--ignore-scripts','--pack-destination',destination],{cwd:resolve('packages',dir),encoding:'utf8'})) as PackedPackage[];
  if(packed.name!==manifests[index].name||packed.version!==version)throw Error('Unexpected package identity');
  for(const file of packed.files){
    if(/(^|\/)(node_modules|\.wrangler|\.vitris|artifacts|tests)(\/|$)|\.env|\.dev\.vars|bootstrap-owner|\.sqlite|\.tgz$/.test(file.path))throw Error('Private file in package: '+file.path);
    const text=await readFile(join('packages',dir,file.path),'utf8');
    if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}|perrottabuilt\.com|jack@tryvitris\.com/.test(text))throw Error('Unexpected credential or customer identifier in '+file.path);
  }
  packages.push({...packed,directory:`packages/${dir}`});
}
await writeFile(join(destination,'manifest.json'),JSON.stringify({version,tag:'alpha',packages},null,2)+'\n');
console.log(JSON.stringify({destination,packages:packages.map(p=>({name:p.name,version:p.version,filename:p.filename,size:p.size,integrity:p.integrity}))},null,2));
