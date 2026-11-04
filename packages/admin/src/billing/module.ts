import type {AdminModule,ModuleContext,ModuleServiceContext} from '../worker.ts';
import {isObject,isLoopback} from '../../../contracts/src/index.ts';
import type {StripeBillingConfig,BillingAccountConfig,StripeBillingView} from '../../../contracts/src/stripe-billing.ts';
import {BillingService} from './service.ts';
import {configuration,accountConfiguration,BillingError,fail,id,now,digest,input,strict,mutationKey,bounded,providerUrl,type StripeBillingEnv} from './stripe.ts';
export {stripeApiVersion} from './stripe.ts';
export type {StripeBillingConfig,BillingAccountConfig,StripeBillingView} from '../../../contracts/src/stripe-billing.ts';
export type {StripeBillingEnv} from './stripe.ts';

function errorResponse(error:unknown){if(error instanceof BillingError)return Response.json({error:error.message,code:error.code,uncertain:error.uncertain},{status:error.status});return Response.json({error:'Billing storage is unavailable. Verify the optional billing migration and installation bindings.',code:'billing_unavailable'},{status:503});}
const handled=async(fn:()=>Promise<Response>)=>{try{return await fn();}catch(error){return errorResponse(error);}};
const confirm=(data:Record<string,unknown>)=>{if(data.reviewed!==true)fail(400,'review_required','Review and confirm this billing action first.');};
const localId=(value:unknown)=>typeof value==='string'&&/^[\w-]{1,100}$/.test(value);
const int=(x:unknown,min:number,max:number)=>Number.isSafeInteger(x)&&Number(x)>=min&&Number(x)<=max;

/** Trusted optional module. All business choices belong to the installation. */
export function createStripeBilling(inputConfig:StripeBillingConfig):AdminModule {
  const config=configuration(inputConfig);
  const service=(context:{env:unknown;manifest:ModuleContext['manifest']})=>new BillingService(context.env as StripeBillingEnv,context.manifest,config);
  const hook=(path:string,run:(s:BillingService,c:ModuleServiceContext)=>Promise<unknown>)=>({path,handle:(context:ModuleServiceContext)=>handled(async()=>Response.json(await run(service(context),context)))});
  return {id:'billing',version:1,label:'Billing',permission:'billing:read',description:'Optional billing through this business’s own Stripe account.',ui:'stripe-billing',disableLocalDemo:true,
    hooks:[hook('/api/modules/billing/hooks/stripe',async(s,c)=>{const receipt=await s.receive(c.request);c.context?.waitUntil(s.tick().catch(()=>{}));return receipt;}),hook('/api/modules/billing/hooks/account',async(s,c)=>{
      await s.limit('account-endpoint',120);
      const grantId=c.request.headers.get('x-billing-grant')||'',token=c.request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/)?.[1];
      const grant=config.grants?.find(g=>g.enabled&&g.id===grantId);
      if(!grant||!token)return fail(401,'billing_grant_rejected','The billing connection was rejected.');
      const actual=await digest(token);let difference=0;for(let i=0;i<64;i++)difference|=actual.charCodeAt(i)^grant.tokenHash.charCodeAt(i);if(difference)return fail(401,'billing_grant_rejected','The billing connection was rejected.');
      await s.limit(`grant:${grantId}`,30);
      const data=await input(c.request);strict(data,['action','installationId','siteId','adminOrigin','invoiceId','kind']);
      if(data.installationId!==grant.installationId||data.siteId!==grant.siteId||data.adminOrigin!==grant.adminOrigin)return fail(403,'installation_mismatch','The billing connection identity does not match.');
      const view=await s.view(grant.customerId);
      if(data.action==='read')return view;
      if(data.action==='portal'){if(!grant.manage)return fail(403,'billing_manage_denied','This connection is read-only.');return s.portal(grant.customerId,grant.adminOrigin);}
      if(data.action==='invoice-link'&&id(data.invoiceId,'in')&&['pay','pdf'].includes(String(data.kind)))return s.invoiceLink(String(data.invoiceId),data.kind as 'pay'|'pdf',grant.customerId);
      return fail(400,'unsupported_action','This customer billing action is not supported.');
    })],
    scheduled:async(env,manifest)=>{try{await new BillingService(env as StripeBillingEnv,manifest,config).tick();}catch{/* Pending work stays durable; status and manual sync expose failures. */}},
    handle:context=>handled(async()=>{
      const s=service(context),path=new URL(context.request.url).pathname.slice('/api/modules/billing'.length),method=context.request.method;
      if(method==='GET'&&(path===''||path==='/'))return Response.json(await s.view());
      if(method!=='POST')return Response.json({error:'Not found'},{status:404});
      const data=await input(context.request);await s.limit(`user:${context.user.id}`,60);
      let result:unknown,action='';
      if(path==='/connection/verify'){context.require('billing:connection:manage');strict(data,[]);await s.verify();result={verified:true};action='Verified Stripe connection';}
      else if(path==='/customers'){
        context.require('billing:customers:write');strict(data,['name','email','idempotencyKey']);
        if(typeof data.name!=='string'||!data.name.trim()||data.name.length>150||typeof data.email!=='string'||data.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))return fail(400,'invalid_customer','Add a customer name and valid billing email.');
        result=await s.createCustomer({name:data.name.trim(),email:data.email.trim().toLowerCase()},mutationKey(data));action='Created Stripe billing customer';
      }else if(path==='/customers/link'){
        context.require('billing:customers:write');strict(data,['stripeCustomerId','reviewed','idempotencyKey']);confirm(data);if(!id(data.stripeCustomerId,'cus'))return fail(400,'invalid_customer','Choose an existing Stripe customer ID.');result=await s.linkCustomer(String(data.stripeCustomerId),mutationKey(data));action='Linked existing Stripe customer';
      }else if(path==='/drafts'){
        context.require('billing:invoices:write');strict(data,['id','customerId','description','lines','dueDays','revision','idempotencyKey']);
        if(!localId(data.customerId)||data.id!==undefined&&!localId(data.id)||typeof data.description!=='string'||!data.description.trim()||data.description.length>200||!int(data.revision,0,1000000)||!int(data.dueDays,1,90)||!Array.isArray(data.lines)||!data.lines.length||data.lines.length>20)return fail(400,'invalid_invoice','Add a valid customer, invoice description, due period and invoice lines.');
        const lines=data.lines.map((line:unknown)=>{if(!isObject(line))return fail(400,'invalid_invoice_line','Invalid invoice line.');strict(line,['description','quantity','unitAmount']);if(typeof line.description!=='string'||!line.description.trim()||line.description.length>200||!int(line.quantity,1,1000)||!int(line.unitAmount,1,100000000))return fail(400,'invalid_invoice_line','Invoice lines require a description, whole quantity and positive amount.');return {description:line.description.trim(),quantity:Number(line.quantity),unitAmount:Number(line.unitAmount)};});
        if(lines.reduce((n,l)=>n+l.quantity*l.unitAmount,0)>99999999)return fail(400,'invoice_too_large','The invoice exceeds this integration’s supported amount.');
        result=await s.saveDraft({id:data.id as string|undefined,customerId:String(data.customerId),description:data.description.trim(),lines,dueDays:Number(data.dueDays),revision:Number(data.revision)},mutationKey(data));action='Saved billing invoice draft';
      }else if(/^\/drafts\/[\w-]+\/issue$/.test(path)){
        context.require('billing:invoices:write');strict(data,['revision','reviewed','idempotencyKey']);confirm(data);if(!int(data.revision,0,1000000))return fail(400,'invalid_revision','Review the current draft.');result=await s.issue(path.split('/')[2],Number(data.revision),mutationKey(data));action='Finalized Stripe invoice';
      }else if(/^\/invoices\/in_[A-Za-z0-9]+\/send$/.test(path)){
        context.require('billing:collect');strict(data,['reviewed','idempotencyKey']);confirm(data);result=await s.sendInvoice(path.split('/')[2],mutationKey(data));action='Sent Stripe invoice';
      }else if(/^\/customers\/[\w-]+\/checkout$/.test(path)){
        context.require('billing:subscriptions:write');strict(data,['priceId','reviewed','idempotencyKey']);confirm(data);if(typeof data.priceId!=='string'||!config.prices.includes(data.priceId))return fail(400,'price_not_approved','Choose an approved price.');result=await s.checkout(path.split('/')[2],data.priceId,mutationKey(data));action='Created hosted Stripe checkout';
      }else if(/^\/customers\/[\w-]+\/portal$/.test(path)){
        context.require('billing:subscriptions:write');strict(data,[]);result=await s.portal(path.split('/')[2],context.manifest.adminOrigin);action='Opened customer billing management';
      }else if(/^\/invoices\/in_[A-Za-z0-9]+\/link$/.test(path)){
        strict(data,['kind']);if(!['pay','pdf'].includes(String(data.kind)))return fail(400,'invalid_document','Choose a payment page or invoice document.');result=await s.invoiceLink(path.split('/')[2],data.kind as 'pay'|'pdf');
      }else if(/^\/subscriptions\/sub_[A-Za-z0-9]+\/cancellation$/.test(path)){
        context.require('billing:subscriptions:write');strict(data,['cancel','reviewed','idempotencyKey']);confirm(data);if(typeof data.cancel!=='boolean')return fail(400,'invalid_cancellation','Choose a cancellation state.');result=await s.cancelSubscription(path.split('/')[2],data.cancel,mutationKey(data));action='Updated subscription cancellation';
      }else if(/^\/customers\/[\w-]+\/sync$/.test(path)){
        context.require('billing:connection:manage');strict(data,[]);await s.ready();await s.queueSync(path.split('/')[2]);await s.tick();result={queued:true};action='Reconciled customer billing records';
      }else if(path==='/sync'){
        context.require('billing:connection:manage');strict(data,[]);await s.ready();await s.sql("UPDATE billing_inbox SET state='retry',next_attempt=0 WHERE scope=? AND state='failed'").run();await s.tick();result={synced:true};action='Retried Stripe synchronization';
      }else return fail(404,'not_found','Billing action not found.');
      if(action)await context.audit(action);return Response.json({ok:true,result});
    })};
}

/** A separate installation uses a revocable grant, never the seller’s Stripe key. */
export function createBillingAccount(inputConfig:BillingAccountConfig):AdminModule {
  const config=accountConfiguration(inputConfig);
  return {id:'account-billing',version:1,label:'Your billing',permission:'account-billing:read',description:'This business’s billing account with its configured service provider.',ui:'stripe-account',disableLocalDemo:true,
    handle:context=>handled(async()=>{
      const env=context.env as StripeBillingEnv,path=new URL(context.request.url).pathname.slice('/api/modules/account-billing'.length),read=context.request.method==='GET'&&(path===''||path==='/');
      if(!read&&context.request.method!=='POST')return fail(404,'not_found','Billing action not found.');
      const token=env.BILLING_ACCOUNT_TOKEN;if(!token||!/^[A-Za-z0-9_-]{32,200}$/.test(token))return fail(503,'billing_not_paired','This admin’s billing connection is not configured.');
      if(isLoopback(config.sellerOrigin)&&!(env.MODE==='local'&&isLoopback(context.manifest.adminOrigin)))return fail(503,'invalid_seller_origin','Local billing connections require an isolated local installation.');
      if(env.BILLING_ACCOUNT_HTTP&&!(env.MODE==='local'&&isLoopback(context.manifest.adminOrigin)&&env.BILLING_FIXTURE_MODE==='1'))return fail(503,'fixture_transport_refused','A test billing transport cannot run here.');
      let action='read',extra:Record<string,unknown>={};
      if(!read){const data=await input(context.request);if(path==='/portal'){context.require('account-billing:manage');strict(data,[]);action='portal';}else if(path==='/invoice-link'){strict(data,['invoiceId','kind']);if(!id(data.invoiceId,'in')||!['pay','pdf'].includes(String(data.kind)))return fail(400,'invalid_invoice','Choose a valid invoice.');action='invoice-link';extra=data;}else return fail(404,'not_found','Billing action not found.');}
      const request=new Request(`${config.sellerOrigin}/api/modules/billing/hooks/account`,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(12000),headers:{authorization:`Bearer ${token}`,'x-billing-grant':config.grantId,'content-type':'application/json'},body:JSON.stringify({action,installationId:context.manifest.installationId,siteId:context.manifest.site.id,adminOrigin:context.manifest.adminOrigin,...extra})});
      let response:Response;try{response=await(env.BILLING_ACCOUNT_HTTP?env.BILLING_ACCOUNT_HTTP.fetch(request):fetch(request));}catch{return fail(503,'seller_unavailable','Your billing provider is unavailable. Try again shortly.');}
      if(response.status>=300&&response.status<400)return fail(503,'seller_redirect_refused','The billing provider returned an unexpected redirect.');
      const value:unknown=JSON.parse(new TextDecoder().decode(await bounded(response,700000)));
      if(!response.ok)return fail([401,403,404].includes(response.status)?403:503,'seller_request_rejected','Your billing provider could not authorize or complete this request.');
      if(action==='read'){
        if(!isObject(value)||value.provider!=='stripe'||value.simulated!==false||value.audience!=='customer'||value.installationId!==config.sellerInstallationId||value.siteId!==config.sellerSiteId||value.mode!==config.mode||!Array.isArray(value.customers)||value.customers.length!==1||!isObject(value.customers[0])||value.customers[0].id!==config.customerId||!Array.isArray(value.records)||value.records.some(r=>!isObject(r)||r.customerId!==config.customerId))return fail(503,'billing_identity_mismatch','Your billing provider’s account identity could not be verified.');
        return Response.json(value as unknown as StripeBillingView);
      }
      if(!isObject(value))return fail(503,'invalid_billing_response','Your billing provider returned an invalid response.');return Response.json({url:providerUrl(value.url,action==='portal'?'portal':'invoice')});
    })};
}
