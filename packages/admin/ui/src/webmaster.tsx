import React,{useEffect,useState} from 'react';
import {isObject,webmasterScopes,type WebmasterResponse,type WebmasterMember,type WebmasterScope} from '../../../contracts/src/index.ts';
import './webmaster.css';

const labels:Record<WebmasterScope,string>={'analytics:read':'View analytics','settings:write':'Update notification preferences','tasks:read':'View work queue','tasks:write':'Manage work queue','leads:read':'View leads','leads:write':'Manage leads'};
async function api(data?:unknown,disconnect=false):Promise<WebmasterResponse>{
  const response=await fetch('/api/modules/webmaster'+(disconnect?'/disconnect':''),data===undefined?undefined:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  const result:unknown=await response.json();if(!response.ok)throw Error(isObject(result)&&typeof result.error==='string'?result.error:'The webmaster connection is unavailable.');return result as WebmasterResponse;
}
export function WebmasterPanel({billingAvailable}:{billingAvailable:boolean}){
  const [state,setState]=useState<WebmasterResponse|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState(false),[acknowledged,setAcknowledged]=useState(false);
  const refresh=async()=>{try{setState(await api());setError('');}catch(e){setError(e instanceof Error?e.message:'The connection is unavailable.');}};
  useEffect(()=>{void refresh();},[]);
  const run=async(data:unknown,disconnect=false)=>{setBusy(true);setError('');setNotice('');try{await api(data,disconnect);await refresh();setEditing(false);setAcknowledged(false);setNotice(disconnect?'Management access disconnected. Existing subscriptions are unchanged.':'Webmaster connection saved.');}catch(e){setError(e instanceof Error?e.message:'The connection could not be changed.');}finally{setBusy(false);}};
  const c=state?.connection;
  return <section className="panel form-panel webmaster-panel" aria-labelledby="webmaster-heading"><h2 id="webmaster-heading">Managed by Webmaster</h2>
    {error&&<div className="alert" role="alert">{error}<button className="text-button" onClick={refresh} disabled={busy}>Reload connection</button></div>}
    {notice&&<p className="success" role="status">{notice}</p>}
    {!state&&!error&&<p role="status">Loading webmaster connection…</p>}
    {state&&<>{c?<><p><strong>{c.organizationName}</strong> · {c.status==='connected'?'Management connected':'Management disconnected'}</p><p className="muted">{c.billingProvider?`${c.organizationName} is also your billing provider.`:'This management connection has no billing relationship.'}</p>
      <p>Account ownership and billing permissions stay separate from management access.</p>
      {c.status==='connected'&&<p>Agreed website access: {c.permissions.map(p=>labels[p]).join(', ')||'No operational permissions granted'}.</p>}
      {c.status==='connected'&&c.members.length>0&&<div className="webmaster-members">{c.members.map(m=><div key={m.userId}><strong>{state.eligibleUsers.find(u=>u.id===m.userId)?.email||'Your agreed access'}</strong><ul>{m.permissions.map(p=><li key={p}>{labels[p]}</li>)}</ul>{m.permissions.length===0&&<p>No operational permissions granted.</p>}</div>)}</div>}
      </>:<p className="muted">No webmaster is connected. The account owner can connect an organization with agreed website permissions.</p>}
      {billingAvailable&&<p><a href="#account-billing">Your billing →</a> View your subscription, invoices, payment history and payment management.</p>}
      {state.canManage&&<>{!editing&&<button className="secondary" disabled={busy} onClick={()=>setEditing(true)}>{c?'Edit webmaster connection':'Connect a webmaster'}</button>}
        {editing&&<ConnectionForm key={c?.revision||0} state={state} busy={busy} save={data=>run(data)} cancel={()=>setEditing(false)}/>}
        {c?.status==='connected'&&<div className="webmaster-disconnect"><h3>Disconnect management access</h3><p>Disconnecting immediately revokes the webmaster team’s access to this admin. It does not cancel an existing subscription or stop future charges. Manage cancellation separately with your billing provider{billingAvailable?' through Your billing':''}.</p><label className="webmaster-check"><input type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)}/><span>I understand that disconnecting access does not cancel a subscription.</span></label><button className="secondary" disabled={busy||!acknowledged} onClick={()=>void run({revision:c.revision,acknowledgeSubscription:true},true)}>{busy?'Please wait…':'Disconnect management access'}</button></div>}
      </>}
    </>}
  </section>;
}
function ConnectionForm({state,busy,save,cancel}:{state:WebmasterResponse;busy:boolean;save:(data:unknown)=>Promise<void>;cancel:()=>void}){
  const c=state.connection;
  const [organizationId,setId]=useState(c?.organizationId||''),[organizationName,setName]=useState(c?.organizationName||''),[billingProvider,setBilling]=useState(c?.billingProvider||false),[members,setMembers]=useState<WebmasterMember[]>(c?.members||[]);
  const toggle=(id:string,p:WebmasterScope,checked:boolean)=>setMembers(current=>current.map(m=>{
    if(m.userId!==id)return m;const next=new Set(m.permissions);if(checked){next.add(p);if(p==='leads:write')next.add('leads:read');if(p==='tasks:write')next.add('tasks:read');}else{next.delete(p);if(p==='leads:read')next.delete('leads:write');if(p==='tasks:read')next.delete('tasks:write');}return {...m,permissions:[...next]};
  }));
  return <form className="webmaster-form" onSubmit={e=>{e.preventDefault();void save({organizationId,organizationName,billingProvider,members,revision:c?.revision||0});}}>
    <label>Organization ID<input required pattern="[a-z][a-z0-9-]*" maxLength={64} value={organizationId} onChange={e=>setId(e.target.value)} placeholder="website-studio"/></label>
    <label>Webmaster organization<input required maxLength={100} value={organizationName} onChange={e=>setName(e.target.value)} placeholder="Your webmaster’s business name"/></label>
    <label className="webmaster-check"><input type="checkbox" checked={billingProvider} onChange={e=>setBilling(e.target.checked)}/><span>This organization also provides our billing.</span></label>
    <p className="helper">Choose existing editor or analyst accounts and the work they may do. Selected accounts use only these permissions. Removing a member blocks their management access. Owners and administrators stay separate.</p>
    {state.eligibleUsers.length===0&&<p>Invite the webmaster’s team under Users &amp; access as editors or analysts, then reload this connection.</p>}
    {members.filter(m=>!state.eligibleUsers.some(u=>u.id===m.userId)).map(m=><fieldset key={m.userId}><legend>Unavailable member: {m.userId}</legend><p>This account is no longer eligible. Remove it from the connection before saving.</p><button type="button" className="secondary" disabled={busy} onClick={()=>setMembers(members.filter(member=>member.userId!==m.userId))}>Remove unavailable member</button></fieldset>)}
    {state.eligibleUsers.map(u=>{const member=members.find(m=>m.userId===u.id);return <fieldset key={u.id}><legend>{u.email}</legend><label className="webmaster-check"><input type="checkbox" checked={!!member} onChange={e=>setMembers(e.target.checked?[...members,{userId:u.id,permissions:[]}]:members.filter(m=>m.userId!==u.id))}/><span>Grant webmaster access to {u.email}</span></label>{member&&<div className="webmaster-scopes">{webmasterScopes.map(p=><label className="webmaster-check" key={p}><input type="checkbox" checked={member.permissions.includes(p)} onChange={e=>toggle(u.id,p,e.target.checked)}/><span>{labels[p]}</span></label>)}</div>}</fieldset>;})}
    <p className="helper">This connection does not activate billing or create a subscription. Your billing is configured separately.</p>
    <div className="webmaster-actions"><button type="button" className="secondary" disabled={busy} onClick={cancel}>Cancel</button><button className="primary" disabled={busy}>{busy?'Saving…':'Save webmaster connection'}</button></div>
  </form>;
}
