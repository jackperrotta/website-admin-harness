import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupFixture,acceptedPolicies} from './billing-setup-fixture.ts';
import {encryptSettings} from '../packages/admin/src/billing/settings-store.ts';

test('managed billing is opt-in, owner-only, origin-bound and never exposes keys',async()=>{
  const f=await setupFixture();try{
    for(const role of ['none','administrator','editor','analyst'])assert.ok([401,403].includes((await f.request('/settings/status',undefined,role)).status));
    assert.equal((await f.request('/settings',{},'owner',{origin:'https://other.example.test'})).status,403);
    assert.equal((await f.save()).status,200);
    const settingsRoute=await f.app.dispatchFetch(f.origin+'/api/modules/billing/settings',{headers:{cookie:f.cookies.owner},redirect:'manual'});assert.equal(settingsRoute.status,303);assert.equal(settingsRoute.headers.get('location'),f.origin+'/?billing=setup#billing');
    const status=await f.status();assert.equal(status.managed,true);assert.equal(status.activated,false);assert.ok(!JSON.stringify(status).includes('sk_test_'));
    const row=await f.db.prepare('SELECT encrypted_payload FROM billing_installation_settings').first<{encrypted_payload:string}>();assert.match(row!.encrypted_payload,/^v1\./);assert.ok(!row!.encrypted_payload.includes('fixture_not'));
    assert.equal(f.protocol.calls.filter(c=>c.method==='POST').length,0);
    assert.equal((await f.request('/settings',{mode:'test',revision:0,secretKey:'',webhookSecret:'',currency:'usd',prices:[],portalConfigurationId:''})).status,409);
    assert.equal((await f.request('/settings/activation',{mode:'test',revision:status.revision,enabled:true,confirmation:'ENABLE LIVE BILLING'})).status,400);
  }finally{await f.app.dispose();}
  const off=await setupFixture({enabled:false});try{assert.equal((await off.request('/settings/status')).status,404);assert.equal((await off.webhook({})).status,404);}finally{await off.app.dispose();}
});

test('live setup creates only reviewed configuration objects and requires all readiness checks before activation',async()=>{
  const f=await setupFixture({liveGate:true,config:{mode:'live'}});try{
    assert.equal((await f.save()).status,200);
    let r=await f.action('activation',{enabled:true,confirmation:'ENABLE LIVE BILLING'});assert.equal(r.status,409);
    assert.equal((await f.request('/customers',{name:'Customer',email:'c@example.test',idempotencyKey:'no-live-customers'})).status,403);
    assert.equal((await f.action('plan',{name:'Monthly care',amount:10000,interval:'month',reviewed:false,idempotencyKey:'new-plan-key'})).status,400);
    assert.equal((await f.action('plan',{name:'Monthly care',amount:10000,interval:'month',reviewed:true,idempotencyKey:'new-plan-key'})).status,200);
    assert.equal((await f.action('policies',{policies:acceptedPolicies})).status,200);
    assert.equal((await f.action('portal',{reviewed:true,idempotencyKey:'apply-policy-key'})).status,200);
    assert.ok(f.protocol.calls.filter(c=>c.method==='POST').every(c=>['/prices','/billing_portal/configurations'].includes(c.path)));
    await f.tick();await f.webhook(f.protocol.event({id:'in_setup',object:'invoice',customer:'cus_unknown',livemode:true},'evt_setup','invoice.created'));
    const ready=await(await f.request('/settings/readiness?mode=live')).json() as any;assert.equal(ready.ready,true,JSON.stringify(ready));
    assert.equal((await f.action('activation',{enabled:true,confirmation:'incorrect'})).status,400);
    assert.equal((await f.action('activation',{enabled:true,confirmation:'ENABLE LIVE BILLING'})).status,200);
    assert.equal((await f.view()).setup.liveWritesAllowed,true);
    assert.equal((await f.request('/customers',{name:'Synthetic customer',email:'synthetic@example.test',idempotencyKey:'enabled-customer-key'})).status,200);
    assert.equal((await f.action('activation',{enabled:false})).status,200);
    assert.equal((await f.view()).setup.liveWritesAllowed,false);
    assert.equal((await f.request('/customers',{name:'Blocked',email:'blocked@example.test',idempotencyKey:'blocked-customer-key'})).status,403);
  }finally{await f.app.dispose();}
});

test('deployment kill switch, stale provider policies, missing signed delivery and scheduler block activation',async()=>{
  const f=await setupFixture({config:{mode:'live'}});try{await f.prepare();const review=await(await f.request('/settings/readiness?mode=live')).json() as any;assert.equal(review.checks.find((c:any)=>c.id==='deployment').ok,false);assert.equal((await f.action('activation',{enabled:true,confirmation:'ENABLE LIVE BILLING'})).status,409);}finally{await f.app.dispose();}
  const g=await setupFixture({config:{mode:'live'},liveGate:true});try{await g.prepare();const status=await g.status();g.protocol.objects.get(status.portalConfigurationId)!.features.subscription_cancel.enabled=false;let r=await(await g.request('/settings/readiness?mode=live')).json() as any;assert.equal(r.checks.find((c:any)=>c.id==='portal').ok,false);assert.equal((await g.action('activation',{enabled:true,confirmation:'ENABLE LIVE BILLING'})).status,409);
    await g.db.prepare('UPDATE billing_setup_health SET scheduled_at=0,webhook_at=0').run();r=await(await g.request('/settings/readiness?mode=live')).json() as any;assert.equal(r.checks.find((c:any)=>c.id==='scheduler').ok,false);assert.equal(r.checks.find((c:any)=>c.id==='delivery').ok,false);
    assert.equal((await g.app.dispatchFetch(g.origin+'/api/modules/billing/hooks/stripe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({livemode:true})})).status,400);
    assert.equal((await g.db.prepare('SELECT webhook_at FROM billing_setup_health').first<{webhook_at:number}>())!.webhook_at,0);
  }finally{await g.app.dispose();}
});

test('saving policies clears activation and stale concurrent activation cannot overwrite changed settings',async()=>{
  const f=await setupFixture({config:{mode:'live'},liveGate:true});try{await f.prepare();assert.equal((await f.action('activation',{enabled:true,confirmation:'ENABLE LIVE BILLING'})).status,200);const old=await f.status();assert.equal((await f.action('policies',{policies:{...acceptedPolicies,invoiceDueDays:30}})).status,200);assert.equal((await f.status()).activated,false);assert.equal((await f.request('/settings/activation',{mode:'live',revision:old.revision,enabled:true,confirmation:'ENABLE LIVE BILLING'})).status,409);assert.equal((await f.status()).policies.invoiceDueDays,30);
    assert.equal((await f.action('activation',{enabled:true,confirmation:'ENABLE LIVE BILLING'})).status,409);
  }finally{await f.app.dispose();}
});

test('legacy ciphertext migrates without losing other mode credentials, grants or account isolation',async()=>{
  const f=await setupFixture();try{
    const legacy={config:{accountId:'acct_fixture',mode:'test' as const,currency:'usd',prices:[],allowLiveWrites:false},secretKey:'sk_test_fixture_not_a_real_key',webhookSecret:'whsec_fixture_only_no_account',verifiedAt:1};
    const encrypted=await encryptSettings(legacy,{DB:f.db as any,BILLING_SETTINGS_KEY:'a'.repeat(64)},f.manifest as any);
    await f.db.prepare('INSERT INTO billing_installation_settings VALUES(?,?,?,1,?,1,?)').bind(f.manifest.installationId,f.manifest.site.id,f.origin,encrypted,'owner').run();assert.equal((await f.status()).configured,true);
    f.protocol.live=true;for(const value of f.protocol.objects.values())value.livemode=true;assert.equal((await f.save('live')).status,200);assert.equal((await f.status('test')).accountId,'acct_fixture');assert.equal((await f.status('live')).mode,'live');
    assert.equal((await f.save('test',{secretKey:'sk_live_fixture_not_a_real_key'})).status,400);
    await f.db.prepare('UPDATE billing_installation_settings SET admin_origin=?').bind('https://other.example.test').run();assert.equal((await f.status()).configured,false);
    await f.db.prepare('UPDATE billing_installation_settings SET admin_origin=?,site_id=?').bind(f.origin,'different-site').run();assert.equal((await f.status()).configured,false);
  }finally{await f.app.dispose();}
});

test('lost setup responses retry the same intent without duplicate prices or portal configurations',async()=>{
  const f=await setupFixture();try{await f.save();const data={name:'Care',amount:20000,interval:'year',reviewed:true,idempotencyKey:'response-loss-price'};f.protocol.dropAfter='/prices';assert.equal((await f.action('plan',data)).status,503);assert.equal((await f.action('plan',data)).status,200);assert.equal([...f.protocol.objects.values()].filter(v=>v.id.startsWith('price_created')).length,1);assert.equal((await f.action('plan',{...data,amount:30000})).status,409);
  }finally{await f.app.dispose();}
});

test('owner prepares only the exact webhook and configuration events prove delivery without a payment',async()=>{
  const f=await setupFixture({config:{mode:'live'}});try{
    await f.save();f.protocol.hookEvents=['invoice.created','customer.updated'];
    assert.equal((await f.action('webhook',{reviewed:true,idempotencyKey:'prepare-own-webhook'})).status,200);
    assert.ok(f.protocol.hookEvents.includes('customer.updated'));assert.ok(f.protocol.hookEvents.includes('billing_portal.configuration.created'));
    const event=f.protocol.event({id:'bpc_setup_delivery',object:'billing_portal.configuration',livemode:true},'evt_configuration','billing_portal.configuration.created');
    assert.equal((await f.webhook(event)).status,200);
    assert.ok((await f.db.prepare('SELECT webhook_at FROM billing_setup_health').first<{webhook_at:number}>())!.webhook_at>0);
    assert.equal((await f.view()).customers.length,0);assert.equal((await f.status()).activated,false);
    const before=f.protocol.calls.length;f.protocol.origin='https://other.example.test';assert.equal((await f.action('webhook',{reviewed:true,idempotencyKey:'foreign-webhook'})).status,409);assert.ok(f.protocol.calls.slice(before).every(c=>c.method==='GET'));
  }finally{await f.app.dispose();}
});
