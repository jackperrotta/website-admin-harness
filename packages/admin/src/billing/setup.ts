import {isObject} from '../../../contracts/src/index.ts';
import {BillingError, digest, strict, StripeClient, stripeApiVersion, now} from './stripe.ts';
import {BillingService} from './service.ts';
import type {BillingProfile, BillingSettingsEnv, Manifest} from './settings-store.ts';
import type {StripeBillingEnv} from './stripe.ts';

export interface BillingPolicies {
  allowPlanChanges: boolean;
  allowCancellation: boolean;
  cancellation: 'at_period_end' | 'immediately';
  proration: 'none' | 'create_prorations' | 'always_invoice';
  invoiceDueDays: number;
  // These are owner attestations, never claims of account-wide API configuration.
  retryReview: string;
  emailReview: string;
  taxReview: string;
  sandboxReviewed: boolean;
}
export const defaultPolicies: BillingPolicies = {allowPlanChanges:false,allowCancellation:false,cancellation:'at_period_end',proration:'none',invoiceDueDays:14,retryReview:'',emailReview:'',taxReview:'',sandboxReviewed:false};
export function validatePolicies(value: unknown): BillingPolicies {
  if (!isObject(value)) throw new BillingError(400,'invalid_policy','Choose billing policies first.');
  strict(value,Object.keys(defaultPolicies));
  if (typeof value.allowPlanChanges!=='boolean'||typeof value.allowCancellation!=='boolean'||!['at_period_end','immediately'].includes(String(value.cancellation))||!['none','create_prorations','always_invoice'].includes(String(value.proration))||!Number.isSafeInteger(value.invoiceDueDays)||Number(value.invoiceDueDays)<1||Number(value.invoiceDueDays)>90||typeof value.sandboxReviewed!=='boolean'||['retryReview','emailReview','taxReview'].some(k=>typeof value[k]!=='string'||String(value[k]).length>1000)) throw new BillingError(400,'invalid_policy','Use supported cancellation, proration and invoice settings; review notes must be under 1,000 characters.');
  return {...defaultPolicies,...value} as BillingPolicies;
}
export const policyFingerprint = (p: BillingProfile) => digest(JSON.stringify({prices:p.config.prices,policies:p.policies||defaultPolicies}));
export const billingScope = (m:Manifest,p:BillingProfile) => JSON.stringify([m.installationId,m.site.id,p.config.accountId,p.config.mode]);
export function profileEnv(env:StripeBillingEnv,p:BillingProfile):StripeBillingEnv {return {...env,STRIPE_SECRET_KEY:p.secretKey,STRIPE_WEBHOOK_SECRET:p.webhookSecret};}
export function profileConfig(p:BillingProfile) {return {...p.config,allowLiveWrites:!!p.activation};}
export const requiredBillingEvents=['price.created','billing_portal.configuration.created','invoice.created','invoice.finalized','invoice.paid','invoice.payment_failed','invoice.payment_action_required','invoice.voided','invoice.marked_uncollectible','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','checkout.session.completed','checkout.session.expired','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','payment_intent.succeeded','payment_intent.payment_failed','payment_intent.processing','payment_intent.canceled'];

export async function portalFields(env:StripeBillingEnv,manifest:Manifest,p:BillingProfile) {
  const policies=p.policies||defaultPolicies, stripe=new StripeClient(profileEnv(env,p),manifest,p.config);
  const fields:Record<string,string|number|boolean>={
    'features[invoice_history][enabled]':true,'features[payment_method_update][enabled]':true,
    'features[customer_update][enabled]':false,'features[subscription_cancel][enabled]':policies.allowCancellation,
    'features[subscription_cancel][mode]':policies.cancellation,'features[subscription_cancel][proration_behavior]':'none',
    'features[subscription_update][enabled]':policies.allowPlanChanges,'features[subscription_update][proration_behavior]':policies.proration,
    'login_page[enabled]':false,default_return_url:manifest.adminOrigin,
    'metadata[installation_id]':manifest.installationId,'metadata[site_id]':manifest.site.id,
  };
  if(policies.allowPlanChanges){
    fields['features[subscription_update][default_allowed_updates][0]']='price';
    const products=new Map<string,string[]>();
    for(const priceId of p.config.prices){const price=await stripe.call('/prices/'+priceId);if(!price.recurring)continue;const product=typeof price.product==='string'?price.product:isObject(price.product)?price.product.id:undefined;if(typeof product!=='string'||!/^prod_[\w]+$/.test(product))throw new BillingError(400,'invalid_product','An approved price has no usable product.');products.set(product,[...(products.get(product)||[]),priceId]);}
    if(!products.size||products.size>10)throw new BillingError(400,'portal_catalog','Plan switching needs between one and ten recurring products.');
    let index=0;for(const [product,prices] of products){fields[`features[subscription_update][products][${index}][product]`]=product;prices.forEach((id,i)=>fields[`features[subscription_update][products][${index}][prices][${i}]`]=id);index++;}
  }
  return fields;
}

export async function portalMatches(env:StripeBillingEnv,manifest:Manifest,p:BillingProfile) {
  if(!p.config.portalConfigurationId||p.appliedPolicy!==await policyFingerprint(p))return false;
  const portal=await new StripeClient(profileEnv(env,p),manifest,p.config).call('/billing_portal/configurations/'+p.config.portalConfigurationId,'GET',{'expand[]':'features.subscription_update.products'});
  if(portal.active!==true||portal.livemode!==(p.config.mode==='live'))return false;
  const expected=await portalFields(env,manifest,p);
  // Compare the actual provider settings, not just a saved local acknowledgement.
  for(const [key,value] of Object.entries(expected)){
    if(key.startsWith('metadata')||key==='default_return_url')continue;
    const parts=key.replaceAll(']','').split('[');let actual:unknown=portal;
    for(const part of parts)actual=actual!==null&&typeof actual==='object'?(actual as Record<string,unknown>)[part]:undefined;
    if(actual!==value)return false;
  }
  const features=isObject(portal.features)?portal.features:{},update=isObject(features.subscription_update)?features.subscription_update:{};
  if(p.policies?.allowPlanChanges){
    const products=Array.isArray(update.products)?update.products:[],approved=p.config.prices;
    if(!Array.isArray(update.default_allowed_updates)||update.default_allowed_updates.length!==1||update.default_allowed_updates[0]!=='price')return false;
    if(products.some(x=>!isObject(x)||!Array.isArray(x.prices)||x.prices.some(id=>!approved.includes(String(id)))))return false;
    const scheduled=isObject(update.schedule_at_period_end)?update.schedule_at_period_end.conditions:undefined;
    if(Array.isArray(scheduled)&&scheduled.length)return false;
  }
  return true;
}

export interface ReadinessCheck {id:string;label:string;ok:boolean;detail:string}
export async function readiness(env:StripeBillingEnv & BillingSettingsEnv,manifest:Manifest,p:BillingProfile) {
  const checks:ReadinessCheck[]=[], add=(id:string,label:string,ok:boolean,detail:string)=>checks.push({id,label,ok,detail});
  const s=new BillingService(profileEnv(env,p),manifest,p.config);
  try{const a=await s.stripe.verify();add('account','Stripe account',p.config.mode==='test'||a.charges_enabled===true&&a.payouts_enabled===true,'Account and mode verified; live accounts need payments and payouts enabled.');}catch{add('account','Stripe account',false,'Check the saved key, account and read permissions.');}
  try{const prices=await s.prices();add('prices','Approved plans',prices.length>0,'Approve at least one fixed price from this mode.');}catch{add('prices','Approved plans',false,'An approved price is unavailable or unsupported.');}
  try{add('portal','Client billing policies',await portalMatches(env,manifest,p),'Apply policies, including invoice history and payment-method updates, and recheck after Stripe Dashboard edits.');}catch{add('portal','Client billing policies',false,'Apply the saved policies to a dedicated Stripe portal configuration.');}
  try{const hooks=await s.stripe.call('/webhook_endpoints','GET',{limit:100});const match=Array.isArray(hooks.data)&&hooks.data.some(h=>isObject(h)&&h.url===manifest.adminOrigin+'/api/modules/billing/hooks/stripe'&&h.livemode===(p.config.mode==='live')&&h.status==='enabled'&&h.api_version===stripeApiVersion&&Array.isArray(h.enabled_events)&&(h.enabled_events.includes('*')||requiredBillingEvents.every(e=>(h.enabled_events as unknown[]).includes(e))));add('webhook','Stripe webhook configuration',!!p.webhookSecret&&!!match,'Use the exact admin endpoint, matching signing secret, snapshot API version and required events.');}catch{add('webhook','Stripe webhook configuration',false,'Webhook read permission and a version-pinned endpoint are required.');}
  const health=await env.DB.prepare('SELECT scheduled_at,webhook_at FROM billing_setup_health WHERE scope=?').bind(billingScope(manifest,p)).first<{scheduled_at:number;webhook_at:number}>();
  add('scheduler','Background reconciliation',!!health&&health.scheduled_at>now()-600,'The owning scheduler must have completed within ten minutes.');
  add('delivery','Signed webhook delivery',!!health&&health.webhook_at>0,'Prepare the webhook, then create a plan or apply portal policies. Stripe can prove signed delivery without a payment.');
  const failed=await s.sql("SELECT count(*) n FROM billing_inbox WHERE scope=? AND state='failed'").first<{n:number}>();
  const sync=await s.sql("SELECT count(*) n FROM billing_sync WHERE scope=? AND state='failed'").first<{n:number}>();
  const ops=await s.sql("SELECT count(*) n FROM billing_operations WHERE scope=? AND state<>'succeeded'").first<{n:number}>();
  add('recovery','Unresolved billing work',!failed?.n&&!sync?.n&&!ops?.n,'Reconcile failed events and incomplete operations before activation.');
  const policy=p.policies||defaultPolicies;
  for(const [id,label,value] of [['retries','Stripe retry policy',policy.retryReview],['emails','Stripe billing emails',policy.emailReview],['tax','Tax treatment',policy.taxReview]] as const)add(id,label,value.trim().length>=10,'Owner-recorded review; this does not change Stripe account settings.');
  add('sandbox','Sandbox acceptance reviewed',policy.sandboxReviewed,'Owner confirms checkout, invoices/emails, renewals, failure/recovery and client self-service were tested.');
  add('deployment','Deployment allows activation',p.config.mode==='test'||env.BILLING_LIVE_WRITES==='1','The installation deployment must permit activation; saved owner activation is also required.');
  return {ready:checks.every(c=>c.ok),checks,checkedAt:now()};
}
