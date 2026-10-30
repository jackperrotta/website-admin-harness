import {createServer} from 'node:net';
import {readFile,readdir} from 'node:fs/promises';
import {resolve, relative, extname, join} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import type {SchedulingConfig} from '../packages/contracts/src/scheduling.ts';
import type {AdminManifest} from '../packages/contracts/src/index.ts';
import {syntheticCalendarBindings, type CalendarProviderFixture} from './calendar-provider-fixture.ts';

/** Real local Worker/D1 and built UI. Accounts, records and sessions are synthetic. */
export async function createSchedulingBrowserFixture(options: {port?: number; migrationsThrough?: number; hostname?: string; websiteOrigin?: string; mail?: (message: unknown) => Promise<{messageId: string}>; challengeHttp?: (request: Request) => Promise<Response>; calendar?: CalendarProviderFixture; simulated?: boolean; bindings?: Record<string, string>; runtimeRoot?: string; modules?: string[]} = {}) {
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('No test port');
  const port = options.port ?? address.port; await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const runtimeRoot = resolve(options.runtimeRoot ?? 'packages/admin');
  const origin = `http://${options.hostname ?? '127.0.0.1'}:${port}`, root = join(runtimeRoot,'dist/client');
  const manifest: AdminManifest = {schemaVersion: 1, installationId: 'scheduling-browser', business: {name: 'Studio Test Business', initials: 'ST'}, site: {id: 'scheduling-browser', name: 'Synthetic website', origin: options.websiteOrigin ?? 'https://synthetic.example.test'}, adminOrigin: origin, modules: options.modules ?? ['scheduling']};
  const source = `import {createAdmin} from ${JSON.stringify(join(runtimeRoot,'dist/worker.js'))}; const app=createAdmin(${JSON.stringify(manifest)}); const withMail=env=>env.NOTIFICATION_TEST?{...env,SCHEDULING_EMAIL:{send:async message=>{const response=await env.NOTIFICATION_TEST.fetch('https://fixture.invalid/notification',{method:'POST',body:JSON.stringify(message)});if(!response.ok)throw new Error('Simulated send interrupted');return response.json();}}}:env; export default {fetch(request,env){env=withMail(env);if(new URL(request.url).pathname.startsWith('/__calendar-fixture')&&env.PROVIDER_PREVIEW)return env.PROVIDER_PREVIEW.fetch(request);return app.fetch(request,env);},scheduled(controller,env){return app.scheduled(controller,withMail(env));}};`;
  const bundle = await build({stdin: {contents: source, resolveDir: process.cwd()}, bundle: true, write: false, format: 'esm', platform: 'neutral'});
  const app = new Miniflare(convertV4MiniflareOptions({port, host: '127.0.0.1', workers: [{name: 'scheduling-browser', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01', d1Databases: {DB: 'scheduling-browser'}, bindings: {MODE: 'local', ...(options.calendar ? {...syntheticCalendarBindings, ...(options.simulated ? {CALENDAR_FIXTURE_MODE: '1'} : {})} : {}), ...options.bindings}, serviceBindings: {...(options.mail ? {NOTIFICATION_TEST: async (request: Request) => {try{return Response.json(await options.mail!(await request.json()));}catch{return new Response('Simulated interruption',{status:503});}}} : {}), ...(options.challengeHttp ? {BOOKING_CHALLENGE_HTTP: options.challengeHttp} : {}), ...(options.calendar ? {CALENDAR_HTTP: (request: Request) => options.calendar!.fetch(request), PROVIDER_PREVIEW: (request: Request) => options.calendar!.preview(request)} : {}), ASSETS: async request => {
    const path = new URL(request.url).pathname;
    const file = resolve(root, path === '/' ? 'index.html' : `.${path}`);
    if (relative(root, file).startsWith('..')) return new Response('Not found', {status: 404});
    try {return new Response(await readFile(file), {headers: {'content-type': ({'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'} as Record<string, string>)[extname(file)] ?? 'application/octet-stream'}});} catch {return new Response('Not found', {status: 404});}
  }}}]}));
  await app.ready;
  const db = await app.getD1Database('DB', 'scheduling-browser');
  const migrations=(await readdir(join(runtimeRoot,'migrations'))).filter(file=>/^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort();
  for (const file of migrations) {
    if (Number(file.slice(0,4)) > (options.migrationsThrough??8)) continue;
    const sql = await readFile(join(runtimeRoot,'migrations',file), 'utf8');
    const statements = /^000[45678]/.test(file) ? sql.split('-- statement-breakpoint').map(s => s.replace(/^--.*$/gm, '').trim()).filter(Boolean) : sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean);
    for (const statement of statements) await db.prepare(statement).run();
  }
  await db.prepare("INSERT INTO users(id,email,role) VALUES('owner','scheduling-owner@example.test','owner'),('provider-user','provider@example.test','editor'),('reader','reader@example.test','analyst')").run();
  const sessions = new Map<string, string>();
  for (const user of ['owner', 'provider-user', 'reader']) {
    const raw = `synthetic-browser-session-${user}`; sessions.set(user, raw);
    await db.prepare('INSERT INTO sessions(digest,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(raw).digest('hex'), user, Math.floor(Date.now() / 1000) + 7200).run();
  }
  return {app, db, origin, sessions,
    async reset(config: SchedulingConfig) {
      for (const table of ['scheduling_reminder_windows','notification_fences','notification_admin_commands','scheduling_expiry_guards','scheduling_system_history','customer_management_commands','customer_management_sessions','customer_access_tokens','scheduling_notification_outbox','booking_history','booking_commands','booking_rate_limits','calendar_activity','calendar_conflicts','calendar_export_jobs','calendar_event_links','calendar_busy_intervals','calendar_oauth_flows','calendar_connections','calendar_mutations','calendar_sync_fences','appointment_calendar_captures','scheduling_jobs', 'scheduling_history', 'scheduling_reservations', 'scheduling_appointments', 'scheduling_commands', 'scheduling_state', 'audit']) await db.prepare(`DELETE FROM ${table}`).run();
      await db.prepare('INSERT INTO scheduling_state(site_id,revision,config_json,updated_at) VALUES(?,0,?,?)').bind(manifest.site.id, JSON.stringify(config), Date.now()).run();
    },
    async config() {const row = await db.prepare('SELECT revision,config_json FROM scheduling_state WHERE site_id=?').bind(manifest.site.id).first<{revision: number; config_json: string}>(); if (!row) throw new Error('Missing fixture state'); return {revision: row.revision, config: JSON.parse(row.config_json) as SchedulingConfig};},
    async ownerPost(path: string, data: unknown) {return app.dispatchFetch(`${origin}/api/modules/scheduling${path}`, {method: 'POST', headers: {origin, cookie: `vitris-admin-local=${sessions.get('owner')}`, 'content-type': 'application/json'}, body: JSON.stringify(data)});},
  };
}
