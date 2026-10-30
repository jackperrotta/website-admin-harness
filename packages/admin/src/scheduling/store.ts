import {can, type User} from '../../../contracts/src/index.ts';
import {
  emptySchedulingConfig, parseSchedulingConfig, schedulingPermissions,
  type SchedulingConfig, type SchedulingPermission, type SchedulingConfigurationResponse, type SchedulingSummary,
  type SchedulingAppointment, type AppointmentSnapshot, type SchedulingMutationResponse,
  type CreateAppointmentRequest, type RescheduleAppointmentRequest, type AppointmentStatusRequest,
  type SchedulingAvailabilityQuery, type SchedulingWeeklyHours, type SchedulingException,
} from '../../../contracts/src/scheduling.ts';
import {availability, eligibleResources, minute, type ResourceReservation} from './availability.ts';

export {SchedulingError} from './errors.ts';
import {SchedulingError} from './errors.ts';
import {SchedulingEngine} from './engine.ts';
export interface SchedulingAccess {scope: 'all' | 'own'; permissions: SchedulingPermission[]; providerIds: string[]}
export interface SchedulingCalendars {
  beforeAvailability(resourceIds: string[], force?: boolean): Promise<void>;
  busy(start: number, end: number): Promise<ResourceReservation[]>;
  afterAppointment(id: string): Promise<void>;
  capture(appointment: SchedulingAppointment): Promise<unknown>;
}
interface StateRow {revision: number; config_json: string}
interface AppointmentRow {
  id: string; service_id: string; location_id: string; provider_id: string; starts_at: number; ends_at: number;
  occupied_starts_at: number; occupied_ends_at: number; status: SchedulingAppointment['status']; expires_at: number | null;
  customer_json: string; snapshot_json: string; revision: number;
}
interface Receipt {actor_id: string; request_hash: string; response_json: string}
const iso = (at: number) => new Date(at).toISOString();
const conflict = () => new SchedulingError(409, 'revision_conflict', 'The schedule changed. Reload availability before saving.');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
async function hash(value: unknown): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))), n => n.toString(16).padStart(2, '0')).join('');
}
export function schedulingAccess(user: User, config: SchedulingConfig): SchedulingAccess {
  if (can(user.role, 'scheduling:configure')) return {scope: 'all', permissions: [...schedulingPermissions], providerIds: []};
  const grant = config.grants.find(g => g.userId === user.id);
  return {scope: grant?.scope ?? 'own', permissions: grant?.permissions ?? [], providerIds: config.resources.filter(r => r.kind === 'provider' && r.userId === user.id).map(r => r.id)};
}
export function requireScheduling(access: SchedulingAccess, permission: SchedulingPermission): void {
  if (!access.permissions.includes(permission)) throw new SchedulingError(403, 'forbidden', 'Your account does not have access to this scheduling action.');
}
export function requireProvider(access: SchedulingAccess, providerId: string): void {
  if (access.scope !== 'all' && !access.providerIds.includes(providerId)) throw new SchedulingError(404, 'not_found', 'Appointment or provider not found.');
}
function dto(row: AppointmentRow): SchedulingAppointment {
  const snapshot = JSON.parse(row.snapshot_json) as AppointmentSnapshot;
  const status = row.status === 'pending_approval' && row.expires_at! <= Date.now() ? 'expired' : row.status;
  return {id: row.id, title: snapshot.service.name, serviceId: row.service_id, locationId: row.location_id, providerId: row.provider_id, startsAt: iso(row.starts_at), endsAt: iso(row.ends_at), occupiedStartsAt: iso(row.occupied_starts_at), occupiedEndsAt: iso(row.occupied_ends_at), status, expiresAt: row.expires_at === null ? null : iso(row.expires_at), customer: JSON.parse(row.customer_json) as SchedulingAppointment['customer'], revision: row.revision, snapshot, mode: 'test'};
}

/** The Worker creates this only after its canonical-host, session and CSRF checks. */
export class SchedulingStore {
  constructor(private db: D1Database, private site: string, private user: User, private calendars?: SchedulingCalendars) {}
  async configuration(): Promise<SchedulingConfigurationResponse> {
    let row: StateRow | null;
    try {row = await this.db.prepare('SELECT revision,config_json FROM scheduling_state WHERE site_id=?').bind(this.site).first<StateRow>();}
    catch (error) {
      if (error instanceof Error && /no such table: scheduling_/.test(error.message)) throw new SchedulingError(503, 'schema_unavailable', 'Apply the reviewed scheduling migration to this installation before enabling the module.');
      throw error;
    }
    return {schemaVersion: 1, revision: row?.revision ?? 0, config: row ? parseSchedulingConfig(JSON.parse(row.config_json)) : emptySchedulingConfig()};
  }
  async context() {
    const state = await this.configuration();
    return {...state, access: schedulingAccess(this.user, state.config)};
  }
  private async initialize() {
    await this.db.prepare('INSERT OR IGNORE INTO scheduling_state(site_id,config_json,updated_at) VALUES(?,?,?)').bind(this.site, JSON.stringify(emptySchedulingConfig()), Date.now()).run();
  }
  private history(action: string, revision: number, appointmentId: string | null): D1PreparedStatement[] {
    return [
      this.db.prepare('INSERT INTO scheduling_history(site_id,id,appointment_id,actor_id,action,revision,created_at) VALUES(?,?,?,?,?,?,?)').bind(this.site, crypto.randomUUID(), appointmentId, this.user.id, action, revision, Date.now()),
      this.db.prepare('INSERT INTO audit(id,actor,action) VALUES(?,?,?)').bind(crypto.randomUUID(), this.user.id, `Scheduling: ${action}`),
    ];
  }
  private guard(key: string, kind: 'configuration' | 'availability' | 'appointment', digest: string, expectedRevision: number, response: unknown, targets: string[] = []) {
    return this.db.prepare('INSERT INTO scheduling_commands(site_id,command_key,actor_id,kind,request_hash,expected_revision,response_json,created_at,targets_json) VALUES(?,?,?,?,?,?,?,?,?)').bind(this.site, key, this.user.id, kind, digest, expectedRevision, JSON.stringify(response), Date.now(), JSON.stringify(targets));
  }
  private async translate(error: unknown): Promise<never> {
    const message = error instanceof Error ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ''}` : '';
    if (message.includes('scheduling_resource_conflict')) throw new SchedulingError(409, 'slot_taken', 'This time is no longer available. Choose another time.');
    if (message.includes('scheduling_stale_revision')) throw conflict();
    if (message.includes('scheduling_access_denied')) throw new SchedulingError(403, 'forbidden', 'Scheduling access has changed.');
    if (message.includes('scheduling_disabled')) throw new SchedulingError(409, 'disabled', 'Scheduling is disabled.');
    if (message.includes('scheduling_expired')) throw new SchedulingError(409, 'expired', 'This approval request has expired.');
    if (message.includes('calendar_busy')) throw new SchedulingError(409, 'calendar_busy', 'An external calendar event now blocks this time. Choose another time.');
    if (message.includes('calendar_unavailable')) throw new SchedulingError(503, 'calendar_unavailable', 'A required calendar needs synchronization before a new time can be accepted.');
    throw error;
  }
  async saveConfiguration(config: SchedulingConfig, revision: number, ownResourceId?: string): Promise<SchedulingConfigurationResponse> {
    const before = await this.context();
    requireScheduling(before.access, ownResourceId ? 'availability:write' : 'scheduling:configure');
    if (ownResourceId) requireProvider(before.access, ownResourceId);
    if (before.revision !== revision) throw conflict();
    // Linked users and grants must reference real accounts, including inactive retained accounts.
    const userIds = [...new Set([...config.grants.map(g => g.userId), ...config.resources.flatMap(r => r.userId ? [r.userId] : [])])];
    if (userIds.length) {
      for (let offset = 0; offset < userIds.length; offset += 50) {
        const batch = userIds.slice(offset, offset + 50);
        const users = (await this.db.prepare(`SELECT id FROM users WHERE id IN (${batch.map(() => '?').join(',')})`).bind(...batch).all<{id: string}>()).results;
        if (users.length !== batch.length) throw new SchedulingError(400, 'invalid_account', 'Scheduling references an unknown account.');
      }
    }
    for (const resource of config.resources) {
      const old = before.config.resources.find(r => r.id === resource.id);
      if (old && old.kind !== resource.kind) throw new SchedulingError(400, 'invalid_resource', 'Create a new resource ID when changing its kind.');
    }
    await this.initialize();
    try {
      await this.db.batch([
        this.guard(crypto.randomUUID(), ownResourceId ? 'availability' : 'configuration', await hash(config), revision, {revision: revision + 1}, ownResourceId ? [ownResourceId] : []),
        this.db.prepare('UPDATE scheduling_state SET config_json=? WHERE site_id=?').bind(JSON.stringify(config), this.site),
        ...this.history(ownResourceId ? 'Updated resource availability' : 'Updated configuration', revision + 1, null),
      ]);
    } catch (error) {return this.translate(error);}
    return {schemaVersion: 1, revision: revision + 1, config};
  }
  async saveResourceAvailability(resourceId: string, weeklyHours: SchedulingWeeklyHours[], exceptions: SchedulingException[], revision: number) {
    const state = await this.context();
    requireScheduling(state.access, 'availability:write');
    requireProvider(state.access, resourceId);
    if (state.revision !== revision) throw conflict();
    if (!state.config.resources.some(r => r.id === resourceId)) throw new SchedulingError(404, 'not_found', 'Resource not found.');
    if ([...weeklyHours, ...exceptions].some(h => h.resourceId !== resourceId)) throw new SchedulingError(400, 'invalid_resource', 'Only the selected resource availability can be changed.');
    const config = parseSchedulingConfig({...state.config, weeklyHours: [...state.config.weeklyHours.filter(h => h.resourceId !== resourceId), ...weeklyHours], exceptions: [...state.config.exceptions.filter(e => e.resourceId !== resourceId), ...exceptions]});
    const result = await this.saveConfiguration(config, revision, resourceId);
    // Do not return the full configuration (and other people's grants) to provider-scoped callers.
    return {schemaVersion: 1 as const, revision: result.revision, resourceId, weeklyHours, exceptions};
  }
  private async row(id: string): Promise<AppointmentRow> {
    const row = await this.db.prepare('SELECT * FROM scheduling_appointments WHERE site_id=? AND id=?').bind(this.site, id).first<AppointmentRow>();
    if (!row) throw new SchedulingError(404, 'not_found', 'Appointment not found.');
    return row;
  }
  async appointment(id: string): Promise<SchedulingAppointment> {
    const state = await this.context(); requireScheduling(state.access, 'appointments:read');
    const row = await this.row(id); requireProvider(state.access, row.provider_id);
    return (await this.provenance([dto(row)]))[0];
  }
  private async provenance(rows: SchedulingAppointment[]): Promise<SchedulingAppointment[]> {
    for (let offset = 0; offset < rows.length; offset += 40) {
      const batch = rows.slice(offset, offset + 40), marks = batch.map(() => '?').join(',');
      const staff = (await this.db.prepare(`SELECT DISTINCT appointment_id FROM scheduling_history WHERE site_id=? AND action='Created appointment' AND appointment_id IN (${marks})`).bind(this.site, ...batch.map(a => a.id)).all<{appointment_id: string}>()).results;
      const created = new Set(staff.map(a => a.appointment_id));
      let guests: {appointment_id: string; response_json: string}[] = [];
      try {guests = (await this.db.prepare(`SELECT appointment_id,response_json FROM booking_commands WHERE site_id=? AND appointment_id IN (${marks})`).bind(this.site, ...batch.map(a => a.id)).all<{appointment_id: string; response_json: string}>()).results;}
      catch (error) {if (!(error instanceof Error) || !/no such table: booking_commands/.test(error.message)) throw error;}
      for (const row of batch) {
        const guest = guests.find(g => g.appointment_id === row.id);
        row.source = guest ? 'website' : created.has(row.id) ? 'staff' : 'unknown';
        if (guest) row.acceptedPolicy = (JSON.parse(guest.response_json) as {policyText: string}).policyText;
      }
    }
    return rows;
  }
  async summary(): Promise<SchedulingSummary> {
    const state = await this.context(); requireScheduling(state.access, 'appointments:read');
    const now = Date.now(), end = now + 31 * 86400000;
    const scope = state.access.scope === 'all' ? '' : ` AND provider_id IN (${state.access.providerIds.map(() => '?').join(',') || 'NULL'})`;
    const filter = `site_id=? AND starts_at>=? AND starts_at<? AND (status='confirmed' OR (status='pending_approval' AND expires_at>?))${scope}`;
    const args = [this.site, now, end, now, ...(state.access.scope === 'all' ? [] : state.access.providerIds)];
    const count = await this.db.prepare(`SELECT count(*) AS upcoming,coalesce(sum(status='pending_approval'),0) AS pendingApproval FROM scheduling_appointments WHERE ${filter}`).bind(...args).first<{upcoming: number; pendingApproval: number}>();
    const next = (await this.db.prepare(`SELECT * FROM scheduling_appointments WHERE ${filter} ORDER BY starts_at,id LIMIT 5`).bind(...args).all<AppointmentRow>()).results;
    return {schemaVersion: 1, mode: state.config.mode, revision: state.revision, generatedAt: iso(now), through: iso(end), upcoming: count?.upcoming ?? 0, pendingApproval: count?.pendingApproval ?? 0, next: await this.provenance(next.map(dto))};
  }
  async appointments(startsAt: number, endsAt: number) {
    const state = await this.context(); requireScheduling(state.access, 'appointments:read');
    if (state.access.scope === 'own' && !state.access.providerIds.length) return {rows: [], revision: state.revision, truncated: false};
    const scope = state.access.scope === 'all' ? '' : ` AND provider_id IN (${state.access.providerIds.map(() => '?').join(',')})`;
    const rows = (await this.db.prepare(`SELECT * FROM scheduling_appointments WHERE site_id=? AND starts_at<? AND ends_at>?${scope} ORDER BY starts_at,id LIMIT 201`).bind(this.site, endsAt, startsAt, ...(state.access.scope === 'all' ? [] : state.access.providerIds)).all<AppointmentRow>()).results;
    return {rows: await this.provenance(rows.slice(0, 200).map(dto)), revision: state.revision, truncated: rows.length > 200, message: 'Scheduling foundation: test appointments and captured jobs only.'};
  }
  async available(query: SchedulingAvailabilityQuery) {
    let state = await this.context(); requireScheduling(state.access, 'appointments:read');
    if (query.providerId) requireProvider(state.access, query.providerId);
    const providers = query.providerId ? [query.providerId] : state.config.services.find(s => s.id === query.serviceId)?.providerIds.filter(id => state.access.scope === 'all' || state.access.providerIds.includes(id)) ?? [];
    await this.calendars?.beforeAvailability(providers);
    if (this.calendars) {state = await this.context(); requireScheduling(state.access, 'appointments:read'); if (query.providerId) requireProvider(state.access, query.providerId);}
    let config = state.access.scope === 'all' ? state.config : {...state.config, services: state.config.services.map(s => ({...s, providerIds: s.providerIds.filter(id => state.access.providerIds.includes(id))}))};
    let original: AppointmentSnapshot | undefined;
    if (query.appointmentId) {
      const row = await this.row(query.appointmentId); requireProvider(state.access, row.provider_id);
      if (row.service_id !== query.serviceId) throw new SchedulingError(400, 'invalid_selection', 'Select the appointment service when rescheduling.');
      const snapshot = JSON.parse(row.snapshot_json) as AppointmentSnapshot;
      original = snapshot;
      config = {...config, services: config.services.map(s => s.id === row.service_id ? {...s, durationMinutes: snapshot.service.durationMinutes, bufferBeforeMinutes: snapshot.service.bufferBeforeMinutes, bufferAfterMinutes: snapshot.service.bufferAfterMinutes} : s)};
    }
    const reservations = await new SchedulingEngine(this.db, this.site, this.calendars).reservations({start: Date.parse(query.startsAt) - 240 * minute, end: Date.parse(query.endsAt) + 960 * minute}, query.appointmentId);
    const service = original?.service ?? config.services.find(s => s.id === query.serviceId && s.providerIds.length > 0);
    const terms = service ? {durationMinutes: service.durationMinutes, bufferBeforeMinutes: service.bufferBeforeMinutes, bufferAfterMinutes: service.bufferAfterMinutes, price: service.price, bookingMode: original?.bookingMode ?? (service.bookingMode === 'inherit' ? config.defaultBookingMode : service.bookingMode)} : undefined;
    return {schemaVersion: 1 as const, revision: state.revision, ...availability(config, query, reservations, Date.now()), terms, location: config.locations.find(l => l.id === query.locationId)};
  }
  private async receipt(key: string, digest: string): Promise<SchedulingMutationResponse | null> {
    const row = await this.db.prepare('SELECT actor_id,request_hash,response_json FROM scheduling_commands WHERE site_id=? AND command_key=?').bind(this.site, key).first<Receipt>();
    if (!row) return null;
    if (row.actor_id !== this.user.id || row.request_hash !== digest) throw new SchedulingError(409, 'idempotency_conflict', 'This command key was already used for another request.');
    const response = JSON.parse(row.response_json) as SchedulingMutationResponse;
    await this.appointment(response.id); // Reauthorize the current assignment before replaying a receipt.
    return response;
  }
  private jobs(id: string, revision: number, action: string): D1PreparedStatement[] {
    return (['notification', 'calendar'] as const).map(kind => this.db.prepare('INSERT INTO scheduling_jobs(site_id,id,appointment_id,appointment_revision,kind,action,created_at) VALUES(?,?,?,?,?,?,?)').bind(this.site, crypto.randomUUID(), id, revision, kind, action, Date.now()));
  }
  private async commit(key: string, digest: string, expectedRevision: number, id: string, revision: number, action: string, targets: string[], statements: D1PreparedStatement[]): Promise<SchedulingMutationResponse> {
    const response: SchedulingMutationResponse = {ok: true, id, revision, scheduleRevision: expectedRevision + 1};
    try {
      await this.db.batch([this.guard(key, 'appointment', digest, expectedRevision, response, targets), ...statements, ...this.jobs(id, revision, action), ...this.history(action, revision, id)]);
    } catch (error) {
      const prior = await this.receipt(key, digest);
      if (prior) return this.finish(prior);
      return this.translate(error);
    }
    return this.finish(response);
  }
  private async finish(response: SchedulingMutationResponse) {
    if (this.calendars) {
      try {await this.calendars.capture(dto(await this.row(response.id)));} catch { /* Captured jobs remain available for recovery. */ }
      try {await this.calendars.afterAppointment(response.id);} catch { /* Native commitment is authoritative; external failures remain visible. */ }
    }
    return response;
  }
  private selectedTime(...args: Parameters<SchedulingEngine['selectedTime']>) {return new SchedulingEngine(this.db, this.site, this.calendars).selectedTime(...args);}
  async create(request: CreateAppointmentRequest): Promise<SchedulingMutationResponse> {
    let state = await this.context(); requireScheduling(state.access, 'appointments:write'); requireProvider(state.access, request.providerId);
    const digest = await hash({action: 'create', request});
    const prior = await this.receipt(request.idempotencyKey, digest); if (prior) return this.finish(prior);
    await this.calendars?.beforeAvailability([request.providerId], true);
    if (this.calendars) {state = await this.context(); requireScheduling(state.access, 'appointments:write'); requireProvider(state.access, request.providerId);}
    if (state.revision !== request.revision) throw conflict();
    if (state.config.mode !== 'test') throw new SchedulingError(409, 'disabled', 'Scheduling is disabled.');
    const time = await this.selectedTime(state.config, request.serviceId, request.locationId, request.providerId, request.startsAt);
    const status = time.snapshot.bookingMode === 'approval' ? 'pending_approval' : 'confirmed';
    const expiresAt = status === 'pending_approval' ? Math.min(time.start, Date.now() + state.config.approvalTtlMinutes * minute) : null;
    const id = crypto.randomUUID();
    return this.commit(request.idempotencyKey, digest, request.revision, id, 1, 'Created appointment', [request.providerId], [
      this.db.prepare('INSERT INTO scheduling_appointments(site_id,id,service_id,location_id,provider_id,starts_at,ends_at,occupied_starts_at,occupied_ends_at,status,expires_at,customer_json,snapshot_json,revision,schedule_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)').bind(this.site, id, request.serviceId, request.locationId, request.providerId, time.start, time.end, time.occupiedStart, time.occupiedEnd, status, expiresAt, JSON.stringify(request.customer), JSON.stringify(time.snapshot), request.revision + 1, Date.now(), Date.now()),
    ]);
  }
  async changeStatus(id: string, request: AppointmentStatusRequest): Promise<SchedulingMutationResponse> {
    let state = await this.context(); requireScheduling(state.access, 'appointments:write');
    const row = await this.row(id); requireProvider(state.access, row.provider_id);
    const digest = await hash({action: 'status', id, request});
    const prior = await this.receipt(request.idempotencyKey, digest); if (prior) return this.finish(prior);
    if (request.status === 'confirmed') {await this.calendars?.beforeAvailability([row.provider_id], true); if (this.calendars) {state = await this.context(); requireScheduling(state.access, 'appointments:write'); requireProvider(state.access, row.provider_id);}}
    if (state.revision !== request.revision || row.revision !== request.appointmentRevision) throw conflict();
    const expired = row.status === 'pending_approval' && row.expires_at! <= Date.now();
    const allowed = row.status === 'pending_approval' ? (expired ? ['expired', 'cancelled'] : ['confirmed', 'declined', 'cancelled']) : row.status === 'confirmed' ? ['cancelled', 'completed', 'no_show'] : [];
    if (!allowed.includes(request.status)) throw new SchedulingError(409, 'invalid_transition', 'This appointment status change is not allowed.');
    if (['completed', 'no_show'].includes(request.status) && row.starts_at > Date.now()) throw new SchedulingError(409, 'invalid_transition', 'A future appointment cannot be marked completed or no-show.');
    return this.commit(request.idempotencyKey, digest, request.revision, id, row.revision + 1, `Appointment ${request.status}`, [row.provider_id], [
      this.db.prepare('UPDATE scheduling_appointments SET status=?,expires_at=NULL,revision=revision+1,schedule_revision=?,updated_at=? WHERE site_id=? AND id=?').bind(request.status, request.revision + 1, Date.now(), this.site, id),
    ]);
  }
  async reschedule(id: string, request: RescheduleAppointmentRequest): Promise<SchedulingMutationResponse> {
    let state = await this.context(); requireScheduling(state.access, 'appointments:write');
    const row = await this.row(id); requireProvider(state.access, row.provider_id); requireProvider(state.access, request.providerId);
    const digest = await hash({action: 'reschedule', id, request});
    const prior = await this.receipt(request.idempotencyKey, digest); if (prior) return this.finish(prior);
    await this.calendars?.beforeAvailability([request.providerId], true);
    if (this.calendars) {state = await this.context(); requireScheduling(state.access, 'appointments:write'); requireProvider(state.access, row.provider_id); requireProvider(state.access, request.providerId);}
    if (state.revision !== request.revision || row.revision !== request.appointmentRevision) throw conflict();
    if (!['confirmed', 'pending_approval'].includes(row.status) || (row.expires_at !== null && row.expires_at <= Date.now())) throw new SchedulingError(409, 'invalid_transition', 'Only active appointments can be rescheduled.');
    const time = await this.selectedTime(state.config, row.service_id, request.locationId, request.providerId, request.startsAt, id, JSON.parse(row.snapshot_json) as AppointmentSnapshot);
    // This authenticated action is a staff decision, not a customer request for approval.
    const expiresAt = row.status === 'pending_approval' ? Math.min(time.start, row.expires_at!) : null;
    return this.commit(request.idempotencyKey, digest, request.revision, id, row.revision + 1, 'Rescheduled appointment', [row.provider_id, request.providerId], [
      this.db.prepare('UPDATE scheduling_appointments SET location_id=?,provider_id=?,starts_at=?,ends_at=?,occupied_starts_at=?,occupied_ends_at=?,expires_at=?,snapshot_json=?,revision=revision+1,schedule_revision=?,updated_at=? WHERE site_id=? AND id=?').bind(request.locationId, request.providerId, time.start, time.end, time.occupiedStart, time.occupiedEnd, expiresAt, JSON.stringify(time.snapshot), request.revision + 1, Date.now(), this.site, id),
    ]);
  }
  async historyFor(id: string) {
    await this.appointment(id);
    let guest: {action: string; actor_id: string; revision: number; created_at: number}[] = [];
    try {guest = (await this.db.prepare("SELECT action,'website-customer' AS actor_id,revision,created_at FROM booking_history WHERE site_id=? AND appointment_id=?").bind(this.site,id).all<{action:string;actor_id:string;revision:number;created_at:number}>()).results;} catch(error) {if(!(error instanceof Error) || !/no such table: booking_history/.test(error.message)) throw error;}
    let system: {action:string;actor_id:string;revision:number;created_at:number}[] = [];
    try {system = (await this.db.prepare("SELECT action,'scheduling-system' AS actor_id,revision,created_at FROM scheduling_system_history WHERE site_id=? AND appointment_id=?").bind(this.site,id).all<{action:string;actor_id:string;revision:number;created_at:number}>()).results;} catch(error) {if(!(error instanceof Error)||!/no such table: scheduling_system_history/.test(error.message))throw error;}
    const staff = (await this.db.prepare('SELECT action,actor_id,revision,created_at FROM scheduling_history WHERE site_id=? AND appointment_id=? ORDER BY revision,id LIMIT 200').bind(this.site,id).all<{action:string;actor_id:string;revision:number;created_at:number}>()).results;
    return {rows: [...guest,...system,...staff].sort((a,b)=>a.revision-b.revision).slice(0,200)};
  }
  async capturedJobs() {
    const state = await this.context(); requireScheduling(state.access, 'scheduling:configure');
    return {delivery: 'captured', rows: (await this.db.prepare('SELECT id,appointment_id,appointment_revision,kind,action,status FROM scheduling_jobs WHERE site_id=? ORDER BY created_at,id LIMIT 200').bind(this.site).all()).results};
  }
}
