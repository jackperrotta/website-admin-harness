import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareReleaseDocumentation,assertReleaseDocumentation,notifyDocumentation} from '../scripts/release-docs.ts';
test('each public admin package receives its own notes and exact specification',async()=>{
 const root=await mkdtemp(join(tmpdir(),'admin-release-docs-'));try{
 const entries=[['admin','runtime','@tryvitris/website-admin-harness'],['contracts','contracts','@tryvitris/website-admin-contracts'],['create-admin','initializer','@tryvitris/create-website-admin-harness']];
 const version='9.9.9',packages:Record<string,unknown>={};await mkdir(join(root,'docs/releases'),{recursive:true});await writeFile(join(root,'README.md'),'# Runtime specification');
 for(const [dir,id,name] of entries){await mkdir(join(root,'packages',dir),{recursive:true});await writeFile(join(root,'packages',dir,'package.json'),JSON.stringify({name,version}));await writeFile(join(root,'packages',dir,'README.md'),'# '+id+' specification');packages[id]={title:id,notesScope:'package',notes:[id+' shipped change.']};}
 await writeFile(join(root,'docs/releases',version+'.json'),JSON.stringify({schemaVersion:1,version,packages}));await prepareReleaseDocumentation(root,version);
 for(const [dir,id,name]of entries){const manifest=JSON.parse(await readFile(join(root,'packages',dir,'vitris-release.json'),'utf8')) as Record<string,unknown>;assertReleaseDocumentation(manifest,name,version);assert.equal(manifest.documentation,await readFile(join(root,'packages',dir,'README.md'),'utf8'));assert.deepEqual(manifest.notes,[id+' shipped change.']);assert.throws(()=>assertReleaseDocumentation({...manifest,documentation:'tampered'},name,version),/mismatched/);}
 }finally{await rm(root,{recursive:true,force:true});}
});
test('all three receipts are required and failed refresh is safely retryable',async()=>{
 const packages=['runtime','contracts','initializer'].map(name=>({name,version:'9.9.9',integrity:'sha512-test'})),configuration={url:'https://docs.example/docs/_refresh',token:'x'.repeat(64)};
 const fetcher:typeof fetch=async(_url,options)=>{assert.equal(options?.redirect,'error');assert.deepEqual(JSON.parse(String(options?.body)),{packages});return Response.json({verified:packages,failures:[],pending:[],checkedAt:'now'});};
 assert.equal((await notifyDocumentation('.',packages,{configuration,fetcher})).status,'updated');
 await assert.rejects(notifyDocumentation('.',packages,{configuration,fetcher:async()=>Response.json({verified:packages.slice(1),failures:[],pending:[]})}),/all published packages/);
 await assert.rejects(notifyDocumentation('.',packages,{configuration,fetcher:async()=>new Response('',{status:503})}),/without republishing/);
});
