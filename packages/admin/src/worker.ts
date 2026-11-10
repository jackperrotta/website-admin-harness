import {SignOnService,validateWebmasterSignOn,type SignOnEnv} from './signon/service.ts';
import {signOnBase} from '../../contracts/src/signon.ts';
import {webmasterModule,webmasterUser,webmasterRoute,webmasterSchema,resolveTeam,WebmasterError} from './webmaster.ts';
import {PairingIssuer} from './pairing/issuer.ts';
import {PairingError,pairingBase} from './pairing/protocol.ts';
import {AccountService,AccountError,type AccountEnv} from './accounts.ts';
import {LeadError, listLeads, saveFollowUp, followUpInput, followUpsAvailable} from './leads.ts';
import {NotificationService} from './scheduling/notifications.ts';
import {PublicBooking} from './scheduling/public.ts';
import type {BookingEnv} from './scheduling/booking-env.ts';
import {passwordReady, verifyPassword} from './password.ts';
import {parseManifest, validateModules, workQueueModule, userCan, isLoopback, type AdminManifest, type User, type BootstrapResponse, type LeadsResponse, type LeadRow, type AnalyticsResponse, type AnalyticsRow, type SettingsResponse, type RowsResponse, type AccessRow, type ActivityRow, type TaskRow, type Permission} from '../../contracts/src/index.ts';
import {harnessRequest,HarnessError,type HarnessEnv} from './harness.ts';
import {schedulingModule, handleScheduling, hasSchedulingAccess} from './scheduling/module.ts';
import {SchedulingError} from './scheduling/store.ts';
import {CalendarService} from './scheduling/calendars/service.ts';
import {CalendarError, type CalendarEnv} from './scheduling/calendars/types.ts';
import {SearchConsoleService} from './search-console/service.ts';
import {searchWindow} from './search-console/query.ts';
import {SearchConsoleError,type SearchConsoleEnv} from './search-console/types.ts';

interface EmailBinding {send(message: {to: string; from: string; subject: string; text: string}): Promise<unknown>}
export interface AdminEnv extends HarnessEnv, CalendarEnv, BookingEnv, AccountEnv, SignOnEnv, SearchConsoleEnv {
  WEBMASTER_PAIRING_KEY?:string;WEBMASTER_PAIRING_HTTP?:Pick<Fetcher,'fetch'>;WEBMASTER_PAIRING_FIXTURE_MODE?:string;
  DB: D1Database; ASSETS: Pick<Fetcher, 'fetch'>; ASSET_STORE?: R2Bucket;
  MODE?: string; PASSWORD_LOGIN?: string; PASSWORD_PEPPER?: string; AUTH_EMAIL?: EmailBinding; AUTH_FROM?: string;
}
export interface ModuleContext {request: Request; env: AdminEnv; manifest: AdminManifest; user: User; require: (permission: Permission) => void; audit: (action: string) => Promise<unknown>}
export interface ModuleServiceContext {request:Request;env:AdminEnv;manifest:AdminManifest;context?:ExecutionContext}
export interface AdminModule {id: string; version: number; label: string; permission: Permission; description: string; ui?:'stripe-billing'|'stripe-account'|'email-campaigns'; disableLocalDemo?: true; handle: (context: ModuleContext) => Promise<Response>; hooks?:readonly {path:string;handle:(context:ModuleServiceContext)=>Promise<Response>}[]; publicRoutes?:readonly {path:string;methods:readonly string[];retainWhenDisabled?:true;handle:(context:ModuleServiceContext)=>Promise<Response>}[]; queue?:{name:string;retainWhenDisabled?:true;handle:(batch:MessageBatch<unknown>,env:AdminEnv,manifest:AdminManifest)=>Promise<void>}; maintenance?:(env:AdminEnv,manifest:AdminManifest)=>Promise<void>; scheduled?:(env:AdminEnv,manifest:AdminManifest)=>Promise<void>}
const now = () => Math.floor(Date.now() / 1000);
const cookieName = '__Host-vitris-admin';
async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), x => x.toString(16).padStart(2, '0')).join('');
}
function token() {return crypto.randomUUID() + crypto.randomUUID();}
function json<T>(value: T, status = 200, headers: HeadersInit = {}) {return new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json', ...headers}});}
class HttpError extends Error {constructor(public status: number, message: string) {super(message);}}
async function body(request: Request, maximum=8192) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'JSON is required');
  const reader = request.body?.getReader(); let length = 0; const parts: Uint8Array[] = [];
  if (!reader) throw new HttpError(400, 'Request body is required');
  for (;;) {const {done, value} = await reader.read(); if (done) break; length += value.length; if (length > maximum) {await reader.cancel(); throw new HttpError(413, 'Request too large');} parts.push(value);}
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) {bytes.set(part, offset); offset += part.length;}
  try {const value: unknown = JSON.parse(new TextDecoder().decode(bytes)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>;} catch {throw new HttpError(400, 'Invalid JSON object');}
}
function permission(user: User, value: Permission) {if (!userCan(user, value)) throw new HttpError(403, 'Your account does not have access to this action');}
async function audit(env: AdminEnv, actor: string|User, action: string, manifest?:AdminManifest) {
  const id=crypto.randomUUID(),statement=env.DB.prepare('INSERT INTO audit(id,actor,action) VALUES(?,?,?)').bind(id,typeof actor==='string'?actor:actor.email,action);
  if(typeof actor!=='string'&&manifest&&await webmasterSchema(env.DB))return env.DB.batch([statement,env.DB.prepare('INSERT INTO webmaster_activity(audit_id,installation_id,site_id,admin_origin,person_id,organization_id,organization_name) VALUES(?,?,?,?,?,?,?)').bind(id,manifest.installationId,manifest.site.id,manifest.adminOrigin,actor.id,actor.webmaster?.organizationId||null,actor.webmaster?.organizationName||null)]);
  return statement.run();
}
function local(manifest: AdminManifest, env: AdminEnv) {return env.MODE === 'local' && isLoopback(manifest.adminOrigin) && new URL(manifest.adminOrigin).protocol === 'http:';}
function sessionCookie(raw: string, manifest: AdminManifest, clear = false) {
  const insecure = isLoopback(manifest.adminOrigin) && new URL(manifest.adminOrigin).protocol === 'http:';
  return `${insecure ? 'vitris-admin-local' : cookieName}=${raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 604800}${insecure ? '' : '; Secure'}`;
}
async function session(env: AdminEnv, request: Request, manifest: AdminManifest): Promise<User | null> {
  const name = isLoopback(manifest.adminOrigin) && new URL(manifest.adminOrigin).protocol === 'http:' ? 'vitris-admin-local' : cookieName;
  const raw = request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!raw || raw.length > 200) return null;
  const user=await env.DB.prepare('SELECT u.id,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.digest=? AND s.expires_at>? AND u.active=1').bind(await digest(raw), now()).first<User>();
  if(!user)return null;const resolved=await webmasterUser(env.DB,manifest,user);return resolved&&await validateWebmasterSignOn(env,manifest,await digest(raw),resolved)?resolved:null;
}
async function startSession(env: AdminEnv, userId: string, manifest: AdminManifest, revision?: number) {
  const identity=await env.DB.prepare('SELECT id,email,role FROM users WHERE id=? AND active=1').bind(userId).first<User>();
  const resolved=identity?await webmasterUser(env.DB,manifest,identity):null;
  if(!resolved)throw new HttpError(401,'Management access has been revoked');
  const fence=resolved.webmaster?' AND EXISTS(SELECT 1 FROM webmaster_members m JOIN webmaster_connections c USING(installation_id,site_id,admin_origin) WHERE m.installation_id=? AND m.site_id=? AND m.admin_origin=? AND m.user_id=? AND m.active=1 AND c.status=\'connected\' AND c.revision=?)':'';
  const fenceArgs=resolved.webmaster?[manifest.installationId,manifest.site.id,manifest.adminOrigin,userId,resolved.webmaster.revision]:[];
  const raw = token();
  if(revision!==undefined){
    const inserted=await env.DB.prepare('INSERT INTO sessions(digest,user_id,expires_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND active=1) AND COALESCE((SELECT revision FROM auth_profiles WHERE installation_id=? AND admin_origin=? AND user_id=?),0)=?'+fence).bind(await digest(raw),userId,now()+604800,userId,manifest.installationId,manifest.adminOrigin,userId,revision,...fenceArgs).run();
    if(!inserted.meta.changes)throw new HttpError(401,'Your account changed. Sign in again.');
  }else{
    const inserted=await env.DB.prepare('INSERT INTO sessions(digest,user_id,expires_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND active=1)'+fence).bind(await digest(raw),userId,now()+604800,userId,...fenceArgs).run();
    if(!inserted.meta.changes)throw new HttpError(401,'Your account changed. Sign in again.');
  }
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
  const modules = [workQueueModule, schedulingModule, webmasterModule, {id:'search-console',version:1,label:'Google Search Console',permission:'analytics:read' as const,description:'Google search performance and indexing connection'}, ...(options.modules || [])]; validateModules(manifest, modules);
  const hooks=(options.modules||[]).flatMap(module=>(module.hooks||[]).map(hook=>({...hook,moduleId:module.id})));
  if(hooks.some(h=>!new RegExp(`^/api/modules/${h.moduleId}/hooks/[a-z][a-z0-9-]*$`).test(h.path))||new Set(hooks.map(h=>h.path)).size!==hooks.length)throw new Error('Module hooks need unique exact paths within their own hooks namespace');
  const publicRoutes=(options.modules||[]).flatMap(module=>(module.publicRoutes||[]).map(route=>({...route,moduleId:module.id})));
  if(publicRoutes.some(r=>!new RegExp(`^/api/modules/${r.moduleId}/public/[a-z][a-z0-9-]*$`).test(r.path)||!r.methods.length||r.methods.some(m=>!['GET','POST','OPTIONS'].includes(m)))||new Set(publicRoutes.map(r=>r.path)).size!==publicRoutes.length)throw new Error('Public module routes need unique exact paths and explicit methods.');
  const queues=(options.modules||[]).filter(m=>m.queue);
  if(queues.some(m=>!/^[a-z][a-z0-9-]{0,62}$/.test(m.queue!.name))||new Set(queues.map(m=>m.queue!.name)).size!==queues.length)throw new Error('Module queues need unique exact queue names.');
  return {async fetch(request: Request, env: AdminEnv, context?: ExecutionContext): Promise<Response> {
    let response: Response;
    try {
      const url = new URL(request.url); const path = url.pathname;
      if (url.origin !== manifest.adminOrigin) throw new HttpError(421, 'This hostname is not configured for this installation');
      if (isLoopback(manifest.adminOrigin) && !local(manifest, env)) throw new HttpError(503, 'Local installation requires explicit local mode');
      const bookingRoute = path.startsWith('/api/booking/v1/');
      const hook=hooks.find(h=>h.path===path);
      const publicRoute=publicRoutes.find(r=>r.path===path);
      const signOnRoute=path.startsWith(signOnBase+'/'),signOnMachine=['register','exchange','introspect'].some(action=>path===signOnBase+'/'+action);
      const pairingRoute=path.startsWith(pairingBase+'/'),pairingMachine=['request','poll','exchange','report','rotate','revoke'].some(action=>path===pairingBase+'/'+action);
      if (!bookingRoute && !hook && !publicRoute && !pairingMachine && !signOnMachine && !['GET','HEAD'].includes(request.method) && request.headers.get('origin') !== manifest.adminOrigin) throw new HttpError(403, 'Origin check failed');
      const calendarCallback = path.match(/^\/api\/scheduling\/oauth\/(google|microsoft)\/callback$/);
      if(path==='/api/search-console/oauth/callback'&&request.method==='GET'){
        if(!manifest.modules.includes('search-console'))throw new HttpError(404,'Search Console is disabled');
        response=await new SearchConsoleService(env,manifest).complete(request);
      }
      else if(publicRoute){if(!manifest.modules.includes(publicRoute.moduleId)&&!publicRoute.retainWhenDisabled)throw new HttpError(404,'Module is disabled');if(!publicRoute.methods.includes(request.method))throw new HttpError(405,'Method not allowed');response=await publicRoute.handle({request,env,manifest,context});}
      else if(signOnRoute)response=await new SignOnService(env,manifest).handle(request,signOnMachine?null:await session(env,request,manifest));
      else if(pairingRoute)response=await new PairingIssuer(env,manifest).handle(request,pairingMachine?null:await session(env,request,manifest));
      else if(hook){if(!manifest.modules.includes(hook.moduleId))throw new HttpError(404,'Module is disabled');if(request.method!=='POST')throw new HttpError(405,'Method not allowed');response=await hook.handle({request,env,manifest,context});}
      else if (bookingRoute) response = await new PublicBooking(env, manifest).handle(request);
      else if (calendarCallback && request.method === 'GET') {
        if (!manifest.modules.includes('scheduling')) throw new HttpError(404,'Module is disabled');
        response = await new CalendarService(env, manifest).complete(request, calendarCallback[1] as 'google' | 'microsoft');
      }
      else if (!path.startsWith('/api/')) response = await env.ASSETS.fetch(request);
      else response = await api(request, env, manifest, local(manifest, env) && !manifest.reportingPairing && !manifest.webmasterSignOn && !(options.modules || []).some(m => manifest.modules.includes(m.id) && m.disableLocalDemo), path, url, options.modules || []);
    } catch (error) {
      response = error instanceof SearchConsoleError || error instanceof PairingError || error instanceof WebmasterError || error instanceof LeadError || error instanceof AccountError || error instanceof HttpError || error instanceof HarnessError || error instanceof SchedulingError || error instanceof CalendarError ? json({error: error.message,...(error instanceof PairingError||error instanceof SearchConsoleError?{code:error.code}:{})}, error.status) : json({error: 'The admin service could not complete this request. Check its database and bindings.'}, 500);
    }
    if(context&&request.method==='POST'&&response.ok&&/^\/api\/(auth|access\/invitations)/.test(new URL(request.url).pathname))context.waitUntil(new AccountService(env,manifest).tick().catch(()=>{}));
    const headers = new Headers(response.headers);
    headers.set('cache-control', 'no-store'); headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'no-referrer'); headers.set('x-frame-options', 'DENY');
    headers.set('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const emailPreview = request.method === 'GET' && (/^\/api\/modules\/scheduling\/notifications\/[a-zA-Z0-9_-]+\/document$/.test(new URL(request.url).pathname)||['/api/modules/email-campaigns/preview','/api/modules/email-campaigns/capture-document'].includes(new URL(request.url).pathname)) && response.status === 200 && response.headers.get('content-type')?.startsWith('text/html');
    if (emailPreview) {
      headers.set('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-popups allow-popups-to-escape-sandbox");
      headers.set('x-frame-options','SAMEORIGIN');headers.set('x-robots-tag','noindex, noarchive');
    }
    if(publicRoutes.some(r=>r.path===new URL(request.url).pathname)&&response.headers.get('content-type')?.startsWith('text/html')){headers.set('content-security-policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");headers.set('x-robots-tag','noindex, noarchive');}
    return new Response(response.body, {status: response.status, headers});
  }, async scheduled(_controller: ScheduledController, env: AdminEnv) {
    const failures:unknown[]=[];const run=async(task:()=>Promise<unknown>)=>{try{await task();}catch(error){failures.push(error);}};
    await run(()=>new AccountService(env,manifest).tick());
    if (manifest.modules.includes('scheduling')) {await run(()=>new CalendarService(env, manifest).tick());await run(()=>new NotificationService(env, manifest).tick());}
    if (manifest.modules.includes('search-console')) await run(()=>new SearchConsoleService(env,manifest).tick());
    for(const module of options.modules||[]){if(manifest.modules.includes(module.id)&&module.scheduled)await run(()=>module.scheduled!(env,manifest));else if(!manifest.modules.includes(module.id)&&module.maintenance)await run(()=>module.maintenance!(env,manifest));}
    if(failures.length)throw new Error('One or more scheduled admin services failed; independent services were still processed.');
  },async queue(batch:MessageBatch<unknown>,env:AdminEnv){const module=queues.find(m=>m.queue!.name===batch.queue);if(!module||!manifest.modules.includes(module.id)&&!module.queue!.retainWhenDisabled)throw new Error('Queue is not registered for this installation.');await module.queue!.handle(batch,env,manifest);}};
}

async function api(request: Request, env: AdminEnv, manifest: AdminManifest, demo: boolean, path: string, url: URL, extensions: AdminModule[]): Promise<Response> {
  const method = request.method;
  const accounts=new AccountService(env,manifest);
  const enabled = [workQueueModule, schedulingModule, ...extensions.map(({id,version,label,permission,description,ui})=>({id,version,label,permission,description,...(ui?{ui}:{})}))].filter(x => manifest.modules.includes(x.id));
  if (path === '/api/bootstrap' && method === 'GET') {
    const user = await session(env, request, manifest);
    let theme=manifest.theme||null;
    let themeStatus:BootstrapResponse['themeStatus']=theme?'installation':'default';
    if(manifest.backend){try{const status=await harnessRequest(manifest,env,'status');if(status.theme){theme=status.theme;themeStatus='website';}else if(!theme)themeStatus='unavailable';}catch{if(!theme)themeStatus='unavailable';}}
    const schedulingAllowed = user && !user.webmaster && manifest.modules.includes('scheduling') ? await hasSchedulingAccess(env.DB, manifest.site.id, user) : false;
    return json<BootstrapResponse>({searchConsoleEnabled:manifest.modules.includes('search-console'),webmasterEnabled:manifest.modules.includes('webmaster'),manifest, theme, themeStatus, user, accountAuth:await accounts.capabilities(user), passwordLogin:passwordReady(env), emailLoginConfigured:!!env.AUTH_EMAIL && !!env.AUTH_FROM && !accounts.enabled, privateLocalSignIn:local(manifest,env) && !demo && !passwordReady(env) && !accounts.enabled && !env.AUTH_EMAIL, localDemo: demo && (!manifest.backend || isLoopback(manifest.backend.origin)), connected:!!manifest.backend, modules: enabled.filter(x => user && (x.id === 'scheduling' ? schedulingAllowed : userCan(user, x.permission))), capabilities: user ? ['leads','analytics','settings','access','activity'].filter(x => x==='settings'&&(manifest.modules.includes('webmaster')||manifest.modules.includes('search-console')&&userCan(user,'search-console:manage'))||userCan(user, ({leads:'leads:read',analytics:'analytics:read',settings:'settings:write',access:'access:read',activity:'activity:read'} as Record<string,Permission>)[x])) : []});
  }
  const publicAccount=await accounts.publicRoute(request,path);if(publicAccount)return publicAccount;
  if(accounts.enabled&&['/api/auth/request','/api/auth/confirm'].includes(path))throw new HttpError(404,'Not found');
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
    const revision=accounts.enabled?await accounts.credentialsRevision(user?.id||''):undefined;
    const valid=await verifyPassword(env,user?.id || '',data.password);
    if (!user || !valid) throw new HttpError(401,'Email or password is incorrect');
    // Membership is checked again when creating the session and on every request.
    const active=await env.DB.prepare('SELECT id FROM users WHERE id=? AND active=1').bind(user.id).first();
    if (!active) throw new HttpError(401,'Email or password is incorrect');
    const identity=await webmasterUser(env.DB,manifest,user);if(!identity)throw new HttpError(401,'Management access has been revoked');
    const response=await startSession(env,user.id,manifest,revision);
    await audit(env,identity,'Signed in with password',manifest);
    await env.DB.prepare('DELETE FROM auth_limits WHERE expires_at<?').bind(now()).run();
    return response;
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
    const active = await env.DB.prepare('SELECT id,email,role FROM users WHERE id=? AND active=1').bind(accepted.user_id).first<User>();
    if (!active) throw new HttpError(401,'Access has been revoked');
    const identity=await webmasterUser(env.DB,manifest,active);if(!identity)throw new HttpError(401,'Management access has been revoked');
    const response=await startSession(env,accepted.user_id,manifest);
    await audit(env,identity,'Signed in',manifest); return response;
  }
  const user = await session(env,request,manifest);
  if (!user) throw new HttpError(401,'Sign in to continue');
  const accountRoute=await accounts.access(request,path,user);if(accountRoute)return accountRoute;
  if (path === '/api/auth/logout' && method === 'POST') {
    // Deleting all sessions for this user makes logout definitive across devices.
    await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id).run();
    return json({ok:true},200,{'set-cookie':sessionCookie('',manifest,true)});
  }
  const site = manifest.site.id;
  if(path==='/api/search-console'||path.startsWith('/api/search-console/')){
    if(!manifest.modules.includes('search-console'))throw new HttpError(404,'Search Console is disabled');
    const service=new SearchConsoleService(env,manifest),action=path.slice('/api/search-console'.length);
    if(action==='/app'){
      if(user.role!=='owner'||user.webmaster)throw new HttpError(403,'Only the installation owner can configure the Google application');
      if(method==='GET')return json(await service.appSettings());
      if(method==='POST'){const result=await service.saveApp(await body(request));await audit(env,user,'Updated Google Search Console application',manifest);return json(result);}
      throw new HttpError(405,'Use GET or POST for Google application settings');
    }
    const managing=['/connect','/property','/disconnect','/sitemaps/submit'].includes(action);
    if(managing){permission(user,'search-console:manage');if(method!=='POST')throw new HttpError(405,'Use POST for connection changes');}
    else if(action==='/properties')permission(user,'search-console:manage');
    else if(!(action==='/status'&&userCan(user,'search-console:manage')))permission(user,'analytics:read');
    if(action==='/status'&&method==='GET')return json(await service.status());
    if(action==='/properties'&&method==='GET'){permission(user,'search-console:manage');return json(await service.properties());}
    if(action==='/report'&&(method==='GET'||method==='POST')){
      const query=method==='POST'?await body(request,32768):{...searchWindow(url.searchParams.get('days')==='14'?14:28),type:url.searchParams.get('type')||'web',dimensions:[url.searchParams.get('dimension')||'date'],startRow:Number(url.searchParams.get('startRow')||0)};
      return json(await service.report(query));
    }
    if(action==='/sitemaps'&&method==='GET')return json(await service.sitemaps());
    if(action==='/inspect'&&method==='POST')return json(await service.inspect((await body(request)).url));
    if(managing){
      const data=await body(request);
      if(action==='/connect'){if(data.manageSitemaps!==undefined&&typeof data.manageSitemaps!=='boolean')throw new HttpError(400,'Invalid sitemap management choice');return service.begin(user,data.manageSitemaps===true);}
      if(action!=='/sitemaps/submit'&&(!Number.isInteger(data.revision)||Number(data.revision)<0))throw new HttpError(400,'A valid connection revision is required');
      const result=action==='/property'?await service.select(data.property,data.revision):action==='/disconnect'?await service.disconnect(data.revision):await service.submitSitemap(data.url);
      await audit(env,user,action==='/property'?'Selected Google Search Console property':action==='/disconnect'?'Disconnected Google Search Console':'Submitted Google Search Console sitemap',manifest);
      return json(result);
    }
    throw new HttpError(404,'Search Console action not found');
  }
  if(path==='/api/modules/webmaster'||path.startsWith('/api/modules/webmaster/')){
    if(!manifest.modules.includes('webmaster'))throw new HttpError(404,'Module is disabled');
    return webmasterRoute(env.DB,manifest,user,request,method==='POST'?await body(request,32768):undefined);
  }
  if(path==='/api/connection'&&method==='GET'){
    if(!manifest.backend)return json({connected:false,message:'No website backend configured'});
    const status=await harnessRequest(manifest,env,'status');
    return json({connected:true,...status});
  }
  if (path === '/api/leads' && method === 'GET') {
    permission(user,'leads:read');
    if(manifest.backend){const result=await harnessRequest(manifest,env,'leads',{mode:url.searchParams.get('mode')==='test'?'test':'production',leadQuery:url.searchParams});return json({...result,writable:userCan(user,'leads:write')?result.writable:false});}
    if(url.searchParams.get('mode')==='test')return json<LeadsResponse>({rows:[],source:demo?'synthetic':'not-connected',mode:'test',writable:false,message:'No collecting website backend is connected to this local demo. Test submissions will appear after a harness connection is configured.'});
    const result = await listLeads(env.DB,site,manifest.installationId,url.searchParams,'site_id');
    return json({...result,writable:userCan(user,'leads:write'),source:demo?'synthetic':'not-connected', message:demo?'Synthetic records for this local installation.':'Website form ingestion is not connected yet.'});
  }
  if(path==='/api/leads/team'&&method==='GET'){
    permission(user,'leads:write');
    return json({rows:(await resolveTeam(env.DB,manifest)).filter(member=>userCan(member,'leads:write')).map(({id,email})=>({id,email}))});
  }
  if(path==='/api/leads/follow-up'&&method==='POST'){
    permission(user,'leads:write');const value=await body(request,16384),parsed=followUpInput(value);
    if(!manifest.backend&&!await followUpsAvailable(env.DB))throw new LeadError(503,'Lead follow-up requires the reviewed database migration');
    // Validate assignments against this installation's active, lead-capable team.
    // Existing inactive assignments may be retained while editing notes.
    if(parsed.followUp.assignedTo){
      const candidate=await env.DB.prepare('SELECT id,email,role FROM users WHERE id=? AND active=1').bind(parsed.followUp.assignedTo).first<User>();
      const member=candidate?await webmasterUser(env.DB,manifest,candidate):null;
      if(!member||!userCan(member,'leads:write')){
        let previous:string|null|undefined;
        if(manifest.backend){const rows=await harnessRequest(manifest,env,'leads',{leadQuery:new URLSearchParams({id:parsed.id})});previous=rows.rows.find(row=>row.id===parsed.id)?.followUp?.assignedTo;}
        else previous=(await env.DB.prepare('SELECT assigned_to FROM lead_followups WHERE tenant_id=? AND installation_id=? AND lead_id=?').bind(site,manifest.installationId,parsed.id).first<{assigned_to:string}>())?.assigned_to;
        if(previous!==parsed.followUp.assignedTo)throw new HttpError(400,'Choose an active teammate who can manage leads');
      }
    }
    const result=manifest.backend?await harnessRequest(manifest,env,'leads/follow-up',{body:value}):await saveFollowUp(env.DB,site,manifest.installationId,value,'site_id');
    await audit(env,user,'Updated lead follow-up',manifest);return json(result);
  }
  if (path === '/api/leads/status' && method === 'POST') {
    permission(user,'leads:write'); const data = await body(request);
    if (!['new','contacted','closed'].includes(String(data.status)) || typeof data.id !== 'string') throw new HttpError(400,'Invalid lead status');
    if(manifest.backend){const result=await harnessRequest(manifest,env,'leads/status',{body:{id:data.id,status:data.status}});await audit(env,user,'Changed website lead status',manifest);return json(result);}
    const updated = await env.DB.prepare('UPDATE leads SET status=? WHERE id=? AND site_id=? RETURNING id').bind(data.status,data.id,site).first();
    if (!updated) throw new HttpError(404,'Lead not found');
    await audit(env,user,'Changed a lead status',manifest); return json({ok:true});
  }
  if (path === '/api/analytics' && method === 'GET') {
    permission(user,'analytics:read'); const days = url.searchParams.get('days') === '30' ? 30 : 14;
    if(manifest.backend)return json(await harnessRequest(manifest,env,'analytics',{days}));
    const result = await env.DB.prepare("SELECT day,views,visitors,enquiries FROM analytics_daily WHERE site_id=? AND day>=date('now',?) ORDER BY day").bind(site,`-${days-1} days`).all<AnalyticsRow>();
    return json<AnalyticsResponse>({rows:result.results, source:demo?'synthetic':'not-connected', timezone:'UTC', days});
  }
  if (path === '/api/settings' && method === 'GET') {
    permission(user,'settings:write'); const stored = await env.DB.prepare('SELECT notification_email,revision FROM settings WHERE site_id=?').bind(site).first<SettingsResponse>();
    return json<SettingsResponse>(stored || {notification_email:'',revision:0});
  }
  if (path === '/api/settings' && method === 'POST') {
    permission(user,'settings:write'); const data = await body(request);
    if (typeof data.notification_email !== 'string' || data.notification_email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.notification_email)) throw new HttpError(400,'Enter a valid notification email');
    if (!Number.isInteger(data.revision) || Number(data.revision)<0) throw new HttpError(400,'A valid settings revision is required');
    await env.DB.prepare('INSERT OR IGNORE INTO settings(site_id) VALUES(?)').bind(site).run();
    const updated = await env.DB.prepare('UPDATE settings SET notification_email=?,revision=revision+1 WHERE site_id=? AND revision=? RETURNING revision').bind(data.notification_email,site,data.revision).first();
    if (!updated) throw new HttpError(409,'Settings changed in another session. Reload before saving.');
    await audit(env,user,'Updated notification preference (delivery integration pending)',manifest); return json({ok:true,...updated, deliveryConnected:false});
  }
  if (path === '/api/access' && method === 'GET') {
    permission(user,'access:read');
    if(accounts.enabled)return json(await accounts.list(user)); return json<RowsResponse<AccessRow>>({rows:(await env.DB.prepare('SELECT id,email,role,active FROM users ORDER BY email').all<AccessRow>()).results});
  }
  if (path === '/api/activity' && method === 'GET') {
    permission(user,'activity:read');
    const sql=await webmasterSchema(env.DB)?env.DB.prepare('SELECT a.*,w.person_id,w.organization_id,w.organization_name FROM audit a LEFT JOIN webmaster_activity w ON w.audit_id=a.id WHERE w.audit_id IS NULL OR (w.installation_id=? AND w.site_id=? AND w.admin_origin=?) ORDER BY a.created_at DESC,a.rowid DESC LIMIT 100').bind(manifest.installationId,site,manifest.adminOrigin):env.DB.prepare('SELECT * FROM audit ORDER BY created_at DESC,rowid DESC LIMIT 100');
    return json<RowsResponse<ActivityRow>>({rows:(await sql.all<ActivityRow>()).results});
  }
  if (path.startsWith('/api/modules/work-queue')) {
    if (!manifest.modules.includes('work-queue')) throw new HttpError(404,'Module is disabled');
    if (path === '/api/modules/work-queue' && method === 'GET') {
      permission(user,'tasks:read'); return json<RowsResponse<TaskRow>>({rows:(await env.DB.prepare('SELECT * FROM tasks WHERE site_id=? ORDER BY created_at,id').bind(site).all<TaskRow>()).results});
    }
    if (path === '/api/modules/work-queue' && method === 'POST') {
      permission(user,'tasks:write'); const data = await body(request);
      if (typeof data.title !== 'string' || !data.title.trim() || data.title.length > 180) throw new HttpError(400,'Enter a task with 1–180 characters');
      await env.DB.prepare('INSERT INTO tasks(id,site_id,title) VALUES(?,?,?)').bind(crypto.randomUUID(),site,data.title.trim()).run();
      await audit(env,user,'Added a work queue task',manifest); return json({ok:true},201);
    }
    if (path === '/api/modules/work-queue/status' && method === 'POST') {
      permission(user,'tasks:write'); const data = await body(request);
      if (typeof data.id !== 'string' || typeof data.done !== 'boolean') throw new HttpError(400,'Invalid task');
      const updated = await env.DB.prepare('UPDATE tasks SET done=? WHERE id=? AND site_id=? RETURNING id').bind(data.done?1:0,data.id,site).first();
      if (!updated) throw new HttpError(404,'Task not found');
      await audit(env,user,'Updated a work queue task',manifest); return json({ok:true});
    }
  }
  if (path === '/api/modules/scheduling' || path.startsWith('/api/modules/scheduling/')) {
    if (!manifest.modules.includes('scheduling')) throw new HttpError(404,'Module is disabled');
    if(user.webmaster)throw new HttpError(403,'Scheduling requires a separate reviewed permission model');
    return handleScheduling({request,env,manifest,user,require:p=>permission(user,p),audit:action=>audit(env,user,action,manifest)});
  }
  for (const extension of extensions) {
    if (path === `/api/modules/${extension.id}` || path.startsWith(`/api/modules/${extension.id}/`)) {
      if (!manifest.modules.includes(extension.id)) throw new HttpError(404,'Module is disabled');
      permission(user,extension.permission);
      return extension.handle({request,env,manifest,user,require:p=>permission(user,p),audit:action=>audit(env,user,action,manifest)});
    }
  }
  throw new HttpError(404,'Not found');
}
