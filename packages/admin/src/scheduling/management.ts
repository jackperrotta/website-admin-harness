import {isLoopback,type AdminManifest} from '../../../contracts/src/index.ts';
import {parseSchedulingConfig,parseCustomerCommand,parseSchedulingAvailability,SchedulingValidationError,type CustomerAppointment,type CustomerCommand,type AppointmentSnapshot} from '../../../contracts/src/scheduling.ts';
import type {AdminEnv} from '../worker.ts';
import {SchedulingError} from './errors.ts';
import {SchedulingEngine} from './engine.ts';
import {availability,minute} from './availability.ts';
import {CalendarService} from './calendars/service.ts';
import {CalendarError} from './calendars/types.ts';
import {digest,random} from './calendars/crypto.ts';
import {calendarAttachment} from './calendars/ics.ts';
import {NotificationService} from './notifications.ts';
import {customerAppointment,type CustomerAppointmentRow} from './customer-records.ts';
interface Access {session_hash:string;token_hash:string;appointment_id:string;expires_at:number;customer_email:string;revoked_at:number|null;revoked_reason:string|null;token_expires_at:number}
export async function customerBody(request:Request,keys:string[]){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new SchedulingError(415,'json_required','JSON is required.');
 const reader=request.body?.getReader();if(!reader)throw new SchedulingValidationError('Appointment details are required');let text='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
 for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>8192){await reader.cancel();throw new SchedulingError(413,'body_too_large','Appointment details are too large.');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();
 let value:unknown;try{value=JSON.parse(text);}catch{throw new SchedulingValidationError('Invalid appointment request');}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw new SchedulingValidationError('Invalid appointment request fields');return value as Record<string,unknown>;
}
export class CustomerManagement {
 private calendars:CalendarService;private engine:SchedulingEngine;
 constructor(private env:AdminEnv,private manifest:AdminManifest){this.calendars=new CalendarService(env,manifest);this.engine=new SchedulingEngine(env.DB,manifest.site.id,this.calendars);}
 private get site(){return this.manifest.site.id;}
 private get local(){return this.env.MODE==='local'&&this.env.BOOKING_LOCAL_TEST==='1'&&isLoopback(this.manifest.site.origin)&&isLoopback(this.manifest.adminOrigin);}
 private invalid(){return new SchedulingError(401,'customer_link_invalid','This appointment link is invalid or has expired. Please contact the business.');}
 private async state(){const row=await this.env.DB.prepare('SELECT revision,config_json FROM scheduling_state WHERE site_id=?').bind(this.site).first<{revision:number;config_json:string}>();if(!row)throw this.invalid();return {revision:row.revision,config:parseSchedulingConfig(JSON.parse(row.config_json))};}
 private async row(id:string){const row=await this.env.DB.prepare('SELECT * FROM scheduling_appointments WHERE site_id=? AND id=?').bind(this.site,id).first<CustomerAppointmentRow>();if(!row)throw this.invalid();return row;}
 private async rate(request:Request,kind:string,limit=60){const ip=request.headers.get('cf-connecting-ip')||(this.local?'local-fixture':null),secret=this.env.BOOKING_RATE_SECRET||(this.local?'local-fixture':'');if(!ip||secret.length<1)throw new SchedulingError(503,'management_setup','Appointment management is temporarily unavailable. Please contact the business.');const key=await digest(`${secret}|${this.site}|${ip}|customer-${kind}`),bucket=Math.floor(Date.now()/60000);const result=await this.env.DB.prepare('INSERT INTO booking_rate_limits(site_id,key_hash,bucket,count,expires_at) VALUES(?,?,?,1,?) ON CONFLICT(site_id,key_hash,bucket) DO UPDATE SET count=count+1 RETURNING count').bind(this.site,key,bucket,(bucket+2)*60000).first<{count:number}>();if(!result||result.count>limit)throw new SchedulingError(429,'customer_rate_limit','Too many requests. Please wait before trying again.');}
 private active(row:CustomerAppointmentRow){return ['confirmed','pending_approval'].includes(row.status)&&!(row.status==='pending_approval'&&row.expires_at!<=Date.now());}
 private permissions(row:CustomerAppointmentRow,state:Awaited<ReturnType<CustomerManagement['state']>>){const rules=(JSON.parse(row.snapshot_json) as AppointmentSnapshot).customerManagement,enabled=!!rules?.enabled&&!!state.config.customerManagement?.enabled&&this.active(row);return {canCancel:enabled&&Date.now()<row.starts_at-rules!.cancellationCutoffMinutes*minute,canReschedule:enabled&&state.config.mode==='test'&&Date.now()<row.starts_at-rules!.rescheduleCutoffMinutes*minute,cancellationDeadline:rules?.enabled?new Date(row.starts_at-rules.cancellationCutoffMinutes*minute).toISOString():null,rescheduleDeadline:rules?.enabled?new Date(row.starts_at-rules.rescheduleCutoffMinutes*minute).toISOString():null};}
 private async view(row:CustomerAppointmentRow,state?:Awaited<ReturnType<CustomerManagement['state']>>):Promise<CustomerAppointment>{
  const current=state??await this.state(),appointment=customerAppointment(row),snapshot=appointment.snapshot;
  const original=await this.env.DB.prepare('SELECT response_json FROM booking_commands WHERE site_id=? AND appointment_id=? ORDER BY created_at LIMIT 1').bind(this.site,row.id).first<{response_json:string}>();
  return {schemaVersion:1,horizonDays:current.config.horizonDays,expiresAt:appointment.expiresAt,reference:row.id,status:appointment.status,revision:row.revision,scheduleRevision:current.revision,serviceName:appointment.title,startsAt:appointment.startsAt,endsAt:appointment.endsAt,timezone:snapshot.location.timezone,locationName:snapshot.location.name,providerName:current.config.resources.find(r=>r.id===row.provider_id)?.name??'Assigned staff',price:snapshot.service.price,policyText:original?(JSON.parse(original.response_json) as {policyText:string}).policyText??'':'',...this.permissions(row,current),calendar:await calendarAttachment(appointment,this.site,this.manifest.adminOrigin)};
 }
 private async access(request:Request,receipt=false){
  const raw=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];if(!raw)throw this.invalid();const hash=await digest(raw);
  const session=await this.env.DB.prepare('SELECT m.session_hash,m.token_hash,m.appointment_id,m.expires_at,t.customer_email,t.revoked_at,t.revoked_reason,t.expires_at AS token_expires_at FROM customer_management_sessions m JOIN customer_access_tokens t ON t.site_id=m.site_id AND t.token_hash=m.token_hash WHERE m.site_id=? AND m.session_hash=?').bind(this.site,hash).first<Access>();
  if(!session||session.expires_at<=Date.now()||(!receipt&&(session.revoked_at!==null||session.token_expires_at<=Date.now()))||(receipt&&session.revoked_at!==null&&session.revoked_reason!=='terminal'))throw this.invalid();
  const row=await this.row(session.appointment_id);if((JSON.parse(row.customer_json) as {email:string}).email!==session.customer_email||(!receipt&&!this.active(row)))throw this.invalid();return {session,row};
 }
 private async exchange(request:Request){
  await this.rate(request,'exchange',10);const input=await customerBody(request,['token']);if(typeof input.token!=='string'||!/^[-_a-zA-Z0-9]{43}$/.test(input.token))throw this.invalid();const hash=await digest(input.token);
  const token=await this.env.DB.prepare('SELECT appointment_id,customer_email,expires_at FROM customer_access_tokens WHERE site_id=? AND token_hash=? AND revoked_at IS NULL AND expires_at>?').bind(this.site,hash,Date.now()).first<{appointment_id:string;customer_email:string;expires_at:number}>();if(!token)throw this.invalid();
  const row=await this.row(token.appointment_id);if(!this.active(row)||(JSON.parse(row.customer_json) as {email:string}).email!==token.customer_email)throw this.invalid();
  const session=random(),expiresAt=Math.min(Date.now()+30*60000,token.expires_at),sessionHash=await digest(session);
  const inserted=await this.env.DB.prepare('INSERT INTO customer_management_sessions(site_id,session_hash,token_hash,appointment_id,expires_at,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM customer_access_tokens WHERE site_id=? AND token_hash=? AND revoked_at IS NULL AND expires_at>?)').bind(this.site,sessionHash,hash,row.id,expiresAt,Date.now(),this.site,hash,Date.now()).run();if(inserted.meta.changes!==1)throw this.invalid();
  return {schemaVersion:1,siteId:this.site,installationId:this.manifest.installationId,siteOrigin:this.manifest.site.origin,sessionToken:session,expiresAt,appointment:await this.view(row)};
 }
 private async slots(request:Request){
  const {row}=await this.access(request);let state=await this.state();if(!this.permissions(row,state).canReschedule)throw new SchedulingError(409,'customer_cutoff','Online rescheduling is unavailable or its notice deadline has passed. Please contact the business.');
  const input=await customerBody(request,['startsAt','endsAt']);const query=parseSchedulingAvailability({...input,serviceId:row.service_id,locationId:row.location_id,providerId:row.provider_id});
  await this.calendars.beforeAvailability([row.provider_id]);const current=(await this.access(request)).row;state=await this.state();if(current.revision!==row.revision||!this.permissions(current,state).canReschedule)throw new SchedulingError(409,'revision_conflict','This appointment changed. Refresh before choosing a time.');
  const original=JSON.parse(row.snapshot_json) as AppointmentSnapshot;
  const config={...state.config,services:state.config.services.map(s=>s.id===row.service_id?{...s,durationMinutes:original.service.durationMinutes,bufferBeforeMinutes:original.service.bufferBeforeMinutes,bufferAfterMinutes:original.service.bufferAfterMinutes}:s)};
  const reservations=await this.engine.reservations({start:Date.parse(query.startsAt)-240*minute,end:Date.parse(query.endsAt)+960*minute},row.id);
  return {schemaVersion:1,revision:state.revision,appointmentRevision:row.revision,timezone:original.location.timezone,...availability(config,query,reservations,Date.now())};
 }
 private async replay(session:Access,key:string,hash:string){const command=await this.env.DB.prepare('SELECT request_hash,response_json,session_hash,appointment_id FROM customer_management_commands WHERE site_id=? AND command_key=?').bind(this.site,key).first<{request_hash:string;response_json:string;session_hash:string;appointment_id:string}>();if(!command)return null;if(command.session_hash!==session.session_hash||command.request_hash!==hash||command.appointment_id!==session.appointment_id)throw new SchedulingError(409,'idempotency_conflict','This appointment command changed. Refresh before trying again.');return JSON.parse(command.response_json) as CustomerAppointment;}
 private async command(request:Request,kind:'cancel'|'reschedule'){
  const input=parseCustomerCommand(await customerBody(request,kind==='cancel'?['idempotencyKey','revision','appointmentRevision']:['idempotencyKey','revision','appointmentRevision','startsAt']),kind==='reschedule');
  const key=await digest(input.idempotencyKey),hash=await digest(JSON.stringify({kind,input}));
  const initial=await this.access(request,true),prior=await this.replay(initial.session,key,hash);if(prior){await this.finish(initial.row.id);return prior;}
  try {
  let {session,row}=await this.access(request);let state=await this.state();
  if(kind==='reschedule'){
   await this.calendars.beforeAvailability([row.provider_id],true);({session,row}=await this.access(request));state=await this.state();
  }
  const permissions=this.permissions(row,state);if(kind==='cancel'?!permissions.canCancel:!permissions.canReschedule)throw new SchedulingError(409,'customer_cutoff','This change is unavailable or its notice deadline has passed. Please contact the business.');
  if(state.revision!==input.revision||row.revision!==input.appointmentRevision)throw new SchedulingError(409,'revision_conflict','This appointment or its availability changed. Refresh before trying again.');
  const now=Date.now(),next:CustomerAppointmentRow={...row,revision:row.revision+1,updated_at:now};
  let update:D1PreparedStatement;
  if(kind==='cancel'){
   next.status='cancelled';next.expires_at=null;
   update=this.env.DB.prepare("UPDATE scheduling_appointments SET status='cancelled',expires_at=NULL,revision=revision+1,schedule_revision=?,updated_at=? WHERE site_id=? AND id=?").bind(state.revision+1,now,this.site,row.id);
  }else{
   if(Date.parse(input.startsAt!)===row.starts_at)throw new SchedulingError(400,'same_time','Choose a different appointment time.');
   const selected=await this.engine.selectedTime(state.config,row.service_id,row.location_id,row.provider_id,input.startsAt!,row.id,JSON.parse(row.snapshot_json) as AppointmentSnapshot);
   Object.assign(next,{starts_at:selected.start,ends_at:selected.end,occupied_starts_at:selected.occupiedStart,occupied_ends_at:selected.occupiedEnd,snapshot_json:JSON.stringify(selected.snapshot),expires_at:row.status==='pending_approval'?Math.min(row.expires_at!,selected.start):null});
   update=this.env.DB.prepare('UPDATE scheduling_appointments SET starts_at=?,ends_at=?,occupied_starts_at=?,occupied_ends_at=?,snapshot_json=?,expires_at=?,revision=revision+1,schedule_revision=?,updated_at=? WHERE site_id=? AND id=?').bind(next.starts_at,next.ends_at,next.occupied_starts_at,next.occupied_ends_at,next.snapshot_json,next.expires_at,state.revision+1,now,this.site,row.id);
  }
  const response=await this.view(next,{...state,revision:state.revision+1});
  try{await this.env.DB.batch([
   this.env.DB.prepare('INSERT INTO customer_management_commands(site_id,command_key,session_hash,appointment_id,request_hash,kind,expected_revision,appointment_revision,response_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(this.site,key,session.session_hash,row.id,hash,kind,state.revision,row.revision,JSON.stringify(response),now),update,
   this.env.DB.prepare('INSERT INTO booking_history(site_id,appointment_id,action,revision,created_at) VALUES(?,?,?,?,?)').bind(this.site,row.id,kind==='cancel'?'Customer cancelled appointment':'Customer rescheduled appointment',next.revision,now)
  ]);}catch(error){const prior=await this.replay(session,key,hash);if(prior){await this.finish(row.id);return prior;}throw error;}
  await this.finish(row.id);return response;
  } catch(error) {const current=await this.access(request,true);const receipt=await this.replay(current.session,key,hash);if(receipt){await this.finish(current.row.id);return receipt;}throw error;}
 }
 private async finish(id:string){try{await this.calendars.afterAppointment(id);}catch{/* Native command committed; durable calendar errors stay visible. */}try{await new NotificationService(this.env,this.manifest).afterAppointment(id);}catch{/* Native command remains authoritative. */}}
 async handle(request:Request){
  const allowed=request.headers.get('origin')===this.manifest.site.origin;let response:Response;
  try{
   if(!allowed)throw new SchedulingError(403,'customer_origin','This website cannot manage appointments for this installation.');if(!this.manifest.modules.includes('scheduling'))throw new SchedulingError(404,'not_found','Appointment management is unavailable.');
   if(request.method==='OPTIONS')response=new Response(null,{status:204});
   else{
    if(request.method!=='POST')throw new SchedulingError(405,'method_not_allowed','Use an explicit appointment-management action.');await this.rate(request,'requests');
    const action=new URL(request.url).pathname.slice('/api/booking/v1/manage/'.length);
    if(action==='exchange')response=Response.json(await this.exchange(request));
    else if(action==='appointment'){await customerBody(request,[]);response=Response.json(await this.view((await this.access(request)).row));}
    else if(action==='availability')response=Response.json(await this.slots(request));
    else if(action==='cancel'||action==='reschedule')response=Response.json(await this.command(request,action));
    else throw new SchedulingError(404,'not_found','Appointment-management route not found.');
   }
  }catch(error){const message=error instanceof Error?error.message:'';
   if(error instanceof SchedulingError||error instanceof CalendarError)response=Response.json({code:error.code,error:error.message},{status:error.status});
   else if(error instanceof SchedulingValidationError)response=Response.json({code:'invalid_request',error:error.message},{status:400});
   else if(/customer_access_denied/.test(message))response=Response.json({code:'customer_link_invalid',error:'This appointment link is no longer valid.'},{status:401});
   else if(/customer_action_unavailable/.test(message))response=Response.json({code:'customer_cutoff',error:'The change deadline has passed or this action is unavailable.'},{status:409});
   else if(/scheduling_stale_revision|scheduling_resource_conflict|calendar_busy/.test(message))response=Response.json({code:'revision_conflict',error:'This appointment or time changed. Refresh and choose an available time.'},{status:409});
   else response=Response.json({code:'management_unavailable',error:'Appointment management is temporarily unavailable. Please contact the business.'},{status:503});
  }
  const headers=new Headers(response.headers);headers.set('cache-control','no-store');headers.set('vary','Origin');if(allowed){headers.set('access-control-allow-origin',this.manifest.site.origin);headers.set('access-control-allow-methods','POST, OPTIONS');headers.set('access-control-allow-headers','Content-Type, Authorization');}if(response.status===429)headers.set('retry-after','60');return new Response(response.body,{status:response.status,headers});
 }
}
