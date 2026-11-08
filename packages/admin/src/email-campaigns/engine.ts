import { type EmailModuleConfig, type EmailCampaign, type EmailTemplate, type EmailContact, type EmailSegment, type EmailSettings, type EmailAutomation, type EmailPurpose, type EmailWebsiteEvent, type EmailWorkspace, emailOverage, validEmail, emailId } from '../../../contracts/src/email-campaigns.ts';
import { userCan, type User, type AnalyticsRow } from '../../../contracts/src/index.ts';
import { harnessRequest } from '../harness.ts';
import { EmailStore } from './store.ts';
import { type CampaignEnv, type CampaignMessage, fail, keysReady, encrypt, decrypt, topicOf, publicBase, random, object, digest, emailKey } from './shared.ts';
import { renderEmail, type EmailReport } from './render.ts';
interface Campaign extends EmailCampaign {
    segmentSnapshot?: EmailSegment | null;
    audienceIds?: string[];
    personalizationCipher?: string;
    approvalMode?: 'capture' | 'send';
    test?: boolean;
}
export interface Automation extends EmailAutomation {
    templates?: Record<string, EmailTemplate>;
}
export interface JobRow {
    site_id: string;
    id: string;
    campaign_id: string;
    contact_id: string;
    purpose: EmailPurpose;
    topic: 'reports' | 'service' | 'newsletter';
    mode: 'capture' | 'send';
    state: string;
    due_at: number;
    created_at: number;
    lease_id: string | null;
    lease_until: number;
    payload_cipher: string;
    message_cipher: string | null;
    provider_message_id: string | null;
    reason: string | null;
    actor_id: string;
    attempts: number;
}
interface Payload {
    template: EmailTemplate;
    email: string;
    contactSnapshot?: {
        name: string;
        company: string;
    };
    report?: EmailReport;
    confirmationToken?: string;
    testRecipient?: string;
}
interface Enrollment {
    id: string;
    automation_id: string;
    version_id: string;
    contact_id: string;
    event_id: string;
    step: number;
    state: string;
    due_at: number;
    created_at: number;
    context_cipher: string;
    lease_id: string | null;
    lease_until: number;
}
export interface ReportSchedule {
    id: string;
    revision: number;
    name: string;
    segmentId: string;
    templateId: string;
    days: number;
    nextAt: string;
    status: 'active' | 'paused';
    publisherId: string;
    lastPeriod?: string;
}
export class EmailEngine extends EmailStore {
    constructor(env: CampaignEnv, manifest: EmailStore['manifest'], readonly config: EmailModuleConfig) { super(env, manifest); }
    async readiness() { const schemaReady = await this.schema(), keys = keysReady(this.env), from = this.env.CAMPAIGN_FROM || '', sender = validEmail(from) && !!this.env.CAMPAIGN_EMAIL && this.env.CAMPAIGN_EMAIL_READY === '1' && !!this.config.sendingDomain && from.toLowerCase().endsWith('@' + this.config.sendingDomain), feedback = this.env.CAMPAIGN_FEEDBACK_READY === '1' && !!this.config.accountId && !!this.config.zoneId && !!this.config.eventSubscriptionId; const issues: string[] = []; if (!schemaReady)
        issues.push('Apply the optional email migration.'); if (!keys)
        issues.push('Configure the campaign encryption ring and stable identity key.'); if (!sender)
        issues.push('Verify the business sender and restricted CAMPAIGN_EMAIL binding.'); if (!feedback)
        issues.push('Configure and verify this account’s native email feedback subscription and queue.'); if (!this.config.dailyLimit)
        issues.push('Record the actual account daily sending quota.'); if (this.env.CAMPAIGN_SEND_ENABLED !== '1')
        issues.push('Live sending is off at the server.'); const health = schemaReady ? await this.get<{paused:boolean;reason:string}>('health','delivery') : null; if(health?.paused) issues.push('Delivery review required: '+health.reason.replaceAll('_',' ')); return { schemaReady, keysReady: keys, senderReady: sender, feedbackReady: feedback, websiteReady: !!this.env.CAMPAIGN_WEBSITE_KEY, deliveryPaused:!!health?.paused,deliveryReason:health?.reason||'', from, issues, liveReady: !health?.paused && schemaReady && keys && sender && feedback && !!this.config.dailyLimit && this.env.CAMPAIGN_SEND_ENABLED === '1' }; }
    async workspace(user: User): Promise<EmailWorkspace> { const readiness = await this.readiness(), settings = await this.settings(); await this.seedTemplates(); const counts: Record<string, number> = {}; for (const row of (await this.sql('SELECT state,count(*) n FROM email_jobs WHERE site_id=? GROUP BY state', this.site).all<{
        state: string;
        n: number;
    }>()).results)
        counts[row.state] = row.n; counts.contacts = (await this.sql('SELECT count(*) n FROM email_contacts WHERE site_id=? AND deleted_at IS NULL', this.site).first<{
        n: number;
    }>())?.n || 0; const counted = (await this.sql("SELECT count(*) n FROM email_send_reservations WHERE site_id=? AND mode='send' AND created_at>=?", this.site, Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).first<{
        n: number;
    }>())?.n || 0; return { settings, readiness, counts, permissions: (['email-campaigns:read', 'email-reports:read', 'email-contacts:read', 'email-contacts:write', 'email-contacts:export', 'email-content:write', 'email-campaigns:send', 'email-automations:manage', 'email-settings:manage'] as const).filter(p => userCan(user, p)), monthly: { counted: counted + settings.data.otherAccountEmails, estimatedOverage: emailOverage(counted + settings.data.otherAccountEmails), included: 3000 }, templates: await this.list<EmailTemplate>('template') }; }
    async deleteContact(id: string, revision: number) {
        const existing = await this.sql('SELECT deleted_at FROM email_contacts WHERE site_id=? AND id=?', this.site, id).first<{
            deleted_at: number | null;
        }>();
        if (!existing)
            fail(404, 'not_found', 'Contact not found.');
        if (!existing.deleted_at)
            await this.removeContact(id, revision);
        const rows = (await this.sql("SELECT id FROM email_records r WHERE r.site_id=? AND r.kind='campaign' AND json_extract(r.data_json,'$.personalizationCipher') IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(json_extract(r.data_json,'$.audienceIds')) j WHERE j.value=?)", this.site, id).all<{
            id: string;
        }>()).results;
        for (const row of rows) {
            for (let attempt = 0; attempt < 3; attempt++) {
                const c = await this.get<Campaign>('campaign', row.id);
                if (!c?.personalizationCipher)
                    break;
                const values = await decrypt<Record<string, {
                    name: string;
                    company: string;
                }>>(this.env, this.scope + '|audience|' + c.id + '|' + c.approvalRevision, c.personalizationCipher);
                if (!(id in values))
                    break;
                delete values[id];
                try {
                    await this.put('campaign', c.id, c.revision, { ...c, personalizationCipher: await encrypt(this.env, this.scope + '|audience|' + c.id + '|' + c.approvalRevision, values) });
                    break;
                }
                catch (e) {
                    if (attempt === 2)
                        throw e;
                }
            }
        }
    }
    async saveTemplate(template: EmailTemplate) { for (const block of template.blocks) {
        if (block.url && new URL(block.url).protocol !== 'https:' && new URL(this.manifest.adminOrigin).protocol !== 'http:')
            fail(400, 'link_protocol', 'Production email links must use HTTPS.');
        if (block.type === 'image') {
            const url = new URL(block.url!);
            if (url.origin !== this.manifest.adminOrigin || url.pathname !== publicBase + '/asset' || !await this.sql('SELECT id FROM email_assets WHERE site_id=? AND id=?', this.site, url.searchParams.get('id') || '').first())
                fail(400, 'image_asset', 'Choose an image uploaded to this installation.');
        }
    } renderEmail(template, { name: 'Preview contact', company: 'Preview business' }, (await this.settings()).data, this.manifest.business.name, this.manifest.adminOrigin + publicBase + '/preferences', { title: 'Service report', period: 'this period', summary: 'Preview of current report data.' }); const saved = await this.put('template', template.id || crypto.randomUUID(), template.revision, template); await this.put('template-version', saved.id + '_' + saved.revision, 0, saved); return saved; }
    async approvedCampaign(id: string, revision: number, user: User, reviewedCount: number) { const c = await this.get<Campaign>('campaign', id); if (!c)
        fail(404, 'not_found', 'Campaign not found.'); if (c.revision !== revision || c.status !== 'draft')
        fail(409, 'email_conflict', 'Review the current draft before scheduling.'); const template = await this.get<EmailTemplate>('template', c.templateId); if (!template)
        fail(400, 'template_missing', 'Choose a saved template.'); if (c.purpose === 'newsletter-draft' || template.layout === 'newsletter')
        fail(400, 'newsletter_draft_only', 'Newsletter content can be drafted and previewed. Live sending is not enabled for this purpose.'); const settings = (await this.settings()).data; if (!settings.enabled)
        fail(409, 'email_paused', 'Enable customer communications in Email settings first.'); if (settings.mode === 'send' && !(await this.readiness()).liveReady)
        fail(503, 'email_not_ready', 'Complete the sender, feedback, key, and quota checks before live sending.'); if (!keysReady(this.env))
        fail(503, 'email_keys', 'Configure encryption keys before creating captured or live messages.'); const segment = c.segmentId ? await this.get<EmailSegment>('segment', c.segmentId) : null; if (c.segmentId && !segment)
        fail(400, 'segment_missing', 'The selected segment no longer exists.'); const f = this.filter(segment), topic = topicOf(c.purpose), evidence = c.purpose === 'enquiry-response' ? "c.interaction_ref<>''" : "c.service_ref<>''"; const audienceRows = (await this.sql(`SELECT c.id,c.name,c.company FROM email_contacts c WHERE c.site_id=? AND c.deleted_at IS NULL AND ${f.sql} AND ${evidence} AND NOT EXISTS(SELECT 1 FROM email_suppressions s WHERE s.site_id=c.site_id AND s.email_key=c.email_key) AND EXISTS(SELECT 1 FROM email_preferences p WHERE p.site_id=c.site_id AND p.contact_id=c.id AND p.topic=? AND p.status='subscribed') ORDER BY c.id LIMIT 10001`, this.site, ...f.args, topic).all<{
        id: string;
        name: string;
        company: string;
    }>()).results; const audienceIds = audienceRows.map(r => r.id).filter(id => !c.excludeIds.includes(id)), count = audienceIds.length; if (count !== reviewedCount)
        fail(409, 'audience_changed', 'The eligible audience changed. Review the current count before scheduling.'); if (count < 1 || count > settings.recipientCap)
        fail(400, 'audience_limit', 'Choose a nonempty audience within this installation’s recipient limit.'); if (c.scheduledAt && Date.parse(c.scheduledAt) < Date.now() - 60000)
        fail(400, 'schedule_past', 'Choose a future schedule time.'); const personalization = Object.fromEntries(audienceRows.filter(r => audienceIds.includes(r.id)).map(r => [r.id, { name: r.name, company: r.company }])); if (new TextEncoder().encode(JSON.stringify(personalization)).byteLength > 1000000)
        fail(413, 'audience_snapshot_size', 'Split this audience into smaller campaigns to keep the approval snapshot bounded.'); const personalizationCipher = await encrypt(this.env, this.scope + '|audience|' + id + '|' + (revision + 1), personalization); return this.put('campaign', id, revision, { ...c, status: 'preparing' as const, snapshot: template, segmentSnapshot: segment, audienceIds, personalizationCipher, approvalMode: settings.mode, audienceCutoff: Date.now(), cursor: '', approvedBy: user.id, approvalRevision: revision + 1 }); }
    async excludedCount(c: Campaign, segment: EmailSegment | null) {
        if(c.purpose==='newsletter-draft')return 0;
        if(c.excludeIds.length>500||c.excludeIds.some(id=>!emailId(id)))fail(400,'exclusion_limit','Choose up to 500 valid contact exclusions.');
        const f=this.filter(segment),evidence=c.purpose==='enquiry-response'?"c.interaction_ref<>''":"c.service_ref<>''";
        return (await this.sql(`SELECT count(*) n FROM email_contacts c WHERE c.site_id=? AND c.deleted_at IS NULL AND c.id IN(SELECT value FROM json_each(?)) AND ${f.sql} AND ${evidence} AND NOT EXISTS(SELECT 1 FROM email_suppressions s WHERE s.site_id=c.site_id AND s.email_key=c.email_key) AND EXISTS(SELECT 1 FROM email_preferences p WHERE p.site_id=c.site_id AND p.contact_id=c.id AND p.topic=? AND p.status='subscribed')`,this.site,JSON.stringify(c.excludeIds),...f.args,topicOf(c.purpose)).first<{n:number}>())?.n||0;
    }
    async enqueue(id: string, contact: EmailContact, purpose: EmailPurpose, payload: Payload, actor: string, mode: 'capture' | 'send', campaignId = '', due = Date.now()) { const cipher = await encrypt(this.env, this.scope + '|job|' + id, { ...payload, contactSnapshot: payload.contactSnapshot || { name: contact.name, company: contact.company } }); await this.sql("INSERT OR IGNORE INTO email_jobs(site_id,id,campaign_id,contact_id,purpose,topic,mode,state,due_at,created_at,updated_at,payload_cipher,actor_id) VALUES(?,?,?,?,?,?,?,'pending',?,?,?,?,?)", this.site, id, campaignId, contact.id, purpose, topicOf(purpose), mode, due, Date.now(), Date.now(), cipher, actor).run(); }
    async prepareCampaigns() { for (const c of await this.active<Campaign>('campaign', ['preparing'],20)) {
        if (c.status !== 'preparing' || !c.snapshot)
            continue;
        if (this.operations > 400)
            break;
        const settings = (await this.settings()).data, rows = (await this.sql("SELECT * FROM email_contacts WHERE site_id=? AND id>? AND id IN (SELECT value FROM json_each(?)) ORDER BY id LIMIT 200", this.site, c.cursor || '', JSON.stringify(c.audienceIds || [])).all<import('./store.ts').ContactRow>()).results;
        const personalization = c.personalizationCipher ? await decrypt<Record<string, {
            name: string;
            company: string;
        }>>(this.env, this.scope + '|audience|' + c.id + '|' + c.approvalRevision, c.personalizationCipher) : {};
        for (const row of rows) {
            const contact: EmailContact = { id: row.id, revision: row.revision, email: row.email, name: row.name, company: row.company, stage: row.stage, tags: [], fields: {}, source: row.source, interactionRef: row.interaction_ref, serviceRef: row.service_ref, evidence: row.evidence, topics: {}, deleted: row.deleted_at !== null }, id = 'campaign_' + await digest(`${c.id}|${c.approvalRevision}|${contact.id}`), reason = contact.deleted ? 'contact_unavailable' : '';
            if (!reason)
                await this.enqueue(id, contact, c.purpose, { template: c.snapshot, email: contact.email, contactSnapshot: personalization[contact.id] }, c.approvedBy!, c.approvalMode || 'capture', c.id, Math.max(Date.now(), Date.parse(c.scheduledAt) || 0));
            else
                await this.sql("INSERT OR IGNORE INTO email_jobs(site_id,id,campaign_id,contact_id,purpose,topic,mode,state,due_at,created_at,updated_at,payload_cipher,actor_id,reason) VALUES(?,?,?,?,?,?,?,'suppressed',?,?,?,'',?,?)", this.site, id, c.id, contact.id, c.purpose, topicOf(c.purpose), c.approvalMode || 'capture', Date.now(), Date.now(), Date.now(), c.approvedBy!, reason).run();
        }
        const latest = await this.get<Campaign>('campaign', c.id);
        if (latest?.revision !== c.revision || latest.status !== 'preparing')
            continue;
        try {
            await this.put('campaign', c.id, c.revision, { ...c, cursor: rows.at(-1)?.id || c.cursor, status: rows.length === 200 ? 'preparing' : (Date.parse(c.scheduledAt) > Date.now() ? 'scheduled' : 'running'), ...(rows.length < 200 && c.recurrenceDays ? { nextIssueAt: Date.now() + c.recurrenceDays * 86400000 } : {}) });
        }
        catch { /* Another scheduler advanced the same snapshot. Jobs have deterministic IDs. */ }
    } }
    async campaignAction(id: string, revision: number, action: string) { const c = await this.get<Campaign>('campaign', id); if (!c)
        fail(404, 'not_found', 'Campaign not found.'); if (c.revision !== revision)
        fail(409, 'email_conflict', 'Reload the current campaign.'); const allowed: Record<string, string[]> = { pause: ['preparing', 'scheduled', 'running'], resume: ['paused'], cancel: ['draft', 'preparing', 'scheduled', 'running', 'paused'] }; if (!allowed[action]?.includes(c.status))
        fail(409, 'campaign_state', 'This action is unavailable in the current campaign state.'); const saved = await this.put('campaign', id, revision, { ...c, status: action === 'pause' ? 'paused' as const : action === 'resume' ? (c.snapshot ? 'preparing' as const : 'running' as const) : 'cancelled' as const }); if (action === 'cancel')
        await this.sql("UPDATE email_jobs SET state='superseded',reason='campaign_cancelled',updated_at=? WHERE site_id=? AND campaign_id=? AND state IN ('pending','preparing','blocked')", Date.now(), this.site, id).run(); return saved; }
    async resolveUnknown(id: string, action: string, user: User) { const job = await this.sql('SELECT * FROM email_jobs WHERE site_id=? AND id=?', this.site, id).first<JobRow>(); if (!job || job.state !== 'uncertain')
        fail(409, 'job_state', 'Choose an uncertain submission.'); if (action === 'close') {
        await this.sql("UPDATE email_jobs SET state='closed',reason='reviewed_uncertain',updated_at=? WHERE site_id=? AND id=? AND state='uncertain'", Date.now(), this.site, id).run();
        return;
    } if (action !== 'retry')
        fail(400, 'job_action', 'Choose close or a deliberate retry.'); const c = await this.contact(job.contact_id); if (await this.eligibility(c, job.purpose))
        fail(409, 'not_eligible', 'This recipient is no longer eligible.'); const payload = await decrypt<Payload>(this.env, this.scope + '|job|' + id, job.payload_cipher), newId = 'retry_' + await digest(id); await this.enqueue(newId, c!, job.purpose, payload, user.id, job.mode, job.campaign_id); await this.sql("UPDATE email_jobs SET state='closed',reason='deliberate_retry',updated_at=? WHERE site_id=? AND id=? AND state='uncertain'", Date.now(), this.site, id).run(); }
    async processJob(id: string) {
        const lease = random(), claimed = await this.sql("UPDATE email_jobs SET state='preparing',lease_id=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE site_id=? AND id=? AND state IN ('pending','preparing') AND lease_until<=? AND due_at<=? RETURNING *", lease, Date.now() + 120000, Date.now(), this.site, id, Date.now(), Date.now()).first<JobRow>();
        if (!claimed)
            return;
        let submitting = false;
        try {
            const settingsRow = await this.settings(), settings = settingsRow.data;
            if (!settings.enabled)
                return await this.release(claimed, lease, 'pending', 'communications_paused', 60000);
            if (settings.mode !== claimed.mode)
                return await this.release(claimed, lease, 'superseded', 'mode_changed');
            const actor = await this.sql('SELECT id,email,role FROM users WHERE id=? AND active=1', claimed.actor_id).first<User>();
            if (!actor || !userCan(actor, 'email-campaigns:send'))
                return await this.release(claimed, lease, 'blocked', 'sender_authority_revoked');
            if (claimed.campaign_id && !claimed.campaign_id.startsWith('auto_')) {
                const c = await this.sql("SELECT json_extract(data_json,'$.status') status FROM email_records WHERE site_id=? AND kind='campaign' AND id=?",this.site,claimed.campaign_id).first<{status:string}>();
                if (!c || c.status === 'cancelled')
                    return await this.release(claimed, lease, 'superseded', 'campaign_cancelled');
                if (c.status === 'paused')
                    return await this.release(claimed, lease, 'pending', 'campaign_paused', 60000);
            }
            const contact = await this.contact(claimed.contact_id), payload = await decrypt<Payload>(this.env, this.scope + '|job|' + id, claimed.payload_cipher);
            if (payload.testRecipient && claimed.mode === 'send') {
                let allowed: string[] = [];
                try {
                    allowed = JSON.parse(this.env.CAMPAIGN_TEST_RECIPIENTS || '[]');
                }
                catch { }
                if (!allowed.includes(payload.testRecipient) || Date.now() - claimed.created_at > 86400000)
                    return await this.release(claimed, lease, 'blocked', 'test_recipient_unavailable');
            }
            const reason = payload.confirmationToken || payload.testRecipient ? '' : await this.eligibility(contact, claimed.purpose);
            if (!contact || reason || payload.email !== contact.email)
                return await this.release(claimed, lease, 'suppressed', reason || 'recipient_changed');
            if (payload.template.layout === 'newsletter' && claimed.mode === 'send')
                return await this.release(claimed, lease, 'blocked', 'newsletter_draft_only');
            if (claimed.mode === 'send' && !(await this.readiness()).liveReady)
                return await this.release(claimed, lease, 'pending', 'sender_not_ready', 300000);
            const preference = payload.confirmationToken ? this.manifest.adminOrigin + publicBase + '/confirm?token=' + payload.confirmationToken : this.manifest.adminOrigin + publicBase + '/preferences?token=' + await this.token(contact.id, 'preferences', claimed.topic);
            const renderTemplate = { ...payload.template, blocks: payload.template.blocks.map(block => { if (block.type !== 'button' || !block.url)
                    return block; const url = new URL(block.url); url.searchParams.set('utm_source', 'email'); url.searchParams.set('utm_medium', 'email'); url.searchParams.set('utm_campaign', claimed.campaign_id || claimed.purpose); return { ...block, url: url.href }; }) };
            let message: CampaignMessage = { ...renderEmail(renderTemplate, payload.contactSnapshot || contact, settings, this.manifest.business.name, preference, payload.report), to: payload.testRecipient || contact.email, from: {email:this.env.CAMPAIGN_FROM || 'capture@example.invalid',name:(settings.senderName || this.manifest.business.name).replace(/[\r\n]/g,' ').slice(0,150)}, ...(settings.replyTo ? { replyTo: settings.replyTo } : {}) };
            if (payload.confirmationToken) {
                message.subject = 'Confirm your email preference';
                message.text = 'You requested an email preference. Confirm it here: ' + preference;
                message.html = '<p>You requested an email preference.</p><p><a href="' + preference + '">Review and confirm your request</a></p>';
            }
            else
                message.headers = { 'List-Unsubscribe': '<' + preference + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', 'X-Vitris-Message': id };
            if (settings.clickTracking && !payload.confirmationToken) {
                const urls = [...new Set(renderTemplate.blocks.filter(b => b.type === 'button').map(b => b.url!))];
                for (const url of urls) {
                    const clickId = await digest(this.scope + '|' + id + '|' + url);
                    await this.sql('INSERT OR IGNORE INTO email_clicks(site_id,id,job_id,url) VALUES(?,?,?,?)', this.site, clickId, id, url).run();
                    const target = this.manifest.adminOrigin + publicBase + '/click?id=' + clickId;
                    message.html = message.html.replaceAll(url.replaceAll('&', '&amp;'), target);
                    message.text = message.text.replaceAll(url, target);
                }
            }
            const cipher = await encrypt(this.env, this.scope + '|message|' + id, message), now = Date.now(), daily = Math.min(settings.dailyLimit, Math.max(0, (this.config.dailyLimit || settings.dailyLimit) - settings.reservedDaily)), monthly = settings.monthlyLimit - settings.otherAccountEmails;
            if (daily < 1 || monthly < 1)
                return await this.release(claimed, lease, 'pending', 'reserved_quota', 3600000);
            let gate = payload.confirmationToken || payload.testRecipient ? '1=1' : "NOT EXISTS(SELECT 1 FROM email_suppressions s JOIN email_contacts c ON c.site_id=s.site_id AND c.email_key=s.email_key WHERE c.site_id=email_jobs.site_id AND c.id=email_jobs.contact_id) AND EXISTS(SELECT 1 FROM email_preferences p WHERE p.site_id=email_jobs.site_id AND p.contact_id=email_jobs.contact_id AND p.topic=email_jobs.topic AND p.status='subscribed')";
            gate += " AND EXISTS(SELECT 1 FROM email_contacts c WHERE c.site_id=email_jobs.site_id AND c.id=email_jobs.contact_id AND c.deleted_at IS NULL) AND EXISTS(SELECT 1 FROM users u WHERE u.id=email_jobs.actor_id AND u.active=1 AND u.role='owner') AND (email_jobs.campaign_id='' OR (email_jobs.campaign_id LIKE 'auto_%' AND EXISTS(SELECT 1 FROM email_enrollments e JOIN email_records a ON a.site_id=e.site_id AND a.kind='automation' AND a.id=e.automation_id WHERE e.site_id=email_jobs.site_id AND e.id=substr(email_jobs.campaign_id,6) AND e.state='active' AND json_extract(a.data_json,'$.status')='active')) OR EXISTS(SELECT 1 FROM email_records r WHERE r.site_id=email_jobs.site_id AND r.kind='campaign' AND r.id=email_jobs.campaign_id AND json_extract(r.data_json,'$.status') IN ('running','scheduled','preparing')))";
            const results = await this.env.DB.batch([this.sql(`INSERT OR IGNORE INTO email_send_reservations(site_id,job_id,contact_id,mode,created_at,per_minute,daily_limit,monthly_limit,spacing_ms) SELECT site_id,id,contact_id,mode,?,?,?,?,? FROM email_jobs WHERE site_id=? AND id=? AND lease_id=? AND state='preparing' AND ${gate} AND EXISTS(SELECT 1 FROM email_records r WHERE r.site_id=email_jobs.site_id AND r.kind='settings' AND r.id='settings' AND r.revision=?)`, now, settings.perMinute, daily, monthly, payload.confirmationToken ? 0 : settings.spacingHours * 3600000, this.site, id, lease, settingsRow.revision), this.sql("UPDATE email_jobs SET state='sending',message_cipher=?,updated_at=? WHERE site_id=? AND id=? AND lease_id=? AND state='preparing' AND EXISTS(SELECT 1 FROM email_send_reservations r WHERE r.site_id=email_jobs.site_id AND r.job_id=email_jobs.id)", cipher, now, this.site, id, lease)]);
            if (!results[1].meta.changes)
                return await this.release(claimed, lease, 'suppressed', 'eligibility_changed');
            if (claimed.mode === 'capture')
                return await this.release(claimed, lease, 'captured', '');
            submitting = true;
            const result = await this.env.CAMPAIGN_EMAIL!.send(message);
            if (!result || typeof result.messageId !== 'string' || !result.messageId || result.messageId.length > 512)
                throw Error('unknown_submission');
            await this.sql("UPDATE email_jobs SET state='submitted',provider_message_id=?,lease_id=NULL,lease_until=0,reason=NULL,updated_at=? WHERE site_id=? AND id=? AND lease_id=? AND state='sending'", result.messageId, Date.now(), this.site, id, lease).run();
            await this.reconcile(result.messageId);
        }
        catch (error) {
            const code = object(error) && typeof error.code === 'string' ? error.code : '';
            if (submitting) {
                if (['E_RATE_LIMIT_EXCEEDED', 'E_DAILY_LIMIT_EXCEEDED', 'E_SENDER_NOT_VERIFIED', 'E_RECIPIENT_NOT_ALLOWED', 'E_RECIPIENT_SUPPRESSED', 'E_ACCOUNT_SUSPENDED', 'E_SENDER_DOMAIN_NOT_AVAILABLE', 'E_VALIDATION_ERROR', 'E_HEADER_NOT_ALLOWED'].includes(code)) {
                    await this.sql('DELETE FROM email_send_reservations WHERE site_id=? AND job_id=?', this.site, id).run();
                    if (code === 'E_RECIPIENT_SUPPRESSED')
                        await this.suppress(claimed.contact_id, 'provider_suppressed');
                    return await this.release(claimed, lease, code.includes('LIMIT') && claimed.attempts < 8 ? 'pending' : 'blocked', code, code === 'E_DAILY_LIMIT_EXCEEDED' ? 86400000 : 300000);
                }
                return await this.release(claimed, lease, 'uncertain', 'submission_unknown');
            }
            const message = error instanceof Error ? error.message : '';
            if (/email_(quota|daily_quota|monthly_quota|frequency)/.test(message))
                return await this.release(claimed, lease, 'pending', 'frequency_or_quota', message.includes('frequency') ? 3600000 : 60000);
            return await this.release(claimed, lease, 'blocked', 'preparation_failed');
        }
    }
    async release(job: JobRow, lease: string, state: string, reason: string, delay = 0) { await this.sql('UPDATE email_jobs SET state=?,reason=?,lease_id=NULL,lease_until=0,due_at=?,updated_at=? WHERE site_id=? AND id=? AND lease_id=?', state, reason || null, Date.now() + delay, Date.now(), this.site, job.id, lease).run(); }
    async feedback(batch: MessageBatch<unknown>) { for (const message of batch.messages) {
        try {
            const event = message.body;
            if (!object(event) || !object(event.source) || !object(event.metadata) || !object(event.payload))
                fail(400, 'feedback_shape', 'Invalid email lifecycle event.');
            const { source, metadata, payload } = event;
            if (source.type !== 'email.sending' || source.zoneId !== this.config.zoneId || source.domain !== this.config.sendingDomain || metadata.accountId !== this.config.accountId || metadata.eventSubscriptionId !== this.config.eventSubscriptionId || metadata.eventSchemaVersion !== 1 || typeof event.type !== 'string' || !/^cf\.email\.sending\.message\.(delivered|bounced|complained|rejected|deferred|failed)$/.test(event.type) || typeof payload.eventId !== 'string' || payload.eventId.length > 200 || typeof payload.messageId !== 'string' || payload.messageId.length > 512 || !validEmail(payload.recipient) || !validEmail(payload.sender) || payload.sender.toLowerCase() !== (this.env.CAMPAIGN_FROM || '').toLowerCase())
                fail(400, 'feedback_scope', 'Unexpected email lifecycle identity.');
            const eventAt = Date.parse(String(metadata.eventTimestamp));
            if (!Number.isFinite(eventAt) || eventAt > Date.now() + 300000 || eventAt < Date.now() - 30 * 86400000)
                fail(400, 'feedback_time', 'Invalid lifecycle timestamp.');
            const safe = { type: event.type, messageId: payload.messageId, recipientKey: await emailKey(this.env, this.scope, payload.recipient), bounceType: object(payload.bounce) ? String(payload.bounce.type) : '', rejectionReason: object(payload.rejection) ? String(payload.rejection.reason).slice(0,100) : '', at: eventAt };
            await this.sql('INSERT OR IGNORE INTO email_events(site_id,id,type,provider_message_id,payload_json,created_at) VALUES(?,?,?,?,?,?)', this.site, payload.eventId, event.type, payload.messageId, JSON.stringify(safe), Date.now()).run();
            await this.reconcile(payload.messageId);
            message.ack();
        }
        catch (e) {
            if (e instanceof Error && 'status' in e && Number(e.status) < 500) {
                message.ack();
                await this.metric('feedback_rejected');
            }
            else
                message.retry({ delaySeconds: 60 });
        }
    } }
    async reconcile(messageId: string) { const job = await this.sql('SELECT * FROM email_jobs WHERE site_id=? AND provider_message_id=?', this.site, messageId).first<JobRow>(); if (!job)
        return; const contact = await this.contact(job.contact_id); if (!contact)
        return; const key = await emailKey(this.env, this.scope, contact.email), events = (await this.sql('SELECT type,payload_json FROM email_events WHERE site_id=? AND provider_message_id=? ORDER BY created_at', this.site, messageId).all<{
        type: string;
        payload_json: string;
    }>()).results; let rank = 0, state = 'submitted'; for (const event of events) {
        const payload = JSON.parse(event.payload_json) as {
            recipientKey: string;
            bounceType: string;
            rejectionReason?: string;
            at: number;
        };
        if (payload.recipientKey !== key)
            continue;
        const kind = event.type.split('.').at(-1)!;
        if(kind==='complained') await this.pauseHealth('recipient_complaint',payload.at);
        if(kind==='rejected'&&payload.rejectionReason==='suppressed') await this.suppress(job.contact_id,'provider_suppressed');
        if(kind==='rejected'&&payload.rejectionReason!=='suppressed') await this.pauseHealth('provider_policy_rejection',payload.at);
        const value = ({ deferred: 1, delivered: 2, rejected: 3, failed: 3, bounced: 4, complained: 5 } as Record<string, number>)[kind] || 0;
        if (value > rank) {
            rank = value;
            state = kind;
        }
        if (kind === 'complained' || kind === 'bounced' && ['hard', 'permanent', 'Permanent'].includes(payload.bounceType))
            await this.suppress(contact.id, kind);
    } if (rank)
        await this.sql("UPDATE email_jobs SET state=?,updated_at=? WHERE site_id=? AND id=? AND state NOT IN ('complained','closed')", state, Date.now(), this.site, job.id).run(); if(state==='bounced')await this.assessBounceHealth(); }
    async metric(kind: string) { await this.sql('INSERT INTO email_daily(site_id,day,kind,total) VALUES(?,?,?,1) ON CONFLICT(site_id,day,kind) DO UPDATE SET total=total+1', this.site, new Date().toISOString().slice(0, 10), kind).run(); }
    async pauseHealth(reason:string,at=Date.now()) {
        await this.sql("INSERT INTO email_records(site_id,kind,id,revision,data_json,created_at,updated_at) VALUES(?,'health','delivery',1,?,?,?) ON CONFLICT(site_id,kind,id) DO UPDATE SET revision=email_records.revision+1,data_json=json_set(email_records.data_json,'$.paused',json('true'),'$.reason',?,'$.at',?),updated_at=? WHERE coalesce(json_extract(email_records.data_json,'$.reviewedAt'),0)<?",this.site,JSON.stringify({paused:true,reason,at}),Date.now(),Date.now(),reason,at,Date.now(),at).run();
    }
    async reviewHealth(){const health=await this.get<{paused:boolean;reason:string;at:number}>('health','delivery');if(health)await this.put('health','delivery',health.revision,{paused:false,reason:'',reviewedAt:Date.now(),at:health.at});}
    async assessBounceHealth(){
        const since=Date.now()-86400000,total=(await this.sql("SELECT count(*) n FROM email_jobs WHERE site_id=? AND mode='send' AND provider_message_id IS NOT NULL AND created_at>=?",this.site,since).first<{n:number}>())?.n||0;
        if(total<20)return;
        const bounces=await this.sql("SELECT count(DISTINCT j.id) n,max(json_extract(e.payload_json,'$.at')) at FROM email_jobs j JOIN email_contacts c ON c.site_id=j.site_id AND c.id=j.contact_id JOIN email_events e ON e.site_id=j.site_id AND e.provider_message_id=j.provider_message_id WHERE j.site_id=? AND j.mode='send' AND j.created_at>=? AND e.type='cf.email.sending.message.bounced' AND json_extract(e.payload_json,'$.bounceType')='hard' AND json_extract(e.payload_json,'$.recipientKey')=c.email_key",this.site,since).first<{n:number;at:number}>();
        if(bounces&&bounces.n/total>=0.05)await this.pauseHealth('hard_bounce_review',bounces.at);
    }
    async publishAutomation(automation: EmailAutomation, user: User) { if (automation.purpose === 'newsletter-draft')
        fail(400, 'newsletter_draft_only', 'Newsletter automation sending is unavailable.'); const templates: Record<string, EmailTemplate> = {}; for (const step of automation.steps) {
        if (step.type === 'task' && !userCan(user, 'tasks:write'))
            fail(403, 'task_permission', 'Task-writing permission is required for this automation.');
        if (step.type === 'send') {
            const template = await this.get<EmailTemplate>('template', step.templateId);
            if (!template || template.layout === 'newsletter')
                fail(400, 'automation_template', 'Choose a saved transactional template for every send step.');
            templates[step.templateId] = template;
        }
    } const current = await this.get<Automation>('automation', automation.id); if (!current || current.revision !== automation.revision)
        fail(409, 'email_conflict', 'Save and review this automation before publishing.'); const version = (current.version || 0) + 1, saved = await this.put('automation', automation.id, automation.revision, { ...automation, version, publisherId: user.id, status: 'active' as const, hasDraft: false }); await this.put('automation-version', automation.id + '_' + version, 0, { ...saved, templates }); return saved; }
    async enroll(event: EmailWebsiteEvent, contact: EmailContact, automationId?: string) { for (const a of await this.active<Automation>('automation', ['active'],100)) {
        if (a.status !== 'active' || automationId && a.id !== automationId)
            continue;
        const published = await this.get<Automation>('automation-version', a.id + '_' + a.version);
        if (!published || published.trigger !== event.type || await this.eligibility(contact, published.purpose))
            continue;
        const versionId = a.id + '_' + a.version, id = await digest(a.id + '|' + event.id + '|' + contact.id);
        await this.sql("INSERT OR IGNORE INTO email_enrollments(site_id,id,automation_id,version_id,contact_id,event_id,due_at,created_at,updated_at,context_cipher) VALUES(?,?,?,?,?,?,?,?,?,?)", this.site, id, a.id, versionId, contact.id, event.id, Date.now(), Date.now(), Date.now(), await encrypt(this.env, this.scope + '|enrollment|' + id, event.report || null)).run();
    } }
    async processEnrollments() { const rows = (await this.sql("SELECT * FROM email_enrollments WHERE site_id=? AND state='active' AND due_at<=? AND lease_until<=? ORDER BY due_at LIMIT 8", this.site, Date.now(), Date.now()).all<Enrollment>()).results; for (const e of rows) {
        if (this.operations > 650)
            break;
        const lease = random();
        if (!(await this.sql("UPDATE email_enrollments SET lease_id=?,lease_until=? WHERE site_id=? AND id=? AND state='active' AND lease_until<=? RETURNING id", lease, Date.now() + 120000, this.site, e.id, Date.now()).first()))
            continue;
        try {
            const parent = await this.get<Automation>('automation', e.automation_id), version = await this.get<Automation>('automation-version', e.version_id), contact = await this.contact(e.contact_id);
            if (parent?.status === 'paused') {
                await this.advance(e, lease, e.step, Date.now() + 60000);
                continue;
            }
            if (!parent || parent.status !== 'active' || !version || Date.now() - e.created_at > 90 * 86400000 || Date.now() - e.due_at > 86400000 || await this.eligibility(contact, version.purpose)) {
                await this.advance(e, lease, e.step, Date.now(), 'stopped');
                continue;
            }
            const actor = await this.sql('SELECT id,email,role FROM users WHERE id=? AND active=1', version.publisherId || '').first<User>();
            if (!actor || !userCan(actor, 'email-automations:manage') || !userCan(actor, 'email-campaigns:send')) {
                await this.advance(e, lease, e.step, Date.now(), 'blocked');
                continue;
            }
            const previous = await this.sql('SELECT state FROM email_jobs WHERE site_id=? AND campaign_id=? ORDER BY created_at DESC LIMIT 1', this.site, 'auto_' + e.id).first<{
                state: string;
            }>();
            if (previous && !['captured', 'submitted', 'delivered'].includes(previous.state)) {
                await this.advance(e, lease, e.step, Date.now() + 60000, ['blocked', 'uncertain', 'bounced', 'complained', 'suppressed'].includes(previous.state) ? 'blocked' : 'active');
                continue;
            }
            const step = version.steps[e.step];
            if (!step || step.type === 'exit') {
                await this.advance(e, lease, e.step, Date.now(), 'completed');
                continue;
            }
            let next = e.step + 1, due = Date.now();
            if (step.type === 'wait')
                due += step.minutes * 60000;
            else if (step.type === 'condition') {
                const f = this.rule(step.rule);
                if (!await this.sql(`SELECT id FROM email_contacts c WHERE site_id=? AND id=? AND ${f.sql}`, this.site, contact!.id, ...f.args).first())
                    next += step.skip;
            }
            else if (step.type === 'send') {
                const report = await decrypt<EmailReport | undefined>(this.env, this.scope + '|enrollment|' + e.id, e.context_cipher);
                if (version.purpose === 'customer-report' && !report?.summary) {
                    await this.advance(e, lease, e.step, Date.now(), 'blocked');
                    continue;
                }
                await this.enqueue('auto_' + await digest(e.id + '|' + e.step), contact!, version.purpose, { template: version.templates![step.templateId], email: contact!.email, ...(report ? { report } : {}) }, actor.id, (await this.settings()).data.mode, 'auto_' + e.id);
            }
            else if (step.type === 'tag' || step.type === 'stage') {
                await this.saveContact({ ...contact!, ...(step.type === 'tag' ? { tags: [...new Set([...contact!.tags, step.value])] } : { stage: step.value }) });
            }
            else if (step.type === 'task') {
                if (!userCan(actor, 'tasks:write')) {
                    await this.advance(e, lease, e.step, due, 'blocked');
                    continue;
                }
                await this.sql('INSERT OR IGNORE INTO tasks(id,site_id,title) VALUES(?,?,?)', 'email_' + await digest(this.scope + '|' + e.id + '|' + e.step), this.site, step.title).run();
            }
            await this.advance(e, lease, next, due);
        }
        catch {
            await this.advance(e, lease, e.step, Date.now(), 'blocked');
        }
    } }
    async advance(e: Enrollment, lease: string, step: number, due: number, state = 'active') { await this.sql('UPDATE email_enrollments SET step=?,due_at=?,state=?,lease_id=NULL,lease_until=0,updated_at=? WHERE site_id=? AND id=? AND lease_id=?', step, due, state, Date.now(), this.site, e.id, lease).run(); }
    async reportSchedules() {
        for (const schedule of await this.active<ReportSchedule>('report-schedule', ['active'],50)) {
            if (this.operations > 400)
                break;
            if (schedule.status !== 'active' || Date.parse(schedule.nextAt) > Date.now())
                continue;
            try {
                const template = await this.get<EmailTemplate>('template', schedule.templateId);
                if (!template || template.layout === 'newsletter')
                    continue;
                const actor = await this.sql('SELECT id,email,role FROM users WHERE id=? AND active=1', schedule.publisherId).first<User>();
                if (!actor || !userCan(actor, 'analytics:read') || !userCan(actor, 'email-campaigns:send'))
                    continue;
                const until = new Date().toISOString().slice(0, 10), period = `${schedule.days} days ending ${until}`;
                let rows: AnalyticsRow[];
                if (this.manifest.backend) {
                    const data = await harnessRequest(this.manifest, this.env, 'analytics', { days: schedule.days });
                    if (data.source !== 'connected' || data.generatedAt && Date.now() - Date.parse(data.generatedAt) > 86400000)
                        fail(503, 'report_stale', 'The website report is unavailable or stale.');
                    rows = data.rows;
                }
                else {
                    rows = (await this.sql('SELECT day,views,visitors,enquiries FROM analytics_daily WHERE site_id=? AND day>=? AND day<=? ORDER BY day', this.site, new Date(Date.now() - schedule.days * 86400000).toISOString().slice(0, 10), until).all<AnalyticsRow>()).results;
                    if (!rows.length || Date.now() - Date.parse(rows.at(-1)!.day) > 2 * 86400000)
                        fail(503, 'report_stale', 'Fresh local website analytics are unavailable.');
                }
                if (!rows.length)
                    fail(503, 'report_empty', 'No fresh report data is available.');
                if(rows.some(row=>!/^\d{4}-\d\d-\d\d$/.test(row.day)||!Number.isFinite(Date.parse(row.day))||row.day>until||[row.views,row.visitors,row.enquiries].some(value=>!Number.isFinite(value)||value<0))||Math.max(...rows.map(row=>Date.parse(row.day)))<Date.now()-2*86400000)
                    fail(503,'report_stale','Fresh, valid authoritative website data is required for this report.');
                const totals = rows.reduce((n, row) => ({ views: n.views + row.views, visitors: n.visitors + row.visitors, enquiries: n.enquiries + row.enquiries }), { views: 0, visitors: 0, enquiries: 0 }), report: EmailReport = { title: this.manifest.site.name + ' report', period, summary: `${totals.views} page views, ${totals.visitors} daily visitors summed across the period, and ${totals.enquiries} enquiries. Daily visitor totals are not deduplicated across days.` };
                const segment = schedule.segmentId ? await this.get<EmailSegment>('segment', schedule.segmentId) : null;
                if (schedule.segmentId && !segment)
                    fail(409, 'report_segment', 'The report audience no longer exists.');
                const filter = this.filter(segment), settings = (await this.settings()).data;
                const contacts = (await this.sql(`SELECT c.id FROM email_contacts c WHERE c.site_id=? AND c.deleted_at IS NULL AND ${filter.sql} AND c.service_ref<>'' AND EXISTS(SELECT 1 FROM email_preferences p WHERE p.site_id=c.site_id AND p.contact_id=c.id AND p.topic='reports' AND p.status='subscribed') AND NOT EXISTS(SELECT 1 FROM email_suppressions s WHERE s.site_id=c.site_id AND s.email_key=c.email_key) ORDER BY c.id LIMIT ?`, this.site, ...filter.args, settings.recipientCap + 1).all<{
                    id: string;
                }>()).results;
                if (contacts.length > settings.recipientCap)
                    fail(409, 'report_audience', 'The report exceeds the recipient cap.');
                const id = 'run_' + await digest(schedule.id + '|' + schedule.nextAt);
                if (!await this.get('report-run', id))
                    await this.put('report-run', id, 0, { template, report, ids: contacts.map(c => c.id), cursor: '', actor: schedule.publisherId, mode: settings.mode, status: 'preparing' });
                await this.put('report-schedule', schedule.id, schedule.revision, { ...schedule, lastPeriod: period, nextAt: new Date(Date.now() + schedule.days * 86400000).toISOString() });
            }
            catch {
                await this.metric('report_blocked');
            }
        }
        for (const run of await this.active<{
            template: EmailTemplate;
            report: EmailReport;
            ids: string[];
            cursor: string;
            actor: string;
            mode: 'capture' | 'send';
            status: string;
        }>('report-run', ['preparing'],20)) {
            if (run.status !== 'preparing' || this.operations > 550)
                continue;
            const rows = (await this.sql('SELECT * FROM email_contacts WHERE site_id=? AND id>? AND id IN (SELECT value FROM json_each(?)) ORDER BY id LIMIT 20', this.site, run.cursor, JSON.stringify(run.ids)).all<import('./store.ts').ContactRow>()).results;
            for (const row of rows) {
                const contact = await this.dto(row);
                if (await this.eligibility(contact, 'customer-report'))
                    continue;
                await this.enqueue('report_' + await digest(run.id + '|' + contact.id), contact, 'customer-report', { template: run.template, email: contact.email, report: run.report }, run.actor, run.mode);
            }
            try {
                await this.put('report-run', run.id, run.revision, { ...run, cursor: rows.at(-1)?.id || run.cursor, status: rows.length === 20 ? 'preparing' : 'completed' });
            }
            catch { /* Deterministic jobs make another worker's advancement safe. */ }
        }
    }
    async recurringDrafts() { for (const c of await this.dueDrafts<Campaign>()) {
        if (!c.nextIssueAt || c.nextIssueAt > Date.now() || ['cancelled', 'paused'].includes(c.status))
            continue;
        const nextId = 'issue_' + await digest(c.id + '|' + c.nextIssueAt), next: Campaign = { ...c, id: nextId, revision: 0, name: c.name.replace(/ · new issue$/, '') + ' · new issue', status: 'draft', scheduledAt: '', snapshot: undefined, segmentSnapshot: undefined, audienceIds: undefined, personalizationCipher: undefined, approvalMode: undefined, nextIssueAt: c.recurrenceDays ? Date.now() + c.recurrenceDays * 86400000 : undefined, cursor: undefined, approvedBy: undefined, approvalRevision: undefined };
        try {
            if (!await this.get('campaign', nextId))
                await this.put('campaign', nextId, 0, next);
            await this.put('campaign', c.id, c.revision, { ...c, nextIssueAt: undefined });
        }
        catch { }
    } }
    async housekeeping() {
        await this.sql('DELETE FROM email_limits WHERE site_id=? AND expires_at<?', this.site, Date.now()).run();
        await this.sql('DELETE FROM email_tokens WHERE site_id=? AND expires_at<?', this.site, Date.now()).run();
        await this.sql("DELETE FROM email_events WHERE site_id=? AND created_at<? AND type LIKE 'cf.email.%'", this.site, Date.now() - 90 * 86400000).run();
        await this.sql("UPDATE email_jobs SET payload_cipher='',message_cipher='' WHERE site_id=? AND created_at<? AND state NOT IN ('pending','preparing','sending','uncertain')", this.site, Date.now() - 90 * 86400000).run();
        await this.sql('DELETE FROM email_daily WHERE site_id=? AND day<?', this.site, new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)).run();
        await this.sql("UPDATE email_imports SET state='expired',payload_cipher='' WHERE site_id=? AND created_at<? AND state='pending'", this.site, Date.now() - 30 * 86400000).run();
        await this.sql("DELETE FROM email_import_chunks WHERE site_id=? AND import_id IN (SELECT id FROM email_imports WHERE site_id=? AND created_at<?)",this.site,this.site,Date.now()-30*86400000).run();
        await this.sql("UPDATE email_records SET revision=revision+1,data_json=json_remove(data_json,'$.personalizationCipher') WHERE site_id=? AND kind='campaign' AND created_at<? AND json_type(data_json,'$.personalizationCipher') IS NOT NULL AND json_extract(data_json,'$.status') IN ('completed','cancelled')",this.site,Date.now()-90*86400000).run();
    }
    async confirmedPreferences(){const rows=(await this.sql("SELECT id,contact_id,payload_json FROM email_events WHERE site_id=? AND type='preference.confirmed.pending' ORDER BY created_at LIMIT 10",this.site).all<{id:string;contact_id:string;payload_json:string}>()).results;for(const row of rows){const contact=await this.contact(row.contact_id);if(contact){await this.enroll({version:1,mode:'production',id:row.id,installationId:this.manifest.installationId,siteId:this.site,type:'subscription.confirmed',occurredAt:new Date().toISOString(),contact:{email:contact.email,name:contact.name,interactionRef:contact.interactionRef,serviceRef:contact.serviceRef}},contact);}await this.sql("UPDATE email_events SET type='subscription.confirmed' WHERE site_id=? AND id=? AND type='preference.confirmed.pending'",this.site,row.id).run();}}
    async retentionTick(){if(!await this.schema())return false;await this.housekeeping();await this.sql("UPDATE email_jobs SET state='uncertain',reason='expired_submission',lease_id=NULL,lease_until=0 WHERE site_id=? AND state='sending' AND lease_until<=?",this.site,Date.now()).run();return true;}
    async tick() {
        if (!await this.retentionTick() || !keysReady(this.env))
            return;
        await this.processImports();
        await this.recurringDrafts();
        await this.sql("UPDATE email_jobs SET state='uncertain',reason='expired_submission',lease_id=NULL,lease_until=0 WHERE site_id=? AND state='sending' AND lease_until<=?",this.site,Date.now()).run();
        const settings = (await this.settings()).data;
        if (!settings.enabled)
            return;
        await this.confirmedPreferences();
        await this.prepareCampaigns();
        await this.processEnrollments();
        if (this.operations < 550)
            await this.reportSchedules();
        const stale = await this.sql("SELECT id FROM email_jobs WHERE site_id=? AND mode='send' AND state='submitted' AND updated_at<? LIMIT 1", this.site, Date.now() - 6 * 3600000).first();
        if (!stale) {
            const jobs = (await this.sql("SELECT id FROM email_jobs WHERE site_id=? AND state IN ('pending','preparing') AND due_at<=? AND lease_until<=? ORDER BY due_at,id LIMIT ?", this.site, Date.now(), Date.now(), Math.min(settings.perMinute, 50)).all<{
                id: string;
            }>()).results;
            for (const job of jobs) {
                if (this.operations > 850)
                    break;
                await this.processJob(job.id);
            }
            ;
        }
        else {
            await this.metric('feedback_stale');
            await this.pauseHealth('feedback_stale');
        }
        for (const c of await this.active<Campaign>('campaign', ['running','scheduled'],30)) {
            if (c.status === 'scheduled' && Date.parse(c.scheduledAt) <= Date.now())
                await this.put('campaign', c.id, c.revision, { ...c, status: 'running' });
            if (c.status === 'running') {
                const unfinished = await this.sql("SELECT count(*) n FROM email_jobs WHERE site_id=? AND campaign_id=? AND state IN ('pending','preparing','sending','uncertain','blocked')", this.site, c.id).first<{
                    n: number;
                }>();
                if (!unfinished?.n)
                    await this.put('campaign', c.id, c.revision, { ...c, status: 'completed' });
            }
        }

    }
}
