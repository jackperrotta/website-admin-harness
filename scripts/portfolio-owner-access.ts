import {createServer, createConnection} from 'node:net';
import {createHash, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {createPortfolioFixture} from '../tests/client-portfolio-fixture.ts';

type Preview = Pick<Awaited<ReturnType<typeof createPortfolioFixture>>, 'origin' | 'db' | 'manifest'>;
export interface OwnerLinks {url: string; qaUrl: string; expiresAt: string}
const controlName = 'portfolio-owner-control.json';
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

/** Operator-side access only: no HTTP listener, browser token endpoint, or production runtime import. */
export async function startPortfolioOwnerAccess(preview: Preview, directory = '.vitris') {
  const url = new URL(preview.origin);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || preview.manifest.adminOrigin !== preview.origin || preview.manifest.backend) throw Error('Owner access requires the isolated loopback preview.');
  await mkdir(directory, {recursive: true});
  await preview.db.prepare("INSERT OR IGNORE INTO users(id,email,role) VALUES('portfolio-owner','owner@localhost.test','owner')").run();
  const issue = async (): Promise<OwnerLinks> => {
    const owner = await preview.db.prepare("SELECT role,active FROM users WHERE id='portfolio-owner'").first<{role: string; active: number}>();
    if (owner?.role !== 'owner' || owner.active !== 1) throw Error('The local owner account is unavailable.');
    const raw = randomUUID() + randomUUID(), qa = randomUUID() + randomUUID(), expires = Math.floor(Date.now() / 1000) + 900;
    await preview.db.batch([
      preview.db.prepare("DELETE FROM login_tokens WHERE user_id='portfolio-owner' AND expires_at<=?").bind(Math.floor(Date.now() / 1000)),
      ...[raw, qa].map(t => preview.db.prepare("INSERT INTO login_tokens(digest,user_id,expires_at) VALUES(?,'portfolio-owner',?)").bind(sha(t), expires)),
    ]);
    const links: OwnerLinks = {url: `${preview.origin}/auth#token=${raw}&next=client-onboarding`, qaUrl: `${preview.origin}/auth#token=${qa}&next=client-onboarding`, expiresAt: new Date(expires * 1000).toISOString()};
    await writeFile(join(directory, 'portfolio-owner.json'), JSON.stringify(links), {mode: 0o600});
    return links;
  };
  const nonce = randomBytes(32).toString('hex');
  const path = process.platform === 'win32' ? ['', '', '.', 'pipe', `vitris-preview-${randomUUID()}`].join(String.fromCharCode(92)) : join(tmpdir(), `vitris-${randomUUID()}.sock`);
  let pending = Promise.resolve();
  const server = createServer(socket => {
    let value = '', handled = false; socket.setTimeout(5000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', chunk => {
      if (handled) return; value += chunk.toString('utf8'); if (value.length > 256) {handled = true; socket.destroy(); return;}
      if (!value.includes('\n')) return; handled = true;
      const supplied = value.trim();
      if (!/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(nonce))) {socket.end('{"ok":false}\n'); return;}
      pending = pending.then(async () => {await issue(); socket.end('{"ok":true}\n');}).catch(() => {socket.end('{"ok":false}\n');});
    });
  });
  await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(path, resolve);});
  try {
    await writeFile(join(directory, controlName), JSON.stringify({path, nonce}), {mode: 0o600});
    await issue();
  } catch (error) {await new Promise<void>(resolve => server.close(() => resolve())); throw error;}
  return {issue, close: async () => {await pending; await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); await rm(join(directory, controlName), {force: true});}};
}

export async function refreshPortfolioOwnerAccess(directory = '.vitris'): Promise<OwnerLinks> {
  let config: {path: string; nonce: string};
  try {config = JSON.parse(await readFile(join(directory, controlName), 'utf8')) as typeof config;} catch {throw Error('Start npm run vitris:preview in the project first.');}
  if (typeof config.path !== 'string' || typeof config.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(config.nonce)) throw Error('The private local preview control is invalid. Restart the preview.');
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(config.path); let value = '';
    const fail = () => {socket.destroy(); reject(Error('The local preview is unavailable. Start npm run vitris:preview first.'));};
    socket.setTimeout(5000, fail); socket.on('error', fail);
    socket.on('connect', () => socket.write(config.nonce + '\n'));
    socket.on('data', chunk => {value += chunk.toString('utf8'); if (value.length > 100) fail();});
    socket.on('end', () => {try {if ((JSON.parse(value) as {ok?: boolean}).ok !== true) throw Error(); resolve();} catch {reject(Error('The private preview control rejected sign-in renewal.'));}});
  });
  return JSON.parse(await readFile(join(directory, 'portfolio-owner.json'), 'utf8')) as OwnerLinks;
}
