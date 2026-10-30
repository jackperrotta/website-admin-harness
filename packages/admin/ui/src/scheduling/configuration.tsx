import React, {useState} from 'react';
import {
  parseSchedulingConfig, type SchedulingConfig, type SchedulingService, type SchedulingResource,
  type SchedulingLocation, type SchedulingWorkspaceResponse, type SchedulingGrant,
} from '../../../../contracts/src/scheduling.ts';
import {Modal, Field, Choices, SaveFooter, ErrorNotice, useSave, schedulingApi, currencyDigits} from './shared.tsx';

export type ConfigurationSelection = {kind: 'service' | 'resource' | 'location' | 'settings'; id?: string};
const grantPresets: Record<string, Pick<SchedulingGrant, 'scope' | 'permissions'>> = {
  read: {scope: 'own', permissions: ['appointments:read']},
  availability: {scope: 'own', permissions: ['appointments:read', 'availability:write']},
  manage: {scope: 'own', permissions: ['appointments:read', 'appointments:write', 'availability:write']},
  calendar: {scope: 'own', permissions: ['appointments:read', 'appointments:write', 'availability:write', 'calendar-connections:manage']},
  all: {scope: 'all', permissions: ['appointments:read', 'appointments:write', 'availability:write']},
};
function grantPreset(grant?: SchedulingGrant): string {
  if (!grant) return 'none';
  return Object.keys(grantPresets).find(key => grantPresets[key].scope === grant.scope && JSON.stringify([...grantPresets[key].permissions].sort()) === JSON.stringify([...grant.permissions].sort())) ?? 'custom';
}
export function ConfigurationEditor({workspace, selection, onClose, onSaved}: {workspace: SchedulingWorkspaceResponse; selection: ConfigurationSelection; onClose: () => void; onSaved: () => void}) {
  const [id] = useState(selection.id ?? crypto.randomUUID());
  const [base] = useState(workspace.configuration!);
  const [config, setConfig] = useState(() => {
    const config = structuredClone(base.config);
    if (!selection.id) {
      const locationIds = config.locations.filter(l => l.active).slice(0, 1).map(l => l.id);
      if (selection.kind === 'service') config.services.push({id, name: '', active: true, durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, bookingMode: 'inherit', locationMode: 'business', locationIds, providerIds: [], resourceIds: [], price: {amountMinor: null, currency: 'USD', label: 'Price on request'}});
      if (selection.kind === 'resource') config.resources.push({id, name: '', kind: 'provider', active: true, locationIds});
      if (selection.kind === 'location') config.locations.push({id, name: '', active: true, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone});
    }
    return config;
  });
  const edit = (work: (next: SchedulingConfig) => void) => setConfig(before => {const next = structuredClone(before); work(next); return next;});
  const save = useSave(onSaved);
  const kindLabel = {service: 'service', resource: 'staff or resource', location: 'location', settings: 'booking settings'}[selection.kind];
  const title = selection.kind === 'settings' ? 'Booking settings' : `${selection.id ? 'Edit' : 'Add'} ${kindLabel}`;
  const service = config.services.find(s => s.id === id), resource = config.resources.find(r => r.id === id), location = config.locations.find(l => l.id === id);
  return <Modal title={title} onClose={onClose} busy={save.busy}><form className="sc-form" onSubmit={e => {e.preventDefault(); save.run(async () => {const validated = parseSchedulingConfig(config); await schedulingApi('/configuration', {revision: base.revision, config: validated});});}}>
    <ErrorNotice error={save.error}/>
    {selection.kind === 'service' && service && <ServiceFields value={service} config={config} onChange={patch => edit(c => Object.assign(c.services.find(s => s.id === id)!, patch))}/>}
    {selection.kind === 'resource' && resource && <>
      <ResourceFields value={resource} workspace={workspace} config={config} existing={!!selection.id} onChange={patch => edit(c => {
        const r = c.resources.find(r => r.id === id)!, previousAccount = r.userId;
        Object.assign(r, patch);
        if (previousAccount && previousAccount !== r.userId && !c.resources.some(other => other.kind === 'provider' && other.userId === previousAccount)) c.grants = c.grants.filter(g => g.userId !== previousAccount || g.scope !== 'own');
      })}/>
      {resource.kind === 'provider' && resource.userId && <Field label="Scheduling access" hint="This applies to every staff profile linked to this account. Existing owner and administrator access is unchanged."><select value={grantPreset(config.grants.find(g => g.userId === resource.userId))} onChange={e => {const key = e.target.value; edit(c => {c.grants = c.grants.filter(g => g.userId !== resource.userId); if (grantPresets[key]) c.grants.push({userId: resource.userId!, ...grantPresets[key]});});}}><option value="none">No additional scheduling access</option><option value="read">View own appointments</option><option value="availability">View own appointments and edit own availability</option><option value="manage">Manage own appointments and availability</option><option value="calendar">Manage own appointments, availability and calendar</option><option value="all">Manage all appointments and availability</option>{grantPreset(config.grants.find(g => g.userId === resource.userId)) === 'custom' && <option value="custom">Keep existing custom permissions</option>}</select></Field>}
      <p className="sc-hint">Set working hours in Availability after saving. Rooms, bays, and equipment also need availability before a service can reserve them.</p>
    </>}
    {selection.kind === 'location' && location && <LocationFields value={location} onChange={patch => edit(c => Object.assign(c.locations.find(l => l.id === id)!, patch))}/>}
    {selection.kind === 'settings' && <SettingsFields value={config} onChange={patch => edit(c => Object.assign(c, patch))}/>}
    <SaveFooter busy={save.busy} onClose={onClose} label={selection.kind === 'settings' ? 'Save booking settings' : `Save ${kindLabel}`}/>
  </form></Modal>;
}
function ServiceFields({value, config, onChange}: {value: SchedulingService; config: SchedulingConfig; onChange: (patch: Partial<SchedulingService>) => void}) {
  const digits = currencyDigits(value.price.currency);
  const [priceInput, setPriceInput] = useState(value.price.amountMinor === null ? '' : String(value.price.amountMinor / 10 ** digits));
  return <>
    <Field label="Service name"><input required maxLength={160} value={value.name} onChange={e => onChange({name: e.target.value})}/></Field>
    <div className="sc-form-grid"><Field label="Duration (minutes)"><input required type="number" min={1} max={720} value={value.durationMinutes} onChange={e => onChange({durationMinutes: Number(e.target.value)})}/></Field><Field label="Booking confirmation"><select value={value.bookingMode} onChange={e => onChange({bookingMode: e.target.value as SchedulingService['bookingMode']})}><option value="inherit">Use business default</option><option value="instant">Confirm immediately</option><option value="approval">Require approval</option></select></Field></div>
    <div className="sc-form-grid"><Field label="Buffer before (minutes)"><input required type="number" min={0} max={240} value={value.bufferBeforeMinutes} onChange={e => onChange({bufferBeforeMinutes: Number(e.target.value)})}/></Field><Field label="Buffer after (minutes)"><input required type="number" min={0} max={240} value={value.bufferAfterMinutes} onChange={e => onChange({bufferAfterMinutes: Number(e.target.value)})}/></Field></div>
    <div className="sc-form-grid"><Field label="Currency"><input required minLength={3} maxLength={3} pattern="[A-Z]{3}" value={value.price.currency} onChange={e => {const currency = e.target.value.toUpperCase(); onChange({price: {...value.price, currency, amountMinor: priceInput === '' ? null : Math.round(Number(priceInput) * 10 ** currencyDigits(currency))}});}}/></Field><Field label="Price" hint="Leave blank when the price needs assessment."><input type="number" min={0} step={10 ** -digits} value={priceInput} onChange={e => {setPriceInput(e.target.value); onChange({price: {...value.price, amountMinor: e.target.value === '' ? null : Math.round(Number(e.target.value) * 10 ** digits)}});}}/></Field></div>
    <Field label="Pricing note"><input maxLength={120} value={value.price.label} onChange={e => onChange({price: {...value.price, label: e.target.value}})}/></Field>
    <Field label="Appointment location"><select value={value.locationMode} onChange={e => onChange({locationMode: e.target.value as SchedulingService['locationMode']})}><option value="business">At the business</option><option value="phone">Phone appointment</option><option value="video">Video appointment</option><option value="customer">At the customer's address</option></select></Field>
    <Choices label="Available at locations" options={config.locations} value={value.locationIds} onChange={locationIds => onChange({locationIds})}/>
    <Choices label="Eligible staff" options={config.resources.filter(r => r.kind === 'provider')} value={value.providerIds} onChange={providerIds => onChange({providerIds})}/>
    <Choices label="Required rooms or equipment" options={config.resources.filter(r => r.kind !== 'provider')} value={value.resourceIds} onChange={resourceIds => onChange({resourceIds})}/>
    <label className="sc-check"><input type="checkbox" checked={value.active} onChange={e => onChange({active: e.target.checked})}/>Service is available for new appointments</label>
    <p className="sc-hint">Every selected room or equipment item is reserved together. Existing appointments keep their saved duration, price, and booking terms.</p>
  </>;
}
function ResourceFields({value, config, workspace, existing, onChange}: {value: SchedulingResource; config: SchedulingConfig; workspace: SchedulingWorkspaceResponse; existing: boolean; onChange: (patch: Partial<SchedulingResource>) => void}) {
  return <>
    <Field label="Staff or resource name"><input required maxLength={120} value={value.name} onChange={e => onChange({name: e.target.value})}/></Field>
    <Field label="Type"><select disabled={existing} value={value.kind} onChange={e => onChange({kind: e.target.value as SchedulingResource['kind'], ...(e.target.value !== 'provider' ? {userId: undefined} : {})})}><option value="provider">Staff member</option><option value="room">Room</option><option value="bay">Repair bay</option><option value="equipment">Equipment</option></select></Field>
    <Choices label="Working locations" options={config.locations} value={value.locationIds} onChange={locationIds => onChange({locationIds})}/>
    {value.kind === 'provider' && <Field label="Linked account" hint="Staff can be scheduled without an account. Link an existing account to grant scheduling access."><select value={value.userId ?? ''} onChange={e => onChange({userId: e.target.value || undefined})}><option value="">No account linked</option>{workspace.accounts?.map(a => <option key={a.id} value={a.id} disabled={!a.active && a.id !== value.userId}>{a.email}{a.active ? '' : ' (inactive)'}</option>)}</select></Field>}
    {workspace.accountsTruncated && <p className="sc-hint">Only the first 200 accounts are listed. Manage additional account assignments through the installation workflow.</p>}
    <label className="sc-check"><input type="checkbox" checked={value.active} onChange={e => onChange({active: e.target.checked})}/>Available for new appointments</label>
    <p className="sc-hint">Deactivation preserves appointment history and existing reservations.</p>
  </>;
}
function LocationFields({value, onChange}: {value: SchedulingLocation; onChange: (patch: Partial<SchedulingLocation>) => void}) {
  return <>
    <Field label="Location name"><input required maxLength={120} value={value.name} onChange={e => onChange({name: e.target.value})}/></Field>
    <Field label="Location timezone" hint="Use an IANA timezone such as America/New_York or Europe/London."><input required list="sc-timezone-options" value={value.timezone} onChange={e => onChange({timezone: e.target.value})}/><datalist id="sc-timezone-options"><option value="UTC"/>{Intl.supportedValuesOf('timeZone').map(zone => <option value={zone} key={zone}/>)}</datalist></Field>
    <label className="sc-check"><input type="checkbox" checked={value.active} onChange={e => onChange({active: e.target.checked})}/>Location accepts new appointments</label>
    <p className="sc-hint">Set the location's business hours in Availability. Existing appointments keep their original timezone snapshot.</p>
  </>;
}
function SettingsFields({value, onChange}: {value: SchedulingConfig; onChange: (patch: Partial<SchedulingConfig>) => void}) {
  return <>
    <Field label="Scheduling mode" hint="Test mode stores appointments and captures customer messages. Enabled calendar connections receive real appointment updates."><select value={value.mode} onChange={e => onChange({mode: e.target.value as SchedulingConfig['mode']})}><option value="disabled">New booking paused</option><option value="test">Test mode</option></select></Field>
    <Field label="Default booking confirmation"><select value={value.defaultBookingMode} onChange={e => onChange({defaultBookingMode: e.target.value as SchedulingConfig['defaultBookingMode']})}><option value="instant">Confirm immediately</option><option value="approval">Require approval</option></select></Field>
    <div className="sc-form-grid"><Field label="Minimum notice (minutes)"><input required type="number" min={0} max={43200} value={value.minNoticeMinutes} onChange={e => onChange({minNoticeMinutes: Number(e.target.value)})}/></Field><Field label="Booking horizon (days)"><input required type="number" min={1} max={365} value={value.horizonDays} onChange={e => onChange({horizonDays: Number(e.target.value)})}/></Field></div>
    <div className="sc-form-grid"><Field label="Start time increment (minutes)"><input required type="number" min={1} max={60} value={value.slotStepMinutes} onChange={e => onChange({slotStepMinutes: Number(e.target.value)})}/></Field><Field label="Approval deadline (minutes)"><input required type="number" min={1} max={10080} value={value.approvalTtlMinutes} onChange={e => onChange({approvalTtlMinutes: Number(e.target.value)})}/></Field></div>
    <fieldset><legend>Customer emails and management links</legend>
      <label className="sc-check"><input type="checkbox" checked={!!value.notifications?.enabled} onChange={e=>onChange({notifications:{...value.notifications,enabled:e.target.checked,mode:value.notifications?.mode??'capture'}})}/>Prepare customer emails for new appointments and changes</label>
      <Field label="Customer email mode" hint="Capture stores test emails in Customer emails. Send requires server sender setup and an explicit test-recipient allowlist."><select value={value.notifications?.mode??'capture'} onChange={e=>onChange({notifications:{...value.notifications,enabled:value.notifications?.enabled??false,mode:e.target.value as 'capture'|'send'}})}><option value="capture">Capture test emails</option><option value="send">Send to allowed test recipients</option></select></Field>
      <ReminderFields value={value.notifications??{enabled:false,mode:'capture'}} onChange={reminders=>onChange({notifications:{...value.notifications,enabled:value.notifications?.enabled??false,mode:value.notifications?.mode??'capture',reminders}})}/>
      <label className="sc-check"><input type="checkbox" checked={!!value.customerManagement?.enabled} onChange={e=>onChange({customerManagement:{enabled:e.target.checked,cancellationCutoffMinutes:value.customerManagement?.cancellationCutoffMinutes??0,rescheduleCutoffMinutes:value.customerManagement?.rescheduleCutoffMinutes??0}})}/>Include customer cancellation and rescheduling links</label>
      <div className="sc-form-grid"><Field label="Customer cancellation notice (minutes)"><input type="number" min={0} max={43200} value={value.customerManagement?.cancellationCutoffMinutes??0} onChange={e=>onChange({customerManagement:{enabled:value.customerManagement?.enabled??false,cancellationCutoffMinutes:Number(e.target.value),rescheduleCutoffMinutes:value.customerManagement?.rescheduleCutoffMinutes??0}})}/></Field><Field label="Customer rescheduling notice (minutes)"><input type="number" min={0} max={43200} value={value.customerManagement?.rescheduleCutoffMinutes??0} onChange={e=>onChange({customerManagement:{enabled:value.customerManagement?.enabled??false,cancellationCutoffMinutes:value.customerManagement?.cancellationCutoffMinutes??0,rescheduleCutoffMinutes:Number(e.target.value)}})}/></Field></div>
      <p className="sc-hint">Notice rules are saved with new appointments. Zero permits changes until the appointment starts. Customer rescheduling keeps the original staff, location, price and duration. Turning links off pauses online changes for existing appointments; it does not cancel them.</p>
    </fieldset>
    <fieldset><legend>Website booking</legend>
      <label className="sc-check"><input type="checkbox" checked={!!value.publicBooking?.enabled} onChange={e => onChange({publicBooking: {...value.publicBooking ?? {serviceIds: [], allowProviderChoice: true, policyText: ''}, enabled: e.target.checked}})}/>Allow customers to book published services in test mode</label>
      <Choices label="Services published on the website" options={value.services.filter(s => s.locationMode !== 'customer')} value={value.publicBooking?.serviceIds ?? []} onChange={serviceIds => onChange({publicBooking: {...value.publicBooking ?? {enabled: false, allowProviderChoice: true, policyText: ''}, serviceIds}})}/>
      <Field label="Customer booking policy" hint="Explain confirmation, cancellation and how to contact the business. Shown before the customer submits."><textarea maxLength={2000} value={value.publicBooking?.policyText ?? ''} onChange={e => onChange({publicBooking: {...value.publicBooking ?? {enabled: false, allowProviderChoice: true, serviceIds: []}, policyText: e.target.value}})}/></Field>
      <label className="sc-check"><input type="checkbox" checked={value.publicBooking?.allowProviderChoice ?? true} onChange={e => onChange({publicBooking: {...value.publicBooking ?? {enabled: false, serviceIds: [], policyText: ''}, allowProviderChoice: e.target.checked}})}/>Let customers choose a staff member</label>
      <p className="sc-hint">The public API also requires server setup and an approved website origin. Customer messages remain captured. Enabled calendar connections receive test bookings.</p>
    </fieldset>
    <p className="sc-hint">Services may override the confirmation rule. Pausing new booking leaves existing appointments available to manage. Website booking must be explicitly enabled and connected before use.</p>
  </>;
}

function ReminderFields({value,onChange}:{value:NonNullable<SchedulingConfig['notifications']>;onChange:(value:NonNullable<SchedulingConfig['notifications']>['reminders'])=>void}){
 const reminders=value.reminders??{enabled:false,offsetsMinutes:[1440,120]};
 return <fieldset disabled={!value.enabled}><legend>Appointment reminders</legend>
  <label className="sc-check"><input type="checkbox" checked={reminders.enabled} onChange={e=>onChange({...reminders,enabled:e.target.checked})}/>Send reminder emails for confirmed appointments</label>
  <p className="sc-hint">Choose up to three times before the appointment, from 1 minute to 30 days. Reminders use the customer email mode above. Pending requests do not receive reminders.</p>
  {reminders.offsetsMinutes.map((minutes,index)=><div className="sc-form-grid" key={index}><ReminderTime index={index} minutes={minutes} disabled={!reminders.enabled} onChange={minutes=>onChange({...reminders,offsetsMinutes:reminders.offsetsMinutes.map((v,i)=>i===index?minutes:v)})}/><button type="button" className="secondary" disabled={!reminders.enabled||reminders.offsetsMinutes.length===1} onClick={()=>onChange({...reminders,offsetsMinutes:reminders.offsetsMinutes.filter((_,i)=>i!==index)})}>Remove reminder {index+1}</button></div>)}
  <button type="button" className="secondary" disabled={!reminders.enabled||reminders.offsetsMinutes.length>=3} onClick={()=>onChange({...reminders,offsetsMinutes:[...reminders.offsetsMinutes,[1440,120,30,60].find(v=>!reminders.offsetsMinutes.includes(v))!]})}>Add reminder</button>
  <p className="sc-hint">Changes apply to future reminder times for existing and new confirmed appointments. Times that have already passed are skipped. Cancelled appointments receive no reminders. Pausing new bookings keeps reminders active for existing appointments.</p>
 </fieldset>;
}
function ReminderTime({index,minutes,disabled,onChange}:{index:number;minutes:number;disabled:boolean;onChange:(minutes:number)=>void}){
 const [unit,setUnit]=useState(minutes%1440===0?'days':minutes%60===0?'hours':'minutes');const factor=unit==='days'?1440:unit==='hours'?60:1;
 return <><Field label={`Reminder ${index+1} lead time`}><input required type="number" min={1/factor} max={43200/factor} step="any" disabled={disabled} value={minutes/factor} onChange={e=>onChange(Number((Number(e.target.value)*factor).toFixed(8)))}/></Field><Field label={`Reminder ${index+1} unit`}><select disabled={disabled} value={unit} onChange={e=>setUnit(e.target.value)}><option value="minutes">Minutes before</option><option value="hours">Hours before</option><option value="days">Days before</option></select></Field></>;
}
