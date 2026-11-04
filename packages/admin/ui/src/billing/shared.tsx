import React, {useEffect, useRef} from 'react';
import type {BillingInvoice} from '../../../../contracts/src/billing.ts';
export const money=(amount:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:amount%100?2:0}).format(amount/100);
export const date=(value:string)=>new Date(value.length===10?`${value}T12:00:00Z`:value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
export const overdue=(invoice:BillingInvoice)=>invoice.status==='open'&&invoice.due<new Date().toISOString().slice(0,10);
export function Glyph({name}:{name:string}) {
  const paths:Record<string,React.ReactNode>={arrow:<path d="M7 17 17 7M7 7h10v10"/>,plus:<path d="M12 5v14M5 12h14"/>,invoice:<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6m-6 4h6"/></>,card:<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></>,check:<path d="m5 12 4 4L19 6"/>,clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,more:<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,download:<><path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4"/></>,search:<><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>,alert:<><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3h.01"/></>,bank:<><path d="m3 8 9-5 9 5H3Zm2 3v7m7-7v7m7-7v7M3 21h18"/></>,refresh:<path d="M20 7v5h-5M4 17v-5h5m-4-4a8 8 0 0 1 14-2l1 6M4 12l1 6a8 8 0 0 0 14-2"/>};
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.invoice}</svg>;
}
export function Status({value}:{value:string}) {return <span className={`bl-badge bl-${value}`}><i/>{({active:'Active',past_due:'Past due',trialing:'Trial',canceled:'Ended',ending:'Ending soon',paid:'Paid',open:'Awaiting payment',overdue:'Overdue',draft:'Draft',void:'Void',succeeded:'Successful',failed:'Failed',refunded:'Refunded'} as Record<string,string>)[value]||value}</span>;}
export function Dialog({title,close,children,wide=false,eyebrow='BILLING PREVIEW'}:{title:string;close:()=>void;children:React.ReactNode;wide?:boolean;eyebrow?:string}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const el=ref.current!;el.showModal();return()=>el.close();},[]);
  return <dialog ref={ref} className={`bl-dialog${wide?' bl-dialog-wide':''}`} aria-label={title} onCancel={e=>{e.preventDefault();close();}}><div className="bl-dialog-head"><div><p className="bl-overline">{eyebrow}</p><h2>{title}</h2></div><button className="bl-icon-button" onClick={close} aria-label="Close dialog">×</button></div>{children}</dialog>;
}
export function Empty({title,children}:{title:string;children:React.ReactNode}) {return <div className="bl-empty"><Glyph name="invoice"/><h3>{title}</h3><p>{children}</p></div>;}
