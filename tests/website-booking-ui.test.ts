import {existsSync} from 'node:fs';
import {describe,test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium,type Browser,type BrowserContext,type Page} from 'playwright';
import {createWebsiteBookingFixture} from './website-booking-fixture.ts';
import type {SchedulingConfig} from '../packages/contracts/src/scheduling.ts';
describe('paired website/admin booking acceptance', () => {
let fixture:Awaited<ReturnType<typeof createWebsiteBookingFixture>>,browser:Browser,context:BrowserContext,page:Page,initialConfig:SchedulingConfig;
const target=new Date(Date.now()+3*86400000),date=target.toISOString().slice(0,10);const errors:string[]=[];
before(async()=>{assert.ok(existsSync(resolve('../vitris-harness/src/build/index.ts')),'Booking integration acceptance requires the sibling website source');await mkdir('artifacts/website-booking',{recursive:true});fixture=await createWebsiteBookingFixture();initialConfig=(await fixture.backend.config()).config;browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await fixture?.close();});
beforeEach(async()=>{const state=await fixture.backend.config();const reset=await fixture.backend.ownerPost('/configuration',{revision:state.revision,config:initialConfig});assert.equal(reset.status,200,await reset.text());for(const table of ['scheduling_reminder_windows','notification_fences','notification_admin_commands','scheduling_expiry_guards','scheduling_system_history','customer_management_commands','customer_management_sessions','customer_access_tokens','scheduling_notification_outbox','booking_history','booking_commands','booking_rate_limits','appointment_calendar_captures','calendar_conflicts','calendar_activity','calendar_export_jobs','calendar_event_links','scheduling_jobs','scheduling_history','scheduling_reservations','scheduling_appointments','scheduling_commands'])await fixture.backend.db.prepare(`DELETE FROM ${table}`).run();fixture.calendar.reset();context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Tokyo'});page=await context.newPage();page.setDefaultTimeout(15000);errors.length=0;page.on('pageerror',error=>errors.push(error.message));});
afterEach(async test=>{await page?.screenshot({path:resolve(`artifacts/website-booking/${test.name.replace(/[^a-z0-9]+/gi,'-').slice(0,65)}.png`),fullPage:true});await context?.close();assert.deepEqual(errors,[]);});
async function open(){await page.goto(fixture.origin+'/book');await page.getByRole('heading',{name:'Choose a service',exact:true}).waitFor();}
async function chooseTime(){await page.getByRole('button',{name:'Choose a time',exact:true}).click();await page.getByLabel('Appointment date',{exact:true}).fill(date);await page.getByRole('button',{name:'Find available times',exact:true}).click();await page.getByRole('button',{name:new RegExp('at 12:00 PM GMT')}).click();await page.getByRole('button',{name:'Continue to your details',exact:true}).click();}
async function details(name='Website Sample'){await page.getByLabel('Full name',{exact:true}).fill(name);await page.getByLabel('Email address',{exact:true}).fill('website-customer@example.test');await page.getByRole('button',{name:'Review appointment',exact:true}).click();await page.getByRole('checkbox',{name:'I have read and accept the booking policy.',exact:true}).check();}

test('a customer books through the compiled website and the appointment is visible in the admin calendar', {timeout:120000},async()=>{
 await open();await chooseTime();await details();await page.screenshot({path:resolve('artifacts/website-booking/desktop-review.png'),fullPage:true});await page.getByRole('button',{name:'Confirm appointment',exact:true}).click();await page.getByRole('heading',{name:'Appointment confirmed',exact:true}).waitFor();
 const row=await fixture.backend.db.prepare('SELECT id,customer_json FROM scheduling_appointments').first<{id:string;customer_json:string}>();assert.ok(row);assert.equal(JSON.parse(row.customer_json).name,'Website Sample');assert.equal([...fixture.calendar.events.values()].filter(e=>e.marker).length,1);
 const downloading=page.waitForEvent('download');await page.getByRole('link',{name:'Download calendar file (.ics)',exact:true}).click();const file=await(await downloading).path();assert.ok(file);assert.match(await readFile(file,'utf8'),/BEGIN:VCALENDAR/);
 const admin=await context.newPage();await context.addCookies([{name:'vitris-admin-local',value:fixture.backend.sessions.get('owner')!,url:fixture.backend.origin,httpOnly:true,sameSite:'Strict'}]);await admin.goto(fixture.backend.origin+'/#scheduling');await admin.getByRole('navigation',{name:'Scheduling sections'}).waitFor();await admin.getByRole('button',{name:'Day',exact:true}).click();await admin.getByLabel('Calendar date',{exact:true}).fill(date);await admin.getByRole('button').filter({hasText:'Website Sample'}).click();await admin.getByRole('heading',{name:'Appointment details',exact:true}).waitFor();await admin.getByText('Customer booked on website',{exact:true}).waitFor();await admin.screenshot({path:resolve('artifacts/website-booking/admin-customer-appointment.png'),fullPage:true});
});

test('lost booking responses retain the same request and recover without a duplicate', {timeout:120000},async()=>{
 await open();await chooseTime();await details('Lost Response Sample');let dropped=false;await page.route('**/api/booking/v1/appointments',async route=>{if(!dropped){dropped=true;await route.fetch();await route.abort('failed');}else await route.continue();});
 await page.getByRole('button',{name:'Confirm appointment',exact:true}).click();await page.getByRole('button',{name:'Retry same booking',exact:true}).waitFor();await page.getByRole('button',{name:'Retry same booking',exact:true}).click();await page.getByRole('heading',{name:'Appointment confirmed',exact:true}).waitFor();assert.equal((await fixture.backend.db.prepare('SELECT count(*) AS n FROM scheduling_appointments').first<{n:number}>())?.n,1);
});

test('stale booking details preserve customer inputs and display current service terms', {timeout:120000},async()=>{
 await open();await chooseTime();await details('Retained Customer');const state=await fixture.backend.config();state.config.services[0].price.amountMinor=7500;await fixture.backend.ownerPost('/configuration',state);
 await page.getByRole('button',{name:'Confirm appointment',exact:true}).click();await page.getByRole('heading',{name:'Choose a time',exact:true}).waitFor();await page.getByRole('button',{name:'Find available times',exact:true}).click();await page.getByRole('complementary',{name:'Appointment summary'}).getByText('$75.00',{exact:true}).waitFor();await page.getByRole('button',{name:new RegExp('at 12:00 PM GMT')}).click();await page.getByRole('button',{name:'Continue to your details',exact:true}).click();assert.equal(await page.getByLabel('Full name',{exact:true}).inputValue(),'Retained Customer');
});

test('approval flow, keyboard access and mobile layout use the standard component', {timeout:120000},async()=>{
 const state=await fixture.backend.config();state.config.services[0].bookingMode='approval';await fixture.backend.ownerPost('/configuration',state);await page.setViewportSize({width:390,height:844});await open();await page.getByRole('button',{name:'Choose a time',exact:true}).focus();await page.keyboard.press('Enter');await page.getByLabel('Appointment date',{exact:true}).fill(date);await page.getByRole('button',{name:'Find available times',exact:true}).click();await page.getByRole('button',{name:new RegExp('at 12:00 PM GMT')}).click();await page.getByRole('button',{name:'Continue to your details',exact:true}).click();await details('Approval Customer');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve('artifacts/website-booking/mobile-review.png'),fullPage:true});await page.addScriptTag({path:resolve('../vitris-harness/node_modules/axe-core/axe.min.js')});const audit=await page.evaluate(async()=>await(window as unknown as {axe:{run:(options:unknown)=>Promise<{violations:{id:string;impact:string}[]}>}}).axe.run({runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));await writeFile('artifacts/website-booking/accessibility.json',JSON.stringify(audit,null,2));assert.deepEqual(audit.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id),[]);await page.getByRole('button',{name:'Request appointment',exact:true}).click();await page.getByRole('heading',{name:'Request received',exact:true}).waitFor();assert.equal((await fixture.backend.db.prepare('SELECT status FROM scheduling_appointments').first<{status:string}>())?.status,'pending_approval');
});

test('the website reports empty services without offering an invalid booking', {timeout:60000}, async()=>{
 const state=await fixture.backend.config();for(const service of state.config.services)service.active=false;await fixture.backend.ownerPost('/configuration',state);await open();await page.getByText('No services are available for online booking. Please contact the business.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Choose a time',exact:true}).count(),0);
});

test('an already-open admin calendar automatically receives a website booking and preserves an open draft', {timeout:90000}, async()=>{
 const admin=await context.newPage();await context.addCookies([{name:'vitris-admin-local',value:fixture.backend.sessions.get('owner')!,url:fixture.backend.origin,httpOnly:true,sameSite:'Strict'}]);
 await admin.goto(fixture.backend.origin+'/#scheduling');await admin.getByRole('button',{name:'Day',exact:true}).click();
 const loaded=admin.waitForResponse(response=>response.url().includes('/appointments?') && new URL(response.url()).searchParams.get('startsAt')?.startsWith(date)===true);
 await admin.getByLabel('Calendar date',{exact:true}).fill(date);await loaded;await admin.getByText('No appointments',{exact:true}).waitFor();
 const overview=await context.newPage();await overview.goto(fixture.backend.origin+'/#overview');await overview.getByRole('region',{name:'Appointment overview'}).getByText('0 upcoming · 0 needing approval',{exact:true}).waitFor();
 await admin.getByRole('button',{name:'+ New appointment',exact:true}).click();await admin.getByLabel('Customer name',{exact:true}).fill('Keep this unsaved draft');
 await open();await chooseTime();await details('Automatic Website Customer');
 const started=Date.now();await page.getByRole('button',{name:'Confirm appointment',exact:true}).click();await page.getByRole('heading',{name:'Appointment confirmed',exact:true}).waitFor();
 await admin.locator('.sc-appointment').filter({hasText:'Automatic Website Customer'}).waitFor({timeout:40000});
 await overview.getByRole('link',{name:'Automatic Website Customer · Synthetic appointment',exact:true}).waitFor({timeout:40000});
 assert.ok(Date.now()-started<40000);assert.equal(await admin.getByLabel('Customer name',{exact:true}).inputValue(),'Keep this unsaved draft');
 await admin.screenshot({path:resolve('artifacts/website-booking/automatic-refresh-draft.png'),fullPage:true});
 await admin.getByRole('button',{name:'Close new appointment',exact:true}).click();
 await admin.getByRole('button').filter({hasText:'Automatic Website Customer'}).click();await admin.getByRole('dialog').getByText('Website',{exact:true}).waitFor();await admin.getByText('Accepted booking policy',{exact:true}).waitFor();
 await admin.screenshot({path:resolve('artifacts/website-booking/automatic-booking-details.png'),fullPage:true});
 await overview.screenshot({path:resolve('artifacts/website-booking/automatic-overview.png'),fullPage:true});
 await overview.getByRole('link',{name:'Automatic Website Customer · Synthetic appointment',exact:true}).click();await overview.getByRole('heading',{name:'Appointment details',exact:true}).waitFor();
});

});
