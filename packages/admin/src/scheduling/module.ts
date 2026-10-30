import {NotificationService} from './notifications.ts';
import type {ModuleContext} from '../worker.ts';
import type {ModuleDefinition, User} from '../../../contracts/src/index.ts';
import {
  schedulingId, schedulingRevision, schedulingInstant, parseSchedulingConfig,
  parseCreateAppointment, parseRescheduleAppointment, parseAppointmentStatus, parseSchedulingAvailability,
  parseSchedulingHours, parseSchedulingException, SchedulingValidationError,
  type SchedulingStatusResponse, type SchedulingWorkspaceResponse,
} from '../../../contracts/src/scheduling.ts';
import {SchedulingStore, SchedulingError, requireScheduling, requireProvider} from './store.ts';
import {CalendarService} from './calendars/service.ts';
import {CalendarError} from './calendars/types.ts';
import {PublicBooking} from './public.ts';
import {appointmentCalendar, calendarAttachment} from './calendars/ics.ts';

export const schedulingModule: ModuleDefinition = {
  id: 'scheduling', version: 1, label: 'Scheduling', permission: 'appointments:read',
  description: 'Appointment scheduling foundation with isolated test records and captured jobs.',
};
export async function hasSchedulingAccess(db: D1Database, siteId: string, user: User) {
  const state = await new SchedulingStore(db, siteId, user).context();
  return state.access.permissions.includes('appointments:read');
}
const json = (value: unknown, status = 200) => Response.json(value, {status});
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new SchedulingValidationError('Invalid scheduling request');
  return value as Record<string, unknown>;
}
async function body(request: Request, max: number) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new SchedulingError(415, 'json_required', 'JSON is required.');
  const reader = request.body?.getReader();
  if (!reader) throw new SchedulingValidationError('Request body is required');
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const {done, value} = await reader.read(); if (done) break;
    length += value.length;
    if (length > max) {await reader.cancel(); throw new SchedulingError(413, 'body_too_large', 'Scheduling request is too large.');}
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
  try {return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)) as unknown;} catch {throw new SchedulingValidationError('Invalid JSON');}
}
export async function handleScheduling({request, env, manifest, user}: ModuleContext): Promise<Response> {
  try {
    const url = new URL(request.url), path = url.pathname.slice('/api/modules/scheduling'.length);
    const calendars = new CalendarService(env, manifest);
    const notifications = new NotificationService(env, manifest);
    const effects = {beforeAvailability: calendars.beforeAvailability.bind(calendars), busy: calendars.busy.bind(calendars), capture: calendars.capture.bind(calendars), afterAppointment: async (id: string) => {try {await calendars.afterAppointment(id);} finally {await notifications.afterAppointment(id);}}};
    const store = new SchedulingStore(env.DB, manifest.site.id, user, effects);
    const state = await store.context(); requireScheduling(state.access, 'appointments:read');
    if (request.method === 'GET') {
      if (path === '/summary') return json(await store.summary());
      if (path === '/booking-readiness') {
        requireScheduling(state.access, 'scheduling:configure');
        return json(await new PublicBooking(env, manifest).readiness(state.config, await calendars.list(user)));
      }
      if (path === '/workspace') {
        const calendarStatus = await calendars.list(user);
        const all = state.access.scope === 'all';
        const services = state.config.services.map(s => ({...s, providerIds: all ? s.providerIds : s.providerIds.filter(id => state.access.providerIds.includes(id))})).filter(s => all || s.providerIds.length);
        const resourceIds = new Set(services.flatMap(s => [...s.providerIds, ...s.resourceIds]));
        const locationIds = new Set(services.flatMap(s => s.locationIds));
        const result: SchedulingWorkspaceResponse = {
          status: {schemaVersion: 1, revision: state.revision, mode: state.config.mode, publicBooking: env.BOOKING_ENABLED === '1' && !!state.config.publicBooking?.enabled, calendarSync: calendarStatus.providers.some(p => p.configured), deliveries: state.config.notifications?.enabled && state.config.notifications.mode === 'send' ? 'email' : 'captured', scope: state.access.scope, permissions: state.access.permissions},
          catalog: {defaultBookingMode: state.config.defaultBookingMode, services, locations: state.config.locations.filter(l => all || locationIds.has(l.id) || state.config.resources.some(r => state.access.providerIds.includes(r.id) && r.locationIds.includes(l.id))), resources: state.config.resources.filter(r => all || state.access.providerIds.includes(r.id) || resourceIds.has(r.id)).map(({userId, ...resource}) => resource)},
        };
        if (state.access.permissions.includes('scheduling:configure')) {
          result.configuration = {schemaVersion: 1, revision: state.revision, config: state.config};
          const accounts = (await env.DB.prepare('SELECT id,email,active FROM users ORDER BY email LIMIT 201').all<{id: string; email: string; active: number}>()).results;
          result.accounts = accounts.slice(0, 200); result.accountsTruncated = accounts.length > 200;
        }
        return json(result);
      }
      if (path === '/status') return json({schemaVersion: 1, revision: state.revision, mode: state.config.mode, publicBooking: env.BOOKING_ENABLED === '1' && !!state.config.publicBooking?.enabled, calendarSync: (await calendars.list(user)).providers.some(p => p.configured), deliveries: state.config.notifications?.enabled && state.config.notifications.mode === 'send' ? 'email' : 'captured', scope: state.access.scope, permissions: state.access.permissions} satisfies SchedulingStatusResponse);
      if (path === '/connections') return json(await calendars.list(user));
      if (path === '/notifications') return json(await notifications.list(user));
      const notificationDocument = path.match(/^\/notifications\/([a-zA-Z0-9_-]+)\/document$/);
      if (notificationDocument) {const value = await notifications.preview(user,schedulingId(notificationDocument[1]));return new Response(value.message.html,{headers:{'content-type':'text/html; charset=utf-8'}});}
      const notification = path.match(/^\/notifications\/([a-zA-Z0-9_-]+)$/);
      if (notification) return json(await notifications.preview(user, schedulingId(notification[1])));
      const connectionCalendars = path.match(/^\/connections\/([a-zA-Z0-9_-]+)\/calendars$/);
      if (connectionCalendars) return json(await calendars.calendars(user, schedulingId(connectionCalendars[1])));
      if (path === '/configuration') {requireScheduling(state.access, 'scheduling:configure'); return json({schemaVersion: 1, revision: state.revision, config: state.config});}
      if (path === '/jobs') return json(await store.capturedJobs());
      if (path === '/availability') return json(await store.available(parseSchedulingAvailability(Object.fromEntries(url.searchParams))));
      if (path === '/availability-settings') {
        requireScheduling(state.access, 'availability:write');
        const resourceId = schedulingId(url.searchParams.get('resourceId')); requireProvider(state.access, resourceId);
        if (!state.config.resources.some(r => r.id === resourceId)) throw new SchedulingError(404, 'not_found', 'Resource not found.');
        return json({schemaVersion: 1, revision: state.revision, resourceId, weeklyHours: state.config.weeklyHours.filter(h => h.resourceId === resourceId), exceptions: state.config.exceptions.filter(e => e.resourceId === resourceId)});
      }
      const calendarFile = path.match(/^\/appointments\/([a-zA-Z0-9_-]+)\/(calendar\.ics|notification)$/);
      if (calendarFile) {
        const appointment = await store.appointment(schedulingId(calendarFile[1]));
        if (calendarFile[2] === 'notification') return json({delivery: 'captured', appointmentRevision: appointment.revision, attachments: [await calendarAttachment(appointment, manifest.site.id, manifest.adminOrigin)]});
        return new Response(await appointmentCalendar(appointment, manifest.site.id, manifest.adminOrigin), {headers: {'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `attachment; filename="appointment-${appointment.id}.ics"`}});
      }
      const match = path.match(/^\/appointments\/([a-zA-Z0-9_-]+)(\/history)?$/);
      if (match) return json(match[2] ? await store.historyFor(schedulingId(match[1])) : await store.appointment(schedulingId(match[1])));
      if (path === '' || path === '/appointments') {
        const now = Math.floor(Date.now() / 60000) * 60000;
        const start = url.searchParams.has('startsAt') ? Date.parse(schedulingInstant(url.searchParams.get('startsAt'))) : now - 7 * 86400000;
        const end = url.searchParams.has('endsAt') ? Date.parse(schedulingInstant(url.searchParams.get('endsAt'))) : now + 24 * 86400000;
        if (end <= start || end - start > 31 * 86400000) throw new SchedulingValidationError('List between one minute and 31 days');
        return json(await store.appointments(start, end));
      }
    } else if (request.method === 'POST') {
      const notificationRetry = path.match(/^\/notifications\/([a-zA-Z0-9_-]+)\/retry$/);
      if (notificationRetry) {const input = record(await body(request,8192), ['acknowledge']); return json(await notifications.retry(user,schedulingId(notificationRetry[1]),input.acknowledge === true));}
      if (path === '/connections/start') {
        const data = record(await body(request, 8192), ['provider', 'resourceId']);
        if (!['google', 'microsoft'].includes(String(data.provider))) throw new SchedulingValidationError('Choose Google or Microsoft.');
        return calendars.begin(user, schedulingId(data.resourceId), data.provider as 'google' | 'microsoft');
      }
      const connectionCommand = path.match(/^\/connections\/([a-zA-Z0-9_-]+)\/(select|disconnect|sync|restore)$/);
      if (connectionCommand) {
        const id = schedulingId(connectionCommand[1]), action = connectionCommand[2];
        const data = record(await body(request, 16384), action === 'select' ? ['revision', 'blocking', 'destination', 'acknowledge'] : action === 'disconnect' ? ['revision', 'acknowledge'] : action === 'restore' ? ['appointmentId', 'acknowledge'] : []);
        if (action === 'sync') return json(await calendars.retry(user, id));
        if (action === 'disconnect') return json(await calendars.disconnect(user, id, schedulingRevision(data.revision), data.acknowledge === true));
        if (action === 'restore') return json(await calendars.restore(user, id, schedulingId(data.appointmentId), data.acknowledge === true));
        if (!Array.isArray(data.blocking) || data.blocking.length > 5 || data.blocking.some(c => typeof c !== 'string' || !c || c.length > 2048) || typeof data.destination !== 'string' || !data.destination || data.destination.length > 2048) throw new SchedulingValidationError('Choose at most five blocking calendars and one appointment destination.');
        return json(await calendars.select(user, id, schedulingRevision(data.revision), {blocking: data.blocking as string[], destination: data.destination}, data.acknowledge === true));
      }
      if (path === '/configuration') {
        requireScheduling(state.access, 'scheduling:configure');
        const v = record(await body(request, 131072), ['revision', 'config']);
        return json(await store.saveConfiguration(parseSchedulingConfig(v.config), schedulingRevision(v.revision)));
      }
      if (path === '/availability-settings') {
        requireScheduling(state.access, 'availability:write');
        const v = record(await body(request, 65536), ['revision', 'resourceId', 'weeklyHours', 'exceptions']);
        if (!Array.isArray(v.weeklyHours) || v.weeklyHours.length > 1000 || !Array.isArray(v.exceptions) || v.exceptions.length > 200) throw new SchedulingValidationError('Invalid availability settings');
        return json(await store.saveResourceAvailability(schedulingId(v.resourceId), v.weeklyHours.map(parseSchedulingHours), v.exceptions.map(parseSchedulingException), schedulingRevision(v.revision)));
      }
      if (path === '/appointments') {if(state.config.notifications?.enabled)await notifications.requireSchema();return json(await store.create(parseCreateAppointment(await body(request, 8192))), 201);}
      const match = path.match(/^\/appointments\/([a-zA-Z0-9_-]+)\/(status|reschedule)$/);
      if (match) {
        requireScheduling(state.access, 'appointments:write');
        const input = await body(request, 8192), id = schedulingId(match[1]);
        return json(match[2] === 'status' ? await store.changeStatus(id, parseAppointmentStatus(input)) : await store.reschedule(id, parseRescheduleAppointment(input)));
      }
    } else return json({code: 'method_not_allowed', error: 'Use GET or POST.'}, 405);
    return json({code: 'not_found', error: 'Scheduling route not found.'}, 404);
  } catch (error) {
    if (error instanceof CalendarError) return json({code: error.code, error: error.message}, error.status);
    if (error instanceof Error && error.message.includes('calendar_forbidden')) return json({code: 'calendar_forbidden', error: 'Calendar access changed. Reopen the connection before trying again.'}, 403);
    if (error instanceof Error && error.message.includes('calendar_stale_connection')) return json({code: 'calendar_stale_connection', error: 'The calendar connection changed or is syncing. Reload before trying again.'}, 409);
    if (error instanceof SchedulingError) return json({code: error.code, error: error.message}, error.status);
    if (error instanceof SchedulingValidationError) return json({code: 'invalid_request', error: error.message}, 400);
    if (error instanceof Error && /no such table: scheduling_/.test(error.message)) return json({code: 'schema_unavailable', error: 'Apply the reviewed scheduling migration to this installation before enabling the module.'}, 503);
    throw error;
  }
}
