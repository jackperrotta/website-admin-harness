import React, {useEffect, useState} from 'react';
import {
  chatgptBusinessStatuses, chatgptSourceLabels, chatgptSources,
  type ChatGPTAttribution, type ChatGPTBusinessProfile, type ChatGPTBusinessResponse, type ChatGPTBusinessStatus,
} from '../../../contracts/src/index.ts';
import './chatgpt-business.css';

const endpoint = 'settings/chatgpt-business';
const fields: [keyof ChatGPTBusinessProfile, string][] = [
  ['name', 'Business name'], ['website', 'Website'], ['description', 'Description'], ['telephone', 'Phone'],
  ['email', 'Email'], ['address', 'Address'], ['inquiryUrl', 'Inquiry URL'],
];
const statusFields = {claim: 'Listing claim', verification: 'Persona verification', agent: 'Business Agent'} as const;
const statusLabels: Record<string, string> = {
  not_started: 'Not started', pending: 'Pending', approved: 'Approved', needs_attention: 'Needs attention',
  draft: 'Draft', published: 'Published', unavailable: 'Unavailable',
};
const message = (error: unknown) => error instanceof Error ? error.message : 'The request failed. Try again.';

export function ChatGPTBusinessSettings({api}: {api: <T>(path: string, data?: unknown) => Promise<T>}) {
  const [result, setResult] = useState<ChatGPTBusinessResponse>();
  const [draft, setDraft] = useState<ChatGPTBusinessStatus>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState('');
  async function load() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await api<ChatGPTBusinessResponse>(endpoint);
      setResult(value);
      setDraft(value.status);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {void load();}, [api]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await api<ChatGPTBusinessResponse>(endpoint, draft);
      setResult(value);
      setDraft(value.status);
      setNotice('Status saved.');
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel form-panel chatgpt-business" aria-labelledby="chatgpt-business-title">
    <h2 id="chatgpt-business-title">Businesses in ChatGPT</h2>
    <div className="chatgpt-business-links">
      <a className="secondary" href="https://chatgpt.com/business-hub" target="_blank" rel="noreferrer">Open Business Hub</a>
      <a href="https://help.openai.com/en/articles/20001635-setting-up-your-business-on-chatgpt" target="_blank" rel="noreferrer">OpenAI setup guide</a>
    </div>
    <ol>
      <li>Search for your business in Business Hub, select the matching listing, and start the claim with a method OpenAI offers.</li>
      <li>If website domain verification is offered, add the exact TXT record shown in Business Hub at your DNS provider. Return to Business Hub to verify the domain.</li>
      <li>Complete Persona in Business Hub. Enter verification codes and upload identity documents only in OpenAI’s verification flow.</li>
      <li>If eligible, preview your Business Agent and use the inquiry URL below for customer handoff. Review and publish the agent in Business Hub when ready.</li>
    </ol>
    {busy && !result && <p role="status">Loading setup…</p>}
    {error && <div className="alert" role="alert">{error} <button type="button" className="text-button" disabled={busy}
      onClick={() => {if (!draft || draft === result?.status || window.confirm('Replace your edits with the saved status?')) void load();}}>Reload saved status</button></div>}
    {result && draft && <div className="chatgpt-business-grid">
      <div>
        <h3>Public business details</h3>
        <dl>{fields.map(([key, label]) => {
          const value = result.profile[key];
          return <div key={key}><dt>{label}</dt><dd>{value ?? 'Unavailable'}
            {value && <button type="button" className="text-button" aria-label={`Copy ${label.toLowerCase()}`} onClick={async () => {
              try {await navigator.clipboard.writeText(value); setCopied(`${label} copied.`);}
              catch {setCopied('Select the text to copy it.');}
            }}>Copy</button>}
          </dd></div>;
        })}</dl>
        <span className="helper" role="status">{copied}</span>
      </div>
      <div>
        <h3>Onboarding status</h3>
        <p className="helper">Record the status you see in Business Hub and the date you checked it.</p>
        <form onSubmit={save}>
          {Object.entries(statusFields).map(([key, label]) => {
            const field = key as keyof typeof statusFields;
            return <label key={field}>{label}<select disabled={busy} value={draft[field]}
              onChange={e => {setNotice('');setDraft({...draft, [field]: e.target.value});}}>
              {chatgptBusinessStatuses[field].map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}
            </select></label>;
          })}
          <label>Last checked<input type="date" required disabled={busy} value={draft.lastChecked ?? ''}
            onChange={e => {setNotice('');setDraft({...draft, lastChecked: e.target.value});}}/></label>
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save status'}</button>
          {notice && <p className="success" role="status">{notice}</p>}
        </form>
      </div>
    </div>}
  </section>;
}

const metric = (value: number | null | undefined) => value == null ? 'Unavailable' : value.toLocaleString();

export function ChatGPTAttributionReport({report}: {report?: ChatGPTAttribution}) {
  return <section className="panel ax-panel chatgpt-business" aria-labelledby="chatgpt-attribution-title">
    <div className="panel-heading"><div><h2 id="chatgpt-attribution-title">ChatGPT attribution</h2>
      <p>{report ? `Website activity over ${report.days} days · UTC · Today is partial` : 'This website connection does not provide ChatGPT attribution.'}</p>
    </div></div>
    {report && <div className="chatgpt-business-grid">{chatgptSources.map(source => {
      const row = report.sources.find(row => row.source === source);
      return <section key={source} aria-label={chatgptSourceLabels[source]}>
        <h3>{chatgptSourceLabels[source]}</h3>
        <dl><div><dt>Landing pageviews</dt><dd>{metric(row?.landingPageviews)}</dd></div>
          <div><dt>Accepted inquiries</dt><dd>{metric(row?.acceptedInquiries)}</dd></div></dl>
        <h4>Top landing pages</h4>
        {row?.landingPages == null ? <p className="helper">Unavailable</p> : row.landingPages.length ?
          <ul className="ax-ranks">{row.landingPages.map(page => <li key={page.path}><div><span>{page.path}</span>
            <strong>{metric(page.landingPageviews)}</strong></div></li>)}</ul> : <p className="helper">No recorded landing pages.</p>}
      </section>;
    })}</div>}
  </section>;
}
