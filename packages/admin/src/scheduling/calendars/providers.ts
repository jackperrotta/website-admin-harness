import {CalendarError, type CalendarEnv, type CalendarTokens, type RemoteCalendar, type RemoteEvent, type ExportEvent} from './types.ts';
import type {CalendarProvider} from '../../../../contracts/src/scheduling.ts';
import {encryptionReady} from './crypto.ts';

const google = 'https://www.googleapis.com/calendar/v3';
const graph = 'https://graph.microsoft.com/v1.0';
export const graphMarkerProperty = 'String {2a08a93b-68f2-4f93-94d1-67590c85d705} Name VitrisAppointment';
export const scopes = (provider: CalendarProvider) => provider === 'google'
  ? ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly']
  : ['offline_access', 'User.Read', 'Calendars.ReadWrite'];
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CalendarError(502, 'calendar_invalid_response', 'The calendar provider returned an invalid response.');
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 2048): string {
  if (typeof value !== 'string' || !value || value.length > max) throw new CalendarError(502, 'calendar_invalid_response', 'The calendar provider returned invalid calendar data.');
  return value;
}
async function readJson(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader(); if (!reader) return {};
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) {const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 2000000) {await reader.cancel(); throw new CalendarError(502, 'calendar_response_limit', 'The calendar response is too large to verify safely.');} chunks.push(part.value);}
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
  try {return object(JSON.parse(new TextDecoder().decode(bytes)));} catch (error) {if (error instanceof CalendarError) throw error; throw new CalendarError(502, 'calendar_invalid_response', 'The calendar provider returned invalid JSON.');}
}
export function providerConfigured(env: CalendarEnv, provider: CalendarProvider): boolean {
  return env.CALENDAR_SYNC_ENABLED === '1' && encryptionReady(env) && !!(provider === 'google' ? env.CALENDAR_GOOGLE_CLIENT_ID && env.CALENDAR_GOOGLE_CLIENT_SECRET : env.CALENDAR_MICROSOFT_CLIENT_ID && env.CALENDAR_MICROSOFT_CLIENT_SECRET);
}
export function oauthDetails(env: CalendarEnv, provider: CalendarProvider) {
  const tenant = env.CALENDAR_MICROSOFT_TENANT ?? 'common';
  if (!/^(common|organizations|consumers|[0-9a-fA-F-]{36})$/.test(tenant)) throw new CalendarError(503, 'calendar_setup_required', 'Configure a valid Microsoft tenant identifier.');
  return provider === 'google'
    ? {authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', clientId: env.CALENDAR_GOOGLE_CLIENT_ID, secret: env.CALENDAR_GOOGLE_CLIENT_SECRET}
    : {authorize: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`, token: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, clientId: env.CALENDAR_MICROSOFT_CLIENT_ID, secret: env.CALENDAR_MICROSOFT_CLIENT_SECRET};
}
async function request(env: CalendarEnv, url: string, init: RequestInit = {}): Promise<Response> {
  const endpoint = new URL(url);
  if (!['https://www.googleapis.com', 'https://graph.microsoft.com', 'https://oauth2.googleapis.com', 'https://login.microsoftonline.com'].includes(endpoint.origin) || endpoint.username || endpoint.password || endpoint.hash) throw new CalendarError(502, 'calendar_invalid_page', 'The provider returned an invalid continuation address.');
  try {
    const response = await (env.CALENDAR_HTTP ? env.CALENDAR_HTTP.fetch(url, {...init, redirect: 'manual', signal: AbortSignal.timeout(15000)}) : fetch(url, {...init, redirect: 'manual', signal: AbortSignal.timeout(15000)}));
    if (response.status >= 300 && response.status < 400) throw new CalendarError(502, 'calendar_invalid_redirect', 'The calendar provider returned an unexpected redirect.');
    return response;
  } catch (error) {if (error instanceof CalendarError) throw error; throw new CalendarError(503, 'calendar_transport', 'The calendar provider could not be reached. The operation remains pending.');}
}
export async function tokenExchange(env: CalendarEnv, provider: CalendarProvider, values: Record<string, string>, previous?: CalendarTokens): Promise<CalendarTokens> {
  const details = oauthDetails(env, provider);
  if (!providerConfigured(env, provider) || !details.clientId || !details.secret) throw new CalendarError(503, 'calendar_setup_required', 'Calendar OAuth settings are not configured for this provider.');
  const response = await request(env, details.token, {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({...values, client_id: details.clientId, client_secret: details.secret}).toString()});
  const body = await readJson(response);
  if (!response.ok) throw new CalendarError(response.status >= 500 || response.status === 429 ? 503 : 401, body.error === 'invalid_grant' ? 'calendar_reauthorization' : 'calendar_token_error', 'Calendar authorization failed. Reconnect the account or retry later.');
  if (body.token_type !== 'Bearer' && body.token_type !== 'bearer') throw new CalendarError(502, 'calendar_invalid_response', 'The calendar provider returned an unsupported token type.');
  if (!previous) {
    const granted = new Set(string(body.scope, 4096).split(/\s+/).map(s => s.replace('https://graph.microsoft.com/', '').toLowerCase()));
    if (scopes(provider).filter(s => s !== 'offline_access').some(s => !granted.has(s.toLowerCase()))) throw new CalendarError(403, 'calendar_missing_scope', 'Calendar read and write permissions were not granted.');
  }
  const expires = Number(body.expires_in);
  if (!Number.isFinite(expires) || expires < 30 || expires > 86400) throw new CalendarError(502, 'calendar_invalid_response', 'The provider returned an invalid token lifetime.');
  return {accessToken: string(body.access_token, 16000), refreshToken: body.refresh_token === undefined && previous ? previous.refreshToken : string(body.refresh_token, 16000), expiresAt: Date.now() + expires * 1000};
}
export class ProviderClient {
  private env: CalendarEnv; public provider: CalendarProvider; private accessToken: string;
  constructor(env: CalendarEnv, provider: CalendarProvider, accessToken: string) {this.env = env; this.provider = provider; this.accessToken = accessToken;}
  private async call(url: string, method = 'GET', body?: unknown, etag?: string): Promise<{status: number; body: Record<string, unknown>; etag: string | null}> {
    const base = this.provider === 'google' ? google : graph;
    const address = new URL(url);
    if (!url.startsWith(`${base}/`) || address.origin !== new URL(base).origin) throw new CalendarError(502, 'calendar_invalid_page', 'The provider returned an invalid API address.');
    const response = await request(this.env, url, {method, headers: {authorization: `Bearer ${this.accessToken}`, ...(body === undefined ? {} : {'content-type': 'application/json'}), ...(etag ? {'if-match': etag} : {}), ...(this.provider === 'microsoft' ? {prefer: 'outlook.timezone="UTC", IdType="ImmutableId"'} : {})}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    if ([404, 409, 410, 412].includes(response.status)) return {status: response.status, body: {}, etag: null};
    if (!response.ok) throw new CalendarError(response.status === 401 || response.status === 403 ? 401 : 503, response.status === 401 || response.status === 403 ? 'calendar_reauthorization' : response.status === 429 ? 'calendar_rate_limit' : 'calendar_provider_error', 'The calendar provider rejected this request. Reconnect or retry from Calendar connections.');
    const data = response.status === 204 ? {} : await readJson(response);
    return {status: response.status, body: data, etag: response.headers.get('etag')};
  }
  private async pages(url: string, key: string, next: (body: Record<string, unknown>, url: string) => string | null): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = []; const seen = new Set<string>();
    for (let page = 0; page < 25; page++) {
      if (seen.has(url)) throw new CalendarError(502, 'calendar_invalid_page', 'The provider repeated a continuation page.'); seen.add(url);
      const result = await this.call(url);
      if (result.status >= 400 || !Array.isArray(result.body[key])) throw new CalendarError(502, 'calendar_invalid_response', 'A complete calendar result could not be verified.');
      items.push(...result.body[key].map(object));
      if (items.length > 5000) throw new CalendarError(503, 'calendar_event_limit', 'This calendar exceeds the verified synchronization limit. Choose a smaller calendar or booking horizon.');
      const following = next(result.body, url); if (!following) return items; url = following;
    }
    throw new CalendarError(503, 'calendar_page_limit', 'The calendar has too many pages to synchronize safely.');
  }
  private next = (body: Record<string, unknown>, current: string): string | null => {
    if (this.provider === 'microsoft') {
      if (body['@odata.nextLink'] === undefined) return null;
      const next = string(body['@odata.nextLink'], 12000), url = new URL(next);
      if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.startsWith('/v1.0/me/')) throw new CalendarError(502, 'calendar_invalid_page', 'Invalid calendar continuation address.');
      return next;
    }
    if (body.nextPageToken === undefined) return null;
    const url = new URL(current); url.searchParams.set('pageToken', string(body.nextPageToken, 4096)); return url.href;
  };
  async calendars(): Promise<{accountId: string; label: string; calendars: RemoteCalendar[]}> {
    const items = await this.pages(this.provider === 'google' ? `${google}/users/me/calendarList?maxResults=100` : `${graph}/me/calendars?$top=100&$select=id,name,canEdit,isDefaultCalendar,owner`, this.provider === 'google' ? 'items' : 'value', this.next);
    const calendars = items.map(item => ({id: string(item.id), name: string(this.provider === 'google' ? item.summary : item.name, 512), writable: this.provider === 'google' ? ['owner', 'writer'].includes(String(item.accessRole)) : item.canEdit === true, timezone: this.provider === 'google' ? string(item.timeZone ?? 'UTC', 100) : 'UTC'}));
    if (calendars.length > 200) throw new CalendarError(503, 'calendar_count_limit', 'The account has too many calendars for this connection.');
    if (this.provider === 'google') {
      const primary = items.find(item => item.primary === true); if (!primary) throw new CalendarError(502, 'calendar_account_unavailable', 'The primary Google calendar could not be identified.');
      return {accountId: string(primary.id), label: string(primary.id), calendars};
    }
    const profile = (await this.call(`${graph}/me?$select=id,mail,userPrincipalName`)).body;
    return {accountId: string(profile.id), label: string(profile.mail ?? profile.userPrincipalName, 512), calendars};
  }
  async events(calendar: RemoteCalendar, start: number, end: number): Promise<RemoteEvent[]> {
    const params = new URLSearchParams(this.provider === 'google'
      ? {timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString(), singleEvents: 'true', maxResults: '250', showDeleted: 'false'}
      : {startDateTime: new Date(start).toISOString(), endDateTime: new Date(end).toISOString(), '$top': '250', '$expand': `singleValueExtendedProperties($filter=id eq '${graphMarkerProperty}')`});
    const url = this.provider === 'google' ? `${google}/calendars/${encodeURIComponent(calendar.id)}/events?${params}` : `${graph}/me/calendars/${encodeURIComponent(calendar.id)}/calendarView?${params}`;
    const items = await this.pages(url, this.provider === 'google' ? 'items' : 'value', this.next);
    return items.map(item => this.normalize(item, calendar));
  }
  normalize(item: Record<string, unknown>, calendar: RemoteCalendar): RemoteEvent {
    const cancelled = this.provider === 'google' ? item.status === 'cancelled' : item.isCancelled === true;
    const id = string(item.id), summary = typeof (this.provider === 'google' ? item.summary : item.subject) === 'string' ? String(this.provider === 'google' ? item.summary : item.subject).slice(0, 512) : '';
    const properties = this.provider === 'google' && item.extendedProperties ? object(object(item.extendedProperties).private ?? {}) : {};
    const graphProperties = Array.isArray(item.singleValueExtendedProperties) ? item.singleValueExtendedProperties.map(object) : [];
    const marker = this.provider === 'google' ? properties.vitrisAppointment : graphProperties.find(p => p.id === graphMarkerProperty)?.value;
    const etag = typeof item.etag === 'string' ? item.etag : typeof item['@odata.etag'] === 'string' ? item['@odata.etag'] : null;
    if (cancelled && (!item.start || !item.end)) return {id, calendarId: calendar.id, start: 0, end: 1, busy: false, cancelled, marker: typeof marker === 'string' ? marker : null, etag, summary};
    const from = object(item.start), to = object(item.end);
    const start = this.provider === 'google' ? googleTime(from, calendar.timezone) : microsoftTime(from);
    const end = this.provider === 'google' ? googleTime(to, calendar.timezone) : microsoftTime(to);
    if (end <= start) throw new CalendarError(502, 'calendar_invalid_event', 'The provider returned an invalid event interval.');
    const busy = !cancelled && (this.provider === 'google' ? item.transparency !== 'transparent' && item.eventType !== 'workingLocation' : !['free', 'workingElsewhere'].includes(String(item.showAs)));
    return {id, calendarId: calendar.id, start, end, busy, cancelled, marker: typeof marker === 'string' ? marker : null, etag, summary};
  }
  private eventUrl(calendarId: string, eventId?: string): string {return this.provider === 'google' ? `${google}/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}` : `${graph}/me/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}`;}
  async get(calendarId: string, id: string): Promise<RemoteEvent | null> {
    const url = new URL(this.eventUrl(calendarId, id)); if (this.provider === 'microsoft') url.searchParams.set('$expand', `singleValueExtendedProperties($filter=id eq '${graphMarkerProperty}')`);
    const result = await this.call(url.href); if ([404, 410].includes(result.status)) return null;
    const event = this.normalize(result.body, {id: calendarId, name: '', timezone: 'UTC', writable: true}); return event.cancelled ? null : event;
  }
  async recover(calendarId: string, marker: string): Promise<RemoteEvent | null> {
    if (this.provider === 'google') return this.get(calendarId, marker);
    const url = new URL(this.eventUrl(calendarId));
    url.searchParams.set('$filter', `singleValueExtendedProperties/Any(p:p/id eq '${graphMarkerProperty}' and p/value eq '${marker}')`);
    url.searchParams.set('$expand', `singleValueExtendedProperties($filter=id eq '${graphMarkerProperty}')`);
    const values = await this.pages(url.href, 'value', this.next);
    if (values.length > 1) throw new CalendarError(409, 'calendar_duplicate_event', 'Multiple calendar events match this appointment. Review them before retrying.');
    return values.length ? this.normalize(values[0], {id: calendarId, name: '', timezone: 'UTC', writable: true}) : null;
  }
  async put(calendarId: string, event: ExportEvent, existing: RemoteEvent | null): Promise<RemoteEvent> {
    if (existing && !existing.etag) throw new CalendarError(502, 'calendar_missing_etag', 'The provider did not return a revision for this event. Retry before changing it.');
    const body = this.provider === 'google'
      ? {summary: event.summary, visibility: 'private', start: {dateTime: new Date(event.start).toISOString()}, end: {dateTime: new Date(event.end).toISOString()}, status: event.pending ? 'tentative' : 'confirmed', transparency: 'opaque', extendedProperties: {private: {vitrisAppointment: event.marker}}, ...(!existing ? {id: event.marker} : {})}
      : {subject: event.summary, start: {dateTime: new Date(event.start).toISOString().replace('Z', ''), timeZone: 'UTC'}, end: {dateTime: new Date(event.end).toISOString().replace('Z', ''), timeZone: 'UTC'}, showAs: event.pending ? 'tentative' : 'busy', sensitivity: 'private', singleValueExtendedProperties: [{id: graphMarkerProperty, value: event.marker}], ...(!existing ? {transactionId: event.marker} : {})};
    const url = new URL(this.eventUrl(calendarId, existing?.id)); if (this.provider === 'google') url.searchParams.set('sendUpdates', 'none');
    const result = await this.call(url.href, existing ? this.provider === 'google' ? 'PUT' : 'PATCH' : 'POST', body, existing?.etag ?? undefined);
    if ([409, 412].includes(result.status)) throw new CalendarError(409, 'calendar_write_conflict', 'The external calendar changed while saving. Review the connection before retrying.');
    if (result.status >= 400) throw new CalendarError(409, 'calendar_deleted_event', 'The external calendar event no longer exists. Review it before restoring.');
    const normalized = this.normalize(result.body, {id: calendarId, name: '', timezone: 'UTC', writable: true});
    if (normalized.marker !== event.marker) throw new CalendarError(502, 'calendar_invalid_response', 'The calendar did not retain the appointment identity.');
    return normalized;
  }
  async remove(calendarId: string, event: RemoteEvent): Promise<void> {
    if (!event.etag) throw new CalendarError(502, 'calendar_missing_etag', 'The provider did not return a revision for this event. Retry before removing it.');
    const url = new URL(this.eventUrl(calendarId, event.id)); if (this.provider === 'google') url.searchParams.set('sendUpdates', 'none');
    const result = await this.call(url.href, 'DELETE', undefined, event.etag ?? undefined);
    if (result.status === 412) throw new CalendarError(409, 'calendar_write_conflict', 'The calendar event changed before cancellation. Review the conflict.');
    if (![200, 204, 404, 410].includes(result.status)) throw new CalendarError(503, 'calendar_delete_failed', 'The calendar event could not be removed.');
  }
}
function microsoftTime(value: Record<string, unknown>): number {
  const date = string(value.dateTime, 60).replace(/(\.\d{3})\d+/, '$1');
  if (value.timeZone !== 'UTC' && value.timeZone !== 'Etc/UTC') throw new CalendarError(502, 'calendar_invalid_timezone', 'The Microsoft calendar response did not use the requested UTC timezone.');
  const result = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(date) ? date : `${date}Z`);
  if (!Number.isFinite(result)) throw new CalendarError(502, 'calendar_invalid_event', 'Invalid event timestamp.'); return result;
}
function googleTime(value: Record<string, unknown>, timezone: string): number {
  if (value.dateTime !== undefined) {
    const raw = string(value.dateTime, 100); if (!/(Z|[+-]\d\d:\d\d)$/.test(raw)) throw new CalendarError(502, 'calendar_invalid_timezone', 'A calendar timestamp is missing its offset.');
    const result = Date.parse(raw); if (!Number.isFinite(result)) throw new CalendarError(502, 'calendar_invalid_event', 'Invalid calendar timestamp.'); return result;
  }
  const date = string(value.date, 10); if (!/^\d{4}-\d\d-\d\d$/.test(date)) throw new CalendarError(502, 'calendar_invalid_event', 'Invalid all-day event.');
  const target = Date.parse(`${date}T00:00:00Z`); if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== date) throw new CalendarError(502, 'calendar_invalid_event', 'Invalid all-day event date.');
  let formatter: Intl.DateTimeFormat;
  try {formatter = new Intl.DateTimeFormat('en-US', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});} catch {throw new CalendarError(502, 'calendar_invalid_timezone', 'The calendar returned an unsupported timezone.');}
  const candidates: number[] = [];
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = target + hours * 3600000, parts = formatter.formatToParts(sample), get = (name: string) => parts.find(p => p.type === name)!.value;
    const local = Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00Z`);
    candidates.push(target - (local - sample));
  }
  // At a midnight transition, the first real minute of the local date is the all-day boundary.
  const dayFormat = new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'});
  const matches = (at: number) => {const parts = dayFormat.formatToParts(at), get = (name: string) => parts.find(p => p.type === name)!.value; return `${get('year')}-${get('month')}-${get('day')}` === date;};
  const boundary = candidates.sort((a, b) => a - b).find(at => matches(at) && !matches(at - 60000));
  if (boundary !== undefined) return boundary;
  const start = Math.min(...candidates) - 2 * 3600000, end = Math.max(...candidates) + 2 * 3600000;
  for (let at = start; at <= end; at += 60000) if (matches(at)) return at;
  throw new CalendarError(502, 'calendar_invalid_event', 'The all-day calendar date could not be resolved.');
}
