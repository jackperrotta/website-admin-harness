import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {createPortfolioFixture} from './client-portfolio-fixture.ts';

test('Vitris owner explores analytics and completes a reviewed simulated release on desktop and mobile', {timeout: 180000}, async () => {
  const fixture = await createPortfolioFixture(), browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1536, height: 1100}}), errors: string[] = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${fixture.origin}/#client-portfolio`);
    await page.getByRole('button', {name: /Open local demo/}).click();
    await page.getByRole('heading', {name: 'Good work. All in view.'}).waitFor();
    await page.getByText('3 of 4 websites reporting.', {exact: false}).waitFor();
    await mkdir('artifacts/vitris-prototype', {recursive: true});
    await page.screenshot({path: resolve('artifacts/vitris-prototype/portfolio-desktop.png'), fullPage: true});
    await page.getByLabel('Filter by client', {exact: true}).selectOption('alder');
    assert.equal(await page.locator('.cp-sites tbody tr').count(), 2);
    await page.getByLabel('Filter by client', {exact: true}).selectOption('all');
    await page.getByLabel('Search client websites').fill('no-such-client'); await page.getByRole('heading', {name: 'No websites match.'}).waitFor();
    await page.getByRole('button', {name: 'Clear filters'}).click();
    await page.getByRole('button', {name: 'Open Alder & Stone', exact: true}).click();
    await page.getByRole('heading', {name: 'Traffic over time'}).waitFor();
    await page.getByRole('tab', {name: 'Enquiries & actions'}).click();
    await page.getByRole('heading', {name: 'Enquiry & contact actions'}).waitFor();
    await page.getByRole('button', {name: /Request an update/}).click();
    const request = page.getByRole('dialog', {name: 'Request a website update'});
    await request.getByLabel('Change title').fill('A clearer consultation link');
    await request.getByLabel('What would you like to change?').fill('Move the consultation link into the hero and keep the current contact form.');
    await request.getByRole('button', {name: /Create change request/}).click();
    const change = page.locator('.cp-change').filter({has: page.getByRole('heading', {name: 'A clearer consultation link', exact: true})});
    await change.getByText('Awaiting agent', {exact: true}).waitFor();
    await page.getByRole('button', {name: 'Set demo runner offline'}).click();
    await change.getByText('Waiting for the demo runner to reconnect.').waitFor();
    assert.equal(await change.getByRole('button', {name: /Start demo agent/}).isDisabled(), true);
    await page.getByRole('button', {name: 'Reconnect demo runner'}).click();
    await change.getByRole('button', {name: /Start demo agent/}).click();
    await change.getByRole('button', {name: 'Simulate build failure'}).click();
    await change.getByText('Build failed', {exact: true}).waitFor();
    await change.getByRole('button', {name: 'Retry change'}).click();
    await change.getByRole('button', {name: /Start demo agent/}).click();
    await change.getByRole('button', {name: /Build demo preview/}).click();
    await change.getByRole('button', {name: /Review & publish/}).click();
    const review = page.getByRole('dialog', {name: 'Review the simulated candidate'});
    assert.equal(await review.getByRole('button', {name: /Queue simulated publish/}).isDisabled(), true);
    await review.getByRole('checkbox').check();
    await page.screenshot({path: resolve('artifacts/vitris-prototype/review-desktop.png'), fullPage: true});
    await review.getByRole('button', {name: /Queue simulated publish/}).click();
    await change.getByText('Publication queued', {exact: true}).waitFor();
    await change.getByRole('button', {name: /Run simulated publish/}).click();
    await page.getByLabel('Filter website changes', {exact: true}).selectOption('published');
    await change.getByText('Simulated release receipt', {exact: true}).waitFor();
    await page.reload(); await page.getByRole('heading', {name: 'Good work. All in view.'}).waitFor();
    await page.getByRole('button', {name: /Website changes/}).click();
    await page.getByLabel('Filter website changes', {exact: true}).selectOption('published');
    await change.getByText('Simulated release receipt', {exact: true}).waitFor();
    await page.setViewportSize({width: 390, height: 844});
    await page.getByRole('button', {name: 'Portfolio', exact: true}).click();
    await page.screenshot({path: resolve('artifacts/vitris-prototype/portfolio-mobile.png'), fullPage: true});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.getByRole('button', {name: /Request an update/}).click();
    await request.getByLabel('Change title').fill('Mobile draft');
    await request.getByLabel('What would you like to change?').fill('A request written on a phone.');
    assert.ok(await request.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await page.screenshot({path: resolve('artifacts/vitris-prototype/request-mobile.png'), fullPage: true});
    await page.keyboard.press('Escape'); assert.equal(await request.count(), 0);
    assert.deepEqual(errors, []);
  } finally {await browser.close(); await fixture.app.dispose();}
});

test('an ordinary admin never loads or requests the optional portfolio workspace', {timeout: 90000}, async () => {
  const fixture = await createPortfolioFixture({enabled: false, applyModuleMigration: false}), browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage(), requests: string[] = [];
    page.on('request', req => {if (/client-portfolio|workspace-.*\.js/.test(req.url())) requests.push(req.url());});
    await page.context().addCookies([{name: 'vitris-admin-local', value: 'synthetic-portfolio-owner', url: fixture.origin}]);
    await page.goto(`${fixture.origin}/#client-portfolio`);
    await page.getByRole('heading', {name: 'Your website, at a glance.'}).waitFor();
    assert.equal(await page.getByRole('link', {name: 'Clients', exact: true}).count(), 0);
    assert.deepEqual(requests.filter(url => !url.endsWith('/#client-portfolio')), []);
  } finally {await browser.close(); await fixture.app.dispose();}
});
