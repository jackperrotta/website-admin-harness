import {encrypt} from '../packages/admin/src/scheduling/calendars/crypto.ts';
import type {CalendarProvider} from '../packages/contracts/src/scheduling.ts';

export const syntheticCalendarKey = Buffer.alloc(32, 19).toString('base64url');
export const syntheticCalendarBindings = {
  CALENDAR_SYNC_ENABLED: '1', CALENDAR_GOOGLE_CLIENT_ID: 'synthetic-google-client', CALENDAR_GOOGLE_CLIENT_SECRET: 'synthetic-google-secret',
  CALENDAR_MICROSOFT_CLIENT_ID: 'synthetic-ms-client', CALENDAR_MICROSOFT_CLIENT_SECRET: 'synthetic-ms-secret',
  CALENDAR_TOKEN_KEYS: JSON.stringify({current: 'synthetic', keys: {synthetic: syntheticCalendarKey}}),
};
export interface FixtureEvent {id: string; provider: CalendarProvider; calendarId: string; start: number; end: number; summary: string; marker: string | null; busy: boolean; etag: string; allDay?: {start: string; end: string}; cancelled?: boolean}
export class CalendarProviderFixture {
  events = new Map<string, FixtureEvent>();
  transactions = new Map<string, string>();
  tombstones = new Set<string>();
  calls: {url: string; method: string; body: Record<string, unknown> | null; authorization: string | null; prefer: string | null; ifMatch: string | null}[] = [];
  intercept?: (request: Pick<Request, 'url' | 'method' | 'headers' | 'text' | 'json'>) => Promise<Response | null> | Response | null;
  tokenFailures = false; writesFail = false; refreshes = 0;
  private sequence = 0;
  reset() {this.events.clear(); this.transactions.clear(); this.tombstones.clear(); this.calls = []; this.tokenFailures = false; this.writesFail = false; this.intercept = undefined; this.refreshes = 0;}
  calendars(provider: CalendarProvider) {return provider === 'google' ? [{id: 'google-primary', name: 'Simulated Google primary', writable: true, timezone: 'America/New_York'}, {id: 'google-other', name: 'Simulated Google personal', writable: true, timezone: 'America/New_York'}] : [{id: 'outlook-primary', name: 'Simulated Outlook primary', writable: true, timezone: 'UTC'}, {id: 'outlook-readonly', name: 'Simulated Outlook shared', writable: false, timezone: 'UTC'}];}
  add(provider: CalendarProvider, start: number, end: number, summary = 'Simulated external busy event', calendarId = this.calendars(provider)[0].id): FixtureEvent {
    const event: FixtureEvent = {id: `external-${++this.sequence}`, provider, calendarId, start, end, summary, marker: null, busy: true, etag: `"synthetic-${this.sequence}"`}; this.events.set(event.id, event); return event;
  }
  change(id: string, patch: Partial<FixtureEvent>) {const event = this.events.get(id); if (!event) throw new Error('Synthetic event not found'); Object.assign(event, patch, {etag: `"synthetic-${++this.sequence}"`});}
  remove(id: string) {this.events.delete(id); this.tombstones.add(id);}
  private wire(event: FixtureEvent) {
    if (event.provider === 'google') return {id: event.id, summary: event.summary, status: event.cancelled ? 'cancelled' : 'confirmed', etag: event.etag, transparency: event.busy ? 'opaque' : 'transparent', start: event.allDay ? {date: event.allDay.start} : {dateTime: new Date(event.start).toISOString()}, end: event.allDay ? {date: event.allDay.end} : {dateTime: new Date(event.end).toISOString()}, ...(event.marker ? {extendedProperties: {private: {vitrisAppointment: event.marker}}} : {})};
    return {id: event.id, subject: event.summary, isCancelled: event.cancelled ?? false, '@odata.etag': event.etag, showAs: event.busy ? 'busy' : 'free', start: {dateTime: new Date(event.start).toISOString().replace('Z', ''), timeZone: 'UTC'}, end: {dateTime: new Date(event.end).toISOString().replace('Z', ''), timeZone: 'UTC'}, singleValueExtendedProperties: event.marker ? [{id: 'String {2a08a93b-68f2-4f93-94d1-67590c85d705} Name VitrisAppointment', value: event.marker}] : []};
  }
  async fetch(request: Request): Promise<Response> {
    const intercepted = await this.intercept?.(request.clone()); if (intercepted) return intercepted;
    const url = new URL(request.url), provider: CalendarProvider = url.hostname.includes('google') ? 'google' : 'microsoft';
    let body: Record<string, unknown> | null = null;
    if (request.method !== 'GET' && request.method !== 'DELETE') body = request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(await request.clone().text())) : await request.clone().json() as Record<string, unknown>;
    this.calls.push({url: url.href, method: request.method, body, authorization: request.headers.get('authorization'), prefer: request.headers.get('prefer'), ifMatch: request.headers.get('if-match')});
    if (url.pathname.endsWith('/token')) {
      if (this.tokenFailures) return Response.json({error: 'invalid_grant'}, {status: 400});
      if (body?.grant_type === 'refresh_token') this.refreshes++;
      return Response.json({access_token: `synthetic-${provider}-access`, refresh_token: `synthetic-${provider}-refresh-${this.refreshes}`, token_type: 'Bearer', expires_in: 3600, scope: provider === 'google' ? 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly' : 'User.Read Calendars.ReadWrite'});
    }
    if (request.headers.get('authorization') !== `Bearer synthetic-${provider}-access`) return Response.json({error: 'synthetic unauthorized'}, {status: 401});
    if (url.pathname.endsWith('/calendarList')) return Response.json({items: this.calendars('google').map((c, i) => ({id: c.id, summary: c.name, accessRole: c.writable ? 'owner' : 'reader', timeZone: c.timezone, primary: i === 0}))});
    if (url.pathname === '/v1.0/me') return Response.json({id: 'synthetic-ms-account', mail: 'outlook@example.test'});
    if (url.pathname === '/v1.0/me/calendars') return Response.json({value: this.calendars('microsoft').map(c => ({id: c.id, name: c.name, canEdit: c.writable}))});
    const match = url.pathname.match(/\/calendars\/([^/]+)\/(events|calendarView)(?:\/([^/]+))?$/);
    if (!match) return Response.json({error: 'unknown fixture route'}, {status: 404});
    const calendarId = decodeURIComponent(match[1]), id = match[3] ? decodeURIComponent(match[3]) : undefined;
    if (request.method === 'GET' && !id) {
      const marker = url.searchParams.get('$filter')?.match(/p\/value eq '([a-f0-9]+)'/)?.[1];
      const start = Date.parse(url.searchParams.get(provider === 'google' ? 'timeMin' : 'startDateTime') ?? '1900-01-01T00:00:00Z');
      const end = Date.parse(url.searchParams.get(provider === 'google' ? 'timeMax' : 'endDateTime') ?? '2100-01-01T00:00:00Z');
      const events = [...this.events.values()].filter(e => e.provider === provider && e.calendarId === calendarId && (!marker || e.marker === marker) && e.start < end && e.end > start);
      return Response.json({[provider === 'google' ? 'items' : 'value']: events.map(e => this.wire(e))});
    }
    const current = id ? this.events.get(id) : undefined;
    if (request.method === 'GET') return current ? Response.json(this.wire(current), {headers: {etag: current.etag}}) : Response.json({error: 'not found'}, {status: 404});
    if (this.writesFail) return Response.json({error: 'synthetic provider unavailable'}, {status: 503});
    if (request.headers.has('if-match') && current && request.headers.get('if-match') !== current.etag) return Response.json({error: 'precondition failed'}, {status: 412});
    if (request.method === 'DELETE') {if (id) this.remove(id); return new Response(null, {status: 204});}
    if (!body) return Response.json({error: 'invalid body'}, {status: 400});
    if (request.method !== 'POST' && !current) return Response.json({error: 'not found'}, {status: 404});
    const transaction = typeof body.transactionId === 'string' ? body.transactionId : null;
    if (transaction && this.transactions.has(`${calendarId}|${transaction}`)) return Response.json(this.wire(this.events.get(this.transactions.get(`${calendarId}|${transaction}`)!)!));
    const eventId = id ?? (provider === 'google' ? String(body.id) : `microsoft-event-${++this.sequence}`);
    if (request.method === 'POST' && (this.events.has(eventId) || this.tombstones.has(eventId))) return Response.json({error: 'already exists'}, {status: 409});
    const from = body.start as {dateTime: string}, to = body.end as {dateTime: string};
    const props = body.extendedProperties as {private?: {vitrisAppointment?: string}} | undefined;
    const single = body.singleValueExtendedProperties as {value: string}[] | undefined;
    const event: FixtureEvent = {id: eventId, calendarId, provider, start: Date.parse(from.dateTime.endsWith('Z') ? from.dateTime : `${from.dateTime}Z`), end: Date.parse(to.dateTime.endsWith('Z') ? to.dateTime : `${to.dateTime}Z`), summary: String(body.summary ?? body.subject), marker: provider === 'google' ? props?.private?.vitrisAppointment ?? null : single?.[0]?.value ?? current?.marker ?? null, busy: true, etag: `"synthetic-${++this.sequence}"`};
    this.events.set(eventId, event); if (transaction) this.transactions.set(`${calendarId}|${transaction}`, eventId);
    return Response.json(this.wire(event), {status: request.method === 'POST' ? 201 : 200});
  }
  async seed(db: {prepare: (sql: string) => {bind: (...values: unknown[]) => {run: () => Promise<unknown>}}}, siteId = 'scheduling-browser') {
    for (const provider of ['google', 'microsoft'] as const) {
      const id = `synthetic-${provider}`, resourceId = provider === 'google' ? 'provider-a' : 'provider-b';
      const cipher = await encrypt(syntheticCalendarBindings, `${siteId}|${id}|tokens`, {accessToken: `synthetic-${provider}-access`, refreshToken: `synthetic-${provider}-refresh`, expiresAt: Date.now() + 3600000});
      await db.prepare('INSERT INTO calendar_connections(site_id,id,resource_id,provider,created_by,account_id,account_label,tokens_cipher,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(siteId, id, resourceId, provider, 'owner', provider === 'google' ? 'google-primary' : 'synthetic-ms-account', `Simulated ${provider === 'google' ? 'Google' : 'Outlook'} account`, cipher, Date.now(), Date.now()).run();
    }
  }
  async preview(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const escape = (v: string) => v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    if (request.method === 'POST') {
      if (request.headers.get('origin') !== url.origin) return new Response('Origin check failed', {status: 403});
      const values = new URLSearchParams(await request.text());
      if (values.get('action') === 'remove') this.remove(values.get('id') ?? '');
      else {
        const provider = values.get('provider') === 'microsoft' ? 'microsoft' : 'google', start = Date.parse(`${values.get('start')}:00Z`), end = Date.parse(`${values.get('end')}:00Z`);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return new Response('Choose valid UTC start and end times.', {status: 400});
        this.add(provider, start, end);
      }
      return Response.redirect(`${url.origin}/__calendar-fixture`, 303);
    }
    const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Simulated Google and Outlook calendars</title><style>body{font:16px system-ui;margin:32px auto;padding:0 20px;max-width:950px;color:#263848;background:#f5f7fa}section{background:white;border:1px solid #dce1e7;padding:24px;border-radius:10px;margin:24px 0}label{display:grid;gap:7px;margin:15px 0}input,select,button{font:inherit;padding:10px}table{width:100%;text-align:left;border-collapse:collapse}td,th{padding:12px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}small{display:block}a{color:#315570}</style><h1>Simulated Google and Outlook calendars</h1><p><strong>LOCAL FIXTURES ONLY.</strong> These calendars are isolated in memory. No real account or email is connected.</p><p><a href="/#scheduling">Return to scheduling</a></p><section><h2>Add an external busy event</h2><p>First enable the simulated connection in Scheduling → Calendar connections. Then add a busy event here and use Sync now, or wait for the preview's polling cycle. New booking searches also refresh connected calendars.</p><form method="post"><label>Calendar<select name="provider"><option value="google">Simulated Google / staff A</option><option value="microsoft">Simulated Outlook / staff B</option></select></label><label>Starts (UTC)<input required type="datetime-local" name="start" value="${date}T14:00"></label><label>Ends (UTC)<input required type="datetime-local" name="end" value="${date}T15:00"></label><button>Add simulated external event</button></form></section><section><h2>Events stored by the simulated providers</h2><table><thead><tr><th>Provider and event</th><th>Time (UTC)</th><th>Source</th><th>Action</th></tr></thead><tbody>${[...this.events.values()].map(e => `<tr><td>${escape(e.provider)}<small>${escape(e.summary)}</small></td><td>${escape(new Date(e.start).toISOString())}<small>to ${escape(new Date(e.end).toISOString())}</small></td><td>${e.marker ? 'Harness appointment export' : 'External busy event'}</td><td><form method="post"><input type="hidden" name="action" value="remove"><input type="hidden" name="id" value="${escape(e.id)}"><button>Delete event</button></form></td></tr>`).join('')}</tbody></table><p>Deleting a harness export demonstrates conflict detection. Restore it from Calendar connections; the stored customer appointment will be preserved.</p></section></html>`, {headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'}});
  }
}
