import { readFile, readdir } from 'node:fs/promises';
import { resolve, join, relative, extname } from 'node:path';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { EmailContact, EmailCampaign, EmailSettings, EmailTemplate, EmailWebsiteEvent } from '../packages/contracts/src/email-campaigns.ts';
const defaultEmailSettings = (): EmailSettings => ({ enabled: false, mode: 'capture', senderName: '', logoUrl: '', replyTo: '', postalAddress: '', accent: '#245c50', timezone: 'America/New_York', perMinute: 50, dailyLimit: 500, monthlyLimit: 3000, recipientCap: 5000, spacingHours: 24, otherAccountEmails: 0, reservedDaily: 50, clickTracking: false });
export async function emailFixture(options: {
    trace?:boolean;
    runtimeRoot?: string;
    mail?: (message: Record<string, unknown>) => Promise<unknown>;
    server?: boolean;
    localWebsite?: boolean;
    websiteOrigin?: string;
    bindingOverrides?: Record<string, string>;
} = {}) {
    const trace=(message:string)=>{if(options.trace)console.log('Email fixture: '+message);};trace('reserving port');
    const reservation = createServer();
    await new Promise<void>(r => reservation.listen(0, '127.0.0.1', r));
    const address = reservation.address();
    if (!address || typeof address === 'string')
        throw Error('No fixture port');
    const port = address.port;
    await new Promise<void>(r => reservation.close(() => r()));
    const origin = `http://127.0.0.1:${port}`, root = resolve(options.runtimeRoot || 'packages/admin'), assetRoot = join(root, 'dist/client'), key = randomBytes(32).toString('base64url'), identityKey = randomBytes(32).toString('base64url'), websiteKey = randomBytes(32).toString('base64url'), keys = JSON.stringify({ current: 'v1', keys: { v1: key } });
    const manifest = { schemaVersion: 1, installationId: 'email-fixture', business: { name: 'Synthetic Communications', initials: 'SC' }, site: { id: 'email-fixture', name: 'Synthetic website', origin: options.websiteOrigin || (options.localWebsite ? `http://localhost:${port}` : 'https://website.example.test') }, adminOrigin: origin, modules: ['email-campaigns', 'work-queue'] };
    const config = { feedbackQueue: 'synthetic-email-feedback', accountId: 'synthetic-account', zoneId: 'synthetic-zone', sendingDomain: 'example.test', eventSubscriptionId: 'synthetic-subscription', dailyLimit: 20000 };
    const source = `import {createAdmin} from ${JSON.stringify(join(root, 'dist/worker.js'))};import {createEmailCampaigns} from ${JSON.stringify(join(root, 'dist/email-campaigns.js'))};import {prepareWebsiteEmailEvent,flushWebsiteEmailEvents} from ${JSON.stringify(join(root, 'dist/email-website.js'))};const config=${JSON.stringify(config)},manifest=${JSON.stringify(manifest)};const modules=[createEmailCampaigns(config)];const main=createAdmin(manifest,{modules}),disabled=createAdmin({...manifest,adminOrigin:'http://localhost:${port}',modules:[]},{modules}),beta=createAdmin({...manifest,installationId:'email-beta',site:{...manifest.site,id:'email-beta'},adminOrigin:'http://127.0.0.1:${port + 1}'},{modules}),old=createAdmin({...manifest,adminOrigin:'http://127.0.0.1:${port + 2}'},{modules});const off=createAdmin({...manifest,modules:[]},{modules});let disabledSame=false;const realNow=Date.now.bind(Date);let offset=0;Date.now=()=>realNow()+offset;const mail=env=>({...env,CAMPAIGN_EMAIL:{send:async message=>{const response=await env.TEST_MAIL.fetch('https://mail.invalid',{method:'POST',body:JSON.stringify(message)});const result=await response.json();if(result.errorCode)throw Object.assign(new Error('Simulated provider failure'),{code:result.errorCode});if(result.unknown)throw Error('Simulated response loss');return result;}}});export default {async fetch(request,env){env=mail(env);const url=new URL(request.url);if(url.pathname==='/__fixture/website-event'){const event=await request.json(),connection={installationId:manifest.installationId,siteId:manifest.site.id,adminOrigin:manifest.adminOrigin,websiteOrigin:manifest.site.origin,local:manifest.site.origin.startsWith('http:')},credentials={signingKey:env.CAMPAIGN_WEBSITE_KEY,encryptionKeys:env.CAMPAIGN_TOKEN_KEYS};const statement=await prepareWebsiteEmailEvent(env.WEBSITE_DB,connection,credentials,event);await env.WEBSITE_DB.batch([env.WEBSITE_DB.prepare('INSERT OR IGNORE INTO website_fixture_leads(id,email) VALUES(?,?)').bind(event.id,event.contact.email),statement]);let receipt={stage:'before-fetch',timeout:typeof AbortSignal.timeout};await flushWebsiteEmailEvents(env.WEBSITE_DB,connection,credentials,{fetch:async(url,options)=>{receipt={stage:'fetch-wrapper'};try{const req=new Request(url,options);receipt={stage:'request-created'};const response=await main.fetch(req,env);receipt={status:response.status,body:await response.clone().json()};return response;}catch(error){receipt={stage:'wrapper-error',message:String(error.message).slice(0,200)};throw error;}}});return Response.json({ok:true,receipt});}if(url.pathname==='/__fixture/reset'){disabledSame=false;offset=0;return Response.json({ok:true});}if(url.pathname==='/__fixture/disable'){disabledSame=true;return Response.json({ok:true});}if(url.pathname==='/__fixture/tick'){await (disabledSame?off:main).scheduled({},env);return Response.json({ok:true});}if(url.pathname==='/__fixture/advance'){offset+=Number(url.searchParams.get('ms'));return Response.json({now:Date.now()});}if(url.pathname==='/__fixture/feedback'){const input=await request.json(),out={acked:[],retried:[]};const messages=input.events.map((body,i)=>({body,id:String(i),ack(){out.acked.push(String(i));},retry(){out.retried.push(String(i));}}));await (input.disabled?off:main).queue({queue:input.queue||config.feedbackQueue,messages},env);return Response.json(out);}const app=disabledSame&&url.origin===manifest.adminOrigin?off:url.hostname==='localhost'?disabled:url.port==='${port + 1}'?beta:url.port==='${port + 2}'?old:main;return app.fetch(request,url.port==='${port + 2}'?{...env,DB:env.OLD_DB}:env);}};`;
    trace('bundling');
    const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'neutral' });
    const app = new Miniflare(convertV4MiniflareOptions({ ...(options.server ? { port, host: '127.0.0.1' } : {}), workers: [{ name: 'email-fixture', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01', d1Databases: { DB: 'email-fixture', OLD_DB: 'email-old', WEBSITE_DB: 'email-website' }, r2Buckets: { ASSET_STORE: 'email-assets' }, bindings: { MODE: 'local', CAMPAIGN_TOKEN_KEYS: keys, CAMPAIGN_ID_KEY: identityKey, CAMPAIGN_WEBSITE_KEY: websiteKey, CAMPAIGN_FROM: 'reports@example.test', CAMPAIGN_EMAIL_READY: '1', CAMPAIGN_SEND_ENABLED: '1', CAMPAIGN_FEEDBACK_READY: '1', CAMPAIGN_TURNSTILE_SECRET: 'synthetic-turnstile-secret', CAMPAIGN_TEST_RECIPIENTS: JSON.stringify(['owner@example.test']), ...options.bindingOverrides }, serviceBindings: { TEST_MAIL: async (request) => { try {
                        return Response.json(await (options.mail?.(await request.json() as Record<string, unknown>) || Promise.resolve({ messageId: 'synthetic-' + randomBytes(12).toString('hex') })));
                    }
                    catch {
                        return Response.json({ unknown: true });
                    } }, CAMPAIGN_CHALLENGE_HTTP: async (request) => { const form = await request.formData(); return Response.json({ success: form.get('response') === 'synthetic-valid-challenge', hostname: new URL(manifest.site.origin).hostname, action: 'email_subscribe' }); }, ASSETS: async (request) => { const path = new URL(request.url).pathname; if (path === '/__fixture/signup-client.js')
                        return new Response(await readFile(join(root, 'dist/email-signup.js')), { headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': manifest.site.origin } }); const file = resolve(assetRoot, path === '/' ? 'index.html' : '.' + path); if (relative(assetRoot, file).startsWith('..'))
                        return new Response('Not found', { status: 404 }); try {
                        return new Response(await readFile(file), { headers: { 'content-type': ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' } as Record<string, string>)[extname(file)] || 'application/octet-stream' } });
                    }
                    catch {
                        if (!extname(path))
                            return new Response(await readFile(join(assetRoot, 'index.html')), { headers: { 'content-type': 'text/html' } });
                        return new Response('Not found', { status: 404 });
                    } } } }] }));
    try {
        trace('waiting for worker');await app.ready;trace('worker ready');
    }
    catch (error) {
        await app.dispose();
        throw error;
    }
    trace('opening databases');
    const db = await app.getD1Database('DB', 'email-fixture'), websiteDb = await app.getD1Database('WEBSITE_DB', 'email-fixture'), oldDb = await app.getD1Database('OLD_DB', 'email-fixture');
    const apply = async (database: typeof db, text: string) => { for (const chunk of text.split('-- statement-breakpoint')) {
        const clean = chunk.replace(/^--.*$/gm, '').trim();
        if (!clean)
            continue;
        if (/CREATE TRIGGER/.test(clean))
            await database.prepare(clean).run();
        else
            for (const sql of clean.split(';').map(s => s.trim()).filter(Boolean))
                await database.prepare(sql).run();
    } };
    await apply(websiteDb, await readFile(join(root, 'modules/email-campaigns/website/0001_website_email_outbox.sql'), 'utf8'));
    await websiteDb.prepare('CREATE TABLE website_fixture_leads(id TEXT PRIMARY KEY,email TEXT NOT NULL)').run();
    for (const file of ['0001_core.sql', '0002_work_queue.sql', '0003_password_credentials.sql']) {
        const sql = await readFile(join(root, 'migrations', file), 'utf8');
        await apply(db, sql);
        await apply(oldDb, sql);
    }
    await db.prepare("INSERT INTO leads(id,site_id,name,email,message,source) VALUES('retained','email-fixture','Retained enquiry','retained@example.test','Keep this enquiry','fixture')").run();
    await apply(db, await readFile(join(root, 'modules/email-campaigns/migrations/0001_email_campaigns.sql'), 'utf8'));
    const cookies: Record<string, string> = {};
    for (const user of ['owner', 'administrator', 'editor', 'analyst']) {
        const raw = 'synthetic-email-session-' + user;
        cookies[user] = 'vitris-admin-local=' + raw;
        for (const database of [db, oldDb]) {
            await database.prepare('INSERT INTO users(id,email,role) VALUES(?,?,?)').bind(user, user + '@example.test', user).run();
            await database.prepare('INSERT INTO sessions(digest,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(raw).digest('hex'), user, Math.floor(Date.now() / 1000) + 30 * 86400).run();
        }
    }
    const post = (path: string, data: unknown, user = 'owner', baseOrigin = origin) => app.dispatchFetch(baseOrigin + '/api/modules/email-campaigns' + path, { method: 'POST', headers: { origin: baseOrigin, cookie: cookies[user] || '', 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const get = (path: string, user = 'owner', baseOrigin = origin) => app.dispatchFetch(baseOrigin + '/api/modules/email-campaigns' + path, { headers: { cookie: cookies[user] || '' } });
    const result = async <T>(response: {
        status: number;
        json: () => Promise<unknown>;
    }): Promise<T> => { const value = await response.json() as {
        result: T;
        error?: string;
    }; if (response.status !== 200)
        throw Error(`HTTP ${response.status}: ${JSON.stringify(value)}`); return value.result; };
    const contact = async (patch: Partial<EmailContact> = {}) => result<EmailContact>(await post('/contacts', { id: '', revision: 0, email: 'customer-' + randomBytes(5).toString('hex') + '@example.test', name: 'Synthetic Customer', company: 'Example Company', stage: 'customer', tags: ['customer'], fields: {}, source: 'fixture', serviceRef: 'agreed-service', interactionRef: 'requested-enquiry', topics: { reports: true, service: true }, evidence: 'Synthetic permission and service agreement', ...patch }));
    const settings = async (patch: Partial<EmailSettings> = {}) => { const w = await (await get('/workspace')).json() as {
        settings: {
            revision: number;
        };
    }; return result(await post('/settings', { revision: w.settings.revision, settings: { ...defaultEmailSettings(), enabled: true, spacingHours: 0, reservedDaily: 0, perMinute: 100, dailyLimit: 10000, monthlyLimit: 50000, ...patch } })); };
    const campaign = async (patch: Partial<EmailCampaign> = {}) => result<EmailCampaign>(await post('/campaigns', { id: '', revision: 0, name: 'Synthetic service update', purpose: 'service-update', templateId: 'starter-update', segmentId: '', excludeIds: [], scheduledAt: '', recurrenceDays: 0, ...patch }));
    const tick = async () => { const response = await app.dispatchFetch(origin + '/__fixture/tick'); if (response.status !== 200)
        throw Error('Fixture tick failed: ' + await response.text()); };
    const event = async (event: EmailWebsiteEvent) => { const timestamp = String(Date.now()), body = JSON.stringify(event), signature = createHmac('sha256', websiteKey).update(`${manifest.installationId}|${manifest.site.id}|${origin}|${timestamp}|${body}`).digest('hex'); return app.dispatchFetch(origin + '/api/modules/email-campaigns/hooks/website', { method: 'POST', headers: { 'content-type': 'application/json', 'x-vitris-email-time': timestamp, 'x-vitris-email-signature': signature }, body }); };
    trace('ready');
    return { app, db, oldDb, websiteDb, origin, port, manifest, config, keys, websiteKey, cookies, post, get, result, contact, settings, campaign, tick, event, apply,
        async advance(ms: number) { await app.dispatchFetch(origin + '/__fixture/advance?ms=' + ms); },
        async reset() { await app.dispatchFetch(origin + '/__fixture/reset'); const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'email_%'").all<{
            name: string;
        }>()).results; for (const { name } of tables)
            if (/^email_[a-z_]+$/.test(name))
                await db.prepare('DELETE FROM ' + name).run(); await db.prepare("UPDATE users SET active=1,role=id").run(); await db.prepare('DELETE FROM tasks').run(); },
        async feedback(events: unknown[], disabled = false) { return app.dispatchFetch(origin + '/__fixture/feedback', { method: 'POST', body: JSON.stringify({ events, disabled }) }); },
        async dispose() { await app.dispose(); }
    };
}
