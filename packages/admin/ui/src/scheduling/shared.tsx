import React, {useEffect, useId, useRef, useState} from 'react';
import type {SchedulingCatalog, SchedulingAppointment, SchedulingMutationResponse} from '../../../../contracts/src/scheduling.ts';

export async function schedulingApi<T>(path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/modules/scheduling${path}`, {signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), ...(data === undefined ? {} : {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(data)})});
  const value = await response.json() as {error?: string};
  if (!response.ok) throw new Error(value.error ?? 'The scheduling request failed. Please try again.');
  return value as T;
}
export const message = (error: unknown) => error instanceof Error ? error.message : 'The request failed. Please try again.';
export const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function wallDate(instant: string | number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date(instant));
  const get = (name: string) => parts.find(p => p.type === name)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function addDays(date: string, days: number): string {return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);}
export function monday(date: string): string {const day = new Date(`${date}T12:00:00Z`).getUTCDay(); return addDays(date, -(day + 6) % 7);}
export function dateLabel(date: string, short = false): string {return new Intl.DateTimeFormat('en-US', {timeZone: 'UTC', weekday: 'short', month: short ? 'short' : 'long', day: 'numeric'}).format(new Date(`${date}T12:00:00Z`));}
export function timeLabel(instant: string, timezone: string): string {return new Intl.DateTimeFormat('en-US', {timeZone: timezone, hour: 'numeric', minute: '2-digit', timeZoneName: 'shortOffset'}).format(new Date(instant));}
/** Enumerate actual offsets so repeated times remain explicit and missing local times are rejected. */
export function localInstants(local: string, timezone: string): string[] {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(local)) return [];
  const target = Date.parse(`${local}:00.000Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 16) !== local) return [];
  const format = new Intl.DateTimeFormat('en-US', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
  const wall = (at: number) => {
    const parts = format.formatToParts(at), get = (name: string) => parts.find(p => p.type === name)!.value;
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
  };
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {const sample = target + hours * 3600000; offsets.add(Date.parse(`${wall(sample)}:00Z`) - sample);}
  return [...offsets].map(offset => target - offset).filter(at => wall(at) === local).sort((a, b) => a - b).map(at => new Date(at).toISOString());
}
export function dayStart(date: string, timezone: string): string {
  // Some IANA zones move their clocks at midnight. Use the day's first real minute.
  for (let m = 0; m < 1440; m++) {
    const found = localInstants(`${date}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, timezone);
    if (found.length) return found[0];
  }
  throw new Error('This date does not exist in the selected timezone. Choose another date.');
}
export function clockValue(minute: number): string {return `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;}
export function clockMinute(value: string, end = false): number {const [h, m] = value.split(':').map(Number); return end && h === 0 && m === 0 ? 1440 : h * 60 + m;}
export function currencyDigits(currency: string): number {try {return new Intl.NumberFormat('en-US', {style: 'currency', currency}).resolvedOptions().maximumFractionDigits ?? 2;} catch {return 2;}}
export function priceLabel(price: {amountMinor: number | null; currency: string; label: string}): string {
  if (price.amountMinor === null) return price.label || 'Price on request';
  return new Intl.NumberFormat('en-US', {style: 'currency', currency: price.currency}).format(price.amountMinor / 10 ** currencyDigits(price.currency));
}
export function providerName(catalog: SchedulingCatalog, id: string): string {return catalog.resources.find(r => r.id === id)?.name ?? 'Previous staff member';}
export function statusLabel(status: SchedulingAppointment['status']): string {return ({pending_approval: 'Needs approval', confirmed: 'Confirmed', declined: 'Declined', expired: 'Expired', cancelled: 'Cancelled', completed: 'Completed', no_show: 'No-show'})[status];}
export function useCommand() {
  const prior = useRef<{fingerprint: string; key: string} | null>(null);
  return async (path: string, body: object) => {
    const fingerprint = JSON.stringify({path, body});
    if (prior.current?.fingerprint !== fingerprint) prior.current = {fingerprint, key: crypto.randomUUID()};
    return schedulingApi<SchedulingMutationResponse>(path, {...body, idempotencyKey: prior.current.key});
  };
}
export function Modal({title, children, onClose, busy = false}: {title: string; children: React.ReactNode; onClose: () => void; busy?: boolean}) {
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId();
  useEffect(() => {const node = dialog.current, opener = document.activeElement; node?.showModal(); return () => {node?.close(); if (opener instanceof HTMLElement && opener.isConnected) opener.focus();};}, []);
  return <dialog className="sc-dialog" ref={dialog} aria-labelledby={titleId} onCancel={e => {e.preventDefault(); if (!busy) onClose();}}><header><h2 id={titleId}>{title}</h2><button type="button" className="sc-icon-button" aria-label={`Close ${title.toLowerCase()}`} disabled={busy} onClick={onClose}>×</button></header>{children}</dialog>;
}
export function Field({label, children, hint}: {label: string; children: React.ReactNode; hint?: string}) {
  const id = useId(), hintId = `${id}-hint`;
  return <div className="sc-field"><label htmlFor={id}>{label}</label>{React.Children.map(children, child => React.isValidElement<Record<string, unknown>>(child) && (child.type === 'input' || child.type === 'select' || child.type === 'textarea') ? React.cloneElement(child, {id, 'aria-describedby': hint ? hintId : undefined}) : child)}{hint && <small id={hintId}>{hint}</small>}</div>;
}
export function ErrorNotice({error}: {error: string}) {return error ? <div className="sc-error" role="alert">{error}</div> : null;}
export function EmptyState({title, children}: {title: string; children: React.ReactNode}) {return <div className="sc-empty"><h3>{title}</h3><p>{children}</p></div>;}
export function Choices({label, options, value, onChange}: {label: string; options: {id: string; name: string}[]; value: string[]; onChange: (value: string[]) => void}) {
  return <fieldset className="sc-choices"><legend>{label}</legend>{options.length ? options.map(option => <label key={option.id}><input type="checkbox" checked={value.includes(option.id)} onChange={e => onChange(e.target.checked ? [...value, option.id] : value.filter(id => id !== option.id))}/>{option.name}</label>) : <p className="muted">Add an eligible option first.</p>}</fieldset>;
}
export function SaveFooter({busy, label = 'Save changes', onClose}: {busy: boolean; label?: string; onClose: () => void}) {return <footer className="sc-form-footer"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : label}</button></footer>;}
export function useSave(onSaved: () => void) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return {busy, error, setError, run: async (work: () => Promise<unknown>) => {setBusy(true); setError(''); try {await work(); onSaved();} catch (error) {setError(`${message(error)} Your entries have been kept. If the schedule changed, close this editor and refresh before trying again.`);} finally {setBusy(false);}}};
}
