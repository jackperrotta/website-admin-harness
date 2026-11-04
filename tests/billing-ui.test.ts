import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {createBillingPair,createBillingFixture} from './billing-fixture.ts';

test('seller and client use separate logins and share draft, sent and paid invoice workflows', {timeout:120000},async()=>{
  const pair=await createBillingPair(),browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext({viewport:{width:1536,height:1100}}),seller=await context.newPage(),client=await context.newPage(),errors:string[]=[];
    for(const page of [seller,client]){page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));}
    await mkdir('artifacts/billing-prototype',{recursive:true});
    await seller.goto(`${pair.seller.origin}/#billing`);await seller.getByRole('button',{name:'Open local demo'}).click();await seller.getByRole('heading',{name:'Billing, in good order.'}).waitFor();
    await seller.screenshot({path:resolve('artifacts/billing-prototype/seller-desktop.png'),fullPage:false});
    await client.goto(`${pair.client.origin}/#account-billing`);await client.getByRole('button',{name:'Open local demo'}).click();await client.getByRole('heading',{name:'Your billing. All together.'}).waitFor();
    assert.equal(await client.getByText('Northline Studio',{exact:true}).count(),0);assert.equal(await client.getByText('Internal note',{exact:true}).count(),0);
    await client.screenshot({path:resolve('artifacts/billing-prototype/client-desktop.png'),fullPage:false});
    // The two loopback hostnames deliberately keep browser cookies independent.
    await seller.reload();await seller.getByRole('heading',{name:'Billing, in good order.'}).waitFor();
    await seller.getByRole('button',{name:'Create invoice',exact:true}).click();let draft=seller.getByRole('dialog',{name:'Create an invoice'});
    await draft.getByLabel('Invoice title',{exact:true}).fill('A new services page');await draft.getByLabel('Line 1 description',{exact:true}).fill('Design and build');await draft.getByLabel('Line 1 quantity',{exact:true}).fill('2');await draft.getByLabel('Line 1 price',{exact:true}).fill('150');await draft.getByRole('button',{name:'Preview invoice'}).click();
    draft=seller.getByRole('dialog',{name:'Review invoice draft'});await draft.locator('.bl-invoice-total').getByText('$300',{exact:true}).waitFor();await seller.screenshot({path:resolve('artifacts/billing-prototype/invoice-preview-desktop.png'),fullPage:true});await draft.getByRole('button',{name:'Save invoice draft'}).click();await seller.getByRole('status').filter({hasText:'Invoice draft saved.'}).waitFor();
    let row=seller.locator('tr').filter({hasText:'A new services page'});await row.getByRole('button',{name:/^INV-/}).click();let invoice=seller.getByRole('dialog',{name:/Invoice INV-/});await invoice.getByRole('button',{name:'Edit draft'}).click();
    draft=seller.getByRole('dialog',{name:'Edit invoice draft'});assert.equal(await draft.getByLabel('Invoice title',{exact:true}).inputValue(),'A new services page');await draft.getByLabel('Invoice title',{exact:true}).fill('Updated services page');await draft.getByRole('button',{name:'Preview invoice'}).click();await seller.getByRole('button',{name:'Save invoice draft'}).click();await seller.getByRole('status').filter({hasText:'Invoice draft saved.'}).waitFor();
    await client.getByRole('button',{name:'Refresh billing'}).click();assert.equal(await client.getByText('Updated services page',{exact:true}).count(),0);
    row=seller.locator('tr').filter({hasText:'Updated services page'});await row.getByRole('button',{name:/^INV-/}).click();invoice=seller.getByRole('dialog',{name:/Invoice INV-/});await invoice.getByRole('button',{name:'Review & send'}).click();const send=seller.getByRole('dialog',{name:'Send this invoice?'});await send.getByRole('checkbox').check();await send.getByRole('button',{name:'Mark sent in preview'}).click();await seller.getByRole('status').filter({hasText:'No email was sent.'}).waitFor();
    await client.getByRole('button',{name:'Refresh billing'}).click();const clientRow=client.locator('tr').filter({hasText:'Updated services page'});await clientRow.getByRole('button',{name:/^INV-/}).click();await client.getByRole('dialog',{name:/Invoice INV-/}).getByRole('button',{name:'Pay invoice'}).click();const payment=client.getByRole('dialog',{name:'Pay this invoice?'});assert.equal(await payment.getByRole('button',{name:'Confirm sample payment'}).isDisabled(),true);await payment.getByRole('checkbox').check();await payment.getByRole('button',{name:'Confirm sample payment'}).click();await client.getByRole('status').filter({hasText:'No card was charged.'}).waitFor();
    await seller.getByRole('button',{name:'Refresh billing'}).click();await row.getByText('Paid',{exact:true}).waitFor();await client.reload();await clientRow.getByText('Paid',{exact:true}).waitFor();assert.deepEqual(errors,[]);
  }finally{await browser.close();await pair.dispose();}
});

test('client plan changes, cancellation, sample card updates and mobile layouts are reviewable', {timeout:120000},async()=>{
  const pair=await createBillingPair(),browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(10000);
    await page.goto(`${pair.client.origin}/#account-billing`);await page.getByRole('button',{name:'Open local demo'}).click();await page.getByRole('heading',{name:'Your billing. All together.'}).waitFor();await mkdir('artifacts/billing-prototype',{recursive:true});await page.screenshot({path:resolve('artifacts/billing-prototype/client-mobile.png'),fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('body *')].map(el=>({tag:el.tagName,c:el.className,right:el.getBoundingClientRect().right})).filter(el=>el.right>innerWidth+1).slice(0,20))));
    await page.getByRole('button',{name:'Change plan',exact:true}).click();let modal=page.getByRole('dialog',{name:'Change subscription plan'});await modal.getByRole('radio',{name:/Growth partner/}).check();assert.equal(await modal.getByRole('button',{name:'Schedule plan change'}).isDisabled(),true);await modal.getByRole('checkbox').check();assert.ok(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:resolve('artifacts/billing-prototype/plan-change-mobile.png'),fullPage:true});await modal.getByRole('button',{name:'Schedule plan change'}).click();await page.getByText(/Changing to Growth partner/).waitFor();
    await page.getByRole('button',{name:'Cancel subscription',exact:true}).click();modal=page.getByRole('dialog',{name:'Cancel your subscription?'});await modal.getByRole('checkbox').check();await modal.getByRole('button',{name:'Schedule cancellation'}).click();await page.getByText('Ending soon',{exact:true}).waitFor();await page.getByRole('button',{name:'Keep subscription',exact:true}).click();modal=page.getByRole('dialog',{name:'Keep your subscription'});await modal.getByRole('checkbox').check();await modal.getByRole('button',{name:'Keep subscription',exact:true}).click();await page.getByText('Active',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Update payment method'}).click();modal=page.getByRole('dialog',{name:'Update payment method'});assert.equal(await modal.locator('input:not([type=checkbox])').count(),0);await modal.getByRole('checkbox').check();await modal.getByRole('button',{name:'Save sample payment method'}).click();await page.getByText('Mastercard ending in 4444').waitFor();
    await page.goto(`${pair.seller.origin}/#billing`);await page.getByRole('button',{name:'Open local demo'}).click();await page.getByRole('heading',{name:'Billing, in good order.'}).waitFor();await page.screenshot({path:resolve('artifacts/billing-prototype/seller-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('body *')].map(el=>({tag:el.tagName,c:el.className,right:el.getBoundingClientRect().right})).filter(el=>el.right>innerWidth+1).slice(0,20))));
    await page.getByRole('button',{name:'Customers',exact:true}).click();await page.getByRole('button',{name:'Open Alder & Stone',exact:true}).click();await page.getByText('Internal note',{exact:true}).waitFor();await page.getByRole('button',{name:'All customers',exact:false}).click();await page.getByLabel('Search billing customers').fill('no match');await page.getByRole('heading',{name:'No customers match.'}).waitFor();
    await page.getByRole('button',{name:'Create invoice',exact:true}).click();const draft=page.getByRole('dialog',{name:'Create an invoice'});assert.ok(await draft.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:resolve('artifacts/billing-prototype/invoice-editor-mobile.png'),fullPage:true});await page.keyboard.press('Escape');assert.equal(await draft.count(),0);
  }finally{await browser.close();await pair.dispose();}
});

test('ordinary admins do not load or request billing and paused billing blocks client actions', {timeout:60000},async()=>{
  const ordinary=await createBillingFixture({enabled:false,applyModuleMigration:false}),pair=await createBillingPair(),browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage(),requests:string[]=[];page.on('request',r=>{if(/\/modules\/(billing|account-billing)|workspace-.*\.js/.test(r.url()))requests.push(r.url());});
    await page.goto(`${ordinary.origin}/#billing`);await page.getByRole('button',{name:'Open local demo'}).click();await page.getByRole('heading',{name:'Your website, at a glance.'}).waitFor();assert.equal(await page.getByRole('link',{name:'Billing',exact:true}).count(),0);assert.deepEqual(requests,[]);
    const state=await pair.seller.state();await pair.seller.request('',{action:'connection',connected:false,revision:state.revision,idempotencyKey:crypto.randomUUID()});await page.goto(`${pair.client.origin}/#account-billing`);await page.getByRole('button',{name:'Open local demo'}).click();await page.getByText('Billing connection paused',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Change plan',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Update payment method',exact:true}).isDisabled(),true);
  }finally{await browser.close();await ordinary.app.dispose();await pair.dispose();}
});
