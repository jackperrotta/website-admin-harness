import {CustomerManagement} from './management.ts';
import {NotificationService} from './notifications.ts';
import {availability, minute} from './availability.ts';
import {SchedulingEngine} from './engine.ts';
import {SchedulingError} from './errors.ts';
import {CalendarService} from './calendars/service.ts';
import {CalendarError} from './calendars/types.ts';
import {digest} from './calendars/crypto.ts';
import {calendarAttachment} from './calendars/ics.ts';
import {isLoopback, type AdminManifest} from '../../../contracts/src/index.ts';
import {parseSchedulingConfig, parsePublicAvailability, parsePublicBooking, SchedulingValidationError, type PublicBookingCatalog, type PublicBookingReceipt, type PublicBookingRequest, type SchedulingAppointment} from '../../../contracts/src/scheduling.ts';
import type {AdminEnv} from '../worker.ts';
import type {SchedulingConfig, CalendarConnectionsResponse, BookingReadiness} from '../../../contracts/src/scheduling.ts';
const json = (value: unknown, status = 200) => Response.json(value,{status});
export class PublicBooking {
 private calendars: CalendarService; private engine: SchedulingEngine;
 constructor(private env: AdminEnv, private manifest: AdminManifest) {this.calendars=new CalendarService(env,manifest);this.engine=new SchedulingEngine(env.DB,manifest.site.id,this.calendars);}
 private get site(){return this.manifest.site.id;}
 private get local(){return this.env.MODE==='local' && this.env.BOOKING_LOCAL_TEST==='1' && isLoopback(this.manifest.adminOrigin) && isLoopback(this.manifest.site.origin);}
 async readiness(config: SchedulingConfig, calendars: CalendarConnectionsResponse): Promise<BookingReadiness> {
  const tables = (await this.env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('scheduling_state','scheduling_appointments','scheduling_reservations','booking_commands','booking_history','booking_rate_limits','calendar_connections')").all<{name:string}>()).results;
  const challenge = this.local || !!(this.env.BOOKING_RATE_SECRET && this.env.BOOKING_RATE_SECRET.length >= 32 && this.env.BOOKING_TURNSTILE_SITE_KEY && this.env.BOOKING_TURNSTILE_SECRET && !/^[123]x/.test(this.env.BOOKING_TURNSTILE_SITE_KEY) && !/^[123]x/.test(this.env.BOOKING_TURNSTILE_SECRET));
  const services = config.services.filter(s => s.active && config.publicBooking?.serviceIds.includes(s.id) && s.locationMode !== 'customer' && s.locationIds.some(id => config.locations.some(l => l.id === id && l.active)) && s.providerIds.some(id => config.resources.some(r => r.id === id && r.active && r.kind === 'provider')));
  const affected = calendars.connections.filter(c => c.enabled && services.some(s => s.providerIds.includes(c.resourceId)));
  const checks = [
   {id:'module',ready:this.manifest.modules.includes('scheduling'),detail:'Scheduling module enabled'},
   {id:'schema',ready:tables.length===7 && calendars.schemaReady,detail:'Local database requires migrations through 0006'},
   {id:'server',ready:this.env.BOOKING_ENABLED==='1',detail:'Server booking flag BOOKING_ENABLED'},
   {id:'challenge',ready:challenge,detail:this.local?'Isolated loopback challenge fixture':'Turnstile and rate-limit settings configured; real challenge acceptance still required'},
   {id:'publication',ready:config.mode==='test' && !!config.publicBooking?.enabled && services.length>0 && !!config.publicBooking.policyText.trim(),detail:`${services.length} published services; customer policy and Test mode required`},
   {id:'calendars',ready:affected.every(c=>c.health==='healthy' && c.pendingJobs===0),detail:affected.length?`${affected.length} enabled provider calendars checked`:'No required calendars connected; availability uses native reservations'},
  ];
  return {ready:checks.every(c=>c.ready),mode:config.mode,simulated:this.local || calendars.simulated,checks,siteOrigin:this.manifest.site.origin,connection:{version:1,enabled:true,apiOrigin:this.manifest.adminOrigin,siteId:this.site,installationId:this.manifest.installationId,route:'/book'}};
 }
 private setup(){
  if(!this.manifest.modules.includes('scheduling') || this.env.BOOKING_ENABLED!=='1') throw new SchedulingError(403,'booking_disabled','Online booking has not been enabled. Please contact the business.');
  if(!this.local && (!this.env.BOOKING_RATE_SECRET || this.env.BOOKING_RATE_SECRET.length<32 || !this.env.BOOKING_TURNSTILE_SITE_KEY || !this.env.BOOKING_TURNSTILE_SECRET || /^[123]x/.test(this.env.BOOKING_TURNSTILE_SITE_KEY) || /^[123]x/.test(this.env.BOOKING_TURNSTILE_SECRET))) throw new SchedulingError(503,'booking_setup_required','Online booking needs setup. Please contact the business.');
 }
 private async state(){
  const row=await this.env.DB.prepare('SELECT revision,config_json FROM scheduling_state WHERE site_id=?').bind(this.site).first<{revision:number;config_json:string}>();
  if(!row) throw new SchedulingError(503,'booking_unavailable','Online booking is not available. Please contact the business.');
  return {revision:row.revision,config:parseSchedulingConfig(JSON.parse(row.config_json))};
 }
 private published(state:Awaited<ReturnType<PublicBooking['state']>>){
  const {config}=state, settings=config.publicBooking;
  if(config.mode!=='test' || !settings?.enabled) throw new SchedulingError(503,'booking_paused','Online booking is paused. Please contact the business.');
  const services=config.services.filter(s=>s.active && settings.serviceIds.includes(s.id) && s.locationMode!=='customer');
  return {...config, services};
 }
 private async rate(request:Request,kind:string,limit:number,seconds:number){
  const ip=request.headers.get('cf-connecting-ip') || (this.local?'isolated-loopback':null);
  if(!ip) throw new SchedulingError(503,'booking_unavailable','Online booking cannot verify this request. Please try again later.');
  const secret=this.env.BOOKING_RATE_SECRET || (this.local?'isolated-local-fixture':'');
  await this.env.DB.prepare('DELETE FROM booking_rate_limits WHERE expires_at<?').bind(Date.now()).run();
  const key=await digest(`${secret}|${this.site}|${ip}|${kind}`),bucket=Math.floor(Date.now()/(seconds*1000));
  const result=await this.env.DB.prepare('INSERT INTO booking_rate_limits(site_id,key_hash,bucket,count,expires_at) VALUES(?,?,?,1,?) ON CONFLICT(site_id,key_hash,bucket) DO UPDATE SET count=count+1 RETURNING count').bind(this.site,key,bucket,(bucket+2)*seconds*1000).first<{count:number}>();
  if(!result || result.count>limit) throw new SchedulingError(429,'booking_rate_limit','Too many requests. Please wait before trying again.');
 }
 async catalog(request:Request):Promise<PublicBookingCatalog>{
  await this.rate(request,'catalog',60,60);const state=await this.state(), config=this.published(state);
  const locations=config.locations.filter(l=>l.active && config.services.some(s=>s.locationIds.includes(l.id)));
  const providers=config.resources.filter(r=>r.active && r.kind==='provider' && config.services.some(s=>s.providerIds.includes(r.id)));
  const services=config.services.filter(s=>s.locationIds.some(id=>locations.some(l=>l.id===id)) && s.providerIds.some(id=>providers.some(p=>p.id===id))).map(s=>({id:s.id,name:s.name,durationMinutes:s.durationMinutes,price:s.price,bookingMode:s.bookingMode==='inherit'?config.defaultBookingMode:s.bookingMode,locationMode:s.locationMode,locationIds:s.locationIds.filter(id=>locations.some(l=>l.id===id)),providerIds:s.providerIds.filter(id=>providers.some(p=>p.id===id))}));
  return {schemaVersion:1,siteId:this.site,installationId:this.manifest.installationId,siteOrigin:this.manifest.site.origin,businessName:this.manifest.business.name,mode:'test',revision:state.revision,horizonDays:config.horizonDays,minNoticeMinutes:config.minNoticeMinutes,policyText:config.publicBooking!.policyText,allowProviderChoice:config.publicBooking!.allowProviderChoice,emailMode:config.notifications?.enabled?config.notifications.mode:'disabled',...(config.customerManagement?.enabled?{customerManagement:{cancellationCutoffMinutes:config.customerManagement.cancellationCutoffMinutes,rescheduleCutoffMinutes:config.customerManagement.rescheduleCutoffMinutes}}:{}),challenge:this.local?{kind:'local-fixture'}:{kind:'turnstile',siteKey:this.env.BOOKING_TURNSTILE_SITE_KEY},services,locations,providers:providers.map(p=>({id:p.id,name:p.name,locationIds:p.locationIds}))};
 }
 async slots(request:Request){
  await this.rate(request,'availability',30,60);
  const query=parsePublicAvailability(Object.fromEntries(new URL(request.url).searchParams));
  let state=await this.state(),config=this.published(state);const service=config.services.find(s=>s.id===query.serviceId);
  if(!service || !service.locationIds.includes(query.locationId) || query.providerId && !service.providerIds.includes(query.providerId)) throw new SchedulingError(400,'invalid_selection','Choose an available service and location.');
  await this.calendars.beforeAvailability(query.providerId?[query.providerId]:service.providerIds);
  state=await this.state();config=this.published(state);
  const reservations=await this.engine.reservations({start:Date.parse(query.startsAt)-240*minute,end:Date.parse(query.endsAt)+960*minute});
  const current=config.services.find(s=>s.id===query.serviceId);
  return {schemaVersion:1,siteId:this.site,revision:state.revision,...availability(config,query,reservations,Date.now()),terms:current?{name:current.name,durationMinutes:current.durationMinutes,price:current.price,bookingMode:current.bookingMode==='inherit'?config.defaultBookingMode:current.bookingMode,locationMode:current.locationMode}:null,policyText:config.publicBooking!.policyText,location:config.locations.find(l=>l.id===query.locationId)};
 }
 private async challenge(request:Request,input:PublicBookingRequest){
  if(input.company) throw new SchedulingError(400,'booking_invalid','The booking could not be accepted.');
  if(this.local) return;
  if(!input.challengeToken) throw new SchedulingError(400,'challenge_required','Complete the security check before booking.');
  const body=new URLSearchParams({secret:this.env.BOOKING_TURNSTILE_SECRET!,response:input.challengeToken,remoteip:request.headers.get('cf-connecting-ip') || '',idempotency_key:input.idempotencyKey});
  let result:{success?:boolean;hostname?:string;action?:string};
  try {
   const transport=this.env.BOOKING_CHALLENGE_HTTP;
   const response=await (transport?transport.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body,redirect:'manual',signal:AbortSignal.timeout(10000)}):fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body,redirect:'manual',signal:AbortSignal.timeout(10000)}));
   if(!response.ok) throw new Error();
   const reader=response.body?.getReader();if(!reader)throw new Error();let text='',size=0;const decoder=new TextDecoder();
   for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384){await reader.cancel();throw new Error();}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();result=JSON.parse(text);
  }catch{throw new SchedulingError(503,'challenge_unavailable','The security check is unavailable. Please try again.');}
  if(result.success!==true || result.hostname!==new URL(this.manifest.site.origin).hostname || result.action!=='booking') throw new SchedulingError(400,'challenge_invalid','The security check expired. Complete it again before booking.');
 }
 private async replay(key:string,hash:string){
  const row=await this.env.DB.prepare('SELECT request_hash,response_json,origin FROM booking_commands WHERE site_id=? AND command_key=?').bind(this.site,key).first<{request_hash:string;response_json:string;origin:string}>();
  if(!row) return null;
  if(row.request_hash!==hash || row.origin!==this.manifest.site.origin) throw new SchedulingError(409,'idempotency_conflict','This booking attempt changed. Choose a time again before submitting.');
  return JSON.parse(row.response_json) as PublicBookingReceipt;
 }
 async create(request:Request){
  await this.rate(request,'submission-traffic',30,60);
  const reader=request.body?.getReader();if(!reader)throw new SchedulingValidationError('Booking details are required');let text='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>8192){await reader.cancel();throw new SchedulingError(413,'body_too_large','Booking details are too large.');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();
  let raw:unknown;try{raw=JSON.parse(text);}catch{throw new SchedulingValidationError('Invalid booking details');}
  const input=parsePublicBooking(raw),key=await digest(input.idempotencyKey);
  const {challengeToken:_challenge,company:_company,...content}=input;
  const hash=await digest(JSON.stringify(content));
  const prior=await this.replay(key,hash);if(prior){await this.finish(prior.reference);return {receipt:prior,replayed:true};}
  await this.rate(request,'new-booking',5,3600);await this.challenge(request,input);
  let state=await this.state();this.published(state);if(state.config.notifications?.enabled)await new NotificationService(this.env,this.manifest).requireSchema();
  await this.calendars.beforeAvailability([input.providerId],true);
  state=await this.state();const config=this.published(state);
  if(state.revision!==input.revision)throw new SchedulingError(409,'revision_conflict','Availability or booking details changed. Choose an available time again.');
  const time=await this.engine.selectedTime(config,input.serviceId,input.locationId,input.providerId,input.startsAt);
  const status=time.snapshot.bookingMode==='approval'?'pending_approval':'confirmed',expiresAt=status==='pending_approval'?Math.min(time.start,Date.now()+config.approvalTtlMinutes*minute):null,id=crypto.randomUUID();
  const appointment:SchedulingAppointment={id,title:time.snapshot.service.name,serviceId:input.serviceId,locationId:input.locationId,providerId:input.providerId,startsAt:new Date(time.start).toISOString(),endsAt:new Date(time.end).toISOString(),occupiedStartsAt:new Date(time.occupiedStart).toISOString(),occupiedEndsAt:new Date(time.occupiedEnd).toISOString(),status,expiresAt:expiresAt?new Date(expiresAt).toISOString():null,customer:input.customer,revision:1,snapshot:time.snapshot,mode:'test'};
  const receipt:PublicBookingReceipt={schemaVersion:1,siteId:this.site,mode:'test',reference:id,status,serviceName:appointment.title,startsAt:appointment.startsAt,endsAt:appointment.endsAt,providerName:config.resources.find(p=>p.id===input.providerId)!.name,locationName:time.snapshot.location.name,timezone:time.snapshot.location.timezone,price:time.snapshot.service.price,policyText:config.publicBooking!.policyText,expiresAt:appointment.expiresAt,delivery:config.notifications?.enabled&&config.notifications.mode==='send'?'queued':'captured',calendar:await calendarAttachment(appointment,this.site,this.manifest.adminOrigin)};
  try{
   await this.env.DB.batch([
    this.env.DB.prepare('INSERT INTO booking_commands(site_id,command_key,request_hash,expected_revision,service_id,origin,appointment_id,response_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(this.site,key,hash,input.revision,input.serviceId,this.manifest.site.origin,id,JSON.stringify(receipt),Date.now()),
    this.env.DB.prepare('INSERT INTO scheduling_appointments(site_id,id,service_id,location_id,provider_id,starts_at,ends_at,occupied_starts_at,occupied_ends_at,status,expires_at,customer_json,snapshot_json,revision,schedule_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)').bind(this.site,id,input.serviceId,input.locationId,input.providerId,time.start,time.end,time.occupiedStart,time.occupiedEnd,status,expiresAt,JSON.stringify(input.customer),JSON.stringify(time.snapshot),input.revision+1,Date.now(),Date.now()),
    this.env.DB.prepare("INSERT INTO booking_history(site_id,appointment_id,action,revision,created_at) VALUES(?,?,'Customer booked on website',1,?)").bind(this.site,id,Date.now()),
    ...(['notification','calendar'] as const).map(kind=>this.env.DB.prepare("INSERT INTO scheduling_jobs(site_id,id,appointment_id,appointment_revision,kind,action,created_at) VALUES(?,?,?,1,?,'Customer booked on website',?)").bind(this.site,crypto.randomUUID(),id,kind,Date.now())),
   ]);
  }catch(error){const prior=await this.replay(key,hash);if(prior){await this.finish(prior.reference);return {receipt:prior,replayed:true};}throw error;}
  await this.finish(id,appointment);return {receipt,replayed:false};
 }
 private async finish(id:string,appointment?:SchedulingAppointment){try{if(appointment)await this.calendars.capture(appointment);await this.calendars.afterAppointment(id);}catch{/* Native booking remains committed; durable calendar jobs expose failures. */}try{await new NotificationService(this.env,this.manifest).afterAppointment(id);}catch{/* Email work remains durable. */}}
 async handle(request:Request):Promise<Response>{
  if(new URL(request.url).pathname.startsWith('/api/booking/v1/manage/'))return new CustomerManagement(this.env,this.manifest).handle(request);
  const origin=request.headers.get('origin'),allowed=origin===this.manifest.site.origin;
  let response:Response;
  try{
   if(!allowed)throw new SchedulingError(403,'booking_origin','This website is not allowed to book with this installation.');
   this.setup();
   const path=new URL(request.url).pathname;
   if(!['/api/booking/v1/catalog','/api/booking/v1/availability','/api/booking/v1/appointments'].includes(path))throw new SchedulingError(404,'not_found','Booking route not found.');
   if(request.method==='OPTIONS')response=new Response(null,{status:204});
   else if(request.method==='GET' && path.endsWith('/catalog'))response=json(await this.catalog(request));
   else if(request.method==='GET' && path.endsWith('/availability'))response=json(await this.slots(request));
   else if(request.method==='POST' && path.endsWith('/appointments')){if(!request.headers.get('content-type')?.startsWith('application/json'))throw new SchedulingError(415,'json_required','JSON is required.');const result=await this.create(request);const emailStatus=await new NotificationService(this.env,this.manifest).status(result.receipt.reference);response=json({...result.receipt,...(emailStatus?{emailStatus}:{})},result.replayed?200:201);}
   else throw new SchedulingError(405,'method_not_allowed','This booking method is not available.');
  }catch(error){
   const message=error instanceof Error?error.message:'';
   if(error instanceof SchedulingError || error instanceof CalendarError)response=json({code:error.code,error:error.message},error.status);
   else if(error instanceof SchedulingValidationError)response=json({code:'invalid_booking',error:message},400);
   else if(/scheduling_stale_revision|scheduling_resource_conflict|calendar_busy/.test(message))response=json({code:'slot_changed',error:'This time changed while booking. Choose an available time again.'},409);
   else if(/booking_disabled|scheduling_disabled|calendar_unavailable/.test(message))response=json({code:'booking_paused',error:'Booking is paused or the calendar needs attention. Please try again later.'},503);
   else response=json({code:'booking_unavailable',error:'Booking is temporarily unavailable. Please contact the business.'},503);
  }
  const headers=new Headers(response.headers);headers.set('cache-control','no-store');headers.set('vary','Origin');
  if(allowed){headers.set('access-control-allow-origin',origin!);headers.set('access-control-allow-methods','GET, POST, OPTIONS');headers.set('access-control-allow-headers','Content-Type');}
  if(response.status===429)headers.set('retry-after','60');
  return new Response(response.body,{status:response.status,headers});
 }
}
