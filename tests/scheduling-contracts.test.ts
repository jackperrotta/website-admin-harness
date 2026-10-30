import {test} from 'node:test';
import assert from 'node:assert/strict';
import {can, parseManifest, validateModules, workQueueModule} from '../packages/contracts/src/index.ts';
import {parseSchedulingConfig, parseCreateAppointment, parseRescheduleAppointment, parseSchedulingAvailability, emptySchedulingConfig, schedulingInstant} from '../packages/contracts/src/scheduling.ts';
import {availability, weeklyIntervals, minute} from '../packages/admin/src/scheduling/availability.ts';
import {schedulingFixture} from './scheduling-fixture.ts';

test('scheduling contracts are opt-in, strict, and do not grant scheduling to existing content roles', () => {
  assert.equal(emptySchedulingConfig().mode, 'disabled');
  assert.equal(can('owner', 'appointments:write'), true);
  assert.equal(can('administrator', 'scheduling:configure'), true);
  assert.equal(can('editor', 'appointments:read'), false);
  assert.equal(can('analyst', 'appointments:read'), false);
  const manifest = parseManifest({schemaVersion: 1, installationId: 'test', business: {name: 'Test', initials: 'T'}, site: {id: 'test', name: 'Test', origin: 'https://test.example'}, adminOrigin: 'https://admin.test.example', modules: []});
  validateModules(manifest, [workQueueModule]);
  assert.equal(manifest.backend, undefined);
  assert.deepEqual(parseSchedulingConfig(schedulingFixture()), schedulingFixture());
  for (const overrides of [{mode: 'live'}, {defaultBookingMode: 'sometimes'}, {slotStepMinutes: 0}, {schemaVersion: 2}, {apiToken: 'never-public'}]) assert.throws(() => parseSchedulingConfig({...schedulingFixture(), ...overrides}));
});

test('configuration validates IDs, relationships, prices, timezones and scoped grants', () => {
  const config = schedulingFixture();
  assert.throws(() => parseSchedulingConfig({...config, locations: [...config.locations, config.locations[0]]}));
  for (const timezone of ['Invalid/Timezone', '+05:00']) assert.throws(() => parseSchedulingConfig({...config, locations: [{...config.locations[0], timezone}, config.locations[1]]}));
  assert.throws(() => parseSchedulingConfig({...config, services: [{...config.services[0], providerIds: ['room']}]}));
  assert.throws(() => parseSchedulingConfig({...config, services: [{...config.services[0], locationIds: ['missing']}]}));
  assert.throws(() => parseSchedulingConfig({...config, services: [{...config.services[0], price: {...config.services[0].price, amountMinor: 1.5}}]}));
  assert.throws(() => parseSchedulingConfig({...config, resources: config.resources.map(r => r.id === 'room' ? {...r, userId: 'provider-user'} : r)}));
  assert.throws(() => parseSchedulingConfig({...config, grants: [{userId: 'stranger', scope: 'own', permissions: ['appointments:read']}]}));
  assert.throws(() => parseSchedulingConfig({...config, grants: [{userId: 'provider-user', scope: 'own', permissions: ['appointments:read', 'scheduling:configure']}]}));
  assert.throws(() => parseSchedulingConfig({...config, weeklyHours: [{locationId: 'main', weekday: 0, startMinute: 1200, endMinute: 60}]}));
});

test('request parsers reject ambiguous timestamps, impersonation fields and unbounded searches', () => {
  for (const value of ['2026-02-30T12:00:00.000Z', '2026-11-01T01:30:00', '2026-11-01T01:30:00-04:00', '2026-11-01T12:00:30.000Z']) assert.throws(() => schedulingInstant(value));
  const request = {idempotencyKey: 'synthetic-key', revision: 0, serviceId: 'visit', locationId: 'main', providerId: 'provider-a', startsAt: '2026-11-01T12:00:00.000Z', customer: {name: 'Synthetic Customer', email: 'SYNTHETIC@example.test', phone: ''}};
  assert.equal(parseCreateAppointment(request).customer.email, 'synthetic@example.test');
  for (const extra of [{siteId: 'another-site'}, {status: 'confirmed'}, {priceMinor: 0}, {role: 'owner'}]) assert.throws(() => parseCreateAppointment({...request, ...extra}));
  assert.throws(() => parseRescheduleAppointment({idempotencyKey: 'key', revision: 1, locationId: 'main', providerId: 'provider-a', startsAt: request.startsAt}));
  assert.throws(() => parseSchedulingAvailability({serviceId: 'visit', locationId: 'main', startsAt: request.startsAt, endsAt: '2026-11-09T12:00:00.000Z'}));
});

test('weekly availability includes both autumn offsets and omits nonexistent spring times', () => {
  const hours = [{locationId: 'main', weekday: 0, startMinute: 60, endMinute: 120}];
  const repeated = weeklyIntervals(hours, 'America/New_York', {start: Date.parse('2026-11-01T04:00:00Z'), end: Date.parse('2026-11-01T08:00:00Z')});
  assert.deepEqual(repeated, [{start: Date.parse('2026-11-01T05:00:00Z'), end: Date.parse('2026-11-01T07:00:00Z')}]);
  const missing = weeklyIntervals([{...hours[0], startMinute: 120, endMinute: 180}], 'America/New_York', {start: Date.parse('2027-03-14T05:00:00Z'), end: Date.parse('2027-03-14T09:00:00Z')});
  assert.deepEqual(missing, []);
});

test('availability combines location and resource hours, buffers, exceptions and global resource conflicts', () => {
  const config = schedulingFixture(), start = Date.parse('2026-11-02T15:00:00Z');
  const query = {serviceId: 'visit', locationId: 'main', providerId: 'provider-a', startsAt: new Date(start).toISOString(), endsAt: new Date(start + 120 * minute).toISOString()};
  config.services[0].bufferAfterMinutes = 15;
  config.exceptions.push({id: 'break', locationId: 'main', resourceId: 'room', startsAt: new Date(start + 60 * minute).toISOString(), endsAt: new Date(start + 90 * minute).toISOString(), kind: 'closed'});
  const result = availability(config, query, [{resourceId: 'provider-a', appointmentId: 'another-location', start, end: start + 30 * minute}], start - 86400000);
  assert.deepEqual(result.slots.map(s => s.startsAt), [new Date(start + 90 * minute).toISOString(), new Date(start + 105 * minute).toISOString()]);
  assert.equal(availability({...config, mode: 'disabled'}, query, [], start - 86400000).slots.length, 0);
  assert.equal(availability(schedulingFixture(), {...query, providerId: undefined}, [], start - 86400000, 1).truncated, true);
});
