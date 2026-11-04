import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {parseManifest, isTrackingTimestamp, type PortfolioState} from '../packages/contracts/src/index.ts';
import {harnessRequest} from '../packages/admin/src/harness.ts';

interface PrivateConnection {id: string; clientId: string; name: string; origin: string; initials: string; color: string; manifestPath?: string; credentialFile?: string; credentialKey?: string; trackingStartedAt?: string}
export async function loadPortfolioConnections(path: string) {
  const config = JSON.parse(await readFile(path, 'utf8')) as {clients: PortfolioState['clients']; websites: PrivateConnection[]};
  if (!Array.isArray(config.clients) || !Array.isArray(config.websites) || config.websites.length > 20 || new Set(config.websites.map(s => s.id)).size !== config.websites.length) throw new Error('Invalid private portfolio catalog.');
  const connections = new Map<string, {manifest: ReturnType<typeof parseManifest>; token: string}>();
  const websites: PortfolioState['websites'] = [];
  for (const site of config.websites) {
    if (site.trackingStartedAt !== undefined && !isTrackingTimestamp(site.trackingStartedAt)) throw new Error('Use a verified ISO UTC tracking activation timestamp.');
    const origin = new URL(site.origin); if (origin.protocol !== 'https:' || origin.origin !== site.origin) throw new Error('Use an exact HTTPS website origin.');
    if (site.manifestPath) {
      const manifest = parseManifest(JSON.parse(await readFile(site.manifestPath, 'utf8')));
      if (!manifest.backend || manifest.site.origin !== site.origin || new URL(manifest.backend.origin).protocol !== 'https:') throw new Error('Website connection identity mismatch.');
      if (!site.credentialFile || !site.credentialKey) throw new Error('A server credential reference is required.');
      const token = parseEnv(await readFile(site.credentialFile, 'utf8'))[site.credentialKey];
      if (!token || !/^[a-zA-Z0-9_-]{32,200}$/.test(token)) throw new Error('The website read credential is missing.');
      const status = await harnessRequest(manifest, {HARNESS_API_TOKEN: token}, 'status');
      if (!status.scopes.includes('analytics:read') || status.scopes.includes('leads:write')) throw new Error('Use an existing read-only website grant with analytics access.');
      connections.set(site.id, {manifest, token});
    }
    // Credentials and their filesystem locations never enter the Worker catalog or browser.
    websites.push({id: site.id, clientId: site.clientId, name: site.name, origin: site.origin, initials: site.initials, color: site.color, connection: connections.has(site.id) ? 'unavailable' : 'not_configured', lastSuccess: null, rows: [], previousRows: [], source: 'not-connected', ...(site.trackingStartedAt ? {trackingStartedAt: site.trackingStartedAt} : {})});
  }
  const catalog: PortfolioState = {clients: config.clients, websites, changes: [], runnerOnline: false};
  const analytics = async (request: Request): Promise<Response> => {
    const url = new URL(request.url), match = url.pathname.match(/^\/sites\/([a-zA-Z0-9-]+)$/), days = url.searchParams.get('days');
    if (request.method !== 'GET' || url.origin !== 'https://portfolio-analytics.invalid' || !match || !['14', '30'].includes(days || '')) return Response.json({error: 'Not found'}, {status: 404});
    const connection = connections.get(match[1]); if (!connection) return Response.json({error: 'Not configured'}, {status: 404});
    try {
      const data = await harnessRequest(connection.manifest, {HARNESS_API_TOKEN: connection.token}, 'analytics', {days: Number(days)});
      return Response.json(data, {headers: {'cache-control': 'no-store'}});
    } catch {return Response.json({error: 'Website analytics unavailable'}, {status: 502});}
  };
  return {catalog, analytics};
}
