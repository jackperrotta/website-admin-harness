import React,{useEffect,useRef,useState} from 'react';
import {isObject} from '../../../contracts/src/index.ts';
import type {BootstrapResponse,LeadRow,LeadFollowUp,LeadsResponse,LeadTeamMember} from '../../../contracts/src/index.ts';
import './leads.css';

const empty:LeadFollowUp={assignedTo:null,dueDate:null,notes:'',completed:false,revision:0,updatedAt:null};
const message=(error:unknown)=>error instanceof Error?error.message:'The request could not be completed';
async function request<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
  const response=await fetch('/api/'+path,{signal,cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
  const value:unknown=await response.json();if(!response.ok)throw new Error(isObject(value)&&typeof value.error==='string'?value.error:'The request could not be completed');return value as T;
}
const due=(row:LeadRow)=>row.status!=='closed'&&!row.followUp?.completed&&!!row.followUp?.dueDate&&row.followUp.dueDate<=new Date().toISOString().slice(0,10);

export function LeadsWorkspace({boot}:{boot:BootstrapResponse}){
  const [mode,setMode]=useState('production'),[query,setQuery]=useState(''),[draftQuery,setDraftQuery]=useState(''),[status,setStatus]=useState('all'),[queue,setQueue]=useState('all'),[mine,setMine]=useState(false);
  const [cursors,setCursors]=useState<string[]>([]),[version,setVersion]=useState(0),[data,setData]=useState<LeadsResponse|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[selected,setSelected]=useState<LeadRow|null>(null),[team,setTeam]=useState<LeadTeamMember[]>([]);
  const dirty=useRef(false),canWrite=boot.user?.role!=='analyst';
  useEffect(()=>{if(canWrite){const controller=new AbortController();request<{rows:LeadTeamMember[]}>('leads/team',undefined,controller.signal).then(value=>setTeam(value.rows)).catch(()=>{});return()=>controller.abort();}},[canWrite]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    const params=new URLSearchParams({mode,limit:'50'});
    if(mode!=='test'){if(query)params.set('q',query);if(status!=='all')params.set('status',status);if(queue!=='all')params.set('queue',queue);if(mine&&boot.user)params.set('assignee',boot.user.id);if(cursors.length)params.set('cursor',cursors.at(-1)!);}
    request<LeadsResponse>('leads?'+params,undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(error=>{if(!controller.signal.aborted)setError(message(error));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[mode,query,status,queue,mine,cursors,version,boot.user?.id]);
  const choose=(row:LeadRow|null)=>{if(dirty.current&&!window.confirm('Discard unsaved follow-up changes?'))return;dirty.current=false;setSelected(row);};
  const refresh=()=>setVersion(v=>v+1);
  const names=new Map(team.map(member=>[member.id,member.email]));
  const legacy=mode!=='test'&&!!data&&!data.pagination;
  const rows=(data?.rows||[]).filter(row=>!legacy||(status==='all'||row.status===status)&&`${row.name} ${row.email} ${row.message}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <div className="page-heading"><div><p className="eyebrow">LEADS</p><h1>Every enquiry starts here.</h1><p>Give each conversation an owner and a clear next step.</p></div><button className="secondary" disabled={loading} onClick={refresh}>Refresh leads</button></div>
    <div className="leads-controls">
      <label>Submission view<select aria-label="Submission view" value={mode} onChange={event=>{if(dirty.current&&!window.confirm('Discard unsaved follow-up changes?'))return;dirty.current=false;setSelected(null);setMode(event.target.value);setCursors([]);setQueue('all');setMine(false);setStatus('all');setQuery('');setDraftQuery('');}}><option value="production">Production enquiries</option><option value="test">Test submissions</option></select></label>
      {mode!=='test'&&<><form onSubmit={event=>{event.preventDefault();setQuery(draftQuery.trim());setCursors([]);}}><label>Search leads<input type="search" maxLength={200} placeholder="Name, email, or message" value={draftQuery} onChange={event=>setDraftQuery(event.target.value)}/></label><button className="secondary">Search</button></form>
      <label>Status<select aria-label="Status" value={status} onChange={event=>{setStatus(event.target.value);setCursors([]);}}><option value="all">All statuses</option><option value="new">New</option><option value="contacted">Contacted</option><option value="closed">Closed</option></select></label>
      <label>Follow-up queue<select aria-label="Follow-up queue" disabled={!data?.followUpsEnabled} value={queue} onChange={event=>{setQueue(event.target.value);setCursors([]);}}><option value="all">All enquiries</option><option value="due">Follow-ups due</option></select></label>
      <label className="leads-mine"><input type="checkbox" disabled={!data?.followUpsEnabled} checked={mine} onChange={event=>{setMine(event.target.checked);setCursors([]);}}/>Assigned to me</label></>}
    </div>
    {error&&<div className="alert" role="alert">{error}<button className="text-button" onClick={refresh}>Retry</button></div>}
    <p className="leads-context" role="status">{loading?'Loading enquiries…':data?.pagination?`${data.pagination.total} matching enquiries · ${data.pagination.newCount} new across all enquiries`:`${rows.length} enquiries loaded`}{queue==='due'?' · Due today or earlier, UTC':''}</p>
    {legacy&&<p className="inline-notice">This backend exposes only its latest 200 enquiries. Search and status filters cover those loaded records. Upgrade the backend to enable full-history search, pagination and follow-up.</p>}
    {mode==='production'&&data?.pagination&&!data.followUpsEnabled&&<p className="inline-notice">Follow-up requires the reviewed database migration. Existing enquiries remain available.</p>}
    {mode==='test'&&<p className="inline-notice">Test submissions are read-only and excluded from production leads and follow-up. This view shows up to 200 recent test records.</p>}
    <div className={'leads-layout'+(selected?' has-selection':'')}>
      <section className="panel" aria-label="Enquiries" aria-busy={loading}>
        {rows.length?<div className="table-wrap"><table><thead><tr><th>Contact</th><th>Enquiry</th><th>Status</th><th>Follow-up</th></tr></thead><tbody>{rows.map(row=><tr key={row.id} aria-selected={selected?.id===row.id}><td><button id={'lead-'+encodeURIComponent(row.id)} className="contact-button" onClick={()=>choose(row)}>{row.name||'Website visitor'}</button><small>{row.email}</small></td><td><span className="message-preview">{row.message}</span><small>Received {row.created_at.slice(0,10)}</small></td><td><span className={'badge '+row.status}>{row.status}</span></td><td>{row.followUp?.assignedTo&&<small>{names.get(row.followUp.assignedTo)||'Assigned teammate'}</small>}{row.followUp?.completed?<span className="leads-complete">Complete</span>:row.followUp?.dueDate?<span className={due(row)?'leads-due':''}>{row.followUp.dueDate}{due(row)?' · Due':''}</span>:<span className="muted">No date set</span>}</td></tr>)}</tbody></table></div>:!loading&&<div className="empty"><h2>No enquiries to show.</h2><p>{query||queue!=='all'||mine||status!=='all'?'Try another search or clear your filters.':'New website enquiries appear here when forms are connected.'}</p></div>}
        {data?.pagination&&<nav className="leads-pagination" aria-label="Lead pages"><button className="secondary" disabled={loading||!cursors.length} onClick={()=>setCursors(values=>values.slice(0,-1))}>Previous</button><span>Page {cursors.length+1}</span><button className="secondary" disabled={loading||!data.pagination.nextCursor} onClick={()=>setCursors(values=>[...values,data.pagination!.nextCursor!])}>Next</button></nav>}
      </section>
      {selected&&<LeadDetail key={mode+selected.id} row={selected} team={team} writable={mode!=='test'&&canWrite&&data?.writable!==false} followUpsEnabled={!!data?.followUpsEnabled&&mode!=='test'} onDirty={value=>{dirty.current=value;}} onClose={()=>{const id=selected.id;choose(null);requestAnimationFrame(()=>document.getElementById('lead-'+encodeURIComponent(id))?.focus());}} onSaved={refresh}/>}
    </div>
  </>;
}
function LeadDetail({row,team,writable,followUpsEnabled,onDirty,onClose,onSaved}:{row:LeadRow;team:LeadTeamMember[];writable:boolean;followUpsEnabled:boolean;onDirty:(value:boolean)=>void;onClose:()=>void;onSaved:()=>void}){
  const [saved,setSaved]=useState(row.followUp||empty),[draft,setDraft]=useState(row.followUp||empty),[status,setStatus]=useState(row.status),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const heading=useRef<HTMLHeadingElement>(null),dirty=JSON.stringify(saved)!==JSON.stringify(draft);
  useEffect(()=>{heading.current?.focus();},[]);
  useEffect(()=>{onDirty(dirty);const leave=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[dirty]);
  const update=(value:Partial<LeadFollowUp>)=>{setDraft(current=>({...current,...value}));setNotice('');};
  const run=async(work:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await work();}catch(error){setError(message(error));}finally{setBusy(false);}};
  const reload=()=>run(async()=>{const result=await request<LeadsResponse>('leads?'+new URLSearchParams({id:row.id}));const current=result.rows.find(lead=>lead.id===row.id);if(!current)throw Error('This enquiry is no longer available');const f=current.followUp||empty;setSaved(f);setDraft(f);setStatus(current.status);setNotice('Loaded the latest saved follow-up.');});
  let fields:Record<string,unknown>={};try{const value=JSON.parse(row.fields_json||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))fields=value;}catch{}
  return <section className="panel leads-detail" aria-label="Lead details"><div className="panel-heading"><h2 ref={heading} tabIndex={-1}>{row.name||'Website visitor'}</h2><button className="text-button" onClick={onClose}>Close details</button></div><div className="leads-detail-body">
    <a href={'mailto:'+row.email}>{row.email}</a>{row.phone&&<p>Phone: {row.phone}</p>}<p className="lead-message">{row.message}</p>
    {!!Object.keys(fields).length&&<details><summary>Submitted fields</summary><dl>{Object.entries(fields).map(([key,value])=><React.Fragment key={key}><dt>{key}</dt><dd>{Array.isArray(value)?value.join(', '):String(value)}</dd></React.Fragment>)}</dl></details>}
    {row.notification_policy==='dashboard-only'?<p className="helper">Saved in your admin. Email notifications are disabled.</p>:row.notification_status&&<p className="helper">Notification: {row.notification_status}{row.notification_error?' · '+row.notification_error:''}. {row.status==='test'?'Test notification captured; no customer email is sent.':'Provider acceptance does not confirm inbox delivery.'}</p>}
    {error&&<div className="alert" role="alert">{error}{followUpsEnabled&&<button className="text-button" disabled={busy} onClick={()=>{if(!dirty||window.confirm('Replace your draft with the latest saved follow-up?'))void reload();}}>Reload saved follow-up</button>}</div>}
    {notice&&<p className="success" role="status">{notice}</p>}
    <label>Status<select aria-label="Status" disabled={!writable||busy} value={status} onChange={event=>{const next=event.target.value;void run(async()=>{await request('leads/status',{id:row.id,status:next});setStatus(next);setNotice('Lead status saved.');onSaved();});}}><option value="new">New</option><option value="contacted">Contacted</option><option value="closed">Closed</option>{row.status==='test'&&<option value="test">Test</option>}</select></label>
    {!writable&&<p className="helper">{row.status==='test'?'Test submissions are read-only.':'This connection is read-only. Follow-up and status changes require a lead-write grant.'}</p>}
    {followUpsEnabled&&<form onSubmit={event=>{event.preventDefault();void run(async()=>{const result=await request<{ok:true;followUp:LeadFollowUp}>('leads/follow-up',{id:row.id,assignedTo:draft.assignedTo,dueDate:draft.dueDate,notes:draft.notes,completed:draft.completed,revision:saved.revision});setSaved(result.followUp);setDraft(result.followUp);setNotice('Follow-up saved.');onSaved();});}}><h3>Next step</h3><fieldset disabled={!writable||busy}><label>Assigned teammate<select aria-label="Assigned teammate" value={draft.assignedTo||''} onChange={event=>update({assignedTo:event.target.value||null})}><option value="">Unassigned</option>{draft.assignedTo&&!team.some(member=>member.id===draft.assignedTo)&&<option value={draft.assignedTo}>Previously assigned teammate</option>}{team.map(member=><option key={member.id} value={member.id}>{member.email}</option>)}</select></label><label>Follow-up date (UTC)<input type="date" value={draft.dueDate||''} onChange={event=>update({dueDate:event.target.value||null})}/></label><label>Follow-up notes<textarea aria-label="Follow-up notes" rows={6} maxLength={3000} value={draft.notes} onChange={event=>update({notes:event.target.value})}/></label><label className="leads-mine"><input type="checkbox" checked={draft.completed} onChange={event=>update({completed:event.target.checked})}/>Follow-up complete</label><button className="primary" disabled={!dirty}>{busy?'Saving…':'Save follow-up'}</button></fieldset><p className="helper">Notes stay with this enquiry. Saving does not send an email or create an appointment.</p></form>}
  </div></section>;
}
