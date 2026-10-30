import type {SchedulingConfig, SchedulingAvailabilityQuery, AppointmentSnapshot} from '../../../contracts/src/scheduling.ts';
import {availability, eligibleResources, minute, type ResourceReservation} from './availability.ts';
import type {SchedulingCalendars} from './store.ts';
import {SchedulingError} from './errors.ts';
const iso = (at: number) => new Date(at).toISOString();
/** Shared calculations; callers supply and transactionally enforce their own authority. */
export class SchedulingEngine {
  constructor(private db: D1Database, private site: string, private calendars?: SchedulingCalendars) {}
  async reservations(range: {start: number; end: number}, omitAppointment?: string): Promise<ResourceReservation[]> {
    const rows = (await this.db.prepare('SELECT resource_id,appointment_id,starts_at,ends_at FROM scheduling_reservations WHERE site_id=? AND starts_at<? AND ends_at>? AND (expires_at IS NULL OR expires_at>?) AND appointment_id<>?').bind(this.site, range.end, range.start, Date.now(), omitAppointment ?? '').all<{resource_id: string; appointment_id: string; starts_at: number; ends_at: number}>()).results;
    return [...rows.map(r => ({resourceId: r.resource_id, appointmentId: r.appointment_id, start: r.starts_at, end: r.ends_at})), ...await this.calendars?.busy(range.start, range.end) ?? []];
  }
  async selectedTime(config: SchedulingConfig, serviceId: string, locationId: string, providerId: string, startsAt: string, omitAppointment?: string, original?: AppointmentSnapshot) {
    const resources = eligibleResources(config, serviceId, locationId, providerId);
    if (!resources) throw new SchedulingError(400, 'invalid_selection', 'Choose an active service, location and eligible provider.');
    const current = config.services.find(s => s.id === serviceId)!, location = config.locations.find(l => l.id === locationId)!;
    const service = original ? {...current, name: original.service.name, durationMinutes: original.service.durationMinutes, bufferBeforeMinutes: original.service.bufferBeforeMinutes, bufferAfterMinutes: original.service.bufferAfterMinutes, price: original.service.price} : current;
    const start = Date.parse(startsAt), end = start + service.durationMinutes * minute;
    const occupiedStart = start - service.bufferBeforeMinutes * minute, occupiedEnd = end + service.bufferAfterMinutes * minute;
    const reservations = await this.reservations({start: occupiedStart, end: occupiedEnd}, omitAppointment);
    const selected = availability({...config, services: config.services.map(s => s.id === serviceId ? service : s)}, {serviceId, locationId, providerId, startsAt, endsAt: iso(start + minute)}, reservations, Date.now());
    if (!selected.slots.length) throw new SchedulingError(409, 'slot_unavailable', 'This time is outside current availability or is already reserved.');
    const bookingMode = original?.bookingMode ?? (service.bookingMode === 'inherit' ? config.defaultBookingMode : service.bookingMode);
    const snapshot: AppointmentSnapshot = {service: original ? {...original.service} : service, location, resourceIds: resources.map(r => r.id), bookingMode, approvalTtlMinutes: original?.approvalTtlMinutes ?? config.approvalTtlMinutes, ...(original ? original.customerManagement ? {customerManagement: original.customerManagement} : {} : config.customerManagement ? {customerManagement: {...config.customerManagement}} : {})};
    return {start, end, occupiedStart, occupiedEnd, snapshot};
  }
}
