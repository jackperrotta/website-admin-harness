import {createStripeBilling, stripeApiVersion, type StripeBillingEnv} from './module.ts';
import type {AdminModule, ModuleContext} from '../worker.ts';
import {readSettings, saveSettings, billingProfiles, SettingsError, type BillingSettingsEnv, type BillingProfile, type BillingMode, type StoredBilling, type Manifest} from './settings-store.ts';
import {BillingError, now, mutationKey, strict} from './stripe.ts';
import {BillingService} from './service.ts';
import {defaultPolicies, validatePolicies, readiness, policyFingerprint, portalFields, portalMatches, profileEnv, profileConfig, billingScope, requiredBillingEvents} from './setup.ts';
import {isObject} from '../../../contracts/src/index.ts';
// Server-only helpers for installation-owned grant provisioning and encrypted backups.
export {readSettings, saveSettings, encryptSettings, billingProfiles, SettingsError} from './settings-store.ts';
export type {BillingSettingsEnv, BillingProfile, StoredBilling, Manifest, BillingMode} from './settings-store.ts';
export type {BillingPolicies, ReadinessCheck} from './setup.ts';

type Env = ModuleContext['env'] & BillingSettingsEnv & StripeBillingEnv;
const root = '/api/modules/billing';
const json = (value: unknown, status = 200) => Response.json(value, {status, headers: {'cache-control': 'no-store'}});
const fail = (error: unknown) => error instanceof SettingsError || error instanceof BillingError ? json({error: error.message}, error.status) : json({error: 'Billing settings are temporarily unavailable. Please try again shortly.'}, 503);
export async function configuredBilling(env: Env, manifest: Manifest) {
  const saved = await readSettings(env, manifest);
  if (!saved) return null;
  return {...profileBilling(env, saved.value), saved};
}
const profileBilling = (env: Env, value: BillingProfile) => ({module: createStripeBilling(profileConfig(value)), env: profileEnv(env, value) as Env});
function owner(context: ModuleContext) {
  context.require('billing:connection:manage');
  if (context.user.role !== 'owner') throw new SettingsError(403, 'Only this business’s owner can configure Stripe.');
}
async function status(env: Env, manifest: Manifest, selected?: BillingMode) {
  const saved = await readSettings(env, manifest);
  const mode = selected || saved?.value.config.mode || 'test', profiles = saved ? billingProfiles(saved.value) : {}, profile = profiles[mode];
  return {configured: !!profile, revision: saved?.row.revision || 0, accountId: profile?.config.accountId || null,
    mode, activeMode: saved?.value.config.mode || null, availableModes: Object.keys(profiles), currency: profile?.config.currency || null, prices: profile?.config.prices || [],
    portalConfigurationId: profile?.config.portalConfigurationId || '', webhookConfigured: !!profile?.webhookSecret,
    verifiedAt: profile?.verifiedAt || null, managed: true, policies: profile?.policies || defaultPolicies, policiesApplied: !!profile?.appliedPolicy && profile.appliedPolicy === await policyFingerprint(profile), activated: !!profile?.activation, liveWritesAllowed: !!profile?.activation && env.BILLING_LIVE_WRITES === '1'};
}
async function payload(request: Pick<Request, 'headers' | 'body'>, limit = 24000) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new SettingsError(415, 'Send JSON billing settings.');
  const reader = request.body?.getReader(); if (!reader) throw new SettingsError(400, 'Send valid billing settings.');
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > limit) {await reader.cancel(); throw new SettingsError(413, 'Billing request is too large.');} chunks.push(part.value);}
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
  let input; try {input = JSON.parse(new TextDecoder().decode(bytes));} catch {throw new SettingsError(400, 'Send valid billing settings.');}
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SettingsError(400, 'Send valid billing settings.');
  return {input: input as Record<string, unknown>, bytes};
}
async function body(request: Request) {return (await payload(request)).input;}
async function save(context: ModuleContext) {
  const env = context.env as Env, input = await body(context.request);
  const allowed = ['mode', 'secretKey', 'webhookSecret', 'currency', 'prices', 'portalConfigurationId', 'revision'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new SettingsError(400, 'The settings contain unsupported fields.');
  if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 0) throw new SettingsError(400, 'Reload billing settings before saving.');
  const previous = await readSettings(env, context.manifest);
  if ((previous?.row.revision || 0) !== input.revision) throw new SettingsError(409, 'Billing settings changed in another session. Reload before saving.');
  const mode = input.mode ?? previous?.value.config.mode ?? 'test';
  if (mode !== 'test' && mode !== 'live') throw new SettingsError(400, 'Choose Test or Live mode.');
  const profiles = previous ? billingProfiles(previous.value) : {}, profile = profiles[mode];
  const secretKey = input.secretKey === '' ? profile?.secretKey : input.secretKey;
  const webhookSecret = input.webhookSecret === '' ? profile?.webhookSecret || '' : input.webhookSecret;
  if (typeof secretKey !== 'string' || !new RegExp(`^(sk|rk)_${mode}_[A-Za-z0-9_]{16,250}$`).test(secretKey)) throw new SettingsError(400, `Enter an sk_${mode}_ or rk_${mode}_ key matching the selected ${mode === 'live' ? 'Live' : 'Test'} mode.`);
  if (typeof webhookSecret !== 'string' || webhookSecret && !/^whsec_[A-Za-z0-9_]{16,250}$/.test(webhookSecret)) throw new SettingsError(400, 'Enter a valid webhook signing secret or leave it blank.');
  if (typeof input.currency !== 'string' || !/^[a-z]{3}$/.test(input.currency) || !Intl.supportedValuesOf('currency').includes(input.currency.toUpperCase())) throw new SettingsError(400, 'Choose your billing currency.');
  const prices = input.prices;
  if (!Array.isArray(prices) || prices.length > 50 || prices.some(price => typeof price !== 'string' || !/^price_[A-Za-z0-9_]{1,120}$/.test(price)) || new Set(prices).size !== prices.length) throw new SettingsError(400, 'Add unique Stripe price IDs, or leave prices empty for now.');
  if (typeof input.portalConfigurationId !== 'string' || input.portalConfigurationId && !/^bpc_[A-Za-z0-9_]{1,120}$/.test(input.portalConfigurationId)) throw new SettingsError(400, 'Enter a valid customer portal configuration ID or leave it blank.');
  const request = async (path: string) => {
    if (env.BILLING_HTTP && !(env.MODE === 'local' && new URL(context.manifest.adminOrigin).hostname === '127.0.0.1' && env.BILLING_FIXTURE_MODE === '1')) throw new SettingsError(503, 'The billing connection is unavailable.');
    const request = new Request('https://api.stripe.com/v1' + path, {headers: {authorization: 'Bearer ' + secretKey, 'Stripe-Version': stripeApiVersion}, redirect: 'manual', signal: AbortSignal.timeout(10000)});
    let response; try {response = await (env.BILLING_HTTP ? env.BILLING_HTTP.fetch(request) : fetch(request));} catch {throw new SettingsError(503, 'Stripe could not be reached. Your existing settings have been preserved.');}
    if (!response.ok) throw new SettingsError(400, 'Stripe could not verify this key. Check its account and balance read permissions.');
    try {return await response.json() as Record<string, unknown>;} catch {throw new SettingsError(502, 'Stripe returned an invalid verification response.');}
  };
  const account = await request('/account'), balance = await request('/balance');
  if (typeof account.id !== 'string' || !/^acct_[A-Za-z0-9_]{1,120}$/.test(account.id) || balance.livemode !== (mode === 'live')) throw new SettingsError(400, 'Stripe did not confirm the selected account mode. Your existing settings have been preserved.');
  if (profile && profile.config.accountId !== account.id) throw new SettingsError(409, 'This key belongs to a different Stripe account for this mode. Keep the existing account or arrange an account migration.');
  if (profile && profile.config.currency !== input.currency) throw new SettingsError(409, 'Changing the billing currency requires a separate review of existing customers and prices.');
  for (const priceId of prices) {
    const price = await request('/prices/' + priceId);
    const recurring = price.recurring as {interval?: string} | null;
    if (price.id !== priceId || price.active !== true || price.livemode !== (mode === 'live') || price.currency !== input.currency || !Number.isSafeInteger(price.unit_amount) || Number(price.unit_amount) < 0 || recurring && !['month', 'year'].includes(recurring.interval || '')) throw new SettingsError(400, 'An approved price is unavailable or does not match this account’s selected mode, currency, or supported billing interval.');
  }
  if (input.portalConfigurationId) {
    const portal = await request('/billing_portal/configurations/' + input.portalConfigurationId);
    if (portal.id !== input.portalConfigurationId || portal.active === false || portal.livemode !== (mode === 'live')) throw new SettingsError(400, 'The customer portal configuration is unavailable in this Stripe account or mode.');
  }
  const value: StoredBilling = {...profile, activation: undefined, config: {accountId: account.id, mode, currency: input.currency, prices, allowLiveWrites: false,
    ...(input.portalConfigurationId ? {portalConfigurationId: input.portalConfigurationId} : {}), ...(profile?.config.grants ? {grants: profile.config.grants} : {})},
    secretKey, webhookSecret, verifiedAt: Math.floor(Date.now() / 1000)};
  value.profiles = {...profiles, [mode]: {...value}};
  createStripeBilling(value.config);
  await saveSettings(value, Number(input.revision), context.user.id, env, context.manifest);
  if(profile?.webhookSecret!==webhookSecret)await env.DB.prepare('UPDATE billing_setup_health SET webhook_at=0 WHERE scope=?').bind(billingScope(context.manifest,value)).run();
  const scope = JSON.stringify([context.manifest.installationId, context.manifest.site.id, account.id, mode]);
  await env.DB.prepare('INSERT INTO billing_connections(scope,verified_at) VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET verified_at=excluded.verified_at').bind(scope, value.verifiedAt).run();
  await context.audit(`Updated Stripe ${mode} account settings`);
  return json({ok: true, ...(await status(env, context.manifest))});
}

async function setupAction(context: ModuleContext, path: string) {
  const env=context.env as Env, data=await body(context.request), saved=await readSettings(env,context.manifest);
  if(!saved||!Number.isSafeInteger(data.revision)||saved.row.revision!==data.revision)throw new SettingsError(409,'Reload the saved connection before making this change.');
  const mode=data.mode;
  if(mode!=='test'&&mode!=='live')throw new SettingsError(400,'Choose Test or Live mode.');
  const profile=billingProfiles(saved.value)[mode];if(!profile)throw new SettingsError(409,'Connect this mode first.');
  const next=structuredClone(profile);
  const service=new BillingService(profileEnv(env,profile),context.manifest,profile.config);
  await service.limit('setup:'+context.user.id,20);
  let action='', result:unknown;
  if(path==='/settings/webhook'){
    strict(data,['mode','revision','reviewed','idempotencyKey']);
    if(data.reviewed!==true||!profile.webhookSecret)throw new SettingsError(400,'Save this endpoint’s signing secret and review its setup first.');
    const hooks=await service.stripe.call('/webhook_endpoints','GET',{limit:100});
    const matches=Array.isArray(hooks.data)?hooks.data.filter(h=>isObject(h)&&h.url===context.manifest.adminOrigin+'/api/modules/billing/hooks/stripe'&&h.livemode===(mode==='live')):[];
    if(matches.length!==1||hooks.has_more!==false)throw new SettingsError(409,'Create or select a single webhook for this exact admin origin in Stripe before preparing it.');
    const hook=matches[0] as Record<string,unknown>;
    if(hook.api_version!==stripeApiVersion||typeof hook.id!=='string'||!/^we_[\w]+$/.test(hook.id)||!Array.isArray(hook.enabled_events))throw new SettingsError(409,'The existing webhook must use snapshot events at API version '+stripeApiVersion+'.');
    const events=hook.enabled_events.includes('*')?['*']:[...new Set([...hook.enabled_events.map(String),...requiredBillingEvents])].sort();
    const fields:Record<string,string|boolean>={disabled:false};events.forEach((event,i)=>fields[`enabled_events[${i}]`]=event);
    const setup=new BillingService({...profileEnv(env,profile),BILLING_LIVE_WRITES:'1'},context.manifest,{...profile.config,allowLiveWrites:true});
    result=await setup.operation('setup.webhook',mutationKey(data),{id:hook.id,events,revision:data.revision},async op=>{const updated=await op.step('webhook','/webhook_endpoints/'+hook.id,fields,'/webhook_endpoints/'+hook.id);return {id:updated.id};});
    next.activation=undefined;action='Prepared installation webhook events; activation cleared';
  }else if(path==='/settings/policies'){
    strict(data,['mode','revision','policies']);next.policies=validatePolicies(data.policies);next.activation=undefined;
    action='Saved billing policies; activation cleared';
  }else if(path==='/settings/portal'){
    strict(data,['mode','revision','reviewed','idempotencyKey']);if(data.reviewed!==true)throw new SettingsError(400,'Review the saved policies before applying them.');
    if(!profile.policies)throw new SettingsError(409,'Save your billing policies first.');
    // This narrowly scoped setup service may only create an immutable, installation-specific
    // portal configuration. It cannot receive arbitrary paths or financial operations.
    const setup=new BillingService({...profileEnv(env,profile),BILLING_LIVE_WRITES:'1'},context.manifest,{...profile.config,allowLiveWrites:true});
    const fields=await portalFields(env,context.manifest,profile);
    const fingerprint=await policyFingerprint(profile);
    result=await setup.operation('setup.portal',mutationKey(data),{fingerprint,revision:data.revision},async op=>{const portal=await op.step('configuration','/billing_portal/configurations',fields);if(typeof portal.id!=='string'||!/^bpc_[\w]+$/.test(portal.id)||portal.livemode!==(mode==='live'))throw new SettingsError(502,'Stripe returned an incompatible portal configuration.');return {id:portal.id};});
    next.config.portalConfigurationId=(result as {id:string}).id;next.appliedPolicy=fingerprint;next.activation=undefined;
    action='Applied billing portal policies; activation cleared';
  }else if(path==='/settings/plan'){
    strict(data,['mode','revision','name','amount','interval','reviewed','idempotencyKey']);
    if(data.reviewed!==true||typeof data.name!=='string'||!data.name.trim()||data.name.length>150||!Number.isSafeInteger(data.amount)||Number(data.amount)<1||Number(data.amount)>99999999||!['month','year','once'].includes(String(data.interval)))throw new SettingsError(400,'Review a plan name, positive amount in minor currency units, and billing interval.');
    if(profile.config.prices.length>=50)throw new SettingsError(400,'This catalog already has 50 prices.');
    const setup=new BillingService({...profileEnv(env,profile),BILLING_LIVE_WRITES:'1'},context.manifest,{...profile.config,allowLiveWrites:true});
    const fields:Record<string,string|number|boolean>={currency:profile.config.currency,unit_amount:Number(data.amount),'product_data[name]':data.name.trim(),'metadata[installation_id]':context.manifest.installationId,'metadata[site_id]':context.manifest.site.id,...(data.interval==='once'?{}:{'recurring[interval]':String(data.interval)})};
    result=await setup.operation('setup.price',mutationKey(data),{fields,revision:data.revision},async op=>{const price=await op.step('price','/prices',fields);if(typeof price.id!=='string'||!/^price_[\w]+$/.test(price.id)||price.livemode!==(mode==='live')||price.unit_amount!==data.amount||price.currency!==profile.config.currency)throw new SettingsError(502,'Stripe returned an incompatible price.');return {id:price.id};});
    next.config.prices=[...next.config.prices,(result as {id:string}).id];next.activation=undefined;
    action='Created and approved billing price; activation cleared';
  }else if(path==='/settings/activation'){
    strict(data,['mode','revision','enabled','confirmation']);if(typeof data.enabled!=='boolean')throw new SettingsError(400,'Choose an activation state.');
    if(data.enabled){
      if(mode!=='live'||data.confirmation!=='ENABLE LIVE BILLING')throw new SettingsError(400,'Type ENABLE LIVE BILLING to confirm activation of this live account.');
      const review=await readiness(env,context.manifest,profile);if(!review.ready)return json({error:'Complete the readiness checks before enabling live billing.',...review},409);
      next.activation={at:now(),actor:context.user.id};
    }else next.activation=undefined;
    action=data.enabled?'Owner enabled live billing':'Owner disabled new live billing actions';
  }else throw new SettingsError(404,'Billing setup action not found.');
  // CAS protects concurrent saves and activation. Other profiles and existing grants survive.
  const profiles={...billingProfiles(saved.value),[mode]:next}, active=profiles[saved.value.config.mode]!;
  await saveSettings({...active,profiles},saved.row.revision,context.user.id,env,context.manifest);
  await context.audit(action);
  return json({ok:true,result,...await status(env,context.manifest,mode)});
}

export function createManagedStripeBilling(): AdminModule {return {
  id: 'billing', version: 2, label: 'Billing', permission: 'billing:read', ui: 'stripe-billing', disableLocalDemo: true,
  description: 'Owner-managed Stripe connection, plans, policies and activation.',
  hooks: ['/api/modules/billing/hooks/stripe', '/api/modules/billing/hooks/account'].map(path => ({path, async handle(context) {
    try {
      const saved = await readSettings(context.env as Env, context.manifest); if (!saved) return json({error: 'Stripe has not been connected.'}, 503);
      const profiles = billingProfiles(saved.value);
      let selected: BillingProfile | undefined;let authenticatedGrant=false;
      let request = context.request;
      if (path.endsWith('/stripe')) {
        const {input: event, bytes} = await payload(context.request, 262144);
        request = new Request(context.request, {body: bytes});
        if (typeof event.livemode !== 'boolean') throw new SettingsError(400, 'Stripe event mode is missing.');
        selected = profiles[event.livemode ? 'live' : 'test'];
      } else {
        const token = context.request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/)?.[1];
        const grantId = context.request.headers.get('x-billing-grant');
        const digest = token ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), b => b.toString(16).padStart(2, '0')).join('') : null;
        const matching = digest && grantId ? Object.values(profiles).filter(profile => profile.config.grants?.some(grant => grant.enabled && grant.id === grantId && grant.tokenHash === digest)) : [];
        if (matching.length > 1) return json({error: 'Billing connection was not authorized.'}, 401);
        // Keep the published handler's normal authentication rejection and rate limit.
        selected = matching[0] || saved.value;authenticatedGrant=matching.length===1;
      }
      if (!selected) return json({error: 'Stripe is not configured for this event mode.'}, 400);
      if(path.endsWith('/account') && authenticatedGrant) {
        const {input:data}=await payload(request.clone());
        if(data.action==='portal' && selected.policies && !await portalMatches(context.env as Env,context.manifest,selected))throw new SettingsError(409,'The provider must reapply its saved billing policies before opening the portal.');
      }
      const active = profileBilling(context.env as Env, selected);
      const response = await active.module.hooks!.find(hook => hook.path === path)!.handle({...context, request, env: active.env});
      if (path.endsWith('/stripe') && response.ok) await context.env.DB.prepare('INSERT INTO billing_setup_health(scope,webhook_at) VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET webhook_at=excluded.webhook_at').bind(billingScope(context.manifest,selected),now()).run();
      return response;
    } catch (error) {return fail(error);}
  }})),
  async scheduled(env, manifest) {
    const saved = await readSettings(env as Env, manifest); if (!saved) return;
    const results = await Promise.allSettled(Object.values(billingProfiles(saved.value)).map(profile => {return new BillingService(profileEnv(env as Env,profile),manifest,profile.config).tick().then(async()=>{await (env as Env).DB.prepare('INSERT INTO billing_setup_health(scope,scheduled_at) VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET scheduled_at=excluded.scheduled_at').bind(billingScope(manifest,profile),now()).run();});}));
    if (results.some(result => result.status === 'rejected')) throw new SettingsError(503, 'A billing profile could not be reconciled.');
  },
  async handle(context) {
    try {
      const path = new URL(context.request.url).pathname.slice(root.length);
      if (path.startsWith('/settings')) {
        owner(context);
        if (context.request.method === 'GET') {
          const mode = new URL(context.request.url).searchParams.get('mode');
          if (mode !== null && mode !== 'test' && mode !== 'live') throw new SettingsError(400, 'Choose Test or Live mode.');
          if(path === '/settings/readiness'){const saved=await readSettings(context.env as Env,context.manifest);const profile=saved && billingProfiles(saved.value)[mode || saved.value.config.mode];if(!profile)throw new SettingsError(409,'Connect this mode first.');return json(await readiness(context.env as Env,context.manifest,profile));}
          if(path==='/settings')return Response.redirect(context.manifest.adminOrigin+'/?billing=setup#billing',303);
          return json(await status(context.env as Env, context.manifest, mode || undefined));
        }
        if (context.request.method === 'POST') {if(path === '/settings')return await save(context);return await setupAction(context,path);}
        return json({error: 'Method not allowed'}, 405);
      }
      const active = await configuredBilling(context.env as Env, context.manifest);
      if (!active) return json({error: 'Connect your Stripe account in Billing settings.', managed: true}, 409);
      if(context.request.method==='POST' && path.endsWith('/portal') && active.saved.value.policies && !await portalMatches(context.env as Env,context.manifest,active.saved.value))throw new SettingsError(409,'Reapply the saved billing policies before opening the portal.');
      const response=await active.module.handle({...context, env: active.env});
      if(context.request.method==='GET' && (path===''||path==='/')){const view=await response.json() as Record<string,unknown>;return json({...view,managed:true,invoiceDueDays:active.saved.value.policies?.invoiceDueDays||14},response.status);}
      return response;
    } catch (error) {return fail(error);}
  },
};}
