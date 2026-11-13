import {SignOnScreen,SignOnGrants,SignOnProgress} from './signon';
import {PairingApproval,ReportingGrants} from './pairing';
import {WebmasterPanel} from './webmaster';
import {ChatGPTAttributionReport, ChatGPTBusinessSettings} from './chatgpt-business.tsx';
import {AccountScreen,AccountSecurity,TeamAccess} from './accounts';
import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './styles.css';
import './analytics-dashboard.css';
import './website-theme.css';
import './typography.css';
import './sidebar-scroll.css';
import {LeadsWorkspace} from './leads';
import {AnalyticsDashboard} from './analytics-dashboard';
import {SearchConsoleSettings,SearchConsoleAnalytics} from './search-console';
import './search-console.css';
import {applyWebsiteTheme} from './theme';
import {SchedulingOverview} from './scheduling/overview';
import {OnboardingDraftProvider} from './client-portfolio/onboarding-draft';
const EmailCampaignWorkspace = React.lazy(() => import('./email-campaigns/workspace.tsx'));
const EmailCampaignOverview = React.lazy(() => import('./email-campaigns/workspace.tsx').then(m=>({default:m.EmailCampaignOverview})));
const SchedulingWorkspace = React.lazy(() => import('./scheduling/workspace.tsx'));
const ClientPortfolio = React.lazy(() => import('./client-portfolio/workspace.tsx'));
const ClientOnboarding = React.lazy(() => import('./client-portfolio/onboarding.tsx'));
const OnboardingTemplatePreview = React.lazy(() => import('./client-portfolio/template-preview.tsx'));
const OnboardingDraftPreview = React.lazy(() => import('./client-portfolio/template-preview.tsx').then(m => ({default:m.OnboardingDraftPreview})));
const ProspectExperience = React.lazy(() => import('./client-portfolio/onboarding.tsx').then(m => ({default: m.ProspectExperience})));
const BillingWorkspace = React.lazy(() => import('./billing/workspace.tsx'));
const StripeBillingWorkspace = React.lazy(() => import('./billing/stripe-workspace.tsx'));

import {isObject, userCan, type BootstrapResponse, type LeadRow, type LeadsResponse, type AnalyticsRow, type AnalyticsResponse, type SettingsResponse, type AccessResponse, type AccessRow, type ActivityRow, type TaskRow, type RowsResponse, type ModuleRow, type AuthRequestResponse} from '../../../contracts/src/index.ts';
type PageData =
  | {kind: 'overview'; leads: LeadsResponse | null; analytics: AnalyticsResponse | null}
  | {kind: 'leads'; value: LeadsResponse}
  | {kind: 'analytics'; value: AnalyticsResponse}
  | {kind: 'settings'; value: SettingsResponse}
  | {kind: 'access'; value: AccessResponse}
  | {kind: 'activity'; value: RowsResponse<ActivityRow>}
  | {kind: 'work-queue'; value: RowsResponse<TaskRow>}
  | {kind: 'module'; value: RowsResponse<ModuleRow>};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Request failed';
function fields(raw:unknown):Array<[string,unknown]>{try{const value: unknown=JSON.parse(typeof raw==='string'?raw:'{}');return value&&typeof value==='object'&&!Array.isArray(value)?Object.entries(value):[];}catch{return [];}}
async function api<T = unknown>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, data === undefined ? undefined : {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  const value: unknown = await response.json(); if (!response.ok) throw new Error(isObject(value) && typeof value.error === 'string' ? value.error : 'Request failed'); return value as T;
}
const labels: Record<string,string> = {overview:'Overview',leads:'Leads',analytics:'Analytics',settings:'Settings',access:'Users & access',activity:'Activity','work-queue':'Work queue',scheduling:'Scheduling','email-campaigns':'Email campaigns','client-portfolio':'Clients','client-onboarding':'Prospects & onboarding',billing:'Billing','account-billing':'Your billing'};
function Icon({name}:{name:string}) {
  const paths: Record<string,React.ReactNode> = {
    overview:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    leads:<><path d="M4 4h16v16H4zM4 12h5l2 3h2l2-3h5"/></>,
    analytics:<><path d="M4 20h17M6 16V9m6 7V4m6 12v-5"/></>,
    settings:<><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></>,
    access:<><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0112 0v3m2-16a3 3 0 010 6m2 3a5 5 0 012 7"/></>,
    activity:<path d="M3 12h4l3-8 4 16 3-8h4"/>,
    'work-queue':<><path d="M10 6h11M10 12h11M10 18h11M3 5l2 2 3-4M3 11l2 2 3-4M3 17l2 2 3-4"/></>,
    'email-campaigns':<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></>,
    scheduling:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18M7 15h3m4 0h3"/></>,
    billing:<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></>,
    'account-billing':<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6m-6 4h6"/></>,
    'client-portfolio':<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 9v11M11 13h6m-6 3h4"/></>,
  };
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths['work-queue']}</svg>;
}
function App() {
  const [boot,setBoot] = useState<BootstrapResponse|null>(null); const [error,setError] = useState('');
  const [security,setSecurity]=useState(false);
  const [prospectToken] = useState(() => {if(location.pathname === '/prospect/activate') {const t = new URLSearchParams(location.hash.slice(1)).get('token'); history.replaceState(null,'',location.pathname+location.search); return t;} return null;});
  const readAccountToken=()=>{const token=new URLSearchParams(location.hash.slice(1)).get('token');history.replaceState(null,'',location.pathname);return token;};
  const [accountLink,setAccountLink]=useState(()=>({token:location.pathname.startsWith('/account/')?readAccountToken():null,version:0}));
  const [page,setPage] = useState(location.hash.slice(1).split('?')[0] || 'overview');
  const [moduleQuery,setModuleQuery] = useState(()=>{const query=location.hash.split('?')[1]||'',route=location.hash.slice(1).split('?')[0];if(['webmaster-sso','webmaster-sso-authorize'].includes(route)&&!new URLSearchParams(query).has('approve'))history.replaceState(null,'','/#'+route);return query;});
  const readAuthLink = () => {const params = new URLSearchParams(location.hash.slice(1)); const token = params.get('token'), next = params.get('next'); history.replaceState(null,'','/auth'); return {token, next:next && ['client-portfolio','client-onboarding'].includes(next) ? next : 'overview'};};
  const [authLink,setAuthLink] = useState(() => location.pathname === '/auth' ? readAuthLink() : {token:null,next:'overview'});
  const refresh = () => api<BootstrapResponse>('bootstrap').then(setBoot).catch((e: unknown)=>setError(errorMessage(e)));
  useEffect(()=>{refresh(); const listener=(event:Event)=>{setModuleQuery(location.hash.split('?')[1] || '');if(location.pathname === '/auth' && new URLSearchParams(location.hash.slice(1)).has('token'))setAuthLink(readAuthLink());else if(location.pathname.startsWith('/account/')){if(event.type==='hashchange'&&!location.hash)return;const token=readAccountToken();setAccountLink(previous=>({token,version:previous.version+1}));}else if(event.type==='hashchange'||event.type==='popstate')setPage(location.hash.slice(1).split('?')[0]||'overview');}; addEventListener('hashchange',listener);addEventListener('popstate',listener); return ()=>{removeEventListener('hashchange',listener);removeEventListener('popstate',listener);};},[]);
  useEffect(()=>{if(['webmaster-sso','webmaster-sso-authorize'].includes(page))document.title='Opening client admin · Vitris';else if(boot)document.title=`${labels[page]||'Admin'} · ${boot.manifest.business.name}`;},[boot,page,moduleQuery]);
  useEffect(()=>{if(boot)applyWebsiteTheme(document.documentElement,boot.theme||boot.manifest.theme);},[boot]);
  useEffect(()=>{if(boot?.manifest.webmasterSignOn?.mode!=='client'||!boot.user)return;let disposed=false;const check=()=>{if(document.visibilityState==='hidden')return;void api<BootstrapResponse>('bootstrap').then(value=>{if(!disposed)setBoot(value);}).catch(()=>{if(!disposed)setBoot(previous=>previous?{...previous,user:null}:previous);});};const timer=setInterval(check,5000);addEventListener('focus',check);document.addEventListener('visibilitychange',check);return()=>{disposed=true;clearInterval(timer);removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);};},[boot?.user?.id,boot?.manifest.webmasterSignOn?.mode]);
  const completeSignOn=async()=>{const value=await api<BootstrapResponse>('bootstrap');if(!value.user)throw Error('Your sign-in could not be confirmed. Open the client admin from Vitris again.');history.replaceState(null,'','/#overview');setBoot(value);setModuleQuery('');setPage('overview');};
  if (!boot) return ['webmaster-sso','webmaster-sso-authorize'].includes(page)?<SignOnProgress>{error||undefined}</SignOnProgress>:<main className="loading"><h1>Website admin</h1><p role="status">{error || 'Connecting to your installation…'}</p></main>;
  if(location.pathname === '/prospect' || location.pathname === '/prospect/activate')return <React.Suspense fallback={<p role="status">Opening your client workspace…</p>}><ProspectExperience token={prospectToken}/></React.Suspense>;
  if(location.pathname.startsWith('/account/'))return <AccountScreen key={accountLink.version} boot={boot} token={accountLink.token}/>;
  if(boot.manifest.webmasterSignOn?.mode==='client'&&page==='webmaster-sso'&&(!new URLSearchParams(moduleQuery).has('approve')||boot.user))return <SignOnScreen key={moduleQuery} boot={boot} query={moduleQuery} onSignedIn={completeSignOn}/>;
  if(boot.manifest.webmasterSignOn?.mode==='broker'&&page==='webmaster-sso-authorize'&&boot.user)return <SignOnScreen boot={boot} query={moduleQuery} authorize onSignedIn={completeSignOn}/>;
  if (!boot.user) return <Login boot={boot} refresh={refresh} authToken={authLink.token} destination={authLink.next} confirmed={()=>setAuthLink({token:null,next:'overview'})}/>;
  const allowed = ['overview',...(boot.manifest.reportingPairing&&boot.webmasterEnabled?['webmaster-pairing']:[]),...boot.capabilities,...boot.modules.map((m)=>m.id)];
  const current = allowed.includes(page) ? page : 'overview';
  const templatePreviewId = new URLSearchParams(moduleQuery).get('preview');
  const draftPreview = new URLSearchParams(moduleQuery).get('preview-draft')==='1';
  const shell = <div className="app-shell">{security&&<AccountSecurity boot={boot} onClose={()=>setSecurity(false)} onRefresh={refresh}/>}
    <aside className="sidebar">
      <a className="brand" href="#overview"><span className="brand-mark">{boot.manifest.business.initials}</span><span>{boot.manifest.business.name}<small>WEBSITE ADMIN</small></span></a>
      <div className="site-label"><span className="status-dot"/>{new URL(boot.manifest.site.origin).hostname}<span className="small-tag">Website</span></div>
      <p className="nav-label">WORKSPACE</p>
      <nav aria-label="Main navigation">{['overview',...boot.capabilities].map(item=><a href={`#${item}`} key={item} aria-current={current===item?'page':undefined}><Icon name={item}/>{labels[item]}</a>)}</nav>
      {boot.modules.length>0 && <><p className="nav-label module-heading">BUSINESS TOOLS <span>{boot.modules.length}</span></p><nav aria-label="Business modules">{boot.modules.map((m)=><a href={`#${m.id}`} key={m.id} aria-current={current===m.id?'page':undefined}><Icon name={m.id}/>{m.label}<span className="module-dot"/></a>)}</nav></>}
      <div className="sidebar-bottom"><div className="connection"><span className="status-dot"/><span>{boot.localDemo?'Local installation':'Cloudflare installation'}<small>{boot.connected?'Harness backend configured':boot.localDemo?'Synthetic demo data':'Website integration pending'}</small></span></div><div>{boot.accountAuth?.enabled&&<button className="text-button account-security" onClick={()=>setSecurity(true)}>Account security</button>}</div><div className="account"><span className="avatar">{boot.user.email[0].toUpperCase()}</span><span>{boot.user.email}<small>{boot.user.role}</small></span><button className="text-button" onClick={async()=>{try{await api('auth/logout',{}); await refresh();}catch(e:unknown){setError(errorMessage(e));}}}>Sign out</button></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><span>{boot.manifest.site.name}<span className="divider">/</span><strong>{labels[current] || boot.modules.find((m)=>m.id===current)?.label}</strong></span><a href={boot.manifest.site.origin} target="_blank" rel="noreferrer" className="visit-link">Visit website <span aria-hidden="true">↗</span></a></header>
      <main id="main" className="content">
        {boot.localDemo && <div className="demo-notice"><span>LOCAL PREVIEW</span> {boot.connected?'Connected to an isolated local website backend. Records come from that backend, not the dashboard demo.':'Explore with synthetic data. Module settings show the status of connected services.'}</div>}
        {error && <div className="alert" role="alert">{error}</div>}
        {current==='webmaster-pairing'?<PairingApproval requestId={new URLSearchParams(moduleQuery).get('request')||''}/>:current==='email-campaigns'?<React.Suspense fallback={<p role="status">Loading email campaigns…</p>}><EmailCampaignWorkspace/></React.Suspense>:current==='scheduling'?<React.Suspense fallback={<p role="status">Loading scheduling…</p>}><SchedulingWorkspace/></React.Suspense>:current==='client-portfolio'?<React.Suspense fallback={<p role="status">Loading clients…</p>}><ClientPortfolio/></React.Suspense>:current==='client-onboarding'?<React.Suspense fallback={<p role="status">Loading onboarding…</p>}><ClientOnboarding/></React.Suspense>:current==='billing'||current==='account-billing'?<React.Suspense fallback={<p role="status">Loading billing…</p>}>{boot.modules.find(m=>m.id===current)?.ui?.startsWith('stripe-')?<StripeBillingWorkspace key={current} account={current==='account-billing'}/>:<BillingWorkspace key={current} audience={current==='billing'?'seller':'customer'}/>}</React.Suspense>:<Page key={current} page={current} boot={boot}/>}
        <footer className="main-footer"><span>{boot.manifest.business.name} <span className="muted">/ Your website workspace</span></span><span>Powered by Vitris Admin · alpha</span></footer>
      </main>
    </div>
  </div>;
  if(current!=='client-onboarding')return shell;
  const closePreview=()=>{location.hash='client-onboarding?view=templates';};
  return <OnboardingDraftProvider key={boot.user.email}><React.Suspense fallback={<p role="status">Loading template preview…</p>}>{draftPreview?<OnboardingDraftPreview close={closePreview}/>:templatePreviewId!==null?<OnboardingTemplatePreview key={templatePreviewId} templateId={templatePreviewId} close={closePreview}/>:shell}</React.Suspense></OnboardingDraftProvider>;
}
function Login({boot,refresh,authToken,destination,confirmed}:{boot:BootstrapResponse;refresh:()=>Promise<unknown>;authToken:string|null;destination:string;confirmed:()=>void}) {
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
  const run=async(fn:()=>Promise<unknown>)=>{setBusy(true);setMessage('');try{await fn();}catch(e:unknown){setMessage(errorMessage(e));}finally{setBusy(false);}};
  const canEmail = boot.emailLoginConfigured !== false;
  const privateLocal = boot.privateLocalSignIn === true;
  return <main className="login-layout"><section className="login-story"><span className="brand-mark">{boot.manifest.business.initials}</span><p className="eyebrow">YOUR BUSINESS. YOUR WORKSPACE.</p><h1>A clearer view of<br/>your website.</h1><p>Enquiries, insights, and the tools your business needs. All in one place, on your own domain.</p><span className="login-domain">{new URL(boot.manifest.adminOrigin).host}</span></section><section className="login-panel"><div><p className="eyebrow">{boot.manifest.business.name}</p><h2>{authToken?'Confirm your sign in':privateLocal?'Open your local workspace':'Welcome back'}</h2><p className="muted">{authToken?'Continue to securely open your website workspace.':privateLocal?'This preview uses a private owner sign-in link. No email is needed.':boot.accountAuth?.enabled&&!boot.passwordLogin?'Your administrator is completing account setup.':boot.passwordLogin?'Sign in with your existing account.':canEmail?'Enter your account email to receive a secure sign-in link.':'Sign-in email has not been configured for this installation.'}</p>
    {boot.accountAuth?.enabled&&!boot.passwordLogin?<p role="status">Account sign-in is being configured. Contact your website administrator.</p>:authToken?<button className="primary" disabled={busy} onClick={()=>run(async()=>{await api('auth/confirm',{token:authToken});confirmed();history.replaceState(null,'',`/#${destination}`);dispatchEvent(new HashChangeEvent('hashchange'));await refresh();})}>Continue to workspace</button>:!boot.passwordLogin&&!canEmail?<div className="local-entry">{privateLocal?<><span className="small-tag">PRIVATE LOCAL PREVIEW</span><p>In the project terminal, run:</p><p><code>npm run vitris:signin</code></p><p>It opens a fresh one-use sign-in link without resetting your test records. Choose <strong>Continue to workspace</strong> in that tab.</p></>:<p role="status">Contact your website administrator to configure sign-in.</p>}</div>:<form onSubmit={e=>{e.preventDefault();run(async()=>{if(boot.passwordLogin){await api('auth/password',{email,password});setPassword('');await refresh();}else{const result=await api<AuthRequestResponse>('auth/request',{email});setMessage(result.message);}});}}><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@yourbusiness.com"/>{boot.passwordLogin&&<><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={e=>setPassword(e.target.value)}/></>}<button className="primary" disabled={busy}>{busy?'Please wait…':boot.passwordLogin?'Sign in':'Email me a sign-in link'}</button></form>}
    {boot.accountAuth?.enabled&&<div className="login-account-links"><a href="/account/reset">Forgot password?</a>{boot.accountAuth.setupAvailable&&<a href="/account/setup">Set up owner account</a>}</div>}<p role="status" className="form-message">{message}</p>{boot.localDemo&&<div className="local-entry"><span className="small-tag">LOCAL DEVELOPMENT ONLY</span><p>Try the dashboard with a synthetic business account.</p><button className="secondary" disabled={busy} onClick={()=>run(async()=>{await api('auth/demo',{});await refresh();})}>Open local demo <span aria-hidden="true">→</span></button></div>}<small className="muted">Access is managed by your website owner.</small></div></section></main>;
}
function Page({page,boot}:{page:string;boot:BootstrapResponse}) {
  const [data,setData]=useState<PageData|null>(null);const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const [leadMode,setLeadMode]=useState('production');const [search,setSearch]=useState('');const [filter,setFilter]=useState('all');const [selected,setSelected]=useState<LeadRow|null>(null);const [days,setDays]=useState('14');const [busy,setBusy]=useState(false);
  const customModule = boot.modules.find((m)=>m.id===page);
  const loadId=useRef(0);
  const load=async()=>{const id=++loadId.current;const commit=(next:PageData)=>{if(id===loadId.current)setData(next);};try{
    setError('');setData(null);
    switch(page) {
      case 'overview': {
        const [leads,analytics]=await Promise.all([boot.capabilities.includes('leads')?api<LeadsResponse>('leads'):Promise.resolve(null),boot.capabilities.includes('analytics')?api<AnalyticsResponse>(`analytics?days=${days}`):Promise.resolve(null)]);
        commit({kind: 'overview',leads,analytics});break;
      }
      case 'leads': break;
      case 'analytics': commit({kind: page,value: await api<AnalyticsResponse>(`analytics?days=${days}${boot.chatgptBusinessEnabled?'&attribution=chatgpt':''}`)});break;
      case 'settings': commit({kind: page,value: boot.user&&userCan(boot.user,'settings:write')?await api<SettingsResponse>(page):{notification_email:'',revision:0}});break;
      case 'access': commit({kind: page,value: await api<AccessResponse>(page)});break;
      case 'activity': commit({kind: page,value: await api<RowsResponse<ActivityRow>>(page)});break;
      case 'work-queue': commit({kind: page,value: await api<RowsResponse<TaskRow>>('modules/work-queue')});break;
      default: commit({kind: 'module',value: await api<RowsResponse<ModuleRow>>(`modules/${page}`)});
    }
  }catch(e: unknown){if(id===loadId.current)setError(errorMessage(e));}};
  useEffect(()=>{load();},[page,days,leadMode]);
  const mutate=async(path:string,value:unknown)=>{setBusy(true);setNotice('');try{await api(path,value);await load();return true;}catch(e:unknown){setError(errorMessage(e));return false;}finally{setBusy(false);}};
  if(page==='leads')return <LeadsWorkspace boot={boot}/>;
  const titles:Record<string,[string,string]>={overview:['Your website, at a glance.','A little perspective on how your website is working for your business.'],leads:['Every enquiry starts here.','Keep track of new conversations and what happens next.'],analytics:['Understand what brings people in.','A clear view of website traffic and enquiry activity.'],settings:['Make it work for your business.','Manage the operational preferences for this installation.'],access:['The right people. The right access.','See who can access your business workspace.'],activity:['A record of what changed.','Changes made in your admin, with the person behind each action.'],'work-queue':['Keep the next step in sight.','A business module for turning follow-ups into finished work.']};
  const title=titles[page]||[boot.modules.find((m)=>m.id===page)?.label||'Business tool','Installed business module'];
  return <><div className="page-heading"><div><p className="eyebrow">{page==='work-queue'?'BUSINESS TOOLS':labels[page]?.toUpperCase()||'MODULE'}</p><h1>{title[0]}</h1><p>{title[1]}</p></div>{(page==='analytics'||page==='overview')&&<label className="date-filter"><span className="sr-only">Date range</span><select value={days} onChange={e=>setDays(e.target.value)}><option value="14">Last 14 days</option><option value="30">Last 30 days</option></select></label>}</div>
    {error&&<div className="alert" role="alert">{error}<button className="text-button" onClick={load}>Retry</button></div>}{notice&&<p className="success" role="status">{notice}</p>}
    {!data&&!error&&<p role="status">Loading your workspace…</p>}
    {page==='overview' && boot.modules.some(m=>m.id==='email-campaigns')&&<React.Suspense fallback={null}><EmailCampaignOverview/></React.Suspense>}
    {page==='overview' && boot.modules.some(m=>m.id==='scheduling') && <SchedulingOverview/>}
    {data?.kind==='overview'&&<><Stats analytics={data.analytics} leads={data.leads}/><div className="overview-grid"><section className="panel"><div className="panel-heading"><div><h2>Website traffic</h2><p>Daily page views · UTC</p></div><span className="small-tag">{data.analytics?.source==='connected'?'WEBSITE DATA':boot.localDemo?'SYNTHETIC':'NOT CONNECTED'}</span></div><Chart rows={data.analytics?.rows||[]}/></section><section className="panel website-panel"><p className="eyebrow">YOUR WEBSITE</p><span className="website-monogram">{boot.manifest.business.initials}</span><h2>{boot.manifest.business.name}</h2><p>{new URL(boot.manifest.site.origin).hostname}</p><div className="connection-row"><span className="status-dot amber"/> {data.leads?.source==='connected'||data.analytics?.source==='connected'?'Harness data connected':boot.localDemo?'Local example installation':'Integration pending'}</div><p className="muted">{boot.connected?'Leads and analytics stay in the website backend. This admin reads them through a scoped connection.':boot.localDemo?'Preview the workspace before connecting a real website.':'Connect website forms and analytics through the harness.'}</p><a className="secondary" href="#settings">View installation settings <span aria-hidden="true">→</span></a></section></div>{data.leads&&<section className="panel"><div className="panel-heading"><div><h2>Recent enquiries</h2><p>The latest conversations from your website</p></div><a href="#leads">View all leads <span aria-hidden="true">→</span></a></div><LeadTable rows={data.leads.rows.slice(0,3)} onSelect={()=>{location.hash='leads';}}/></section>}<div className="module-callout"><Icon name="work-queue"/><div><h3>A workspace that grows with your business.</h3><p>{boot.modules.length?'Your installed business tools are available in the sidebar. More tools can be added through your agent workflow.':'Business tools can be added through your agent workflow.'}</p></div>{boot.modules.some((m)=>m.id==='work-queue')&&<a href="#work-queue">Open work queue →</a>}</div></>}
    {data?.kind==='analytics'&&<AnalyticsDashboard data={data.value}/>}
    {data?.kind==='analytics'&&boot.chatgptBusinessEnabled&&<ChatGPTAttributionReport report={data.value.chatgptAttribution}/>}
    {page==='analytics'&&boot.searchConsoleEnabled&&boot.user&&userCan(boot.user,'analytics:read')&&<SearchConsoleAnalytics manage={userCan(boot.user,'search-console:manage')} origin={boot.manifest.site.origin}/>}
    {page==='settings'&&boot.searchConsoleEnabled&&boot.user&&userCan(boot.user,'search-console:manage')&&<SearchConsoleSettings origin={boot.manifest.site.origin} canConfigure={boot.user.role==='owner'&&!boot.user.webmaster}/>}
    {page==='settings'&&boot.chatgptBusinessEnabled&&boot.user?.role==='owner'&&!boot.user.webmaster&&<ChatGPTBusinessSettings api={api}/>}
    {data?.kind==='settings'&&boot.user&&userCan(boot.user,'settings:write')&&<div className="settings-grid"><section className="panel form-panel"><h2>Lead notifications</h2><p className="muted">Save your preferred destination for future website enquiries.</p><div className="inline-notice">Delivery is not connected in this alpha. Saving a preference does not activate or change email delivery.</div><form onSubmit={async e=>{e.preventDefault();const value=new FormData(e.currentTarget).get('notification_email');if(await mutate('settings',{notification_email:value,revision:data.value.revision}))setNotice('Preference saved. Email delivery remains disconnected.');}}><label htmlFor="notification_email">Notification email</label><input id="notification_email" name="notification_email" type="email" required key={data.value.revision} defaultValue={data.value.notification_email} placeholder="hello@yourbusiness.com"/><button className="primary" disabled={busy}>{busy?'Saving…':'Save preference'}</button></form></section><section className="panel form-panel"><h2>Installation</h2><dl><dt>Admin domain</dt><dd>{boot.manifest.adminOrigin}</dd><dt>Website</dt><dd>{boot.manifest.site.origin}</dd><dt>Installation ID</dt><dd>{boot.manifest.installationId}</dd><dt>Infrastructure</dt><dd>Cloudflare Workers · D1 · R2</dd><dt>Authentication email</dt><dd>Cloudflare Email Service binding</dd><dt>Contract version</dt><dd>{boot.manifest.schemaVersion}</dd></dl><p className="helper">Your agent maintains domain bindings and installed modules in the installation source.</p></section></div>}
    {page==='settings'&&boot.manifest.reportingPairing&&boot.user?.role==='owner'&&<ReportingGrants/>}
    {page==='settings'&&boot.webmasterEnabled&&<WebmasterPanel billingAvailable={boot.modules.some(m=>m.id==='account-billing')}/>}
    {data?.kind==='settings'&&boot.user?.role==='owner'&&!boot.user.webmaster&&boot.manifest.webmasterSignOn?.mode==='client'&&<SignOnGrants/>}
    {data?.kind==='access'&&boot.accountAuth?.enabled&&<TeamAccess value={data.value} reload={async()=>setData({kind:"access",value:await api<AccessResponse>("access")})}/>}
    {data?.kind==='access'&&!boot.accountAuth?.enabled&&<><section className="panel table-wrap"><table><thead><tr><th>Account</th><th>Role</th><th>Access</th></tr></thead><tbody>{data.value.rows.map((row)=><tr key={row.id}><td>{row.email}</td><td><span className="badge">{row.role}</span></td><td>{row.active?'Active':'Revoked'}</td></tr>)}</tbody></table></section><p className="helper">This alpha lists provisioned accounts. Owner bootstrap is performed by the installation CLI. Invitation and transfer controls are planned.</p></>}
    {data?.kind==='activity'&&<section className="panel">{data.value.rows.length?data.value.rows.map((row)=><article className="activity-row" key={row.id}><span className="activity-marker"/><div><strong>{row.action}</strong><p>{row.actor}{row.organization_name&&<> · {row.organization_name}</>}</p></div><time>{row.created_at} UTC</time></article>):<Empty title="Your activity starts here." text="Changes to leads, settings, and work queue tasks will appear here."/>}</section>}
    {data?.kind==='work-queue'&&<section className="panel form-panel"><div className="panel-heading"><div><h2>Follow-up work</h2><p>Installed module · work-queue v1</p></div><span className="small-tag">BUSINESS TOOL</span></div>{boot.user&&userCan(boot.user,'tasks:write')&&<form className="task-form" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;const title=new FormData(form).get('title');if(await mutate('modules/work-queue',{title}))form.reset();}}><label className="sr-only" htmlFor="task">New task</label><input id="task" name="title" required maxLength={180} placeholder="What needs to happen next?"/><button className="primary" disabled={busy}>Add task</button></form>}{data.value.rows.length?data.value.rows.map((row)=><label className={`task-row ${row.done?'done':''}`} key={row.id}><input type="checkbox" checked={!!row.done} disabled={busy||!boot.user||!userCan(boot.user,'tasks:write')} onChange={e=>mutate('modules/work-queue/status',{id:row.id,done:e.target.checked})}/><span>{row.title}</span><small>{row.done?'Complete':'To do'}</small></label>):<Empty title="A clear queue." text="Add your first follow-up task above."/>}</section>}
    {data?.kind==='module'&&customModule&&<section className="panel form-panel"><h2>{customModule.label}</h2><p>{customModule.description}</p>{Array.isArray(data.value.rows)&&data.value.rows.length?<ul>{data.value.rows.map((row,i)=><li key={row.id||i}>{String(row.title||row.name||row.id||'Record')}</li>)}</ul>:<Empty title="Ready for your business records." text={data.value.message||'This module is installed. Your agent can extend its data and interface.'}/>}</section>}
  </>;
}
function Stats({analytics,leads}:{analytics?:AnalyticsResponse|null;leads?:LeadsResponse|null}) {
  const rows=analytics?.rows||[];const available=analytics?.source==='synthetic'||analytics?.source==='connected';
  const sum=(key:'views'|'visitors'|'enquiries')=>available?rows.reduce((n,r)=>n+Number(r[key]||0),0).toLocaleString():'—';
  const items=[['Page views',sum('views'),'Total page loads in this period'],['Daily visitors',sum('visitors'),'Sum of daily visitor counts'],['Enquiries',sum('enquiries'),'Accepted website forms'],...(leads?[['Awaiting follow-up',['synthetic','connected'].includes(leads.source)?String(leads.pagination?.newCount??leads.rows.filter((r)=>r.status==='new').length):'—',leads.pagination?'New enquiries in your inbox':'New among loaded enquiries']]:[])];
  return <div className={`stats stats-${items.length}`}>{items.map(([label,value,detail])=><section key={label}><p>{label}</p><strong>{value}</strong><small>{detail}</small></section>)}</div>;
}
function Chart({rows}:{rows:AnalyticsRow[]}) {
  if(!rows.length)return <Empty title="Your insights will appear here." text="Connect your website analytics to start seeing real traffic."/>;
  const max=Math.max(1,...rows.map(r=>r.views));
  return <div className="chart" role="img" aria-label={`Daily page views: ${rows.map(r=>`${r.day}: ${r.views}`).join(', ')}`}><div className="chart-grid"><span>{max}</span><span>{Math.round(max/2)}</span><span>0</span></div><div className="bars">{rows.map(row=><div className="bar-column" key={row.day}><div className={`bar bar-${Math.max(1,Math.round(row.views/max*10))}`} title={`${row.day}: ${row.views} views`}/><span>{row.day.slice(8)}</span></div>)}</div><p className="chart-caption">Day of month · page views</p></div>;
}
function LeadTable({rows,onSelect}:{rows:LeadRow[];onSelect:(r:LeadRow)=>void}) {
  return rows.length?<div className="table-wrap"><table><thead><tr><th>Contact</th><th>Enquiry</th><th>Status</th><th>Received</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><button className="contact-button" onClick={()=>onSelect(row)}>{row.name}</button><small>{row.email}</small></td><td><span className="message-preview">{row.message}</span><small>{row.source}</small></td><td><span className={`badge ${row.status}`}>{row.status}</span></td><td className="date-cell">{row.created_at.slice(0,10)}</td></tr>)}</tbody></table></div>:<Empty title="No enquiries to show." text="New website enquiries will appear here when forms are connected."/>;
}
function Empty({title,text}:{title:string;text:string}) {return <div className="empty"><h3>{title}</h3><p>{text}</p></div>;}
createRoot(document.getElementById('root')!).render(<App/>);
