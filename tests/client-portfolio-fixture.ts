import {createServer} from 'node:net';
import {createHash, randomBytes} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {resolve, join, relative, extname} from 'node:path';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import type {AdminManifest, PortfolioState} from '../packages/contracts/src/index.ts';

export async function createPortfolioFixture(options: {port?: number; enabled?: boolean; onboarding?: boolean; persistencePath?: string; onboardingPepper?: string; applyTemplatesMigration?: boolean; mode?: string; adminOrigin?: string; runtimeRoot?: string; backend?: AdminManifest['backend']; applyModuleMigration?: boolean; live?: {catalog: PortfolioState; analytics: (request: Request) => Promise<Response>}} = {}) {
  const reservation = createServer(); await new Promise<void>(done => reservation.listen(0, '127.0.0.1', done));
  const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('No preview port');
  const port = options.port ?? address.port; await new Promise<void>((done, reject) => reservation.close(e => e ? reject(e) : done()));
  const origin = options.adminOrigin ?? `http://127.0.0.1:${port}`, runtime = resolve(options.runtimeRoot ?? 'packages/admin'), assets = join(runtime, 'dist/client');
  const manifest: AdminManifest = {schemaVersion: 1, installationId: 'vitris-prototype', business: {name: 'Vitris', initials: 'V'}, site: {id: 'vitris-prototype', name: 'Vitris studio', origin: 'https://studio.example.test'}, adminOrigin: origin, modules: options.enabled === false ? [] : ['client-portfolio', ...(options.onboarding ? ['client-onboarding'] : [])], ...(options.backend ? {backend: options.backend} : {})};
  const source = `import {createAdmin} from ${JSON.stringify(join(runtime, 'dist/worker.js'))}; import {clientPortfolioPrototype,createLiveClientPortfolio} from ${JSON.stringify(join(runtime, 'dist/client-portfolio.js'))}; ${options.onboarding ? `import {clientOnboardingPrototype} from ${JSON.stringify(join(runtime, 'dist/client-onboarding.js'))};` : ''} export default createAdmin(${JSON.stringify(manifest)}, {modules:[${options.live ? `createLiveClientPortfolio(${JSON.stringify(options.live.catalog)})` : 'clientPortfolioPrototype'}${options.onboarding ? ',clientOnboardingPrototype' : ''}]});`;
  const bundle = await build({stdin: {contents: source, resolveDir: process.cwd()}, bundle: true, write: false, format: 'esm', platform: 'neutral'});
  const app = new Miniflare(convertV4MiniflareOptions({port, host: '127.0.0.1', ...(options.persistencePath ? {resourcePersistencePath:resolve(options.persistencePath)} : {}), workers: [{name: 'portfolio', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01', d1Databases: {DB: 'portfolio'}, bindings: {MODE: options.mode ?? 'local', ...(options.onboarding ? {CLIENT_ONBOARDING_PEPPER: options.onboardingPepper || randomBytes(32).toString('hex')} : {})}, serviceBindings: {...(options.live ? {PORTFOLIO_ANALYTICS: options.live.analytics} : {}), ASSETS: async request => {
    const url = new URL(request.url), file = resolve(assets, ['/', '/auth', '/prospect', '/prospect/activate'].includes(url.pathname) ? 'index.html' : `.${url.pathname}`);
    if (relative(assets, file).startsWith('..')) return new Response('Not found', {status: 404});
    try {return new Response(await readFile(file), {headers: {'content-type': ({'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'} as Record<string, string>)[extname(file)] ?? 'application/octet-stream'}});} catch {return new Response('Not found', {status: 404});}
  }}}]}));
  try {
    await app.ready; const db = await app.getD1Database('DB', 'portfolio');
    await db.prepare('CREATE TABLE IF NOT EXISTS local_preview_migrations(name TEXT PRIMARY KEY)').run();
    const migrate=async (name:string,path:string)=>{
      if (await db.prepare('SELECT name FROM local_preview_migrations WHERE name=?').bind(name).first()) return;
      const sql=await readFile(path,'utf8');
      await db.batch([...sql.replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)),db.prepare('INSERT INTO local_preview_migrations(name) VALUES(?)').bind(name)]);
    };
    // Prototype needs the existing auth/audit schema only; optional scheduling is disabled.
    for (const file of (await readdir(join(runtime, 'migrations'))).filter(f => /^000[123]_/.test(f)).sort()) {
      await migrate(file,join(runtime,'migrations',file));
    }
    if (options.applyModuleMigration !== false) {
      await migrate('portfolio-0009',join(runtime,'prototypes/client-portfolio/migrations/0009_client_portfolio_prototype.sql'));
    }
    if (options.onboarding && options.applyModuleMigration !== false) {
      await migrate('onboarding-0010',join(runtime,'prototypes/client-onboarding/migrations/0010_client_onboarding_prototype.sql'));
      if (options.applyTemplatesMigration !== false) await migrate('onboarding-0011',join(runtime,'prototypes/client-onboarding/migrations/0011_onboarding_templates.sql'));
    }
    const cookies: Record<string, string> = {};
    for (const role of (options.live ? [] : ['owner', 'analyst', 'administrator']) as ('owner' | 'analyst' | 'administrator')[]) {
      const raw = `synthetic-portfolio-${role}`;
      await db.prepare('INSERT OR IGNORE INTO users(id,email,role) VALUES(?,?,?)').bind(role, `portfolio-${role}@example.test`, role).run();
      await db.prepare('INSERT OR REPLACE INTO sessions(digest,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(raw).digest('hex'), role, Math.floor(Date.now() / 1000) + 7200).run();
      cookies[role] = `${new URL(origin).protocol === 'http:' ? 'vitris-admin-local' : '__Host-vitris-admin'}=${raw}`;
    }
    const request = (path = '', data?: unknown, role = 'owner', extra: Record<string, string> = {}) => app.dispatchFetch(`${origin}/api/modules/client-portfolio${path}`, {method: data === undefined ? 'GET' : 'POST', headers: {cookie: cookies[role] || '', ...(data === undefined ? {} : {origin, 'content-type': 'application/json'}), ...extra}, ...(data === undefined ? {} : {body: JSON.stringify(data)})});
    return {app, db, origin, cookies, manifest, request};
  } catch (e) {await app.dispose(); throw e;}
}
