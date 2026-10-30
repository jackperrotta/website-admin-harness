/** Versioned scheduling DTOs contain no deployment or provider credentials. */
export const schedulingContractVersion = 1;
export const schedulingPermissions = ['appointments:read', 'appointments:write', 'availability:write', 'scheduling:configure', 'calendar-connections:manage'] as const;
export type SchedulingPermission = typeof schedulingPermissions[number];
export type BookingMode = 'instant' | 'approval';
export type SchedulingMode = 'disabled' | 'test';
export type CalendarProvider = 'google' | 'microsoft';
export type CalendarConnectionHealth = 'disconnected' | 'connecting' | 'healthy' | 'stale' | 'reauthorization_required' | 'error';
export type AppointmentStatus = 'pending_approval' | 'confirmed' | 'declined' | 'expired' | 'cancelled' | 'completed' | 'no_show';
export const appointmentStatuses: readonly AppointmentStatus[] = ['pending_approval', 'confirmed', 'declined', 'expired', 'cancelled', 'completed', 'no_show'];

export interface SchedulingLocation {id: string; name: string; timezone: string; active: boolean}
export interface SchedulingResource {
  id: string; name: string; kind: 'provider' | 'room' | 'bay' | 'equipment';
  locationIds: string[]; active: boolean; userId?: string;
}
export interface SchedulingService {
  id: string; name: string; active: boolean; durationMinutes: number;
  bufferBeforeMinutes: number; bufferAfterMinutes: number;
  bookingMode: BookingMode | 'inherit'; locationMode: 'business' | 'phone' | 'video' | 'customer';
  locationIds: string[]; providerIds: string[]; resourceIds: string[];
  price: {amountMinor: number | null; currency: string; label: string};
}
/** Overnight hours are represented by two windows on adjacent weekdays. */
export interface SchedulingWeeklyHours {locationId: string; resourceId?: string; weekday: number; startMinute: number; endMinute: number}
export interface SchedulingException {id: string; locationId: string; resourceId?: string; startsAt: string; endsAt: string; kind: 'open' | 'closed'}
export interface SchedulingGrant {userId: string; scope: 'all' | 'own'; permissions: SchedulingPermission[]}
export interface SchedulingConfig {
  schemaVersion: 1; mode: SchedulingMode; defaultBookingMode: BookingMode;
  minNoticeMinutes: number; horizonDays: number; slotStepMinutes: number; approvalTtlMinutes: number;
  locations: SchedulingLocation[]; resources: SchedulingResource[]; services: SchedulingService[];
  weeklyHours: SchedulingWeeklyHours[]; exceptions: SchedulingException[]; grants: SchedulingGrant[];
  notifications?: {enabled: boolean; mode: 'capture' | 'send'; reminders?: {enabled: boolean; offsetsMinutes: number[]}};
  customerManagement?: {enabled: boolean; cancellationCutoffMinutes: number; rescheduleCutoffMinutes: number};
  publicBooking?: {enabled: boolean; serviceIds: string[]; allowProviderChoice: boolean; policyText: string};
}
export interface SchedulingConfigurationResponse {schemaVersion: 1; revision: number; config: SchedulingConfig}
export interface SchedulingCustomer {name: string; email: string; phone: string}
export interface CreateAppointmentRequest {
  idempotencyKey: string; revision: number; serviceId: string; locationId: string; providerId: string;
  startsAt: string; customer: SchedulingCustomer;
}
export interface RescheduleAppointmentRequest {
  idempotencyKey: string; revision: number; appointmentRevision: number;
  locationId: string; providerId: string; startsAt: string;
}
export interface AppointmentStatusRequest {
  idempotencyKey: string; revision: number; appointmentRevision: number; status: AppointmentStatus;
}
export interface SchedulingMutationResponse {ok: true; id: string; revision: number; scheduleRevision: number}
export interface AppointmentSnapshot {
  service: SchedulingService; location: SchedulingLocation; resourceIds: string[];
  bookingMode: BookingMode; approvalTtlMinutes: number;
  customerManagement?: SchedulingConfig['customerManagement'];
}
export interface SchedulingAppointment {
  id: string; title: string; serviceId: string; locationId: string; providerId: string;
  startsAt: string; endsAt: string; occupiedStartsAt: string; occupiedEndsAt: string;
  status: AppointmentStatus; expiresAt: string | null; customer: SchedulingCustomer;
  revision: number; snapshot: AppointmentSnapshot; mode: 'test';
  source?: 'website' | 'staff' | 'unknown';
  acceptedPolicy?: string;
}
export interface SchedulingSummary {
  schemaVersion: 1; mode: SchedulingMode; revision: number; generatedAt: string; through: string;
  upcoming: number; pendingApproval: number; next: SchedulingAppointment[];
}
export interface BookingReadiness {
  ready: boolean; mode: SchedulingMode; simulated: boolean;
  checks: {id: string; ready: boolean; detail: string}[];
  connection: {version: 1; enabled: true; apiOrigin: string; siteId: string; installationId: string; route: string};
  siteOrigin: string;
}
export interface SchedulingAvailabilityQuery {serviceId: string; locationId: string; providerId?: string; appointmentId?: string; startsAt: string; endsAt: string}
export interface SchedulingSlot {startsAt: string; endsAt: string; providerId: string; timezone: string}
export interface SchedulingAvailabilityResponse {
  schemaVersion: 1; revision: number; slots: SchedulingSlot[]; truncated: boolean;
  terms?: Pick<SchedulingService, 'durationMinutes' | 'bufferBeforeMinutes' | 'bufferAfterMinutes' | 'price'> & {bookingMode: BookingMode};
  location?: SchedulingLocation;
}
export interface SchedulingStatusResponse {
  schemaVersion: 1; revision: number; mode: SchedulingMode; publicBooking: boolean; calendarSync: boolean;
  deliveries: 'captured' | 'email'; scope: 'all' | 'own'; permissions: SchedulingPermission[];
}
export interface SchedulingCatalog {
  locations: SchedulingLocation[]; resources: Omit<SchedulingResource, 'userId'>[];
  services: SchedulingService[]; defaultBookingMode: BookingMode;
}
export interface SchedulingWorkspaceResponse {
  status: SchedulingStatusResponse; catalog: SchedulingCatalog;
  configuration?: SchedulingConfigurationResponse;
  accounts?: {id: string; email: string; active: number}[]; accountsTruncated?: boolean;
}
export interface CalendarConnection {
  id: string; resourceId: string; provider: CalendarProvider; accountLabel: string; enabled: boolean;
  health: CalendarConnectionHealth; revision: number; blocking: string[]; destination: string | null;
  lastSyncedAt: number | null; errorCode: string | null; pendingJobs: number; conflicts: number;
}
export interface CalendarConnectionsResponse {
  simulated: boolean; enabled: boolean; schemaReady: boolean;
  providers: {id: CalendarProvider; configured: boolean; callbackUrl: string}[];
  connections: CalendarConnection[];
  conflicts: {connectionId: string; appointmentId: string; reason: string}[];
}
export interface SchedulingAppointmentList {rows: SchedulingAppointment[]; revision: number; truncated: boolean; message?: string}
export interface SchedulingResourceAvailability {schemaVersion: 1; revision: number; resourceId: string; weeklyHours: SchedulingWeeklyHours[]; exceptions: SchedulingException[]}
export interface SchedulingHistoryResponse {rows: {action: string; actor_id: string; revision: number; created_at: number}[]}

export class SchedulingValidationError extends Error {}
function invalid(message: string): never {throw new SchedulingValidationError(message);}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Expected an object');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key))) return invalid('Unknown scheduling field');
  return record;
}
function text(value: unknown, name: string, limit: number, empty = false): string {
  if (typeof value !== 'string' || value.length > limit || (!empty && !value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) return invalid(`Invalid ${name}`);
  return value.trim();
}
function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return invalid(`Invalid ${name}`);
  return value;
}
function choice<const T extends readonly string[]>(value: unknown, values: T, name: string): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) return invalid(`Invalid ${name}`);
  return value as T[number];
}
function boolean(value: unknown): boolean {if (typeof value !== 'boolean') return invalid('Expected a boolean'); return value;}
export function schedulingId(value: unknown): string {
  const result = text(value, 'ID', 64);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(result)) return invalid('Invalid ID');
  return result;
}
function list<T>(value: unknown, max: number, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) return invalid('Invalid scheduling list');
  return value.map(parse);
}
function ids(value: unknown, max: number, required = false): string[] {
  const result = list(value, max, schedulingId);
  if ((required && !result.length) || new Set(result).size !== result.length) return invalid('Missing or duplicate IDs');
  return result;
}
function unique<T>(items: T[], id: (item: T) => string): T[] {
  if (new Set(items.map(id)).size !== items.length) return invalid('Duplicate scheduling record');
  return items;
}
export function schedulingInstant(value: unknown): string {
  const result = text(value, 'UTC minute timestamp', 24);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:00\.000Z$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) return invalid('Use an ISO UTC timestamp at a whole minute');
  return result;
}
export function schedulingRevision(value: unknown): number {return integer(value, 'revision', 0, Number.MAX_SAFE_INTEGER - 1);}
function command(value: Record<string, unknown>) {
  return {idempotencyKey: schedulingId(value.idempotencyKey), revision: schedulingRevision(value.revision)};
}
export function emptySchedulingConfig(): SchedulingConfig {
  return {schemaVersion: 1, mode: 'disabled', defaultBookingMode: 'instant', minNoticeMinutes: 0, horizonDays: 90, slotStepMinutes: 15, approvalTtlMinutes: 1440, locations: [], resources: [], services: [], weeklyHours: [], exceptions: [], grants: []};
}
export function parseSchedulingHours(value: unknown): SchedulingWeeklyHours {
  const v = object(value, ['locationId', 'resourceId', 'weekday', 'startMinute', 'endMinute']);
  const startMinute = integer(v.startMinute, 'start minute', 0, 1439), endMinute = integer(v.endMinute, 'end minute', 1, 1440);
  if (endMinute <= startMinute) return invalid('Split overnight hours into adjacent weekdays');
  return {locationId: schedulingId(v.locationId), ...(v.resourceId !== undefined ? {resourceId: schedulingId(v.resourceId)} : {}), weekday: integer(v.weekday, 'weekday', 0, 6), startMinute, endMinute};
}
export function parseSchedulingException(value: unknown): SchedulingException {
  const v = object(value, ['id', 'locationId', 'resourceId', 'startsAt', 'endsAt', 'kind']);
  const startsAt = schedulingInstant(v.startsAt), endsAt = schedulingInstant(v.endsAt);
  if (endsAt <= startsAt || Date.parse(endsAt) - Date.parse(startsAt) > 31 * 86400000) return invalid('An exception must be between one minute and 31 days');
  return {id: schedulingId(v.id), locationId: schedulingId(v.locationId), ...(v.resourceId !== undefined ? {resourceId: schedulingId(v.resourceId)} : {}), startsAt, endsAt, kind: choice(v.kind, ['open', 'closed'], 'exception kind')};
}
export function parseSchedulingConfig(value: unknown): SchedulingConfig {
  const v = object(value, ['schemaVersion', 'mode', 'defaultBookingMode', 'minNoticeMinutes', 'horizonDays', 'slotStepMinutes', 'approvalTtlMinutes', 'locations', 'resources', 'services', 'weeklyHours', 'exceptions', 'grants', 'publicBooking', 'notifications', 'customerManagement']);
  if (v.schemaVersion !== 1) return invalid('Unsupported scheduling contract version');
  const locations = unique(list(v.locations, 20, item => {
    const l = object(item, ['id', 'name', 'timezone', 'active']);
    const timezone = text(l.timezone, 'timezone', 100);
    try {new Intl.DateTimeFormat('en-US', {timeZone: timezone});} catch {return invalid('Invalid IANA timezone');}
    if (/^[+-]/.test(timezone)) return invalid('Use an IANA timezone, not a fixed offset');
    return {id: schedulingId(l.id), name: text(l.name, 'location name', 120), timezone, active: boolean(l.active)};
  }), l => l.id);
  const resources = unique(list(v.resources, 50, item => {
    const r = object(item, ['id', 'name', 'kind', 'locationIds', 'active', 'userId']);
    const kind = choice(r.kind, ['provider', 'room', 'bay', 'equipment'], 'resource kind');
    if (r.userId !== undefined && kind !== 'provider') return invalid('Only providers can link to accounts');
    return {id: schedulingId(r.id), name: text(r.name, 'resource name', 120), kind, locationIds: ids(r.locationIds, 20, true), active: boolean(r.active), ...(r.userId !== undefined ? {userId: schedulingId(r.userId)} : {})};
  }), r => r.id);
  const services = unique(list(v.services, 100, item => {
    const s = object(item, ['id', 'name', 'active', 'durationMinutes', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'bookingMode', 'locationMode', 'locationIds', 'providerIds', 'resourceIds', 'price']);
    const p = object(s.price, ['amountMinor', 'currency', 'label']);
    const currency = text(p.currency, 'currency', 3);
    if (!/^[A-Z]{3}$/.test(currency)) return invalid('Use a three-letter uppercase currency');
    return {id: schedulingId(s.id), name: text(s.name, 'service name', 160), active: boolean(s.active), durationMinutes: integer(s.durationMinutes, 'duration', 1, 720), bufferBeforeMinutes: integer(s.bufferBeforeMinutes, 'buffer', 0, 240), bufferAfterMinutes: integer(s.bufferAfterMinutes, 'buffer', 0, 240), bookingMode: choice(s.bookingMode, ['inherit', 'instant', 'approval'], 'booking mode'), locationMode: choice(s.locationMode, ['business', 'phone', 'video', 'customer'], 'location mode'), locationIds: ids(s.locationIds, 20, true), providerIds: ids(s.providerIds, 50, true), resourceIds: ids(s.resourceIds, 7), price: {amountMinor: p.amountMinor === null ? null : integer(p.amountMinor, 'price', 0, 100000000), currency, label: text(p.label, 'pricing label', 120, true)}};
  }), s => s.id);
  const weeklyHours = list(v.weeklyHours, 1000, parseSchedulingHours);
  const exceptions = unique(list(v.exceptions, 200, parseSchedulingException), e => e.id);
  const grants = unique(list(v.grants, 100, item => {
    const g = object(item, ['userId', 'scope', 'permissions']);
    const scope = choice(g.scope, ['all', 'own'], 'access scope');
    const permissions = unique(list(g.permissions, 5, p => choice(p, schedulingPermissions, 'scheduling permission')), p => p);
    if (!permissions.includes('appointments:read')) return invalid('Scheduling grants require appointment read access');
    if (scope === 'own' && permissions.includes('scheduling:configure')) return invalid('Own scope cannot configure the installation');
    return {userId: schedulingId(g.userId), scope, permissions};
  }), g => g.userId);
  const locationById = new Map(locations.map(l => [l.id, l]));
  const resourceById = new Map(resources.map(r => [r.id, r]));
  const locationRefs = (values: string[]) => {if (values.some(id => !locationById.has(id))) return invalid('Unknown scheduling location');};
  for (const r of resources) locationRefs(r.locationIds);
  for (const s of services) {
    locationRefs(s.locationIds);
    for (const id of s.providerIds) if (resourceById.get(id)?.kind !== 'provider') return invalid('Unknown eligible provider');
    for (const id of s.resourceIds) if (!resourceById.has(id) || resourceById.get(id)?.kind === 'provider') return invalid('Invalid required resource');
    for (const locationId of s.locationIds) {
      if (!s.providerIds.some(id => resourceById.get(id)!.locationIds.includes(locationId))) return invalid('Service location has no eligible provider');
      if (s.resourceIds.some(id => !resourceById.get(id)!.locationIds.includes(locationId))) return invalid('Required resource is unavailable at a service location');
    }
  }
  for (const h of [...weeklyHours, ...exceptions]) {
    locationRefs([h.locationId]);
    if (h.resourceId && !resourceById.get(h.resourceId)?.locationIds.includes(h.locationId)) return invalid('Availability resource does not belong to this location');
  }
  for (const g of grants) if (g.scope === 'own' && !resources.some(r => r.kind === 'provider' && r.userId === g.userId)) return invalid('Own access needs a linked provider');
  const result: SchedulingConfig = {schemaVersion: 1, mode: choice(v.mode, ['disabled', 'test'], 'scheduling mode (live booking is not available yet)'), defaultBookingMode: choice(v.defaultBookingMode, ['instant', 'approval'], 'booking mode'), minNoticeMinutes: integer(v.minNoticeMinutes, 'minimum notice', 0, 43200), horizonDays: integer(v.horizonDays, 'booking horizon', 1, 365), slotStepMinutes: integer(v.slotStepMinutes, 'start increment', 1, 60), approvalTtlMinutes: integer(v.approvalTtlMinutes, 'approval expiry', 1, 10080), locations, resources, services, weeklyHours, exceptions, grants};
  if (v.notifications !== undefined) {
    const n = object(v.notifications, ['enabled','mode','reminders']);
    result.notifications = {enabled: boolean(n.enabled), mode: choice(n.mode, ['capture','send'], 'email mode')};
    if (n.reminders !== undefined) {
      const r = object(n.reminders, ['enabled','offsetsMinutes']);
      if (!Array.isArray(r.offsetsMinutes) || r.offsetsMinutes.length < 1 || r.offsetsMinutes.length > 3) throw new SchedulingValidationError('Choose one to three reminder times.');
      const offsetsMinutes = r.offsetsMinutes.map(value => integer(value,'reminder lead time',1,43200));
      if (new Set(offsetsMinutes).size !== offsetsMinutes.length) throw new SchedulingValidationError('Reminder times must be different.');
      result.notifications.reminders = {enabled:boolean(r.enabled),offsetsMinutes:offsetsMinutes.sort((a,b)=>b-a)};
    }
  }
  if (v.customerManagement !== undefined) {
    const m = object(v.customerManagement, ['enabled','cancellationCutoffMinutes','rescheduleCutoffMinutes']);
    result.customerManagement = {enabled: boolean(m.enabled), cancellationCutoffMinutes: integer(m.cancellationCutoffMinutes,'cancellation notice',0,43200), rescheduleCutoffMinutes: integer(m.rescheduleCutoffMinutes,'rescheduling notice',0,43200)};
  }
  if (v.publicBooking !== undefined) {
    const p = object(v.publicBooking, ['enabled', 'serviceIds', 'allowProviderChoice', 'policyText']);
    const serviceIds = ids(p.serviceIds, 128);
    if (serviceIds.some(id => !services.some(s => s.id === id))) return invalid('Unknown published service');
    if (typeof p.policyText !== 'string' || p.policyText.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(p.policyText)) return invalid('Invalid booking policy');
    result.publicBooking = {enabled: boolean(p.enabled), serviceIds, allowProviderChoice: boolean(p.allowProviderChoice), policyText: p.policyText.replace(/\r\n?/g, '\n').trim()};
    if (result.publicBooking.enabled && (!serviceIds.length || !result.publicBooking.policyText)) return invalid('Publish at least one service and provide a booking policy');
  }
  if (JSON.stringify(result).length > 100000) return invalid('Scheduling configuration is too large');
  return result;
}
export function parseCreateAppointment(value: unknown): CreateAppointmentRequest {
  const v = object(value, ['idempotencyKey', 'revision', 'serviceId', 'locationId', 'providerId', 'startsAt', 'customer']);
  const c = object(v.customer, ['name', 'email', 'phone']);
  const email = text(c.email, 'customer email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid('Invalid customer email');
  return {...command(v), serviceId: schedulingId(v.serviceId), locationId: schedulingId(v.locationId), providerId: schedulingId(v.providerId), startsAt: schedulingInstant(v.startsAt), customer: {name: text(c.name, 'customer name', 160), email, phone: text(c.phone, 'customer phone', 40, true)}};
}
export function parseRescheduleAppointment(value: unknown): RescheduleAppointmentRequest {
  const v = object(value, ['idempotencyKey', 'revision', 'appointmentRevision', 'locationId', 'providerId', 'startsAt']);
  return {...command(v), appointmentRevision: schedulingRevision(v.appointmentRevision), locationId: schedulingId(v.locationId), providerId: schedulingId(v.providerId), startsAt: schedulingInstant(v.startsAt)};
}
export function parseAppointmentStatus(value: unknown): AppointmentStatusRequest {
  const v = object(value, ['idempotencyKey', 'revision', 'appointmentRevision', 'status']);
  return {...command(v), appointmentRevision: schedulingRevision(v.appointmentRevision), status: choice(v.status, appointmentStatuses, 'appointment status')};
}
export function parseSchedulingAvailability(value: unknown): SchedulingAvailabilityQuery {
  const v = object(value, ['serviceId', 'locationId', 'providerId', 'appointmentId', 'startsAt', 'endsAt']);
  const startsAt = schedulingInstant(v.startsAt), endsAt = schedulingInstant(v.endsAt);
  if (endsAt <= startsAt || Date.parse(endsAt) - Date.parse(startsAt) > 7 * 86400000) return invalid('Search between one minute and seven days');
  return {serviceId: schedulingId(v.serviceId), locationId: schedulingId(v.locationId), ...(v.providerId !== undefined ? {providerId: schedulingId(v.providerId)} : {}), ...(v.appointmentId !== undefined ? {appointmentId: schedulingId(v.appointmentId)} : {}), startsAt, endsAt};
}

export interface PublicBookingCatalog {
  schemaVersion: 1; siteId: string; installationId: string; siteOrigin: string; businessName: string; mode: 'test';
  revision: number; horizonDays: number; minNoticeMinutes: number; policyText: string; allowProviderChoice: boolean;
  emailMode?: 'capture' | 'send' | 'disabled';
  customerManagement?: {cancellationCutoffMinutes:number;rescheduleCutoffMinutes:number};
  challenge: {kind: 'turnstile' | 'local-fixture'; siteKey?: string};
  services: {id: string; name: string; durationMinutes: number; price: SchedulingService['price']; bookingMode: BookingMode; locationMode: SchedulingService['locationMode']; locationIds: string[]; providerIds: string[]}[];
  locations: SchedulingLocation[]; providers: {id: string; name: string; locationIds: string[]}[];
}
export interface PublicBookingRequest extends CreateAppointmentRequest {acceptedPolicy: true; challengeToken: string; company: string}
export interface PublicBookingReceipt {
  schemaVersion: 1; siteId: string; mode: 'test'; reference: string; status: 'confirmed' | 'pending_approval';
  serviceName: string; startsAt: string; endsAt: string; providerName: string; locationName: string; timezone: string;
  price: SchedulingService['price']; policyText: string; expiresAt: string | null; delivery: 'captured' | 'queued';
  calendar: {filename: string; contentType: string; content: string};
  emailStatus?: string;
}
export function parsePublicBooking(value: unknown): PublicBookingRequest {
  const v = object(value, ['idempotencyKey', 'revision', 'serviceId', 'locationId', 'providerId', 'startsAt', 'customer', 'acceptedPolicy', 'challengeToken', 'company']);
  if (typeof v.idempotencyKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.idempotencyKey)) return invalid('Use a unique booking attempt identifier');
  if (v.acceptedPolicy !== true) return invalid('Accept the booking policy before continuing');
  const request = parseCreateAppointment(Object.fromEntries(['idempotencyKey','revision','serviceId','locationId','providerId','startsAt','customer'].map(key=>[key,v[key]])));
  return {...request, acceptedPolicy: true, challengeToken: text(v.challengeToken, 'security check', 2048, true), company: text(v.company, 'company', 160, true)};
}
export function parsePublicAvailability(value: unknown): SchedulingAvailabilityQuery {
  const v = object(value, ['serviceId','locationId','providerId','startsAt','endsAt']);
  return parseSchedulingAvailability(v);
}

export interface CustomerAppointment {
  schemaVersion: 1; reference: string; status: AppointmentStatus; revision: number; scheduleRevision: number;
  serviceName: string; startsAt: string; endsAt: string; timezone: string; locationName: string; providerName: string;
  horizonDays: number; expiresAt: string | null; emailStatus?: string;
  price: SchedulingService['price']; policyText: string; canCancel: boolean; canReschedule: boolean;
  cancellationDeadline: string | null; rescheduleDeadline: string | null; calendar: {filename:string;contentType:string;content:string};
}
export interface CustomerCommand {idempotencyKey:string;revision:number;appointmentRevision:number;startsAt?:string}
export function parseCustomerCommand(value:unknown, reschedule=false):CustomerCommand {
  const v=object(value,reschedule?['idempotencyKey','revision','appointmentRevision','startsAt']:['idempotencyKey','revision','appointmentRevision']);
  if(typeof v.idempotencyKey!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.idempotencyKey))return invalid('Use a unique appointment command identifier');
  return {...command(v),appointmentRevision:schedulingRevision(v.appointmentRevision),...(reschedule?{startsAt:schedulingInstant(v.startsAt)}:{})};
}
