import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProviderClient, tokenExchange} from '../packages/admin/src/scheduling/calendars/providers.ts';
import {appointmentCalendar} from '../packages/admin/src/scheduling/calendars/ics.ts';
import type {CalendarEnv, RemoteCalendar} from '../packages/admin/src/scheduling/calendars/types.ts';
import type {SchedulingAppointment} from '../packages/contracts/src/scheduling.ts';
import {syntheticCalendarBindings} from './calendar-provider-fixture.ts';
const calendar: RemoteCalendar = {id: 'synthetic', name: 'Synthetic', timezone: 'America/New_York', writable: true};
const client = new ProviderClient({} as CalendarEnv, 'google', 'synthetic');

test('all-day Google events use local boundaries across spring and autumn DST and free/cancelled events do not block', () => {
  for (const [from, to, hours] of [['2026-03-08','2026-03-09',23],['2026-11-01','2026-11-02',25]] as const) {
    const event = client.normalize({id:'all-day',start:{date:from},end:{date:to}}, calendar);
    assert.equal((event.end-event.start)/3600000,hours); assert.equal(new Intl.DateTimeFormat('en-US',{timeZone:calendar.timezone,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).format(event.start),'00:00');
  }
  const base = {id:'synthetic', start:{dateTime:'2026-11-01T01:30:00-04:00'},end:{dateTime:'2026-11-01T01:30:00-05:00'}};
  assert.equal(client.normalize(base,calendar).end-client.normalize(base,calendar).start,3600000);
  assert.equal(client.normalize({...base,transparency:'transparent'},calendar).busy,false);
  assert.equal(client.normalize({...base,eventType:'workingLocation'},calendar).busy,false);
  assert.equal(client.normalize({id:'cancelled',status:'cancelled'},calendar).busy,false);
  assert.throws(()=>client.normalize({...base,start:{dateTime:'2026-11-01T01:30:00'}},calendar),/offset/);
  const ms = new ProviderClient({} as CalendarEnv,'microsoft','synthetic');
  assert.throws(()=>ms.normalize({id:'bad',start:{dateTime:'2026-11-01T12:00:00',timeZone:'Eastern Standard Time'},end:{dateTime:'2026-11-01T13:00:00',timeZone:'Eastern Standard Time'}},calendar),/UTC/);
});

test('provider redirects are rejected without following them and initial consent requires full scope and refresh access', async () => {
  let calls = 0;
  const env = {...syntheticCalendarBindings,CALENDAR_HTTP:{fetch:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://evil.example.test'}});}}} as unknown as CalendarEnv;
  await assert.rejects(tokenExchange(env,'google',{grant_type:'authorization_code',code:'synthetic'}),/redirect/); assert.equal(calls,1);
  env.CALENDAR_HTTP = {fetch:async()=>Response.json({token_type:'Bearer',access_token:'synthetic',expires_in:3600,scope:'https://www.googleapis.com/auth/calendar.events'})} as unknown as CalendarEnv['CALENDAR_HTTP'];
  await assert.rejects(tokenExchange(env,'google',{code:'synthetic'}),/permissions/);
  env.CALENDAR_HTTP = {fetch:async()=>Response.json({token_type:'Bearer',access_token:'synthetic',expires_in:3600,scope:'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly'})} as unknown as CalendarEnv['CALENDAR_HTTP'];
  await assert.rejects(tokenExchange(env,'google',{code:'synthetic'}),/invalid calendar data/);
});

test('iCalendar text escapes injection, folds UTF-8 safely and retains cancellation without claiming an invitation', async () => {
  const appointment = {id:'synthetic',title:'Consultation, A;B\\C\r\n'+'🗓️ Café '.repeat(30),startsAt:'2026-11-01T14:00:00Z',endsAt:'2026-11-01T14:30:00Z',status:'confirmed',revision:4,snapshot:{location:{name:'Room, A\nEND:VEVENT'}}} as SchedulingAppointment;
  const file = await appointmentCalendar(appointment,'site','https://admin.example.test'), unfolded=file.replace(/\r\n /g,'');
  assert.match(unfolded,/SUMMARY:Consultation\\, A\\;B\\\\C\\n/); assert.equal(file.match(/\r\nEND:VEVENT\r\n/g)?.length,1); assert.ok(!file.includes('METHOD:')); assert.ok(!file.includes('ORGANIZER:'));
  assert.ok(unfolded.includes('🗓️ Café '.repeat(30))); for (const line of file.split('\r\n')) assert.ok(Buffer.byteLength(line)<=75);
  const cancelled=await appointmentCalendar({...appointment,status:'cancelled',revision:5},'site','https://admin.example.test'); assert.match(cancelled,/STATUS:CANCELLED/); assert.match(cancelled,/SEQUENCE:5/); assert.equal(file.match(/UID:.*\r\n/)?.[0],cancelled.match(/UID:.*\r\n/)?.[0]);
});
