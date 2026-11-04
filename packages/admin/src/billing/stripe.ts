import {isLoopback,isObject} from '../../../contracts/src/index.ts';
import type {AdminManifest} from '../../../contracts/src/index.ts';
import type {StripeBillingConfig,BillingAccountConfig} from '../../../contracts/src/stripe-billing.ts';
export const stripeApiVersion='2026-10-28.endive';
export interface StripeBillingEnv {DB:D1Database;MODE?:string;STRIPE_SECRET_KEY?:string;STRIPE_WEBHOOK_SECRET?:string;BILLING_LIVE_WRITES?:string;BILLING_HTTP?:Pick<Fetcher,'fetch'>;BILLING_FIXTURE_MODE?:string;BILLING_ACCOUNT_TOKEN?:string;BILLING_ACCOUNT_HTTP?:Pick<Fetcher,'fetch'>}
export class BillingError extends Error {status:number;code:string;uncertain:boolean;constructor(status:number,code:string,message:string,uncertain=false){super(message);this.status=status;this.code=code;this.uncertain=uncertain;}}
export const fail=(status:number,code:string,message:string):never=>{throw new BillingError(status,code,message);};
export const now=()=>Math.floor(Date.now()/1000);
export const digest=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),n=>n.toString(16).padStart(2,'0')).join('');
export const id=(value:unknown,prefix:string)=>typeof value==='string'&&new RegExp(`^${prefix}_[A-Za-z0-9_]{1,120}$`).test(value);
export function configuration(input:StripeBillingConfig):Readonly<StripeBillingConfig> {
  if(!isObject(input)||!id(input.accountId,'acct')||!['test','live'].includes(input.mode)||!/^[a-z]{3}$/.test(input.currency)||!Array.isArray(input.prices)||input.prices.length>50||input.prices.some(p=>!id(p,'price'))||new Set(input.prices).size!==input.prices.length||input.portalConfigurationId&&!id(input.portalConfigurationId,'bpc')||input.allowLiveWrites!==undefined&&typeof input.allowLiveWrites!=='boolean')throw Error('Provide an account, mode, currency and explicit approved Stripe price IDs.');
  for(const grant of input.grants||[])if(!/^[\w-]{1,80}$/.test(grant.id)||!/^[a-f0-9]{64}$/.test(grant.tokenHash)||!grant.customerId||!grant.installationId||!grant.siteId||!exactOrigin(grant.adminOrigin)||typeof grant.manage!=='boolean'||typeof grant.enabled!=='boolean')throw Error('Provide a complete installation-scoped billing grant.');
  if(new Set((input.grants||[]).map(g=>g.id)).size!==(input.grants||[]).length)throw Error('Billing grant IDs must be unique.');
  return Object.freeze(structuredClone(input));
}
export function exactOrigin(value:string){try{const u=new URL(value);if(u.origin!==value)return false;if(isLoopback(value))return u.protocol==='https:'||u.protocol==='http:';return u.protocol==='https:'&&/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(u.hostname)&&!/(?:\.(?:local|internal|localhost)|^localhost)$/i.test(u.hostname);}catch{return false;}}
export function accountConfiguration(input:BillingAccountConfig){if(!exactOrigin(input.sellerOrigin)||!input.sellerInstallationId||!input.sellerSiteId||!input.customerId||!/^[\w-]{1,80}$/.test(input.grantId)||!['test','live'].includes(input.mode))throw Error('Provide an exact seller origin and a pinned billing grant.');return Object.freeze(structuredClone(input));}
export function providerUrl(value:unknown,kind:'checkout'|'portal'|'invoice') {
  if(typeof value!=='string'||value.length>4000)return fail(502,'invalid_provider_link','Stripe returned an invalid payment link.');
  const u=new URL(value),allowed=kind==='checkout'?['checkout.stripe.com']:kind==='portal'?['billing.stripe.com']:['invoice.stripe.com','pay.stripe.com'];
  if(u.protocol!=='https:'||u.username||u.password||u.port||!allowed.includes(u.hostname))return fail(502,'invalid_provider_link','Stripe returned an unapproved payment link.');return u.href;
}
export async function bounded(request:Request|Response,limit:number) {
  const reader=request.body?.getReader();if(!reader)return new Uint8Array();const parts:Uint8Array[]=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();return fail(413,'payload_too_large','The billing payload is too large.');}parts.push(value);}
  const result=new Uint8Array(size);let offset=0;for(const p of parts){result.set(p,offset);offset+=p.length;}return result;
}
export async function input(request:Request){if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return fail(415,'json_required','Send a JSON request.');try{const x:unknown=JSON.parse(new TextDecoder().decode(await bounded(request,24000)));if(isObject(x))return x;}catch(e){if(e instanceof BillingError)throw e;}return fail(400,'invalid_json','Send a valid billing request.');}
export const strict=(data:Record<string,unknown>,keys:string[])=>{if(Object.keys(data).some(k=>!keys.includes(k)))fail(400,'invalid_fields','The billing request contains unsupported fields.');};
export function mutationKey(data:Record<string,unknown>){if(typeof data.idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(data.idempotencyKey))return fail(400,'request_key_required','Send a valid request key.');return data.idempotencyKey;}
export class StripeClient {
  env:StripeBillingEnv;manifest:AdminManifest;config:Readonly<StripeBillingConfig>;
  constructor(env:StripeBillingEnv,manifest:AdminManifest,config:Readonly<StripeBillingConfig>){this.env=env;this.manifest=manifest;this.config=config;}
  get configured(){return new RegExp(`^(sk|rk)_${this.config.mode}_`).test(this.env.STRIPE_SECRET_KEY||'');}
  get liveAllowed(){return this.config.mode==='test'||this.config.allowLiveWrites===true&&this.env.BILLING_LIVE_WRITES==='1';}
  async call(path:string,method:'GET'|'POST'='GET',fields:Record<string,string|number|boolean>={},key?:string):Promise<Record<string,unknown>> {
    if(!this.configured)return fail(503,'stripe_not_configured','Configure the matching Stripe secret in this installation’s private environment.');
    if(method==='POST'&&!this.liveAllowed)return fail(403,'live_writes_disabled','Live billing actions have not been enabled for this installation.');
    if(!/^\/[a-z_]+(?:\/[A-Za-z0-9_]+){0,2}$/.test(path))return fail(400,'invalid_provider_path','Invalid Stripe operation.');
    if(method==='POST'&&!key)return fail(500,'missing_request_key','The billing operation needs a request key.');
    if(this.env.BILLING_HTTP&&!(this.env.MODE==='local'&&isLoopback(this.manifest.adminOrigin)&&this.env.BILLING_FIXTURE_MODE==='1'))return fail(503,'fixture_transport_refused','A test transport cannot run in this installation.');
    const values=new URLSearchParams(Object.entries(fields).map(([k,v])=>[k,String(v)]));
    const request=new Request(`https://api.stripe.com/v1${path}${method==='GET'&&values.size?'?'+values:''}`,{method,redirect:'manual',signal:AbortSignal.timeout(10000),headers:{authorization:`Bearer ${this.env.STRIPE_SECRET_KEY}`,'Stripe-Version':stripeApiVersion,...(key?{'Idempotency-Key':key}:{}),...(method==='POST'?{'content-type':'application/x-www-form-urlencoded'}:{})},...(method==='POST'?{body:values.toString()}:{})});
    try {
      const response=await(this.env.BILLING_HTTP?this.env.BILLING_HTTP.fetch(request):fetch(request));
      if(response.status>=300&&response.status<400)throw new BillingError(502,'provider_redirect','Stripe redirected the request.',method==='POST');
      if(!response.ok)throw new BillingError(502,response.status===429?'provider_rate_limited':'provider_rejected','Stripe could not complete this request. Check the account configuration and operation status.',method==='POST'&&response.status>=500);
      const object:unknown=JSON.parse(new TextDecoder().decode(await bounded(response,600000)));
      if(!isObject(object))throw Error();
      if(typeof object.livemode==='boolean'&&object.livemode!==(this.config.mode==='live'))return fail(502,'stripe_mode_mismatch','Stripe returned an object from a different mode.');return object;
    }catch(error){if(error instanceof BillingError)throw error;throw new BillingError(503,'provider_unavailable','Stripe is unavailable. Check this operation before retrying.',method==='POST');}
  }
  async verify(){const account=await this.call('/account');if(account.id!==this.config.accountId)return fail(503,'stripe_account_mismatch','The Stripe secret belongs to another account.');const balance=await this.call('/balance');if(balance.livemode!==(this.config.mode==='live'))return fail(503,'stripe_mode_mismatch','The Stripe account mode does not match the installation.');return account;}
}
export async function verifySignature(request:Request,secret:string) {
  const raw=await bounded(request,262144),header=request.headers.get('stripe-signature')||'';
  if(header.length>2048)return fail(400,'invalid_signature','Invalid Stripe signature.');
  const parts=header.split(',').map(p=>p.trim().split('=')),timestamp=parts.filter(p=>p[0]==='t'),signatures=parts.filter(p=>p[0]==='v1'&&/^[a-f0-9]{64}$/.test(p[1]||'')).slice(0,5);
  if(timestamp.length!==1||!/^\d+$/.test(timestamp[0][1]||'')||Math.abs(now()-Number(timestamp[0][1]))>300||!signatures.length)return fail(400,'invalid_signature','Invalid or expired Stripe signature.');
  const prefix=new TextEncoder().encode(`${timestamp[0][1]}.`),payload=new Uint8Array(prefix.length+raw.length);payload.set(prefix);payload.set(raw,prefix.length);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);let valid=false;
  for(const signature of signatures){const bytes=Uint8Array.from(signature[1].match(/../g)!,x=>parseInt(x,16));if(await crypto.subtle.verify('HMAC',key,bytes,payload))valid=true;}
  if(!valid)return fail(400,'invalid_signature','Invalid Stripe signature.');
  try{const value:unknown=JSON.parse(new TextDecoder().decode(raw));if(isObject(value))return value;}catch{}return fail(400,'invalid_event','Invalid Stripe event.');
}
