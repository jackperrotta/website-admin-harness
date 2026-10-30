import type {SchedulingAppointment} from '../../../../contracts/src/scheduling.ts';
import {digest} from './crypto.ts';

const escape = (value: string) => value.replaceAll('\\', '\\\\').replace(/\r\n|\r|\n/g, '\\n').replaceAll(';', '\\;').replaceAll(',', '\\,');
function fold(line: string): string {
  const lines: string[] = []; let current = '', bytes = 0;
  for (const character of line) {
    const size = new TextEncoder().encode(character).length;
    if (bytes + size > 75) {lines.push(current); current = ' '; bytes = 1;}
    current += character; bytes += size;
  }
  lines.push(current); return lines.join('\r\n');
}
const stamp = (value: string | number) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
/** Stable identity and SEQUENCE permit clients to recognize revised copies of an appointment. */
export async function appointmentCalendar(appointment: SchedulingAppointment, siteId: string, adminOrigin: string): Promise<string> {
  const cancelled = ['cancelled', 'declined', 'expired'].includes(appointment.status);
  const uid = `${await digest(`${siteId}|${appointment.id}`)}@${new URL(adminOrigin).hostname}`;
  const description = cancelled ? 'This appointment has been cancelled.' : appointment.status === 'pending_approval' ? 'This appointment is awaiting business approval.' : 'Contact the business to change this appointment.';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vitris//Appointments//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${uid}`, `SEQUENCE:${appointment.revision}`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(appointment.startsAt)}`, `DTEND:${stamp(appointment.endsAt)}`, `SUMMARY:${escape(appointment.title)}`, `LOCATION:${escape(appointment.snapshot.location.name)}`, `DESCRIPTION:${escape(description)}`, `STATUS:${cancelled ? 'CANCELLED' : appointment.status === 'pending_approval' ? 'TENTATIVE' : 'CONFIRMED'}`, 'TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR'];
  return lines.map(fold).join('\r\n') + '\r\n';
}
export async function calendarAttachment(appointment: SchedulingAppointment, siteId: string, origin: string) {
  const content = await appointmentCalendar(appointment, siteId, origin);
  return {filename: `appointment-${appointment.id}.ics`, contentType: 'text/calendar; charset=utf-8', content};
}
