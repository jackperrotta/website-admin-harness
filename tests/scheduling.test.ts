import {test, before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import type {AdminManifest, BootstrapResponse} from '../packages/contracts/src/index.ts';
import type {SchedulingConfig, SchedulingConfigurationResponse, SchedulingMutationResponse, SchedulingAppointment} from '../packages/contracts/src/scheduling.ts';
import {schedulingFixture} from './scheduling-fixture.ts';

type TestDB = Awaited<ReturnType<Miniflare['getD1Database']>>;
let app: Miniflare, db: TestDB;
const origin = 'http://127.0.0.1:4391';
const manifest: AdminManifest = {schemaVersion: 1, installationId: 'synthetic', business: {name: 'Synthetic Test Business', initials: 'ST'}, site: {id: 'synthetic-site', name: 'Synthetic website', origin: 'https://synthetic.example.test'}, adminOrigin: origin, modules: ['scheduling']};
const cookies = new Map<string, string>();
const start = new Date(Math.ceil((Date.now() + 3 * 86400000) / 3600000) * 3600000).toISOString();
const later = (minutes: number) => new Date(Date.parse(start) + minutes * 60000).toISOString();
async function request(path: string, data?: unknown, user = 'owner', base = origin, method?: string, requestOrigin = base) {
  return app.dispatchFetch(`${base}/api/modules/scheduling${path}`, {method: method ?? (data === undefined ? 'GET' : 'POST'), headers: {cookie: cookies.get(user) ?? '', ...(data === undefined ? {} : {'content-type': 'application/json', origin: requestOrigin})}, ...(data === undefined ? {} : {body: JSON.stringify(data)})});
}
async function configuration() {return await (await request('/configuration')).json() as SchedulingConfigurationResponse;}
async function save(config = schedulingFixture()) {
  const response = await request('/configuration', {revision: (await configuration()).revision, config});
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  return await response.json() as SchedulingConfigurationResponse;
}
function createBody(revision: number, key: string, overrides: Record<string, unknown> = {}) {
  return {idempotencyKey: key, revision, serviceId: 'visit', locationId: 'main', providerId: 'provider-a', startsAt: start, customer: {name: 'Synthetic Customer', email: 'customer@example.test', phone: ''}, ...overrides};
}
async function create(key: string, overrides: Record<string, unknown> = {}) {
  const response = await request('/appointments', createBody((await configuration()).revision, key, overrides));
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  return await response.json() as SchedulingMutationResponse;
}
before(async () => {
  const source = `import {createAdmin} from ${JSON.stringify(resolve('packages/admin/dist/worker.js'))};
    const main=createAdmin(${JSON.stringify(manifest)});
    const beta=createAdmin(${JSON.stringify({...manifest, installationId: 'beta', site: {...manifest.site, id: 'beta'}, adminOrigin: 'http://localhost:4391'})});
    const disabled=createAdmin(${JSON.stringify({...manifest, adminOrigin: 'http://127.0.0.1:4392', modules: []})});
    const old=createAdmin(${JSON.stringify({...manifest, adminOrigin: 'http://127.0.0.1:4393'})});
    export default {fetch(request,env){const origin=new URL(request.url).origin;if(origin==='http://127.0.0.1:4393')return old.fetch(request,{...env,DB:env.OLD_DB});return (origin==='http://localhost:4391'?beta:origin==='http://127.0.0.1:4392'?disabled:main).fetch(request,env);}};`;
  const bundle = await build({stdin: {contents: source, resolveDir: process.cwd()}, bundle: true, write: false, format: 'esm', platform: 'neutral'});
  app = new Miniflare(convertV4MiniflareOptions({workers: [{name: 'scheduling-test', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01', d1Databases: {DB: 'scheduling-db', OLD_DB: 'scheduling-old-schema'}, bindings: {MODE: 'local'}, serviceBindings: {ASSETS: async () => new Response('Synthetic app')}}]}));
  db = await app.getD1Database('DB', 'scheduling-test');
  for (const file of ['0001_core.sql', '0002_work_queue.sql', '0003_password_credentials.sql']) {
    const sql = await readFile(`packages/admin/migrations/${file}`, 'utf8');
    for (const statement of sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  // These records predate the scheduling migration and must survive it unchanged.
  await db.prepare("INSERT INTO users(id,email,role) VALUES('owner','owner@example.test','owner'),('provider-user','provider@example.test','editor'),('analyst','analyst@example.test','analyst'),('other-editor','other@example.test','editor')").run();
  await db.prepare("INSERT INTO leads(id,site_id,name,email,message,source) VALUES('legacy','synthetic-site','Synthetic retained lead','retained@example.test','Synthetic retained content','fixture')").run();
  const sql = await readFile('packages/admin/migrations/0004_scheduling.sql', 'utf8');
  for (const statement of sql.split('-- statement-breakpoint').map(s => s.trim()).filter(s => /CREATE /.test(s))) await db.prepare(statement).run();
  for (const user of ['owner', 'provider-user', 'analyst', 'other-editor']) {
    const raw = `synthetic-session-${user}`;
    await db.prepare('INSERT INTO sessions(digest,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(raw).digest('hex'), user, Math.floor(Date.now() / 1000) + 3600).run();
    cookies.set(user, `vitris-admin-local=${raw}`);
  }
  const old = await app.getD1Database('OLD_DB', 'scheduling-test');
  for (const statement of (await readFile('packages/admin/migrations/0001_core.sql', 'utf8')).split(';').map(s => s.trim()).filter(Boolean)) await old.prepare(statement).run();
  await old.prepare("INSERT INTO users(id,email,role) VALUES('owner','owner@example.test','owner')").run();
  await old.prepare('INSERT INTO sessions(digest,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update('synthetic-session-owner').digest('hex'), 'owner', Math.floor(Date.now() / 1000) + 3600).run();
});
after(async () => {await app?.dispose();});
beforeEach(async () => {
  for (const table of ['scheduling_jobs', 'scheduling_history', 'scheduling_reservations', 'scheduling_appointments', 'scheduling_commands', 'scheduling_state']) await db.prepare(`DELETE FROM ${table}`).run();
  await db.prepare("UPDATE users SET active=1,role=CASE WHEN id='owner' THEN 'owner' WHEN id='analyst' THEN 'analyst' ELSE 'editor' END").run();
});

test('migration preserves old data; scheduling requires opt-in, login and exact mutation origin', async () => {
  assert.equal((await db.prepare("SELECT message FROM leads WHERE id='legacy'").first<{message: string}>())?.message, 'Synthetic retained content');
  assert.equal((await request('/status', undefined, 'anonymous')).status, 401);
  for (const path of ['/summary','/booking-readiness']) {
    assert.equal((await request(path, undefined, 'anonymous')).status, 401);
    assert.equal((await request(path, undefined, 'analyst')).status, 403);
    assert.equal((await request(path, undefined, 'owner', 'http://127.0.0.1:4392')).status, 404);
  }
  assert.equal((await request('/status', undefined, 'owner', 'http://127.0.0.1:4392')).status, 404);
  assert.equal((await request('/status', undefined, 'analyst')).status, 403);
  assert.equal((await request('/configuration', {revision: 0, config: schedulingFixture()}, 'owner', origin, undefined, 'https://evil.example.test')).status, 403);
  const state = await configuration(); assert.equal(state.revision, 0); assert.equal(state.config.mode, 'disabled');
  assert.equal((await request('/appointments', createBody(0, 'disabled'))).status, 409);
  const publicResponse = await app.dispatchFetch(`${origin}/api/booking/v1/appointments`, {method: 'POST', headers: {origin: 'https://synthetic.example.test'}});
  assert.equal(publicResponse.status, 403);
});

test('configuration is versioned and cannot enable live booking, unknown accounts or invalid references', async () => {
  await save();
  assert.equal((await request('/configuration', {revision: 0, config: schedulingFixture()})).status, 409);
  assert.equal((await request('/configuration', {revision: 1, config: {...schedulingFixture(), mode: 'live'}})).status, 400);
  assert.equal((await request('/configuration', {revision: 1, config: {...schedulingFixture(), grants: [{userId: 'missing', scope: 'all', permissions: ['appointments:read']}]}})).status, 400);
  assert.equal((await configuration()).revision, 1);
  const status = await (await request('/status')).json() as {calendarSync: boolean; publicBooking: boolean; deliveries: string};
  assert.equal(status.calendarSync, false); assert.equal(status.publicBooking, false); assert.equal(status.deliveries, 'captured');
});

test('enabling scheduling against an old schema reports unavailable instead of claiming readiness', async () => {
  const response = await request('/status', undefined, 'owner', 'http://127.0.0.1:4393');
  assert.equal(response.status, 503);
  assert.equal((await response.json() as {code: string}).code, 'schema_unavailable');
  const boot = await app.dispatchFetch('http://127.0.0.1:4393/api/bootstrap', {headers: {cookie: cookies.get('owner')!}});
  assert.equal(boot.status, 503);
});

test('concurrent requests for the same last slot commit at most one complete appointment', async () => {
  await save();
  const results = await Promise.all([request('/appointments', createBody(1, 'race-a')), request('/appointments', createBody(1, 'race-b'))]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM scheduling_appointments').first<{n: number}>())?.n, 1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM scheduling_reservations').first<{n: number}>())?.n, 2);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM scheduling_jobs').first<{n: number}>())?.n, 2);
  assert.equal((await configuration()).revision, 2);
});

test('identical concurrent command retries replay one receipt, while changed payloads conflict', async () => {
  await save(); const input = createBody(1, 'same-command');
  const responses = await Promise.all([request('/appointments', input), request('/appointments', input)]);
  assert.deepEqual(responses.map(r => r.status), [201, 201]);
  assert.deepEqual(await responses[0].json(), await responses[1].json());
  assert.equal((await request('/appointments', {...input, customer: {...input.customer, name: 'Different synthetic name'}})).status, 409);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM scheduling_jobs').first<{n: number}>())?.n, 2);
});

test('shared rooms and providers conflict across services and locations; adjacent times are available', async () => {
  await save(); await create('first');
  assert.equal((await request('/appointments', createBody(2, 'room-conflict', {providerId: 'provider-b'}))).status, 409);
  assert.equal((await request('/appointments', createBody(2, 'location-conflict', {serviceId: 'consult', locationId: 'remote'}))).status, 409);
  const next = await create('adjacent', {providerId: 'provider-b', startsAt: later(30)});
  assert.ok(next.id);
});

test('database triggers reject overlapping multi-resource updates and roll back the entire command batch', async () => {
  await save(); const first = await create('first'); const second = await create('second', {providerId: 'provider-b', startsAt: later(60)});
  const before = await configuration();
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO scheduling_commands(site_id,command_key,actor_id,kind,request_hash,expected_revision,response_json,created_at) VALUES('synthetic-site','synthetic-rollback','owner','appointment','fixture',?,'{}',?)").bind(before.revision, Date.now()),
    db.prepare('UPDATE scheduling_appointments SET starts_at=?,ends_at=?,occupied_starts_at=?,occupied_ends_at=?,revision=revision+1,schedule_revision=? WHERE site_id=? AND id=?').bind(Date.parse(start), Date.parse(later(30)), Date.parse(start), Date.parse(later(30)), before.revision + 1, manifest.site.id, second.id),
  ]), /scheduling_resource_conflict/);
  assert.equal((await configuration()).revision, before.revision);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM scheduling_commands WHERE command_key='synthetic-rollback'").first<{n: number}>())?.n, 0);
  const unchanged = await (await request(`/appointments/${second.id}`)).json() as SchedulingAppointment;
  assert.equal(unchanged.startsAt, later(60)); assert.equal(unchanged.revision, 1);
  assert.equal((await db.prepare('SELECT starts_at FROM scheduling_reservations WHERE site_id=? AND appointment_id=? AND resource_id=?').bind(manifest.site.id, second.id, 'provider-b').first<{starts_at: number}>())?.starts_at, Date.parse(later(60)));
  assert.equal((await db.prepare('SELECT count(*) AS n FROM scheduling_jobs').first<{n: number}>())?.n, 4);
  assert.equal((await (await request(`/appointments/${first.id}`)).json() as SchedulingAppointment).startsAt, start);
});

test('approval reserves resources; decline releases them and illegal lifecycle transitions fail', async () => {
  const config = schedulingFixture(); config.defaultBookingMode = 'approval'; await save(config);
  const receipt = await create('pending');
  const appointment = await (await request(`/appointments/${receipt.id}`)).json() as SchedulingAppointment;
  assert.equal(appointment.status, 'pending_approval'); assert.ok(appointment.expiresAt);
  assert.equal((await request('/appointments', createBody(2, 'reserved'))).status, 409);
  const input = {idempotencyKey: 'decline', revision: 2, appointmentRevision: 1, status: 'declined'};
  assert.equal((await request(`/appointments/${receipt.id}/status`, input)).status, 200);
  assert.equal((await request(`/appointments/${receipt.id}/status`, {...input, idempotencyKey: 'reopen', revision: 3, appointmentRevision: 2, status: 'confirmed'})).status, 409);
  await create('replacement');
});

test('a malformed stored snapshot cannot silently remove the provider reservation', async () => {
  await save(); const receipt = await create('snapshot-integrity');
  for (const snapshot of ['{}', JSON.stringify({resourceIds: ['room']})]) {
    await assert.rejects(db.prepare('UPDATE scheduling_appointments SET snapshot_json=?,revision=revision+1 WHERE site_id=? AND id=?').bind(snapshot, manifest.site.id, receipt.id).run(), /scheduling_invalid_snapshot/);
  }
  assert.equal((await db.prepare('SELECT count(*) AS n FROM scheduling_reservations WHERE site_id=? AND appointment_id=?').bind(manifest.site.id, receipt.id).first<{n: number}>())?.n, 2);
});

test('expired approval holds stop blocking immediately and cannot be approved', async () => {
  const config = schedulingFixture(); config.defaultBookingMode = 'approval'; await save(config);
  const receipt = await create('will-expire');
  // Synthetic clock fixture: only this isolated record is aged past its expiry.
  await db.prepare('UPDATE scheduling_appointments SET expires_at=1,revision=revision+1 WHERE site_id=? AND id=?').bind(manifest.site.id, receipt.id).run();
  assert.equal((await (await request(`/appointments/${receipt.id}`)).json() as SchedulingAppointment).status, 'expired');
  assert.equal((await request(`/appointments/${receipt.id}/status`, {idempotencyKey: 'late-approval', revision: 2, appointmentRevision: 2, status: 'confirmed'})).status, 409);
  await create('after-expiry');
});

test('staff rescheduling keeps policy and price snapshots; disabling booking still allows cancellation', async () => {
  await save(); const receipt = await create('reschedule');
  const state = await configuration(); state.config.services[0].durationMinutes = 90; state.config.services[0].price.amountMinor = 20000; await save(state.config);
  const response = await request(`/appointments/${receipt.id}/reschedule`, {idempotencyKey: 'new-time', revision: 3, appointmentRevision: 1, locationId: 'main', providerId: 'provider-a', startsAt: later(120)});
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const appointment = await (await request(`/appointments/${receipt.id}`)).json() as SchedulingAppointment;
  assert.equal(appointment.snapshot.service.price.amountMinor, 5000); assert.equal(Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt), 30 * 60000);
  state.config.mode = 'disabled'; await save(state.config);
  assert.equal((await request(`/appointments/${receipt.id}/status`, {idempotencyKey: 'cancel-disabled', revision: 5, appointmentRevision: 2, status: 'cancelled'})).status, 200);
  assert.equal((await request('/appointments', createBody(6, 'still-disabled'))).status, 409);
});

test('explicit own grants scope appointments, history and availability without leaking other configuration', async () => {
  const config = schedulingFixture(); config.grants = [{userId: 'provider-user', scope: 'own', permissions: ['appointments:read', 'appointments:write', 'availability:write']}]; await save(config);
  const own = await create('own'); const other = await create('other', {providerId: 'provider-b', startsAt: later(60)});
  const list = await (await request('', undefined, 'provider-user')).json() as {rows: SchedulingAppointment[]};
  assert.deepEqual(list.rows.map(a => a.id), [own.id]);
  assert.equal((await request(`/appointments/${other.id}`, undefined, 'provider-user')).status, 404);
  assert.equal((await request(`/appointments/${other.id}/history`, undefined, 'provider-user')).status, 404);
  assert.equal((await request('/configuration', undefined, 'provider-user')).status, 403);
  assert.equal((await request('/jobs', undefined, 'provider-user')).status, 403);
  assert.equal((await request('/availability-settings?resourceId=provider-b', undefined, 'provider-user')).status, 404);
  const settings = await (await request('/availability-settings?resourceId=provider-a', undefined, 'provider-user')).json() as {weeklyHours: unknown[]; revision: number};
  const updated = await request('/availability-settings', {revision: settings.revision, resourceId: 'provider-a', weeklyHours: settings.weeklyHours, exceptions: []}, 'provider-user');
  assert.equal(updated.status, 200); assert.equal('config' in (await updated.json() as object), false);
  const boot = await (await app.dispatchFetch(`${origin}/api/bootstrap`, {headers: {cookie: cookies.get('provider-user')!}})).json() as BootstrapResponse;
  assert.ok(boot.modules.some(m => m.id === 'scheduling'));
  await db.prepare("UPDATE users SET active=0 WHERE id='provider-user'").run();
  assert.equal((await request('', undefined, 'provider-user')).status, 401);
});

test('site boundaries and revoked grants apply to records, receipts and configuration', async () => {
  const config = schedulingFixture(); config.grants = [{userId: 'provider-user', scope: 'own', permissions: ['appointments:read', 'appointments:write']}]; await save(config);
  const receipt = await create('private');
  assert.equal((await request(`/appointments/${receipt.id}`, undefined, 'owner', 'http://localhost:4391')).status, 404);
  assert.equal((await request('/configuration', undefined, 'owner', 'http://localhost:4391')).status, 200);
  assert.equal((await request('', undefined, 'other-editor')).status, 403);
  config.grants = []; await save(config);
  assert.equal((await request(`/appointments/${receipt.id}`, undefined, 'provider-user')).status, 403);
  assert.equal((await request('/appointments', createBody(3, 'private'), 'provider-user')).status, 403);
});

test('the transaction guard rechecks account revocation and own scope at commit time', async () => {
  const config = schedulingFixture(); config.grants = [{userId: 'provider-user', scope: 'own', permissions: ['appointments:read', 'appointments:write']}]; await save(config);
  const command = (target: string) => db.prepare("INSERT INTO scheduling_commands(site_id,command_key,actor_id,kind,request_hash,expected_revision,response_json,created_at,targets_json) VALUES('synthetic-site','synthetic-scope-check','provider-user','appointment','fixture',1,'{}',?,?)").bind(Date.now(), JSON.stringify([target]));
  await assert.rejects(command('provider-b').run(), /scheduling_access_denied/);
  await db.prepare("UPDATE users SET active=0 WHERE id='provider-user'").run();
  await assert.rejects(command('provider-a').run(), /scheduling_access_denied/);
  assert.equal((await configuration()).revision, 1);
});

test('request bodies and date searches remain bounded and delivery is explicitly captured', async () => {
  await save(); await create('captured');
  assert.equal((await request('/appointments', {padding: 'x'.repeat(9000)})).status, 413);
  assert.equal((await request(`/availability?serviceId=visit&locationId=main&startsAt=${start}&endsAt=${later(8 * 24 * 60)}`)).status, 400);
  const jobs = await (await request('/jobs')).json() as {delivery: string; rows: {status: string}[]};
  assert.equal(jobs.delivery, 'captured'); assert.equal(jobs.rows.length, 2); assert.ok(jobs.rows.every(j => j.status === 'captured'));
  const response = await request(`/availability?serviceId=visit&locationId=main&startsAt=${start}&endsAt=${later(120)}`);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('the UI workspace response filters scoped catalogs and reserves configuration and accounts for managers', async () => {
  const config = schedulingFixture(); config.grants = [{userId: 'provider-user', scope: 'own', permissions: ['appointments:read']}]; await save(config);
  const own = await (await request('/workspace', undefined, 'provider-user')).json() as {configuration?: unknown; accounts?: unknown; catalog: {resources: {id: string; userId?: string}[]; services: {providerIds: string[]}[]}};
  assert.equal(own.configuration, undefined); assert.equal(own.accounts, undefined);
  assert.ok(own.catalog.resources.every(r => r.id !== 'provider-b' && r.userId === undefined));
  assert.ok(own.catalog.services.every(s => s.providerIds.every(id => id === 'provider-a')));
  const manager = await (await request('/workspace')).json() as {configuration?: unknown; accounts?: {id: string; email: string; active: number; role?: string}[]};
  assert.ok(manager.configuration); assert.ok(manager.accounts?.some(a => a.id === 'provider-user')); assert.ok(manager.accounts?.every(a => a.role === undefined));
});

test('rescheduling availability excludes the authorized appointment and preserves its original duration', async () => {
  await save(); const appointment = await create('availability-for-reschedule');
  const state = await configuration(); state.config.services[0].durationMinutes = 90; state.config.services[0].price.amountMinor = 20000; await save(state.config);
  const query = `/availability?serviceId=visit&locationId=main&providerId=provider-a&startsAt=${start}&endsAt=${later(1)}`;
  const ordinary = await (await request(query)).json() as {slots: unknown[]}; assert.equal(ordinary.slots.length, 0);
  const replacement = await (await request(`${query}&appointmentId=${appointment.id}`)).json() as {slots: {startsAt: string; endsAt: string}[]; terms: {price: {amountMinor: number}}};
  assert.equal(replacement.slots[0]?.startsAt, start); assert.equal(replacement.slots[0]?.endsAt, later(30));
  assert.equal(replacement.terms.price.amountMinor, 5000);
  const config = (await configuration()).config; config.grants = [{userId: 'provider-user', scope: 'own', permissions: ['appointments:read']}]; await save(config);
  const other = await create('other-provider-reschedule', {providerId: 'provider-b', startsAt: later(120)});
  assert.equal((await request(`${query}&appointmentId=${other.id}`, undefined, 'provider-user')).status, 404);
});
