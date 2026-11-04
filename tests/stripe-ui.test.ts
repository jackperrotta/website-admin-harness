import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {stripeFixture,stripePair} from './stripe-fixture.ts';

test('seller and client show one-off payment results without treating unsettled payments or checkout completion as paid', {timeout:60000},async()=>{
  const p=await stripePair(),browser=await chromium.launch({headless:true});
  try{
    const remote=(await p.seller.view()).customers[0].stripeId;
    for(const [id,status] of [['pi_success','succeeded'],['pi_pending','requires_action']]){
      const payment={id,object:'payment_intent',livemode:false,customer:remote,status,currency:'usd',amount:75000,amount_received:status==='succeeded'?75000:0,description:'One-off project service',created:1793793600};
      p.seller.protocol.objects.set(id,payment);await p.seller.webhook(p.seller.protocol.event(payment,'evt_'+id,'payment_intent.succeeded'));
    }
    const ended=p.seller.protocol.subscription(remote,'sub_ended');ended.status='canceled';ended.cancel_at_period_end=true;await p.seller.webhook(p.seller.protocol.event(ended,'evt_ended'));
    const unsettled={id:'cs_test_unsettled',object:'checkout.session',livemode:false,customer:remote,status:'complete',payment_status:'unpaid',currency:'usd',amount_total:75000};
    p.seller.protocol.objects.set(unsettled.id,unsettled);await p.seller.webhook(p.seller.protocol.event(unsettled,'evt_unsettled','checkout.session.completed'));
    await p.seller.tick();await p.seller.tick();
    for(const [fixture,route] of [[p.seller,'billing'],[p.client,'account-billing']] as const){
      const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(10000);
      await page.context().addCookies([{name:'vitris-admin-local',value:fixture.cookies.owner.split('=')[1],url:fixture.origin}]);await page.goto(`${fixture.origin}/#${route}`);
      const history=page.getByRole('table',{name:'Payment history',exact:true});await history.getByText('Successful',{exact:true}).waitFor();await history.getByText('Action needed',{exact:true}).waitFor();
      const endedRow=page.getByRole('row').filter({hasText:'sub_ended'});await endedRow.getByRole('cell',{name:'Ended',exact:true}).waitFor();assert.equal(await endedRow.getByRole('cell',{name:String.fromCharCode(8212),exact:true}).count(),1);assert.equal(await endedRow.getByRole('button',{name:'Cancel at period end',exact:true}).count(),0);
      assert.equal(await history.getByRole('row').count(),3);assert.equal(await history.getByText('$750.00',{exact:true}).count(),2);assert.equal(await history.getByText('Paid',{exact:true}).count(),0);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.close();
    }
  }finally{await browser.close();await p.dispose();}
});

test('actual Stripe module shows setup, verifies account and separates invoice drafting, finalization and sending', {timeout:90000},async()=>{
  const f=await stripeFixture(),browser=await chromium.launch({headless:true});
  try{const page=await browser.newPage({viewport:{width:1536,height:1100}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
    await page.context().addCookies([{name:'vitris-admin-local',value:f.cookies.owner.split('=')[1],url:f.origin}]);await page.goto(`${f.origin}/#billing`);await page.getByRole('heading',{name:'Connect this business’s Stripe account'}).waitFor();assert.equal(await page.getByRole('button',{name:'Open local demo'}).count(),0);assert.equal(f.protocol.calls.filter(c=>c.method==='POST').length,0);
    await mkdir('artifacts/stripe-billing',{recursive:true});await page.screenshot({path:resolve('artifacts/stripe-billing/setup-desktop.png'),fullPage:false});
    await page.getByRole('button',{name:'Verify Stripe connection',exact:true}).click();await page.getByRole('status').filter({hasText:'Stripe account identity verified.'}).waitFor();await page.getByRole('button',{name:'Add customer',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Add a billing customer'});await dialog.getByLabel('Customer name',{exact:true}).fill('New business client');await dialog.getByLabel('Billing email',{exact:true}).fill('client@example.test');await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Create customer',exact:true}).click();await page.getByRole('status').filter({hasText:'Stripe customer created.'}).waitFor();
    await page.getByRole('button',{name:'Invoices',exact:true}).click();await page.getByRole('button',{name:'Create invoice',exact:true}).click();dialog=page.getByRole('dialog',{name:'Invoice draft'});await dialog.getByLabel('Invoice description',{exact:true}).fill('Website services');await dialog.getByLabel('Line 1 description',{exact:true}).fill('Design services');await dialog.getByLabel('Line 1 amount',{exact:true}).fill('100');await dialog.getByRole('button',{name:'Preview draft'}).click();await dialog.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('status').filter({hasText:'Invoice draft saved.'}).waitFor();assert.equal([...f.protocol.objects.values()].filter(o=>o.object==='invoice').length,0);
    await page.getByRole('button',{name:'Review & finalize'}).click();dialog=page.getByRole('dialog',{name:'Finalize this invoice?'});await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Finalize invoice',exact:true}).click();await page.getByRole('status').filter({hasText:'Invoice finalized.'}).waitFor();assert.equal([...f.protocol.objects.values()].find(o=>o.object==='invoice')?.sent,undefined);
    await page.getByRole('button',{name:'Send invoice',exact:true}).click();dialog=page.getByRole('dialog',{name:'Send this invoice?'});await dialog.getByText('STRIPE SANDBOX',{exact:true}).waitFor();await dialog.getByText('Stripe accepts the test send, but its test-mode API does not deliver an email.',{exact:false}).waitFor();assert.equal(await dialog.getByText('BILLING PREVIEW',{exact:true}).count(),0);assert.equal(await dialog.getByRole('button',{name:'Send invoice',exact:true}).isDisabled(),true);await dialog.getByRole('checkbox').check();await page.screenshot({path:resolve('artifacts/stripe-billing/send-confirmation.png'),fullPage:false});await dialog.getByRole('button',{name:'Send invoice',exact:true}).click();await page.getByRole('status').filter({hasText:'Invoice send accepted by Stripe.'}).waitFor();assert.equal([...f.protocol.objects.values()].find(o=>o.object==='invoice')?.sent,true);assert.deepEqual(errors,[]);
  }finally{await browser.close();await f.app.dispose();}
});
test('separate client account UI contains only authorized records and fits a phone', {timeout:60000},async()=>{
  const p=await stripePair(),browser=await chromium.launch({headless:true});
  try{const remote=(await p.seller.view()).customers[0].stripeId,sub=p.seller.protocol.subscription(remote);await p.seller.webhook(p.seller.protocol.event(sub));await p.seller.tick();const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(10000);await page.context().addCookies([{name:'vitris-admin-local',value:p.client.cookies.owner.split('=')[1],url:p.client.origin}]);await page.goto(`${p.client.origin}/#account-billing`);await page.getByRole('heading',{name:'Your billing. All together.'}).waitFor();await page.getByRole('button',{name:'Manage billing',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Add customer',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Create invoice',exact:true}).count(),0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await mkdir('artifacts/stripe-billing',{recursive:true});await page.screenshot({path:resolve('artifacts/stripe-billing/client-mobile.png'),fullPage:true});assert.equal(p.client.protocol.calls.length,0);
  }finally{await browser.close();await p.dispose();}
});
