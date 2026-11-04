import React,{useEffect,useState} from 'react';
import type {OnboardingTemplate,ProspectPortal,ProspectWorkspace,OnboardingField} from '../../../../contracts/src/index.ts';
import {onboardingRequest,onboardingError} from './onboarding-api';
import {useOnboardingDraft} from './onboarding-draft';
import {SignupJourney,PaymentStep,JourneyCompletion,TestPreview,stagesFor,stageLabel,type Stage} from './prospect-journey';
import './template-preview.css';

type PreviewStep='welcome'|Stage|'complete';
const clientFor=(t:OnboardingTemplate):ProspectPortal=>({business:'Example business',name:'Riley',email:'riley@example.test',previewUrl:'',message:t.message,fields:t.fields.map(f=>({...f,value:''})),requiresPayment:t.requiresPayment,paymentStatus:t.requiresPayment?'pending':'not_requested',feedback:'',feedbackAt:null,onboarding:{title:t.title,intro:t.intro}});
const sampleValue=(f:OnboardingField)=>f.value || (f.kind==='tel'?'555-0100':f.kind==='url'?'https://example.test':f.kind==='textarea'?'An example answer about this business and its website.':'Example answer');

export default function OnboardingTemplatePreview({templateId,close}:{templateId:string;close:()=>void}) {
  const [template,setTemplate]=useState<OnboardingTemplate|null>(null),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
  useEffect(()=>{let active=true;onboardingRequest<ProspectWorkspace>().then(workspace=>{if(!active)return;const value=workspace.templates.find(t=>t.id===templateId);if(value)setTemplate(value);else setError('This template is no longer available. It may have been archived.');}).catch(e=>{if(active)setError(onboardingError(e));}).finally(()=>{if(active)setLoaded(true);});return()=>{active=false;};},[templateId]);
  if(!loaded)return <main className="tp-unavailable"><p role="status">Loading template preview…</p></main>;
  if(!template)return <main className="tp-unavailable"><p className="ob-eyebrow">TEMPLATE PREVIEW</p><h1>Template unavailable.</h1><p role="alert">{error}</p><button className="primary" onClick={close}>← Back to templates</button></main>;
  return <PreviewFlow template={template} close={close}/>;
}

export function OnboardingDraftPreview({close}:{close:()=>void}) {
  const [template]=useOnboardingDraft();
  if(!template)return <main className="tp-unavailable"><p className="ob-eyebrow">TEMPLATE PREVIEW</p><h1>Draft preview unavailable.</h1><p>Unsaved templates stay in this tab until you leave the onboarding workspace or reload. Return to templates to start editing.</p><button className="primary" onClick={close}>← Back to templates</button></main>;
  return <PreviewFlow template={template} close={close} unsaved/>;
}

function PreviewFlow({template,close,unsaved=false}:{template:OnboardingTemplate;close:()=>void;unsaved?:boolean}) {
  const [client,setClient]=useState(()=>clientFor(template)),[step,setStep]=useState<PreviewStep>('welcome'),[device,setDevice]=useState<'desktop'|'phone'>('desktop'),[instance,setInstance]=useState(0),[notice,setNotice]=useState('');
  const steps:PreviewStep[]=['welcome',...stagesFor(client),'complete'];
  const stepName=(s:PreviewStep)=>s==='welcome'?'Welcome & site preview':s==='complete'?'Completion':stageLabel[s];
  const name=template.name.trim()||'Untitled template';
  useEffect(()=>{document.title=`${unsaved?'Unsaved template preview':'Template preview'} · ${name}`;},[name,unsaved]);
  const jump=(next:PreviewStep)=>{setStep(next);setInstance(v=>v+1);setNotice('');window.scrollTo(0,0);};
  const reset=()=>{setClient(clientFor(template));jump('welcome');setNotice('Preview reset. No saved records were changed.');};
  function sample() {
    const fields=(client.draft?.fields||client.fields).map(f=>({...f,value:sampleValue(f)}));
    setClient(v=>({...v,fields,...(v.draft?{draft:{...v.draft,fields}}:{})}));setInstance(v=>v+1);setNotice('Example answers filled in. They stay in this preview only.');
  }
  const signup=step==='business'||step==='website'||step==='account';
  return <div className="tp-preview"><header className="tp-toolbar"><div className="tp-toolbar-title"><button className="text-button" onClick={close}>{unsaved?'← Back to editing':'← Back to templates'}</button><div><span>{unsaved?'UNSAVED TEMPLATE PREVIEW':'TEMPLATE PREVIEW'}</span><h1>{name}</h1></div></div><div className="tp-toolbar-controls"><label>Preview step<select aria-label="Preview step" value={step} onChange={e=>jump(e.target.value as PreviewStep)}>{steps.map(s=><option key={s} value={s}>{stepName(s)}</option>)}</select></label><div className="tp-device" aria-label="Preview width"><button aria-pressed={device==='desktop'} onClick={()=>setDevice('desktop')}>Desktop</button><button aria-pressed={device==='phone'} onClick={()=>setDevice('phone')}>Phone</button></div><button className="tp-tool-button" onClick={sample}>Use sample answers</button><button className="tp-tool-button" onClick={reset}>Reset preview</button></div></header><div className="tp-preview-note"><strong>{unsaved?'Unsaved changes.':'Preview only.'}</strong> {unsaved&&'These template changes have not been saved. '}No prospect is assigned, no account is created, and no email or payment is sent. Answers stay in this tab.</div><p className="tp-notice" role="status">{notice}</p>
    <div className="tp-canvas" data-device={device}><div className="ob-portal oj-root"><header className="oj-header"><div className="oj-brand"><span>V</span><div><strong>{client.business}</strong><small>YOUR CLIENT WORKSPACE</small></div></div></header><main className={step==='welcome'?'ob-portal-main':'oj-main'}>
      {step==='welcome'?<><div className="ob-client-heading"><p className="oj-eyebrow">A FIRST LOOK AT WHAT’S NEXT</p><h1>A little preview, {client.name.split(' ')[0]}.</h1><p>{client.message}</p></div><TestPreview client={client}/><section className="ob-card ob-signup-callout oj-invitation-callout"><div><p className="oj-eyebrow">YOUR NEXT CHAPTER STARTS HERE</p><h2>Make yourself at home.</h2><p>A few steps, thoughtfully put together. Finish your account when you’re ready.</p><span>{stagesFor(client).map(s=>stageLabel[s]).join(' · ')}</span></div><button className="primary" onClick={()=>jump('business')}>Complete signup →</button></section></>:signup?<SignupJourney key={instance} client={client} token={null} back={()=>jump('welcome')} onSaved={setClient} activated={v=>{setClient(v);jump(v.requiresPayment?'payment':'complete');}} preview={{stage:step as Exclude<Stage,'payment'>,stageChanged:setStep,save:(name,fields,next)=>({...client,draft:{name,fields,step:next,savedAt:new Date().toISOString()}}),activate:(name,fields)=>({...client,name,fields,draft:undefined})}}/>:step==='payment'?<PaymentStep client={client} later={()=>jump('complete')} laterLabel="View completion screen →" done={v=>{setClient(v);jump('complete');}} previewComplete={()=>({...client,paymentStatus:'demo_complete'})}/>:<JourneyCompletion client={{...client,paymentStatus:client.requiresPayment?'demo_complete':'not_requested'}} label="Restart preview →" open={reset}/>}
    </main><footer className="oj-footer"><span>Thoughtfully built with Vitris</span><span>Template preview · Example details only</span></footer></div></div>
  </div>;
}
