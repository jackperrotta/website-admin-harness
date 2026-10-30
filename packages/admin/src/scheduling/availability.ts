import type {SchedulingConfig, SchedulingAvailabilityQuery, SchedulingSlot, SchedulingWeeklyHours, SchedulingException, SchedulingResource} from '../../../contracts/src/scheduling.ts';

export const minute = 60000;
export interface Interval {start: number; end: number}
export interface ResourceReservation extends Interval {resourceId: string; appointmentId: string}
export function overlaps(a: Interval, b: Interval): boolean {return a.start < b.end && a.end > b.start;}
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const interval of intervals.slice().sort((a, b) => a.start - b.start)) {
    const last = result.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else result.push({...interval});
  }
  return result;
}
function subtractIntervals(open: Interval[], closed: Interval[]): Interval[] {
  let result = mergeIntervals(open);
  for (const block of mergeIntervals(closed)) result = result.flatMap(i => !overlaps(i, block) ? [i] : [i.start < block.start ? {start: i.start, end: block.start} : null, i.end > block.end ? {start: block.end, end: i.end} : null].filter((v): v is Interval => v !== null));
  return result;
}
function clock(timezone: string) {
  const format = new Intl.DateTimeFormat('en-US', {timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (instant: number) => {
    const parts = format.formatToParts(instant);
    const get = (name: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === name)!.value;
    return {weekday: days.indexOf(get('weekday')), minute: Number(get('hour')) * 60 + Number(get('minute'))};
  };
}
/** Expanding real UTC minutes preserves both repeated DST hours and omits nonexistent times. */
export function weeklyIntervals(hours: SchedulingWeeklyHours[], timezone: string, range: Interval): Interval[] {
  if (!hours.length) return [];
  const local = clock(timezone), result: Interval[] = [];
  for (let at = Math.floor(range.start / minute) * minute; at < range.end; at += minute) {
    const wall = local(at);
    if (!hours.some(h => h.weekday === wall.weekday && wall.minute >= h.startMinute && wall.minute < h.endMinute)) continue;
    const last = result.at(-1);
    if (last?.end === at) last.end += minute;
    else result.push({start: at, end: at + minute});
  }
  return result;
}
function openIntervals(config: SchedulingConfig, locationId: string, resourceId: string | undefined, timezone: string, range: Interval): Interval[] {
  const matches = (h: SchedulingWeeklyHours | SchedulingException) => h.locationId === locationId && h.resourceId === resourceId;
  const exceptions = config.exceptions.filter(matches);
  const intervals = (kind: 'open' | 'closed') => exceptions.filter(e => e.kind === kind).map(e => ({start: Date.parse(e.startsAt), end: Date.parse(e.endsAt)}));
  return subtractIntervals([...weeklyIntervals(config.weeklyHours.filter(matches), timezone, range), ...intervals('open')], intervals('closed'));
}
export function eligibleResources(config: SchedulingConfig, serviceId: string, locationId: string, providerId: string): SchedulingResource[] | null {
  const service = config.services.find(s => s.id === serviceId && s.active && s.locationIds.includes(locationId));
  if (!service || !service.providerIds.includes(providerId) || !config.locations.some(l => l.id === locationId && l.active)) return null;
  const resources = [providerId, ...service.resourceIds].map(id => config.resources.find(r => r.id === id && r.active && r.locationIds.includes(locationId)));
  if (resources.some(r => !r)) return null;
  return resources as SchedulingResource[];
}
export function availability(config: SchedulingConfig, query: SchedulingAvailabilityQuery, reservations: ResourceReservation[], now: number, limit = 500): {slots: SchedulingSlot[]; truncated: boolean} {
  if (config.mode !== 'test') return {slots: [], truncated: false};
  const service = config.services.find(s => s.id === query.serviceId && s.active);
  const location = config.locations.find(l => l.id === query.locationId && l.active);
  if (!service || !location || !service.locationIds.includes(location.id)) return {slots: [], truncated: false};
  const range = {start: Date.parse(query.startsAt) - service.bufferBeforeMinutes * minute, end: Date.parse(query.endsAt) + (service.durationMinutes + service.bufferAfterMinutes) * minute};
  const local = clock(location.timezone);
  const locationOpen = openIntervals(config, location.id, undefined, location.timezone, range);
  const resourceOpen = new Map<string, Interval[]>();
  const providerIds = query.providerId ? [query.providerId] : service.providerIds;
  const candidates = providerIds.flatMap(providerId => {
    const resources = eligibleResources(config, service.id, location.id, providerId);
    if (!resources) return [];
    for (const r of resources) if (!resourceOpen.has(r.id)) resourceOpen.set(r.id, openIntervals(config, location.id, r.id, location.timezone, range));
    return [{providerId, resources}];
  });
  const slots: SchedulingSlot[] = [];
  for (let start = Date.parse(query.startsAt); start < Date.parse(query.endsAt); start += minute) {
    if (start < now + config.minNoticeMinutes * minute || start >= now + config.horizonDays * 86400000 || local(start).minute % config.slotStepMinutes) continue;
    const end = start + service.durationMinutes * minute;
    const occupied = {start: start - service.bufferBeforeMinutes * minute, end: end + service.bufferAfterMinutes * minute};
    if (!locationOpen.some(i => i.start <= occupied.start && i.end >= occupied.end)) continue;
    for (const {providerId, resources} of candidates) {
      if (!resources.every(r => resourceOpen.get(r.id)!.some(i => i.start <= occupied.start && i.end >= occupied.end))) continue;
      if (reservations.some(r => resources.some(resource => resource.id === r.resourceId) && overlaps(occupied, r))) continue;
      if (slots.length === limit) return {slots, truncated: true};
      slots.push({startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), providerId, timezone: location.timezone});
    }
  }
  return {slots, truncated: false};
}
