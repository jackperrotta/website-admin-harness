import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createAdmin, type AdminEnv} from '../packages/admin/dist/worker.js';
import type {AnalyticsResponse, BootstrapResponse, ChatGPTBusinessResponse, LeadsResponse} from '../packages/contracts/src/index.ts';

const profile = {
  name: 'Fixture', website: 'https://business.test', inquiryUrl: 'https://business.test/contact/',
  description: null, telephone: null, email: null, address: null,
};
const manifest = {
  schemaVersion: 1, installationId: 'installation', business: {name: 'Fixture', initials: 'F'},
  site: {id: 'site', name: 'Main', origin: profile.website}, adminOrigin: 'https://admin.business.test',
  modules: ['chatgpt-business'], chatgptBusiness: {profile},
  backend: {provider: 'vitris-harness', origin: 'https://backend.test', tenantId: 'tenant'},
};
const identity = {schemaVersion: 1, installationId: 'installation', tenantId: 'tenant', siteOrigin: profile.website};
const status = {claim: 'pending', verification: 'not_started', agent: 'draft', lastChecked: '2026-11-13', revision: 0};
const endpoint = '/api/settings/chatgpt-business';

test('ChatGPT status is owner-only, revision-checked and scoped to the installation and site', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const migrate = (file: string) => db.exec(readFileSync(`packages/admin/migrations/${file}`, 'utf8'));
  migrate('0001_core.sql');
  const prepare = (sql: string, values: string[] = []) => ({
    bind: (...params: string[]) => prepare(sql, params),
    first: async () => db.prepare(sql).get(...values) ?? null,
    run: async () => db.prepare(sql).run(...values),
  });
  for (const role of ['owner', 'administrator', 'analyst']) {
    db.prepare('INSERT INTO users(id,email,role) VALUES(?,?,?)').run(role, role+'@example.test', role);
    db.prepare('INSERT INTO sessions(digest,user_id,expires_at) VALUES(?,?,?)')
      .run(createHash('sha256').update(role).digest('hex'), role, Math.floor(Date.now()/1000)+600);
  }
  let requested = new URL('https://backend.test');
  let attribution: unknown;
  const lead = {id: 'lead', name: 'Fixture', email: 'fixture@example.test', message: 'Inquiry', status: 'new', created_at: '2026-11-13', source: 'Website inquiry'};
  let leadAttribution: string | undefined;
  const env = {
    DB: {prepare}, ASSETS: {fetch: async () => new Response('Fixture')}, HARNESS_API_TOKEN: 'synthetic-token-longer-than-32-characters',
    HARNESS_SERVICE: {fetch: async (request: Request) => {
      requested = new URL(request.url);
      if (requested.pathname.endsWith('/status')) return Response.json({...identity, scopes: ['analytics:read', 'leads:read']});
      if (requested.pathname.endsWith('/leads')) return Response.json({...identity, source: 'connected', writable: false, rows: [{...lead, attribution_source: leadAttribution}]});
      return Response.json({...identity, source: 'connected', rows: [{day: '2026-11-13', views: 2, visitors: 1, enquiries: 1}], chatgptAttribution: attribution});
    }},
  } as unknown as AdminEnv;
  const app = createAdmin(manifest);
  const call = (path: string, {role = 'owner', body, origin = manifest.adminOrigin, instance = app}: {
    role?: string; body?: object; origin?: string; instance?: typeof app;
  } = {}) => instance.fetch(new Request(manifest.adminOrigin+path, {
    headers: {cookie: `__Host-vitris-admin=${role}`, origin, 'content-type': 'application/json'},
    ...(body ? {method: 'POST', body: JSON.stringify(body)} : {}),
  }), env);
  async function read<T>(path: string, options?: Parameters<typeof call>[1]) {
    const response = await call(path, options);
    assert.equal(response.status, 200);
    return await response.json() as T;
  }

  assert.equal((await call(endpoint, {role: ''})).status, 401);
  assert.equal((await call(endpoint, {role: 'administrator'})).status, 403);
  assert.equal((await call(endpoint, {role: 'administrator', body: status})).status, 403);
  assert.equal((await call(endpoint)).status, 503);
  migrate('0014_chatgpt_business.sql');
  const initial = await read<ChatGPTBusinessResponse>(endpoint);
  assert.deepEqual(initial.profile, profile);
  assert.equal(initial.status.lastChecked, null);
  assert.equal(initial.status.revision, 0);
  assert.equal((await call(endpoint, {body: status, origin: 'https://untrusted.test'})).status, 403);
  for (const body of [{...status, lastChecked: '2026-02-30'}, {...status, verification: 'other'}, {...status, verificationCode: 'fixture-code'}, {...status, siteId: 'other'}]) {
    assert.equal((await call(endpoint, {body})).status, 400);
  }
  assert.equal((await call(endpoint, {body: status})).status, 200);
  assert.equal((await call(endpoint, {body: status})).status, 409);
  assert.equal((await call(endpoint, {body: {...status, claim: 'approved', revision: 1}})).status, 200);
  assert.equal((await read<ChatGPTBusinessResponse>(endpoint)).status.claim, 'approved');
  for (const other of [{...manifest, installationId: 'other'}, {...manifest, site: {...manifest.site, id: 'other'}}]) {
    assert.equal((await read<ChatGPTBusinessResponse>(endpoint, {instance: createAdmin(other)})).status.revision, 0);
  }
  const disabled = createAdmin({...manifest, modules: []});
  assert.equal((await call(endpoint, {instance: disabled})).status, 404);
  const boot = await read<BootstrapResponse>('/api/bootstrap', {role: 'administrator'});
  assert.equal(boot.manifest.chatgptBusiness, undefined);
  assert.equal(boot.modules.some((item: {id: string}) => item.id === 'chatgpt-business'), false);
  assert.throws(() => createAdmin({...manifest, chatgptBusiness: {profile: {...profile, inquiryUrl: 'https://other.test/contact'}}}), /exact public HTTPS website/);

  const analytics = '/api/analytics?days=30&attribution=chatgpt';
  const legacy = await read<AnalyticsResponse>(analytics, {role: 'analyst'});
  assert.equal(legacy.chatgptAttribution, undefined);
  assert.equal(legacy.rows[0].views, 2);
  assert.equal(requested.search, '?days=30&attribution=chatgpt');
  attribution = {version: 1, days: 30, sources: [{source: 'chatgpt', landingPageviews: 0, landingPages: [], acceptedInquiries: null}, {source: 'chatgpt_paid'}]};
  const report = await read<AnalyticsResponse>(analytics, {role: 'analyst'});
  assert.deepEqual(report.chatgptAttribution, attribution);
  assert.equal((await read<AnalyticsResponse>(analytics, {instance: disabled})).chatgptAttribution, undefined);
  assert.equal(requested.search, '?days=30');
  assert.equal((await read<LeadsResponse>('/api/leads')).rows[0].attribution_source, undefined);
  leadAttribution = 'chatgpt_paid';
  const inbox = await read<LeadsResponse>('/api/leads');
  assert.equal(inbox.rows[0].attribution_source, 'chatgpt_paid');
  assert.equal(inbox.rows[0].source, 'Website inquiry');
  assert.equal(inbox.writable, false);
});
