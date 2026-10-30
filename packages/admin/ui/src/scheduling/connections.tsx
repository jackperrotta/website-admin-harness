import React, {useEffect, useState} from 'react';
import type {CalendarConnection, CalendarConnectionsResponse, SchedulingWorkspaceResponse} from '../../../../contracts/src/scheduling.ts';
import {Modal, Field, Choices, ErrorNotice, SaveFooter, useSave, schedulingApi, message, EmptyState, providerName} from './shared.tsx';

interface ListedCalendar {id: string; name: string; writable: boolean; timezone: string}
type Action = {kind: 'select'; connection: CalendarConnection} | {kind: 'disconnect'; connection: CalendarConnection} | {kind: 'restore'; connection: CalendarConnection; appointmentId: string};
export function CalendarConnections({workspace, onChanged, onAppointment}: {workspace: SchedulingWorkspaceResponse; onChanged: () => void; onAppointment: (id: string) => void}) {
  const [data, setData] = useState<CalendarConnectionsResponse | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [resourceId, setResourceId] = useState(workspace.catalog.resources.find(r => r.kind === 'provider')?.id ?? ''), [action, setAction] = useState<Action | null>(null);
  const manage = workspace.status.permissions.includes('calendar-connections:manage');
  const load = async () => {try {setData(await schedulingApi<CalendarConnectionsResponse>('/connections'));} catch (error) {setError(message(error));}};
  useEffect(() => {void load(); const timer = setInterval(() => {void load();}, 15000); return () => clearInterval(timer);}, []);
  const run = async (work: () => Promise<unknown>) => {setBusy(true); setError(''); try {await work(); await load(); onChanged();} catch (error) {setError(message(error)); await load();} finally {setBusy(false);}};
  const changed = () => {setAction(null); void load(); onChanged();};
  return <>
    <div className="sc-section-heading"><div><h2>Calendar connections</h2><p>Block busy times and keep appointments in your team's calendars.</p></div><button className="secondary" disabled={busy} onClick={() => {setError(''); void load();}}>Refresh connections</button></div>
    <ErrorNotice error={error}/>
    {!data && !error && <p role="status">Loading calendar connections…</p>}
    {data?.simulated && <div className="sc-mode-notice"><strong>SIMULATED CALENDARS</strong><p>This local preview uses isolated Google and Outlook provider fixtures. No real account is connected and no events leave this computer.</p><a className="secondary" href="/__calendar-fixture" target="_blank" rel="noreferrer">Open simulated calendars ↗</a></div>}
    {data && !data.schemaReady && <div className="sc-error" role="alert">The calendar migration has not been applied to this installation. Review and apply migration 0005 before connecting accounts.</div>}
    {data && !data.providers.some(p => p.configured) && <section className="sc-panel sc-setting-card"><h3>Set up Google or Microsoft OAuth</h3><p>Register the business's OAuth apps and configure the local environment. Authorization stays with the business; there is no central Vitris calendar account.</p>{data.providers.map(provider => <div className="sc-callback" key={provider.id}><strong>{provider.id === 'google' ? 'Google' : 'Microsoft / Outlook'} callback</strong><code>{provider.callbackUrl}</code></div>)}<p>Set the provider client ID and secret, a token encryption key ring, and CALENDAR_SYNC_ENABLED in the ignored local environment file. See the calendar setup instructions supplied with this release.</p></section>}
    {data && manage && !data.simulated && <div className="sc-connect-row"><Field label="Connect calendar for staff"><select value={resourceId} onChange={e => setResourceId(e.target.value)}><option value="">Choose staff</option>{workspace.catalog.resources.filter(r => r.kind === 'provider').map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>{data.providers.map(provider => <button className="secondary" type="button" key={provider.id} disabled={busy || !resourceId || !provider.configured} onClick={() => run(async () => {
      const result = await schedulingApi<{url: string}>('/connections/start', {provider: provider.id, resourceId});
      const url = new URL(result.url); if (!['accounts.google.com', 'login.microsoftonline.com'].includes(url.hostname) || url.protocol !== 'https:') throw new Error('Invalid calendar authorization address.');
      window.location.assign(result.url);
    })}>{provider.id === 'google' ? 'Connect Google' : 'Connect Outlook'}</button>)}</div>}
    <div className="sc-card-grid">{data?.connections.map(connection => <article key={connection.id} className="sc-panel sc-setting-card"><header className="sc-connection-heading"><h3>{connection.provider === 'google' ? 'Google Calendar' : 'Outlook Calendar'}</h3><span className={`sc-status ${connection.health === 'healthy' ? 'sc-status-confirmed' : 'sc-status-pending_approval'}`}>{connection.enabled ? connection.health.replaceAll('_', ' ') : 'Not enabled'}</span></header><p><strong>{providerName(workspace.catalog, connection.resourceId)}</strong><br/>{connection.accountLabel}</p><dl><div><dt>Last checked</dt><dd>{connection.lastSyncedAt ? new Date(connection.lastSyncedAt).toLocaleString() : 'Not yet synchronized'}</dd></div><div><dt>Pending calendar writes</dt><dd>{connection.pendingJobs}</dd></div><div><dt>Conflicts to review</dt><dd>{connection.conflicts}</dd></div></dl>{connection.errorCode && <p className="sc-error" role="alert">{connection.errorCode.replaceAll('_', ' ')}. Booking for this provider pauses while its required calendar cannot be verified.</p>}{manage && <div className="sc-detail-actions"><button className="secondary" disabled={busy} onClick={() => setAction({kind: 'select', connection})}>{connection.destination ? 'Edit calendar selection' : 'Choose calendars'}</button>{connection.enabled && <button className="secondary" disabled={busy} onClick={() => run(() => schedulingApi(`/connections/${connection.id}/sync`, {}))}>Sync now</button>}<button className="text-button" disabled={busy} onClick={() => setAction({kind: 'disconnect', connection})}>Disconnect</button></div>}</article>)}</div>
    {data?.connections.length === 0 && <EmptyState title="No calendars connected">Connect a staff calendar to import busy times and export appointments. Calendar files can still be downloaded from appointment details.</EmptyState>}
    {!!data?.conflicts.length && <section className="sc-panel sc-setting-card sc-subheading"><h3>Calendar changes need review</h3>{data.conflicts.map(conflict => {
      const connection = data.connections.find(c => c.id === conflict.connectionId)!;
      return <div className="sc-calendar-conflict" key={`${conflict.connectionId}-${conflict.appointmentId}-${conflict.reason}`}><p>{conflict.reason === 'external_overlap' ? 'An external event overlaps a stored appointment. Move the external event or reschedule the appointment.' : conflict.reason === 'external_deleted' ? 'A linked appointment event was deleted in the external calendar.' : 'A linked appointment event was changed in the external calendar.'}</p><div className="sc-detail-actions"><button className="secondary" onClick={() => onAppointment(conflict.appointmentId)}>View affected appointment</button>{manage && conflict.reason !== 'external_overlap' && <button className="secondary" onClick={() => setAction({kind: 'restore', connection, appointmentId: conflict.appointmentId})}>Apply appointment to calendar</button>}</div></div>;
    })}</section>}
    <p className="sc-hint sc-subheading">External changes are reconciled automatically. A calendar file (.ics) can add an appointment to most calendar apps, but importing a file does not share availability or guarantee ongoing updates.</p>
    {action && <ConnectionEditor action={action} simulated={data?.simulated ?? false} onClose={() => setAction(null)} onSaved={changed}/>}
  </>;
}
function ConnectionEditor({action, simulated, onClose, onSaved}: {action: Action; simulated: boolean; onClose: () => void; onSaved: () => void}) {
  const [listed, setListed] = useState<{calendars: ListedCalendar[]; revision: number} | null>(null), [blocking, setBlocking] = useState(action.connection.blocking), [destination, setDestination] = useState(action.connection.destination ?? ''), [acknowledge, setAcknowledge] = useState(false), [loadError, setLoadError] = useState('');
  const save = useSave(onSaved);
  useEffect(() => {
    if (action.kind !== 'select') return;
    let active = true; schedulingApi<{calendars: ListedCalendar[]; revision: number}>(`/connections/${action.connection.id}/calendars`).then(value => {if (active) {setListed(value); if (!destination) setDestination(value.calendars.find(c => c.writable)?.id ?? '');}}).catch(error => {if (active) setLoadError(message(error));}); return () => {active = false;};
  }, []);
  const title = action.kind === 'select' ? 'Choose calendars' : action.kind === 'disconnect' ? 'Disconnect calendar' : 'Apply appointment to calendar';
  return <Modal title={title} busy={save.busy} onClose={onClose}><form className="sc-form" onSubmit={e => {e.preventDefault(); save.run(async () => {
    if (!acknowledge) throw new Error('Confirm the calendar operation before continuing.');
    if (action.kind === 'select') {
      if (!listed) throw new Error('Wait for the calendars to load.');
      await schedulingApi(`/connections/${action.connection.id}/select`, {revision: listed.revision, blocking, destination, acknowledge});
    } else if (action.kind === 'disconnect') await schedulingApi(`/connections/${action.connection.id}/disconnect`, {revision: action.connection.revision, acknowledge});
    else await schedulingApi(`/connections/${action.connection.id}/restore`, {appointmentId: action.appointmentId, acknowledge});
  });}}>
    <ErrorNotice error={loadError || save.error}/>
    {action.kind === 'select' ? <>
      {!listed && !loadError && <p role="status">Loading calendars…</p>}
      {listed && <><Field label="Appointment calendar"><select required value={destination} onChange={e => setDestination(e.target.value)}><option value="">Choose a writable calendar</option>{listed.calendars.filter(c => c.writable).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Choices label="Calendars that block availability" options={listed.calendars} value={blocking} onChange={setBlocking}/></>}
      <p className="sc-hint">The appointment calendar always blocks availability too. Choose up to five calendars in total. Pending approval requests are exported as busy holds; cancellations remove linked events. Other events are never edited.</p>
      <label className="sc-check"><input type="checkbox" checked={acknowledge} onChange={e => setAcknowledge(e.target.checked)}/>{simulated ? 'Allow simulated appointment events in these isolated test calendars.' : 'Allow this installation to create, update, and remove appointment events in the selected calendar, including test appointments.'}</label>
    </> : <>
      <p>{action.kind === 'disconnect' ? 'This calendar will stop blocking availability and receiving appointment updates. Events already exported will stay in the external calendar.' : 'The stored appointment will replace the external calendar edit. The customer appointment will keep its current time and status.'}</p>
      <label className="sc-check"><input type="checkbox" checked={acknowledge} onChange={e => setAcknowledge(e.target.checked)}/>{action.kind === 'disconnect' ? 'I understand and want to disconnect this calendar.' : 'I want the stored appointment to determine the calendar event.'}</label>
    </>}
    <SaveFooter busy={save.busy} label={action.kind === 'select' ? 'Enable calendar sync' : title} onClose={onClose}/>
  </form></Modal>;
}
