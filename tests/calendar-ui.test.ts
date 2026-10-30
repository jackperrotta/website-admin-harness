import {test, before, after, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium, type Browser, type BrowserContext, type Page} from 'playwright';
import {createSchedulingBrowserFixture} from './scheduling-browser-fixture.ts';
import {CalendarProviderFixture} from './calendar-provider-fixture.ts';
import {schedulingFixture} from './scheduling-fixture.ts';

let fixture: Awaited<ReturnType<typeof createSchedulingBrowserFixture>>, browser: Browser, context: BrowserContext, page: Page;
const provider = new CalendarProviderFixture(), errors: string[] = [];
const target = new Date(Date.now() + 2 * 86400000), date = target.toISOString().slice(0, 10);
const start = Date.parse(`${date}T14:00:00Z`);
before(async () => {await mkdir('artifacts/calendar-sync', {recursive: true}); fixture = await createSchedulingBrowserFixture({calendar: provider, simulated: true}); browser = await chromium.launch({headless: true});});
after(async () => {await browser?.close(); await fixture?.app.dispose();});
beforeEach(async () => {provider.reset(); await fixture.reset(schedulingFixture()); await provider.seed(fixture.db); context = await browser.newContext({viewport: {width: 1440, height: 1000}}); await context.addCookies([{name: 'vitris-admin-local', value: fixture.sessions.get('owner')!, url: fixture.origin, httpOnly: true, sameSite: 'Strict'}]); page = await context.newPage(); page.setDefaultTimeout(15000); errors.length = 0; page.on('pageerror', error => errors.push(error.message));});
afterEach(async test => {await page?.screenshot({path: resolve(`artifacts/calendar-sync/${test.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 65)}.png`), fullPage: true}); await context?.close(); assert.deepEqual(errors, []);});
async function connections() {await page.goto(`${fixture.origin}/#scheduling`); await page.getByRole('navigation', {name: 'Scheduling sections'}).getByRole('button', {name: 'Calendar connections', exact: true}).click(); await page.getByText('SIMULATED CALENDARS', {exact: true}).waitFor();}
async function enable() {
  await page.getByRole('article').filter({has: page.getByRole('heading', {name: 'Google Calendar', exact: true})}).getByRole('button', {name: 'Choose calendars', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Choose calendars'});
  await dialog.getByLabel('Appointment calendar', {exact: true}).selectOption('google-primary');
  await dialog.getByRole('checkbox', {name: 'Allow simulated appointment events in these isolated test calendars.'}).check();
  await dialog.getByRole('button', {name: 'Enable calendar sync', exact: true}).click(); await dialog.waitFor({state: 'hidden'});
  await page.getByRole('article').filter({has: page.getByRole('heading', {name: 'Google Calendar', exact: true})}).getByText('healthy', {exact: true}).waitFor();
}
test('calendar selection, blocked booking search, export, calendar download and conflict recovery work in Chromium', {timeout: 120000}, async () => {
  provider.add('google', start, start + 3600000);
  await connections(); await enable();
  await page.getByRole('navigation', {name: 'Scheduling sections'}).getByRole('button', {name: 'Calendar', exact: true}).click();
  await page.getByRole('button', {name: '+ New appointment', exact: true}).click();
  let dialog = page.getByRole('dialog', {name: 'New appointment'});
  await dialog.getByLabel('Customer name', {exact: true}).fill('Calendar UI Sample'); await dialog.getByLabel('Customer email', {exact: true}).fill('calendar-ui@example.test');
  await dialog.getByLabel('Appointment date', {exact: true}).fill(date); await dialog.getByRole('button', {name: 'Find available times', exact: true}).click();
  // 14:00 UTC is 9 or 10am in New York. The entire hour must be absent.
  const blockedHour = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit'}).format(start);
  assert.equal(await dialog.getByRole('button', {name: new RegExp(`^${blockedHour} GMT`)}).count(), 0);
  await dialog.getByRole('button', {name: /^12:00 PM GMT/}).first().click(); await dialog.getByRole('button', {name: 'Save appointment', exact: true}).click(); await dialog.waitFor({state: 'hidden'});
  const row = await fixture.db.prepare('SELECT id FROM scheduling_appointments').first<{id: string}>(); assert.ok(row);
  const exported = [...provider.events.values()].find(e => e.marker); assert.ok(exported);
  // Open details from the affected day and download via the real authenticated route.
  await page.getByRole('button', {name: 'Day', exact: true}).click(); await page.getByLabel('Calendar date', {exact: true}).fill(date);
  await page.getByRole('button').filter({hasText: 'Calendar UI Sample'}).click();
  const downloaded = page.waitForEvent('download'); await page.getByRole('link', {name: 'Download calendar file (.ics)', exact: true}).click();
  const download = await downloaded, path = await download.path(); assert.ok(path); assert.match(await readFile(path, 'utf8'), /BEGIN:VCALENDAR/);
  await page.getByRole('button', {name: 'Close appointment details', exact: true}).click();
  provider.remove(exported.id); await fixture.ownerPost('/connections/synthetic-google/sync', {});
  await connections(); await page.getByText('A linked appointment event was deleted in the external calendar.', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Apply appointment to calendar', exact: true}).click(); dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', {name: 'Apply appointment to calendar', exact: true}).click(); await dialog.waitFor({state: 'hidden'});
  assert.equal([...provider.events.values()].filter(e => e.marker).length, 1);
  assert.equal((await fixture.db.prepare('SELECT status FROM scheduling_appointments WHERE id=?').bind(row.id).first<{status: string}>())?.status, 'confirmed');
});

test('simulated calendar controls fit mobile and disconnect requires acknowledgment', {timeout: 60000}, async () => {
  await page.setViewportSize({width: 390, height: 844}); await connections(); await enable();
  await page.screenshot({path: resolve('artifacts/calendar-sync/mobile-connections.png'), fullPage: true});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole('article').filter({has: page.getByRole('heading', {name: 'Google Calendar', exact: true})}).getByRole('button', {name: 'Disconnect', exact: true}).click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('button', {name: 'Disconnect calendar', exact: true}).click();
  await dialog.getByRole('alert').filter({hasText: 'Confirm the calendar operation'}).waitFor();
  await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', {name: 'Disconnect calendar', exact: true}).click(); await dialog.waitFor({state: 'hidden'});
  assert.equal((await fixture.db.prepare("SELECT tokens_cipher FROM calendar_connections WHERE id='synthetic-google'").first<{tokens_cipher: string | null}>())?.tokens_cipher, null);
});

test('missing real OAuth credentials show setup callbacks without a simulated or connected claim', {timeout: 60000}, async () => {
  const clean = await createSchedulingBrowserFixture();
  try {
    await clean.reset(schedulingFixture()); await context.addCookies([{name: 'vitris-admin-local', value: clean.sessions.get('owner')!, url: clean.origin, httpOnly: true, sameSite: 'Strict'}]);
    await context.clearCookies(); await page.goto(`${clean.origin}/#scheduling`); await page.getByRole('button', {name: /Open local demo/}).click(); await page.getByRole('navigation', {name: 'Scheduling sections'}).getByRole('button', {name: 'Calendar connections', exact: true}).click();
    await page.getByRole('heading', {name: 'Set up Google or Microsoft OAuth', exact: true}).waitFor();
    await page.getByText(`${clean.origin}/api/scheduling/oauth/google/callback`, {exact: true}).waitFor();
    assert.equal(await page.getByText('SIMULATED CALENDARS', {exact: true}).count(), 0); assert.equal(await page.getByRole('button', {name: 'Connect Google', exact: true}).isDisabled(), true);
  } finally {await clean.app.dispose();}
});
