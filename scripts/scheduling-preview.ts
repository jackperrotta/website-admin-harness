import {readFile} from 'node:fs/promises';
import {basename, resolve} from 'node:path';
import {parseEnv} from 'node:util';
import {createSchedulingBrowserFixture} from '../tests/scheduling-browser-fixture.ts';
import {CalendarProviderFixture} from '../tests/calendar-provider-fixture.ts';
import {schedulingFixture} from '../tests/scheduling-fixture.ts';

// Deliberately ephemeral local acceptance installation. Never targets a remote database.
const args = process.argv.slice(2), live = args.includes('--live');
const envPath = args.includes('--env') ? args[args.indexOf('--env') + 1] : undefined;
let bindings: Record<string, string> = {};
if (live) {
  if (!envPath || !/^(\.dev\.vars|\.env)/.test(basename(envPath))) throw new Error('Use --live --env .dev.vars.calendar with an ignored environment file.');
  const values = parseEnv(await readFile(resolve(envPath), 'utf8'));
  for (const [key, value] of Object.entries(values)) if (typeof value === 'string' && /^CALENDAR_(SYNC_ENABLED|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|MICROSOFT_CLIENT_ID|MICROSOFT_CLIENT_SECRET|MICROSOFT_TENANT|TOKEN_KEYS)$/.test(key)) bindings[key] = value;
  if (bindings.CALENDAR_SYNC_ENABLED !== '1') throw new Error('Enable CALENDAR_SYNC_ENABLED in the ignored environment file.');
} else if (envPath) throw new Error('--env requires --live; simulated previews never read real credentials.');
const calendar = live ? undefined : new CalendarProviderFixture();
const preview = await createSchedulingBrowserFixture({port: 4391, hostname: 'localhost', calendar, simulated: !live, bindings});
await preview.reset(schedulingFixture());
if (calendar) {
  await calendar.seed(preview.db);
  for (const kind of ['google', 'microsoft'] as const) {
    const destination = calendar.calendars(kind)[0].id;
    const response = await preview.ownerPost(`/connections/synthetic-${kind}/select`, {revision: 0, blocking: [destination], destination, acknowledge: true});
    if (!response.ok) throw new Error(`Simulated calendar setup failed: ${response.status}`);
  }
  const tomorrow = new Date(Date.now() + 86400000), base = Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 14);
  calendar.add('google', base + 3600000, base + 7200000, 'Simulated personal commitment');
  calendar.add('microsoft', base + 3 * 3600000, base + 4 * 3600000, 'Simulated Outlook busy event');
  for (const kind of ['google', 'microsoft']) {
    const response = await preview.ownerPost(`/connections/synthetic-${kind}/sync`, {});
    if (!response.ok) throw new Error(`Simulated initial sync failed: ${response.status}`);
  }
  for (const [index, name] of ['Alex Sample', 'Sam Sample', 'Jamie Sample'].entries()) {
    const response = await preview.ownerPost('/appointments', {idempotencyKey: `synthetic-preview-${index}`, revision: (await preview.config()).revision, serviceId: index === 2 ? 'consult' : 'visit', locationId: index === 2 ? 'remote' : 'main', providerId: index === 1 ? 'provider-b' : 'provider-a', startsAt: new Date(base + index * 2 * 3600000).toISOString(), customer: {name, email: `sample-${index}@example.test`, phone: ''}});
    if (!response.ok) throw new Error(`Sample appointment failed: ${response.status}`);
  }
}
let polling = false;
const timer = setInterval(async () => {
  if (polling) return; polling = true;
  try {
    const rows = (await preview.db.prepare('SELECT id FROM calendar_connections WHERE enabled=1').all<{id: string}>()).results;
    for (const row of rows) await preview.ownerPost(`/connections/${row.id}/sync`, {});
  } catch {console.error('Calendar polling needs attention; check Calendar connections.');} finally {polling = false;}
}, 60000);
console.log(`Scheduling preview: ${preview.origin}/#scheduling`);
console.log(live ? 'REAL PROVIDER MODE: use dedicated test calendars. Enabled connections receive real event writes. No email delivery.' : 'SIMULATED PROVIDERS: no real calendar accounts, events, or email delivery.');
console.log('Choose Open local demo to sign in. Data resets when this preview stops.');
const close = () => {clearInterval(timer); void preview.app.dispose().then(() => process.exit(0));};
process.on('SIGINT', close); process.on('SIGTERM', close);
await new Promise(() => {});
