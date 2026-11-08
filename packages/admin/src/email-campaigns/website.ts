/** Server-only website integration. These secrets must never enter browser bundles. */
import type { EmailWebsiteEvent } from '../../../contracts/src/email-campaigns.ts';
import { encrypt, decrypt, hmac, random, fail, digest } from './shared.ts';
export interface EmailWebsiteConnection {
    installationId: string;
    siteId: string;
    adminOrigin: string;
    websiteOrigin: string;
    local?: boolean;
}
export interface EmailWebsiteCredentials {
    signingKey: string;
    encryptionKeys: string;
}
function scope(connection: EmailWebsiteConnection) { const admin = new URL(connection.adminOrigin), site = new URL(connection.websiteOrigin); const loop = (u: URL) => ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname); if (admin.origin !== connection.adminOrigin || site.origin !== connection.websiteOrigin || (!connection.local && (admin.protocol !== 'https:' || site.protocol !== 'https:')) || connection.local && (!loop(admin) || !loop(site)))
    throw Error('Email website connections require exact HTTPS origins, or explicit local loopback origins.'); return `${connection.installationId}|${connection.siteId}|${connection.adminOrigin}`; }
export async function prepareWebsiteEmailEvent(db: D1Database, connection: EmailWebsiteConnection, credentials: EmailWebsiteCredentials, event: EmailWebsiteEvent): Promise<D1PreparedStatement> { const identity = scope(connection); if (event.installationId !== connection.installationId || event.siteId !== connection.siteId || !/^[a-zA-Z0-9_-]{1,100}$/.test(event.id) || new TextEncoder().encode(JSON.stringify(event)).byteLength > 16000)
    throw Error('Email event belongs to a different installation or exceeds the supported size.'); const fingerprint = await digest(JSON.stringify(event)), cipher = await encrypt({ CAMPAIGN_TOKEN_KEYS: credentials.encryptionKeys } as import('./shared.ts').CampaignEnv, identity + '|website|' + event.id, event); return db.prepare("INSERT INTO website_email_outbox(scope,id,fingerprint,state,payload_cipher,due_at,created_at) VALUES(?,?,?,'pending',?,?,?) ON CONFLICT(scope,id) DO UPDATE SET fingerprint=CASE WHEN website_email_outbox.fingerprint=excluded.fingerprint THEN website_email_outbox.fingerprint ELSE NULL END").bind(identity, event.id, fingerprint, cipher, Date.now(), Date.now()); }
/** For an existing collecting form, include prepareWebsiteEmailEvent in its authoritative D1 batch. */
export async function queueWebsiteEmailEvent(db: D1Database, connection: EmailWebsiteConnection, credentials: EmailWebsiteCredentials, event: EmailWebsiteEvent) { await (await prepareWebsiteEmailEvent(db, connection, credentials, event)).run(); }
export async function flushWebsiteEmailEvents(db: D1Database, connection: EmailWebsiteConnection, credentials: EmailWebsiteCredentials, http: Pick<Fetcher, 'fetch'> = { fetch }) { const identity = scope(connection), rows = (await db.prepare("SELECT id,payload_cipher,attempts,created_at FROM website_email_outbox WHERE scope=? AND state='pending' AND due_at<=? AND lease_until<=? ORDER BY created_at LIMIT 20").bind(identity, Date.now(), Date.now()).all<{
    id: string;
    payload_cipher: string;
    attempts: number;
    created_at: number;
}>()).results; for (const row of rows) {
    const lease = random();
    if (!(await db.prepare("UPDATE website_email_outbox SET lease_id=?,lease_until=?,attempts=attempts+1 WHERE scope=? AND id=? AND state='pending' AND lease_until<=? RETURNING id").bind(lease, Date.now() + 120000, identity, row.id, Date.now()).first()))
        continue;
    let stage='decrypt';
    try {
        const event = await decrypt<EmailWebsiteEvent>({ CAMPAIGN_TOKEN_KEYS: credentials.encryptionKeys } as import('./shared.ts').CampaignEnv, identity + '|website|' + row.id, row.payload_cipher), timestamp = String(Date.now()), body = JSON.stringify(event);
        stage='sign';
        const signature=await hmac(credentials.signingKey,identity+'|'+timestamp+'|'+body);
        stage='send';
        const response = await http.fetch(connection.adminOrigin + '/api/modules/email-campaigns/hooks/website', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', 'x-vitris-email-time': timestamp, 'x-vitris-email-signature': signature }, body, signal: AbortSignal.timeout(10000) });
        if (response.status !== 200)
            throw Object.assign(Error('event_not_accepted'),{code:'http_'+response.status});
        const receipt: unknown = await response.json();
        if (!receipt || typeof receipt !== 'object' || !('ok' in receipt) || receipt.ok !== true)
            throw Error('event_not_accepted');
        await db.prepare("UPDATE website_email_outbox SET state='accepted',payload_cipher='',lease_id=NULL,lease_until=0,last_error=NULL WHERE scope=? AND id=? AND lease_id=?").bind(identity, row.id, lease).run();
    }
    catch(error) {
        const code=error&&typeof error==='object'&&'code'in error&&/^[a-zA-Z0-9_]{1,80}$/.test(String(error.code))?String(error.code):'unavailable';
        await db.prepare('UPDATE website_email_outbox SET state=?,due_at=?,lease_id=NULL,lease_until=0,last_error=? WHERE scope=? AND id=? AND lease_id=?').bind(row.attempts >= 19 || Date.now() - row.created_at > 29 * 86400000 ? 'failed' : 'pending', Date.now() + Math.min(86400000, 60000 * 2 ** Math.min(row.attempts, 10)), stage+'_'+code,identity, row.id, lease).run();
    }
} }
