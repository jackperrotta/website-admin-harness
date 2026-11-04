import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {createPortfolioFixture} from './client-portfolio-fixture.ts';
import {startPortfolioOwnerAccess, refreshPortfolioOwnerAccess, type OwnerLinks} from '../scripts/portfolio-owner-access.ts';
import type {PortfolioState, BootstrapResponse} from '../packages/contracts/src/index.ts';

const catalog: PortfolioState = {clients: [], websites: [], changes: [], runnerOnline: false};
const live = {catalog, analytics: async () => Response.json({error: 'No fixture connection'}, {status: 503})};
const token = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get('token');

test('private preview access renews through authenticated local IPC without resetting records or adding HTTP demo login', {timeout: 90000}, async () => {
  const f = await createPortfolioFixture({live, onboarding: true}), directory = await mkdtemp(join(tmpdir(), 'vitris-owner-control-'));
  let control: Awaited<ReturnType<typeof startPortfolioOwnerAccess>> | undefined;
  try {
    control = await startPortfolioOwnerAccess(f, directory);
    const boot = await (await f.app.dispatchFetch(`${f.origin}/api/bootstrap`)).json() as BootstrapResponse;
    assert.equal(boot.emailLoginConfigured, false); assert.equal(boot.privateLocalSignIn, true); assert.equal(boot.localDemo, false);
    assert.equal((await f.app.dispatchFetch(`${f.origin}/api/auth/demo`, {method: 'POST', headers: {origin: f.origin}})).status, 404);
    const confirm = (url: string) => f.app.dispatchFetch(`${f.origin}/api/auth/confirm`, {method: 'POST', headers: {origin: f.origin, 'content-type': 'application/json'}, body: JSON.stringify({token: token(url)})});
    const before = JSON.parse(await readFile(join(directory, 'portfolio-owner.json'), 'utf8')) as OwnerLinks;
    const login = await confirm(before.url); assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const record = await f.app.dispatchFetch(`${f.origin}/api/modules/client-onboarding`, {method: 'POST', headers: {cookie, origin: f.origin, 'content-type': 'application/json'}, body: JSON.stringify({business: 'Preserved fixture', name: 'Morgan', email: 'morgan@example.test', previewUrl: '', message: '', fields: [], requiresPayment: false})}); assert.equal(record.status, 200);
    const after = await refreshPortfolioOwnerAccess(directory); assert.notEqual(token(after.url), token(before.url));
    assert.equal((await confirm(before.url)).status, 401); assert.equal((await confirm(after.url)).status, 200);
    const records = await f.app.dispatchFetch(`${f.origin}/api/modules/client-onboarding`, {headers: {cookie}});
    assert.equal((await records.json() as {rows: unknown[]}).rows.length, 1);
    const privateControl = await readFile(join(directory, 'portfolio-owner-control.json'), 'utf8');
    await writeFile(join(directory, 'portfolio-owner-control.json'), JSON.stringify({...JSON.parse(privateControl), nonce: '0'.repeat(64)}));
    await assert.rejects(refreshPortfolioOwnerAccess(directory), /rejected/);
    await writeFile(join(directory, 'portfolio-owner-control.json'), privateControl);
    await f.db.prepare("UPDATE users SET active=0 WHERE id='portfolio-owner'").run();
    await assert.rejects(refreshPortfolioOwnerAccess(directory), /rejected/);
    assert.equal((await f.app.dispatchFetch(`${f.origin}/api/auth/local-owner`, {method: 'POST', headers: {origin: f.origin}})).status, 401);
    await assert.rejects(startPortfolioOwnerAccess({...f, origin: 'https://admin.example.test'}, directory), /loopback/);
  } finally {await control?.close(); await f.app.dispose();}
});

test('plain local URLs explain private sign-in; expired links recover and fresh sign-in opens onboarding and survives refresh', {timeout: 120000}, async () => {
  const f = await createPortfolioFixture({live, onboarding: true}), directory = await mkdtemp(join(tmpdir(), 'vitris-owner-browser-'));
  let control: Awaited<ReturnType<typeof startPortfolioOwnerAccess>> | undefined;
  const browser = await chromium.launch({headless: true});
  try {
    control = await startPortfolioOwnerAccess(f, directory);
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    await page.goto(`${f.origin}/#client-onboarding`);
    await page.getByRole('heading', {name: 'Open your local workspace'}).waitFor();
    assert.equal(await page.getByRole('button', {name: 'Email me a sign-in link'}).count(), 0);
    await page.getByText('npm run vitris:signin', {exact: true}).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await mkdir('artifacts/local-preview-access', {recursive: true});
    await page.screenshot({path: 'artifacts/local-preview-access/signin-mobile.png', fullPage: true});
    const expired = await refreshPortfolioOwnerAccess(directory);
    await f.db.prepare('UPDATE login_tokens SET expires_at=1').run();
    await page.goto(expired.url); await page.getByRole('button', {name: 'Continue to workspace'}).click();
    await page.getByText('This sign-in link has expired or was already used', {exact: true}).waitFor();
    await page.reload(); await page.getByRole('heading', {name: 'Open your local workspace'}).waitFor();
    const fresh = await refreshPortfolioOwnerAccess(directory);
    await page.goto(fresh.url); await page.getByRole('button', {name: 'Continue to workspace'}).click();
    await page.getByRole('heading', {name: 'From first look to welcome aboard.'}).waitFor();
    assert.equal(new URL(page.url()).hash, '#client-onboarding');
    await page.reload(); await page.getByRole('heading', {name: 'From first look to welcome aboard.'}).waitFor();
    await page.setViewportSize({width: 1536, height: 1100});
    await page.screenshot({path: 'artifacts/local-preview-access/authenticated-desktop.png', fullPage: true});
    await page.getByRole('link', {name: 'Clients', exact: true}).click(); await page.getByRole('heading', {name: 'Good work. All in view.'}).waitFor();
    await page.getByRole('button', {name: 'Sign out', exact: true}).click();
    await page.getByRole('heading', {name: 'Open your local workspace'}).waitFor();
    // Clients of an older bootstrap retain their previous email-form behavior.
    await page.route('**/api/bootstrap', async route => {const response = await route.fetch(); const data = await response.json(); delete data.emailLoginConfigured; delete data.privateLocalSignIn; await route.fulfill({response, json: data});});
    await page.reload(); await page.getByRole('button', {name: 'Email me a sign-in link'}).waitFor();
  } finally {await browser.close(); await control?.close(); await f.app.dispose();}
});
