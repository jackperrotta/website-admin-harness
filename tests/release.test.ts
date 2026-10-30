import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registryPackage,waitForRegistry} from '../scripts/release-registry.ts';
const pkg={name:'@tryvitris/example',version:'0.1.0-alpha.1',integrity:'sha512-reviewed'};
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
