import {StripeProtocol,stripeFixture,fixtureSecret} from './stripe-fixture.ts';
import {stripeApiVersion} from '../packages/admin/src/billing/stripe.ts';
import {requiredBillingEvents,defaultPolicies} from '../packages/admin/src/billing/setup.ts';
export class SetupProtocol extends StripeProtocol {
  origin='';
  hookEvents=[...requiredBillingEvents];
  async fetch(request:Parameters<StripeProtocol['fetch']>[0]):Promise<Response>{
    const path=new URL(request.url).pathname.slice(3);
    if(request.method==='GET'&&path.startsWith('/billing_portal/configurations/bpc_created')){
      const value=structuredClone(this.objects.get(path.split('/').at(-1)!));
      if(!value)return Response.json({},{status:404});
      // Stripe omits the approved products unless explicitly expanded.
      if(new URL(request.url).searchParams.get('expand[]')!=='features.subscription_update.products')delete value.features.subscription_update.products;
      return Response.json(value);
    }
    if(request.method==='GET'&&path==='/webhook_endpoints')return Response.json({data:[{id:'we_fixture',url:this.origin+'/api/modules/billing/hooks/stripe',status:'enabled',api_version:stripeApiVersion,livemode:this.live,enabled_events:this.hookEvents}],has_more:false});
    if(request.method==='POST'&&path==='/webhook_endpoints/we_fixture'){
      const data=Object.fromEntries(new URLSearchParams(await request.text()));this.calls.push({method:'POST',path,data});this.hookEvents=Object.entries(data).filter(([k])=>k.startsWith('enabled_events')).map(([,v])=>v);return Response.json({id:'we_fixture',livemode:this.live,enabled_events:this.hookEvents,status:'enabled'});
    }
    if(request.method==='POST'&&['/prices','/billing_portal/configurations'].includes(path)){
      const raw=await request.text(),params=new URLSearchParams(raw),data=Object.fromEntries(params),key=request.headers.get('idempotency-key')!;
      this.calls.push({method:'POST',path,data});const receipt=this.receipts.get(key);if(receipt)return receipt.body===raw?Response.json(receipt.value):Response.json({},{status:409});
      let value:Record<string,any>;
      if(path==='/prices')value={id:'price_created'+(++this.counter),object:'price',active:true,livemode:this.live,unit_amount:Number(params.get('unit_amount')),currency:params.get('currency'),recurring:params.has('recurring[interval]')?{interval:params.get('recurring[interval]'),interval_count:1}:null,product:{id:'prod_created'+this.counter,name:params.get('product_data[name]')}};
      else {value={id:'bpc_created'+(++this.counter),object:'billing_portal.configuration',active:true,livemode:this.live};for(const [field,v] of params){const parts=field.replaceAll(']','').split('[');let target=value;for(let i=0;i<parts.length-1;i++)target=target[parts[i]]??=(/^\d+$/.test(parts[i+1])?[]:{});target[parts.at(-1)!]=v==='true'?true:v==='false'?false:v;}}
      this.objects.set(value.id,value);this.receipts.set(key,{body:raw,value:structuredClone(value)});
      if(this.dropAfter===path){this.dropAfter=null;return new Response('lost response');}return Response.json(value);
    }
    return super.fetch(request);
  }
}
export const acceptedPolicies={...defaultPolicies,allowPlanChanges:true,allowCancellation:true,retryReview:'Reviewed configured Stripe retries and final unpaid state.',emailReview:'Reviewed invoice, receipt and payment failure emails in Stripe.',taxReview:'Reviewed tax treatment for these services and customers.',sandboxReviewed:true};
export async function setupFixture(options:Parameters<typeof stripeFixture>[0]={}){
  const protocol=new SetupProtocol();if(options.config?.mode==='live'){protocol.live=true;for(const v of protocol.objects.values())v.livemode=true;}
  const f=await stripeFixture({...options,managed:true,protocol});protocol.origin=f.origin;
  const status=async(mode?:string)=>await(await f.request('/settings/status'+(mode?'?mode='+mode:''))).json() as any;
  const save=async(mode=protocol.live?'live':'test',extra:Record<string,unknown>={})=>f.request('/settings',{mode,revision:(await status()).revision,secretKey:'sk_'+mode+'_fixture_not_a_real_key',webhookSecret:fixtureSecret,currency:'usd',prices:['price_monthly','price_once'],portalConfigurationId:'',...extra});
  const action=async(path:string,data:Record<string,unknown>)=>f.request('/settings/'+path,{mode:protocol.live?'live':'test',revision:(await status()).revision,...data});
  const prepare=async()=>{
    for(const r of [await save(),await action('policies',{policies:acceptedPolicies}),await action('portal',{reviewed:true,idempotencyKey:'fixture-portal-apply'})])if(r.status!==200)throw Error(await r.text());
    await f.tick();await f.webhook(protocol.event({id:'in_unknown',object:'invoice',customer:'cus_unlinked',livemode:protocol.live},'evt_delivery','invoice.created'));
  };
  return {...f,protocol,status,save,action,prepare};
}
