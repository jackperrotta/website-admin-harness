import React, {useEffect, useRef, useState} from 'react';
import type {SchedulingWorkspaceResponse, SchedulingAppointment, SchedulingAvailabilityResponse, SchedulingSlot, SchedulingHistoryResponse, SchedulingStatusResponse, AppointmentStatus} from '../../../../contracts/src/scheduling.ts';
import {Modal, Field, SaveFooter, ErrorNotice, useSave, schedulingApi, message, dayStart, addDays, dateLabel, wallDate, timeLabel, statusLabel, providerName, priceLabel, useCommand, EmptyState} from './shared.tsx';

export function AppointmentEditor({workspace, date, appointment, onClose, onSaved}: {workspace: SchedulingWorkspaceResponse; date: string; appointment?: SchedulingAppointment; onClose: () => void; onSaved: () => void}) {
  const catalog = workspace.catalog;
  const [serviceId, setServiceId] = useState(appointment?.serviceId ?? catalog.services.find(s => s.active)?.id ?? '');
  const service = catalog.services.find(s => s.id === serviceId);
  const [locationId, setLocationId] = useState(appointment?.locationId ?? service?.locationIds.find(id => catalog.locations.some(l => l.id === id && l.active)) ?? '');
  const location = catalog.locations.find(l => l.id === locationId);
  const [providerId, setProviderId] = useState(appointment?.providerId ?? service?.providerIds.find(id => catalog.resources.some(r => r.id === id && r.active && r.locationIds.includes(locationId))) ?? '');
  const [day, setDay] = useState(date), [name, setName] = useState(appointment?.customer.name ?? ''), [email, setEmail] = useState(appointment?.customer.email ?? ''), [phone, setPhone] = useState(appointment?.customer.phone ?? '');
  const [times, setTimes] = useState<SchedulingAvailabilityResponse | null>(null), [selected, setSelected] = useState<SchedulingSlot | null>(null), [searching, setSearching] = useState(false), [shown, setShown] = useState(48);
  const save = useSave(onSaved), command = useCommand(), searchId = useRef(0);
  useEffect(() => () => {searchId.current++;}, []);
  const clearTimes = () => {searchId.current++; setSearching(false); setTimes(null); setSelected(null); save.setError('');};
  const providers = catalog.resources.filter(r => r.kind === 'provider' && r.active && service?.providerIds.includes(r.id) && r.locationIds.includes(locationId));
  const findTimes = async () => {
    const id = ++searchId.current; setSearching(true); save.setError(''); setTimes(null); setSelected(null); setShown(48);
    try {
      if (!serviceId || !location || !providerId || !day) throw new Error('Choose a service, location, staff member and date first.');
      const params = new URLSearchParams({serviceId, locationId, providerId, startsAt: dayStart(day, location.timezone), endsAt: dayStart(addDays(day, 1), location.timezone), ...(appointment ? {appointmentId: appointment.id} : {})});
      const response = await schedulingApi<SchedulingAvailabilityResponse>(`/availability?${params}`);
      if (response.location && response.location.timezone !== location.timezone) throw new Error('The location timezone changed. Close this editor and refresh the schedule before choosing a time.');
      if (id === searchId.current) setTimes(response);
    } catch (error) {if (id === searchId.current) save.setError(message(error));} finally {if (id === searchId.current) setSearching(false);}
  };
  const title = appointment ? 'Reschedule appointment' : 'New appointment';
  return <Modal title={title} onClose={onClose} busy={save.busy}><form className="sc-form" onSubmit={e => {e.preventDefault(); if (!selected || !times) {save.setError('Find available times and choose a time before saving.'); return;} save.run(async () => {
    if (appointment) await command(`/appointments/${appointment.id}/reschedule`, {revision: times.revision, appointmentRevision: appointment.revision, locationId, providerId: selected.providerId, startsAt: selected.startsAt});
    else await command('/appointments', {revision: times.revision, serviceId, locationId, providerId: selected.providerId, startsAt: selected.startsAt, customer: {name, email, phone}});
  });}}>
    <ErrorNotice error={save.error}/>
    <Field label="Service"><select required disabled={!!appointment || save.busy} value={serviceId} onChange={e => {
      const id = e.target.value, service = catalog.services.find(s => s.id === id), nextLocation = service?.locationIds.find(id => catalog.locations.some(l => l.id === id && l.active)) ?? '';
      setServiceId(id); setLocationId(nextLocation); setProviderId(service?.providerIds.find(id => catalog.resources.some(r => r.id === id && r.active && r.locationIds.includes(nextLocation))) ?? ''); clearTimes();
    }}><option value="">Choose a service</option>{catalog.services.filter(s => s.active || s.id === appointment?.serviceId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
    <div className="sc-form-grid"><Field label="Location"><select required disabled={save.busy} value={locationId} onChange={e => {const id = e.target.value; setLocationId(id); setProviderId(service?.providerIds.find(provider => catalog.resources.some(r => r.id === provider && r.active && r.locationIds.includes(id))) ?? ''); clearTimes();}}><option value="">Choose a location</option>{catalog.locations.filter(l => l.active && service?.locationIds.includes(l.id)).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
      <Field label="Staff member"><select required disabled={save.busy} value={providerId} onChange={e => {setProviderId(e.target.value); clearTimes();}}><option value="">Choose staff</option>{providers.map(r => <option value={r.id} key={r.id}>{r.name}</option>)}</select></Field></div>
    {appointment ? <p className="sc-summary">{appointment.customer.name} · {appointment.snapshot.service.durationMinutes} minutes · {priceLabel(appointment.snapshot.service.price)}<small>The original duration, price and booking terms are retained.</small></p> : <>
      <div className="sc-form-grid"><Field label="Customer name"><input required maxLength={160} autoComplete="name" value={name} onChange={e => setName(e.target.value)}/></Field><Field label="Customer email"><input required type="email" maxLength={254} autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}/></Field></div>
      <Field label="Customer phone"><input type="tel" maxLength={40} autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)}/></Field>
      {service && <p className="sc-summary">{times?.terms?.durationMinutes ?? service.durationMinutes} minutes · {priceLabel(times?.terms?.price ?? service.price)}<small>{(times?.terms?.bookingMode ?? (service.bookingMode === 'inherit' ? catalog.defaultBookingMode : service.bookingMode)) === 'approval' ? 'An approval request will reserve this time until its deadline.' : 'The appointment will be confirmed immediately.'}</small></p>}
    </>}
    <div className="sc-time-search"><Field label="Appointment date" hint={location?.timezone}><input type="date" required value={day} disabled={save.busy} onChange={e => {setDay(e.target.value); clearTimes();}}/></Field><button className="secondary" type="button" disabled={searching || save.busy} onClick={findTimes}>{searching ? 'Checking times…' : 'Find available times'}</button></div>
    {times && <section aria-label="Available appointment times"><h3>Available times</h3>{times.slots.length ? <><div className="sc-slots">{times.slots.slice(0, shown).map(slot => <button type="button" key={slot.startsAt + slot.providerId} aria-pressed={selected?.startsAt === slot.startsAt && selected?.providerId === slot.providerId} onClick={() => setSelected(slot)}>{timeLabel(slot.startsAt, slot.timezone)}</button>)}</div>{times.slots.length > shown && <button type="button" className="text-button" onClick={() => setShown(shown + 48)}>Show more times</button>}{times.truncated && <p className="sc-hint">The first 500 times are shown. Choose a different day to search further.</p>}</> : <EmptyState title="No available times on this date">Choose another day or review the staff and resource working hours.</EmptyState>}</section>}
    <p className="sc-hint">Times are checked again when saved. {workspace.status.deliveries === 'email' ? 'Customer emails use the configured sender and allowed test recipients.' : 'Customer messages are captured for testing.'} Enabled calendar connections receive appointment updates.</p>
    <SaveFooter busy={save.busy} onClose={onClose} label={appointment ? 'Save new time' : 'Save appointment'}/>
  </form></Modal>;
}

export function AppointmentDetails({id, workspace, onClose, onSaved, onReschedule}: {id: string; workspace: SchedulingWorkspaceResponse; onClose: () => void; onSaved: () => void; onReschedule: (appointment: SchedulingAppointment) => void}) {
  const [data, setData] = useState<{appointment: SchedulingAppointment; revision: number; history: SchedulingHistoryResponse} | null>(null), [loadError, setLoadError] = useState(''), [confirmCancel, setConfirmCancel] = useState(false);
  const save = useSave(onSaved), command = useCommand();
  useEffect(() => {
    let active = true;
    Promise.all([schedulingApi<SchedulingAppointment>(`/appointments/${id}`), schedulingApi<SchedulingStatusResponse>('/status'), schedulingApi<SchedulingHistoryResponse>(`/appointments/${id}/history`)]).then(([appointment, status, history]) => {if (active) setData({appointment, revision: status.revision, history});}).catch(error => {if (active) setLoadError(message(error));});
    return () => {active = false;};
  }, [id]);
  const appointment = data?.appointment, canWrite = workspace.status.permissions.includes('appointments:write');
  const changeStatus = (status: AppointmentStatus) => save.run(() => command(`/appointments/${id}/status`, {revision: data!.revision, appointmentRevision: appointment!.revision, status}));
  return <Modal title="Appointment details" onClose={onClose} busy={save.busy}><div className="sc-form"><ErrorNotice error={loadError || save.error}/>{!data && !loadError && <p role="status">Loading appointment…</p>}{appointment && <>
    <div className="sc-detail-heading"><div><h3>{appointment.customer.name}</h3><p>{appointment.title}</p></div><span className={`sc-status sc-status-${appointment.status}`}>{statusLabel(appointment.status)}</span></div>
    <dl className="sc-details"><div><dt>Booking source</dt><dd>{appointment.source === 'website' ? 'Website' : appointment.source === 'staff' ? 'Staff' : 'Unknown'}</dd></div><div><dt>Booking reference</dt><dd style={{overflowWrap:'anywhere'}}>{appointment.id}</dd></div>{appointment.acceptedPolicy && <div><dt>Accepted booking policy</dt><dd style={{whiteSpace:'pre-wrap'}}>{appointment.acceptedPolicy}</dd></div>}</dl>
    <dl className="sc-details"><div><dt>When</dt><dd>{dateLabel(wallDate(appointment.startsAt, appointment.snapshot.location.timezone))}<br/>{timeLabel(appointment.startsAt, appointment.snapshot.location.timezone)} – {timeLabel(appointment.endsAt, appointment.snapshot.location.timezone)}<small>{appointment.snapshot.location.timezone}</small></dd></div><div><dt>Staff and location</dt><dd>{providerName(workspace.catalog, appointment.providerId)}<br/>{appointment.snapshot.location.name}</dd></div><div><dt>Contact</dt><dd><a href={`mailto:${appointment.customer.email}`}>{appointment.customer.email}</a>{appointment.customer.phone && <><br/><a href={`tel:${appointment.customer.phone}`}>{appointment.customer.phone}</a></>}</dd></div><div><dt>Saved service terms</dt><dd>{appointment.snapshot.service.durationMinutes} minutes · {priceLabel(appointment.snapshot.service.price)}<small>{appointment.snapshot.bookingMode === 'approval' ? 'Approval required' : 'Immediate confirmation'}</small></dd></div></dl>
    {appointment.expiresAt && appointment.status === 'pending_approval' && <p className="sc-summary">Approval deadline: {dateLabel(wallDate(appointment.expiresAt, appointment.snapshot.location.timezone), true)}, {timeLabel(appointment.expiresAt, appointment.snapshot.location.timezone)}.</p>}
    {canWrite && <div className="sc-detail-actions">
      {appointment.status === 'pending_approval' && <><button type="button" className="primary" disabled={save.busy} onClick={() => changeStatus('confirmed')}>Approve appointment</button><button type="button" className="secondary" disabled={save.busy} onClick={() => changeStatus('declined')}>Decline request</button></>}
      {['confirmed', 'pending_approval'].includes(appointment.status) && <><button type="button" className="secondary" disabled={save.busy || workspace.status.mode === 'disabled'} onClick={() => onReschedule(appointment)}>Reschedule</button><button type="button" className="sc-danger-button" disabled={save.busy} onClick={() => setConfirmCancel(true)}>Cancel appointment</button></>}
      {appointment.status === 'confirmed' && Date.parse(appointment.startsAt) <= Date.now() && <><button type="button" className="secondary" disabled={save.busy} onClick={() => changeStatus('completed')}>Mark completed</button><button type="button" className="secondary" disabled={save.busy} onClick={() => changeStatus('no_show')}>Mark no-show</button></>}
      {appointment.status === 'expired' && appointment.expiresAt && <button type="button" className="secondary" disabled={save.busy} onClick={() => changeStatus('expired')}>Record request expiry</button>}
    </div>}
    {confirmCancel && <section className="sc-cancel-confirm" aria-label="Confirm cancellation"><h3>Cancel this appointment?</h3><p>This releases its staff and resources. Its history will be retained.</p><button type="button" className="sc-danger-button" disabled={save.busy} onClick={() => changeStatus('cancelled')}>Confirm cancellation</button><button type="button" className="text-button" onClick={() => setConfirmCancel(false)}>Keep appointment</button></section>}
    <h3>Appointment history</h3><ol className="sc-history">{data.history.rows.map((event, index) => <li key={index}><strong>{event.action}</strong><span>{new Intl.DateTimeFormat('en-US', {timeZone: appointment.snapshot.location.timezone, dateStyle: 'medium', timeStyle: 'short'}).format(event.created_at)}</span></li>)}</ol>
    <a className="secondary" href={`/api/modules/scheduling/appointments/${appointment.id}/calendar.ics`} download>Download calendar file (.ics)</a>
    <p className="sc-hint">Calendar files work with Google Calendar, Outlook, Apple Calendar, and compatible apps. Importing a file does not share availability or guarantee automatic updates. {workspace.status.deliveries === 'email' ? 'Customer emails use the configured sender and allowed test recipients.' : 'Customer messages are captured for this test appointment.'} Enabled calendar connections synchronize separately.</p>
  </>}</div></Modal>;
}
