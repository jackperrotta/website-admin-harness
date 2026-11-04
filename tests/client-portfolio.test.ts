import {test, before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {can, type PortfolioResponse} from '../packages/contracts/src/index.ts';
import {createPortfolioFixture} from './client-portfolio-fixture.ts';

let fixture: Awaited<ReturnType<typeof createPortfolioFixture>>;
before(async () => {fixture = await createPortfolioFixture();});
after(async () => {await fixture?.app.dispose();});
beforeEach(async () => {await fixture.db.prepare('DELETE FROM client_portfolio_prototype').run();});
const state = async () => await (await fixture.request()).json() as PortfolioResponse;
const post = (path: string, data: unknown) => fixture.request(path, data);

test('only the owner has portfolio capabilities; auth, exact host and Origin remain mandatory', async () => {
  assert.ok(can('owner', 'clients:read')); assert.ok(can('owner', 'client-releases:publish'));
  for (const role of ['analyst', 'administrator', 'editor'] as const) assert.equal(can(role, 'clients:read'), false);
  assert.equal((await fixture.request('', undefined, 'none')).status, 401);
  for (const role of ['analyst', 'administrator']) assert.equal((await fixture.request('', undefined, role)).status, 403);
  assert.equal((await fixture.request('/runner', {revision: 0, online: false}, 'owner', {origin: 'https://evil.example.test'})).status, 403);
  assert.equal((await fixture.app.dispatchFetch('http://localhost:4393/api/modules/client-portfolio', {headers: {cookie: fixture.cookies.owner}})).status, 421);
  await fixture.db.prepare("UPDATE users SET active=0 WHERE id='owner'").run();
  assert.equal((await fixture.request()).status, 401);
  await fixture.db.prepare("UPDATE users SET active=1 WHERE id='owner'").run();
});

test('synthetic analytics cover three reporting sites and preserve failed connection coverage', async () => {
  const value = await state(); assert.equal(value.simulated, true); assert.equal(value.clients.length, 3); assert.equal(value.websites.length, 4);
  assert.equal(value.websites.filter(s => s.connection === 'healthy').length, 3);
  assert.deepEqual(value.websites.find(s => s.connection === 'unavailable')?.rows, []);
  assert.ok(value.websites.filter(s => s.connection === 'healthy').every(s => s.rows.length === 30 && s.previousRows.length === 30));
  assert.equal(value.websites.filter(s => s.clientId === 'alder').length, 2);
});

test('request, preview, explicit candidate approval and simulated publication persist with one receipt', async () => {
  let current = await state();
  const input = {revision: current.revision, websiteId: 'alder-main', title: 'A clearer consultation link', request: 'Move the consultation link into the hero.', idempotencyKey: 'unique-request-key'};
  let response = await post('/changes', input); assert.equal(response.status, 200); current = await response.json() as PortfolioResponse;
  const id = current.changes[0].id;
  assert.equal((await post('/changes', input)).status, 200); assert.equal((await state()).changes.filter(c => c.id === id).length, 1);
  for (const action of ['start', 'prepare']) {response = await post(`/changes/${id}/${action}`, {revision: current.revision}); assert.equal(response.status, 200); current = await response.json() as PortfolioResponse;}
  const candidate = current.changes[0].candidate; assert.ok(candidate);
  assert.equal((await post(`/changes/${id}/queue`, {revision: current.revision, candidate: 'stale-candidate', reviewed: true})).status, 409);
  assert.equal((await post(`/changes/${id}/queue`, {revision: current.revision, candidate})).status, 400);
  response = await post(`/changes/${id}/queue`, {revision: current.revision, candidate, reviewed: true}); assert.equal(response.status, 200); current = await response.json() as PortfolioResponse;
  const publish = {revision: current.revision, candidate};
  response = await post(`/changes/${id}/publish`, publish); assert.equal(response.status, 200); current = await response.json() as PortfolioResponse;
  assert.equal(current.changes[0].status, 'published'); assert.equal(current.changes[0].receipt?.simulated, true);
  const receipt = current.changes[0].receipt?.id; await post(`/changes/${id}/publish`, publish);
  assert.equal((await state()).changes[0].receipt?.id, receipt);
});

test('concurrent updates, cross-site IDs, missing records, malformed and oversized requests fail closed', async () => {
  const current = await state();
  await fixture.db.prepare('INSERT INTO client_portfolio_prototype(site_id,payload) VALUES(?,?)').bind('other-installation', JSON.stringify({...current, clients: [{id: 'secret', name: 'PRIVATE RECORD'}]})).run();
  assert.ok(!JSON.stringify(await state()).includes('PRIVATE RECORD'));
  assert.equal((await post('/changes', {revision: current.revision, websiteId: 'private-site', title: 'x', request: 'x', idempotencyKey: 'scope-check'})).status, 404);
  assert.equal((await post('/changes/missing/cancel', {revision: current.revision})).status, 404);
  assert.equal((await post('/runner', {revision: -1, online: true})).status, 400);
  assert.equal((await post('/changes', {revision: current.revision, websiteId: 'alder-main', title: 'x', request: 'x'.repeat(13000), idempotencyKey: 'size-check'})).status, 400);
  const results = await Promise.all([true, false].map(online => post('/runner', {revision: current.revision, online})));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await state()).revision, current.revision + 1);
  const other = await fixture.db.prepare('SELECT revision FROM client_portfolio_prototype WHERE site_id=?').bind('other-installation').first<{revision: number}>(); assert.equal(other?.revision, 0);
});

test('offline, failed, retried and canceled changes cannot publish or bypass candidate stages', async () => {
  let current = await state();
  const update = async (path: string, data = {}) => {const r = await post(path, {revision: current.revision, ...data}); assert.equal(r.status, 200); current = await r.json() as PortfolioResponse;};
  await update('/changes', {websiteId: 'alder-main', title: 'Failure scenario', request: 'A synthetic request.', idempotencyKey: 'failure-scenario'});
  const id = current.changes[0].id;
  await update('/runner', {online: false}); assert.equal((await post(`/changes/${id}/start`, {revision: current.revision})).status, 409);
  await update('/runner', {online: true}); await update(`/changes/${id}/start`); await update(`/changes/${id}/fail`);
  assert.equal(current.changes[0].status, 'failed'); assert.equal(current.changes[0].candidate, null);
  await update(`/changes/${id}/retry`); await update(`/changes/${id}/cancel`);
  assert.equal((await post(`/changes/${id}/publish`, {revision: current.revision, candidate: 'forged'})).status, 409);
  assert.equal(current.changes[0].receipt, null);
});

test('ordinary installations need no portfolio table; production and remote-backend modes cannot run the prototype', {timeout: 120000}, async () => {
  for (const options of [{enabled: false, applyModuleMigration: false}, {mode: 'production', adminOrigin: 'https://admin.example.test'}, {backend: {provider: 'vitris-harness' as const, origin: 'https://backend.example.test', tenantId: 'synthetic'}}]) {
    const other = await createPortfolioFixture(options);
    try {
      assert.equal((await other.request()).status, 404);
      if (options.enabled === false) {
        const boot = await other.app.dispatchFetch(`${other.origin}/api/bootstrap`, {headers: {cookie: other.cookies.owner}});
        assert.deepEqual((await boot.json() as {modules: unknown[]}).modules, []);
        assert.equal((await other.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='client_portfolio_prototype'").first<{n: number}>())?.n, 0);
      } else assert.equal((await other.db.prepare('SELECT count(*) AS n FROM client_portfolio_prototype').first<{n: number}>())?.n, 0);
    } finally {await other.app.dispose();}
  }
});
