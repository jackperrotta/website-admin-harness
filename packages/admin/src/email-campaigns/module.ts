import { parseEmailAutomation, parseEmailCampaign, parseEmailContact, parseEmailSegment, parseEmailSettings, parseEmailTemplate, emailId, starterEmailTemplates, type EmailModuleConfig, type EmailTemplate, type EmailCampaign, type EmailSegment, type EmailContact, type EmailAutomation, type EmailWebsiteEvent } from '../../../contracts/src/email-campaigns.ts';
import { config as configuration, base, publicBase, handled, readBody, fail, checkRevision, object, decrypt, csvCell } from './shared.ts';
import type { AdminModule, ModuleContext } from '../worker.ts';
import { parseManifest } from '../../../contracts/src/index.ts';
import type { CampaignEnv } from './env.ts';
import { EmailEngine, type ReportSchedule, type JobRow } from './engine.ts';
import { preferenceRoute, signupRoute, websiteEventRoute, assetRoute, clickRoute } from './public.ts';
import { renderEmail } from './render.ts';
export type { CampaignEnv, CampaignMessage } from './env.ts';
export type { EmailModuleConfig } from '../../../contracts/src/email-campaigns.ts';
const recordId = (v: unknown) => emailId(v) ? v : fail(400, 'invalid_id', 'Choose a valid record.');
function reviewed(v: Record<string, unknown>) { if (v.reviewed !== true)
    fail(400, 'review_required', 'Review this action before confirming.'); }
export function createEmailCampaigns(input: EmailModuleConfig): AdminModule {
    const config = configuration(input), service = (c: {
        env: unknown;
        manifest: ModuleContext['manifest'];
    }) => new EmailEngine(c.env as CampaignEnv, c.manifest, config);
    const route = (name: string, methods: string[], run: (s: EmailEngine, r: Request) => Promise<Response>, retain = false) => ({ path: publicBase + '/' + name, methods, ...(retain ? { retainWhenDisabled: true as const } : {}), handle: (c: Parameters<NonNullable<AdminModule['publicRoutes']>[number]['handle']>[0]) => run(service(c), c.request) });
    return { id: 'email-campaigns', version: 1, label: 'Email campaigns', permission: 'email-campaigns:read', description: 'Cloudflare-only customer reports, communication templates, and website workflows.', ui: 'email-campaigns',
        publicRoutes: [route('preferences', ['GET', 'POST'], (s, r) => preferenceRoute(s, r), true), route('confirm', ['GET', 'POST'], (s, r) => preferenceRoute(s, r, true)), route('signup', ['OPTIONS', 'POST'], signupRoute), route('asset', ['GET'], assetRoute, true), route('click', ['GET'], clickRoute, true)],
        hooks: [{ path: base + '/hooks/website', handle: c => websiteEventRoute(service(c), c.request) }],
        queue: { name: config.feedbackQueue, retainWhenDisabled: true, handle: (batch, env, manifest) => service({ env, manifest }).feedback(batch) },
        scheduled: (env, manifest) => service({ env, manifest }).tick(),
        maintenance: async (env,manifest)=>{await service({env,manifest}).retentionTick();},
        handle: c => handled(async () => {
            const s = service(c), url = new URL(c.request.url), path = url.pathname.slice(base.length) || '/';
            await s.requireSchema();
            if (c.request.method === 'GET') {
                if (path === '/' || path === '/workspace')
                    return Response.json(await s.workspace(c.user));
                if (path === '/contacts') {
                    c.require('email-contacts:read');
                    const segment = url.searchParams.get('segment') ? await s.get<EmailSegment>('segment', recordId(url.searchParams.get('segment'))) : null;
                    const rows = await s.contacts({ segment, cursor: url.searchParams.get('cursor') || '', q: (url.searchParams.get('q') || '').slice(0, 150), limit: 101 });
                    return Response.json({ rows: await Promise.all(rows.slice(0, 100).map(r => s.dto(r))), nextCursor: rows.length > 100 ? rows[99].id : null });
                }
                if (path === '/audience') {
                    c.require('email-contacts:read');
                    const purpose = url.searchParams.get('purpose') || 'service-update';
                    if (!['customer-report', 'service-update', 'enquiry-response', 'newsletter-draft'].includes(purpose))
                        fail(400, 'purpose', 'Choose a supported purpose.');
                    const segmentId = url.searchParams.get('segment') || '', segment = segmentId ? await s.get<EmailSegment>('segment', recordId(segmentId)) : null;
                    const result = await s.audience(segment, purpose as EmailCampaign['purpose']);
                    const exclude = (url.searchParams.get('exclude') || '').split(',').filter(Boolean);
                    const excluded = exclude.length ? await s.excludedCount({ excludeIds: exclude, purpose } as EmailCampaign, segment) : 0;
                    return Response.json({ ...result, eligible: result.eligible - excluded, excluded: result.excluded + excluded });
                }
                const lists: Record<string, string> = { '/templates': 'template', '/segments': 'segment', '/campaigns': 'campaign', '/automations': 'automation', '/report-schedules': 'report-schedule' };
                if (lists[path]) {
                    const rows = await s.list(lists[path], 101, url.searchParams.get('cursor') || '');
                    return Response.json({ rows: rows.slice(0, 100), nextCursor: rows.length > 100 ? rows[99].id : null });
                }
                if (path === '/jobs') {
                    c.require('email-reports:read');
                    const cursor = url.searchParams.get('cursor') || '', campaign = url.searchParams.get('campaign') || '';
                    const parts=cursor?cursor.split(':'):[];if(cursor&&(!/^\d{13}$/.test(parts[0])||!emailId(parts[1])))fail(400,'invalid_cursor','Reload the message list.');const before=cursor?Number(parts[0]):Date.now()+1,lastId=parts[1]||'~';const rows = (await s.sql("SELECT id,campaign_id,contact_id,state,reason,mode,due_at,created_at,provider_message_id FROM email_jobs WHERE site_id=? AND (created_at<? OR (created_at=? AND id<?)) AND (?='' OR campaign_id=?) ORDER BY created_at DESC,id DESC LIMIT 101", s.site,before,before,lastId,campaign,campaign).all()).results;
                    return Response.json({ rows: rows.slice(0, 100), nextCursor: rows.length > 100 ? String(rows[99].created_at)+':'+rows[99].id : null });
                }
                if (path === '/reporting') {
                    c.require('email-reports:read');
                    const byCampaign = (await s.sql('SELECT campaign_id,state,count(*) total FROM email_jobs WHERE site_id=? GROUP BY campaign_id,state', s.site).all()).results, daily = (await s.sql('SELECT * FROM email_daily WHERE site_id=? ORDER BY day DESC LIMIT 366', s.site).all()).results;
                    return Response.json({ byCampaign, daily, conversions:(await s.sql("SELECT json_extract(payload_json,'$.campaignId') campaign_id,count(*) total FROM email_events WHERE site_id=? AND type='customer.converted' AND json_extract(payload_json,'$.campaignId') IS NOT NULL GROUP BY campaign_id",s.site).all()).results, enrollments: (await s.sql('SELECT id,automation_id,contact_id,step,state,due_at FROM email_enrollments WHERE site_id=? ORDER BY created_at DESC LIMIT 100', s.site).all()).results, imports: (await s.sql('SELECT id,cursor,total,state,created_at FROM email_imports WHERE site_id=? ORDER BY created_at DESC LIMIT 100', s.site).all()).results, clicks: (await s.sql('SELECT job_id,url,click_count,first_clicked_at FROM email_clicks WHERE site_id=? AND click_count>0 LIMIT 100', s.site).all()).results, notes: ['Submitted means Cloudflare accepted the message. Delivered means the receiving server accepted it.', 'Clicks may include automated scanners. Daily visitor counts are not deduplicated across days.'] });
                }
                if (path === '/timeline') {
                    c.require('email-contacts:read');
                    const id = recordId(url.searchParams.get('contact'));
                    if (!await s.contact(id))
                        fail(404, 'not_found', 'Contact not found.');
                    return Response.json({ jobs: (await s.sql('SELECT id,state,reason,purpose,created_at,updated_at FROM email_jobs WHERE site_id=? AND contact_id=? ORDER BY created_at DESC LIMIT 200', s.site, id).all()).results, preferences: (await s.sql('SELECT topic,status,evidence_json,updated_at FROM email_preferences WHERE site_id=? AND contact_id=?', s.site, id).all()).results, enrollments: (await s.sql('SELECT id,automation_id,step,state,due_at FROM email_enrollments WHERE site_id=? AND contact_id=?', s.site, id).all()).results });
                }
                if(path==='/export'){
                    c.require('email-contacts:export');const kind=url.searchParams.get('kind')||'contacts';
                    await c.audit('Exported email '+kind.replace(/[^a-z]/g,''));
                    if(kind==='contacts')return new Response(await s.exportContacts((url.searchParams.get('q')||'').slice(0,150)),{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="email-contacts.csv"'}});
                    if(kind==='templates')return Response.json({templates:await s.list('template',1000)});
                    if(!['preferences','suppressions','results'].includes(kind))fail(400,'export_kind','Choose a supported export.');
                    const table=({preferences:'email_preferences',suppressions:'email_suppressions',results:'email_jobs'} as Record<string,string>)[kind],columns=kind==='results'?'id,campaign_id,contact_id,state,reason,mode,created_at,provider_message_id':kind==='preferences'?'contact_id,topic,status,evidence_json,updated_at':'email_key,reason,created_at',key=kind==='preferences'?"contact_id||':'||topic":kind==='results'?'id':'email_key',dateField=kind==='preferences'?'updated_at':'created_at';
                    const from=url.searchParams.get('from')||'',to=url.searchParams.get('to')||'';for(const value of [from,to])if(value&&(!/^\d{4}-\d\d-\d\d$/.test(value)||!Number.isFinite(Date.parse(value))))fail(400,'export_dates','Choose valid export dates.');const lower=from?Date.parse(from):0,upper=to?Date.parse(to)+86400000:Date.now()+1;if(lower>=upper)fail(400,'export_dates','The export end must follow its start.');
                    const count=(await s.sql(`SELECT count(*) n FROM ${table} WHERE site_id=? AND ${dateField}>=? AND ${dateField}<?`,s.site,lower,upper).first<{n:number}>())?.n||0;if(count>100000)fail(413,'export_limit','Choose a smaller date range for an export under 100,000 rows.');
                    let cursor='';const encode=new TextEncoder(),headers=columns.split(',');const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(encode.encode(headers.join(',')+'\r\n'));},async pull(controller){try{const user=await s.sql('SELECT role,active FROM users WHERE id=?',c.user.id).first<{role:string;active:number}>();if(!user?.active||user.role!==c.user.role)throw Error('export_authority_changed');const rows=(await s.sql(`SELECT ${columns},${key} AS export_cursor FROM ${table} WHERE site_id=? AND ${dateField}>=? AND ${dateField}<? AND (${key})>? ORDER BY ${key} LIMIT 500`,s.site,lower,upper,cursor).all<Record<string,unknown>>()).results;if(!rows.length){controller.close();return;}controller.enqueue(encode.encode(rows.map(row=>headers.map(key=>csvCell(row[key])).join(',')).join('\r\n')+'\r\n'));cursor=String(rows.at(-1)!.export_cursor);if(rows.length<500)controller.close();}catch{controller.error(Error('The private export could not complete. Retry with a smaller date range.'));}}});
                    return new Response(stream,{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="email-${kind}.csv"`}});
                }
                if (path === '/preview') {
                    c.require('email-content:write');
                    const id = recordId(url.searchParams.get('template')), template = await s.get<EmailTemplate>(url.searchParams.has('version') ? 'template-version' : 'template', url.searchParams.has('version') ? id + '_' + recordId(url.searchParams.get('version')) : id);
                    if (!template)
                        fail(404, 'not_found', 'Template not found.');
                    let contact: Pick<EmailContact, 'name' | 'company'> = { name: 'Preview recipient', company: 'Preview business' };
                    const contactId = url.searchParams.get('contact');
                    if (contactId) {
                        c.require('email-contacts:read');
                        contact = await s.contact(recordId(contactId)) || fail(404, 'not_found', 'Contact not found.');
                    }
                    return new Response(renderEmail(template, contact, (await s.settings()).data, s.manifest.business.name, s.manifest.adminOrigin + publicBase + '/preferences', { title: 'Service report preview', period: 'this period', summary: 'Preview values only. Actual reports use fresh data.' }).html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
                }
                if (path === '/template-history') {
                    c.require('email-content:write');
                    const id = recordId(url.searchParams.get('template'));
                    const rows = (await s.sql("SELECT revision,data_json,created_at FROM email_records WHERE site_id=? AND kind='template-version' AND json_extract(data_json,'$.id')=? ORDER BY created_at DESC LIMIT 100", s.site, id).all<{
                        revision: number;
                        data_json: string;
                        created_at: number;
                    }>()).results;
                    return Response.json({ versions: rows.map(row => { const t = JSON.parse(row.data_json) as EmailTemplate; return { name: t.name, revision: t.revision, subject: t.subject, createdAt: new Date(row.created_at).toISOString(), preview: s.manifest.adminOrigin + base + '/preview?template=' + id + '&version=' + t.revision }; }) });
                }
                if (path === '/capture' || path === '/capture-document') {
                    c.require('email-content:write');
                    c.require('email-contacts:read');
                    const id = recordId(url.searchParams.get('job')), row = await s.sql("SELECT message_cipher FROM email_jobs WHERE site_id=? AND id=? AND mode='capture' AND state='captured' AND message_cipher<>''", s.site, id).first<{
                        message_cipher: string;
                    }>();
                    if (!row)
                        fail(404, 'not_found', 'Captured message not found.');
                    const message = await decrypt<import('./env.ts').CampaignMessage>(s.env, s.scope + '|message|' + id, row.message_cipher);
                    if (path === '/capture-document')
                        return new Response(message.html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
                    return Response.json({ message, previewUrl: base + '/capture-document?job=' + id });
                }
                if (path === '/assets')
                    return Response.json({ rows: (await s.sql('SELECT id,name,type FROM email_assets WHERE site_id=? ORDER BY created_at DESC LIMIT 100', s.site).all()).results.map(r => ({ ...r, url: s.manifest.adminOrigin + publicBase + '/asset?id=' + r.id })) });
                fail(404, 'not_found', 'Email view not found.');
            }
            if (c.request.method !== 'POST')
                fail(405, 'method', 'Use GET or POST for this operation.');
            const data = await readBody(c.request, path.startsWith('/imports') ? 1700000 : path === '/assets' ? 1600000 : 65536);
            await s.limit('user:' + c.user.id, 120, 60000);
            let result: unknown;
            if (path === '/settings') {
                c.require('email-settings:manage');
                const value = parseEmailSettings(data.settings);
                if (value.logoUrl) {
                    const logo = new URL(value.logoUrl);
                    if (logo.origin !== s.manifest.adminOrigin || logo.pathname !== publicBase + '/asset' || !await s.sql('SELECT id FROM email_assets WHERE site_id=? AND id=?', s.site, logo.searchParams.get('id') || '').first())
                        fail(400, 'logo_asset', 'Choose a logo uploaded to this installation.');
                }
                if (value.enabled && value.mode === 'send' && (await s.settings()).data.mode !== 'send' && !(await s.readiness()).liveReady)
                    fail(503, 'email_not_ready', 'Complete server-side sender and feedback readiness before choosing Send mode.');
                result = await s.put('settings', 'settings', checkRevision(data.revision), value);
            }
            else if(path==='/health/review'){
                c.require('email-settings:manage');reviewed(data);await s.reviewHealth();result={reviewed:true};
            }
            else if (path === '/contacts') {
                c.require('email-contacts:write');
                result = await s.saveContact(parseEmailContact(data));
            }
            else if (path === '/contacts/delete') {
                c.require('email-contacts:write');
                reviewed(data);
                await s.deleteContact(recordId(data.id), checkRevision(data.revision));
                result = { deleted: true };
            }
            else if (path === '/contacts/suppress') {
                c.require('email-contacts:write');
                reviewed(data);
                await s.suppress(recordId(data.id), 'staff_suppression');
                result = { suppressed: true };
            }
            else if (path === '/templates') {
                c.require('email-content:write');
                result = await s.saveTemplate(parseEmailTemplate(data));
            }
            else if (path === '/test') {
                c.require('email-content:write');
                c.require('email-contacts:read');
                c.require('email-campaigns:send');
                reviewed(data);
                const template = await s.get<EmailTemplate>('template', recordId(data.templateId)), contact = await s.contact(recordId(data.contactId)), settings = (await s.settings()).data;
                if (!template || !contact || typeof data.recipient !== 'string' || !/^\S+@\S+\.\S+$/.test(data.recipient))
                    fail(400, 'test_input', 'Choose a saved template, sample contact, and test recipient.');
                let allowed: string[] = [];
                try {
                    allowed = JSON.parse(s.env.CAMPAIGN_TEST_RECIPIENTS || '[]');
                }
                catch { }
                if (settings.mode === 'send' && (!allowed.includes(data.recipient) || template.layout === 'newsletter'))
                    fail(400, 'test_recipient', 'Live tests require a configured test recipient and supported transactional content.');
                const id = 'test_' + crypto.randomUUID();
                await s.enqueue(id, contact, 'service-update', { template, email: contact.email, testRecipient: data.recipient }, c.user.id, settings.mode);
                result = { id, mode: settings.mode };
            }
            else if (path === '/segments') {
                c.require('email-contacts:write');
                const item = parseEmailSegment(data);
                result = await s.put('segment', item.id || crypto.randomUUID(), item.revision, item);
            }
            else if (path === '/campaigns') {
                c.require('email-content:write');
                const item = parseEmailCampaign(data), old = item.id ? await s.get<EmailCampaign>('campaign', item.id) : null;
                if (old && old.status !== 'draft')
                    fail(409, 'campaign_state', 'Duplicate this campaign to edit a new draft.');
                result = await s.put('campaign', item.id || crypto.randomUUID(), item.revision, { ...item, ...(item.recurrenceDays ? { nextIssueAt: Date.now() + item.recurrenceDays * 86400000 } : {}) });
            }
            else if (path === '/campaigns/duplicate') {
                c.require('email-content:write');
                const old = await s.get<EmailCampaign>('campaign', recordId(data.id));
                if (!old)
                    fail(404, 'not_found', 'Campaign not found.');
                result = await s.put('campaign', crypto.randomUUID(), 0, parseEmailCampaign({ ...old, id: '', revision: 0, name: old.name + ' copy', scheduledAt: '' }));
            }
            else if (path === '/campaigns/approve') {
                c.require('email-campaigns:send');
                c.require('email-contacts:read');
                reviewed(data);
                if (!Number.isInteger(data.audienceCount))
                    fail(400, 'audience_review', 'Review the eligible audience count.');
                result = await s.approvedCampaign(recordId(data.id), checkRevision(data.revision), c.user, Number(data.audienceCount));
            }
            else if (path === '/campaigns/action') {
                c.require('email-campaigns:send');
                result = await s.campaignAction(recordId(data.id), checkRevision(data.revision), String(data.action));
            }
            else if (path === '/automations') {
                c.require('email-automations:manage');
                const a = parseEmailAutomation(data), old = a.id ? await s.get<EmailAutomation>('automation', a.id) : null;
                result = await s.put('automation', a.id || crypto.randomUUID(), a.revision, { ...a, version: old?.version || 0, publisherId: old?.publisherId, status: old?.version ? old.status : 'draft', hasDraft: true });
            }
            else if (path === '/automations/publish') {
                c.require('email-automations:manage');
                c.require('email-campaigns:send');
                reviewed(data);
                const a = await s.get<EmailAutomation>('automation', recordId(data.id));
                if (!a || a.revision !== checkRevision(data.revision))
                    fail(409, 'email_conflict', 'Reload the saved automation before publishing.');
                result = await s.publishAutomation(a, c.user);
            }
            else if (path === '/automations/pause') {
                c.require('email-automations:manage');
                const a = await s.get<EmailAutomation>('automation', recordId(data.id));
                if (!a)
                    fail(404, 'not_found', 'Automation not found.');
                result = await s.put('automation', a.id, checkRevision(data.revision), { ...a, status: data.paused === false ? 'active' as const : 'paused' as const });
            }
            else if (path === '/enrollments/stop') {
                c.require('email-automations:manage');
                const id = recordId(data.id);
                await s.sql("UPDATE email_enrollments SET state='stopped',updated_at=? WHERE site_id=? AND id=?", Date.now(), s.site, id).run();
                await s.sql("UPDATE email_jobs SET state='superseded',reason='staff_stop',updated_at=? WHERE site_id=? AND campaign_id=? AND state IN ('pending','preparing','blocked')", Date.now(), s.site, 'auto_' + id).run();
                result = { stopped: true };
            }
            else if (path === '/enrollments/manual') {
                c.require('email-automations:manage');
                c.require('email-contacts:read');
                const a = await s.get<EmailAutomation>('automation', recordId(data.automationId)), contact = await s.contact(recordId(data.contactId));
                if (!a || a.trigger !== 'manual' || !contact || typeof data.eventId !== 'string' || !emailId(data.eventId))
                    fail(400, 'manual_enrollment', 'Choose a contact and a published manual automation with a unique event reference.');
                const event = { id: data.eventId, type: 'manual', contact: { email: contact.email, name: contact.name } } as unknown as EmailWebsiteEvent;
                await s.enroll(event, contact, a.id);
                result = { enrolled: true };
            }
            else if (path === '/report-schedules') {
                c.require('email-automations:manage');
                c.require('email-campaigns:send');
                c.require('analytics:read');
                const template = await s.get<EmailTemplate>('template', recordId(data.templateId));
                if (!template || template.layout === 'newsletter' || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 150 || !Number.isInteger(data.days) || Number(data.days) < 1 || Number(data.days) > 90 || typeof data.nextAt !== 'string' || !Number.isFinite(Date.parse(data.nextAt)))
                    fail(400, 'report_schedule', 'Choose a transactional template, 1–90 days, and a valid next run.');
                const value: ReportSchedule = { id: data.id ? recordId(data.id) : crypto.randomUUID(), revision: checkRevision(data.revision), name: data.name, templateId: template.id, segmentId: data.segmentId ? recordId(data.segmentId) : '', days: Number(data.days), nextAt: data.nextAt, status: data.status === 'paused' ? 'paused' : 'active', publisherId: c.user.id };
                result = await s.put('report-schedule', value.id, value.revision, value);
            }
            else if (path === '/imports/preview' || path === '/imports/start') {
                c.require('email-contacts:write');
                if (typeof data.csv !== 'string' || !object(data.mapping) || Object.values(data.mapping).some(v => typeof v !== 'string') || typeof data.evidence !== 'string' || data.evidence.length > 1000)
                    fail(400, 'csv_input', 'Choose a CSV file, column mapping, and source.');
                if (path.endsWith('/preview')) {
                    const preview = await s.importPreview(data.csv, data.mapping as Record<string, string>, data.evidence);
                    result = { ...preview, rows: preview.rows.slice(0, 10) };
                }
                else {
                    reviewed(data);
                    result = await s.startImport(data.csv, data.mapping as Record<string, string>, data.evidence);
                }
            }
            else if (path === '/assets') {
                c.require('email-content:write');
                if (!s.env.ASSET_STORE)
                    fail(503, 'assets_setup', 'Configure this installation’s R2 asset store.');
                if (typeof data.name !== 'string' || data.name.length > 150 || typeof data.content !== 'string' || typeof data.type !== 'string' || !['image/png', 'image/jpeg', 'image/webp'].includes(data.type))
                    fail(400, 'asset_input', 'Choose a PNG, JPEG, or WebP image under 1 MB.');
                let bytes: Uint8Array;
                try {
                    bytes = Uint8Array.from(atob(data.content), x => x.charCodeAt(0));
                }
                catch {
                    return fail(400, 'asset_input', 'Invalid image data.');
                }
                const valid = data.type === 'image/png' ? bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 : data.type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
                if (!valid || bytes.byteLength > 1000000)
                    fail(400, 'asset_input', 'Choose a valid image under 1 MB.');
                const id = crypto.randomUUID(), key = 'email/' + s.site + '/' + id;
                await s.env.ASSET_STORE!.put(key, bytes, { httpMetadata: { contentType: data.type } });
                await s.sql('INSERT INTO email_assets(site_id,id,r2_key,type,name,created_at) VALUES(?,?,?,?,?,?)', s.site, id, key, data.type, data.name, Date.now()).run();
                result = { id, url: s.manifest.adminOrigin + publicBase + '/asset?id=' + id };
            }
            else if (path === '/jobs/resolve') {
                c.require('email-campaigns:send');
                reviewed(data);
                await s.resolveUnknown(recordId(data.id), String(data.action), c.user);
                result = { resolved: true };
            }
            else if (path === '/jobs/retry') {
                c.require('email-campaigns:send');
                reviewed(data);
                await s.sql("UPDATE email_jobs SET state='pending',due_at=?,reason=NULL WHERE site_id=? AND id=? AND state='blocked' AND mode=?", Date.now(), s.site, recordId(data.id), (await s.settings()).data.mode).run();
                result = { queued: true };
            }
            else if (path === '/process') {
                c.require('email-settings:manage');
                await s.tick();
                result = { processed: true };
            }
            else if (path === '/article-draft') {
                c.require('email-content:write');
                if (typeof data.title !== 'string' || typeof data.summary !== 'string' || typeof data.url !== 'string')
                    fail(400, 'article_input', 'Add an article title, summary, and source URL.');
                const template = parseEmailTemplate({ ...starterEmailTemplates()[3], id: '', revision: 0, name: data.title, subject: data.title, blocks: [{ type: 'heading', text: data.title }, { type: 'paragraph', text: data.summary }, { type: 'button', text: 'Read the article', url: data.url }] });
                result = await s.saveTemplate(template);
            }
            else
                fail(404, 'not_found', 'Email action not found.');
            await c.audit('Email campaigns: ' + path.slice(1).replaceAll('/', ' '));
            return Response.json({ ok: true, result });
        }) };
}
/** Private consumer/scheduler for existing Pages installations. No public routes or inbox. */
export function createEmailCampaignWorker(input: unknown, options: EmailModuleConfig) { const manifest = parseManifest(input), config = configuration(options); return { fetch() { return new Response('Not found', { status: 404 }); }, async scheduled(_controller: ScheduledController, env: CampaignEnv) { if (manifest.modules.includes('email-campaigns'))
        await new EmailEngine(env, manifest, config).tick(); else await new EmailEngine(env,manifest,config).retentionTick(); }, async queue(batch: MessageBatch<unknown>, env: CampaignEnv) { if (batch.queue !== config.feedbackQueue)
        throw Error('Unexpected campaign feedback queue.'); await new EmailEngine(env, manifest, config).feedback(batch); } }; }
