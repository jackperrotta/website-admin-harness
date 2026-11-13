import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {setupFixture} from './billing-setup-fixture.ts';

test('owner configures plans and policies in the packaged admin without enabling live charges',{timeout:90000},async()=>{
  const f=await setupFixture({config:{mode:'live'},liveGate:true}),browser=await chromium.launch({headless:true});
  try{
    await f.save();const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
    await page.context().addCookies([{name:'vitris-admin-local',value:f.cookies.owner.split('=')[1],url:f.origin}]);await page.goto(f.origin+'/#billing');await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('heading',{name:'Prepare billing, then enable it.'}).waitFor();
    assert.equal(await page.getByLabel('Secret or restricted key',{exact:true}).inputValue(),'');
    await page.getByLabel('Plan or service name').fill('Website care');await page.getByLabel('Price amount (USD)').fill('125');await page.getByLabel('I reviewed this price and the selected Stripe mode.').check();await page.getByRole('button',{name:'Create and approve price',exact:true}).click();await page.getByRole('status').filter({hasText:'Price created and approved.'}).waitFor();
    assert.equal([...f.protocol.objects.values()].find(v=>v.id.startsWith('price_created'))?.unit_amount,12500);
    await page.getByLabel('Clients can switch between approved recurring plans.').check();await page.getByLabel('Clients can cancel their subscription.').check();await page.getByLabel('Default invoice due days').fill('30');
    await page.getByLabel('Retry schedule and final failed-payment action').fill('Reviewed retries in Stripe and final unpaid action.');await page.getByLabel('Invoice, receipt and failed-payment email review').fill('Reviewed Stripe emails and confirmed sandbox invoice delivery.');await page.getByLabel('Tax treatment review').fill('Reviewed tax requirements for these services.');
    await page.getByLabel('I reviewed sandbox checkout, invoices/email delivery, renewals, failed-payment recovery, plan changes, cancellation and client access.').check();
    assert.equal(await page.getByRole('button',{name:'Apply saved policies to Stripe'}).isDisabled(),true);
    await page.getByRole('button',{name:'Save billing policies',exact:true}).click();await page.getByRole('status').filter({hasText:'Policies saved.'}).waitFor();
    await page.getByRole('button',{name:'Apply saved policies to Stripe'}).click();await page.getByRole('status').filter({hasText:'Saved policies applied'}).waitFor();
    await page.getByRole('button',{name:'Check launch readiness'}).click();await page.getByText('Needs attention — Signed webhook delivery',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Enable live billing',exact:true}).isDisabled(),true);assert.equal((await f.status()).activated,false);
    assert.ok(f.protocol.calls.filter(c=>c.method==='POST').every(c=>['/prices','/billing_portal/configurations'].includes(c.path)));
    await mkdir('artifacts/stripe-billing',{recursive:true});await page.screenshot({path:'artifacts/stripe-billing/managed-setup-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'artifacts/stripe-billing/managed-setup-mobile.png',fullPage:true});
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await f.app.dispose();}
});

test('an unconnected managed installation opens setup instead of a dead-end dashboard error',{timeout:60000},async()=>{
  const f=await setupFixture(),browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.context().addCookies([{name:'vitris-admin-local',value:f.cookies.owner.split('=')[1],url:f.origin}]);await page.goto(f.origin+'/#billing');await page.getByRole('heading',{name:'Prepare billing, then enable it.'}).waitFor();assert.equal(await page.getByRole('button',{name:'Verify and save connection'}).count(),1);assert.equal(f.protocol.calls.filter(c=>c.method==='POST').length,0);}finally{await browser.close();await f.app.dispose();}
});
