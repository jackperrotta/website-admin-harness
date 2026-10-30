import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createSchedulingBrowserFixture} from './scheduling-browser-fixture.ts';
import {schedulingFixture} from './scheduling-fixture.ts';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

test('background refresh shows failures, backs off, stops while hidden and recovers on visibility/focus/reconnect', {timeout:60000}, async () => {
 const fixture=await createSchedulingBrowserFixture();await fixture.reset(schedulingFixture());const browser=await chromium.launch({headless:true});
 try {
  const context=await browser.newContext();await context.addCookies([{name:'vitris-admin-local',value:fixture.sessions.get('owner')!,url:fixture.origin}]);const page=await context.newPage();await page.clock.install();
  let calls=0,fail=false;await page.route('**/api/modules/scheduling/appointments?*',async route=>{calls++;if(fail)await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic refresh failure'})});else await route.continue();});
  await page.goto(fixture.origin+'/#scheduling');await page.getByText(/Refreshes automatically every 30 seconds/).waitFor();const original=calls;
  fail=true;await page.clock.fastForward(30001);await page.getByText(/Schedule may be out of date: Synthetic refresh failure/).waitFor();assert.equal(calls,original+1);
  await page.clock.fastForward(30001);assert.equal(calls,original+1); // first failure retries after 60 seconds
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await page.clock.fastForward(300000);assert.equal(calls,original+1);
  fail=false;await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await page.getByText(/Refreshes automatically every 30 seconds/).waitFor();assert.equal(calls,original+2);
  for(const event of ['focus','online']) {await page.waitForTimeout(100);const response=page.waitForResponse(r=>r.url().includes('/appointments?'));await page.evaluate(event=>window.dispatchEvent(new Event(event)),event);await response;}
  assert.equal(calls,original+4);
 } finally {await browser.close();await fixture.app.dispose();}
});

test('booking connection diagnostics show public metadata on mobile without exposing credentials or overflowing', {timeout:60000}, async () => {
 const fixture=await createSchedulingBrowserFixture({websiteOrigin:'http://localhost:4392',bindings:{BOOKING_ENABLED:'1',BOOKING_LOCAL_TEST:'1'}});
 const config=schedulingFixture();config.publicBooking={enabled:true,serviceIds:['visit'],allowProviderChoice:true,policyText:'Local synthetic policy'};await fixture.reset(config);
 const browser=await chromium.launch({headless:true});
 try {
  const context=await browser.newContext({viewport:{width:390,height:844}});await context.addCookies([{name:'vitris-admin-local',value:fixture.sessions.get('owner')!,url:fixture.origin}]);const page=await context.newPage();
  await page.goto(fixture.origin+'/#scheduling');await page.getByRole('button',{name:'Booking settings',exact:true}).click();await page.getByText('Ready for test bookings',{exact:true}).waitFor();
  const metadata=JSON.parse(await page.getByRole('textbox',{name:'Public scheduling metadata',exact:true}).inputValue());assert.equal(metadata.apiOrigin,fixture.origin);assert.equal(metadata.siteId,'scheduling-browser');assert.ok(!('token' in metadata));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await mkdir('artifacts/admin-booking-integration',{recursive:true});await page.screenshot({path:resolve('artifacts/admin-booking-integration/mobile-connection.png'),fullPage:true});
 } finally {await browser.close();await fixture.app.dispose();}
});
