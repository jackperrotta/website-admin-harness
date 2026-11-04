import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {stripeFixture,stripePair,StripeProtocol} from './stripe-fixture.ts';
import {createStripeBilling,createBillingAccount} from '../packages/admin/src/billing/module.ts';
import type {StripeBillingView} from '../packages/contracts/src/stripe-billing.ts';
const key=()=>randomUUID();
async function customer(f:Awaited<ReturnType<typeof stripeFixture>>,name='Test customer',requestKey=key()){const response=await f.request('/customers',{name,email:'customer@example.test',idempotencyKey:requestKey});assert.equal(response.status,200,await response.clone().text());return (await response.json() as {result:{customerId:string}}).result.customerId;}
test('Stripe is an optional configurable module, with no seeded records, no demo login and no disabled surface',async()=>{
  const f=await stripeFixture();try{const state=await f.view();assert.equal(state.simulated,false);assert.deepEqual(state.customers,[]);assert.equal(state.setup.verified,false);assert.equal((await f.app.dispatchFetch(`${f.origin}/api/auth/demo`,{method:'POST',headers:{origin:f.origin}})).status,404);assert.equal((await f.request('',undefined,'none')).status,401);for(const role of ['administrator','editor','analyst'])assert.equal((await f.request('',undefined,role)).status,403);assert.equal((await f.request('/connection/verify',{},'owner',{origin:'https://wrong.example.test'})).status,403);assert.equal((await f.app.dispatchFetch('http://localhost:4396/api/modules/billing/hooks/stripe',{method:'POST'})).status,421);const boot=await f.app.dispatchFetch(`${f.origin}/api/bootstrap`,{headers:{cookie:f.cookies.owner}});const payload=await boot.json() as {modules:unknown[]};assert.ok(!JSON.stringify(payload.modules).includes('hooks'));assert.ok(!JSON.stringify(payload).includes('sk_test_'));}finally{await f.app.dispose();}
  const ordinary=await stripeFixture({enabled:false,missingMigration:true});try{assert.equal((await ordinary.request()).status,404);assert.equal((await ordinary.webhook({})).status,404);assert.equal((await ordinary.tick()).status,200);}finally{await ordinary.app.dispose();}
});
test('account identity, mode, secrets, transport and redirects fail closed',async()=>{
  for(const options of [{missingSecret:true},{config:{accountId:'acct_different'}},{config:{mode:'live' as const}},{mode:'production',origin:'https://admin.example.test'}]){const f=await stripeFixture(options);try{const response=await f.request('/connection/verify',{});assert.equal(response.status,503);assert.equal((await f.view()).setup.verified,false);}finally{await f.app.dispose();}}
  const protocol=new StripeProtocol();protocol.redirect=true;const f=await stripeFixture({protocol});try{assert.equal((await f.request('/connection/verify',{})).status,502);}finally{await f.app.dispose();}
  assert.throws(()=>createStripeBilling({accountId:'bad',mode:'test',currency:'usd',prices:[]}));assert.throws(()=>createBillingAccount({sellerOrigin:'https://example.test/path',sellerInstallationId:'x',sellerSiteId:'x',grantId:'x',customerId:'x',mode:'test'}));
});
test('customer creation is scoped, repeatable and recovers acceptance followed by response loss',async()=>{
  const f=await stripeFixture();try{await f.request('/connection/verify',{});const requestKey=key();f.protocol.dropAfter='/customers';const first=await f.request('/customers',{name:'Customer',email:'customer@example.test',idempotencyKey:requestKey});assert.equal(first.status,503);assert.equal((await f.view()).operations[0].state,'uncertain');const created=await customer(f,'Customer',requestKey);assert.ok(created);assert.equal([...f.protocol.objects.values()].filter(o=>o.object==='customer').length,1);assert.equal((await f.request('/customers',{name:'Changed',email:'customer@example.test',idempotencyKey:requestKey})).status,409);
    const duplicate=await Promise.all([f.request('/customers',{name:'Race',email:'race@example.test',idempotencyKey:'customer-race-key'}),f.request('/customers',{name:'Race',email:'race@example.test',idempotencyKey:'customer-race-key'})]);assert.ok(duplicate.some(r=>r.status===200));assert.equal((await f.view()).customers.length,2);
    assert.equal((await f.request('/customers',{name:'Invalid',email:'invalid',idempotencyKey:key()})).status,400);
    assert.ok(f.protocol.calls.every(c=>!JSON.stringify(c).includes('sk_test_fixture')));
  }finally{await f.app.dispose();}
});
test('approved recurring and one-off checkout use fixed return origins and never mark redirects paid',async()=>{
  const f=await stripeFixture();try{await f.request('/connection/verify',{});const c=await customer(f);assert.equal((await f.request(`/customers/${c}/checkout`,{priceId:'price_unapproved',reviewed:true,idempotencyKey:key()})).status,400);
    const requestKey=key(),response=await f.request(`/customers/${c}/checkout`,{priceId:'price_monthly',reviewed:true,idempotencyKey:requestKey});assert.equal(response.status,200,await response.clone().text());const result=await response.json() as {result:{sessionId:string;url:string}};assert.match(result.result.url,/^https:\/\/checkout.stripe.com/);assert.equal((await f.request(`/customers/${c}/checkout`,{priceId:'price_monthly',reviewed:true,idempotencyKey:requestKey})).status,200);assert.equal((await f.request(`/customers/${c}/checkout`,{priceId:'price_monthly',reviewed:true,idempotencyKey:key()})).status,200);assert.equal([...f.protocol.objects.values()].filter(o=>o.object==='checkout.session').length,1);
    const posted=f.protocol.calls.find(x=>x.path==='/checkout/sessions'&&x.method==='POST')!;assert.equal(posted.data.mode,'subscription');assert.equal(posted.data.success_url,`${f.origin}/#billing`);assert.equal((await f.view()).records.length,0);
    assert.equal((await f.request(`/customers/${c}/checkout`,{priceId:'price_once',reviewed:true,idempotencyKey:key()})).status,200);assert.ok(f.protocol.calls.some(x=>x.data.mode==='payment'));
    const monthly=f.protocol.objects.get(result.result.sessionId)!;monthly.status='complete';monthly.payment_status='paid';f.protocol.subscription((await f.view()).customers[0].stripeId);assert.equal((await f.request(`/customers/${c}/checkout`,{priceId:'price_monthly',reviewed:true,idempotencyKey:key()})).status,409);
    const once=[...f.protocol.objects.values()].find(o=>o.object==='checkout.session'&&o.mode==='payment')!;once.status='expired';assert.equal((await f.request(`/customers/${c}/checkout`,{priceId:'price_once',reviewed:true,idempotencyKey:key()})).status,200);const latest=[...f.protocol.objects.values()].filter(o=>o.object==='checkout.session'&&o.mode==='payment').at(-1)!;latest.status='complete';latest.payment_status='unpaid';assert.equal((await f.request(`/customers/${c}/checkout`,{priceId:'price_once',reviewed:true,idempotencyKey:key()})).status,409);
  }finally{await f.app.dispose();}
});
test('invoice drafts stay private and editable, issuance and email sending are separate idempotent operations',async()=>{
  const p=await stripePair();try{const f=p.seller,c=p.customerId,draftKey=key(),data={customerId:c,description:'Project work',lines:[{description:'Design',quantity:2,unitAmount:15000}],dueDays:14,revision:0,idempotencyKey:draftKey};let response=await f.request('/drafts',data);assert.equal(response.status,200);const draftId=(await response.json() as {result:{draftId:string}}).result.draftId;assert.equal((await p.client.view()).drafts.length,0);assert.equal([...f.protocol.objects.values()].filter(o=>o.object==='invoice').length,0);
    assert.equal((await f.request('/drafts',{...data,id:draftId,description:'Updated work',idempotencyKey:key()})).status,200);assert.equal((await f.request('/drafts',{...data,id:draftId,idempotencyKey:key()})).status,409);
    const issueKey=key();response=await f.request(`/drafts/${draftId}/issue`,{revision:1,reviewed:true,idempotencyKey:issueKey});assert.equal(response.status,200,await response.clone().text());const invoiceId=(await response.json() as {result:{invoiceId:string}}).result.invoiceId;const invoice=f.protocol.objects.get(invoiceId)!;assert.equal(f.protocol.calls.find(c=>c.method==='POST'&&c.path==='/invoices')?.data.pending_invoice_items_behavior,'exclude');assert.equal(invoice.total,30000);assert.equal(invoice.status,'open');assert.equal(invoice.sent,undefined);assert.ok(f.protocol.calls.filter(x=>x.path==='/invoiceitems'&&x.method==='POST').every(x=>x.data.invoice===invoiceId));
    assert.equal((await f.request(`/drafts/${draftId}/issue`,{revision:1,reviewed:true,idempotencyKey:issueKey})).status,200);assert.equal([...f.protocol.objects.values()].filter(o=>o.object==='invoice').length,1);assert.equal((await f.request(`/invoices/${invoiceId}/send`,{reviewed:false,idempotencyKey:key()})).status,400);assert.equal((await f.request(`/invoices/${invoiceId}/send`,{reviewed:true,idempotencyKey:key()})).status,200);assert.equal(invoice.sent,true);
    assert.equal((await p.client.request('/invoice-link',{invoiceId,kind:'pdf'})).status,200);assert.equal((await p.client.request('/invoice-link',{invoiceId:'in_foreign',kind:'pdf'})).status,403);assert.equal((await f.request('/drafts',{...data,id:draftId,revision:1,idempotencyKey:key()})).status,409);
  }finally{await p.dispose();}
});
test('failed renewal and recovery replace current seller/client state without an old failure regressing a paid invoice',async()=>{
  const p=await stripePair();try{
    const f=p.seller,remote=(await f.view()).customers[0].stripeId,sub=f.protocol.subscription(remote);
    const invoice={id:'in_renewal',object:'invoice',livemode:false,customer:remote,status:'open',currency:'usd',total:25000,amount_due:25000,amount_paid:0,amount_remaining:25000,number:'RENEWAL-1',billing_reason:'subscription_cycle',collection_method:'charge_automatically'};
    const payment={id:'pi_renewal',object:'payment_intent',livemode:false,customer:remote,status:'requires_payment_method',currency:'usd',amount:25000,amount_received:0};
    f.protocol.objects.set(invoice.id,invoice);f.protocol.objects.set(payment.id,payment);sub.status='past_due';
    const failure=f.protocol.event(invoice,'evt_renewal_failed','invoice.payment_failed');
    await f.webhook(failure);await f.webhook(f.protocol.event(sub,'evt_past_due'));await f.tick();await f.webhook(f.protocol.event(payment,'evt_payment_declined','payment_intent.payment_failed'));await f.tick();
    let view=await p.client.view();assert.equal(view.records.find(r=>r.id===sub.id)?.status,'past_due');assert.equal(view.records.find(r=>r.id===invoice.id)?.remaining,25000);assert.equal(view.records.find(r=>r.id===payment.id)?.paid,0);
    invoice.status='paid';invoice.amount_paid=25000;invoice.amount_remaining=0;payment.status='succeeded';payment.amount_received=25000;sub.status='active';
    await f.webhook(f.protocol.event(invoice,'evt_renewal_paid','invoice.paid'));await f.webhook(f.protocol.event(sub,'evt_recovered'));await f.tick();await f.webhook(f.protocol.event(payment,'evt_payment_recovered','payment_intent.succeeded'));await f.tick();
    await f.webhook({...failure,id:'evt_delayed_failure'});await f.tick();
    for(view of [await f.view(),await p.client.view()]){assert.equal(view.records.find(r=>r.id===sub.id)?.status,'active');assert.equal(view.records.find(r=>r.id===invoice.id)?.status,'paid');assert.equal(view.records.find(r=>r.id===invoice.id)?.remaining,0);assert.equal(view.records.filter(r=>r.id===invoice.id).length,1);assert.equal(view.records.find(r=>r.id===payment.id)?.paid,25000);}
  }finally{await p.dispose();}
});

test('portal date-based cancellations remain visible and can be cleared with a repeatable command',async()=>{
  const p=await stripePair();try{
    const f=p.seller,remote=(await f.view()).customers[0].stripeId;
    const sub={...f.protocol.subscription(remote),cancel_at_period_end:false,cancel_at:Math.floor(Date.now()/1000)+86400};
    f.protocol.objects.set(sub.id,sub);await f.webhook(f.protocol.event(sub,'evt_portal_cancel'));await f.tick();
    const record=(await p.client.view()).records.find(r=>r.id===sub.id)!;assert.equal(record.cancelAtPeriodEnd,false);assert.equal(record.cancelAt,sub.cancel_at);
    const requestKey=key();assert.equal((await f.request(`/subscriptions/${sub.id}/cancellation`,{cancel:false,reviewed:true,idempotencyKey:requestKey})).status,200);
    assert.equal((await f.view()).records.find(r=>r.id===sub.id)?.cancelAt,null);
    assert.equal((await f.request(`/subscriptions/${sub.id}/cancellation`,{cancel:false,reviewed:true,idempotencyKey:requestKey})).status,200);
    const writes=f.protocol.calls.filter(c=>c.method==='POST'&&c.path===`/subscriptions/${sub.id}`);assert.equal(writes.length,1);assert.deepEqual(writes[0].data,{cancel_at:''});
    assert.equal((await f.request(`/subscriptions/${sub.id}/cancellation`,{cancel:true,reviewed:true,idempotencyKey:key()})).status,200);assert.equal((await p.client.view()).records.find(r=>r.id===sub.id)?.cancelAtPeriodEnd,true);
  }finally{await p.dispose();}
});

test('raw signatures, expired signatures, duplicate events and late events reconcile current Stripe state',async()=>{
  const f=await stripeFixture();try{await f.request('/connection/verify',{});const c=await customer(f),remote=(await f.view()).customers.find(x=>x.id===c)!.stripeId,subscription=f.protocol.subscription(remote),event=f.protocol.event(subscription);
    assert.equal((await f.webhook(event,{'stripe-signature':'t=0,v1='+'0'.repeat(64)})).status,400);assert.equal((await f.webhook(event,{},1)).status,400);assert.equal((await f.webhook({...event,livemode:true})).status,400);assert.equal((await f.webhook({...event,account:'acct_foreign'})).status,400);
    assert.equal((await f.webhook(event)).status,200);assert.equal((await f.webhook(event)).status,200);await f.tick();assert.equal((await f.view()).records[0].status,'active');subscription.status='canceled';assert.equal((await f.webhook(event,{},Math.floor(Date.now()/1000))).status,200);assert.equal((await f.webhook({...event,id:'evt_late'})).status,200);await f.tick();assert.equal((await f.view()).records[0].status,'canceled');assert.equal((await f.db.prepare('SELECT count(*) n FROM billing_inbox').first<{n:number}>())?.n,2);
    const unknown=f.protocol.subscription('cus_unlinked','sub_foreign');assert.equal((await f.webhook(f.protocol.event(unknown,'evt_unknown'))).status,200);await f.tick();assert.ok(!(await f.view()).records.some(r=>r.id==='sub_foreign'));
  }finally{await f.app.dispose();}
});
test('separate admin pairing scopes records and portal sessions; invalid/revoked grants cannot read',async()=>{
  const p=await stripePair();try{const f=p.seller,other=await customer(f,'Another customer');await f.request('/drafts',{customerId:other,description:'Private',lines:[{description:'Internal',quantity:1,unitAmount:100}],dueDays:10,revision:0,idempotencyKey:key()});const view=await p.client.view();assert.equal(view.audience,'customer');assert.deepEqual(view.customers.map(c=>c.id),[p.customerId]);assert.deepEqual(view.drafts,[]);assert.equal((await p.client.request('/portal',{})).status,200);
    const portal=f.protocol.calls.find(x=>x.path==='/billing_portal/sessions'&&x.method==='POST')!;assert.equal(portal.data.customer,view.customers[0].stripeId);assert.equal(portal.data.return_url,`${p.client.origin}/#account-billing`);
    const forged=await f.app.dispatchFetch(`${f.origin}/api/modules/billing/hooks/account`,{method:'POST',headers:{authorization:'Bearer '+'0'.repeat(64),'x-billing-grant':p.grant.id,'content-type':'application/json'},body:JSON.stringify({action:'read',installationId:'stripe-client',siteId:'stripe-client',adminOrigin:p.client.origin})});assert.equal(forged.status,401);
    assert.equal((await p.client.request('/portal',{customerId:other})).status,400);assert.deepEqual(view.prices,[]);await p.client.db.prepare("UPDATE users SET active=0 WHERE id='owner'").run();assert.equal((await p.client.request()).status,401);
    const revoked=await stripeFixture({config:{grants:[{...p.grant,enabled:false}]}});try{const response=await revoked.app.dispatchFetch(`${revoked.origin}/api/modules/billing/hooks/account`,{method:'POST',headers:{authorization:`Bearer ${p.token}`,'x-billing-grant':p.grant.id,'content-type':'application/json'},body:JSON.stringify({action:'read',installationId:'stripe-client',siteId:'stripe-client',adminOrigin:p.client.origin})});assert.equal(response.status,401);}finally{await revoked.app.dispose();}
  }finally{await p.dispose();}
});
test('optional migration preserves prior authentication records and periodic reconciliation recovers missed events',async()=>{
  const f=await stripeFixture({missingMigration:true});try{const before=(await f.db.prepare('SELECT id,email,role FROM users ORDER BY id').all()).results;const {readFile}=await import('node:fs/promises');for(const statement of(await readFile('packages/admin/modules/billing/migrations/0010_stripe_billing.sql','utf8')).replace(/^--.*$/gm,'').split(';').filter(x=>x.trim()))await f.db.prepare(statement).run();assert.deepEqual((await f.db.prepare('SELECT id,email,role FROM users ORDER BY id').all()).results,before);await f.request('/connection/verify',{});const c=await customer(f),remote=(await f.view()).customers.find(x=>x.id===c)!.stripeId;f.protocol.subscription(remote);for(let n=0;n<4;n++)await f.tick();assert.ok((await f.view()).records.some(r=>r.id==='sub_fixture'));
    const scope=JSON.stringify(['other-installation','stripe-seller','acct_fixture','test']);await f.db.prepare('INSERT INTO billing_customers(scope,id,stripe_id,name,email,created_at) VALUES(?,?,?,?,?,?)').bind(scope,'foreign','cus_foreign','Private customer','foreign@example.test',1).run();assert.ok(!(await f.view()).customers.some(x=>x.id==='foreign'));
  }finally{await f.app.dispose();}
});
test('old uncertain operations never retry after the Stripe retention window and migration preserves auth',async()=>{
  const f=await stripeFixture();try{await f.request('/connection/verify',{});const k=key();f.protocol.dropAfter='/customers';await f.request('/customers',{name:'Pending',email:'customer@example.test',idempotencyKey:k});await f.db.prepare('UPDATE billing_operations SET created_at=? WHERE id=?').bind(Math.floor(Date.now()/1000)-86400,createHash('sha256').update(k).digest('hex')).run();const before=f.protocol.calls.filter(c=>c.method==='POST').length;assert.equal((await f.request('/customers',{name:'Pending',email:'customer@example.test',idempotencyKey:k})).status,409);assert.equal(f.protocol.calls.filter(c=>c.method==='POST').length,before);assert.equal((await f.db.prepare('SELECT count(*) n FROM users').first<{n:number}>())?.n,4);
  }finally{await f.app.dispose();}
});
