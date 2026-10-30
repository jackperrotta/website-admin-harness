import {test, before, after, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium, type Browser, type BrowserContext, type Page} from 'playwright';
import {createSchedulingBrowserFixture} from './scheduling-browser-fixture.ts';
import {schedulingFixture} from './scheduling-fixture.ts';
import {emptySchedulingConfig} from '../packages/contracts/src/scheduling.ts';

let fixture: Awaited<ReturnType<typeof createSchedulingBrowserFixture>>, browser: Browser, context: BrowserContext, page: Page;
const errors: string[] = [];
const target = new Date(Date.now() + 10 * 86400000); while (target.getUTCDay() !== 1) target.setUTCDate(target.getUTCDate() + 1);
const date = target.toISOString().slice(0, 10), nextDate = new Date(target.getTime() + 86400000).toISOString().slice(0, 10);
before(async () => {await mkdir('artifacts/scheduling-ui', {recursive: true}); fixture = await createSchedulingBrowserFixture(); browser = await chromium.launch({headless: true});});
after(async () => {await browser?.close(); await fixture?.app.dispose();});
beforeEach(async () => {await fixture.reset(schedulingFixture()); context = await browser.newContext({viewport: {width: 1440, height: 1000}, timezoneId: 'Asia/Tokyo'}); await login('owner'); errors.length = 0; page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));});
afterEach(async test => {if (page && !page.isClosed()) await page.screenshot({path: resolve(`artifacts/scheduling-ui/${test.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 65)}.png`), fullPage: true}); await context?.close(); assert.deepEqual(errors, [], 'No uncaught browser errors');});
async function login(user: string) {await context.addCookies([{name: 'vitris-admin-local', value: fixture.sessions.get(user)!, url: fixture.origin, httpOnly: true, sameSite: 'Strict'}]);}
async function open() {await page.goto(`${fixture.origin}/#scheduling`); await page.getByRole('navigation', {name: 'Scheduling sections'}).waitFor();}
async function section(name: string) {await page.getByRole('navigation', {name: 'Scheduling sections'}).getByRole('button', {name, exact: true}).click();}
async function waitSaved() {await page.getByRole('dialog').waitFor({state: 'hidden'}); await page.getByRole('status').filter({hasText: 'Changes saved'}).waitFor(); await page.getByRole('button', {name: 'Refresh schedule', exact: true}).waitFor();}
async function showDate() {await section('Calendar'); await page.getByRole('button', {name: 'Day', exact: true}).click(); await page.getByLabel('Calendar date', {exact: true}).fill(date);}
async function createAppointment(name = 'Alex Synthetic') {
  await page.getByRole('button', {name: '+ New appointment', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'New appointment'});
  await dialog.getByLabel('Customer name', {exact: true}).fill(name); await dialog.getByLabel('Customer email', {exact: true}).fill('synthetic-customer@example.test');
  await dialog.getByLabel('Appointment date', {exact: true}).fill(date);
  await dialog.getByRole('button', {name: 'Find available times', exact: true}).click();
  await dialog.getByRole('button', {name: /^9:00 AM GMT/}).click();
  await dialog.getByRole('button', {name: 'Save appointment', exact: true}).click(); await waitSaved();
}

test('calendar creates, approves, reschedules and cancels appointments in real local D1', {timeout: 120000}, async () => {
  const config = schedulingFixture(); config.services[0].bookingMode = 'approval'; await fixture.reset(config);
  await open(); await showDate(); await createAppointment();
  await page.getByRole('button').filter({hasText: 'Alex Synthetic'}).click();
  let dialog = page.getByRole('dialog', {name: 'Appointment details'});
  await dialog.getByRole('button', {name: 'Approve appointment', exact: true}).click(); await waitSaved();
  await page.getByRole('button').filter({hasText: 'Alex Synthetic'}).click();
  await page.getByRole('dialog').getByRole('button', {name: 'Reschedule', exact: true}).click();
  dialog = page.getByRole('dialog', {name: 'Reschedule appointment'});
  await dialog.getByLabel('Appointment date', {exact: true}).fill(nextDate); await dialog.getByRole('button', {name: 'Find available times', exact: true}).click();
  await dialog.getByRole('button', {name: /^9:30 AM GMT/}).click(); await dialog.getByRole('button', {name: 'Save new time', exact: true}).click(); await waitSaved();
  await page.getByLabel('Calendar date', {exact: true}).fill(nextDate);
  await page.getByRole('button').filter({hasText: 'Alex Synthetic'}).click();
  await page.getByRole('dialog').getByRole('button', {name: 'Cancel appointment', exact: true}).click();
  await page.getByRole('button', {name: 'Confirm cancellation', exact: true}).click(); await waitSaved();
  await page.getByLabel('Status filter', {exact: true}).selectOption('all');
  await page.getByRole('button').filter({hasText: 'Alex Synthetic'}).waitFor();
  const row = await fixture.db.prepare('SELECT status,revision,starts_at FROM scheduling_appointments').first<{status: string; revision: number; starts_at: number}>();
  assert.equal(row?.status, 'cancelled'); assert.equal(row.revision, 4);
  assert.equal(new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit'}).format(row.starts_at), '09:30');
  assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM scheduling_history WHERE appointment_id IS NOT NULL').first<{n: number}>())?.n, 4);
  await page.getByRole('button', {name: 'Week', exact: true}).click();
  await page.getByRole('region', {name: 'Week calendar', exact: true}).waitFor();
  await page.screenshot({path: resolve('artifacts/scheduling-ui/desktop-calendar.png'), fullPage: true});
});

test('service, staff and availability editors persist configuration and time-off changes', {timeout: 120000}, async () => {
  await open(); await section('Team'); await page.getByRole('button', {name: 'Add staff or resource', exact: true}).click();
  let dialog = page.getByRole('dialog'); await dialog.getByLabel('Staff or resource name', {exact: true}).fill('Morgan Synthetic');
  await dialog.getByLabel('Linked account', {exact: true}).selectOption('provider-user'); await dialog.getByLabel('Scheduling access', {exact: true}).selectOption('manage');
  await dialog.getByRole('button', {name: 'Save staff or resource', exact: true}).click(); await waitSaved();
  let state = await fixture.config(); const provider = state.config.resources.find(r => r.name === 'Morgan Synthetic'); assert.ok(provider);
  assert.equal(state.config.grants.find(g => g.userId === 'provider-user')?.scope, 'own');
  await section('Availability'); await page.getByRole('button', {name: 'Edit availability for Morgan Synthetic', exact: true}).click();
  dialog = page.getByRole('dialog'); await dialog.getByRole('button', {name: 'Add Monday–Friday', exact: true}).click();
  await dialog.getByLabel('Exception starts', {exact: true}).fill(`${date}T11:00`); await dialog.getByLabel('Exception ends', {exact: true}).fill(`${date}T12:00`); await dialog.getByRole('button', {name: 'Add exception', exact: true}).click();
  await dialog.getByRole('button', {name: 'Save availability', exact: true}).click(); await waitSaved();
  state = await fixture.config(); assert.equal(state.config.weeklyHours.filter(h => h.resourceId === provider.id).length, 5); assert.equal(state.config.exceptions.filter(e => e.resourceId === provider.id).length, 1);
  await section('Services'); await page.getByRole('button', {name: 'Add service', exact: true}).click(); dialog = page.getByRole('dialog');
  await dialog.getByLabel('Service name', {exact: true}).fill('Synthetic repair assessment'); await dialog.getByLabel('Duration (minutes)', {exact: true}).fill('45');
  await dialog.getByLabel('Booking confirmation', {exact: true}).selectOption('approval'); await dialog.getByLabel('Price', {exact: true}).fill('75');
  await dialog.getByLabel('Morgan Synthetic', {exact: true}).check(); await dialog.getByRole('button', {name: 'Save service', exact: true}).click(); await waitSaved();
  state = await fixture.config(); const service = state.config.services.find(s => s.name === 'Synthetic repair assessment'); assert.ok(service); assert.equal(service.durationMinutes, 45); assert.equal(service.price.amountMinor, 7500); assert.equal(service.bookingMode, 'approval');
  await page.screenshot({path: resolve('artifacts/scheduling-ui/desktop-services.png'), fullPage: true});
});

test('an empty installation can be configured entirely through the scheduling UI', {timeout: 120000}, async () => {
  await fixture.reset(emptySchedulingConfig()); await open();
  await page.getByRole('button', {name: 'Add location', exact: true}).click(); let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Location name', {exact: true}).fill('Synthetic main office'); await dialog.getByLabel('Location timezone', {exact: true}).fill('America/New_York');
  await dialog.getByRole('button', {name: 'Save location', exact: true}).click(); await waitSaved();
  await page.getByRole('button', {name: 'Add staff', exact: true}).click(); dialog = page.getByRole('dialog'); await dialog.getByLabel('Staff or resource name', {exact: true}).fill('Jordan Synthetic'); await dialog.getByRole('button', {name: 'Save staff or resource', exact: true}).click(); await waitSaved();
  await page.getByRole('button', {name: 'Add service', exact: true}).click(); dialog = page.getByRole('dialog'); await dialog.getByLabel('Service name', {exact: true}).fill('Synthetic consultation'); await dialog.getByLabel('Jordan Synthetic', {exact: true}).check(); await dialog.getByRole('button', {name: 'Save service', exact: true}).click(); await waitSaved();
  await section('Availability'); await page.getByRole('button', {name: 'Edit business hours for Synthetic main office', exact: true}).click(); dialog = page.getByRole('dialog'); await dialog.getByRole('button', {name: 'Add Monday–Friday', exact: true}).click(); await dialog.getByRole('button', {name: 'Save availability', exact: true}).click(); await waitSaved();
  await page.getByRole('button', {name: 'Edit availability for Jordan Synthetic', exact: true}).click(); dialog = page.getByRole('dialog'); await dialog.getByRole('button', {name: 'Add Monday–Friday', exact: true}).click(); await dialog.getByRole('button', {name: 'Save availability', exact: true}).click(); await waitSaved();
  await section('Booking settings'); await page.getByRole('button', {name: 'Edit booking settings', exact: true}).click(); dialog = page.getByRole('dialog'); await dialog.getByLabel('Scheduling mode', {exact: true}).selectOption('test'); await dialog.getByRole('button', {name: 'Save booking settings', exact: true}).click(); await waitSaved();
  await showDate(); await createAppointment('First Synthetic Customer');
  assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM scheduling_appointments').first<{n: number}>())?.n, 1);
});

test('stale configuration saves preserve drafts and do not overwrite another session', {timeout: 60000}, async () => {
  await open(); await section('Services'); const opener = page.getByRole('button', {name: 'Edit Synthetic appointment', exact: true}); await opener.click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('Service name', {exact: true}).fill('Draft that must survive');
  const state = await fixture.config(); state.config.minNoticeMinutes = 120;
  assert.equal((await fixture.ownerPost('/configuration', {revision: state.revision, config: state.config})).status, 200);
  await dialog.getByRole('button', {name: 'Save service', exact: true}).click(); await dialog.getByRole('alert').waitFor();
  assert.equal(await dialog.getByLabel('Service name', {exact: true}).inputValue(), 'Draft that must survive');
  assert.equal((await fixture.config()).config.services[0].name, 'Synthetic appointment'); assert.equal((await fixture.config()).config.minNoticeMinutes, 120);
  await page.keyboard.press('Escape'); await dialog.waitFor({state: 'hidden'}); assert.equal(await opener.evaluate(node => node === document.activeElement), true);
});

test('a failed response after commit can be retried without losing inputs or duplicating the appointment', {timeout: 60000}, async () => {
  await open(); await showDate();
  await page.route('**/api/modules/scheduling/appointments', async route => {const response = await route.fetch(); assert.equal(response.status(), 201); await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: 'Synthetic response interruption after commit'})});}, {times: 1});
  await page.getByRole('button', {name: '+ New appointment', exact: true}).click(); const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Customer name', {exact: true}).fill('Retry Synthetic'); await dialog.getByLabel('Customer email', {exact: true}).fill('retry@example.test'); await dialog.getByLabel('Appointment date', {exact: true}).fill(date);
  await dialog.getByRole('button', {name: 'Find available times', exact: true}).click(); await dialog.getByRole('button', {name: /^9:00 AM GMT/}).click(); await dialog.getByRole('button', {name: 'Save appointment', exact: true}).click(); await dialog.getByRole('alert').waitFor();
  assert.equal(await dialog.getByLabel('Customer name', {exact: true}).inputValue(), 'Retry Synthetic');
  await dialog.getByRole('button', {name: 'Save appointment', exact: true}).click(); await waitSaved();
  assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM scheduling_appointments').first<{n: number}>())?.n, 1);
});

test('provider-scoped mobile UI exposes only permitted actions and has no page or dialog overflow', {timeout: 60000}, async () => {
  const config = schedulingFixture(); config.grants = [{userId: 'provider-user', scope: 'own', permissions: ['appointments:read', 'availability:write']}]; await fixture.reset(config);
  await context.close(); context = await browser.newContext({viewport: {width: 390, height: 844}, timezoneId: 'America/Los_Angeles'}); await login('provider-user'); page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await open();
  assert.equal(await page.getByRole('button', {name: '+ New appointment', exact: true}).count(), 0);
  assert.equal(await page.getByRole('button', {name: 'Booking settings', exact: true}).count(), 0);
  assert.equal(await page.getByRole('button', {name: 'Agenda', exact: true}).getAttribute('aria-pressed'), 'true');
  await page.screenshot({path: resolve('artifacts/scheduling-ui/mobile-calendar.png')});
  await section('Availability'); assert.equal(await page.getByRole('button', {name: /Edit business hours/}).count(), 0); assert.equal(await page.getByRole('button', {name: 'Edit availability for Synthetic provider B', exact: true}).count(), 0);
  await page.getByRole('button', {name: 'Edit availability for Synthetic provider A', exact: true}).click(); const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Start 1', {exact: true}).fill('01:00'); await dialog.getByRole('button', {name: 'Save availability', exact: true}).click(); await waitSaved();
  const state = await fixture.config(); assert.equal(state.config.weeklyHours.find(h => h.resourceId === 'provider-a')?.startMinute, 60); assert.equal(state.config.weeklyHours.find(h => h.resourceId === 'provider-b')?.startMinute, 0);
  await page.getByRole('button', {name: 'Edit availability for Synthetic provider A', exact: true}).click(); await page.getByLabel('Start 1', {exact: true}).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await page.screenshot({path: resolve('artifacts/scheduling-ui/mobile-availability.png')});
});

test('time-off editing distinguishes repeated timezone offsets and rejects nonexistent local times', {timeout: 60000}, async () => {
  await open(); await section('Availability'); await page.getByRole('button', {name: 'Edit availability for Synthetic provider A', exact: true}).click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('Exception starts', {exact: true}).fill('2026-11-01T01:15'); await dialog.getByLabel('Exception ends', {exact: true}).fill('2026-11-01T01:45');
  const start = dialog.getByLabel('Start time occurrence', {exact: true}), end = dialog.getByLabel('End time occurrence', {exact: true});
  assert.equal(await start.locator('option').count(), 2);
  await start.selectOption('2026-11-01T06:15:00.000Z'); await end.selectOption('2026-11-01T06:45:00.000Z');
  await dialog.getByRole('button', {name: 'Add exception', exact: true}).click();
  await dialog.getByLabel('Exception starts', {exact: true}).fill('2027-03-14T02:15'); await dialog.getByLabel('Exception ends', {exact: true}).fill('2027-03-14T03:15');
  await dialog.getByRole('button', {name: 'Add exception', exact: true}).click(); await dialog.getByRole('alert').filter({hasText: 'clock change'}).waitFor();
  await dialog.getByRole('button', {name: 'Save availability', exact: true}).click(); await waitSaved();
  const exceptions = (await fixture.config()).config.exceptions.filter(e => e.resourceId === 'provider-a');
  assert.equal(exceptions.length, 1); assert.equal(exceptions[0].startsAt, '2026-11-01T06:15:00.000Z'); assert.equal(exceptions[0].endsAt, '2026-11-01T06:45:00.000Z');
});

test('appointments ending at midnight are displayed on one day using half-open calendar intervals', {timeout: 60000}, async () => {
  const config = schedulingFixture(); config.locations[0].timezone = 'UTC'; await fixture.reset(config);
  assert.equal((await fixture.ownerPost('/appointments', {idempotencyKey: 'synthetic-midnight', revision: 0, serviceId: 'visit', locationId: 'main', providerId: 'provider-a', startsAt: `${date}T23:30:00.000Z`, customer: {name: 'Midnight Synthetic', email: 'midnight@example.test', phone: ''}})).status, 201);
  await open(); await page.getByLabel('Calendar date', {exact: true}).fill(date); await page.getByRole('button', {name: 'Week', exact: true}).click();
  await page.getByRole('button').filter({hasText: 'Midnight Synthetic'}).waitFor(); assert.equal(await page.getByRole('button').filter({hasText: 'Midnight Synthetic'}).count(), 1);
});

test('available times refresh the displayed price and duration after another session edits a service', {timeout: 60000}, async () => {
  await open(); await showDate(); await page.getByRole('button', {name: '+ New appointment', exact: true}).click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('Customer name', {exact: true}).fill('Current Terms Synthetic'); await dialog.getByLabel('Customer email', {exact: true}).fill('current-terms@example.test'); await dialog.getByLabel('Appointment date', {exact: true}).fill(date);
  const state = await fixture.config(); state.config.services[0].durationMinutes = 45; state.config.services[0].price.amountMinor = 10000;
  assert.equal((await fixture.ownerPost('/configuration', {revision: state.revision, config: state.config})).status, 200);
  await dialog.getByRole('button', {name: 'Find available times', exact: true}).click(); await dialog.getByRole('button', {name: /^9:00 AM GMT/}).click();
  assert.match(await dialog.locator('.sc-summary').innerText(), /45 minutes · \$100\.00/);
  await dialog.getByRole('button', {name: 'Save appointment', exact: true}).click(); await waitSaved();
  const row = await fixture.db.prepare('SELECT snapshot_json FROM scheduling_appointments').first<{snapshot_json: string}>(); assert.ok(row);
  const snapshot = JSON.parse(row.snapshot_json) as {service: {durationMinutes: number; price: {amountMinor: number}}}; assert.equal(snapshot.service.durationMinutes, 45); assert.equal(snapshot.service.price.amountMinor, 10000);
});
