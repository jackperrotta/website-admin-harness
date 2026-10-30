import React, {useEffect, useState} from 'react';
import {parseSchedulingConfig, parseSchedulingException, type SchedulingWorkspaceResponse, type SchedulingResourceAvailability, type SchedulingWeeklyHours, type SchedulingException} from '../../../../contracts/src/scheduling.ts';
import {Modal, Field, SaveFooter, ErrorNotice, useSave, schedulingApi, message, weekdays, clockMinute, clockValue, localInstants, timeLabel, wallDate, dateLabel} from './shared.tsx';

export interface AvailabilitySelection {locationId: string; resourceId?: string}
export function AvailabilityEditor({workspace, selection, onSaved, onClose}: {workspace: SchedulingWorkspaceResponse; selection: AvailabilitySelection; onSaved: () => void; onClose: () => void}) {
  const [locationId, setLocationId] = useState(selection.locationId);
  const [base] = useState(workspace.configuration);
  const [data, setData] = useState<{revision: number; weeklyHours: SchedulingWeeklyHours[]; exceptions: SchedulingException[]} | null>(() => selection.resourceId ? null : {revision: base!.revision, weeklyHours: base!.config.weeklyHours.filter(h => !h.resourceId), exceptions: base!.config.exceptions.filter(e => !e.resourceId)});
  const [loadError, setLoadError] = useState(''), save = useSave(onSaved);
  useEffect(() => {
    if (!selection.resourceId) return;
    let active = true;
    schedulingApi<SchedulingResourceAvailability>(`/availability-settings?resourceId=${encodeURIComponent(selection.resourceId)}`).then(value => {if (value.revision !== workspace.status.revision) throw new Error('The schedule changed. Close this editor and refresh before editing availability.'); if (active) setData({revision: value.revision, weeklyHours: value.weeklyHours, exceptions: value.exceptions});}).catch(error => {if (active) setLoadError(message(error));});
    return () => {active = false;};
  }, []);
  const resource = workspace.catalog.resources.find(r => r.id === selection.resourceId);
  const locations = workspace.catalog.locations.filter(l => !resource || resource.locationIds.includes(l.id));
  const location = locations.find(l => l.id === locationId)!;
  const title = resource ? `${resource.name} availability` : 'Business hours';
  const updateHours = (index: number, patch: Partial<SchedulingWeeklyHours>) => setData(before => before && ({...before, weeklyHours: before.weeklyHours.map((h, i) => i === index ? {...h, ...patch} : h)}));
  const addHours = (weekdays: number[]) => setData(before => before && ({...before, weeklyHours: [...before.weeklyHours, ...weekdays.map(weekday => ({locationId, ...(selection.resourceId ? {resourceId: selection.resourceId} : {}), weekday, startMinute: 540, endMinute: 1020}))]}));
  return <Modal title={title} onClose={onClose} busy={save.busy}><form className="sc-form" onSubmit={e => {e.preventDefault(); if (!data) return; save.run(async () => {
    if (selection.resourceId) await schedulingApi('/availability-settings', {...data, resourceId: selection.resourceId});
    else {
      const config = parseSchedulingConfig({...base!.config, weeklyHours: [...base!.config.weeklyHours.filter(h => h.resourceId), ...data.weeklyHours], exceptions: [...base!.config.exceptions.filter(e => e.resourceId), ...data.exceptions]});
      await schedulingApi('/configuration', {revision: data.revision, config});
    }
  });}}>
    <ErrorNotice error={loadError || save.error}/>{!data && !loadError && <p role="status">Loading working hours…</p>}
    {data && <>
      <Field label="Working location"><select value={locationId} onChange={e => setLocationId(e.target.value)}>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
      <p className="sc-hint">All times use {location.timezone}. Both business hours and resource hours must cover the appointment and its buffers.</p>
      <div className="sc-section-heading"><h3>Weekly working hours</h3><button type="button" className="text-button" onClick={() => addHours([1, 2, 3, 4, 5])}>Add Monday–Friday</button></div>
      <div className="sc-hours-list">{data.weeklyHours.map((h, index) => h.locationId === locationId && <div className="sc-hours-row" key={index}>
        <Field label={`Day ${index + 1}`}><select value={h.weekday} onChange={e => updateHours(index, {weekday: Number(e.target.value)})}>{weekdays.map((day, i) => <option key={day} value={i}>{day}</option>)}</select></Field>
        <Field label={`Start ${index + 1}`}><input type="time" required value={clockValue(h.startMinute)} onChange={e => updateHours(index, {startMinute: clockMinute(e.target.value)})}/></Field>
        <Field label={`End ${index + 1}`}><input type="time" required value={clockValue(h.endMinute)} onChange={e => updateHours(index, {endMinute: clockMinute(e.target.value, true)})}/></Field>
        <button type="button" className="sc-icon-button" aria-label={`Remove working hours ${index + 1}`} onClick={() => setData({...data, weeklyHours: data.weeklyHours.filter((_, i) => i !== index)})}>×</button>
      </div>)}</div>
      {!data.weeklyHours.some(h => h.locationId === locationId) && <p className="sc-hint">No regular hours at this location. Add hours to make it available.</p>}
      <button type="button" className="secondary" onClick={() => addHours([1])}>Add working hours</button>
      <p className="sc-hint">Add separate rows for split shifts. End time 00:00 means midnight at the end of that day. Split overnight hours across two weekdays.</p>
      <h3>Time off and date exceptions</h3>
      {data.exceptions.filter(e => e.locationId === locationId).map(exception => <div className="sc-exception" key={exception.id}><span><strong>{exception.kind === 'closed' ? 'Unavailable' : 'Extra availability'}</strong><small>{dateLabel(wallDate(exception.startsAt, location.timezone), true)} · {timeLabel(exception.startsAt, location.timezone)} → {dateLabel(wallDate(exception.endsAt, location.timezone), true)} · {timeLabel(exception.endsAt, location.timezone)}</small></span><button type="button" className="text-button" onClick={() => setData({...data, exceptions: data.exceptions.filter(e => e.id !== exception.id)})}>Remove exception</button></div>)}
      <ExceptionFields locationId={locationId} resourceId={selection.resourceId} timezone={location.timezone} onAdd={exception => setData({...data, exceptions: [...data.exceptions, exception]})}/>
      <SaveFooter busy={save.busy} label="Save availability" onClose={onClose}/>
    </>}
  </form></Modal>;
}
function ExceptionFields({locationId, resourceId, timezone, onAdd}: {locationId: string; resourceId?: string; timezone: string; onAdd: (value: SchedulingException) => void}) {
  const [start, setStart] = useState(''), [end, setEnd] = useState(''), [kind, setKind] = useState<'open' | 'closed'>('closed');
  const [startChoice, setStartChoice] = useState(''), [endChoice, setEndChoice] = useState(''), [error, setError] = useState('');
  const starts = localInstants(start, timezone), ends = localInstants(end, timezone);
  return <fieldset className="sc-exception-fields"><legend>Add a date exception</legend><ErrorNotice error={error}/>
    <Field label="Exception type"><select value={kind} onChange={e => setKind(e.target.value as 'open' | 'closed')}><option value="closed">Time off / unavailable</option><option value="open">Extra availability</option></select></Field>
    <div className="sc-form-grid"><Field label="Exception starts"><input type="datetime-local" value={start} onChange={e => {setStart(e.target.value); setStartChoice('');}}/></Field><Field label="Exception ends"><input type="datetime-local" value={end} onChange={e => {setEnd(e.target.value); setEndChoice('');}}/></Field></div>
    {starts.length > 1 && <Field label="Start time occurrence"><select value={starts.includes(startChoice) ? startChoice : starts[0]} onChange={e => setStartChoice(e.target.value)}>{starts.map(at => <option key={at} value={at}>{timeLabel(at, timezone)}</option>)}</select></Field>}
    {ends.length > 1 && <Field label="End time occurrence"><select value={ends.includes(endChoice) ? endChoice : ends[0]} onChange={e => setEndChoice(e.target.value)}>{ends.map(at => <option key={at} value={at}>{timeLabel(at, timezone)}</option>)}</select></Field>}
    <button type="button" className="secondary" onClick={() => {
      setError('');
      try {
        if (!starts.length || !ends.length) throw new Error('Choose valid local start and end times. Times skipped by a clock change are unavailable.');
        const exception = parseSchedulingException({id: crypto.randomUUID(), locationId, ...(resourceId ? {resourceId} : {}), startsAt: starts.includes(startChoice) ? startChoice : starts[0], endsAt: ends.includes(endChoice) ? endChoice : ends[0], kind});
        onAdd(exception); setStart(''); setEnd('');
      } catch (error) {setError(message(error));}
    }}>Add exception</button>
    <p className="sc-hint">Closed exceptions take priority. Existing appointments are preserved; review any appointments affected by time off.</p>
  </fieldset>;
}
