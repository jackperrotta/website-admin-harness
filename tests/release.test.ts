import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registryPackage,waitForRegistry} from '../scripts/release-registry.ts';
import {stableRelease,releasePackageNames} from '../scripts/release-policy.ts';
const pkg={name:'@tryvitris/example',version:'1.0.0',integrity:'sha512-reviewed'};
test('stable publication requires matching package versions, latest tags and a pinned initializer',()=>{
  const manifests=releasePackageNames.map(name=>({name,version:'1.0.0',publishConfig:{access:'public',tag:'latest'},dependencies:{'@tryvitris/website-admin-harness':'1.0.0'}}));
  assert.deepEqual(stableRelease(manifests),{version:'1.0.0',tag:'latest'});
  assert.throws(()=>stableRelease(manifests.map(manifest=>({...manifest,version:'1.0.0-alpha.1'}))),/stable/);
  assert.throws(()=>stableRelease(manifests.map((manifest,index)=>index===1?{...manifest,version:'1.0.1'}:manifest)),/synchronized/);
  assert.throws(()=>stableRelease(manifests.map(manifest=>({...manifest,publishConfig:{access:'public',tag:'alpha'}}))),/latest/);
  assert.throws(()=>stableRelease(manifests.map(manifest=>({...manifest,dependencies:{'@tryvitris/website-admin-harness':'0.1.0'}}))),/pin/);
});
test('registry verification accepts only the exact reviewed package and archive',async()=>{
  const request=async()=>Response.json({...pkg,dist:{integrity:pkg.integrity}});
  const verified=await registryPackage(pkg,{request});assert.ok(verified);assert.equal(verified.verified,true);
  await assert.rejects(registryPackage(pkg,{request:async()=>Response.json({...pkg,dist:{integrity:'sha512-different'}})}),/do not match/);
  assert.equal(await registryPackage(pkg,{request:async()=>new Response('',{status:404})}),null);
  await assert.rejects(registryPackage(pkg,{request:async()=>new Response('',{status:503})}),/HTTP 503/);
});
test('accepted uploads may remain unreadable for minutes without being reported complete',async()=>{
  let time=0,reads=0;const result=await waitForRegistry(pkg,{now:()=>time,sleep:async ms=>{time+=ms;},read:async()=>++reads<5?null:{...pkg,verified:true},intervalMs:60000,timeoutMs:300000});
  assert.equal(time,240000);assert.equal(result.verified,true);
  await assert.rejects(waitForRegistry(pkg,{now:()=>time,sleep:async ms=>{time+=ms;},read:async()=>null,intervalMs:60000,timeoutMs:120000}),/recorded upload will not be repeated/);
});
