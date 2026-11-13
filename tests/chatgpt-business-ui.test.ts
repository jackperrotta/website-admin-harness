import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {chromium} from 'playwright';

test('admin shows onboarding only to owners and renders attribution on desktop and mobile', async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({permissions: ['clipboard-read', 'clipboard-write']});
    const page = await context.newPage();
    let role = 'owner', legacy = false;
    const origin = 'http://127.0.0.1:4391';
    const manifest = {schemaVersion: 1, installationId: 'fixture', business: {name: 'Fixture', initials: 'F'},
      site: {id: 'fixture', name: 'Main', origin: 'https://business.test'}, adminOrigin: origin, modules: ['chatgpt-business']};
    const profile = {name: 'Fixture', website: manifest.site.origin, description: 'Public listing description', telephone: null,
      email: 'hello@example.test', address: null, inquiryUrl: 'https://business.test/contact/'};
    let status = {claim: 'not_started', verification: 'not_started', agent: 'not_started', lastChecked: null as string|null, revision: 0};
    const ui = resolve('packages/admin/dist/client');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(origin+'/**', async route => {
      const {pathname, searchParams} = new URL(route.request().url());
      switch (pathname) {
        case '/api/bootstrap': return route.fulfill({json: {manifest, user: {id: role, email: role+'@example.test', role},
          capabilities: ['settings', 'analytics', 'leads'], modules: [], connected: true, chatgptBusinessEnabled: true}});
        case '/api/settings': return route.fulfill({json: {notification_email: '', revision: 0}});
        case '/api/settings/chatgpt-business':
          assert.equal(role, 'owner');
          if (route.request().method() === 'POST') status = {...route.request().postDataJSON(), revision: status.revision+1};
          return route.fulfill({json: {profile, status}});
        case '/api/analytics':
          assert.equal(searchParams.get('attribution'), 'chatgpt');
          return route.fulfill({json: {source: 'connected', timezone: 'UTC', days: Number(searchParams.get('days')), rows: [],
            ...(legacy ? {} : {chatgptAttribution: {version: 1, days: Number(searchParams.get('days')), sources: [
              {source: 'chatgpt', landingPageviews: 5, acceptedInquiries: null, landingPages: [{path: '/contact', landingPageviews: 5}]},
              {source: 'chatgpt_paid', landingPageviews: 0, acceptedInquiries: 0, landingPages: []},
            ]}})}});
        case '/api/leads/team': return route.fulfill({json: {rows: []}});
        case '/api/leads': return route.fulfill({json: {source: 'connected', writable: false, rows: [{id: 'one', name: 'Pilot visitor',
          email: 'pilot@example.test', status: 'new', message: 'Inquiry', created_at: '2026-11-13', source: 'Website inquiry',
          ...(legacy ? {} : {attribution_source: 'chatgpt_paid'})}]}});
        default: {
          const file = pathname === '/' ? 'index.html' : pathname.slice(1);
          const types: Record<string, string> = {'.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html'};
          return route.fulfill({body: await readFile(resolve(ui, file)), contentType: types[extname(file)]});
        }
      }
    });
    await page.goto(origin+'/#settings');
    const onboarding = page.getByRole('region', {name: 'Businesses in ChatGPT'});
    assert.equal(await onboarding.getByRole('link', {name: 'Open Business Hub'}).getAttribute('href'), 'https://chatgpt.com/business-hub');
    await onboarding.getByRole('button', {name: 'Copy inquiry URL'}).click();
    await onboarding.getByText('Inquiry URL copied.').waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), profile.inquiryUrl);
    await onboarding.getByLabel('Listing claim').selectOption('approved');
    await onboarding.getByLabel('Persona verification').selectOption('pending');
    await onboarding.getByLabel('Business Agent').selectOption('draft');
    await onboarding.getByLabel('Last checked').fill('2026-11-13');
    await onboarding.getByRole('button', {name: 'Save status'}).click();
    await onboarding.getByText('Status saved.').waitFor();
    await page.reload();
    assert.equal(await onboarding.getByLabel('Listing claim').inputValue(), 'approved');
    assert.equal(await onboarding.getByLabel('Last checked').inputValue(), '2026-11-13');
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    assert.ok(await fits());
    await page.setViewportSize({width: 390, height: 900});
    assert.ok(await fits());
    await page.goto(origin+'/#analytics');
    const attribution = page.getByRole('region', {name: 'ChatGPT attribution'});
    await attribution.getByText('/contact', {exact: true}).waitFor();
    await attribution.getByText('Unavailable', {exact: true}).waitFor();
    assert.equal(await attribution.getByText('0', {exact: true}).count(), 2);
    assert.ok(await fits());
    await page.goto(origin+'/#leads');
    await page.getByRole('button', {name: 'Pilot visitor'}).click();
    await page.getByText('Website attribution · ChatGPT paid').waitFor();
    legacy = true;
    await page.reload();
    await page.getByRole('button', {name: 'Pilot visitor'}).click();
    await page.getByText('Website attribution · Unavailable').waitFor();
    await page.goto(origin+'/#analytics');
    await attribution.getByText('This website connection does not provide ChatGPT attribution.').waitFor();
    role = 'administrator';
    await page.reload();
    await attribution.getByText('This website connection does not provide ChatGPT attribution.').waitFor();
    await page.goto(origin+'/#settings');
    await page.getByRole('heading', {name: 'Lead notifications'}).waitFor();
    assert.equal(await onboarding.count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
