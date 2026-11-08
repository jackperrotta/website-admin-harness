import { decrypt as open, encrypt as seal, encryptionReady as ready, digest, random } from '../scheduling/calendars/crypto.ts';
import { validEmail, type EmailModuleConfig, type EmailPurpose, type EmailTopic } from '../../../contracts/src/email-campaigns.ts';
import type { AdminEnv, AdminModule, ModuleContext } from '../worker.ts';
import type { AdminManifest } from '../../../contracts/src/index.ts';
export { digest, random };
export const base = '/api/modules/email-campaigns';
export const publicBase = base + '/public';
import type { CampaignEnv } from './env.ts';
export type { CampaignEnv, CampaignMessage } from './env.ts';
export class EmailError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export function fail(status: number, code: string, message: string): never { throw new EmailError(status, code, message); }
export const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export async function handled(fn: () => Promise<Response>): Promise<Response> { try {
    return await fn();
}
catch (e) {
    if (e instanceof EmailError)
        return Response.json({ error: e.message, code: e.code }, { status: e.status });
    if (e instanceof Error && e.name === 'EmailInputError')
        return Response.json({ error: e.message, code: 'invalid_input' }, { status: 400 });
    return Response.json({ error: 'Email operations are unavailable. Check the module schema, encryption keys, and bindings.', code: 'email_unavailable' }, { status: 503 });
} }
export async function readBody(request: Request, limit = 65536): Promise<Record<string, unknown>> { if (!request.headers.get('content-type')?.startsWith('application/json'))
    return fail(415, 'json_required', 'Use a JSON request.'); const reader = request.body?.getReader(); if (!reader)
    return fail(400, 'body_required', 'A request body is required.'); const chunks: Uint8Array[] = []; let size = 0; for (;;) {
    const { value, done } = await reader.read();
    if (done)
        break;
    size += value.byteLength;
    if (size > limit) {
        await reader.cancel();
        return fail(413, 'body_limit', 'This request is too large.');
    }
    chunks.push(value);
} const bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.length;
} try {
    const v: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!object(v))
        throw Error();
    return v;
}
catch {
    return fail(400, 'invalid_json', 'Use a valid JSON object.');
} }
export function checkRevision(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0)
    return fail(400, 'revision', 'A valid saved revision is required.'); return Number(value); }
export function keysReady(env: CampaignEnv) { return ready({ CALENDAR_TOKEN_KEYS: env.CAMPAIGN_TOKEN_KEYS }) && typeof env.CAMPAIGN_ID_KEY === 'string' && /^[A-Za-z0-9_-]{43}$/.test(env.CAMPAIGN_ID_KEY); }
export async function encrypt(env: CampaignEnv, scope: string, value: unknown) { try {
    return await seal({ CALENDAR_TOKEN_KEYS: env.CAMPAIGN_TOKEN_KEYS }, 'email|' + scope, value);
}
catch {
    return fail(503, 'email_keys', 'Configure the campaign encryption key ring.');
} }
export async function decrypt<T>(env: CampaignEnv, scope: string, value: string): Promise<T> { try {
    return await open<T>({ CALENDAR_TOKEN_KEYS: env.CAMPAIGN_TOKEN_KEYS }, 'email|' + scope, value);
}
catch {
    return fail(503, 'email_keys', 'Restore the campaign encryption key ring before processing pending messages.');
} }
export async function hmac(secret: string, value: string): Promise<string> { if (!/^[A-Za-z0-9_-]{43,128}$/.test(secret))
    return fail(503, 'email_secret', 'Configure an installation-owned signing secret.'); const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join(''); }
export async function verifyHmac(secret: string, value: string, signature: string) { const actual = await hmac(secret, value); if (signature.length !== actual.length)
    return false; let different = 0; for (let i = 0; i < actual.length; i++)
    different |= actual.charCodeAt(i) ^ signature.charCodeAt(i); return different === 0; }
export async function emailKey(env: CampaignEnv, scope: string, email: string) { if (!validEmail(email))
    return fail(400, 'invalid_email', 'Enter a valid email.'); return hmac(env.CAMPAIGN_ID_KEY || '', `${scope}|${email.trim().toLowerCase()}`); }
export const scopeOf = (m: AdminManifest) => `${m.installationId}|${m.site.id}|${m.adminOrigin}`;
export const topicOf = (purpose: EmailPurpose): EmailTopic => purpose === 'customer-report' ? 'reports' : purpose === 'newsletter-draft' ? 'newsletter' : 'service';
export function config(input: EmailModuleConfig): EmailModuleConfig { if (!input || !/^[a-z][a-z0-9-]{0,62}$/.test(input.feedbackQueue))
    throw Error('Configure an exact campaign feedback queue name.'); for (const key of ['accountId', 'zoneId', 'eventSubscriptionId'] as const)
    if (input[key] !== undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(input[key]!))
        throw Error('Invalid email account configuration.'); if (input.sendingDomain && !/^[a-z0-9.-]+\.[a-z]{2,63}$/.test(input.sendingDomain))
    throw Error('Invalid sending domain.'); if (input.dailyLimit !== undefined && (!Number.isInteger(input.dailyLimit) || input.dailyLimit < 1 || input.dailyLimit > 100000))
    throw Error('Invalid account daily email quota.'); return { ...input }; }
export function escapeHtml(value: string) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
export function csvCell(value: unknown) { const s = String(value ?? ''); return '"' + (/^[\s]*[=+\-@\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"'; }
export function parseCsv(input: string): string[][] { if (input.length > 1500000)
    return fail(413, 'csv_limit', 'Import up to 1.5 MB in one file.'); const rows: string[][] = []; let row: string[] = [], value = '', quoted = false; for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
        if (quoted && input[i + 1] === '"') {
            value += '"';
            i++;
        }
        else if (!value || quoted)
            quoted = !quoted;
        else
            return fail(400, 'csv_format', 'Invalid quoted CSV value.');
    }
    else if (c === ',' && !quoted) {
        row.push(value);
        value = '';
    }
    else if ((c === '\n' || c === '\r') && !quoted) {
        if (c === '\r' && input[i + 1] === '\n')
            i++;
        row.push(value);
        if (row.some(x => x.length))
            rows.push(row);
        row = [];
        value = '';
    }
    else
        value += c;
    if (value.length > 10000 || rows.length > 10001)
        return fail(413, 'csv_limit', 'Use at most 10,000 rows and shorter field values.');
} if (quoted)
    return fail(400, 'csv_format', 'Close the quoted CSV field.'); row.push(value); if (row.some(x => x.length))
    rows.push(row); return rows; }
export type { AdminModule, ModuleContext };
