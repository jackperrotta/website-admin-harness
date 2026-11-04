import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stripePair} from './stripe-fixture.ts';
import {webmasterConfig} from './webmaster-fixture.ts';

test('revoking webmaster management preserves the independently paired client billing account and subscription',async()=>{
  const f=await stripePair(undefined,true);try{
    const subscription=f.seller.protocol.subscription((await f.seller.view()).customers[0].stripeId);
    await f.seller.webhook(f.seller.protocol.event(subscription,'evt_webmaster_subscription','customer.subscription.updated'));await f.seller.tick();
    const before=await f.client.view();assert.ok(before.records.some(r=>r.kind==='subscription'));
    const request=(path:string,data:unknown,role='owner')=>f.client.app.dispatchFetch(f.client.origin+'/api/modules/webmaster'+path,{method:'POST',headers:{cookie:f.client.cookies[role],origin:f.client.origin,'content-type':'application/json'},body:JSON.stringify(data)});
    assert.equal((await request('',{...webmasterConfig,billingProvider:true})).status,200);
    assert.equal((await f.client.request(undefined,undefined,'editor')).status,403);
    const calls=f.seller.protocol.calls.length;
    assert.equal((await request('/disconnect',{revision:1,acknowledgeSubscription:true})).status,200);
    assert.equal(f.seller.protocol.calls.length,calls);assert.equal(subscription.cancel_at_period_end,false);assert.equal(subscription.status,'active');
    const after=await f.client.view();assert.deepEqual(after.records,before.records);assert.deepEqual(after.customers,before.customers);
    const portal=await f.client.request('/portal',{});assert.equal(portal.status,200);assert.match((await portal.json() as {url:string}).url,/^https:\/\/billing\.stripe\.com\//);
  }finally{await f.dispose();}
});
