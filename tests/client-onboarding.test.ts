import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPortfolioFixture} from './client-portfolio-fixture.ts';
import type {Prospect, ProspectWorkspace, ProspectPortal} from '../packages/contracts/src/index.ts';

const password = 'a local sample password for testing';
const draft = (email = 'morgan@example.test') => ({business: 'Alder & Stone', name: 'Morgan Ellis', email, previewUrl: '', message: 'Welcome to your test site.', fields: [{id: 'phone', label: 'Business phone', required: true, value: ''}, {id: 'address', label: 'Business address', required: true, value: '100 Example Avenue'}], requiresPayment: true});
function helpers(f: Awaited<ReturnType<typeof createPortfolioFixture>>) {
  const request = (path = '', data?: unknown, cookie = f.cookies.owner, origin = f.origin) => f.app.dispatchFetch(`${f.origin}/api/modules/client-onboarding${path}`, {method: data === undefined ? 'GET' : 'POST', headers: {cookie, ...(data === undefined ? {} : {origin, 'content-type': 'application/json'})}, ...(data === undefined ? {} : {body: JSON.stringify(data)})});
  const publicRequest = (path: string, data: unknown = {}, cookie = '') => request('/hooks/' + path, data, cookie);
  const invite = async (id: string) => {const result = await request(`/${id}/invite`, {}); assert.equal(result.status, 200); const v = await result.json() as ProspectWorkspace & {invitation: {url: string}}; return new URLSearchParams(new URL(v.invitation.url).hash.slice(1)).get('token')!;};
  return {request, publicRequest, invite};
}

test('prospect previews, per-client signup, payment demo and feedback stay outside staff access; revoke closes sessions', {timeout: 180000}, async () => {
  const f = await createPortfolioFixture({onboarding: true}); const h = helpers(f);
  try {
    const created = await h.request('', draft()); assert.equal(created.status, 200);
    const row = (await created.json() as ProspectWorkspace).rows[0]; assert.equal(row.status, 'draft');
    const token = await h.invite(row.id);
    for (let i = 0; i < 2; i++) {const preview = await h.publicRequest('invitation', {token}); assert.equal(preview.status, 200); assert.equal((await preview.json() as ProspectPortal).business, row.business);}
    const invalid = {token, name: 'Morgan', password, confirmPassword: password, fields: row.fields};
    assert.equal((await h.publicRequest('activate', invalid)).status, 400);
    const complete = {...invalid, fields: row.fields.map(v => ({...v, value: v.value || '555-0100'}))};
    assert.equal((await h.publicRequest('activate', {...complete, fields: complete.fields.map(v => ({...v, required: false}))})).status, 400);
    const attempts = await Promise.all([h.publicRequest('activate', complete), h.publicRequest('activate', complete)]);
    assert.deepEqual(attempts.map(r => r.status).sort(), [200, 410]);
    const cookie = attempts.find(r => r.ok)!.headers.get('set-cookie')!.split(';')[0];
    assert.match(cookie, /^vitris-prospect-local=/); assert.equal((await h.publicRequest('invitation', {token})).status, 410);
    const boot = await f.app.dispatchFetch(`${f.origin}/api/bootstrap`, {headers: {cookie}}); assert.equal((await boot.json() as {user: unknown}).user, null);
    const users = await f.db.prepare('SELECT COUNT(*) AS n FROM users').first<{n: number}>(); assert.equal(users!.n, 3);
    const scopeCount = await f.db.prepare('SELECT COUNT(*) AS n FROM password_credentials').first<{n: number}>(); assert.equal(scopeCount!.n, 0);
    const records = await h.request(); const raw = await records.text(); assert.ok(!raw.includes(token)); assert.ok(!/credential|invite_digest|salt|tag/.test(raw));
    assert.equal((await h.publicRequest('workspace', {}, cookie)).status, 200);
    const payment = await h.publicRequest('payment-demo', {confirmed: true, prospectId: 'someone-else'}, cookie); assert.equal(payment.status, 200); assert.equal((await payment.json() as ProspectPortal).paymentStatus, 'demo_complete');
    const feedback = await h.publicRequest('feedback', {feedback: 'Please make the contact link clearer.', prospectId: 'someone-else'}, cookie); assert.equal(feedback.status, 200);
    assert.equal((await feedback.json() as ProspectPortal).feedback, 'Please make the contact link clearer.');
    assert.equal((await h.publicRequest('login', {email: row.email, password: 'incorrect'})).status, 401);
    const login = await h.publicRequest('login', {email: row.email, password}); assert.equal(login.status, 200);
    const secondCookie = login.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await h.request(`/${row.id}/revoke`, {})).status, 200);
    assert.equal((await h.publicRequest('workspace', {}, cookie)).status, 401); assert.equal((await h.publicRequest('workspace', {}, secondCookie)).status, 401);
    assert.equal((await h.publicRequest('login', {email: row.email, password})).status, 401);
  } finally {await f.app.dispose();}
});

test('onboarding invitation replacement, expiry, exact origins, scoped IDs and owner permissions are enforced', {timeout: 150000}, async () => {
  const f = await createPortfolioFixture({onboarding: true}); const h = helpers(f);
  try {
    assert.equal((await h.request('', undefined, '')).status, 401);
    assert.equal((await h.request('', undefined, f.cookies.analyst)).status, 403);
    assert.equal((await h.request('', draft(), f.cookies.administrator)).status, 403);
    assert.equal((await h.request('', draft(), f.cookies.owner, 'https://other.test')).status, 403);
    assert.equal((await h.request('', {...draft(), previewUrl: 'javascript:alert(1)'})).status, 400);
    const created = await h.request('', draft()); const row = (await created.json() as ProspectWorkspace).rows[0];
    assert.equal((await h.request('', draft())).status, 409);
    const old = await h.invite(row.id), fresh = await h.invite(row.id);
    assert.equal((await h.publicRequest('invitation', {token: old})).status, 410);
    assert.equal((await h.request('/hooks/invitation', {token: fresh}, '', 'https://other.test')).status, 403);
    await f.db.prepare("UPDATE client_onboarding_prospects SET admin_origin='http://127.0.0.1:1' WHERE id=?").bind(row.id).run();
    assert.equal((await h.publicRequest('invitation', {token: fresh})).status, 410); assert.equal((await h.request(`/${row.id}/revoke`, {})).status, 404);
    await f.db.prepare('UPDATE client_onboarding_prospects SET admin_origin=?,expires_at=1 WHERE id=?').bind(f.origin, row.id).run();
    assert.equal((await h.publicRequest('invitation', {token: fresh})).status, 410);
    const state = await (await h.request()).json() as ProspectWorkspace; assert.equal(state.rows[0].status, 'expired');
  } finally {await f.app.dispose();}
  for (const options of [{enabled: false, applyModuleMigration: false}, {mode: 'production'}]) {
    const isolated = await createPortfolioFixture({onboarding: true, ...options}); const h = helpers(isolated);
    try {assert.ok([404, 503].includes((await h.request()).status)); assert.ok([404, 503].includes((await h.publicRequest('invitation', {token: 'a'.repeat(72)})).status));} finally {await isolated.app.dispose();}
  }
});
