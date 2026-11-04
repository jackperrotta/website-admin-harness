import type {AdminModule, ModuleContext} from '../worker.ts';
import {isLoopback, isObject} from '../../../contracts/src/index.ts';
import {invoiceTotal, type BillingState, type BillingResponse, type BillingMutation, type BillingLine} from '../../../contracts/src/billing.ts';
import {billingSeed} from './seed.ts';

class PreviewError extends Error {constructor(public status: number, message: string) {super(message);}}
const json = (value: unknown, status = 200) => Response.json(value, {status});
const reject = (status: number, message: string): never => {throw new PreviewError(status, message);};
const hash = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), n=>n.toString(16).padStart(2,'0')).join('');
type Receipt = {key: string; hash: string};
function local(context: ModuleContext) {
  const {env, manifest, request} = context;
  if (env.MODE !== 'local' || !isLoopback(manifest.adminOrigin) || new URL(manifest.adminOrigin).protocol !== 'http:' || new URL(request.url).origin !== manifest.adminOrigin || manifest.backend) reject(404, 'Billing preview is available only in an isolated local installation.');
  if (context.user.role !== 'owner') reject(403, 'Only the local owner can review billing.');
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) reject(415,'Send a JSON command.');
  const reader = request.body?.getReader(); if (!reader) return reject(400,'A command is required.');
  const parts: Uint8Array[] = []; let size = 0;
  for (;;) {const {value,done} = await reader.read(); if(done)break; size += value.length; if(size>16000){await reader.cancel();reject(413,'This command is too large.');} parts.push(value);}
  const bytes = new Uint8Array(size); let offset=0; for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  try {const value:unknown=JSON.parse(new TextDecoder().decode(bytes));if(isObject(value))return value;} catch {}
  return reject(400,'Send a valid JSON command.');
}
function command(data: Record<string, unknown>, account: boolean): BillingMutation {
  if (!Number.isSafeInteger(data.revision) || Number(data.revision)<0 || typeof data.idempotencyKey!=='string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(data.idempotencyKey)) reject(400,'Refresh the billing view and send a valid request key.');
  const fields:Record<string,string[]>={plan:['subscriptionId','planId','timing','reviewed'],cancel:['subscriptionId','reviewed'],resume:['subscriptionId','reviewed'],draft:['invoiceId','customerId','description','due','lines'],send:['invoiceId','reviewed'],void:['invoiceId','reviewed'],pay:['invoiceId','reviewed'],card:['reviewed'],connection:['connected']};
  const action=typeof data.action==='string'?data.action:'';
  if(!Object.hasOwn(fields,action) || Object.keys(data).some(k=>!['action','revision','idempotencyKey',...fields[action]].includes(k)))reject(400,'This billing command is not supported.');
  if(account&&!['plan','cancel','resume','pay','card'].includes(action))reject(403,'This action is only available to the billing business.');
  for(const key of ['subscriptionId','planId','invoiceId','customerId'])if(fields[action].includes(key)&&!(key==='invoiceId'&&action==='draft'&&data[key]===undefined)&&(typeof data[key]!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(data[key] as string)))reject(400,'Choose a valid billing record.');
  if(fields[action].includes('reviewed')&&data.reviewed!==true)reject(400,'Review and confirm this action first.');
  if(action==='plan'&&!['renewal','now'].includes(String(data.timing)))reject(400,'Choose when the new plan takes effect.');
  if(action==='connection'&&typeof data.connected!=='boolean')reject(400,'Choose a preview connection state.');
  if(action==='draft') {
    if(typeof data.description!=='string'||!data.description.trim()||data.description.length>120||typeof data.due!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(data.due)||!Number.isFinite(Date.parse(data.due))||new Date(data.due).toISOString().slice(0,10)!==data.due||data.due<new Date().toISOString().slice(0,10)||!Array.isArray(data.lines)||data.lines.length<1||data.lines.length>12)reject(400,'Add a title, a valid future due date, and one to twelve invoice lines.');
    if((data.lines as unknown[]).some(l=>!isObject(l)||Object.keys(l).some(k=>!['description','quantity','unitAmount'].includes(k))||typeof l.description!=='string'||!l.description.trim()||l.description.length>160||!Number.isSafeInteger(l.quantity)||Number(l.quantity)<1||Number(l.quantity)>100||!Number.isSafeInteger(l.unitAmount)||Number(l.unitAmount)<1||Number(l.unitAmount)>10000000))reject(400,'Invoice lines need a description, a whole quantity, and a positive amount.');
  }
  return data as unknown as BillingMutation;
}
function view(state: BillingState, revision: number, customerId: string | null): BillingResponse {
  const own=(id:string)=>id===customerId;
  return {...state,...(customerId?{customers:state.customers.filter(c=>own(c.id)).map(c=>({...c,note:''})),plans:state.plans.filter(p=>p.selfService||state.subscriptions.some(s=>own(s.customerId)&&s.planId===p.id)),subscriptions:state.subscriptions.filter(s=>own(s.customerId)),invoices:state.invoices.filter(i=>own(i.customerId)&&i.status!=='draft'),payments:state.payments.filter(p=>own(p.customerId)),activity:state.activity.filter(a=>a.customerId&&own(a.customerId))}:{}),revision,simulated:true,audience:customerId?'customer':'seller',customerId,supplier:'Vitris Studio',currency:'USD',asOf:new Date().toISOString()};
}

/** Synthetic local module. It has no Stripe or email adapter. */
export const billingPrototype: AdminModule = {
  id:'billing',version:1,label:'Billing',permission:'billing:read',description:'Local billing workflow preview with synthetic records.',
  async handle(context) {
    try {
      local(context);
      const {request,env,manifest}=context, path=new URL(request.url).pathname.slice('/api/modules/billing'.length);
      if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed'},405);
      const match=path.match(/^\/account\/([a-zA-Z0-9_-]{1,100})(\/invoices\/([a-zA-Z0-9_-]{1,100})\/document)?$/);
      const document=path.match(/^\/invoices\/([a-zA-Z0-9_-]{1,100})\/document$/);
      if(path!==''&&path!=='/'&&!match&&!document)return json({error:'Not found'},404);
      const scope=[manifest.installationId,manifest.site.id];
      await env.DB.prepare('INSERT OR IGNORE INTO billing_prototype(installation_id,site_id,payload) VALUES(?,?,?)').bind(...scope,JSON.stringify(billingSeed())).run();
      const stored=await env.DB.prepare('SELECT revision,payload,receipts FROM billing_prototype WHERE installation_id=? AND site_id=?').bind(...scope).first<{revision:number;payload:string;receipts:string}>();
      if(!stored)return json({error:'Preview storage is unavailable.'},503);
      const state=JSON.parse(stored.payload) as BillingState, receipts=JSON.parse(stored.receipts) as Receipt[], customerId=match?.[1]??null;
      if(customerId&&!state.customers.some(c=>c.id===customerId))return json({error:'Account not found'},404);
      const documentId=document?.[1]??match?.[3];
      if(documentId) {
        if(request.method!=='GET')return json({error:'Method not allowed'},405);
        const invoice=state.invoices.find(i=>i.id===documentId&&(!customerId||i.customerId===customerId)&&i.status!=='draft');
        if(!invoice)return json({error:'Invoice not found'},404);
        const customer=state.customers.find(c=>c.id===invoice.customerId)!;
        return new Response(`SAMPLE INVOICE — LOCAL PREVIEW\nNo real payment or invoice has been issued.\n\nVitris Studio\n${invoice.number}\nBill to: ${customer.name}\nDue: ${invoice.due}\nStatus: ${invoice.status}\n\n${invoice.lines.map(l=>`${l.description} | ${l.quantity} x USD ${(l.unitAmount/100).toFixed(2)}`).join('\n')}\n\nTotal: USD ${(invoiceTotal(invoice)/100).toFixed(2)}\n`,{headers:{'content-type':'text/plain;charset=utf-8','content-disposition':`attachment; filename="sample-${invoice.number}.txt"`}});
      }
      if(request.method==='GET')return json(view(state,stored.revision,customerId));
      const data=command(await body(request),!!customerId);
      context.require(data.action==='connection'?'billing:connection:manage':data.action==='plan'||data.action==='cancel'||data.action==='resume'?'billing:subscriptions:write':data.action==='pay'?'billing:collect':data.action==='card'?'billing:collect':'billing:invoices:write');
      const fingerprint=await hash(JSON.stringify({...data,idempotencyKey:undefined,revision:undefined,customerId:customerId||('customerId' in data?data.customerId:null)}));
      const previous=receipts.find(r=>r.key===data.idempotencyKey);
      if(previous)return previous.hash===fingerprint?json(view(state,stored.revision,customerId)):json({error:'This request key already belongs to a different action.'},409);
      if(data.revision!==stored.revision)return json({error:'Billing changed in another view. Refresh before trying again.'},409);
      if(!state.connection&&data.action!=='connection')return json({error:'The sample Stripe connection is paused. Reconnect it from the business preview.'},503);
      let actorCustomer=customerId, text='';
      const own=(id:string)=>!customerId||id===customerId;
      if(data.action==='plan'||data.action==='cancel'||data.action==='resume') {
        const subscription=state.subscriptions.find(s=>s.id===data.subscriptionId&&own(s.customerId));if(!subscription)return json({error:'Subscription not found'},404);
        if(subscription.status==='canceled')return json({error:'This subscription has ended.'},409);
        actorCustomer=subscription.customerId;
        if(data.action==='plan') {
          const plan=state.plans.find(p=>p.id===data.planId&&(!customerId||p.selfService));if(!plan)return json({error:'Plan not found'},404);
          if(subscription.status==='past_due'||subscription.cancelAtPeriodEnd)return json({error:'Resolve the outstanding renewal or scheduled cancellation before changing plans.'},409);
          if(plan.id===subscription.planId)return json({error:'This is already the current plan.'},409);
          // Preview supports renewal changes only; no invented Stripe proration amount.
          if(data.timing!=='renewal')return json({error:'Immediate changes require a real Stripe proration preview. Schedule this sample change for renewal.'},400);
          subscription.scheduledPlanId=plan.id;text=`${plan.name} scheduled for the next renewal.`;
        } else if(data.action==='cancel') {subscription.cancelAtPeriodEnd=true;subscription.scheduledPlanId=null;text='Cancellation scheduled for the end of the paid period.';}
        else {if(!subscription.cancelAtPeriodEnd)return json({error:'There is no scheduled cancellation to reverse.'},409);subscription.cancelAtPeriodEnd=false;text='Scheduled cancellation removed. Subscription continues.';}
      } else if(data.action==='draft') {
        if(!state.customers.some(c=>c.id===data.customerId))return json({error:'Customer not found'},404);
        const existing=data.invoiceId?state.invoices.find(i=>i.id===data.invoiceId):undefined;
        if(data.invoiceId&&!existing)return json({error:'Invoice not found'},404);
        if(existing&&existing.status!=='draft')return json({error:'Only a draft invoice can be edited.'},409);
        if(!existing&&state.invoices.length>=200)return json({error:'This preview is full. Restart it for a fresh sample.'},409);
        const draft={customerId:data.customerId,description:data.description.trim(),lines:data.lines.map((l:BillingLine)=>({...l,description:l.description.trim()})),due:data.due};
        if(existing)Object.assign(existing,draft);
        else state.invoices.unshift({...draft,id:crypto.randomUUID(),number:`INV-${1041+state.invoices.length}`,status:'draft',issued:new Date().toISOString().slice(0,10),paidAt:null,kind:'one_off'});
        actorCustomer=data.customerId;text='Invoice draft saved. Nothing sent or charged.';
      } else if(data.action==='send'||data.action==='void'||data.action==='pay') {
        const invoice=state.invoices.find(i=>i.id===data.invoiceId&&own(i.customerId)&&(!customerId||i.status!=='draft'));if(!invoice)return json({error:'Invoice not found'},404);
        actorCustomer=invoice.customerId;
        if(data.action==='send'){if(invoice.status!=='draft')return json({error:'Only a draft can be sent.'},409);invoice.status='open';text=`${invoice.number} marked sent in the preview. No email was sent.`;}
        else if(data.action==='void'){if(invoice.status!=='open')return json({error:'Only an unpaid open invoice can be voided.'},409);invoice.status='void';text=`${invoice.number} voided in the preview.`;}
        else {if(invoice.status!=='open')return json({error:'Only an open invoice can be paid.'},409);invoice.status='paid';invoice.paidAt=new Date().toISOString().slice(0,10);state.payments.unshift({id:crypto.randomUUID(),customerId:invoice.customerId,invoiceId:invoice.id,amount:invoiceTotal(invoice),status:'succeeded',date:invoice.paidAt});if(invoice.kind==='subscription')for(const s of state.subscriptions)if(s.customerId===invoice.customerId&&s.status==='past_due')s.status='active';text=`Sample payment recorded for ${invoice.number}. No card was charged.`;}
      } else if(data.action==='card') {state.card={brand:'Mastercard',last4:'4444',expiry:'08 / 2029'};text='Sample payment method updated. No card details were collected.';}
      else if(data.action==='connection') {state.connection=data.connected;text=data.connected?'Sample Stripe connection restored.':'Sample Stripe connection paused. Existing subscriptions remain unchanged.';}
      state.activity.unshift({id:crypto.randomUUID(),customerId:actorCustomer,text,at:new Date().toISOString()});state.activity=state.activity.slice(0,40);
      receipts.unshift({key:data.idempotencyKey,hash:fingerprint});
      const changed=await env.DB.prepare('UPDATE billing_prototype SET payload=?,receipts=?,revision=revision+1 WHERE installation_id=? AND site_id=? AND revision=?').bind(JSON.stringify(state),JSON.stringify(receipts.slice(0,200)),...scope,stored.revision).run();
      if(!changed.meta.changes)return json({error:'Another action finished first. Refresh billing to see its result.'},409);
      await context.audit(`Billing preview: ${data.action}`);
      return json(view(state,stored.revision+1,customerId));
    } catch(error) {if(error instanceof PreviewError)return json({error:error.message},error.status);throw error;}
  }
};

/** Separate local client installation. Its fixed binding supplies only its own account. */
export const accountBillingPrototype: AdminModule = {
  id:'account-billing',version:1,label:'Your billing',permission:'account-billing:read',description:'Local customer billing preview.',
  async handle(context) {
    try {
      local(context);
      const path=new URL(context.request.url).pathname.slice('/api/modules/account-billing'.length);
      if(!['GET','POST'].includes(context.request.method))return json({error:'Method not allowed'},405);
      if(path!==''&&path!=='/'&&!/^\/invoices\/[a-zA-Z0-9_-]{1,100}\/document$/.test(path))return json({error:'Not found'},404);
      const binding=(context.env as typeof context.env & {BILLING_PREVIEW?:Pick<Fetcher,'fetch'>}).BILLING_PREVIEW;
      if(!binding)return json({error:'The local billing preview is not paired. No sample data was substituted.'},503);
      let data:BillingMutation|undefined;
      if(context.request.method==='POST'){context.require('account-billing:manage');data=command(await body(context.request),true);}
      const upstream=await binding.fetch(`https://billing-preview.invalid${path}`,{method:context.request.method,...(data?{headers:{'content-type':'application/json'},body:JSON.stringify(data)}:{})});
      if(!upstream.ok)return new Response(upstream.body,{status:upstream.status,headers:{'content-type':'application/json'}});
      if(path.includes('/document'))return new Response(upstream.body,{headers:{'content-type':'text/plain;charset=utf-8','content-disposition':upstream.headers.get('content-disposition')||'attachment'}});
      const value:unknown=await upstream.json();
      if(!isObject(value)||value.simulated!==true||value.audience!=='customer'||!Array.isArray(value.customers)||value.customers.length!==1)return json({error:'The local billing account could not be verified.'},503);
      return json(value);
    } catch(error) {if(error instanceof PreviewError)return json({error:error.message},error.status);throw error;}
  }
};
