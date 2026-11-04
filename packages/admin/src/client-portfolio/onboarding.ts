import type {AdminModule, AdminEnv, ModuleContext, ModuleServiceContext} from '../worker.ts';
import {isLoopback, isObject, normalizeOnboardingFields, onboardingAnswersMatch, type AdminManifest, type Prospect, type ProspectPortal, type OnboardingTemplate, type OnboardingConfig, type OnboardingDraft} from '../../../contracts/src/index.ts';
import {createPassword, validNewPassword} from '../password.ts';
import {onboardingStarters, parseOnboardingTemplate, defaultOnboardingTitle, defaultOnboardingIntro} from './onboarding-templates.ts';

const root = '/api/modules/client-onboarding', cookie = 'vitris-prospect-local';
type Env = AdminEnv & {CLIENT_ONBOARDING_PEPPER?: string};
interface Row {
  id: string; business: string; name: string; email: string; preview_url: string; message: string;
  status: 'draft' | 'invited' | 'active' | 'revoked'; created_at: string; invited_at: string | null;
  expires_at: number | null; activated_at: string | null; invite_digest: string | null; credential: string | null;
  fields: string; requires_payment: number; payment_status: Prospect['paymentStatus']; feedback: string; feedback_at: string | null;
  onboarding_config: string; onboarding_draft: string;
}
const now = () => Math.floor(Date.now() / 1000), iso = () => new Date().toISOString();
const token = () => crypto.randomUUID() + crypto.randomUUID();
const scope = (m: AdminManifest) => [m.site.id, m.installationId, m.adminOrigin];
const where = 'site_id=? AND installation_id=? AND admin_origin=?';
const hex = (v: ArrayBuffer) => Array.from(new Uint8Array(v), b => b.toString(16).padStart(2, '0')).join('');
const digest = async (v: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
const json = (v: unknown, status = 200, headers: HeadersInit = {}) => Response.json(v, {status, headers});
const error = (message: string, status = 400) => json({error: message}, status);
const validToken = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9-]{72}$/.test(v);
function available(env: Env, m: AdminManifest, request: Request) {
  return env.MODE === 'local' && isLoopback(m.adminOrigin) && new URL(m.adminOrigin).protocol === 'http:' && new URL(request.url).origin === m.adminOrigin && !m.backend && (env.CLIENT_ONBOARDING_PEPPER?.length || 0) >= 32;
}
function dto(row: Row): Prospect {
  return {id: row.id, business: row.business, name: row.name, email: row.email, previewUrl: row.preview_url, message: row.message,
    status: row.status === 'invited' && (row.expires_at || 0) <= now() ? 'expired' : row.status,
    createdAt: row.created_at, invitedAt: row.invited_at, expiresAt: row.expires_at ? new Date(row.expires_at * 1000).toISOString() : null,
    activatedAt: row.activated_at, fields: JSON.parse(row.fields), requiresPayment: !!row.requires_payment, paymentStatus: row.payment_status, feedback: row.feedback, feedbackAt: row.feedback_at,
    onboarding:{title:defaultOnboardingTitle,intro:defaultOnboardingIntro,...JSON.parse(row.onboarding_config || '{}') as Partial<OnboardingConfig>}};
}
function portal(row: Row): ProspectPortal {
  const v = dto(row); return {business: v.business, name: v.name, email: v.email, previewUrl: v.previewUrl, message: v.message, fields: v.fields, requiresPayment: v.requiresPayment, paymentStatus: v.paymentStatus, feedback: v.feedback, feedbackAt: v.feedbackAt,
    onboarding:{title:v.onboarding!.title,intro:v.onboarding!.intro},...(row.status === 'invited' ? {draft:JSON.parse(row.onboarding_draft || '{}') as OnboardingDraft,inviteId:row.id} : {})};
}
async function body(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return null;
  const reader = request.body?.getReader(); if (!reader) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {const {value, done} = await reader.read(); if (done) break; size += value.length; if (size > 20000) {await reader.cancel(); return null;} chunks.push(value);}
  const all = new Uint8Array(size); let at = 0; for (const v of chunks) {all.set(v, at); at += v.length;}
  try {const v: unknown = JSON.parse(new TextDecoder().decode(all)); return isObject(v) ? v : null;} catch {return null;}
}
function text(v: unknown, max: number) {return typeof v === 'string' && v.trim().length <= max ? v.trim() : null;}
const fields = normalizeOnboardingFields;
async function templates(env: Env, m: AdminManifest): Promise<OnboardingTemplate[]> {
  const result=await env.DB.prepare(`SELECT id,revision,payload,updated_at FROM client_onboarding_templates WHERE ${where} AND archived_at IS NULL ORDER BY updated_at DESC,id`).bind(...scope(m)).all<{id:string;revision:number;payload:string;updated_at:string}>();
  return [...result.results.map(r=>({...JSON.parse(r.payload),id:r.id,revision:r.revision,updatedAt:r.updated_at,source:'saved'}) as OnboardingTemplate),...onboardingStarters];
}
async function workspace(env: Env, m: AdminManifest) {
  const rows = await env.DB.prepare(`SELECT * FROM client_onboarding_prospects WHERE ${where} ORDER BY created_at DESC,id`).bind(...scope(m)).all<Row>();
  return {rows: rows.results.map(dto), templates:await templates(env,m), localOnly: true as const, delivery: 'copy-link' as const};
}
const sessionCookie = (raw = '', clear = false) => `${cookie}=${raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 3600}`;
async function startSession(env: Env, m: AdminManifest, id: string) {
  const raw = token();
  const result = await env.DB.prepare(`INSERT INTO client_onboarding_sessions(site_id,installation_id,admin_origin,digest,prospect_id,expires_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM client_onboarding_prospects WHERE ${where} AND id=? AND status='active')`).bind(...scope(m), await digest(raw), id, now() + 3600, ...scope(m), id).run();
  return result.meta.changes ? json({ok: true}, 200, {'set-cookie': sessionCookie(raw)}) : error('This account is unavailable.', 401);
}
async function current(env: Env, m: AdminManifest, request: Request) {
  const raw = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(cookie + '='))?.slice(cookie.length + 1);
  if (!validToken(raw)) return null;
  return env.DB.prepare(`SELECT p.* FROM client_onboarding_prospects p JOIN client_onboarding_sessions s ON p.site_id=s.site_id AND p.installation_id=s.installation_id AND p.admin_origin=s.admin_origin AND p.id=s.prospect_id WHERE p.site_id=? AND p.installation_id=? AND p.admin_origin=? AND p.status='active' AND s.digest=? AND s.expires_at>?`).bind(...scope(m), await digest(raw), now()).first<Row>();
}
async function verify(env: Env, row: Row | null, password: unknown) {
  // Same PBKDF2/HMAC format as harness accounts; stored in a separate prospect namespace.
  const stored = row?.credential ? JSON.parse(row.credential) as {salt: string; tag: string} : {salt: '00'.repeat(32), tag: '00'.repeat(32)};
  const bytes = (s: string) => Uint8Array.from(s.match(/.{2}/g) || [], v => parseInt(v, 16));
  const input = typeof password === 'string' && password.length <= 256 ? password.normalize('NFC') : '';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(input), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt: bytes(stored.salt)}, key, 1536);
  const pepper = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.CLIENT_ONBOARDING_PEPPER!), {name: 'HMAC', hash: 'SHA-256'}, false, ['verify']);
  return await crypto.subtle.verify('HMAC', pepper, bytes(stored.tag), derived) && row?.status === 'active';
}

async function owner(context: ModuleContext) {
  const {request, manifest: m, require: authorize, audit} = context, env = context.env as Env;
  if (!available(env, m, request)) return error('This prototype requires its isolated local installation.', 404);
  if (context.user.role !== 'owner') return error('Only the installation owner can manage prospects.', 403);
  const path = new URL(request.url).pathname.slice(root.length);
  if (request.method === 'GET' && (path === '' || path === '/')) return json(await workspace(env, m));
  if (request.method !== 'POST') return error('Method not allowed.', 405);
  authorize('prospects:write'); const data = await body(request); if (!data) return error('Send a valid JSON request.');
  if (path === '/templates' || /^\/templates\/[\w-]+(?:\/archive)?$/.test(path)) {
    const id=path.split('/')[2];
    if (path.endsWith('/archive')) {
      if (!Number.isSafeInteger(data.revision)) return error('Send the template revision.');
      const changed=await env.DB.prepare(`UPDATE client_onboarding_templates SET archived_at=?,revision=revision+1 WHERE ${where} AND id=? AND revision=? AND archived_at IS NULL`).bind(iso(),...scope(m),id,Number(data.revision)).run();
      if (!changed.meta.changes) return error('The template changed or is unavailable. Refresh before trying again.',409);
      await audit('Archived an onboarding template; existing prospects unchanged'); return json(await workspace(env,m));
    }
    const parsed=parseOnboardingTemplate(data); if (!parsed) return error('Add a template name, welcome copy, and valid question definitions.');
    if (id) {
      if (!Number.isSafeInteger(data.revision)) return error('Send the template revision.');
      const changed=await env.DB.prepare(`UPDATE client_onboarding_templates SET payload=?,updated_at=?,revision=revision+1 WHERE ${where} AND id=? AND revision=? AND archived_at IS NULL`).bind(JSON.stringify(parsed),iso(),...scope(m),id,Number(data.revision)).run();
      if (!changed.meta.changes) return error('The template changed or is unavailable. Refresh before trying again.',409);
    } else {
      const count=await env.DB.prepare(`SELECT COUNT(*) n FROM client_onboarding_templates WHERE ${where} AND archived_at IS NULL`).bind(...scope(m)).first<{n:number}>(); if ((count?.n || 0)>=50) return error('Archive a template before adding more.',409);
      await env.DB.prepare('INSERT INTO client_onboarding_templates(site_id,installation_id,admin_origin,id,payload,updated_at) VALUES(?,?,?,?,?,?)').bind(...scope(m),crypto.randomUUID(),JSON.stringify(parsed),iso()).run();
    }
    await audit(id ? 'Updated an onboarding template; existing prospects unchanged' : 'Created an onboarding template'); return json(await workspace(env,m));
  }
  if (path === '') {
    const business = text(data.business, 120), name = text(data.name, 100), email = text(data.email, 254)?.toLowerCase(), message = text(data.message, 1500), previewUrl = text(data.previewUrl, 2000), requested = fields(data.fields);
    if (!business || !name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || message === null || previewUrl === null || !requested || typeof data.requiresPayment !== 'boolean') return error('Add the business, contact, email, and valid onboarding fields.');
    if (previewUrl) {try {const u = new URL(previewUrl); if (u.protocol !== 'https:' || u.username || u.password || u.port) return error('Use an HTTPS test-site URL without credentials or a custom port.');} catch {return error('Use a complete HTTPS test-site URL.');}}
    if (await env.DB.prepare(`SELECT id FROM client_onboarding_prospects WHERE ${where} AND email=?`).bind(...scope(m), email).first()) return error('A prospect with this email already exists.', 409);
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM client_onboarding_prospects WHERE ${where}`).bind(...scope(m)).first<{n: number}>(); if ((count?.n || 0) >= 100) return error('This prototype supports up to 100 prospects.', 409);
    const title=data.title === undefined ? defaultOnboardingTitle : text(data.title,100), intro=data.intro === undefined ? defaultOnboardingIntro : text(data.intro,400); if (!title || intro === null) return error('Add an onboarding title and introduction.');
    const config:OnboardingConfig={title,intro};
    if (data.templateId) {const template=(await templates(env,m)).find(t=>t.id===data.templateId); if (!template) return error('Template not found.',404); if (data.templateRevision !== template.revision) return error('The template changed. Re-select it before preparing the prospect.',409); Object.assign(config,{templateId:template.id,templateName:template.name,templateRevision:template.revision});}
    await env.DB.prepare('INSERT INTO client_onboarding_prospects(site_id,installation_id,admin_origin,id,business,name,email,preview_url,message,created_at,fields,requires_payment,payment_status,onboarding_config) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(...scope(m), crypto.randomUUID(), business, name, email, previewUrl, message, iso(), JSON.stringify(requested), data.requiresPayment ? 1 : 0, data.requiresPayment ? 'pending' : 'not_requested',JSON.stringify(config)).run();
    await audit('Prepared a local prospect account'); return json(await workspace(env, m));
  }
  const route = path.match(/^\/([\w-]+)\/(invite|revoke)$/); if (!route) return error('Not found.', 404);
  const row = await env.DB.prepare(`SELECT * FROM client_onboarding_prospects WHERE ${where} AND id=?`).bind(...scope(m), route[1]).first<Row>(); if (!row) return error('Prospect not found.', 404);
  if (route[2] === 'revoke') {
    await env.DB.batch([env.DB.prepare(`UPDATE client_onboarding_prospects SET status='revoked',invite_digest=NULL WHERE ${where} AND id=?`).bind(...scope(m), row.id), env.DB.prepare(`DELETE FROM client_onboarding_sessions WHERE ${where} AND prospect_id=?`).bind(...scope(m), row.id)]);
    await audit('Revoked local prospect access'); return json(await workspace(env, m));
  }
  if (!['draft', 'invited'].includes(row.status)) return error('Only draft or pending accounts can receive a new setup link.', 409);
  const raw = token(); const changed = await env.DB.prepare(`UPDATE client_onboarding_prospects SET status='invited',invite_digest=?,invited_at=?,expires_at=? WHERE ${where} AND id=? AND status IN ('draft','invited')`).bind(await digest(raw), iso(), now() + 86400, ...scope(m), row.id).run();
  if (!changed.meta.changes) return error('The account changed. Refresh and try again.', 409);
  await audit('Generated a local prospect setup link; no email sent');
  return json({...await workspace(env, m), invitation: {url: `${m.adminOrigin}/prospect/activate?invite=${row.id}#token=${raw}`, email: row.email}});
}

async function publicRoute(context: ModuleServiceContext) {
  const {request, manifest: m} = context, env = context.env as Env;
  if (!available(env, m, request)) return error('This local prototype is unavailable.', 404);
  if (request.headers.get('origin') !== m.adminOrigin) return error('Origin check failed.', 403);
  const data = await body(request); if (!data) return error('Send a valid JSON request.');
  const path = new URL(request.url).pathname.split('/').pop();
  if (path === 'invitation' || path === 'activate' || path === 'progress') {
    const inviteId=typeof data.inviteId === 'string' && /^[\w-]{1,60}$/.test(data.inviteId) ? data.inviteId : '';
    const setupCookie=`vitris-prospect-setup-${inviteId}`;
    const raw=data.token || request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(setupCookie+'='))?.slice(setupCookie.length+1);
    if (!validToken(raw)) return error('This setup link is invalid or expired.', 410);
    const hash = await digest(raw);
    const row = await env.DB.prepare(`SELECT * FROM client_onboarding_prospects WHERE ${where} AND invite_digest=? AND status='invited' AND expires_at>?`).bind(...scope(m), hash, now()).first<Row>();
    if (!row || inviteId && inviteId!==row.id) return error('This setup link is expired, replaced, or already used. Ask for a new invitation.', 410);
    const setupCookieValue=(clear=false)=>`vitris-prospect-setup-${row.id}=${clear ? '' : raw}; Path=${root}/hooks/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : Math.max(0,(row.expires_at || 0)-now())}`;
    if (path === 'invitation') return json(portal(row),200,{'set-cookie':setupCookieValue()});
    const name = text(data.name, 100), answers = fields(data.fields), original = fields(JSON.parse(row.fields));
    if (!name || !answers || !original || !onboardingAnswersMatch(answers,original,path==='activate')) return error('Complete the required details using the assigned questions.');
    if (path === 'progress') {
      if (!['business','website','account'].includes(String(data.step))) return error('Choose a valid onboarding step.');
      const draft:OnboardingDraft={name,fields:answers,step:data.step as OnboardingDraft['step'],savedAt:iso()};
      const changed=await env.DB.prepare(`UPDATE client_onboarding_prospects SET onboarding_draft=? WHERE ${where} AND id=? AND status='invited' AND invite_digest=? AND expires_at>? RETURNING *`).bind(JSON.stringify(draft),...scope(m),row.id,hash,now()).first<Row>();
      return changed ? json(portal(changed)) : error('This invitation is no longer available.',410);
    }
    if (!validNewPassword(data.password) || data.password !== data.confirmPassword) return error('Use matching passwords of at least 15 characters.');
    const credential = await createPassword({DB: env.DB, PASSWORD_LOGIN: '1', PASSWORD_PEPPER: env.CLIENT_ONBOARDING_PEPPER}, data.password);
    const updated = await env.DB.prepare(`UPDATE client_onboarding_prospects SET status='active',name=?,fields=?,credential=?,activated_at=?,invite_digest=NULL WHERE ${where} AND id=? AND status='invited' AND invite_digest=? AND expires_at>? RETURNING id`).bind(name, JSON.stringify(answers), JSON.stringify(credential), iso(), ...scope(m), row.id, hash, now()).first<{id: string}>();
    if (!updated) return error('This link was used or the account changed. Sign in or ask for a new invitation.',410);
    const response=await startSession(env,m,row.id); response.headers.append('set-cookie',setupCookieValue(true)); return response;
  }
  if (path === 'login') {
    const email = text(data.email, 254)?.toLowerCase();
    const row = email ? await env.DB.prepare(`SELECT * FROM client_onboarding_prospects WHERE ${where} AND email=?`).bind(...scope(m), email).first<Row>() : null;
    return await verify(env, row, data.password) ? startSession(env, m, row!.id) : error('The email or password is incorrect, or access is unavailable.', 401);
  }
  const row = await current(env, m, request); if (!row) return error('Sign in to your client dashboard.', 401);
  if (path === 'logout') {
    const raw = request.headers.get('cookie')!.split(';').map(v => v.trim()).find(v => v.startsWith(cookie + '='))!.slice(cookie.length + 1);
    await env.DB.prepare(`DELETE FROM client_onboarding_sessions WHERE ${where} AND digest=?`).bind(...scope(m), await digest(raw)).run();
    return json({ok: true}, 200, {'set-cookie': sessionCookie('', true)});
  }
  if (path === 'workspace') return json(portal(row));
  if (path === 'feedback') {
    const value = text(data.feedback, 3000); if (!value) return error('Add your feedback, up to 3,000 characters.');
    const changed = await env.DB.prepare(`UPDATE client_onboarding_prospects SET feedback=?,feedback_at=? WHERE ${where} AND id=? AND status='active' RETURNING *`).bind(value, iso(), ...scope(m), row.id).first<Row>();
    return changed ? json(portal(changed)) : error('Access is unavailable.', 401);
  }
  if (path === 'payment-demo') {
    if (!row.requires_payment || data.confirmed !== true) return error('Confirm the sample payment-method step.');
    const changed = await env.DB.prepare(`UPDATE client_onboarding_prospects SET payment_status='demo_complete' WHERE ${where} AND id=? AND status='active' RETURNING *`).bind(...scope(m), row.id).first<Row>();
    return changed ? json(portal(changed)) : error('Access is unavailable.', 401);
  }
  return error('Not found.', 404);
}

/** Explicit optional local experience prototype. No recipient mail, Stripe calls, or staff grants. */
export const clientOnboardingPrototype: AdminModule = {
  id: 'client-onboarding', version: 1, label: 'Prospects & onboarding', permission: 'prospects:read',
  description: 'Prepare prospect previews and client-specific signup in an isolated local prototype.',
  handle: owner,
  hooks: ['invitation', 'activate', 'progress', 'login', 'logout', 'workspace', 'feedback', 'payment-demo'].map(path => ({path: `${root}/hooks/${path}`, handle: publicRoute})),
};
