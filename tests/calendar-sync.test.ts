import {test, before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createSchedulingBrowserFixture} from './scheduling-browser-fixture.ts';
import {CalendarProviderFixture, syntheticCalendarBindings} from './calendar-provider-fixture.ts';
import {schedulingFixture} from './scheduling-fixture.ts';
import {encrypt, decrypt} from '../packages/admin/src/scheduling/calendars/crypto.ts';
import type {CalendarProvider, CalendarConnectionsResponse, SchedulingAvailabilityResponse, SchedulingMutationResponse, SchedulingAppointment} from '../packages/contracts/src/scheduling.ts';

let fixture: Awaited<ReturnType<typeof createSchedulingBrowserFixture>>;
const provider = new CalendarProviderFixture();
const start = Math.ceil((Date.now() + 5 * 86400000) / 3600000) * 3600000;
const iso = (minutes = 0) => new Date(start + minutes * 60000).toISOString();
const id = (kind: CalendarProvider) => `synthetic-${kind}`;
before(async () => {fixture = await createSchedulingBrowserFixture({calendar: provider});});
after(async () => {await fixture?.app.dispose();});
beforeEach(async () => {provider.reset(); await fixture.reset(schedulingFixture()); await fixture.db.prepare('UPDATE users SET active=1').run(); await provider.seed(fixture.db);});
async function get(path: string, user = 'owner') {return fixture.app.dispatchFetch(`${fixture.origin}/api/modules/scheduling${path}`, {headers: {cookie: `vitris-admin-local=${fixture.sessions.get(user)}`}});}
async function post(path: string, value: unknown, user = 'owner') {return fixture.app.dispatchFetch(`${fixture.origin}/api/modules/scheduling${path}`, {method: 'POST', headers: {origin: fixture.origin, cookie: `vitris-admin-local=${fixture.sessions.get(user)}`, 'content-type': 'application/json'}, body: JSON.stringify(value)});}
async function enable(kind: CalendarProvider) {
  const response = await post(`/connections/${id(kind)}/select`, {revision: 0, blocking: [provider.calendars(kind)[0].id], destination: provider.calendars(kind)[0].id, acknowledge: true});
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const data = await (await get('/connections')).json() as CalendarConnectionsResponse;
  assert.equal(data.connections.find(c => c.id === id(kind))?.health, 'healthy');
}
async function create(minutes = 0, kind: CalendarProvider = 'google') {
  const response = await post('/appointments', {idempotencyKey: crypto.randomUUID(), revision: (await fixture.config()).revision, serviceId: 'visit', locationId: 'main', providerId: kind === 'google' ? 'provider-a' : 'provider-b', startsAt: iso(minutes), customer: {name: 'Synthetic Calendar Customer', email: 'calendar@example.test', phone: ''}});
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json())); return await response.json() as SchedulingMutationResponse;
}
async function slots(kind: CalendarProvider = 'google', minutes = 0) {
  const response = await get(`/availability?${new URLSearchParams({serviceId: 'visit', locationId: 'main', providerId: kind === 'google' ? 'provider-a' : 'provider-b', startsAt: iso(minutes), endsAt: iso(minutes + 1)})}`);
  return {response, data: await response.json() as SchedulingAvailabilityResponse};
}

test('selected Google and Outlook busy events block availability; free events remain available', async () => {
  provider.add('google', start, start + 3600000); provider.add('microsoft', start + 2 * 3600000, start + 3 * 3600000);
  const free = provider.add('google', start + 4 * 3600000, start + 5 * 3600000); provider.change(free.id, {busy: false});
  await enable('google'); await enable('microsoft');
  assert.equal((await slots('google')).data.slots.length, 0); assert.equal((await slots('microsoft', 120)).data.slots.length, 0); assert.ok((await slots('google', 240)).data.slots.length);
  assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM calendar_busy_intervals').first<{n: number}>())?.n, 2);
});

test('both provider adapters export creation, rescheduling and cancellation without customer invitations', async () => {
  for (const kind of ['google', 'microsoft'] as const) {
    await enable(kind); const receipt = await create(kind === 'google' ? 0 : 120, kind);
    let remote = [...provider.events.values()].find(e => e.provider === kind && e.marker); assert.ok(remote); const stableId = remote.id;
    assert.equal(remote.start, start + (kind === 'google' ? 0 : 120) * 60000);
    const response = await post(`/appointments/${receipt.id}/reschedule`, {idempotencyKey: crypto.randomUUID(), revision: (await fixture.config()).revision, appointmentRevision: 1, providerId: kind === 'google' ? 'provider-a' : 'provider-b', locationId: 'main', startsAt: iso(kind === 'google' ? 60 : 180)});
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json())); remote = provider.events.get(stableId); assert.ok(remote); assert.equal(remote.start, start + (kind === 'google' ? 60 : 180) * 60000);
    const cancel = await post(`/appointments/${receipt.id}/status`, {idempotencyKey: crypto.randomUUID(), revision: (await fixture.config()).revision, appointmentRevision: 2, status: 'cancelled'}); assert.equal(cancel.status, 200);
    assert.equal(provider.events.has(stableId), false);
  }
  assert.ok(provider.calls.filter(c => c.body && c.url.includes('/events')).every(c => !('attendees' in c.body!)));
  assert.ok(provider.calls.filter(c => c.method === 'POST' && c.url.includes('googleapis.com') && c.url.includes('/events')).every(c => new URL(c.url).searchParams.get('sendUpdates') === 'none'));
  assert.ok(provider.calls.some(c => c.prefer?.includes('ImmutableId')));
});

test('new external events are refreshed before commit and database triggers reject conflicting claims', async () => {
  await enable('google'); const saved = await create(120);
  provider.add('google', start, start + 3600000);
  const response = await post('/appointments', {idempotencyKey: 'new-external-race', revision: (await fixture.config()).revision, serviceId: 'visit', locationId: 'main', providerId: 'provider-a', startsAt: iso(), customer: {name: 'Synthetic Race', email: 'race@example.test', phone: ''}});
  assert.equal(response.status, 409); assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM scheduling_appointments').first<{n: number}>())?.n, 1);
  const state = await fixture.config();
  await assert.rejects(fixture.db.batch([fixture.db.prepare('UPDATE scheduling_state SET revision=revision+1 WHERE site_id=?').bind('scheduling-browser'), fixture.db.prepare('UPDATE scheduling_appointments SET starts_at=?,ends_at=?,occupied_starts_at=?,occupied_ends_at=?,revision=revision+1,schedule_revision=? WHERE site_id=? AND id=?').bind(start, start + 1800000, start, start + 1800000, state.revision + 1, 'scheduling-browser', saved.id)]), /calendar_busy/);
  assert.equal((await fixture.config()).revision, state.revision);
});

test('a provider timeout after creation is recovered using stable identity without duplicate events', async () => {
  for (const kind of ['google', 'microsoft'] as const) {
    await enable(kind); let interrupted = false;
    provider.intercept = async request => {
      if (request.method === 'POST' && request.url.includes('/events') && !interrupted) {
        interrupted = true; provider.intercept = undefined;
        const response = await provider.fetch(new Request(request.url, {method: request.method, headers: request.headers, body: await request.text()})); assert.equal(response.status, 201);
        return Response.json({error: 'synthetic response loss'}, {status: 503});
      } return null;
    };
    await create(kind === 'google' ? 0 : 120, kind);
    assert.equal([...provider.events.values()].filter(e => e.provider === kind && e.marker).length, 1);
    assert.equal((await post(`/connections/${id(kind)}/sync`, {})).status, 200);
    assert.equal([...provider.events.values()].filter(e => e.provider === kind && e.marker).length, 1);
  }
});

test('failed writes stay durable and calendar failures pause new times without losing appointments', async () => {
  await enable('google'); provider.writesFail = true; const receipt = await create();
  const connections = await (await get('/connections')).json() as CalendarConnectionsResponse;
  assert.equal(connections.connections[0].health, 'error'); assert.equal(connections.connections[0].pendingJobs, 1);
  const appointment = await (await get(`/appointments/${receipt.id}`)).json() as SchedulingAppointment; assert.equal(appointment.status, 'confirmed');
  assert.notEqual((await slots('google', 120)).response.status, 200);
  provider.writesFail = false; assert.equal((await post(`/connections/${id('google')}/sync`, {})).status, 200);
  assert.equal((await slots('google', 120)).response.status, 200);
});

test('external edits and deletions are flagged and never silently reschedule or cancel native appointments', async () => {
  await enable('google'); const receipt = await create(); let remote = [...provider.events.values()].find(e => e.marker)!;
  provider.change(remote.id, {start: start + 3600000, end: start + 5400000});
  assert.equal((await post(`/connections/${id('google')}/sync`, {})).status, 409);
  let appointment = await (await get(`/appointments/${receipt.id}`)).json() as SchedulingAppointment; assert.equal(appointment.startsAt, iso()); assert.equal(appointment.status, 'confirmed');
  assert.equal((await post(`/connections/${id('google')}/restore`, {appointmentId: receipt.id, acknowledge: true})).status, 200);
  remote = [...provider.events.values()].find(e => e.marker)!; assert.equal(remote.start, start);
  provider.change(remote.id, {}); // A provider revision change outside normalized appointment fields still requires review.
  assert.equal((await post(`/connections/${id('google')}/sync`, {})).status, 409);
  assert.equal((await post(`/connections/${id('google')}/restore`, {appointmentId: receipt.id, acknowledge: true})).status, 200);
  const oldId = remote.id; provider.remove(oldId);
  assert.equal((await post(`/connections/${id('google')}/sync`, {})).status, 409);
  appointment = await (await get(`/appointments/${receipt.id}`)).json() as SchedulingAppointment; assert.equal(appointment.status, 'confirmed');
  assert.equal((await post(`/connections/${id('google')}/restore`, {appointmentId: receipt.id, acknowledge: true})).status, 200);
  remote = [...provider.events.values()].find(e => e.marker)!; assert.notEqual(remote.id, oldId); assert.equal(remote.start, start);
});

test('foreign external overlaps are visible and imported without deleting the native appointment', async () => {
  await enable('google'); const receipt = await create(); provider.add('google', start, start + 3600000);
  assert.equal((await post(`/connections/${id('google')}/sync`, {})).status, 200);
  const data = await (await get('/connections')).json() as CalendarConnectionsResponse;
  assert.ok(data.conflicts.some(c => c.appointmentId === receipt.id && c.reason === 'external_overlap'));
  assert.equal((await (await get(`/appointments/${receipt.id}`)).json() as SchedulingAppointment).status, 'confirmed');
});

test('OAuth callbacks bind state, browser cookie, provider and active user without relying on a Strict admin cookie', async () => {
  const begin = await post('/connections/start', {provider: 'google', resourceId: 'provider-a'}); assert.equal(begin.status, 200);
  const auth = new URL((await begin.json() as {url: string}).url), cookie = begin.headers.get('set-cookie')!.split(';')[0];
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256'); assert.equal(auth.searchParams.get('redirect_uri'), `${fixture.origin}/api/scheduling/oauth/google/callback`);
  const callback = `${fixture.origin}/api/scheduling/oauth/google/callback?${new URLSearchParams({state: auth.searchParams.get('state')!, code: 'synthetic-code'})}`;
  assert.equal((await fixture.app.dispatchFetch(callback)).status, 403);
  const responses = await Promise.all([fixture.app.dispatchFetch(callback, {redirect: 'manual', headers: {cookie}}), fixture.app.dispatchFetch(callback, {redirect: 'manual', headers: {cookie}})]);
  assert.deepEqual(responses.map(r => r.status).sort(), [303, 403]);
  assert.equal(responses.find(r => r.status === 303)?.headers.get('location'), `${fixture.origin}/#scheduling`);
  assert.ok(provider.calls.find(c => c.url.includes('/token'))?.body?.code_verifier);
});

test('OAuth and calendar management reject revoked or cross-provider authority and never return tokens', async () => {
  const state = await fixture.config(); state.config.grants = [{userId: 'provider-user', scope: 'own', permissions: ['appointments:read', 'calendar-connections:manage']}]; await post('/configuration', state);
  const scoped = await (await get('/connections', 'provider-user')).json() as CalendarConnectionsResponse; assert.ok(scoped.connections.every(c => c.resourceId === 'provider-a'));
  assert.equal((await get('/connections/synthetic-microsoft/calendars', 'provider-user')).status, 403);
  const begin = await post('/connections/start', {provider: 'google', resourceId: 'provider-a'}, 'provider-user'); assert.equal(begin.status, 200);
  const auth = new URL((await begin.json() as {url: string}).url), cookie = begin.headers.get('set-cookie')!.split(';')[0];
  await fixture.db.prepare("UPDATE users SET active=0 WHERE id='provider-user'").run();
  assert.equal((await fixture.app.dispatchFetch(`${fixture.origin}/api/scheduling/oauth/google/callback?state=${auth.searchParams.get('state')}&code=synthetic`, {headers: {cookie}})).status, 403);
  const serialized = JSON.stringify(await (await get('/connections')).json()); assert.ok(!serialized.includes('accessToken') && !serialized.includes('refreshToken') && !serialized.includes('tokens_cipher'));
});

test('encrypted refresh credentials are bound to site and connection, rotated safely, and never stored in plaintext', async () => {
  const cipher = await encrypt(syntheticCalendarBindings, 'synthetic-context', {refresh: 'synthetic-secret'});
  assert.ok(!cipher.includes('synthetic-secret')); assert.deepEqual(await decrypt(syntheticCalendarBindings, 'synthetic-context', cipher), {refresh: 'synthetic-secret'});
  await assert.rejects(decrypt(syntheticCalendarBindings, 'another-site', cipher));
  await enable('google');
  const expired = await encrypt(syntheticCalendarBindings, 'scheduling-browser|synthetic-google|tokens', {accessToken: 'synthetic-google-access', refreshToken: 'synthetic-google-refresh', expiresAt: 1});
  await fixture.db.prepare('UPDATE calendar_connections SET tokens_cipher=? WHERE id=?').bind(expired, id('google')).run();
  const responses = await Promise.all([post('/connections/synthetic-google/sync', {}), post('/connections/synthetic-google/sync', {})]);
  assert.ok(responses.some(r => r.status === 200)); assert.equal(provider.refreshes, 1);
  const stored = await fixture.db.prepare('SELECT tokens_cipher FROM calendar_connections WHERE id=?').bind(id('google')).first<{tokens_cipher: string}>(); assert.ok(stored && !stored.tokens_cipher.includes('synthetic-google-refresh'));
});

test('invalid continuation URLs fail closed without sending a credential outside provider hosts', async () => {
  await enable('microsoft');
  provider.intercept = request => request.url.includes('/calendarView') ? Response.json({value: [], '@odata.nextLink': 'https://evil.example.test/steal'}) : null;
  const response = await post('/connections/synthetic-microsoft/sync', {}); assert.equal(response.status, 502);
  assert.ok(provider.calls.every(c => !c.url.includes('evil.example.test')));
  const data = await (await get('/connections')).json() as CalendarConnectionsResponse; assert.equal(data.connections.find(c => c.provider === 'microsoft')?.health, 'error');
});

test('disconnect is explicit, clears stored credentials and busy intervals, and resumes native-only booking', async () => {
  provider.add('google', start, start + 3600000); await enable('google');
  assert.equal((await post('/connections/synthetic-google/disconnect', {revision: 1, acknowledge: false})).status, 400);
  assert.equal((await post('/connections/synthetic-google/disconnect', {revision: 1, acknowledge: true})).status, 200);
  const row = await fixture.db.prepare('SELECT tokens_cipher,enabled FROM calendar_connections WHERE id=?').bind(id('google')).first<{tokens_cipher: string | null; enabled: number}>(); assert.equal(row?.tokens_cipher, null); assert.equal(row.enabled, 0);
  await create();
});

test('calendar downloads and captured notification attachments retain identity and revision across changes', async () => {
  const receipt = await create();
  const response = await get(`/appointments/${receipt.id}/calendar.ics`); assert.equal(response.status, 200); assert.match(response.headers.get('content-type')!, /text\/calendar/);
  const first = await response.text(); assert.match(first, /BEGIN:VCALENDAR\r\n/); assert.match(first, /SEQUENCE:1\r\n/); assert.match(first, /DTSTART:\d{8}T\d{6}Z/);
  const captured = await (await get(`/appointments/${receipt.id}/notification`)).json() as {delivery: string; attachments: {filename: string; contentType: string; content: string}[]}; assert.equal(captured.delivery, 'captured'); assert.match(captured.attachments[0].filename, /\.ics$/);
  assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM appointment_calendar_captures').first<{n: number}>())?.n, 1);
  assert.equal((await post(`/appointments/${receipt.id}/status`, {idempotencyKey: 'synthetic-ics-cancel', revision: (await fixture.config()).revision, appointmentRevision: 1, status: 'cancelled'})).status, 200);
  const cancelled = await (await get(`/appointments/${receipt.id}/calendar.ics`)).text(); assert.equal(first.match(/UID:(.*)\r\n/)?.[1], cancelled.match(/UID:(.*)\r\n/)?.[1]); assert.match(cancelled, /SEQUENCE:2\r\n/); assert.match(cancelled, /STATUS:CANCELLED/);
  for (const line of cancelled.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
});

test('partial Google pagination never publishes an incomplete snapshot, and expired leases reject stale writers', async () => {
  provider.add('google',start,start+3600000); await enable('google');
  const before = await fixture.db.prepare("SELECT current_batch FROM calendar_connections WHERE id='synthetic-google'").first<{current_batch:string}>();
  provider.intercept=request=>request.url.includes('/events?') ? (new URL(request.url).searchParams.has('pageToken') ? Response.json({error:'synthetic failure'},{status:503}) : Response.json({items:[],nextPageToken:'second'})) : null;
  assert.equal((await post('/connections/synthetic-google/sync',{})).status,503);
  assert.equal((await fixture.db.prepare("SELECT current_batch FROM calendar_connections WHERE id='synthetic-google'").first<{current_batch:string}>())?.current_batch,before?.current_batch);
  assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM calendar_busy_intervals').first<{n:number}>())?.n,1);
  await assert.rejects(fixture.db.prepare("INSERT INTO calendar_sync_fences(id,site_id,connection_id,revision,lease_id,created_at) VALUES('stale','scheduling-browser','synthetic-google',1,'expired',?)").bind(Date.now()).run(),/calendar_stale_connection/);
});

test('revoked refresh tokens pause availability and scoped management revocation pauses polling', async () => {
  await enable('google');
  const expired=await encrypt(syntheticCalendarBindings,'scheduling-browser|synthetic-google|tokens',{accessToken:'synthetic-google-access',refreshToken:'synthetic-google-refresh',expiresAt:1});
  await fixture.db.prepare("UPDATE calendar_connections SET tokens_cipher=? WHERE id='synthetic-google'").bind(expired).run(); provider.tokenFailures=true;
  assert.equal((await post('/connections/synthetic-google/sync',{})).status,401);
  let data=await(await get('/connections')).json() as CalendarConnectionsResponse; assert.equal(data.connections.find(c=>c.provider==='google')?.health,'reauthorization_required');
  provider.tokenFailures=false;
  await fixture.db.prepare("UPDATE calendar_connections SET created_by='provider-user' WHERE id='synthetic-google'").run();
  assert.equal((await post('/connections/synthetic-google/sync',{})).status,401);
  data=await(await get('/connections')).json() as CalendarConnectionsResponse; assert.equal(data.connections.find(c=>c.provider==='google')?.errorCode,'calendar_reauthorization');
});

test('staff reassignment removes old exports and creates a fresh identity when returning to an earlier calendar', async () => {
  await enable('google'); await enable('microsoft'); const receipt=await create();
  const original=[...provider.events.values()].find(e=>e.marker)!.id;
  for(const [index,providerId] of ['provider-b','provider-a'].entries()) {
    const response=await post(`/appointments/${receipt.id}/reschedule`,{idempotencyKey:`synthetic-reassign-${index}`,revision:(await fixture.config()).revision,appointmentRevision:index+1,providerId,locationId:'main',startsAt:iso((index+1)*60)});
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    const events=[...provider.events.values()].filter(e=>e.marker); assert.equal(events.length,1); assert.equal(events[0].provider,index===0?'microsoft':'google');
  }
  assert.ok(!provider.events.has(original));
});

test('pending approval is exported as a hold and expired holds are removed by the calendar runner', async () => {
  const state=await fixture.config();state.config.services[0].bookingMode='approval';assert.equal((await post('/configuration',state)).status,200);
  await enable('google');const receipt=await create(); assert.ok(provider.calls.find(c=>c.method==='POST' && c.url.includes('/events'))?.body?.summary?.toString().includes('Awaiting approval'));
  await fixture.db.prepare("UPDATE scheduling_appointments SET expires_at=?,revision=revision+1 WHERE id=?").bind(Date.now()-1000,receipt.id).run();
  assert.equal((await post('/connections/synthetic-google/sync',{})).status,200);
  assert.equal((await fixture.db.prepare('SELECT status FROM scheduling_appointments WHERE id=?').bind(receipt.id).first<{status:string}>())?.status,'expired');assert.equal([...provider.events.values()].filter(e=>e.marker).length,0);
});

test('ICS and notification downloads reject unauthenticated and wrong-provider access', async () => {
  const receipt=await create();
  for(const suffix of ['calendar.ics','notification']) {
    assert.equal((await fixture.app.dispatchFetch(`${fixture.origin}/api/modules/scheduling/appointments/${receipt.id}/${suffix}`)).status,401);
    assert.equal((await get(`/appointments/${receipt.id}/${suffix}`,'reader')).status,403);
  }
});


test('the exported scheduled handler imports busy events and retries durable jobs without a browser session', async () => {
  await enable('google');provider.writesFail=true;await create();provider.writesFail=false;
  provider.add('google',start+2*3600000,start+3*3600000);
  await fixture.db.prepare("UPDATE calendar_connections SET next_sync_at=0 WHERE id='synthetic-google'").run();
  await fixture.db.prepare("UPDATE calendar_export_jobs SET next_attempt_at=0 WHERE status='failed'").run();
  await (await fixture.app.getWorker()).scheduled({cron:'* * * * *'});
  const row=await fixture.db.prepare("SELECT health FROM calendar_connections WHERE id='synthetic-google'").first<{health:string}>();assert.equal(row?.health,'healthy');
  assert.equal([...provider.events.values()].filter(e=>e.marker).length,1);assert.equal((await slots('google',120)).data.slots.length,0);
});
