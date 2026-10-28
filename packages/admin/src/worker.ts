import {passwordReady, verifyPassword} from './password.ts';
import {parseManifest, validateModules, workQueueModule, can, isLoopback, type AdminManifest, type Role, type Permission} from '../../contracts/src/index.ts';
import {harnessRequest,HarnessError,type HarnessEnv} from './harness.ts';

interface EmailBinding {send(message: {to: string; from: string; subject: string; text: string}): Promise<unknown>}
export interface AdminEnv extends HarnessEnv {
  DB: D1Database; ASSETS: Fetcher; ASSET_STORE?: R2Bucket;
  MODE?: string; PASSWORD_LOGIN?: string; PASSWORD_PEPPER?: string; AUTH_EMAIL?: EmailBinding; AUTH_FROM?: string;
}
type User = {id: string; email: string; role: Role};
export interface ModuleContext {request: Request; env: AdminEnv; manifest: AdminManifest; user: User; require: (permission: Permission) => void; audit: (action: string) => Promise<unknown>}
export interface AdminModule {id: string; version: number; label: string; permission: Permission; description: string; handle: (context: ModuleContext) => Promise<Response>}
const now = () => Math.floor(Date.now() / 1000);
const cookieName = '__Host-vitris-admin';
async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), x => x.toString(16).padStart(2, '0')).join('');
}
function token() {return crypto.randomUUID() + crypto.randomUUID();}
function json(value: unknown, status = 200, headers: HeadersInit = {}) {return new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json', ...headers}});}
class HttpError extends Error {constructor(public status: number, message: string) {super(message);}}
async function body(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'JSON is required');
  const reader = request.body?.getReader(); let length = 0; const parts: Uint8Array[] = [];
  if (!reader) throw new HttpError(400, 'Request body is required');
  for (;;) {const {done, value} = await reader.read(); if (done) break; length += value.length; if (length > 8192) {await reader.cancel(); throw new HttpError(413, 'Request too large');} parts.push(value);}
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) {bytes.set(part, offset); offset += part.length;}
  try {const value = JSON.parse(new TextDecoder().decode(bytes)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>;} catch {throw new HttpError(400, 'Invalid JSON object');}
}
function permission(user: User, value: Permission) {if (!can(user.role, value)) throw new HttpError(403, 'Your account does not have access to this action');}
async function audit(env: AdminEnv, actor: string, action: string) {return env.DB.prepare('INSERT INTO audit(id,actor,action) VALUES(?,?,?)').bind(crypto.randomUUID(), actor, action).run();}
function local(manifest: AdminManifest, env: AdminEnv) {return env.MODE === 'local' && isLoopback(manifest.adminOrigin) && new URL(manifest.adminOrigin).protocol === 'http:';}
function sessionCookie(raw: string, manifest: AdminManifest, clear = false) {
  const insecure = isLoopback(manifest.adminOrigin) && new URL(manifest.adminOrigin).protocol === 'http:';
  return `${insecure ? 'vitris-admin-local' : cookieName}=${raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 604800}${insecure ? '' : '; Secure'}`;
}
async function session(env: AdminEnv, request: Request, manifest: AdminManifest): Promise<User | null> {
  const name = isLoopback(manifest.adminOrigin) && new URL(manifest.adminOrigin).protocol === 'http:' ? 'vitris-admin-local' : cookieName;
  const raw = request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!raw || raw.length > 200) return null;
  return env.DB.prepare('SELECT u.id,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.digest=? AND s.expires_at>? AND u.active=1').bind(await digest(raw), now()).first<User>();
}
async function startSession(env: AdminEnv, userId: string, manifest: AdminManifest) {
  const raw = token();
  await env.DB.prepare('INSERT INTO sessions(digest,user_id,expires_at) VALUES(?,?,?)').bind(await digest(raw), userId, now() + 604800).run();
  return json({ok: true}, 200, {'set-cookie': sessionCookie(raw, manifest)});
}
async function seedDemo(env: AdminEnv, manifest: AdminManifest) {
  const site = manifest.site.id;
  const statements = [
    env.DB.prepare("INSERT OR IGNORE INTO users(id,email,role) VALUES('local-owner','owner@example.test','owner')"),
    env.DB.prepare('INSERT OR IGNORE INTO settings(site_id) VALUES(?)').bind(site),
    ...[['demo-lead-1','Alex Morgan','alex@example.test','We are planning a kitchen renovation and would love to discuss the project.','new','Contact form'],['demo-lead-2','Jamie Chen','jamie@example.test','Could you share your availability for a consultation next month?','contacted','Project enquiry'],['demo-lead-3','Sam Rivera','sam@example.test','Interested in learning more about your services.','closed','Contact form']].map(row => env.DB.prepare('INSERT OR IGNORE INTO leads(id,site_id,name,email,message,status,source) VALUES(?,?,?,?,?,?,?)').bind(row[0],site,...row.slice(1))),
    ...Array.from({length: 14}, (_, i) => env.DB.prepare('INSERT OR IGNORE INTO analytics_daily(site_id,day,views,visitors,enquiries) VALUES(?,?,?,?,?)').bind(site, new Date(Date.now() - (13-i)*86400000).toISOString().slice(0,10), 38 + ((i*19)%65), 22 + ((i*13)%38), i%4 === 0 ? 1 : 0)),
    env.DB.prepare("INSERT OR IGNORE INTO tasks(id,site_id,title) VALUES('demo-task-1',?,'Follow up on the kitchen renovation enquiry')").bind(site),
    env.DB.prepare("INSERT OR IGNORE INTO tasks(id,site_id,title) VALUES('demo-task-2',?,'Review next month’s consultation availability')").bind(site),
  ];
  await env.DB.batch(statements);
}

export function createAdmin(input: unknown, options: {modules?: AdminModule[]} = {}) {
  const manifest = parseManifest(input);
  const modules = [workQueueModule, ...(options.modules || [])]; validateModules(manifest, modules);
  return {async fetch(request: Request, env: AdminEnv): Promise<Response> {
    let response: Response;
    try {
      const url = new URL(request.url); const path = url.pathname;
      if (url.origin !== manifest.adminOrigin) throw new HttpError(421, 'This hostname is not configured for this installation');
      if (isLoopback(manifest.adminOrigin) && !local(manifest, env)) throw new HttpError(503, 'Local installation requires explicit local mode');
      if (!['GET','HEAD'].includes(request.method) && request.headers.get('origin') !== manifest.adminOrigin) throw new HttpError(403, 'Origin check failed');
      if (!path.startsWith('/api/')) response = await env.ASSETS.fetch(request);
      else response = await api(request, env, manifest, local(manifest, env), path, url, options.modules || []);
    } catch (error) {
      response = error instanceof HttpError || error instanceof HarnessError ? json({error: error.message}, error.status) : json({error: 'The admin service could not complete this request. Check its database and bindings.'}, 500);
    }
    const headers = new Headers(response.headers);
    headers.set('cache-control', 'no-store'); headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'no-referrer'); headers.set('x-frame-options', 'DENY');
    headers.set('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    return new Response(response.body, {status: response.status, headers});
  }};
}

async function api(request: Request, env: AdminEnv, manifest: AdminManifest, demo: boolean, path: string, url: URL, extensions: AdminModule[]): Promise<Response> {
  const method = request.method;
  const enabled = [workQueueModule, ...extensions.map(({handle,...definition})=>definition)].filter(x => manifest.modules.includes(x.id));
  if (path === '/api/bootstrap' && method === 'GET') {
    const user = await session(env, request, manifest);
    return json({manifest, user, passwordLogin:passwordReady(env), localDemo: demo && (!manifest.backend || isLoopback(manifest.backend.origin)), connected:!!manifest.backend, modules: enabled.filter(x => user && can(user.role, x.permission)), capabilities: user ? ['leads','analytics','settings','access','activity'].filter(x => can(user.role, ({leads:'leads:read',analytics:'analytics:read',settings:'settings:write',access:'access:read',activity:'activity:read'} as Record<string,Permission>)[x])) : []});
  }
  if (path === '/api/auth/demo' && method === 'POST') {
    if (!demo || manifest.backend && !isLoopback(manifest.backend.origin)) throw new HttpError(404, 'Not found');
    await seedDemo(env, manifest); return startSession(env, 'local-owner', manifest);
  }
  if (path === '/api/auth/password' && method === 'POST') {
    if (!passwordReady(env)) throw new HttpError(503, 'Password sign-in is not configured');
    const data=await body(request);
    const email=typeof data.email==='string'?data.email.trim().toLowerCase():'';
    const source=request.headers.get('cf-connecting-ip') || 'local';
    for (const key of [`email:${email.slice(0,254)}`,`source:${source}`]) {
      const row=await env.DB.prepare('INSERT INTO auth_limits(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(await digest(`${manifest.installationId}:${Math.floor(now()/600)}:${key}`),now()+1200).first<{attempts:number}>();
      if (!row || row.attempts>8) throw new HttpError(429,'Too many sign-in attempts. Try again later.');
    }
    const user=await env.DB.prepare('SELECT id,email,role FROM users WHERE email=? AND active=1').bind(email.length<=254?email:'').first<User>();
    const valid=await verifyPassword(env,user?.id || '',data.password);
    if (!user || !valid) throw new HttpError(401,'Email or password is incorrect');
    // Membership is checked again when creating the session and on every request.
    const active=await env.DB.prepare('SELECT id FROM users WHERE id=? AND active=1').bind(user.id).first();
    if (!active) throw new HttpError(401,'Email or password is incorrect');
    await audit(env,user.id,'Signed in with password');
    await env.DB.prepare('DELETE FROM auth_limits WHERE expires_at<?').bind(now()).run();
    return startSession(env,user.id,manifest);
  }
  if (path === '/api/auth/request' && method === 'POST') {
    const data = await body(request);
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address');
    if (!env.AUTH_EMAIL || !env.AUTH_FROM) throw new HttpError(503, 'Sign-in email is not configured. Contact your website administrator.');
    // Limit by email and source without storing raw network addresses.
    const bucket = Math.floor(now()/600); const source = request.headers.get('cf-connecting-ip') || 'local';
    for (const key of [`email:${email}`, `source:${source}`]) {
      const row = await env.DB.prepare('INSERT INTO auth_limits(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(await digest(`${manifest.installationId}:${bucket}:${key}`), now()+1200).first<{attempts:number}>();
      if (!row || row.attempts > 8) throw new HttpError(429, 'Too many sign-in attempts. Try again later.');
    }
    const user = await env.DB.prepare('SELECT id FROM users WHERE email=? AND active=1').bind(email).first<{id:string}>();
    if (user) {
      const raw = token(); const hashed = await digest(raw);
      await env.DB.prepare('INSERT INTO login_tokens(digest,user_id,expires_at) VALUES(?,?,?)').bind(hashed,user.id,now()+900).run();
      try {await env.AUTH_EMAIL.send({to: email, from: env.AUTH_FROM, subject: `Sign in to ${manifest.business.name}`, text: `Sign in to your website admin. This link expires in 15 minutes and works once.\n\n${manifest.adminOrigin}/auth#token=${raw}\n\nIf you did not request this, ignore this email.`});}
      catch {await env.DB.prepare('DELETE FROM login_tokens WHERE digest=?').bind(hashed).run(); /* Neutral response, no token disclosure. */}
    }
    await env.DB.batch(['auth_limits','login_tokens','sessions'].map(table => env.DB.prepare(`DELETE FROM ${table} WHERE expires_at<?`).bind(now())));
    return json({ok:true, message:'If this email has access, a sign-in link will arrive shortly.'});
  }
  if (path === '/api/auth/confirm' && method === 'POST') {
    const data = await body(request);
    if (typeof data.token !== 'string' || data.token.length !== 72) throw new HttpError(400, 'Invalid sign-in link');
    const accepted = await env.DB.prepare('DELETE FROM login_tokens WHERE digest=? AND expires_at>? RETURNING user_id').bind(await digest(data.token), now()).first<{user_id:string}>();
    if (!accepted) throw new HttpError(401, 'This sign-in link has expired or was already used');
    const active = await env.DB.prepare('SELECT id FROM users WHERE id=? AND active=1').bind(accepted.user_id).first();
    if (!active) throw new HttpError(401,'Access has been revoked');
    await audit(env, accepted.user_id, 'Signed in'); return startSession(env, accepted.user_id, manifest);
  }
  const user = await session(env,request,manifest);
  if (!user) throw new HttpError(401,'Sign in to continue');
  if (path === '/api/auth/logout' && method === 'POST') {
    // Deleting all sessions for this user makes logout definitive across devices.
    await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id).run();
    return json({ok:true},200,{'set-cookie':sessionCookie('',manifest,true)});
  }
  const site = manifest.site.id;
  if(path==='/api/connection'&&method==='GET'){
    if(!manifest.backend)return json({connected:false,message:'No website backend configured'});
    const status=await harnessRequest(manifest,env,'status');
    return json({connected:true,...status});
  }
  if (path === '/api/leads' && method === 'GET') {
    permission(user,'leads:read');
    if(manifest.backend)return json(await harnessRequest(manifest,env,'leads',{mode:url.searchParams.get('mode')==='test'?'test':'production'}));
    if(url.searchParams.get('mode')==='test')return json({rows:[],source:demo?'synthetic':'not-connected',mode:'test',writable:false,message:'No collecting website backend is connected to this local demo. Test submissions will appear after a harness connection is configured.'});
    const result = await env.DB.prepare('SELECT * FROM leads WHERE site_id=? ORDER BY created_at DESC LIMIT 200').bind(site).all();
    return json({rows:result.results, source:demo?'synthetic':'not-connected', message:demo?'Synthetic records for this local installation.':'Website form ingestion is not connected yet.'});
  }
  if (path === '/api/leads/status' && method === 'POST') {
    permission(user,'leads:write'); const data = await body(request);
    if (!['new','contacted','closed'].includes(String(data.status)) || typeof data.id !== 'string') throw new HttpError(400,'Invalid lead status');
    if(manifest.backend){const result=await harnessRequest(manifest,env,'leads/status',{body:{id:data.id,status:data.status}});await audit(env,user.email,'Changed website lead status');return json(result);}
    const updated = await env.DB.prepare('UPDATE leads SET status=? WHERE id=? AND site_id=? RETURNING id').bind(data.status,data.id,site).first();
    if (!updated) throw new HttpError(404,'Lead not found');
    await audit(env,user.email,'Changed a lead status'); return json({ok:true});
  }
  if (path === '/api/analytics' && method === 'GET') {
    permission(user,'analytics:read'); const days = url.searchParams.get('days') === '30' ? 30 : 14;
    if(manifest.backend)return json(await harnessRequest(manifest,env,'analytics',{days}));
    const result = await env.DB.prepare("SELECT day,views,visitors,enquiries FROM analytics_daily WHERE site_id=? AND day>=date('now',?) ORDER BY day").bind(site,`-${days-1} days`).all();
    return json({rows:result.results, source:demo?'synthetic':'not-connected', timezone:'UTC', days});
  }
  if (path === '/api/settings' && method === 'GET') {
    permission(user,'settings:write'); const stored = await env.DB.prepare('SELECT notification_email,revision FROM settings WHERE site_id=?').bind(site).first();
    return json(stored || {notification_email:'',revision:0});
  }
  if (path === '/api/settings' && method === 'POST') {
    permission(user,'settings:write'); const data = await body(request);
    if (typeof data.notification_email !== 'string' || data.notification_email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.notification_email)) throw new HttpError(400,'Enter a valid notification email');
    if (!Number.isInteger(data.revision) || Number(data.revision)<0) throw new HttpError(400,'A valid settings revision is required');
    await env.DB.prepare('INSERT OR IGNORE INTO settings(site_id) VALUES(?)').bind(site).run();
    const updated = await env.DB.prepare('UPDATE settings SET notification_email=?,revision=revision+1 WHERE site_id=? AND revision=? RETURNING revision').bind(data.notification_email,site,data.revision).first();
    if (!updated) throw new HttpError(409,'Settings changed in another session. Reload before saving.');
    await audit(env,user.email,'Updated notification preference (delivery integration pending)'); return json({ok:true,...updated, deliveryConnected:false});
  }
  if (path === '/api/access' && method === 'GET') {
    permission(user,'access:read'); return json({rows:(await env.DB.prepare('SELECT id,email,role,active FROM users ORDER BY email').all()).results});
  }
  if (path === '/api/activity' && method === 'GET') {
    permission(user,'activity:read'); return json({rows:(await env.DB.prepare('SELECT * FROM audit ORDER BY created_at DESC,rowid DESC LIMIT 100').all()).results});
  }
  if (path.startsWith('/api/modules/work-queue')) {
    if (!manifest.modules.includes('work-queue')) throw new HttpError(404,'Module is disabled');
    if (path === '/api/modules/work-queue' && method === 'GET') {
      permission(user,'tasks:read'); return json({rows:(await env.DB.prepare('SELECT * FROM tasks WHERE site_id=? ORDER BY created_at,id').bind(site).all()).results});
    }
    if (path === '/api/modules/work-queue' && method === 'POST') {
      permission(user,'tasks:write'); const data = await body(request);
      if (typeof data.title !== 'string' || !data.title.trim() || data.title.length > 180) throw new HttpError(400,'Enter a task with 1–180 characters');
      await env.DB.prepare('INSERT INTO tasks(id,site_id,title) VALUES(?,?,?)').bind(crypto.randomUUID(),site,data.title.trim()).run();
      await audit(env,user.email,'Added a work queue task'); return json({ok:true},201);
    }
    if (path === '/api/modules/work-queue/status' && method === 'POST') {
      permission(user,'tasks:write'); const data = await body(request);
      if (typeof data.id !== 'string' || typeof data.done !== 'boolean') throw new HttpError(400,'Invalid task');
      const updated = await env.DB.prepare('UPDATE tasks SET done=? WHERE id=? AND site_id=? RETURNING id').bind(data.done?1:0,data.id,site).first();
      if (!updated) throw new HttpError(404,'Task not found');
      await audit(env,user.email,'Updated a work queue task'); return json({ok:true});
    }
  }
  for (const extension of extensions) {
    if (path === `/api/modules/${extension.id}` || path.startsWith(`/api/modules/${extension.id}/`)) {
      if (!manifest.modules.includes(extension.id)) throw new HttpError(404,'Module is disabled');
      permission(user,extension.permission);
      return extension.handle({request,env,manifest,user,require:p=>permission(user,p),audit:action=>audit(env,user.email,action)});
    }
  }
  throw new HttpError(404,'Not found');
}
