import React, {useState} from 'react';
import type {SchedulingSummary} from '../../../../contracts/src/scheduling.ts';
import {useAutoRefresh} from '../auto-refresh';
import {schedulingApi, ErrorNotice} from './shared';

export function SchedulingOverview() {
  const [value, setValue] = useState<SchedulingSummary | null>(null);
  const refresh = useAutoRefresh('overview-scheduling', async signal => {const result = await schedulingApi<SchedulingSummary>('/summary', undefined, signal); if (!signal.aborted) setValue(result);});
  return <section className="panel" aria-label="Appointment overview"><div className="panel-heading"><div><h2>Appointments</h2><p>Next 31 days · Test schedule</p></div><a href="#scheduling">Open scheduling →</a></div><ErrorNotice error={refresh.error}/>{value ? <>
    <p><strong>{value.upcoming}</strong> upcoming · <strong>{value.pendingApproval}</strong> needing approval</p>
    {value.next.length ? <ul>{value.next.map(appointment => <li key={appointment.id}><a href={`#scheduling?appointment=${encodeURIComponent(appointment.id)}`}>{appointment.customer.name} · {appointment.title}</a><p>{new Intl.DateTimeFormat('en-US',{timeZone:appointment.snapshot.location.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(appointment.startsAt))} · {appointment.snapshot.location.timezone}{appointment.source === 'website' ? ' · Website' : ''}</p></li>)}</ul> : <p>No upcoming appointments.</p>}
    <small>{refresh.error ? 'Counts may be out of date.' : 'Updates automatically while visible.'} Customer messages are captured for testing.</small>
  </> : !refresh.error && <p role="status">Loading appointments…</p>}</section>;
}
