import {emptySchedulingConfig, type SchedulingConfig} from '../packages/contracts/src/scheduling.ts';

/** Entirely synthetic configuration shared by isolated scheduling tests. */
export function schedulingFixture(): SchedulingConfig {
  const config: SchedulingConfig = {
    ...emptySchedulingConfig(), mode: 'test',
    locations: [{id: 'main', name: 'Synthetic studio', timezone: 'America/New_York', active: true}, {id: 'remote', name: 'Synthetic remote office', timezone: 'Europe/London', active: true}],
    resources: [
      {id: 'provider-a', name: 'Synthetic provider A', kind: 'provider', locationIds: ['main', 'remote'], userId: 'provider-user', active: true},
      {id: 'provider-b', name: 'Synthetic provider B', kind: 'provider', locationIds: ['main'], active: true},
      {id: 'room', name: 'Synthetic room', kind: 'room', locationIds: ['main'], active: true},
    ],
    services: [
      {id: 'visit', name: 'Synthetic appointment', active: true, durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, bookingMode: 'inherit', locationMode: 'business', locationIds: ['main'], providerIds: ['provider-a', 'provider-b'], resourceIds: ['room'], price: {amountMinor: 5000, currency: 'USD', label: 'Fixed price'}},
      {id: 'consult', name: 'Synthetic consultation', active: true, durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, bookingMode: 'approval', locationMode: 'video', locationIds: ['remote'], providerIds: ['provider-a'], resourceIds: [], price: {amountMinor: null, currency: 'USD', label: 'Price agreed after assessment'}},
    ],
  };
  for (let weekday = 0; weekday < 7; weekday++) {
    for (const location of config.locations) config.weeklyHours.push({locationId: location.id, weekday, startMinute: 0, endMinute: 1440});
    for (const resource of config.resources) for (const locationId of resource.locationIds) config.weeklyHours.push({locationId, resourceId: resource.id, weekday, startMinute: 0, endMinute: 1440});
  }
  return config;
}
