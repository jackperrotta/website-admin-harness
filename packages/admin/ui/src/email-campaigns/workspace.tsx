import React, { useEffect, useState, useRef, type ReactNode } from 'react';
import { defaultEmailSettings, starterEmailTemplates, type EmailWorkspace, type EmailContact, type EmailTemplate, type EmailBlock, type EmailSegment, type EmailRule, type EmailCampaign, type EmailAutomation, type EmailStep, type EmailSettings } from '../../../../contracts/src/email-campaigns.ts';
import { localInstants, wallDate, timeLabel } from '../scheduling/shared.tsx';
import './workspace.css';
const base = '/api/modules/email-campaigns';
async function api<T>(path: string, data?: unknown): Promise<T> { const response = await fetch(base + path, data === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }); const value = await response.json() as T & {
    error?: string;
}; if (!response.ok)
    throw Error(value.error || 'This email operation could not complete.'); return value; }
const errorText = (e: unknown) => e instanceof Error ? e.message : 'The request failed.';
type Runner = (path: string, data: unknown) => Promise<unknown>;
type ReportSchedule = {
    id: string;
    revision: number;
    name: string;
    templateId: string;
    segmentId: string;
    days: number;
    nextAt: string;
    status: string;
};
function Field({label,children,hint}:{label:string;children:ReactNode;hint?:string}){const id=React.useId();let assigned=false;return <div className="ec-field"><label htmlFor={id}>{label}</label>{React.Children.map(children,child=>{if(!assigned&&React.isValidElement(child)&&typeof child.type==='string'&&['input','select','textarea'].includes(child.type)){assigned=true;return React.cloneElement(child as React.ReactElement<{id?:string;'aria-describedby'?:string}>,{id,...(hint?{'aria-describedby':id+'-hint'}:{})});}return child;})}{hint&&<small id={id+'-hint'}>{hint}</small>}</div>;}
function Empty({ children }: {
    children: ReactNode;
}) { return <div className="ec-empty">{children}</div>; }
function Badge({ children }: {
    children: ReactNode;
}) { return <span className="ec-badge">{children}</span>; }
function Editor({ title, children, close }: {
    title: string;
    children: ReactNode;
    close: () => void;
}) { const ref = useRef<HTMLDivElement>(null); useEffect(() => { const previous = document.activeElement as HTMLElement | null; (ref.current?.querySelector<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]')||ref.current)?.focus(); const listener = (e: KeyboardEvent) => { if (e.key === 'Escape')
    close(); if (e.key === 'Tab') {
    const nodes = ref.current?.querySelectorAll<HTMLElement>('input,select,textarea,button,a[href]');
    if (!nodes?.length)
        return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    }
    else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
} }; document.addEventListener('keydown', listener); return () => { document.removeEventListener('keydown', listener); previous?.focus(); }; }, []); return <div className="ec-overlay"><div className="ec-editor" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}><header><h2>{title}</h2><button type="button" className="secondary" aria-label="Close editor" onClick={close}>Close</button></header>{children}</div></div>; }
function Save({ busy, label = 'Save draft' }: {
    busy: boolean;
    label?: string;
}) { return <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : label}</button>; }
function useRows<T>(path:string,refresh:number){
 const [rows,setRows]=useState<T[]>([]),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');const generation=useRef(0);
 const load=async(more=false)=>{const id=++generation.current;setLoading(true);setError('');try{const data=await api<{rows:T[];nextCursor?:string|null}>(path+(path.includes('?')?'&':'?')+(more&&cursor?'cursor='+encodeURIComponent(cursor):''));if(id!==generation.current)return;setRows(old=>more?[...old,...data.rows]:data.rows);setCursor(data.nextCursor||null);}catch(e){if(id===generation.current)setError(errorText(e));}finally{if(id===generation.current)setLoading(false);}};
 useEffect(()=>{void load();return()=>{generation.current++;};},[path,refresh]);return {rows,cursor,loading,error,load};
}
function ListState<T>({ list }: {
    list: ReturnType<typeof useRows<T>>;
}) { return <>{list.error && <p role="alert" className="ec-error">{list.error}</p>}{list.loading && <p role="status">Loading…</p>}{list.cursor && <button className="secondary" onClick={() => list.load(true)}>Load more</button>}</>; }
function ContactForm({ value, run, close }: {
    value?: EmailContact;
    run: Runner;
    close: () => void;
}) { const [v, set] = useState<EmailContact>(value || { id: '', revision: 0, email: '', name: '', company: '', stage: 'lead', tags: [], fields: {}, source: 'manual', interactionRef: '', serviceRef: '', topics: {}, evidence: '' }), [busy, b] = useState(false), [error, e] = useState(''); const update = (patch: Partial<EmailContact>) => set(old => ({ ...old, ...patch })); return <Editor title={value ? 'Edit contact' : 'Add contact'} close={close}><form onSubmit={async (event) => { event.preventDefault(); b(true); e(''); try {
    await run('/contacts', v);
    close();
}
catch (error) {
    e(errorText(error));
}
finally {
    b(false);
} }}><div className="ec-grid">{(['name', 'email', 'company', 'stage', 'source'] as const).map(key => <Field key={key} label={key === 'email' ? 'Email address' : key[0].toUpperCase() + key.slice(1)}><input value={v[key]} type={key === 'email' ? 'email' : 'text'} required={key === 'email'} disabled={key === 'email' && !!value} onChange={event => update({ [key]: event.target.value })}/></Field>)}<Field label="Tags" hint="Separate tags with commas."><input value={v.tags.join(', ')} onChange={event => update({ tags: event.target.value.split(',').map(s => s.trim()).filter(Boolean) })}/></Field><Field label="Agreed service reference" hint="Record the service or agreement that these reports relate to."><input value={v.serviceRef} onChange={event => update({ serviceRef: event.target.value })}/></Field><Field label="Customer interaction reference"><input value={v.interactionRef} onChange={event => update({ interactionRef: event.target.value })}/></Field></div><Field label="Permission and purpose evidence"><textarea value={v.evidence} onChange={event => update({ evidence: event.target.value })}/></Field><fieldset><legend>Optional email preferences</legend>{(['reports', 'service', 'newsletter'] as const).map(topic => <label className="ec-check" key={topic}><input type="checkbox" checked={!!v.topics[topic]} onChange={event => update({ topics: { ...v.topics, [topic]: event.target.checked } })}/>{topic === 'reports' ? 'Customer reports' : topic === 'service' ? 'Service updates and requested responses' : 'Newsletter interest · draft only'}</label>)}<p className="helper">Existing opt-outs stay in place until the recipient confirms a new request.</p></fieldset><fieldset><legend>Custom fields</legend>{Object.entries(v.fields).map(([key, val]) => <div className="ec-inline" key={key}><span>{key}</span><input aria-label={key} value={val} onChange={event => update({ fields: { ...v.fields, [key]: event.target.value } })}/><button type="button" className="secondary" onClick={() => update({ fields: Object.fromEntries(Object.entries(v.fields).filter(([k]) => k !== key)) })}>Remove</button></div>)}<button type="button" className="secondary" onClick={() => { let index=1;while('field'+index in v.fields)index++;const key='field'+index;update({fields:{...v.fields,[key]:''}}); }}>Add custom field</button></fieldset>{error && <p className="ec-error" role="alert">{error}</p>}<Save busy={busy} label="Save contact"/></form></Editor>; }
function ImportForm({ run, close }: {
    run: Runner;
    close: () => void;
}) { const [csv, setCsv] = useState(''), [mapping, map] = useState<Record<string, string>>({ email: 'email', name: 'name', company: 'company', tags: 'tags', stage: 'stage', serviceRef: 'serviceRef', interactionRef: 'interactionRef',fields:'fields' }), [evidence, setEvidence] = useState(''), [preview, setPreview] = useState<{
    valid: number;
    duplicates: number;
    errors: Array<{
        row: number;
        error: string;
    }>;
    rows: EmailContact[];
} | null>(null), [error, setError] = useState(''), [busy, b] = useState(false); return <Editor title="Import contacts" close={close}><p>Importing records does not subscribe them or remove an opt-out. Existing addresses are retained.</p><Field label="CSV file"><input type="file" accept=".csv,text/csv" onChange={async (e) => { const file = e.target.files?.[0]; if (file) {
    if (file.size > 1500000) {
        setError('Use a CSV under 1.5 MB.');
        return;
    }
    setCsv(await file.text());
    setPreview(null);
} }}/></Field><div className="ec-grid">{Object.entries(mapping).map(([key, value]) => <Field key={key} label={key + ' column'}><input value={value} onChange={e => { map({ ...mapping, [key]: e.target.value }); setPreview(null); }}/></Field>)}</div><Field label="Import source"><input value={evidence} onChange={e => { setEvidence(e.target.value); setPreview(null); }}/></Field><button className="secondary" disabled={!csv || busy} onClick={async () => { b(true); try {
    setPreview(await api('/imports/preview', { csv, mapping, evidence }));
    setError('');
}
catch (e) {
    setError(errorText(e));
}
finally {
    b(false);
} }}>Preview import</button>{preview && <div className="ec-review"><p>{preview.valid} valid contacts · {preview.duplicates} duplicate rows</p>{preview.errors.map(row => <p key={row.row}>Row {row.row}: {row.error}</p>)}{preview.rows.map(row => <p key={row.email}>{row.name || 'Unnamed contact'} · {row.email}</p>)}<button className="primary" disabled={!!preview.errors.length || busy} onClick={async () => { b(true); try {
    await run('/imports/start', { csv, mapping, evidence, reviewed: true });
    close();
}
catch (e) {
    setError(errorText(e));
}
finally {
    b(false);
} }}>Import reviewed contacts</button></div>}{error && <p role="alert" className="ec-error">{error}</p>}</Editor>; }
const ruleFields = ['stage', 'tag', 'source', 'company', 'service', 'interaction', 'topic', 'event'];
function RuleEditor({ rule, onChange }: {
    rule: EmailRule;
    onChange: (r: EmailRule) => void;
}) { return <div className="ec-rule"><Field label="Field"><select value={ruleFields.includes(rule.field) ? rule.field : 'custom'} onChange={e => onChange({ ...rule, field: e.target.value === 'custom' ? 'custom.field1' : e.target.value })}>{[...ruleFields, 'custom'].map(x => <option key={x}>{x}</option>)}</select></Field>{rule.field.startsWith('custom.') && <Field label="Custom field name"><input value={rule.field.slice(7)} onChange={e => onChange({ ...rule, field: 'custom.' + e.target.value })}/></Field>}<Field label="Comparison"><select value={rule.op} onChange={e => onChange({ ...rule, op: e.target.value as EmailRule['op'] })}>{['eq', 'neq', 'contains', 'exists', 'not_exists'].map(x => <option key={x}>{x}</option>)}</select></Field><Field label="Value"><input value={rule.value} onChange={e => onChange({ ...rule, value: e.target.value })}/></Field></div>; }
function SegmentForm({ value, run, close }: {
    value?: EmailSegment;
    run: Runner;
    close: () => void;
}) { const [v, set] = useState<EmailSegment>(value || { id: '', revision: 0, name: '', match: 'all', rules: [] }), [error, e] = useState(''), [busy, b] = useState(false); return <Editor title="Audience segment" close={close}><form onSubmit={async (ev) => { ev.preventDefault(); b(true); try {
    await run('/segments', v);
    close();
}
catch (error) {
    e(errorText(error));
}
finally {
    b(false);
} }}><Field label="Segment name"><input required value={v.name} onChange={e => set({ ...v, name: e.target.value })}/></Field><Field label="Match rules"><select value={v.match} onChange={e => set({ ...v, match: e.target.value as 'all' | 'any' })}><option value="all">All rules</option><option value="any">Any rule</option></select></Field>{v.rules.map((r, i) => <div className="ec-section" key={i}><RuleEditor rule={r} onChange={rule => set({ ...v, rules: v.rules.map((x, n) => n === i ? rule : x) })}/><button type="button" className="secondary" onClick={() => set({ ...v, rules: v.rules.filter((_, n) => n !== i) })}>Remove rule</button></div>)}<button className="secondary" type="button" disabled={v.rules.length >= 16} onClick={() => set({ ...v, rules: [...v.rules, { field: 'stage', op: 'eq', value: 'customer' }] })}>Add rule</button><p className="helper">An empty rule set includes all contacts. Sending still checks topic preferences, suppressions, and purpose evidence.</p>{error && <p role="alert" className="ec-error">{error}</p>}<Save busy={busy} label="Save segment"/></form></Editor>; }
function TemplateForm({ value, run, close }: {
    value?: EmailTemplate;
    run: Runner;
    close: () => void;
}) { const [v, set] = useState<EmailTemplate>(value || { ...starterEmailTemplates()[1], id: '', revision: 0, name: 'New personal response' }), [busy, b] = useState(false), [error, e] = useState(''), [savedId, setSaved] = useState(value?.id || ''), [testContact, setTestContact] = useState(''), [testRecipient, setTestRecipient] = useState(''); const sampleContacts = useRows<EmailContact>('/contacts', 0); const block = (index: number, patch: Partial<EmailBlock>) => set({ ...v, blocks: v.blocks.map((x, i) => i === index ? { ...x, ...patch } : x) }); return <Editor title="Email template" close={close}><form onSubmit={async (event) => { event.preventDefault(); b(true); try {
    const response = await run('/templates', v) as {
        result: EmailTemplate;
    };
    set(response.result);
    setSaved(response.result.id);
    e('');
}
catch (error) {
    e(errorText(error));
}
finally {
    b(false);
} }}><div className="ec-grid"><Field label="Template name"><input required value={v.name} onChange={e => set({ ...v, name: e.target.value })}/></Field><Field label="Layout"><select value={v.layout} onChange={e => set({ ...v, layout: e.target.value as EmailTemplate['layout'] })}>{['letter', 'report', 'update', 'newsletter'].map(x => <option key={x}>{x}</option>)}</select></Field></div>{v.layout === 'newsletter' && <p className="ec-note">Newsletter drafting is available. Sending is awaiting confirmation of permitted use.</p>}<Field label="Subject"><input required maxLength={250} value={v.subject} onChange={e => set({ ...v, subject: e.target.value })}/></Field><Field label="Preheader"><input maxLength={250} value={v.preheader} onChange={e => set({ ...v, preheader: e.target.value })}/></Field><p className="helper">Personalize with {'{{firstName|there}}'}, {'{{name|customer}}'}, {'{{company|your business}}'}, and report.title, report.period, report.summary with fallbacks.</p>{v.blocks.map((item, index) => <fieldset key={index}><legend>Section {index + 1}</legend><div className="ec-inline"><select aria-label={'Section ' + (index + 1) + ' type'} value={item.type} onChange={e => block(index, { type: e.target.value as EmailBlock['type'] })}>{['heading', 'paragraph', 'button', 'image', 'divider'].map(x => <option key={x}>{x}</option>)}</select><button type="button" className="secondary" disabled={!index} onClick={() => { const next = [...v.blocks]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; set({ ...v, blocks: next }); }}>Move up</button><button type="button" className="secondary" disabled={index === v.blocks.length - 1} onClick={() => { const next = [...v.blocks]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; set({ ...v, blocks: next }); }}>Move down</button><button type="button" className="secondary" disabled={v.blocks.length === 1} onClick={() => set({ ...v, blocks: v.blocks.filter((_, i) => i !== index) })}>Remove</button></div>{item.type !== 'divider' && <Field label={item.type === 'button' ? 'Button label' : 'Content'}><textarea value={item.text} onChange={e => block(index, { text: e.target.value })}/></Field>}{['button', 'image'].includes(item.type) && <Field label={item.type === 'image' ? 'Image URL' : 'Destination URL'}><input type="url" value={item.url || ''} onChange={e => block(index, { url: e.target.value })}/></Field>}{item.type === 'image' && <><Field label="Image description"><input value={item.alt || ''} onChange={e => block(index, { alt: e.target.value })}/></Field><Field label="Upload image"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (ev) => { const file = ev.target.files?.[0]; if (!file)
    return; if (file.size > 1000000) {
    e('Choose an image under 1 MB.');
    return;
} try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let raw = '';
    for (const byte of bytes)
        raw += String.fromCharCode(byte);
    const response = await run('/assets', { name: file.name, type: file.type, content: btoa(raw) }) as {
        result: {
            url: string;
        };
    };
    block(index, { url: response.result.url });
}
catch (error) {
    e(errorText(error));
} }}/></Field></>}</fieldset>)}<button type="button" className="secondary" disabled={v.blocks.length >= 40} onClick={() => set({ ...v, blocks: [...v.blocks, { type: 'paragraph', text: '' }] })}>Add section</button>{error && <p className="ec-error" role="alert">{error}</p>}<div className="ec-inline"><Save busy={busy} label="Save template"/>{savedId && <a className="secondary" href={base + '/preview?template=' + encodeURIComponent(savedId)} target="_blank" rel="noreferrer">Open saved preview</a>}</div>{savedId && <fieldset><legend>Test with a sample contact</legend><Field label="Sample contact"><select value={testContact} onChange={ev => setTestContact(ev.target.value)}><option value="">Choose a contact</option>{sampleContacts.rows.map(contact => <option value={contact.id} key={contact.id}>{contact.name || contact.email}</option>)}</select></Field><Field label="Explicit test recipient"><input type="email" value={testRecipient} onChange={ev => setTestRecipient(ev.target.value)}/></Field><p className="helper">Uses the saved template and current capture/send mode. Live tests require an installation-approved test address. Newsletter tests remain captured.</p><button type="button" className="secondary" disabled={!testContact || !testRecipient || busy} onClick={async () => { b(true); try {
    await run('/test', { templateId: savedId, contactId: testContact, recipient: testRecipient, reviewed: true });
    e('');
}
catch (error) {
    e(errorText(error));
}
finally {
    b(false);
} }}>Queue addressed test</button></fieldset>}{savedId && <iframe title="Saved email preview" className="ec-preview" sandbox="allow-popups" src={base + '/preview?template=' + encodeURIComponent(savedId) + '&revision=' + v.revision}/>}</form></Editor>; }
function CampaignForm({ value, templates, segments, timezone, run, close }: {
    value?: EmailCampaign;
    templates: EmailTemplate[];
    segments: EmailSegment[];
    timezone: string;
    run: Runner;
    close: () => void;
}) { const [v, set] = useState<EmailCampaign>(value || { id: '', revision: 0, name: '', purpose: 'service-update', templateId: templates[0]?.id || '', segmentId: '', excludeIds: [], scheduledAt: '', status: 'draft', recurrenceDays: 0 }), [wall, setWall] = useState(''), [error, e] = useState(''), [busy, b] = useState(false); const contacts = useRows<EmailContact>('/contacts', 0); return <Editor title="Campaign draft" close={close}><form onSubmit={async (event) => { event.preventDefault(); b(true); try {
    let scheduledAt = v.scheduledAt;
    if (wall) {
        const instants = localInstants(wall, timezone);
        if (instants.length !== 1)
            throw Error('This local time is missing or repeated during a daylight-saving transition. Choose another time.');
        scheduledAt = instants[0];
    }
    await run('/campaigns', { ...v, scheduledAt });
    close();
}
catch (error) {
    e(errorText(error));
}
finally {
    b(false);
} }}><Field label="Campaign name"><input required value={v.name} onChange={e => set({ ...v, name: e.target.value })}/></Field><div className="ec-grid"><Field label="Communication purpose"><select value={v.purpose} onChange={e => set({ ...v, purpose: e.target.value as EmailCampaign['purpose'] })}><option value="customer-report">Agreed customer report</option><option value="service-update">Agreed service update</option><option value="enquiry-response">Requested enquiry response</option><option value="newsletter-draft">Newsletter · draft only</option></select></Field><Field label="Template"><select value={v.templateId} onChange={e => set({ ...v, templateId: e.target.value })}>{templates.map(t => <option value={t.id} key={t.id}>{t.name}</option>)}</select></Field><Field label="Audience"><select value={v.segmentId} onChange={e => set({ ...v, segmentId: e.target.value })}><option value="">All contacts</option>{segments.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></Field><Field label={'Start time · ' + timezone} hint={v.scheduledAt ? 'Saved: ' + new Date(v.scheduledAt).toLocaleString('en-US', { timeZone: timezone }) : 'Leave blank to start after approval.'}><input type="datetime-local" value={wall} onChange={e => setWall(e.target.value)}/></Field><Field label="Create next issue draft after days" hint="0 means no recurring draft. New issues require review."><input type="number" min={0} max={365} value={v.recurrenceDays || 0} onChange={e => set({ ...v, recurrenceDays: Number(e.target.value) })}/></Field><Field label="Exclude contacts" hint="Use search in Contacts to check recipient records before approval."><select multiple value={v.excludeIds} onChange={e => set({ ...v, excludeIds: Array.from(e.target.selectedOptions, o => o.value) })}>{contacts.rows.map(c => <option key={c.id} value={c.id}>{c.name || c.email}</option>)}</select></Field></div>{error && <p role="alert" className="ec-error">{error}</p>}<Save busy={busy}/></form></Editor>; }
function ReviewCampaign({ campaign, mode, run, close }: {
    campaign: EmailCampaign;
    mode: string;
    run: Runner;
    close: () => void;
}) { const [audience, set] = useState<{
    total: number;
    eligible: number;
    excluded: number;
    sample: EmailContact[];
} | null>(null), [error, e] = useState(''), [busy, b] = useState(false); useEffect(() => { void api<typeof audience>('/audience?' + new URLSearchParams({ segment: campaign.segmentId, purpose: campaign.purpose, exclude: campaign.excludeIds.join(',') })).then(set).catch(error => e(errorText(error))); }, []); return <Editor title="Review campaign audience" close={close}><h3>{campaign.name}</h3><p>{campaign.purpose} · {mode === 'capture' ? 'Capture only' : 'Live email sending'}</p>{audience ? <><div className="ec-stats"><div><strong>{audience.eligible}</strong>eligible recipients</div><div><strong>{audience.excluded}</strong>excluded or ineligible</div></div><p>Audience membership and content are frozen when you approve. Opt-outs, suppressions, and purpose eligibility are checked again before each submission.</p><h4>Audience sample</h4>{audience.sample.map(c => <p key={c.id}>{c.name || 'Unnamed contact'} · {c.email}</p>)}<button className="primary" disabled={busy || !audience.eligible || campaign.purpose === 'newsletter-draft'} onClick={async () => { b(true); try {
    await run('/campaigns/approve', { id: campaign.id, revision: campaign.revision, audienceCount: audience.eligible, reviewed: true });
    close();
}
catch (error) {
    e(errorText(error));
}
finally {
    b(false);
} }}>{mode === 'capture' ? 'Approve captured campaign' : 'Approve live campaign'}</button></> : <p role="status">Checking the full audience…</p>}{error && <p role="alert" className="ec-error">{error}</p>}</Editor>; }
function AutomationForm({ value, templates, run, close }: {
    value?: EmailAutomation;
    templates: EmailTemplate[];
    run: Runner;
    close: () => void;
}) { const [v, set] = useState<EmailAutomation>(value || { id: '', revision: 0, name: '', trigger: 'lead.created', purpose: 'enquiry-response', status: 'draft', steps: [{ type: 'send', templateId: 'starter-response' }] }), [error, e] = useState(''), [busy, b] = useState(false); const step = (i: number, value: EmailStep) => set({ ...v, steps: v.steps.map((s, n) => n === i ? value : s) }); return <Editor title="Guided automation" close={close}><form onSubmit={async (event) => { event.preventDefault(); b(true); try {
    await run('/automations', v);
    close();
}
catch (error) {
    e(errorText(error));
}
finally {
    b(false);
} }}><Field label="Automation name"><input required value={v.name} onChange={e => set({ ...v, name: e.target.value })}/></Field><div className="ec-grid"><Field label="Website trigger"><select value={v.trigger} onChange={e => set({ ...v, trigger: e.target.value as EmailAutomation['trigger'] })}>{[['lead.created', 'New website enquiry'], ['service.updated', 'Agreed service update'], ['report.ready', 'Customer report ready'], ['manual', 'Manual enrollment'], ['subscription.confirmed', 'Confirmed preference']].map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></Field><Field label="Purpose"><select value={v.purpose} onChange={e => set({ ...v, purpose: e.target.value as EmailAutomation['purpose'] })}><option value="enquiry-response">Requested enquiry response</option><option value="service-update">Agreed service update</option><option value="customer-report">Agreed customer report</option></select></Field></div><p className="helper">Published versions stay with their current enrollments. Saving edits creates a draft for a new version. Replies are handled in your normal inbox; record a stop manually.</p>{v.steps.map((s, i) => <fieldset key={i}><legend>Step {i + 1}</legend><div className="ec-inline"><select aria-label={'Step ' + (i + 1) + ' action'} value={s.type} onChange={e => { const type = e.target.value; step(i, type === 'wait' ? { type, minutes: 60 } : type === 'send' ? { type, templateId: templates[0]?.id || '' } : type === 'condition' ? { type, rule: { field: 'stage', op: 'eq', value: 'customer' }, skip: 1 } : type === 'task' ? { type, title: '' } : type === 'exit' ? { type } : { type: type as 'tag' | 'stage', value: '' }); }}>{['send', 'wait', 'condition', 'tag', 'stage', 'task', 'exit'].map(x => <option key={x}>{x}</option>)}</select><button type="button" className="secondary" onClick={() => set({ ...v, steps: v.steps.filter((_, n) => n !== i) })}>Remove step</button></div>{s.type === 'send' && <Field label="Send template"><select value={s.templateId} onChange={e => step(i, { ...s, templateId: e.target.value })}>{templates.filter(t => t.layout !== 'newsletter').map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}{s.type === 'wait' && <Field label="Wait minutes"><input type="number" min={1} max={43200} value={s.minutes} onChange={e => step(i, { ...s, minutes: Number(e.target.value) })}/></Field>}{s.type === 'condition' && <><RuleEditor rule={s.rule} onChange={rule => step(i, { ...s, rule })}/><Field label="Skip next steps when condition is false"><input type="number" min={1} max={12 - i} value={s.skip} onChange={e => step(i, { ...s, skip: Number(e.target.value) })}/></Field></>}{(s.type === 'tag' || s.type === 'stage') && <Field label={s.type === 'tag' ? 'Tag to add' : 'New stage'}><input value={s.value} onChange={e => step(i, { ...s, value: e.target.value })}/></Field>}{s.type === 'task' && <Field label="Staff task"><input value={s.title} onChange={e => step(i, { ...s, title: e.target.value })}/></Field>}</fieldset>)}<button type="button" className="secondary" disabled={v.steps.length >= 12} onClick={() => set({ ...v, steps: [...v.steps, { type: 'wait', minutes: 60 }] })}>Add step</button>{error && <p role="alert" className="ec-error">{error}</p>}<Save busy={busy}/></form></Editor>; }
function SettingsForm({ workspace, run }: {
    workspace: EmailWorkspace;
    run: Runner;
}) { const [v, set] = useState<EmailSettings>(workspace.settings.data || defaultEmailSettings()), [revision, rev] = useState(workspace.settings.revision), [busy, b] = useState(false), [error, e] = useState(''), [notice, n] = useState(''); return <form onSubmit={async (event) => { event.preventDefault(); b(true); e(''); try {
    const response = await run('/settings', { settings: v, revision }) as {
        result: {
            revision: number;
        };
    };
    rev(response.result.revision);
    n('Email settings saved.');
}
catch (error) {
    e(errorText(error));
}
finally {
    b(false);
} }}><div className="ec-grid"><Field label="Sending mode"><select value={v.mode} onChange={e => set({ ...v, mode: e.target.value as 'capture' | 'send' })}><option value="capture">Capture · no email sent</option><option value="send" disabled={!workspace.readiness.liveReady}>Send · verified business sender</option></select></Field><Field label="Sender name"><input value={v.senderName} onChange={e => set({ ...v, senderName: e.target.value })}/></Field><Field label="Business logo"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (ev) => { const file = ev.target.files?.[0]; if (!file)
    return; if (file.size > 1000000) {
    e('Choose a logo under 1 MB.');
    return;
} try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let raw = '';
    for (const byte of bytes)
        raw += String.fromCharCode(byte);
    const response = await run('/assets', { name: file.name, type: file.type, content: btoa(raw) }) as {
        result: {
            url: string;
        };
    };
    set({ ...v, logoUrl: response.result.url });
}
catch (error) {
    e(errorText(error));
} }}/>{v.logoUrl && <><img src={v.logoUrl} alt="Business logo preview" style={{ maxWidth: 140 }}/><button className="secondary" type="button" onClick={() => set({ ...v, logoUrl: '' })}>Remove logo</button></>}</Field><Field label="Reply address"><input type="email" value={v.replyTo} onChange={e => set({ ...v, replyTo: e.target.value })}/></Field><Field label="Business timezone"><input value={v.timezone} onChange={e => set({ ...v, timezone: e.target.value })}/></Field><Field label="Accent color"><input type="color" value={v.accent} onChange={e => set({ ...v, accent: e.target.value })}/></Field><Field label="Mailing address"><textarea value={v.postalAddress} onChange={e => set({ ...v, postalAddress: e.target.value })}/></Field>{([['perMinute', 'Submissions per minute'], ['dailyLimit', 'Module daily limit'], ['monthlyLimit', 'Module monthly limit'], ['recipientCap', 'Campaign recipient limit'], ['spacingHours', 'Minimum hours between optional emails'], ['otherAccountEmails', 'Other counted account emails this month'], ['reservedDaily', 'Daily quota reserved for essential mail']] as const).map(([key, label]) => <Field key={key} label={label}><input type="number" min={0} value={v[key]} onChange={e => set({ ...v, [key]: Number(e.target.value) })}/></Field>)}</div><label className="ec-check"><input type="checkbox" checked={v.enabled} onChange={e => set({ ...v, enabled: e.target.checked })}/>Enable customer communication processing</label><label className="ec-check"><input type="checkbox" checked={v.clickTracking} onChange={e => set({ ...v, clickTracking: e.target.checked })}/>Measure button clicks · automated scanners can affect counts</label><p className="helper">Captured jobs never become live mail when you change modes. Native sender readiness, daily quota, and feedback are configured in this business’s installation.</p>{workspace.readiness.issues.length > 0 && <div className="ec-note"><h3>Installation readiness</h3><ul>{workspace.readiness.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}{error && <p role="alert" className="ec-error">{error}</p>}{notice && <p role="status">{notice}</p>}<Save busy={busy} label="Save email settings"/><button type="button" className="secondary" onClick={async()=>{try{const saved=await api<EmailWorkspace>('/workspace');set(saved.settings.data);rev(saved.settings.revision);e('');n('Loaded saved settings.');}catch(error){e(errorText(error));}}}>Reload saved settings</button></form>; }
function ReportForm({ templates, segments, run, close }: {
    templates: EmailTemplate[];
    segments: EmailSegment[];
    run: Runner;
    close: () => void;
}) { const [v, set] = useState({ name: 'Website customer report', templateId: 'starter-report', segmentId: '', days: 30, nextAt: new Date().toISOString(), revision: 0, status: 'active' }), [error, e] = useState(''); return <Editor title="Recurring customer report" close={close}><form onSubmit={async (event) => { event.preventDefault(); try {
    await run('/report-schedules', v);
    close();
}
catch (error) {
    e(errorText(error));
} }}><Field label="Report name"><input value={v.name} onChange={e => set({ ...v, name: e.target.value })}/></Field><Field label="Report template"><select value={v.templateId} onChange={e => set({ ...v, templateId: e.target.value })}>{templates.filter(t => t.layout !== 'newsletter').map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field><Field label="Audience"><select value={v.segmentId} onChange={e => set({ ...v, segmentId: e.target.value })}><option value="">All eligible report contacts</option>{segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field><Field label="Report period and recurrence in days"><input type="number" min={1} max={90} value={v.days} onChange={e => set({ ...v, days: Number(e.target.value) })}/></Field><p>Each run reads current analytics from this installation’s website connection. Missing or stale data blocks the report. Recipients must have an agreed service reference and a report preference.</p>{error && <p role="alert" className="ec-error">{error}</p>}<Save busy={false} label="Save report schedule"/></form></Editor>; }
function ArticleForm({ run, close }: {
    run: Runner;
    close: () => void;
}) { const [v, set] = useState({ title: '', summary: '', url: '' }), [error, e] = useState(''); return <Editor title="Create a newsletter draft from an article" close={close}><form onSubmit={async (ev) => { ev.preventDefault(); try {
    await run('/article-draft', v);
    close();
}
catch (error) {
    e(errorText(error));
} }}><Field label="Article title"><input required value={v.title} onChange={e => set({ ...v, title: e.target.value })}/></Field><Field label="Article summary"><textarea required value={v.summary} onChange={e => set({ ...v, summary: e.target.value })}/></Field><Field label="Article link"><input required type="url" value={v.url} onChange={e => set({ ...v, url: e.target.value })}/></Field><p>This creates an editable newsletter template. It does not fetch or publish the article or enable newsletter sending.</p>{error && <p role="alert" className="ec-error">{error}</p>}<Save busy={false} label="Create draft"/></form></Editor>; }
type Edit = {
    type: 'contact';
    value?: EmailContact;
} | {
    type: 'template';
    value?: EmailTemplate;
} | {
    type: 'segment';
    value?: EmailSegment;
} | {
    type: 'campaign';
    value?: EmailCampaign;
} | {
    type: 'automation';
    value?: EmailAutomation;
} | {
    type: 'review';
    value: EmailCampaign;
} | {
    type: 'import' | 'report' | 'article';
};
export default function EmailCampaignWorkspace() {
    const [workspace, set] = useState<EmailWorkspace | null>(null), [section, view] = useState('summary'), [refresh, reload] = useState(0), [edit, editor] = useState<Edit | null>(null), [error, e] = useState(''), [notice, n] = useState(''), [q, search] = useState(''), [detail, setDetail] = useState<unknown>(null),[exportFrom,setExportFrom]=useState(''),[exportTo,setExportTo]=useState('');
    const load = () => api<EmailWorkspace>('/workspace').then(set).catch(error => e(errorText(error)));
    useEffect(() => { void load(); }, [refresh]);
    const contacts = useRows<EmailContact>('/contacts?q=' + encodeURIComponent(q), refresh), campaigns = useRows<EmailCampaign>('/campaigns', refresh), templates = useRows<EmailTemplate>('/templates', refresh+(workspace?1:0)), segments = useRows<EmailSegment>('/segments', refresh), automations = useRows<EmailAutomation>('/automations', refresh), jobs = useRows<Record<string, unknown>>('/jobs', refresh), reports = useRows<ReportSchedule>('/report-schedules', refresh);
    const [reporting, setReporting] = useState<{
        byCampaign: Array<{
            campaign_id: string;
            state: string;
            total: number;
        }>;
        enrollments: Array<{
            id: string;
            automation_id: string;
            state: string;
            step: number;
        }>;
        imports: Array<{
            id: string;
            cursor: number;
            total: number;
            state: string;
        }>;
        daily: Array<{
            day: string;
            kind: string;
            total: number;
        }>;
        conversions:Array<{campaign_id:string;total:number}>;
        clicks: Array<{
            url: string;
            click_count: number;
        }>;
    } | null>(null);
    useEffect(() => { if (section === 'reporting' || section === 'summary')
        void api<typeof reporting>('/reporting').then(setReporting).catch(error => e(errorText(error))); }, [section, refresh]);
    const run: Runner = async (path, data) => { const response = await api(path, data); reload(x => x + 1); n('Changes saved.'); return response; };
    const action = async (path: string, data: unknown) => { e(''); try {
        await run(path, data);
    }
    catch (error) {
        e(errorText(error));
    } };
    useEffect(()=>{if(edit||!['summary','reporting','campaigns'].includes(section))return;const update=()=>{if(document.visibilityState==='visible')reload(x=>x+1);};const timer=setInterval(update,30000);addEventListener('focus',update);return()=>{clearInterval(timer);removeEventListener('focus',update);};},[section,edit]);
    const close = () => editor(null);
    if (!workspace)
        return <section><h1>Email campaigns</h1>{error ? <p role="alert">{error}</p> : <p role="status">Loading customer communications…</p>}<button className="secondary" onClick={load}>Retry loading</button></section>;
    return <section className="ec-workspace"><div className="ec-heading"><div><p className="eyebrow">CUSTOMER COMMUNICATIONS</p><h1>Email campaigns</h1><p>Reports, thoughtful updates, and reusable email workflows.</p></div><div className="ec-inline"><Badge>{workspace.settings.data.mode === 'capture' ? 'Capture mode' : 'Live sender'}</Badge><button className="secondary" onClick={() => reload(x => x + 1)}>Refresh</button></div></div><nav className="ec-tabs" aria-label="Email campaign views">{[['summary', 'Summary'], ['campaigns', 'Campaigns'], ['contacts', 'Contacts'], ['segments', 'Segments'], ['templates', 'Templates'], ['automations', 'Automations'], ['reporting', 'Reporting'], ['settings', 'Email settings']].map(([key, label]) => <button key={key} aria-current={section === key ? 'page' : undefined} onClick={() => { view(key); e(''); n(''); setDetail(null); }}>{label}</button>)}</nav>{error && <p className="ec-error" role="alert">{error}</p>}{notice && <p role="status" className="ec-success">{notice}</p>}
 {section === 'summary' && <><p className="helper">Current delivery outcomes across retained messages.</p><div className="ec-stats">{[['Contacts', workspace.counts.contacts], ['Queued', (workspace.counts.pending || 0)+(workspace.counts.preparing || 0)+(workspace.counts.sending || 0)], ['Captured', workspace.counts.captured || 0], ['Submitted', workspace.counts.submitted || 0], ['Delivered', workspace.counts.delivered || 0], ['Need review', (workspace.counts.blocked || 0) + (workspace.counts.uncertain || 0)]].map(([label, count]) => <div key={label}><strong>{count}</strong>{label}</div>)}</div><div className="ec-grid"><div className="panel"><h2>A clear path from draft to delivery</h2><p>Choose a template, review a qualified audience, and schedule a customer communication.</p><button className="primary" onClick={() => editor({ type: 'campaign' })}>Create campaign</button><p className="helper">Newsletter composition is available; newsletter delivery awaits confirmation of permitted use.</p></div><div className="panel"><h2>This account’s email usage</h2><strong className="ec-number">{workspace.monthly.counted.toLocaleString()}</strong><p>Counted emails this month · ${workspace.monthly.estimatedOverage.toFixed(2)} estimated Email Sending overage</p><p className="helper">3,000 included, then $0.35 per 1,000. Other account traffic depends on the usage figure entered in settings.</p></div></div><div className="panel"><h2>Processing and readiness</h2>{workspace.readiness.deliveryPaused && <div className="ec-error"><p>Live delivery is paused: {workspace.readiness.deliveryReason.replaceAll('_',' ')}. Review provider feedback and recipient evidence before resuming.</p><button className="secondary" onClick={()=>{if(confirm('Have you reviewed delivery feedback, addressed the cause, and verified the feedback consumer?'))void action('/health/review',{reviewed:true});}}>Resume after delivery review</button></div>}<p>{workspace.settings.data.enabled ? 'Processing is enabled.' : 'Processing is paused.'} {workspace.readiness.liveReady ? 'The installation is configured for live submission.' : 'Use captures while installation checks are completed.'}</p><button className="secondary" onClick={() => action('/process', {})}>Process due work</button><p className="helper">Production uses the installation’s scheduled worker. This action is also useful for local captured tests.</p>{reporting?.imports.map(job => <p key={job.id}>Contact import: {job.cursor} / {job.total} · {job.state}</p>)}{reporting?.daily.filter(x => ['feedback_stale', 'feedback_rejected', 'report_blocked'].includes(x.kind)).slice(0, 5).map((x, i) => <p key={i}>{x.day}: {x.kind.replaceAll('_', ' ')} · {x.total}</p>)}</div></>}
 {section === 'contacts' && <div className="panel"><div className="ec-toolbar"><input aria-label="Search contacts" placeholder="Search name, company, or email" value={q} onChange={e => search(e.target.value)}/><button className="primary" onClick={() => editor({ type: 'contact' })}>Add contact</button><button className="secondary" onClick={() => editor({ type: 'import' })}>Import CSV</button><a className="secondary" href={base+'/export?q='+encodeURIComponent(q)} download>Export contacts</a></div><div className="ec-table"><table><thead><tr><th>Contact</th><th>Company</th><th>Stage</th><th>Preferences</th><th>Actions</th></tr></thead><tbody>{contacts.rows.map(c => <tr key={c.id}><td><strong>{c.name || 'Unnamed contact'}</strong><small>{c.email}</small></td><td>{c.company || '—'}</td><td>{c.stage}</td><td>{Object.entries(c.topics).filter(([, v]) => v).map(([k]) => k).join(', ') || 'None'}</td><td><div className="ec-inline"><button className="secondary" onClick={() => editor({ type: 'contact', value: c })}>Edit</button><button className="secondary" onClick={async () => { try {
        setDetail(await api('/timeline?contact=' + c.id));
    }
    catch (error) {
        e(errorText(error));
    } }}>History</button><button className="secondary" onClick={() => action('/contacts/suppress', { id: c.id, reviewed: true })}>Stop optional email</button><button className="secondary" onClick={() => { if (confirm('Delete this contact’s personal fields and retain a protected suppression record?'))
        void action('/contacts/delete', { id: c.id, revision: c.revision, reviewed: true }); }}>Delete</button></div></td></tr>)}</tbody></table></div>{!contacts.rows.length && !contacts.loading && <Empty>Add contacts or import a reviewed CSV to begin.</Empty>}<ListState list={contacts}/></div>}
 {section === 'campaigns' && <div className="panel"><div className="ec-toolbar"><h2>Your campaigns</h2><button className="primary" onClick={() => editor({ type: 'campaign' })}>Create campaign</button></div>{campaigns.rows.map(c => <article className="ec-row" key={c.id}><div><h3>{c.name}</h3><p>{c.purpose.replaceAll('-', ' ')}{c.scheduledAt ? ' · ' + new Date(c.scheduledAt).toLocaleString('en-US', { timeZone: workspace.settings.data.timezone }) : ''}</p><Badge>{c.status}</Badge></div><div className="ec-inline">{c.status === 'draft' && <><button className="secondary" onClick={() => editor({ type: 'campaign', value: c })}>Edit</button><button className="primary" onClick={() => editor({ type: 'review', value: c })}>Review audience</button></>}<button className="secondary" onClick={() => action('/campaigns/duplicate', { id: c.id })}>Duplicate</button>{['running', 'preparing', 'scheduled', 'paused'].includes(c.status) && <><button className="secondary" onClick={() => action('/campaigns/action', { id: c.id, revision: c.revision, action: c.status === 'paused' ? 'resume' : 'pause' })}>{c.status === 'paused' ? 'Resume' : 'Pause'}</button><button className="secondary" onClick={() => action('/campaigns/action', { id: c.id, revision: c.revision, action: 'cancel' })}>Cancel remaining sends</button></>}</div></article>)}{!campaigns.rows.length && !campaigns.loading && <Empty>Create your first draft. No messages are sent until you review and approve an eligible audience.</Empty>}<ListState list={campaigns}/></div>}
 {section === 'templates' && <div className="panel"><div className="ec-toolbar"><h2>Reusable templates</h2><button className="primary" onClick={() => editor({ type: 'template' })}>Create template</button><button className="secondary" onClick={() => editor({ type: 'article' })}>Draft from article</button></div><div className="ec-template-grid">{templates.rows.map(t => <article key={t.id}><span className="ec-template-art" aria-hidden="true"><i /><i /><i /></span><Badge>{t.layout === 'newsletter' ? 'Newsletter draft' : t.layout}</Badge><h3>{t.name}</h3><p>{t.subject}</p><div className="ec-inline"><button className="secondary" onClick={() => editor({ type: 'template', value: t })}>Edit template</button><button className="secondary" onClick={() => editor({ type: 'template', value: { ...t, id: '', revision: 0, name: t.name + ' copy' } })}>Duplicate</button><a href={base + '/preview?template=' + t.id} target="_blank" rel="noreferrer">Preview</a><button className="secondary" onClick={async () => { try {
        setDetail(await api('/template-history?template=' + t.id));
    }
    catch (error) {
        e(errorText(error));
    } }}>Version history</button></div></article>)}</div><ListState list={templates}/></div>}
 {section === 'segments' && <div className="panel"><div className="ec-toolbar"><h2>Saved audiences</h2><button className="primary" onClick={() => editor({ type: 'segment' })}>Create segment</button></div>{segments.rows.map(s => <article className="ec-row" key={s.id}><div><h3>{s.name}</h3><p>Match {s.match}: {s.rules.map(r => r.field + ' ' + r.op + ' ' + r.value).join('; ') || 'All contacts'}</p></div><div className="ec-inline"><button className="secondary" onClick={() => editor({ type: 'segment', value: s })}>Edit rules</button><button className="secondary" onClick={async () => { try {
        setDetail(await api('/audience?segment=' + s.id));
    }
    catch (error) {
        e(errorText(error));
    } }}>Preview audience</button></div></article>)}{!segments.rows.length && <Empty>Save a group based on tags, stage, source, preferences, or explicit website events.</Empty>}<ListState list={segments}/></div>}
 {section === 'automations' && <><div className="panel"><div className="ec-toolbar"><h2>Website workflows</h2><button className="primary" onClick={() => editor({ type: 'automation' })}>Create automation</button><button className="secondary" onClick={() => editor({ type: 'report' })}>Schedule customer report</button></div>{automations.rows.map(a => <article className="ec-row" key={a.id}><div><h3>{a.name}</h3><p>{({ 'lead.created': 'New website enquiry', 'service.updated': 'Service update', 'report.ready': 'Report ready', 'manual': 'Manual enrollment', 'subscription.confirmed': 'Confirmed preference' } as Record<string, string>)[a.trigger]} → {a.steps.length} steps · version {a.version || 0}</p><Badge>{a.status}{a.hasDraft ? ' · draft changes' : ''}</Badge></div><div className="ec-inline"><button className="secondary" onClick={() => editor({ type: 'automation', value: a })}>Edit new draft</button>{(a.status === 'draft' || a.hasDraft) && <button className="primary" onClick={() => action('/automations/publish', { id: a.id, revision: a.revision, reviewed: true })}>Publish sequence</button>}{!!a.version && <button className="secondary" onClick={() => action('/automations/pause', { id: a.id, revision: a.revision, paused: a.status !== 'paused' })}>{a.status === 'paused' ? 'Resume' : 'Pause'}</button>}</div></article>)}{!automations.rows.length && <Empty>Start with an enquiry response, an agreed service update, or a fresh customer report.</Empty>}<ListState list={automations}/>{reports.rows.map(r => <article className="ec-row" key={r.id}><div><h3>{r.name}</h3><p>Every {r.days} days · next run {new Date(r.nextAt).toLocaleString()}</p><Badge>{r.status}</Badge></div><button className="secondary" onClick={() => action('/report-schedules', { ...r, status: r.status === 'active' ? 'paused' : 'active' })}>{r.status === 'active' ? 'Pause report' : 'Resume report'}</button></article>)}</div><p className="ec-note">A website connection uses signed server events. Your installation setup instructions include the event producer, signup flow, and required grants. Existing website forms are preserved.</p></>}
 {section === 'reporting' && <><div className="panel"><h2>Delivery and workflow reporting</h2><p>Submitted means accepted by Cloudflare. Delivered means accepted by the recipient’s mail server.</p><div className="ec-table"><table><thead><tr><th>Message</th><th>Mode</th><th>Outcome</th><th>Actions</th></tr></thead><tbody>{jobs.rows.map(j => <tr key={String(j.id)}><td>{campaigns.rows.find(c => c.id === j.campaign_id)?.name || (String(j.campaign_id).startsWith('auto_') ? 'Automation update' : 'Customer communication')}<small>{new Date(Number(j.created_at)).toLocaleString()}</small></td><td>{String(j.mode)}</td><td>{String(j.state)}<small>{String(j.reason || '').replaceAll('_', ' ')}</small></td><td>{j.state === 'captured' && <button className="secondary" onClick={async () => { try {
        setDetail(await api('/capture?job=' + j.id));
    }
    catch (error) {
        e(errorText(error));
    } }}>View captured email</button>}{j.state === 'blocked' && <button className="secondary" onClick={() => action('/jobs/retry', { id: j.id, reviewed: true })}>Retry after fixing setup</button>}{j.state === 'uncertain' && <><button className="secondary" onClick={() => action('/jobs/resolve', { id: j.id, action: 'close', reviewed: true })}>Close after review</button><button className="secondary" onClick={() => { if (confirm('The original email may have been accepted. A retry can send a duplicate. Retry deliberately?'))
        void action('/jobs/resolve', { id: j.id, action: 'retry', reviewed: true }); }}>Deliberate retry</button></>}</td></tr>)}</tbody></table></div><ListState list={jobs}/><div className="ec-inline"><Field label="Export start date · UTC"><input type="date" value={exportFrom} onChange={event=>setExportFrom(event.target.value)}/></Field><Field label="Export end date · UTC"><input type="date" value={exportTo} onChange={event=>setExportTo(event.target.value)}/></Field>{['results', 'preferences', 'suppressions', 'templates'].map(kind => <a className="secondary" key={kind} href={base+'/export?kind='+kind+'&from='+exportFrom+'&to='+exportTo} download>Export {kind}</a>)}</div></div><div className="panel"><h2>Active and completed enrollments</h2>{reporting?.enrollments.map(item => <div className="ec-row" key={item.id}><p>{automations.rows.find(a => a.id === item.automation_id)?.name || 'Workflow'} · step {item.step + 1} · {item.state}</p>{item.state === 'active' && <button className="secondary" onClick={() => action('/enrollments/stop', { id: item.id })}>Stop · reply or staff decision</button>}</div>)}{!reporting?.enrollments.length && <Empty>No enrollments yet.</Empty>}<h3>Attributed website conversions</h3><p className="helper">Trusted website events matched to a live message for the same contact within 30 days; attribution does not prove causation.</p>{reporting?.conversions.map(item=><p key={item.campaign_id}>{campaigns.rows.find(c=>c.id===item.campaign_id)?.name||item.campaign_id}: {item.total}</p>)}<h3>Measured button clicks</h3><p className="helper">Counts may include automated link scanners; they do not prove a conversion.</p>{reporting?.clicks.map((item, i) => <p key={i}>{item.click_count} · {item.url}</p>)}</div></>}
 {section === 'settings' && <div className="panel"><h2>Email settings</h2><SettingsForm workspace={workspace} run={run}/></div>}
 {detail !== null && <Editor title="Email detail" close={() => setDetail(null)}><Detail value={detail}/></Editor>}
 {edit?.type === 'contact' && <ContactForm value={edit.value} run={run} close={close}/>} {edit?.type === 'template' && <TemplateForm value={edit.value} run={run} close={close}/>} {edit?.type === 'segment' && <SegmentForm value={edit.value} run={run} close={close}/>} {edit?.type === 'campaign' && <CampaignForm value={edit.value} templates={templates.rows} segments={segments.rows} timezone={workspace.settings.data.timezone} run={run} close={close}/>} {edit?.type === 'review' && <ReviewCampaign campaign={edit.value} mode={workspace.settings.data.mode} run={run} close={close}/>} {edit?.type === 'automation' && <AutomationForm value={edit.value} templates={templates.rows} run={run} close={close}/>} {edit?.type === 'import' && <ImportForm run={run} close={close}/>} {edit?.type === 'report' && <ReportForm templates={templates.rows} segments={segments.rows} run={run} close={close}/>} {edit?.type === 'article' && <ArticleForm run={run} close={close}/>}
 </section>;
}
function Detail({ value }: {
    value: unknown;
}) { const data = value as Record<string, unknown>; if (data.message) {
    const m = data.message as {
        to: string;
        subject: string;
        text: string;
        html: string;
    };
    return <><p>To: {m.to}</p><h3>{m.subject}</h3><pre className="ec-text">{m.text}</pre><iframe title="Captured email" className="ec-preview" sandbox="" src={String(data.previewUrl || '')}/></>;
} return <div>{Object.entries(data).map(([key, v]) => <section key={key}><h3>{key[0].toUpperCase() + key.slice(1)}</h3>{Array.isArray(v) ? v.map((row, i) => <div className="ec-detail-row" key={i}>{typeof row === 'object' && row ? Object.entries(row).filter(([k]) => !['id', 'contact_id', 'email_key'].includes(k)).map(([k, val]) => <p key={k}><strong>{k.replaceAll('_', ' ')}:</strong> {typeof val === 'object' ? Object.entries(val || {}).map(([a, b]) => a + ': ' + String(b)).join(', ') : typeof val === 'string' && /^https?:\/\//.test(val) ? <a href={val} target="_blank" rel="noreferrer">Open preview</a> : String(val ?? '')}</p>) : <p>{String(row)}</p>}</div>) : <p>{String(v)}</p>}</section>)}</div>; }
export function EmailCampaignOverview() { const [summary, set] = useState<EmailWorkspace | null>(null); useEffect(() => { void api<EmailWorkspace>('/workspace').then(set).catch(() => { }); }, []); if (!summary)
    return null; return <section className="panel ec-overview"><div><h2>Customer communications</h2><p>{summary.counts.contacts} contacts · {summary.counts.uncertain || 0} uncertain submissions · {summary.settings.data.mode === 'capture' ? 'Capture mode' : 'Live sender'}</p></div><a className="secondary" href="#email-campaigns">Open email campaigns →</a></section>; }
