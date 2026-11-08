import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { emailFixture } from './email-campaigns-fixture.ts';
import { emailOverage, type EmailCampaign, type EmailTemplate, type EmailAutomation, type EmailContact } from '../packages/contracts/src/email-campaigns.ts';
let f: Awaited<ReturnType<typeof emailFixture>>;
const mail: Record<string, unknown>[] = [];
let outcome: 'success' | 'unknown' | 'rate' = 'success';
before(async () => { f = await emailFixture({ mail: async (message) => { mail.push(message); return outcome === 'unknown' ? { unknown: true } : outcome === 'rate' ? { errorCode: 'E_RATE_LIMIT_EXCEEDED' } : { messageId: 'synthetic-mail-' + mail.length }; } }); });
after(async () => { await f?.dispose(); });
beforeEach(async () => { await f.reset(); mail.length = 0; outcome = 'success'; });
const approve = async (c: EmailCampaign, count: number) => f.result<EmailCampaign>(await f.post('/campaigns/approve', { id: c.id, revision: c.revision, audienceCount: count, reviewed: true }));
test('optional migration preserves records; anonymous, disabled, cross-site and ordinary roles have no campaign authority', async () => { assert.equal((await f.db.prepare("SELECT message FROM leads WHERE id='retained'").first<{
    message: string;
}>())?.message, 'Keep this enquiry'); assert.equal((await f.get('/workspace', 'anonymous')).status, 401); for (const role of ['administrator', 'editor', 'analyst'])
    assert.equal((await f.get('/workspace', role)).status, 403); assert.equal((await f.get('/workspace', 'owner', `http://localhost:${f.port}`)).status, 404); assert.equal((await f.get('/workspace', 'owner', `http://127.0.0.1:${f.port + 2}`)).status, 503); const response = await f.app.dispatchFetch(f.origin + '/api/modules/email-campaigns/contacts', { method: 'POST', headers: { cookie: f.cookies.owner, origin: 'https://evil.example.test', 'content-type': 'application/json' }, body: '{}' }); assert.equal(response.status, 403); const contact = await f.contact(); assert.equal((await f.get('/timeline?contact=' + contact.id, 'owner', `http://127.0.0.1:${f.port + 1}`)).status, 404); });
test('contacts preserve opt-outs and deletion suppressions across edits and imports; conflicting revisions preserve saved values', async () => { const contact = await f.contact(); const saved = await f.result<EmailContact>(await f.post('/contacts', { ...contact, name: 'Updated' })); assert.equal((await f.post('/contacts', { ...contact, name: 'Stale' })).status, 409); await f.post('/contacts', { ...saved, topics: { service: false, reports: true } }); const current = (await (await f.get('/contacts')).json() as {
    rows: EmailContact[];
}).rows[0]; const attempted = await f.result<EmailContact>(await f.post('/contacts', { ...current, topics: { service: true, reports: true }, evidence: 'staff import' })); assert.equal(attempted.topics.service, false); await f.post('/contacts/delete', { id: attempted.id, revision: attempted.revision, reviewed: true }); assert.equal((await f.post('/contacts', { ...attempted, id: '', revision: 0 })).status, 409); const row = await f.db.prepare('SELECT email,name FROM email_contacts WHERE id=?').bind(attempted.id).first<{
    email: string;
    name: string;
}>(); assert.deepEqual(row, { email: '', name: '' }); assert.equal((await f.db.prepare('SELECT count(*) n FROM email_suppressions').first<{
    n: number;
}>())?.n, 1); });
test('CSV preview validates quoted fields, skips duplicate addresses, resumes import and neutralizes spreadsheet formulas on export', async () => { await f.settings(); const data = { csv: 'email,name,company\nfirst@example.test,"Doe, Jane",=SUM(A1)\nfirst@example.test,Duplicate,Company\nsecond@example.test,Second,Company', mapping: { email: 'email', name: 'name', company: 'company' }, evidence: 'Synthetic address book' }; const preview = await f.result<{
    valid: number;
    duplicates: number;
}>(await f.post('/imports/preview', data)); assert.equal(preview.valid, 2); assert.equal(preview.duplicates, 1); await f.post('/imports/start', { ...data, reviewed: true }); await f.tick(); await f.post('/imports/start', { ...data, reviewed: true }); await f.tick(); assert.equal((await f.db.prepare('SELECT count(*) n FROM email_contacts').first<{
    n: number;
}>())?.n, 2); const csv = await (await f.get('/export')).text(); assert.ok(csv.includes("'=SUM(A1)")); assert.equal((await f.post('/imports/preview', { ...data, csv: 'email,name\ninvalid,Name' })).status, 200); const invalid = await f.post('/imports/start', { ...data, csv: 'email,name\ninvalid,Name', reviewed: true }); assert.equal(invalid.status, 400); });
test('segments count the full audience; campaign approval freezes IDs, template revision, and capture mode', async () => { await f.settings(); const first = await f.contact({ tags: ['selected'] }), second = await f.contact({ tags: [] }); const segment = await f.result<{
    id: string;
}>(await f.post('/segments', { id: '', revision: 0, name: 'Selected customers', match: 'all', rules: [{ field: 'tag', op: 'eq', value: 'selected' }] })); const audience = await (await f.get('/audience?segment=' + segment.id)).json() as {
    eligible: number;
}; assert.equal(audience.eligible, 1); const campaign = await f.campaign({ segmentId: segment.id }); await approve(campaign, 1); await f.post('/contacts', { ...second, tags: ['selected'] }); await f.tick(); const jobs = (await f.db.prepare('SELECT contact_id,state FROM email_jobs WHERE campaign_id=?').bind(campaign.id).all<{
    contact_id: string;
    state: string;
}>()).results; assert.deepEqual(jobs, [{ contact_id: first.id, state: 'captured' }]); assert.equal(mail.length, 0); const c = await f.campaign(); await approve(c, 2); await f.settings({ mode: 'send' }); await f.tick(); const modes = (await f.db.prepare('SELECT DISTINCT mode,state FROM email_jobs WHERE campaign_id=?').bind(c.id).all<{
    mode: string;
    state: string;
}>()).results; assert.equal(modes[0].mode, 'capture'); assert.equal(modes[0].state, 'superseded'); assert.equal(mail.length, 0); });
test('template rendering escapes contact content, rejects unknown variables and header injection, and newsletter delivery stays unavailable', async () => { await f.settings(); await f.contact({ name: '<script>alert(1)</script>' }); const bad = await f.post('/templates', { id: '', revision: 0, name: 'Bad', layout: 'letter', subject: 'Bad\nBcc: other@example.test', preheader: '', blocks: [{ type: 'paragraph', text: 'Hello' }] }); assert.equal(bad.status, 400); assert.equal((await f.post('/templates', { id: '', revision: 0, name: 'Bad token', layout: 'letter', subject: 'Hello', preheader: '', blocks: [{ type: 'paragraph', text: '{{password}}' }] })).status, 400); const c = await f.campaign({ templateId: 'starter-response' }); await approve(c, 1); await f.tick(); const job = await f.db.prepare("SELECT id FROM email_jobs WHERE state='captured'").first<{
    id: string;
}>(); const capture = await (await f.get('/capture?job=' + job!.id)).json() as {
    message: {
        html: string;
    };
}; assert.ok(!capture.message.html.includes('<script>')); assert.ok(capture.message.html.includes('&lt;script&gt;')); const newsletter = await f.campaign({ purpose: 'newsletter-draft', templateId: 'starter-newsletter' }); assert.equal((await f.post('/campaigns/approve', { id: newsletter.id, revision: newsletter.revision, audienceCount: 1, reviewed: true })).status, 400); });
test('native submission, rate errors and uncertain acceptance have distinct outcomes; overlapping cron never duplicates a job', async () => { await f.settings({ mode: 'send' }); await f.contact(); const c = await f.campaign(); await approve(c, 1); await Promise.all([f.tick(), f.tick()]); assert.equal(mail.length, 1); assert.equal((await f.db.prepare('SELECT state FROM email_jobs').first<{
    state: string;
}>())?.state, 'submitted'); await f.reset(); await f.settings({ mode: 'send' }); await f.contact(); const unknown = await f.campaign(); await approve(unknown, 1); outcome = 'unknown'; await f.tick(); const job = await f.db.prepare('SELECT id,state FROM email_jobs').first<{
    id: string;
    state: string;
}>(); assert.equal(job?.state, 'uncertain'); await f.tick(); assert.equal(mail.length, 2); await f.post('/jobs/resolve', { id: job!.id, action: 'retry', reviewed: true }); await f.post('/jobs/resolve', { id: job!.id, action: 'retry', reviewed: true }); outcome = 'success'; await f.tick(); assert.equal(mail.length, 3); });
test('unsubscribe GET is read-only, POST stops optional sends, and issued links survive module disablement', async () => { await f.settings(); const contact = await f.contact(); const c = await f.campaign(); await approve(c, 1); await f.tick(); const job = await f.db.prepare('SELECT id FROM email_jobs').first<{
    id: string;
}>(), capture = await (await f.get('/capture?job=' + job!.id)).json() as {
    message: {
        headers: Record<string, string>;
    };
}; const link = capture.message.headers['List-Unsubscribe'].slice(1, -1); assert.equal((await f.app.dispatchFetch(link)).status, 200); assert.equal((await f.db.prepare("SELECT status FROM email_preferences WHERE contact_id=? AND topic='service'").bind(contact.id).first<{
    status: string;
}>())?.status, 'subscribed'); const disabledLink = link.replace(f.origin, `http://localhost:${f.port}`); const disabled = await f.app.dispatchFetch(disabledLink, { method: 'POST', body: 'List-Unsubscribe=One-Click' }); assert.equal(disabled.status, 401, 'tokens are bound to the exact admin origin, not a second installation'); await f.app.dispatchFetch(f.origin + '/__fixture/disable'); assert.equal((await f.get('/workspace')).status, 404); const post = await f.app.dispatchFetch(link, { method: 'POST', body: 'List-Unsubscribe=One-Click' }); assert.equal(post.status, 200); assert.equal((await f.db.prepare("SELECT status FROM email_preferences WHERE contact_id=? AND topic='service'").bind(contact.id).first<{
    status: string;
}>())?.status, 'unsubscribed'); });
test('native feedback validates account/domain, deduplicates events, preserves terminal complaints, and suppresses pending mail', async () => { await f.settings({ mode: 'send' }); const contact = await f.contact(); const c = await f.campaign(); await approve(c, 1); await f.tick(); const event = (kind: string, id: string, account = 'synthetic-account') => ({ type: 'cf.email.sending.message.' + kind, source: { type: 'email.sending', zoneId: f.config.zoneId, domain: f.config.sendingDomain }, metadata: { accountId: account, eventSubscriptionId: f.config.eventSubscriptionId, eventSchemaVersion: 1, eventTimestamp: new Date().toISOString() }, payload: { eventId: id, messageId: 'synthetic-mail-1', sender: 'reports@example.test', recipient: contact.email, terminal: true, delivery: { status: kind } } }); await f.feedback([event('delivered', 'delivery-1', 'wrong-account')]); assert.equal((await f.db.prepare('SELECT state FROM email_jobs').first<{
    state: string;
}>())?.state, 'submitted'); await f.feedback([event('complained', 'complaint-1'), event('complained', 'complaint-1'), event('delivered', 'delivery-late')]); assert.equal((await f.db.prepare('SELECT state FROM email_jobs').first<{
    state: string;
}>())?.state, 'complained'); assert.equal((await f.db.prepare('SELECT count(*) n FROM email_suppressions').first<{
    n: number;
}>())?.n, 1); assert.equal((await f.db.prepare("SELECT count(*) n FROM email_events WHERE id='complaint-1'").first<{
    n: number;
}>())?.n, 1); });
test('signed website events start a pinned sequence once, pause safely, and resolution stops future steps', async () => { await f.settings(); const a = await f.result<EmailAutomation>(await f.post('/automations', { id: '', revision: 0, name: 'Enquiry receipt', trigger: 'lead.created', purpose: 'enquiry-response', status: 'draft', steps: [{ type: 'send', templateId: 'starter-response' }, { type: 'wait', minutes: 60 }, { type: 'send', templateId: 'starter-update' }] })); await f.post('/automations/publish', { id: a.id, revision: a.revision, reviewed: true }); const event = { version: 1 as const, mode:'production' as const, id: 'synthetic-enquiry', installationId: f.manifest.installationId, siteId: f.manifest.site.id, type: 'lead.created' as const, occurredAt: new Date().toISOString(), contact: { email: 'enquiry@example.test', name: 'Enquiry Customer', interactionRef: 'website-enquiry' } }; assert.equal((await f.event(event)).status, 200); assert.equal((await f.event(event)).status, 200); assert.equal((await f.event({ ...event, contact: { ...event.contact, name: 'Changed' } })).status, 409); assert.equal((await f.db.prepare('SELECT count(*) n FROM email_enrollments').first<{
    n: number;
}>())?.n, 1); await f.tick(); await f.tick(); assert.equal((await f.db.prepare("SELECT count(*) n FROM email_jobs WHERE state='captured'").first<{
    n: number;
}>())?.n, 1); assert.equal((await f.event({ ...event, id: 'enquiry-resolved', type: 'enquiry.resolved' })).status, 200); await f.tick(); assert.equal((await f.db.prepare('SELECT state FROM email_enrollments').first<{
    state: string;
}>())?.state, 'stopped'); });
test('fresh agreed-service reports send current totals; missing data blocks the report instead of sending a stale issue', async () => { await f.settings(); await f.contact(); await f.db.prepare('INSERT INTO analytics_daily(site_id,day,views,visitors,enquiries) VALUES(?,?,?,?,?)').bind(f.manifest.site.id, new Date().toISOString().slice(0, 10), 50, 30, 2).run(); const response = await f.post('/report-schedules', { id: '', revision: 0, name: 'Agreed website report', templateId: 'starter-report', segmentId: '', days: 7, nextAt: new Date(Date.now() - 1000).toISOString(), status: 'active' }); assert.equal(response.status, 200); await f.tick(); const job = await f.db.prepare("SELECT id FROM email_jobs WHERE purpose='customer-report'").first<{
    id: string;
}>(); assert.ok(job); const capture = await (await f.get('/capture?job=' + job.id)).json() as {
    message: {
        text: string;
    };
}; assert.ok(capture.message.text.includes('50 page views')); await f.db.prepare('DELETE FROM analytics_daily').run();await f.post('/report-schedules',{id:'',revision:0,name:'Missing data report',templateId:'starter-report',segmentId:'',days:7,nextAt:new Date(Date.now()-1000).toISOString(),status:'active'});await f.tick();assert.equal((await f.db.prepare('SELECT count(*) n FROM email_jobs').first<{n:number}>())?.n,1);assert.equal((await f.db.prepare("SELECT total FROM email_daily WHERE kind='report_blocked'").first<{total:number}>())?.total,1); assert.equal(emailOverage(3000), 0); assert.equal(emailOverage(5000), 0.7); assert.equal(emailOverage(20000), 5.95); });
