import { parseEmailContact, validEmail, emailId, type EmailTopic, type EmailWebsiteEvent, type EmailContact, type EmailTemplate } from '../../../contracts/src/email-campaigns.ts';
import { EmailEngine } from './engine.ts';
import { handled, readBody, fail, object, verifyHmac, escapeHtml, publicBase, digest, emailKey } from './shared.ts';
const page = (title: string, body: string) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{margin:0;padding:12vh 20px;background:#f2f5f1;color:#223c2d;font:16px/1.7 Arial,sans-serif}main{max-width:560px;margin:auto;padding:32px;background:white;border:1px solid #d9e3d8;border-radius:12px}h1{font-size:28px;line-height:1.3}button{display:block;padding:12px 18px;margin:14px 0;background:#315d48;color:white;border:0;border-radius:5px;font:inherit;cursor:pointer}button:focus-visible{outline:3px solid #547ed8;outline-offset:3px}</style></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex, noarchive', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } });
async function formToken(request: Request) { const length = Number(request.headers.get('content-length') || 0); if (length > 1000)
    fail(413, 'body_limit', 'This request is too large.'); const reader = request.body?.getReader(); let text = '', size = 0; if (reader)
    for (;;) {
        const { value, done } = await reader.read();
        if (done)
            break;
        size += value.byteLength;
        if (size > 1000) {
            await reader.cancel();
            fail(413, 'body_limit', 'This request is too large.');
        }
        text += new TextDecoder().decode(value);
    } const form = new URLSearchParams(text); return {token:form.get('token')||new URL(request.url).searchParams.get('token')||'',all:form.get('scope')==='all'}; }
export async function preferenceRoute(engine: EmailEngine, request: Request, confirmation = false) { return handled(async () => { await engine.requireSchema(); const url = new URL(request.url), input=request.method==='POST'?await formToken(request):{token:url.searchParams.get('token')||'',all:false}, token=input.token, resolved = await engine.resolveToken(token, confirmation ? 'confirm' : 'preferences'); if (request.method === 'GET') {
    return page(confirmation ? 'Confirm your email preference' : 'Email preferences', `<p>${escapeHtml(engine.manifest.business.name)} · ${escapeHtml(resolved.topic)} emails</p><p>${confirmation ? 'Confirm the preference you requested.' : 'Stop optional emails for this topic. Account security and necessary service notices are managed separately.'}</p><form method="post" action="${publicBase}/${confirmation ? 'confirm' : 'preferences'}"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit" name="scope" value="topic">${confirmation ? 'Confirm subscription' : 'Unsubscribe from this topic'}</button>${confirmation?'':'<button type="submit" name="scope" value="all">Stop all optional emails</button>'}</form>`);
} if (confirmation) {
    const nonce = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER), results = await engine.env.DB.batch([engine.sql('UPDATE email_tokens SET consumed_at=? WHERE site_id=? AND digest=? AND consumed_at IS NULL AND expires_at>?', nonce, engine.site, resolved.digest, Date.now()), engine.sql("INSERT INTO email_preferences(site_id,contact_id,topic,status,evidence_json,updated_at) SELECT ?,?,?,'subscribed',?,? WHERE EXISTS(SELECT 1 FROM email_tokens WHERE site_id=? AND digest=? AND consumed_at=?) ON CONFLICT(site_id,contact_id,topic) DO UPDATE SET status='subscribed',evidence_json=excluded.evidence_json,updated_at=excluded.updated_at", engine.site, resolved.contact_id, resolved.topic, JSON.stringify({ source: 'confirmed website request', at: Date.now() }), Date.now(), engine.site, resolved.digest, nonce),engine.sql("INSERT OR IGNORE INTO email_events(site_id,id,type,contact_id,payload_json,created_at) SELECT ?,?,'preference.confirmed.pending',?,?,? WHERE EXISTS(SELECT 1 FROM email_tokens WHERE site_id=? AND digest=? AND consumed_at=?)",engine.site,'preference_'+resolved.digest,resolved.contact_id,JSON.stringify({topic:resolved.topic}),Date.now(),engine.site,resolved.digest,nonce)]);
    if (!results[0].meta.changes)
        fail(409, 'email_link_used', 'This confirmation was already used.');
    return page('Preference confirmed', '<p>Your email preference is saved. Newsletter delivery depends on supported sending availability.</p>');
} const topics=input.all?['reports','service','newsletter'] as const:[resolved.topic];let changed=false;for(const topic of topics){if(resolved.contact.topics[topic])changed=true;await engine.preference(resolved.contact_id,topic,false,'recipient opt-out');}if(changed)await engine.metric('unsubscribed'); return page('Unsubscribed', '<p>Your preference has been saved. Future optional emails for this topic have stopped.</p>'); }); }
export async function signupRoute(engine: EmailEngine, request: Request) { const response=await handled(async () => { const origin = request.headers.get('origin'), expected = engine.manifest.site.origin; const cors = { 'access-control-allow-origin': expected, 'vary': 'Origin', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'Content-Type' }; if (origin !== expected)
    fail(403, 'website_origin', 'This website origin is not connected.'); if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: cors }); await engine.requireSchema(); const body = await readBody(request, 4096); if (!validEmail(body.email) || !['reports', 'service', 'newsletter'].includes(String(body.topic)) || typeof body.turnstileToken !== 'string' || body.turnstileToken.length > 2048)
    fail(400, 'signup_fields', 'Enter your email and complete verification.'); const key = await emailKey(engine.env, engine.scope, body.email); await engine.limit('signup-email:' + key, 3, 3600000); const source = await digest(engine.scope + '|' + (request.headers.get('cf-connecting-ip') || 'local')); await engine.limit('signup-source:' + source, 15, 3600000); if (!engine.env.CAMPAIGN_TURNSTILE_SECRET)
    fail(503, 'signup_setup', 'Email signup is not available yet.'); const response = await (engine.env.CAMPAIGN_CHALLENGE_HTTP || { fetch }).fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: engine.env.CAMPAIGN_TURNSTILE_SECRET, response: body.turnstileToken }), redirect: 'manual', signal: AbortSignal.timeout(10000) }); const challenge: unknown = await response.json(); if (!response.ok || !object(challenge) || challenge.success !== true || challenge.hostname !== new URL(expected).hostname || challenge.action !== 'email_subscribe')
    fail(403, 'signup_challenge', 'Verification did not complete. Please try again.'); const existing = await engine.sql('SELECT id,deleted_at FROM email_contacts WHERE site_id=? AND email_key=?', engine.site, key).first<{
    id: string;
    deleted_at: number | null;
}>(); if (existing?.deleted_at || await engine.sql('SELECT email_key FROM email_suppressions WHERE site_id=? AND email_key=?', engine.site, key).first())
    return Response.json({ ok: true, message: 'If eligible, a confirmation email will follow.' }, { headers: cors }); const contact = existing ? await engine.contact(existing.id) : await engine.saveContact(parseEmailContact({ email: body.email, name: typeof body.name === 'string' ? body.name : '', company: '', tags: [], fields: {}, topics: {}, source: 'website-signup', evidence: 'website signup request', revision: 0 })); const owner = await engine.sql("SELECT id FROM users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").first<{
    id: string;
}>(); if (!owner || !contact)
    fail(503, 'signup_setup', 'Email signup is not available yet.'); const raw = await engine.token(contact.id, 'confirm', body.topic as EmailTopic), settings = (await engine.settings()).data, template: EmailTemplate = { id: 'confirmation', revision: 1, name: 'Preference confirmation', layout: 'letter', subject: 'Confirm your email preference', preheader: 'A confirmation you requested.', blocks: [{ type: 'paragraph', text: 'Confirm your requested email preference.' }] }; await engine.enqueue('confirm_' + await digest(raw), contact, 'enquiry-response', { template, email: contact.email, confirmationToken: raw }, owner.id, settings.mode); return Response.json({ ok: true, message: 'If eligible, a confirmation email will follow.' }, { headers: cors }); });if(request.headers.get('origin')===engine.manifest.site.origin){response.headers.set('access-control-allow-origin',engine.manifest.site.origin);response.headers.set('vary','Origin');}return response; }
export async function websiteEventRoute(engine: EmailEngine, request: Request) {
    return handled(async () => {
        await engine.requireSchema();
        const body = await readBody(request, 16384), timestamp = request.headers.get('x-vitris-email-time') || '', signature = request.headers.get('x-vitris-email-signature') || '';
        if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 300000 || !engine.env.CAMPAIGN_WEBSITE_KEY || !await verifyHmac(engine.env.CAMPAIGN_WEBSITE_KEY, engine.scope + '|' + timestamp + '|' + JSON.stringify(body), signature))
            fail(401, 'event_signature', 'Invalid website event signature.');
        if (Object.keys(body).some(key=>!['version','mode','id','installationId','siteId','type','occurredAt','contact','report','campaignId'].includes(key)) || body.campaignId!==undefined&&!emailId(body.campaignId) || !['production','test'].includes(String(body.mode)) || body.version !== 1 || body.installationId !== engine.manifest.installationId || body.siteId !== engine.site || !emailId(body.id) || !['lead.created', 'service.updated', 'report.ready', 'customer.converted', 'enquiry.resolved', 'subscription.confirmed'].includes(String(body.type)) || !object(body.contact) || !validEmail(body.contact.email) || typeof body.occurredAt !== 'string' || !Number.isFinite(Date.parse(body.occurredAt)) || Date.parse(body.occurredAt) > Date.now() + 300000 || Date.parse(body.occurredAt) < Date.now() - 30 * 86400000)
            fail(400, 'event_scope', 'Invalid website event identity or time.');
        if(Object.keys(body.contact).some(key=>!['email','name','company','interactionRef','serviceRef'].includes(key)))fail(400,'event_fields','Only the typed minimal contact fields are supported.');
        if(body.mode==='test')return Response.json({ok:true,ignored:true});
        const normalized = parseEmailContact({ ...body.contact, name: body.contact.name || '', company: body.contact.company || '', source: 'website-event', stage: 'lead', tags: [], fields: {}, topics: {}, evidence: 'signed website interaction ' + body.id, revision: 0 });
        let report: EmailWebsiteEvent['report'];
        if (body.report !== undefined) {
            if (!object(body.report) || ['title', 'period', 'summary'].some(k => typeof (body.report as Record<string, unknown>)[k] !== 'string' || String((body.report as Record<string, unknown>)[k]).length > (k === 'summary' ? 5000 : 200)))
                fail(400, 'event_report', 'Invalid report fields.');
            report = { title: String(body.report.title), period: String(body.report.period), summary: String(body.report.summary) };
        }
        const event: EmailWebsiteEvent = { version: 1, mode:'production', id: String(body.id), installationId: engine.manifest.installationId, siteId: engine.site, type: body.type as EmailWebsiteEvent['type'], occurredAt: body.occurredAt, contact: { email: normalized.email, name: normalized.name, company: normalized.company, interactionRef: normalized.interactionRef, serviceRef: normalized.serviceRef }, ...(report ? { report } : {}) };
        if(body.campaignId)event.campaignId=String(body.campaignId);
        const fingerprint = await digest(JSON.stringify(event));
        await engine.sql('INSERT OR IGNORE INTO email_events(site_id,id,type,contact_id,payload_json,created_at) VALUES(?,?,?,?,?,?)', engine.site, 'website_' + event.id, 'website.pending', '', JSON.stringify({ fingerprint, complete: false }), Date.now()).run();
        const receipt = await engine.sql('SELECT payload_json FROM email_events WHERE site_id=? AND id=?', engine.site, 'website_' + event.id).first<{
            payload_json: string;
        }>();
        if (receipt) {
            const previous = JSON.parse(receipt.payload_json) as {
                fingerprint: string;
                complete?: boolean;
            };
            if (previous.fingerprint !== fingerprint)
                fail(409, 'event_conflict', 'An event with this ID has different content.');
            if (previous.complete)
                return Response.json({ ok: true, replayed: true });
        }
        const existing = await engine.sql('SELECT id,deleted_at FROM email_contacts WHERE site_id=? AND email_key=?', engine.site, await emailKey(engine.env, engine.scope, normalized.email)).first<{
            id: string;
            deleted_at: number | null;
        }>();
        if (existing?.deleted_at)
            return Response.json({ ok: true, ignored: true });
        let contact: EmailContact;
        if (existing) {
            contact = (await engine.contact(existing.id))!;
            contact = await engine.saveContact({ ...contact, interactionRef: normalized.interactionRef || contact.interactionRef, serviceRef: normalized.serviceRef || contact.serviceRef });
        }
        else
            contact = await engine.saveContact(normalized);
        if (event.type === 'lead.created' && contact.interactionRef)
            await engine.preference(contact.id, 'service', true, event.type + ' ' + event.id);
        if (['customer.converted', 'enquiry.resolved'].includes(event.type)) {
            await engine.sql("UPDATE email_enrollments SET state='stopped',updated_at=? WHERE site_id=? AND contact_id=? AND state='active'", Date.now(), engine.site, contact.id).run();
            await engine.sql("UPDATE email_jobs SET state='superseded',reason='interaction_resolved',updated_at=? WHERE site_id=? AND contact_id=? AND campaign_id LIKE 'auto_%' AND state IN ('pending','preparing','blocked')", Date.now(), engine.site, contact.id).run();
        }
        await engine.enroll(event, (await engine.contact(contact.id))!);
        const attributed=event.type==='customer.converted'&&event.campaignId?await engine.sql("SELECT id FROM email_jobs WHERE site_id=? AND contact_id=? AND campaign_id=? AND mode='send' AND state IN ('submitted','delivered') AND created_at BETWEEN ? AND ? LIMIT 1",engine.site,contact.id,event.campaignId,Date.parse(event.occurredAt)-30*86400000,Date.parse(event.occurredAt)).first():null;
        await engine.sql('UPDATE email_events SET type=?,contact_id=?,payload_json=? WHERE site_id=? AND id=?', event.type, contact.id, JSON.stringify({ fingerprint, complete: true,...(attributed?{campaignId:event.campaignId}:{}) }), engine.site, 'website_' + event.id).run();
        return Response.json({ ok: true });
    });
}
export async function assetRoute(engine: EmailEngine, request: Request) { return handled(async () => { const id = new URL(request.url).searchParams.get('id'); if (!emailId(id))
    fail(404, 'not_found', 'Asset not found.'); const asset = await engine.sql('SELECT r2_key,type FROM email_assets WHERE site_id=? AND id=?', engine.site, id).first<{
    r2_key: string;
    type: string;
}>(); if (!asset || !engine.env.ASSET_STORE)
    fail(404, 'not_found', 'Asset not found.'); const item = await engine.env.ASSET_STORE.get(asset.r2_key); if (!item)
    fail(404, 'not_found', 'Asset not found.'); return new Response(item.body, { headers: { 'content-type': asset.type } }); }); }
export async function clickRoute(engine: EmailEngine, request: Request) { return handled(async () => { const id = new URL(request.url).searchParams.get('id'); if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))
    fail(404, 'not_found', 'Link not found.'); const item = await engine.sql('SELECT url FROM email_clicks WHERE site_id=? AND id=?', engine.site, id).first<{
    url: string;
}>(); if (!item || !item.url.startsWith('https://'))
    fail(404, 'not_found', 'Link not found.'); await engine.sql('UPDATE email_clicks SET click_count=click_count+1,first_clicked_at=COALESCE(first_clicked_at,?) WHERE site_id=? AND id=?', Date.now(), engine.site, id).run(); return Response.redirect(item.url, 302); }); }
