import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {can,type BillingResponse,type BillingState} from '../packages/contracts/src/index.ts';
import {createBillingPair,createBillingFixture} from './billing-fixture.ts';
let pair:Awaited<ReturnType<typeof createBillingPair>>;
before(async()=>{pair=await createBillingPair();});after(async()=>{await pair?.dispose();});
beforeEach(async()=>{await pair.seller.db.prepare('DELETE FROM billing_prototype').run();});
const mutate=async(command:Record<string,unknown>,client=false)=>{const f=client?pair.client:pair.seller;return f.request('',{revision:(await f.state()).revision,idempotencyKey:randomUUID(),...command});};

test('billing modules preserve exact host, session, Origin and owner-only capabilities',async()=>{
  assert.ok(can('owner','billing:read'));assert.ok(can('owner','account-billing:manage'));
  for(const role of ['administrator','editor','analyst'] as const){assert.equal(can(role,'billing:read'),false);assert.equal(can(role,'account-billing:read'),false);for(const f of [pair.seller,pair.client])assert.equal((await f.request('',undefined,role)).status,403);}
  for(const f of [pair.seller,pair.client]){assert.equal((await f.request('',undefined,'none')).status,401);assert.equal((await f.request('',{action:'card'},'owner',{origin:'https://evil.example.test'})).status,403);assert.equal((await f.app.dispatchFetch('http://localhost:4394/api/modules/billing',{headers:{cookie:f.cookies.owner}})).status,421);}
  await pair.client.db.prepare("UPDATE users SET active=0 WHERE id='owner'").run();assert.equal((await pair.client.request()).status,401);await pair.client.db.prepare("UPDATE users SET active=1 WHERE id='owner'").run();
});
test('separate client installation sees only its account, excludes drafts and notes, and cannot select another customer',async()=>{
  const seller=await pair.seller.state(),client=await pair.client.state();assert.equal(seller.customers.length,5);assert.deepEqual(client.customers.map(c=>c.id),['alder']);assert.ok(client.subscriptions.every(s=>s.customerId==='alder'));assert.ok(client.invoices.every(i=>i.customerId==='alder'&&i.status!=='draft'));assert.ok(client.payments.every(p=>p.customerId==='alder'));assert.equal(client.customers[0].note,'');assert.ok(!JSON.stringify(client).includes('northline.example.test'));
  assert.equal((await pair.client.request('/account/sunday')).status,404);assert.equal((await pair.client.request('/invoices/inv-3/document')).status,404);
  assert.equal((await mutate({action:'plan',subscriptionId:'sub-sunday',planId:'essential',timing:'renewal',reviewed:true},true)).status,404);
  assert.equal((await mutate({action:'draft',customerId:'alder',description:'Forged',due:'2027-01-01',lines:[{description:'Line',quantity:1,unitAmount:100}]},true)).status,403);
  assert.equal((await mutate({action:'card',reviewed:true,customerId:'sunday'},true)).status,400);
  const document=await pair.client.request('/invoices/inv-1/document');assert.equal(document.status,200);assert.match(document.headers.get('content-disposition')!,/sample-INV/);assert.match(await document.text(),/SAMPLE INVOICE/);
  assert.equal((await pair.client.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='billing_prototype'").first<{n:number}>())?.n,0);
});
test('draft creation, explicit send and customer payment are separate durable repeatable actions',async()=>{
  const before=await pair.seller.state(),draft={revision:before.revision,idempotencyKey:randomUUID(),action:'draft',customerId:'alder',description:'Sample project',due:'2027-01-01',lines:[{description:'A new page',quantity:2,unitAmount:15000}]};
  let response=await pair.seller.request('',draft);assert.equal(response.status,200);let value=await response.json() as BillingResponse;const invoice=value.invoices[0];assert.equal(invoice.status,'draft');assert.equal(value.payments.length,before.payments.length);assert.ok(!(await pair.client.state()).invoices.some(i=>i.id===invoice.id));
  assert.equal((await pair.seller.request('',draft)).status,200);assert.equal((await mutate({action:'draft',invoiceId:invoice.id,customerId:'alder',description:'Revised sample project',due:'2027-01-01',lines:[{description:'A new page',quantity:2,unitAmount:15000}]})).status,200);assert.equal((await pair.seller.state()).invoices.find(i=>i.id===invoice.id)?.description,'Revised sample project');assert.equal((await pair.seller.state()).invoices.length,before.invoices.length+1);assert.equal((await pair.seller.request('',{...draft,description:'Changed payload'})).status,409);
  assert.equal((await mutate({action:'send',invoiceId:invoice.id,reviewed:false})).status,400);
  response=await mutate({action:'send',invoiceId:invoice.id,reviewed:true});assert.equal(response.status,200);assert.equal((await pair.client.state()).invoices.find(i=>i.id===invoice.id)?.status,'open');
  const client=await pair.client.state(),payment={revision:client.revision,idempotencyKey:randomUUID(),action:'pay',invoiceId:invoice.id,reviewed:true};response=await pair.client.request('',payment);assert.equal(response.status,200);assert.equal((await pair.seller.state()).invoices.find(i=>i.id===invoice.id)?.status,'paid');
  assert.equal((await pair.client.request('',payment)).status,200);value=await pair.seller.state();assert.equal(value.payments.filter(p=>p.invoiceId===invoice.id).length,1);assert.equal(value.payments.find(p=>p.invoiceId===invoice.id)?.amount,30000);assert.equal((await mutate({action:'void',invoiceId:invoice.id,reviewed:true})).status,409);
});
test('client plan changes schedule renewal, cancellation preserves the paid period, and both views agree',async()=>{
  const initial=await pair.client.state(),renewal=initial.subscriptions[0].renewal;
  assert.equal((await mutate({action:'plan',subscriptionId:'sub-alder',planId:'partner',timing:'now',reviewed:true},true)).status,400);
  assert.equal((await mutate({action:'plan',subscriptionId:'sub-alder',planId:'partner',timing:'renewal',reviewed:true},true)).status,200);
  let sub=(await pair.seller.state()).subscriptions.find(s=>s.id==='sub-alder')!;assert.equal(sub.planId,'studio');assert.equal(sub.scheduledPlanId,'partner');assert.equal(sub.renewal,renewal);
  assert.equal((await mutate({action:'cancel',subscriptionId:'sub-alder',reviewed:true},true)).status,200);sub=(await pair.client.state()).subscriptions[0];assert.equal(sub.status,'active');assert.equal(sub.cancelAtPeriodEnd,true);assert.equal(sub.scheduledPlanId,null);
  assert.equal((await mutate({action:'resume',subscriptionId:'sub-alder',reviewed:true},true)).status,200);assert.equal((await pair.client.state()).subscriptions[0].cancelAtPeriodEnd,false);
  assert.equal((await mutate({action:'card',reviewed:true},true)).status,200);assert.equal((await pair.client.state()).card.last4,'4444');
});
test('stale and concurrent writes, bad inputs and cross-installation data fail safely',async()=>{
  assert.equal((await mutate({action:'__proto__'})).status,400);
  const current=await pair.seller.state();const requests=await Promise.all([pair.seller.request('',{action:'connection',connected:false,revision:current.revision,idempotencyKey:randomUUID()}),pair.seller.request('',{action:'connection',connected:true,revision:current.revision,idempotencyKey:randomUUID()})]);assert.deepEqual(requests.map(r=>r.status).sort(),[200,409]);
  await mutate({action:'connection',connected:true});
  assert.equal((await pair.seller.request('',{action:'card',reviewed:true,revision:0,idempotencyKey:randomUUID()})).status,409);
  assert.equal((await mutate({action:'draft',customerId:'alder',description:'Bad lines',due:'2027-01-01',lines:[{description:'Invalid',quantity:1,unitAmount:-50}]})).status,400);
  assert.equal((await mutate({action:'draft',customerId:'alder',description:'Bad date',due:'2027-02-30',lines:[{description:'Valid',quantity:1,unitAmount:50}]})).status,400);
  await pair.seller.db.prepare('INSERT INTO billing_prototype(installation_id,site_id,payload) VALUES(?,?,?)').bind('other-installation','billing-seller-preview',JSON.stringify({private:'foreign records'})).run();assert.equal((await pair.seller.state()).customers.length,5);
  assert.equal((await pair.seller.request('',{revision:1,idempotencyKey:'valid-key',action:'draft',description:'x'.repeat(20000)})).status,413);
});
test('connection failures block financial changes without canceling subscriptions or inventing fresh account data',async()=>{
  await pair.seller.state();assert.equal((await mutate({action:'connection',connected:false})).status,200);assert.equal((await pair.client.state()).connection,false);assert.equal((await mutate({action:'pay',invoiceId:'inv-2',reviewed:true},true)).status,503);assert.equal((await pair.seller.state()).subscriptions[0].status,'active');await mutate({action:'connection',connected:true});assert.equal((await pair.client.state()).connection,true);
  const unpaired=await createBillingFixture({audience:'customer'});try{assert.equal((await unpaired.request()).status,503);}finally{await unpaired.app.dispose();}
});
test('ordinary installations need no billing tables and production cannot run either prototype',async()=>{
  for(const options of [{enabled:false,applyModuleMigration:false},{mode:'production',adminOrigin:'https://admin.example.test'},{backend:{provider:'vitris-harness' as const,origin:'https://backend.example.test',tenantId:'synthetic'}},{mode:'production'}]){
    const f=await createBillingFixture(options);try{assert.equal((await f.request()).status,options.mode==='production'&&!options.adminOrigin?503:404);if(options.enabled===false)assert.equal((await f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='billing_prototype'").first<{n:number}>())?.n,0);else assert.equal((await f.db.prepare('SELECT count(*) n FROM billing_prototype').first<{n:number}>())?.n,0);}finally{await f.app.dispose();}
  }
  const client=await createBillingFixture({audience:'customer',mode:'production',adminOrigin:'https://client.example.test'});try{assert.equal((await client.request()).status,404);}finally{await client.app.dispose();}
});
test('prototype migration preserves existing users and prior schema data',async()=>{
  const f=await createBillingFixture({enabled:false,applyModuleMigration:false});try{const original=(await f.db.prepare('SELECT id,email,role FROM users ORDER BY id').all()).results;const {readFile}=await import('node:fs/promises');const sql=await readFile('packages/admin/prototypes/billing/migrations/0001_billing_prototype.sql','utf8');await f.db.prepare(sql.replace(/^--.*$/gm,'').trim()).run();assert.deepEqual((await f.db.prepare('SELECT id,email,role FROM users ORDER BY id').all()).results,original);assert.equal((await f.db.prepare('SELECT count(*) n FROM billing_prototype').first<{n:number}>())?.n,0);}finally{await f.app.dispose();}
});
