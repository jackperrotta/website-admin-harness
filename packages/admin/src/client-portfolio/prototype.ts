import type {AdminModule} from '../worker.ts';
import {isLoopback, isObject, isAnalyticsRow, isTrackingTimestamp, type AnalyticsResponse, type AnalyticsRow, type PortfolioState, type PortfolioResponse, type PortfolioAction, type PortfolioChange} from '../../../contracts/src/index.ts';
import type {AdminEnv} from '../worker.ts';

const prefix = '/api/modules/client-portfolio';
const json = (value: unknown, status = 200) => Response.json(value, {status});
const iso = () => new Date().toISOString();

function daily(site: number, previous = false): AnalyticsRow[] {
  return Array.from({length: 30}, (_, i) => {
    const date = new Date(); date.setUTCDate(date.getUTCDate() - (29 - i) - (previous ? 30 : 0));
    const views = Math.round((120 + site * 75 + (i * 31 + site * 17) % 130) * (previous ? (site === 2 ? 1.23 : .84) : 1));
    const enquiries = (i + site) % 4 === 0 ? 3 + site : 0, sessions = Math.round(views * .64);
    return {day: date.toISOString().slice(0, 10), views, visitors: Math.round(views * .58), enquiries, sessions,
      bounces: Math.round(sessions * .3), engaged: Math.round(sessions * .67), duration_ms: views * 48000, leave_count: views,
      scroll_25: Math.round(views * .84), scroll_50: Math.round(views * .61), scroll_75: Math.round(views * .39), scroll_100: Math.round(views * .22),
      converts_form: enquiries, converts_tel: i % 3, converts_mailto: i % 2, converts_maps: i % 4,
      engage_nav: Math.round(views * .31), engage_btn: Math.round(views * .22), engage_img: i % 6, engage_carousel: i % 4,
      channels_json: JSON.stringify([{key: 'organic', n: Math.round(views * .55)}, {key: 'direct', n: Math.round(views * .3)}, {key: 'referral', n: Math.floor(views * .15)}]),
      devices_json: JSON.stringify([{key: 'mobile', n: Math.round(views * .62)}, {key: 'desktop', n: Math.floor(views * .38)}]),
      top_paths_json: JSON.stringify([{key: '/', n: Math.round(views * .6)}, {key: '/services', n: Math.round(views * .25)}, {key: '/contact', n: Math.floor(views * .15)}]),
      top_refs_json: JSON.stringify([{key: 'search.example.test', n: Math.floor(views * .3)}]),
      hours_json: JSON.stringify(Array.from({length: 24}, (_, hour) => ({key: String(hour), n: Math.floor(views / 24)}))),
      top_engage_json: JSON.stringify([{key: 'Request a consultation', n: Math.round(views * .18)}])};
  });
}

function seed(): PortfolioState {
  const now = iso();
  return {
    clients: [
      {id: 'alder', name: 'Alder & Stone', contact: 'Morgan Ellis', sector: 'Architecture'},
      {id: 'sunday', name: 'Sunday House', contact: 'Taylor Reed', sector: 'Hospitality'},
      {id: 'northline', name: 'Northline Studio', contact: 'Alex Chen', sector: 'Creative services'},
    ],
    websites: [
      {id: 'alder-main', clientId: 'alder', name: 'Alder & Stone', origin: 'https://alder.example.test', initials: 'AS', color: '#dfcdb4', connection: 'healthy', lastSuccess: now, rows: daily(0), previousRows: daily(0, true)},
      {id: 'sunday-main', clientId: 'sunday', name: 'Sunday House', origin: 'https://sunday.example.test', initials: 'SH', color: '#e4c4b7', connection: 'healthy', lastSuccess: now, rows: daily(1), previousRows: daily(1, true)},
      {id: 'northline-main', clientId: 'northline', name: 'Northline Studio', origin: 'https://northline.example.test', initials: 'NS', color: '#c5d3e0', connection: 'healthy', lastSuccess: now, rows: daily(2), previousRows: daily(2, true)},
      {id: 'alder-journal', clientId: 'alder', name: 'Alder Journal', origin: 'https://journal.example.test', initials: 'AJ', color: '#cdd4bd', connection: 'unavailable', lastSuccess: null, rows: [], previousRows: []},
    ],
    changes: [{id: 'sample-preview', websiteId: 'sunday-main', title: 'A clearer invitation to stay', request: 'Bring the booking link into the hero and simplify the opening copy.', status: 'preview_ready', candidate: 'demo-sunday-candidate-01', createdAt: now, updatedAt: now, idempotencyKey: 'sample-preview', history: [{label: 'Example request created', at: now}, {label: 'Simulated preview prepared', at: now}], checks: [{label: 'Build and assets', result: 'simulated'}, {label: 'Desktop and mobile layout', result: 'simulated'}], receipt: null}],
    runnerOnline: true,
  };
}

async function payload(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return null;
  const reader = request.body?.getReader(); if (!reader) return null;
  let raw = ''; const decoder = new TextDecoder(); let size = 0;
  for (;;) {const {value, done} = await reader.read(); if (done) break; size += value.length; if (size > 12000) {await reader.cancel(); return null;} raw += decoder.decode(value, {stream: true});}
  try {const value: unknown = JSON.parse(raw + decoder.decode()); return isObject(value) ? value : null;} catch {return null;}
}

/** Explicitly local, synthetic prototype. This module has no fetch or deployment adapter. */
export const clientPortfolioPrototype: AdminModule = makeModule();

/** The live adapter is supplied by a trusted private installation, never browser configuration. */
export function createLiveClientPortfolio(catalog: PortfolioState): AdminModule {
  if (catalog.websites.some(s => s.trackingStartedAt !== undefined && !isTrackingTimestamp(s.trackingStartedAt))) throw new Error('Live tracking dates must be verified ISO UTC timestamps.');
  if (catalog.websites.some(s => !catalog.clients.some(c => c.id === s.clientId) || s.rows.length || s.previousRows.length || new URL(s.origin).protocol !== 'https:') || catalog.changes.length) throw new Error('Live catalogs require HTTPS websites, known clients, and empty analytics/change records.');
  return makeModule(catalog);
}

async function hydrate(state: PortfolioState, env: AdminEnv, live: boolean): Promise<PortfolioState & {analyticsMode?: 'live'}> {
  if (!live) return state;
  const service = (env as AdminEnv & {PORTFOLIO_ANALYTICS?: Pick<Fetcher, 'fetch'>}).PORTFOLIO_ANALYTICS;
  return {...state, analyticsMode: 'live', websites: await Promise.all(state.websites.map(async site => {
    const unavailable = {...site, source: 'not-connected' as const, connection: 'unavailable' as const, rows: [], previousRows: [], windows: {}, lastSuccess: null};
    if (site.connection === 'not_configured') return {...unavailable, connection: 'not_configured' as const, message: 'Analytics collection has not been configured for this website.'};
    try {
      if (!service) throw new Error();
      const windows: NonNullable<typeof site.windows> = {};
      for (const days of [14, 30] as const) {
        const response = await service.fetch(`https://portfolio-analytics.invalid/sites/${encodeURIComponent(site.id)}?days=${days}`);
        if (!response.ok) throw new Error();
        const raw: unknown = await response.json();
        if (!isObject(raw) || raw.source !== 'connected' || raw.days !== days || raw.timezone !== 'UTC' || !Array.isArray(raw.rows) || raw.rows.length > days || !raw.rows.every(isAnalyticsRow) || (raw.previousRows !== undefined && (!Array.isArray(raw.previousRows) || raw.previousRows.length > days || !raw.previousRows.every(isAnalyticsRow)))) throw new Error();
        windows[String(days) as '14' | '30'] = raw as unknown as AnalyticsResponse;
      }
      return {...site, connection: 'healthy' as const, source: 'connected' as const, lastSuccess: iso(), rows: windows['30']!.rows, previousRows: windows['30']!.previousRows || [], windows, message: 'Read-only website analytics · UTC. Update and publishing actions remain simulated.'};
    } catch {return {...unavailable, message: 'The analytics connection could not be verified. Check the website read grant and backend. No demo data has been substituted.'};}
  }))};
}

function makeModule(catalog?: PortfolioState): AdminModule {return {
  id: 'client-portfolio', version: 1, label: 'Clients', permission: 'clients:read',
  ...(catalog ? {disableLocalDemo: true as const} : {}),
  description: 'An optional Vitris client workspace prototype.',
  async handle({request, env, manifest, user, require: authorize, audit}) {
    if (env.MODE !== 'local' || !isLoopback(manifest.adminOrigin) || new URL(request.url).origin !== manifest.adminOrigin || manifest.backend) return json({error: 'The portfolio prototype is available only in an isolated local installation.'}, 404);
    if (user.role !== 'owner') return json({error: 'Only the local installation owner can use this prototype.'}, 403);
    const path = new URL(request.url).pathname.slice(prefix.length);
    if (request.method !== 'GET' && request.method !== 'POST') return json({error: 'Method not allowed'}, 405);
    if (request.method === 'GET' && path !== '' && path !== '/') return json({error: 'Not found'}, 404);
    // One scoped snapshot makes conflicting browser sessions reject rather than overwrite.
    await env.DB.prepare('INSERT OR IGNORE INTO client_portfolio_prototype(site_id,payload) VALUES(?,?)').bind(manifest.site.id, JSON.stringify(catalog || seed())).run();
    const stored = await env.DB.prepare('SELECT revision,payload FROM client_portfolio_prototype WHERE site_id=?').bind(manifest.site.id).first<{revision: number; payload: string}>();
    if (!stored) return json({error: 'Prototype storage is unavailable.'}, 503);
    const state = JSON.parse(stored.payload) as PortfolioState;
    const response = async () => json({...await hydrate(state, env, !!catalog), revision: stored.revision, simulated: true} satisfies PortfolioResponse);
    if (request.method === 'GET') return response();
    const data = await payload(request);
    if (!data || !Number.isSafeInteger(data.revision) || Number(data.revision) < 0) return json({error: 'Send a valid workspace revision and JSON request.'}, 400);
    let action = '';
    if (path === '/changes') {
      authorize('client-changes:request');
      if (typeof data.websiteId !== 'string' || !state.websites.some(s => s.id === data.websiteId)) return json({error: 'Website not found.'}, 404);
      if (typeof data.title !== 'string' || !data.title.trim() || data.title.length > 120 || typeof data.request !== 'string' || !data.request.trim() || data.request.length > 3000 || typeof data.idempotencyKey !== 'string' || !/^[\w-]{8,100}$/.test(data.idempotencyKey)) return json({error: 'Add a title and a change request of up to 3,000 characters.'}, 400);
      const duplicate = state.changes.find(c => c.idempotencyKey === data.idempotencyKey);
      if (duplicate) return duplicate.websiteId === data.websiteId && duplicate.title === data.title.trim() && duplicate.request === data.request.trim() ? response() : json({error: 'This request key already belongs to another change.'}, 409);
      if (state.changes.filter(c => !['published', 'canceled'].includes(c.status)).length >= 40) return json({error: 'Finish or cancel an open change before adding more.'}, 409);
      const now = iso(); state.changes.unshift({id: crypto.randomUUID(), websiteId: data.websiteId, title: data.title.trim(), request: data.request.trim(), idempotencyKey: data.idempotencyKey, status: 'requested', candidate: null, createdAt: now, updatedAt: now, history: [{label: 'Change requested', at: now}], checks: [], receipt: null});
      action = 'Created a simulated website change';
    } else if (path === '/runner') {
      authorize('client-changes:request');
      if (typeof data.online !== 'boolean') return json({error: 'Choose the simulated runner status.'}, 400);
      state.runnerOnline = data.online; action = 'Changed simulated runner status';
    } else {
      const route = path.match(/^\/changes\/([a-zA-Z0-9-]+)\/(start|prepare|fail|retry|cancel|queue|publish)$/);
      if (!route) return json({error: 'Not found'}, 404);
      const change = state.changes.find(c => c.id === route[1]); if (!change) return json({error: 'Change not found.'}, 404);
      const operation = route[2] as PortfolioAction;
      authorize(operation === 'queue' || operation === 'publish' ? 'client-releases:publish' : 'client-changes:request');
      if ((operation === 'queue' || operation === 'publish') && (typeof data.candidate !== 'string' || data.candidate !== change.candidate)) return json({error: 'The candidate changed. Review the current preview before publishing.'}, 409);
      if ((operation === 'queue' && (change.status === 'queued' || change.status === 'published')) || (operation === 'publish' && change.status === 'published')) return response();
      const allowed: Record<PortfolioAction, PortfolioChange['status'][]> = {start: ['requested'], prepare: ['in_progress'], fail: ['in_progress'], retry: ['failed'], cancel: ['requested', 'in_progress', 'preview_ready', 'queued', 'failed'], queue: ['preview_ready'], publish: ['queued']};
      if (!allowed[operation].includes(change.status)) return json({error: 'This change moved to another stage. Refresh the workspace.'}, 409);
      if (['start', 'prepare', 'publish'].includes(operation) && !state.runnerOnline) return json({error: 'The demo runner is offline. Reconnect it to continue.'}, 409);
      if (operation === 'start' && state.changes.some(c => c.id !== change.id && c.websiteId === change.websiteId && ['in_progress', 'preview_ready', 'queued'].includes(c.status))) return json({error: 'Finish or cancel the active candidate for this website first.'}, 409);
      const now = iso();
      const labels: Record<PortfolioAction, string> = {start: 'Demo agent started', prepare: 'Simulated preview prepared', fail: 'Simulated build failed; nothing published', retry: 'Retry requested', cancel: 'Change canceled', queue: 'Owner approved this simulated candidate', publish: 'Simulated publication completed; no website deployed'};
      if (operation === 'queue' && data.reviewed !== true) return json({error: 'Review this candidate before queuing a simulated publication.'}, 400);
      change.status = ({start: 'in_progress', prepare: 'preview_ready', fail: 'failed', retry: 'requested', cancel: 'canceled', queue: 'queued', publish: 'published'} as const)[operation];
      if (operation === 'prepare') {change.candidate = crypto.randomUUID(); change.checks = [{label: 'Build and assets', result: 'simulated'}, {label: 'Desktop and mobile layout', result: 'simulated'}, {label: 'Exact candidate identity', result: 'simulated'}];}
      if (operation === 'fail') {change.candidate = null; change.checks = [{label: 'Build and assets', result: 'failed'}];}
      if (operation === 'retry' || operation === 'cancel') {change.candidate = null; change.checks = [];}
      if (operation === 'publish') change.receipt = {id: `simulated-${crypto.randomUUID()}`, candidate: change.candidate!, publishedAt: now, simulated: true};
      change.updatedAt = now; change.history.push({label: labels[operation], at: now}); action = labels[operation];
    }
    if (data.revision !== stored.revision) return json({error: 'The workspace changed in another session. Refresh and try again.'}, 409);
    const updated = await env.DB.prepare('UPDATE client_portfolio_prototype SET payload=?,revision=revision+1 WHERE site_id=? AND revision=? RETURNING revision').bind(JSON.stringify(state), manifest.site.id, stored.revision).first<{revision: number}>();
    if (!updated) return json({error: 'The workspace changed in another session. Refresh and try again.'}, 409);
    await audit(action); return json({...await hydrate(state, env, !!catalog), revision: updated.revision, simulated: true} satisfies PortfolioResponse);
  },
};}
