import React, {useState} from 'react';
import type {BookingReadiness} from '../../../../contracts/src/scheduling.ts';
import {useAutoRefresh} from '../auto-refresh';
import {schedulingApi, ErrorNotice} from './shared';

export function BookingConnection() {
  const [value, setValue] = useState<BookingReadiness | null>(null);
  const refresh = useAutoRefresh('booking-readiness', async signal => {const result = await schedulingApi<BookingReadiness>('/booking-readiness', undefined, signal); if (!signal.aborted) setValue(result);});
  return <section className="sc-panel sc-setting-card" style={{marginTop:24}} aria-label="Website booking connection"><h3>Website booking connection</h3><ErrorNotice error={refresh.error}/>{value ? <>
    <p><strong>{value.ready ? 'Ready for test bookings' : 'Setup needs attention'}</strong>{value.simulated ? ' · Local fixtures' : ' · Test mode only'}</p>
    <p>Approved website: {value.siteOrigin}</p><ul>{value.checks.map(check => <li key={check.id}><strong>{check.ready ? 'Ready' : 'Needs attention'}: </strong>{check.detail}</li>)}</ul>
    <label>Public launch.json scheduling metadata<textarea readOnly rows={9} value={JSON.stringify(value.connection, null, 2)} aria-label="Public scheduling metadata" style={{width:'100%',maxWidth:'100%',fontFamily:'monospace'}}/></label>
    <p className="sc-hint">Use the scheduling-connect plan/apply command to review this connection. The route can be changed explicitly. Customer messages remain captured; readiness does not prove live challenge or provider acceptance.</p>
  </> : <p role="status">Checking booking connection…</p>}</section>;
}
