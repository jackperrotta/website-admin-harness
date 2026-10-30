import {can, isLoopback, type AdminManifest, type User} from '../../../../contracts/src/index.ts';
import {emptySchedulingConfig, parseSchedulingConfig, type CalendarProvider, type CalendarConnectionsResponse, type SchedulingAppointment} from '../../../../contracts/src/scheduling.ts';
import {CalendarError, type CalendarEnv, type CalendarTokens, type ConnectionRow, type CalendarSelection, type EventLink, type CalendarAppointmentRow, type RemoteEvent, type ExportEvent} from './types.ts';
import {ProviderClient, providerConfigured, oauthDetails, scopes, tokenExchange} from './providers.ts';
import {digest, random, encrypt, decrypt, base64url} from './crypto.ts';
import {calendarAttachment} from './ics.ts';

const absent = (error: unknown) => error instanceof Error && /no such table: (calendar_|appointment_calendar_)/.test(error.message);
const json = (value: unknown) => JSON.stringify(value);
const active = (a: CalendarAppointmentRow) => ['confirmed', 'pending_approval', 'completed', 'no_show'].includes(a.status) && !(a.status === 'pending_approval' && a.expires_at! <= Date.now());
export async function eventHash(event: Pick<RemoteEvent, 'start' | 'end' | 'summary' | 'marker'> & {busy?: boolean}) {return digest(json([event.start, event.end, event.summary, event.marker, event.busy ?? true]));}
export class CalendarService {
  constructor(private env: CalendarEnv, private manifest: AdminManifest) {}
  private get site() {return this.manifest.site.id;}
  private get db() {return this.env.DB;}
  get simulated() {return this.env.MODE === 'local' && isLoopback(this.manifest.adminOrigin) && this.env.CALENDAR_FIXTURE_MODE === '1' && !!this.env.CALENDAR_HTTP;}
  private async configuration() {
    const state = await this.db.prepare('SELECT revision,config_json FROM scheduling_state WHERE site_id=?').bind(this.site).first<{revision: number; config_json: string}>();
    if (!state) return {revision: 0, config: emptySchedulingConfig()};
    return {revision: state.revision, config: parseSchedulingConfig(JSON.parse(state.config_json))};
  }
  async authorize(user: User, resourceId: string, allowRemoved = false) {
    const current = await this.db.prepare('SELECT id,email,role FROM users WHERE id=? AND active=1').bind(user.id).first<User>();
    const {config} = await this.configuration(), resource = config.resources.find(r => r.id === resourceId && r.kind === 'provider');
    const grant = config.grants.find(g => g.userId === current?.id);
    if (!current || (!resource && !allowRemoved) || !(can(current.role, 'calendar-connections:manage') || (grant?.permissions.includes('calendar-connections:manage') && (grant.scope === 'all' || resource?.userId === current.id)))) throw new CalendarError(403, 'calendar_forbidden', 'Your account cannot manage this provider calendar.');
    return current;
  }
  private authority(user: User, resourceId: string, connectionId: string, revision: number, leaseId: string | null = null) {
    return this.db.prepare('INSERT INTO calendar_mutations(id,site_id,user_id,resource_id,created_at,connection_id,expected_revision,lease_id) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), this.site, user.id, resourceId, Date.now(), connectionId, revision, leaseId);
  }
  private fence(connection: ConnectionRow, scheduleRevision: number | null = null) {
    return this.db.prepare('INSERT INTO calendar_sync_fences(id,site_id,connection_id,revision,lease_id,schedule_revision,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(), this.site, connection.id, connection.revision, connection.lease_id, scheduleRevision, Date.now());
  }
  private activity(connectionId: string, action: string, appointmentId: string | null = null) {
    return this.db.prepare('INSERT INTO calendar_activity(site_id,id,connection_id,appointment_id,action,created_at) VALUES(?,?,?,?,?,?)').bind(this.site, crypto.randomUUID(), connectionId, appointmentId, action, Date.now());
  }
  private async connection(id: string): Promise<ConnectionRow> {
    const value = await this.db.prepare('SELECT * FROM calendar_connections WHERE site_id=? AND id=?').bind(this.site, id).first<ConnectionRow>();
    if (!value) throw new CalendarError(404, 'calendar_not_found', 'Calendar connection not found.'); return value;
  }
  private async connections(resourceIds?: string[]): Promise<ConnectionRow[]> {
    try {
      const rows = (await this.db.prepare('SELECT * FROM calendar_connections WHERE site_id=? ORDER BY created_at,id').bind(this.site).all<ConnectionRow>()).results;
      return resourceIds ? rows.filter(c => resourceIds.includes(c.resource_id)) : rows;
    } catch (error) {if (absent(error) && this.env.CALENDAR_SYNC_ENABLED !== '1') return []; throw error;}
  }
  async list(user: User): Promise<CalendarConnectionsResponse> {
    const {config} = await this.configuration();
    const all = can(user.role, 'appointments:read') || config.grants.some(g => g.userId === user.id && g.scope === 'all');
    const own = config.resources.filter(r => r.userId === user.id && r.kind === 'provider').map(r => r.id);
    let schemaReady = true, rows: ConnectionRow[];
    try {rows = await this.connections(all ? undefined : own); await this.db.prepare('SELECT id FROM calendar_connections LIMIT 1').first();} catch (error) {if (!absent(error)) throw error; rows = []; schemaReady = false;}
    const connections: CalendarConnectionsResponse['connections'] = [], conflicts: CalendarConnectionsResponse['conflicts'] = [];
    for (const row of rows.filter(row => row.tokens_cipher !== null)) {
      const selection = JSON.parse(row.selection_json) as CalendarSelection;
      const pending = await this.db.prepare("SELECT count(*) AS n FROM calendar_export_jobs WHERE site_id=? AND connection_id=? AND status IN ('pending','running','failed')").bind(this.site, row.id).first<{n: number}>();
      const issues = (await this.db.prepare('SELECT appointment_id,reason FROM calendar_conflicts WHERE site_id=? AND connection_id=? LIMIT 100').bind(this.site, row.id).all<{appointment_id: string; reason: string}>()).results;
      conflicts.push(...issues.map(c => ({connectionId: row.id, appointmentId: c.appointment_id, reason: c.reason})));
      connections.push({id: row.id, resourceId: row.resource_id, provider: row.provider, accountLabel: row.account_label, enabled: !!row.enabled, health: row.enabled && (row.last_synced_at === null || Date.now() - row.last_synced_at > 180000) && row.health === 'healthy' ? 'stale' : row.health, revision: row.revision, blocking: selection.blocking, destination: selection.destination, lastSyncedAt: row.last_synced_at, errorCode: row.error_code, pendingJobs: pending?.n ?? 0, conflicts: issues.length});
    }
    return {simulated: this.simulated, enabled: this.env.CALENDAR_SYNC_ENABLED === '1', schemaReady, providers: (['google', 'microsoft'] as const).map(provider => ({id: provider, configured: schemaReady && providerConfigured(this.env, provider), callbackUrl: this.callback(provider)})), connections, conflicts};
  }
  callback(provider: CalendarProvider) {return `${this.manifest.adminOrigin}/api/scheduling/oauth/${provider}/callback`;}
  private cookie(value: string, clear = false) {
    const local = isLoopback(this.manifest.adminOrigin) && this.env.MODE === 'local';
    return `${local ? 'vitris-calendar-oauth-local' : '__Host-vitris-calendar-oauth'}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 600}${local ? '' : '; Secure'}`;
  }
  async begin(user: User, resourceId: string, provider: CalendarProvider) {
    await this.authorize(user, resourceId);
    if (!providerConfigured(this.env, provider) || this.simulated) throw new CalendarError(503, 'calendar_setup_required', 'Configure real OAuth app credentials to connect this calendar provider.');
    const recent = await this.db.prepare('SELECT count(*) AS n FROM calendar_oauth_flows WHERE site_id=? AND user_id=? AND created_at>?').bind(this.site, user.id, Date.now() - 600000).first<{n: number}>();
    if ((recent?.n ?? 0) >= 10) throw new CalendarError(429, 'calendar_oauth_rate_limit', 'Too many calendar connection attempts. Try again later.');
    const existing = (await this.connections([resourceId])).find(c => c.provider === provider && c.tokens_cipher !== null);
    const state = random(), cookie = random(), verifier = random(), id = existing?.id ?? crypto.randomUUID();
    await this.db.prepare('INSERT INTO calendar_oauth_flows(state_hash,site_id,user_id,resource_id,provider,connection_id,cookie_hash,verifier_cipher,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(await digest(state), this.site, user.id, resourceId, provider, id, await digest(cookie), await encrypt(this.env, `${this.site}|${id}|oauth`, {verifier}), Date.now() + 600000, Date.now()).run();
    const details = oauthDetails(this.env, provider), url = new URL(details.authorize);
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const params = {client_id: details.clientId!, redirect_uri: this.callback(provider), response_type: 'code', scope: scopes(provider).join(' '), state, code_challenge: challenge, code_challenge_method: 'S256', ...(provider === 'google' ? {access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true'} : {response_mode: 'query', prompt: 'select_account'})};
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return new Response(json({url: url.href}), {headers: {'content-type': 'application/json', 'set-cookie': this.cookie(cookie)}});
  }
  async complete(request: Request, provider: CalendarProvider): Promise<Response> {
    const url = new URL(request.url), state = url.searchParams.get('state');
    const name = isLoopback(this.manifest.adminOrigin) ? 'vitris-calendar-oauth-local' : '__Host-vitris-calendar-oauth';
    const cookie = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1);
    if (!state || state.length > 200 || !cookie || cookie.length > 200) throw new CalendarError(403, 'calendar_invalid_state', 'This calendar connection link expired or belongs to another browser.');
    const flow = await this.db.prepare('DELETE FROM calendar_oauth_flows WHERE state_hash=? AND site_id=? AND provider=? AND cookie_hash=? AND expires_at>? RETURNING *').bind(await digest(state), this.site, provider, await digest(cookie), Date.now()).first<{user_id: string; resource_id: string; connection_id: string; verifier_cipher: string}>();
    if (!flow) throw new CalendarError(403, 'calendar_invalid_state', 'The calendar connection link expired or was already used.');
    const user = await this.db.prepare('SELECT id,email,role FROM users WHERE id=? AND active=1').bind(flow.user_id).first<User>();
    if (!user) throw new CalendarError(403, 'calendar_forbidden', 'Calendar connection access was revoked.');
    await this.authorize(user, flow.resource_id);
    const code = url.searchParams.get('code');
    if (!code || code.length > 8000 || url.searchParams.has('error')) throw new CalendarError(400, 'calendar_authorization_declined', 'Calendar authorization was not completed. Return to Scheduling to retry.');
    const secret = await decrypt<{verifier: string}>(this.env, `${this.site}|${flow.connection_id}|oauth`, flow.verifier_cipher);
    const tokens = await tokenExchange(this.env, provider, {grant_type: 'authorization_code', code, redirect_uri: this.callback(provider), code_verifier: secret.verifier});
    const account = await new ProviderClient(this.env, provider, tokens.accessToken).calendars();
    const existing = (await this.connections([flow.resource_id])).find(c => c.id === flow.connection_id);
    if (existing && existing.account_id !== account.accountId && existing.enabled) throw new CalendarError(409, 'calendar_account_changed', 'Disconnect the existing connection before selecting a different calendar account.');
    const cipher = await encrypt(this.env, `${this.site}|${flow.connection_id}|tokens`, tokens);
    await this.db.batch([
      this.authority(user, flow.resource_id, flow.connection_id, existing?.revision ?? -1),
      this.db.prepare(`INSERT INTO calendar_connections(site_id,id,resource_id,provider,created_by,account_id,account_label,tokens_cipher,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(site_id,id) DO UPDATE SET tokens_cipher=excluded.tokens_cipher,created_by=excluded.created_by,account_id=excluded.account_id,account_label=excluded.account_label,revision=revision+1,health=CASE WHEN enabled=1 THEN 'stale' ELSE 'disconnected' END,error_code=NULL,next_sync_at=0,updated_at=excluded.updated_at`).bind(this.site, flow.connection_id, flow.resource_id, provider, user.id, account.accountId, account.label, cipher, Date.now(), Date.now()),
      this.db.prepare('UPDATE scheduling_state SET revision=revision+1 WHERE site_id=?').bind(this.site),
    ]);
    return new Response(null, {status: 303, headers: {location: `${this.manifest.adminOrigin}/#scheduling`, 'set-cookie': this.cookie('', true)}});
  }
  private async client(row: ConnectionRow): Promise<ProviderClient> {
    if (!providerConfigured(this.env, row.provider) || !row.tokens_cipher) throw new CalendarError(503, 'calendar_setup_required', 'Calendar credentials or integration settings are unavailable.');
    let tokens = await decrypt<CalendarTokens>(this.env, `${this.site}|${row.id}|tokens`, row.tokens_cipher);
    if (tokens.expiresAt <= Date.now() + 60000) {
      tokens = await tokenExchange(this.env, row.provider, {grant_type: 'refresh_token', refresh_token: tokens.refreshToken, ...(row.provider === 'microsoft' ? {scope: scopes('microsoft').join(' ')} : {})}, tokens);
      const cipher = await encrypt(this.env, `${this.site}|${row.id}|tokens`, tokens);
      await this.db.batch([this.fence(row), this.db.prepare('UPDATE calendar_connections SET tokens_cipher=? WHERE site_id=? AND id=?').bind(cipher, this.site, row.id)]);
      row.tokens_cipher = cipher;
    }
    return new ProviderClient(this.env, row.provider, tokens.accessToken);
  }
  private async acquire(id: string, includeDisabled = false): Promise<ConnectionRow> {
    const lease = random();
    const row = await this.db.prepare(`UPDATE calendar_connections SET lease_id=?,lease_until=? WHERE site_id=? AND id=? AND lease_until<=? ${includeDisabled ? '' : 'AND enabled=1'} RETURNING *`).bind(lease, Date.now() + 300000, this.site, id, Date.now()).first<ConnectionRow>();
    if (!row) throw new CalendarError(409, 'calendar_sync_busy', 'This calendar is syncing or its configuration changed. Retry shortly.'); return row;
  }
  private async release(row: ConnectionRow) {await this.db.prepare('UPDATE calendar_connections SET lease_id=NULL,lease_until=0 WHERE site_id=? AND id=? AND lease_id=?').bind(this.site, row.id, row.lease_id).run();}
  private async renewBeforeWrite(row: ConnectionRow) {
    const held = await this.db.prepare('UPDATE calendar_connections SET lease_until=? WHERE site_id=? AND id=? AND revision=? AND lease_id=? AND lease_until>? AND enabled=1 RETURNING id').bind(Date.now() + 300000, this.site, row.id, row.revision, row.lease_id, Date.now()).first();
    if (!held) throw new CalendarError(409, 'calendar_sync_busy', 'This calendar synchronization lease expired. Retry with current state.');
  }
  async calendars(user: User, id: string) {
    const initial = await this.connection(id); await this.authorize(user, initial.resource_id);
    const row = await this.acquire(id, true);
    try {
      // Disabled connections may list calendars before enabling; never refresh without a fenced lease.
      let tokens = await decrypt<CalendarTokens>(this.env, `${this.site}|${row.id}|tokens`, row.tokens_cipher ?? '');
      if (tokens.expiresAt <= Date.now() + 60000) {
        const updated = await tokenExchange(this.env, row.provider, {grant_type: 'refresh_token', refresh_token: tokens.refreshToken, ...(row.provider === 'microsoft' ? {scope: scopes('microsoft').join(' ')} : {})}, tokens);
        await this.db.prepare('UPDATE calendar_connections SET tokens_cipher=? WHERE site_id=? AND id=? AND lease_id=?').bind(await encrypt(this.env, `${this.site}|${row.id}|tokens`, updated), this.site, row.id, row.lease_id).run(); tokens = updated;
      }
      const account = await new ProviderClient(this.env, row.provider, tokens.accessToken).calendars();
      if (account.accountId !== row.account_id) throw new CalendarError(401, 'calendar_account_changed', 'The calendar account identity changed. Reconnect it.');
      return {calendars: account.calendars, revision: row.revision};
    } finally {await this.release(row);}
  }
  async select(user: User, id: string, revision: number, selection: CalendarSelection, acknowledged: boolean) {
    const row = await this.connection(id); await this.authorize(user, row.resource_id);
    if (!acknowledged) throw new CalendarError(400, 'calendar_confirmation_required', 'Confirm that appointment events may be written to this calendar.');
    const listed = await this.calendars(user, id);
    if (listed.revision !== revision) throw new CalendarError(409, 'calendar_stale_connection', 'The calendar connection changed. Reload before saving.');
    const destination = listed.calendars.find(c => c.id === selection.destination && c.writable);
    if (!destination || selection.blocking.length > 5 || selection.blocking.some(id => !listed.calendars.some(c => c.id === id))) throw new CalendarError(400, 'calendar_invalid_selection', 'Choose a writable appointment calendar and at most five calendars for busy times.');
    const normalized = {blocking: [...new Set([...selection.blocking, destination.id])], destination: destination.id};
    if (normalized.blocking.length > 5) throw new CalendarError(400, 'calendar_invalid_selection', 'The destination also counts toward the five blocking calendars.');
    const previous = JSON.parse(row.selection_json) as CalendarSelection;
    if (previous.destination && previous.destination !== destination.id && await this.db.prepare("SELECT 1 FROM calendar_event_links WHERE site_id=? AND connection_id=? AND state<>'deleted' LIMIT 1").bind(this.site, id).first()) throw new CalendarError(409, 'calendar_destination_in_use', 'Keep the current destination while it contains linked appointments. Resolve or cancel those appointments before switching destinations.');
    await this.db.batch([
      this.authority(user, row.resource_id, id, revision),
      this.db.prepare("UPDATE calendar_connections SET selection_json=?,enabled=1,health='stale',revision=revision+1,next_sync_at=0,error_code=NULL WHERE site_id=? AND id=?").bind(json(normalized), this.site, id),
      this.db.prepare('UPDATE scheduling_state SET revision=revision+1 WHERE site_id=?').bind(this.site),
      this.db.prepare("INSERT OR IGNORE INTO calendar_export_jobs(site_id,connection_id,appointment_id,appointment_revision,created_at,updated_at) SELECT site_id,?,id,revision,?,? FROM scheduling_appointments WHERE site_id=? AND provider_id=? AND status IN ('confirmed','pending_approval') AND ends_at>?").bind(id, Date.now(), Date.now(), this.site, row.resource_id, Date.now()),
      this.activity(id, 'Enabled calendar synchronization'),
    ]);
    try {await this.sync(id, true);} catch {return {ok: true, syncPending: true};}
    return {ok: true, syncPending: false};
  }
  async disconnect(user: User, id: string, revision: number, acknowledged: boolean) {
    const row = await this.connection(id); await this.authorize(user, row.resource_id, true);
    if (!acknowledged) throw new CalendarError(400, 'calendar_confirmation_required', 'Confirm that this calendar will stop blocking availability and receiving updates.');
    await this.db.batch([
      this.authority(user, row.resource_id, id, revision),
      this.db.prepare("UPDATE calendar_connections SET enabled=0,tokens_cipher=NULL,health='disconnected',revision=revision+1,current_batch=NULL,error_code=NULL WHERE site_id=? AND id=?").bind(this.site, id),
      this.db.prepare('DELETE FROM calendar_busy_intervals WHERE site_id=? AND connection_id=?').bind(this.site, id),
      this.db.prepare('DELETE FROM calendar_conflicts WHERE site_id=? AND connection_id=?').bind(this.site, id),
      this.db.prepare("UPDATE calendar_export_jobs SET status='superseded',updated_at=? WHERE site_id=? AND connection_id=? AND status IN ('pending','running','failed')").bind(Date.now(), this.site, id),
      this.db.prepare('UPDATE scheduling_state SET revision=revision+1 WHERE site_id=?').bind(this.site), this.activity(id, 'Disconnected calendar'),
    ]); return {ok: true};
  }
  private async markFailure(row: ConnectionRow, error: unknown) {
    const code = error instanceof CalendarError ? error.code : 'calendar_sync_failed';
    await this.db.prepare("UPDATE calendar_connections SET health=?,error_code=?,next_sync_at=? WHERE site_id=? AND id=? AND lease_id=?").bind(code === 'calendar_reauthorization' || code === 'calendar_credentials_unavailable' ? 'reauthorization_required' : 'error', code, Date.now() + 60000, this.site, row.id, row.lease_id).run();
  }
  async sync(id: string, force = false): Promise<void> {
    const row = await this.acquire(id);
    try {
      const actor = await this.db.prepare('SELECT id,email,role FROM users WHERE id=? AND active=1').bind(row.created_by).first<User>();
      if (!actor) throw new CalendarError(401, 'calendar_reauthorization', 'The account that connected this calendar is inactive. An administrator must reconnect it.');
      try {await this.authorize(actor, row.resource_id);} catch {throw new CalendarError(401, 'calendar_reauthorization', 'Calendar management access was revoked. An authorized account must reconnect it.');}
      const client = await this.client(row), account = await client.calendars();
      if (account.accountId !== row.account_id) throw new CalendarError(401, 'calendar_account_changed', 'Calendar account identity mismatch.');
      const selection = JSON.parse(row.selection_json) as CalendarSelection;
      if (!selection.destination || selection.blocking.some(id => !account.calendars.some(c => c.id === id))) throw new CalendarError(401, 'calendar_reauthorization', 'A selected calendar is unavailable. Review the connection.');
      await this.expire(row);
      await this.exports(row, client, selection, force);
      if (await this.db.prepare("SELECT 1 FROM calendar_export_jobs WHERE site_id=? AND connection_id=? AND status IN ('pending','running','failed') LIMIT 1").bind(this.site, row.id).first()) throw new CalendarError(503, 'calendar_exports_pending', 'Calendar writes are awaiting retry. Retry synchronization before accepting another appointment.');
      const {config} = await this.configuration();
      const rangeStart = Math.floor((Date.now() - 86400000) / 86400000) * 86400000;
      const rangeEnd = Math.ceil((Date.now() + (config.horizonDays + 1) * 86400000) / 86400000) * 86400000;
      const events: RemoteEvent[] = [];
      for (const id of selection.blocking) events.push(...await client.events(account.calendars.find(c => c.id === id)!, rangeStart, rangeEnd));
      if (events.length > 10000) throw new CalendarError(503, 'calendar_event_limit', 'Selected calendars contain too many events for a complete synchronization.');
      await this.publish(row, events, rangeStart, rangeEnd);
    } catch (error) {await this.markFailure(row, error); throw error;} finally {await this.release(row);}
  }
  private async expire(row: ConnectionRow) {
    const pending = await this.db.prepare("SELECT 1 FROM scheduling_appointments WHERE site_id=? AND provider_id=? AND status='pending_approval' AND expires_at<=? LIMIT 1").bind(this.site, row.resource_id, Date.now()).first();
    if (!pending) return;
    const state = await this.configuration();
    await this.db.batch([
      this.fence(row, state.revision), this.db.prepare('UPDATE scheduling_state SET revision=revision+1 WHERE site_id=?').bind(this.site),
      this.db.prepare("INSERT INTO scheduling_history(site_id,id,appointment_id,actor_id,action,revision,created_at) SELECT site_id,lower(hex(randomblob(16))),id,?,'Expired approval hold (calendar runner)',revision+1,? FROM scheduling_appointments WHERE site_id=? AND provider_id=? AND status='pending_approval' AND expires_at<=?").bind(row.created_by, Date.now(), this.site, row.resource_id, Date.now()),
      this.db.prepare("UPDATE scheduling_appointments SET status='expired',expires_at=NULL,revision=revision+1,schedule_revision=?,updated_at=? WHERE site_id=? AND provider_id=? AND status='pending_approval' AND expires_at<=?").bind(state.revision + 1, Date.now(), this.site, row.resource_id, Date.now()),
      this.activity(row.id, 'Expired pending approval holds'),
    ]);
  }
  private async exports(row: ConnectionRow, client: ProviderClient, selection: CalendarSelection, force: boolean) {
    const jobs = (await this.db.prepare(`SELECT DISTINCT appointment_id FROM calendar_export_jobs WHERE site_id=? AND connection_id=? AND status IN ('pending','running','failed') ${force ? '' : 'AND next_attempt_at<=?'} LIMIT 100`).bind(this.site, row.id, ...(force ? [] : [Date.now()])).all<{appointment_id: string}>()).results;
    for (const job of jobs) {
      const appointment = await this.db.prepare('SELECT * FROM scheduling_appointments WHERE site_id=? AND id=?').bind(this.site, job.appointment_id).first<CalendarAppointmentRow>(); if (!appointment) continue;
      try {
        await this.db.batch([this.fence(row), this.db.prepare("UPDATE calendar_export_jobs SET status='superseded',updated_at=? WHERE site_id=? AND connection_id=? AND appointment_id=? AND appointment_revision<? AND status<>'succeeded'").bind(Date.now(), this.site, row.id, appointment.id, appointment.revision), this.db.prepare("UPDATE calendar_export_jobs SET status='running',attempts=attempts+1,updated_at=? WHERE site_id=? AND connection_id=? AND appointment_id=? AND appointment_revision=?").bind(Date.now(), this.site, row.id, appointment.id, appointment.revision)]);
        await this.exportAppointment(row, client, selection, appointment);
        await this.db.batch([this.fence(row), this.db.prepare("UPDATE calendar_export_jobs SET status='succeeded',error_code=NULL,updated_at=? WHERE site_id=? AND connection_id=? AND appointment_id=? AND appointment_revision=?").bind(Date.now(), this.site, row.id, appointment.id, appointment.revision)]);
      } catch (error) {
        const code = error instanceof CalendarError ? error.code : 'calendar_export_failed';
        await this.db.prepare("UPDATE calendar_export_jobs SET status='failed',error_code=?,next_attempt_at=?+min(3600000,30000*(1 << min(attempts,7))),updated_at=? WHERE site_id=? AND connection_id=? AND appointment_id=? AND appointment_revision=?").bind(code, Date.now(), Date.now(), this.site, row.id, appointment.id, appointment.revision).run();
        throw error;
      }
    }
  }
  private async exportAppointment(row: ConnectionRow, client: ProviderClient, selection: CalendarSelection, appointment: CalendarAppointmentRow) {
    let link = await this.db.prepare('SELECT * FROM calendar_event_links WHERE site_id=? AND connection_id=? AND appointment_id=?').bind(this.site, row.id, appointment.id).first<EventLink>();
    const shouldExist = active(appointment) && appointment.provider_id === row.resource_id;
    if (link?.state === 'deleted' && shouldExist) {
      const marker = await digest(`${this.site}|${row.id}|${appointment.id}|${link.generation + 1}`);
      await this.db.batch([this.fence(row), this.db.prepare("UPDATE calendar_event_links SET marker=?,generation=generation+1,external_id=NULL,payload_hash=NULL,exported_revision=0,state='active' WHERE site_id=? AND connection_id=? AND appointment_id=?").bind(marker, this.site, row.id, appointment.id)]);
      link = {...link, marker, generation: link.generation + 1, external_id: null, payload_hash: null, exported_revision: 0, state: 'active'};
    }
    if (!link) {
      if (!shouldExist) return;
      const marker = await digest(`${this.site}|${row.id}|${appointment.id}|0`);
      await this.db.batch([this.fence(row), this.db.prepare('INSERT INTO calendar_event_links(site_id,connection_id,appointment_id,calendar_id,marker) VALUES(?,?,?,?,?)').bind(this.site, row.id, appointment.id, selection.destination, marker)]);
      link = (await this.db.prepare('SELECT * FROM calendar_event_links WHERE site_id=? AND connection_id=? AND appointment_id=?').bind(this.site, row.id, appointment.id).first<EventLink>())!;
    }
    const remote = link.external_id ? await client.get(link.calendar_id, link.external_id) : await client.recover(link.calendar_id, link.marker);
    if (remote && remote.marker !== link.marker) throw new CalendarError(409, 'calendar_foreign_event', 'The calendar event identity does not match this appointment.');
    if (link.exported_revision > 0 && link.state !== 'deleted' && ((!remote && shouldExist) || (remote && ((link.remote_etag && remote.etag !== link.remote_etag) || (link.payload_hash && await eventHash(remote) !== link.payload_hash))))) {
      await this.setConflict(row, link, remote ? 'external_changed' : 'external_deleted');
      throw new CalendarError(409, 'calendar_external_conflict', 'An external edit needs review before this appointment can be synchronized.');
    }
    if (!shouldExist) {
      if (remote) {await this.renewBeforeWrite(row); await client.remove(link.calendar_id, remote);}
      await this.db.batch([this.fence(row), this.db.prepare("UPDATE calendar_event_links SET state='deleted',exported_revision=?,remote_etag=NULL WHERE site_id=? AND connection_id=? AND appointment_id=?").bind(appointment.revision, this.site, row.id, appointment.id)]); return;
    }
    const snapshot = JSON.parse(appointment.snapshot_json) as {service: {name: string}}, customer = JSON.parse(appointment.customer_json) as {name: string};
    const expected: ExportEvent = {marker: link.marker, summary: `${appointment.status === 'pending_approval' ? '[Awaiting approval] ' : ''}${snapshot.service.name} — ${customer.name}`, start: appointment.starts_at, end: appointment.ends_at, pending: appointment.status === 'pending_approval'};
    await this.renewBeforeWrite(row);
    const result = remote && await eventHash(remote) === await eventHash(expected) ? remote : await client.put(link.calendar_id, expected, remote);
    await this.db.batch([this.fence(row), this.db.prepare("UPDATE calendar_event_links SET external_id=?,exported_revision=?,payload_hash=?,remote_etag=?,state='active' WHERE site_id=? AND connection_id=? AND appointment_id=?").bind(result.id, appointment.revision, await eventHash(result), result.etag, this.site, row.id, appointment.id), this.db.prepare('DELETE FROM calendar_conflicts WHERE site_id=? AND connection_id=? AND appointment_id=? AND reason<>?').bind(this.site, row.id, appointment.id, 'external_overlap')]);
  }
  private async setConflict(row: ConnectionRow, link: EventLink, reason: 'external_changed' | 'external_deleted') {
    await this.db.batch([this.fence(row), this.db.prepare("UPDATE calendar_event_links SET state='conflict' WHERE site_id=? AND connection_id=? AND appointment_id=?").bind(this.site, row.id, link.appointment_id), this.db.prepare('INSERT OR IGNORE INTO calendar_conflicts(site_id,connection_id,appointment_id,reason,created_at) VALUES(?,?,?,?,?)').bind(this.site, row.id, link.appointment_id, reason, Date.now())]);
  }
  private async publish(row: ConnectionRow, events: RemoteEvent[], rangeStart: number, rangeEnd: number) {
    const links = (await this.db.prepare('SELECT * FROM calendar_event_links WHERE site_id=? AND connection_id=?').bind(this.site, row.id).all<EventLink>()).results;
    const busy: {key: string; start: number; end: number}[] = [];
    for (const event of events) {
      const link = links.find(l => l.external_id === event.id && l.calendar_id === event.calendarId && l.marker === event.marker && l.state !== 'deleted');
      if (link && link.payload_hash && !event.cancelled && (!link.remote_etag || event.etag === link.remote_etag) && await eventHash(event) === link.payload_hash) continue;
      if (link && link.exported_revision > 0) await this.setConflict(row, link, event.cancelled ? 'external_deleted' : 'external_changed');
      if (event.busy && !event.cancelled) busy.push({key: await digest(`${event.calendarId}|${event.id}`), start: event.start, end: event.end});
    }
    for (const link of links.filter(l => l.state === 'active' && l.exported_revision > 0)) {
      const a = await this.db.prepare('SELECT * FROM scheduling_appointments WHERE site_id=? AND id=?').bind(this.site, link.appointment_id).first<CalendarAppointmentRow>();
      if (a && active(a) && a.starts_at >= rangeStart && a.ends_at <= rangeEnd && !events.some(e => e.calendarId === link.calendar_id && e.id === link.external_id && !e.cancelled)) await this.setConflict(row, link, 'external_deleted');
    }
    busy.sort((a, b) => a.key.localeCompare(b.key));
    const hash = await digest(json(busy)), batch = crypto.randomUUID();
    for (let offset = 0; offset < busy.length; offset += 50) await this.db.batch(busy.slice(offset, offset + 50).map(b => this.db.prepare('INSERT INTO calendar_busy_intervals(site_id,connection_id,batch_id,event_key,resource_id,starts_at,ends_at) VALUES(?,?,?,?,?,?,?)').bind(this.site, row.id, batch, b.key, row.resource_id, b.start, b.end)));
    const hasConflict = await this.db.prepare("SELECT 1 FROM calendar_conflicts WHERE site_id=? AND connection_id=? AND reason<>'external_overlap' LIMIT 1").bind(this.site, row.id).first();
    await this.db.batch([
      this.fence(row),
      this.db.prepare('UPDATE scheduling_state SET revision=revision+? WHERE site_id=?').bind(hash === row.snapshot_hash ? 0 : 1, this.site),
      this.db.prepare('UPDATE calendar_connections SET current_batch=?,snapshot_hash=?,last_synced_at=?,range_start=?,range_end=?,health=?,error_code=?,next_sync_at=? WHERE site_id=? AND id=?').bind(batch, hash, Date.now(), rangeStart, rangeEnd, hasConflict ? 'error' : 'healthy', hasConflict ? 'calendar_external_conflict' : null, Date.now() + 60000, this.site, row.id),
      this.db.prepare("DELETE FROM calendar_conflicts WHERE site_id=? AND connection_id=? AND reason='external_overlap'").bind(this.site, row.id),
      this.db.prepare(`INSERT OR IGNORE INTO calendar_conflicts(site_id,connection_id,appointment_id,reason,created_at)
        SELECT ?,?,r.appointment_id,'external_overlap',? FROM calendar_busy_intervals b JOIN scheduling_reservations r
        ON r.site_id=b.site_id AND r.resource_id=b.resource_id AND r.starts_at<b.ends_at AND r.ends_at>b.starts_at
        WHERE b.site_id=? AND b.connection_id=? AND b.batch_id=? AND (r.expires_at IS NULL OR r.expires_at>?)`).bind(this.site, row.id, Date.now(), this.site, row.id, batch, Date.now()),
      this.db.prepare('DELETE FROM calendar_busy_intervals WHERE site_id=? AND connection_id=? AND batch_id<>?').bind(this.site, row.id, batch),
    ]);
    row.snapshot_hash = hash; row.current_batch = batch;
    if (hasConflict) throw new CalendarError(409, 'calendar_external_conflict', 'An external calendar edit needs review. The stored appointment has been preserved.');
  }
  async beforeAvailability(resourceIds: string[], force = false) {
    const rows = (await this.connections(resourceIds)).filter(c => c.enabled);
    for (const row of rows) {
      if (this.env.CALENDAR_SYNC_ENABLED !== '1') throw new CalendarError(503, 'calendar_setup_required', 'A required calendar is connected but synchronization is disabled. Restore its settings or disconnect it explicitly.');
      if (force || row.health !== 'healthy' || !row.last_synced_at || Date.now() - row.last_synced_at > 60000 || await this.db.prepare("SELECT 1 FROM calendar_export_jobs WHERE site_id=? AND connection_id=? AND status IN ('pending','running','failed') LIMIT 1").bind(this.site, row.id).first()) await this.sync(row.id, force);
      const checked = await this.connection(row.id);
      if (checked.health !== 'healthy') throw new CalendarError(503, 'calendar_unavailable', 'This provider calendar needs attention before accepting a new time.');
    }
  }
  async busy(start: number, end: number) {
    try {
      const rows = (await this.db.prepare('SELECT b.resource_id,b.starts_at,b.ends_at,b.event_key FROM calendar_busy_intervals b JOIN calendar_connections c ON c.site_id=b.site_id AND c.id=b.connection_id AND c.current_batch=b.batch_id WHERE b.site_id=? AND c.enabled=1 AND b.starts_at<? AND b.ends_at>?').bind(this.site, end, start).all<{resource_id: string; starts_at: number; ends_at: number; event_key: string}>()).results;
      return rows.map(b => ({resourceId: b.resource_id, appointmentId: `external-${b.event_key}`, start: b.starts_at, end: b.ends_at}));
    } catch (error) {if (absent(error) && this.env.CALENDAR_SYNC_ENABLED !== '1') return []; throw error;}
  }
  async afterAppointment(id: string) {
    // Appointment commits remain successful even when a provider write fails. Jobs retain the failure.
    const rows = await this.connections();
    for (const row of rows.filter(c => c.enabled)) {
      if (!await this.db.prepare("SELECT 1 FROM calendar_export_jobs WHERE site_id=? AND connection_id=? AND appointment_id=? AND status IN ('pending','failed','running') LIMIT 1").bind(this.site, row.id, id).first()) continue;
      try {await this.sync(row.id, true);} catch { /* Visible in connection health and durable job status. */ }
    }
  }
  async retry(user: User, id: string) {const row = await this.connection(id); await this.authorize(user, row.resource_id); await this.sync(id, true); return {ok: true};}
  async restore(user: User, id: string, appointmentId: string, acknowledged: boolean) {
    const initial = await this.connection(id); await this.authorize(user, initial.resource_id);
    if (!acknowledged) throw new CalendarError(400, 'calendar_confirmation_required', 'Confirm that the appointment should replace the external calendar edit.');
    const row = await this.acquire(id);
    try {
      const link = await this.db.prepare("SELECT * FROM calendar_event_links WHERE site_id=? AND connection_id=? AND appointment_id=? AND state='conflict'").bind(this.site, id, appointmentId).first<EventLink>();
      if (!link) throw new CalendarError(404, 'calendar_conflict_not_found', 'Calendar conflict not found.');
      const client = await this.client(row), remote = link.external_id ? await client.get(link.calendar_id, link.external_id) : null;
      if (remote && remote.marker !== link.marker) throw new CalendarError(409, 'calendar_foreign_event', 'This event does not belong to the appointment.');
      const marker = remote ? link.marker : await digest(`${this.site}|${id}|${appointmentId}|${link.generation + 1}`);
      await this.db.batch([this.authority(user, row.resource_id, id, row.revision, row.lease_id), this.fence(row), this.db.prepare("UPDATE calendar_event_links SET marker=?,generation=generation+?,external_id=?,payload_hash=?,state='active',exported_revision=0 WHERE site_id=? AND connection_id=? AND appointment_id=?").bind(marker, remote ? 0 : 1, remote?.id ?? null, remote ? await eventHash(remote) : null, this.site, id, appointmentId), this.db.prepare("DELETE FROM calendar_conflicts WHERE site_id=? AND connection_id=? AND appointment_id=? AND reason<>'external_overlap'").bind(this.site, id, appointmentId), this.db.prepare("UPDATE calendar_export_jobs SET status='pending',next_attempt_at=0 WHERE site_id=? AND connection_id=? AND appointment_id=? AND appointment_revision=(SELECT revision FROM scheduling_appointments WHERE site_id=? AND id=?)").bind(this.site, id, appointmentId, this.site, appointmentId), this.activity(id, 'Restored appointment authority after external edit', appointmentId)]);
      const a = await this.db.prepare('SELECT revision FROM scheduling_appointments WHERE site_id=? AND id=?').bind(this.site, appointmentId).first<{revision: number}>();
      if (a) await this.db.batch([this.authority(user, row.resource_id, id, row.revision, row.lease_id), this.fence(row), this.db.prepare("INSERT INTO calendar_export_jobs(site_id,connection_id,appointment_id,appointment_revision,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(site_id,connection_id,appointment_id,appointment_revision) DO UPDATE SET status='pending',next_attempt_at=0").bind(this.site, id, appointmentId, a.revision, Date.now(), Date.now())]);
    } finally {await this.release(row);}
    await this.sync(id, true); return {ok: true};
  }
  async tick() {
    if (this.env.CALENDAR_SYNC_ENABLED !== '1') return;
    const rows = (await this.connections()).filter(c => c.enabled && c.next_sync_at <= Date.now()).sort((a, b) => a.next_sync_at - b.next_sync_at).slice(0, 100);
    let offset = 0;
    await Promise.all(Array.from({length: Math.min(4, rows.length)}, async () => {while (offset < rows.length) {const row = rows[offset++]; try {await this.sync(row.id);} catch { /* Durable failure and backoff are exposed in the admin. */ }}}));
    await this.db.prepare('DELETE FROM calendar_oauth_flows WHERE expires_at<?').bind(Date.now()).run();
    await this.db.prepare('DELETE FROM calendar_sync_fences WHERE created_at<?').bind(Date.now() - 86400000).run();
    await this.db.prepare('DELETE FROM calendar_mutations WHERE created_at<?').bind(Date.now() - 86400000).run();
    await this.db.prepare('DELETE FROM calendar_busy_intervals WHERE site_id=? AND EXISTS(SELECT 1 FROM calendar_connections c WHERE c.site_id=calendar_busy_intervals.site_id AND c.id=calendar_busy_intervals.connection_id AND c.lease_until<=? AND (c.current_batch IS NULL OR c.current_batch<>calendar_busy_intervals.batch_id))').bind(this.site, Date.now()).run();
  }
  async capture(appointment: SchedulingAppointment) {
    const attachment = await calendarAttachment(appointment, this.site, this.manifest.adminOrigin);
    try {await this.db.prepare('INSERT OR IGNORE INTO appointment_calendar_captures(site_id,appointment_id,appointment_revision,attachment_json,created_at) VALUES(?,?,?,?,?)').bind(this.site, appointment.id, appointment.revision, json(attachment), Date.now()).run();} catch (error) {if (!absent(error)) throw error;}
    return {delivery: 'captured' as const, appointmentRevision: appointment.revision, attachments: [attachment]};
  }
}
