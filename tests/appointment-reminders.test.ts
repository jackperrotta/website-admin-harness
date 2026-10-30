import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createSchedulingBrowserFixture} from './scheduling-browser-fixture.ts';
import {schedulingFixture} from './scheduling-fixture.ts';
import {syntheticNotificationBindings} from './notification-fixture.ts';
import {parseSchedulingConfig} from '../packages/contracts/src/scheduling.ts';
import type {SchedulingEmailMessage} from '../packages/admin/src/scheduling/booking-env.ts';
import {AppointmentReminders} from '../packages/admin/src/scheduling/reminders.ts';
import type {AdminEnv} from '../packages/admin/src/worker.ts';
import {readFile} from 'node:fs/promises';

let fixture:Awaited<ReturnType<typeof createSchedulingBrowserFixture>>;
let lost=false;const sent:SchedulingEmailMessage[]=[];
const site='scheduling-browser',minute=60000;
before(async()=>{fixture=await createSchedulingBrowserFixture({bindings:syntheticNotificationBindings,mail:async message=>{sent.push(message as SchedulingEmailMessage);if(lost)throw Error('Simulated lost send response');return {messageId:'fixture-'+sent.length};}});});
after(async()=>{await fixture?.app.dispose();});
async function reset(){lost=false;sent.length=0;const config=schedulingFixture();config.notifications={enabled:true,mode:'capture',reminders:{enabled:true,offsetsMinutes:[1440,120]}};config.customerManagement={enabled:true,cancellationCutoffMinutes:0,rescheduleCutoffMinutes:0};await fixture.reset(config);}
beforeEach(reset);
const tick=async()=>{await(await fixture.app.getWorker()).scheduled({cron:'* * * * *'});};
const scheduler=()=>new AppointmentReminders({DB:fixture.db} as unknown as AdminEnv,site);
async function create(){const at=Math.ceil((Date.now()+5*86400000)/3600000)*3600000;const response=await fixture.ownerPost('/appointments',{idempotencyKey:crypto.randomUUID(),revision:(await fixture.config()).revision,serviceId:'visit',locationId:'main',providerId:'provider-a',startsAt:new Date(at).toISOString(),customer:{name:'Reminder Sample',email:'customer@example.test',phone:''}});assert.equal(response.status,201,await response.clone().text());return (await response.json() as {id:string}).id;}
// Model elapsed business time only in isolated fixture records, without changing the Worker clock.
async function due(id:string,offset=120,agoMinutes=1){const starts=Math.floor(Date.now()/1000)*1000+(offset-agoMinutes)*minute;await fixture.db.prepare('UPDATE scheduling_appointments SET starts_at=?,ends_at=?,occupied_starts_at=?,occupied_ends_at=?,revision=revision+1,schedule_revision=(SELECT revision FROM scheduling_state WHERE site_id=scheduling_appointments.site_id),updated_at=? WHERE site_id=? AND id=?').bind(starts,starts+30*minute,starts,starts+30*minute,Date.now(),site,id).run();await fixture.db.prepare('UPDATE scheduling_reminder_windows SET eligible_at=? WHERE site_id=? AND appointment_id=?').bind(starts-offset*minute-minute,site,id).run();return starts;}
async function rows(){return (await fixture.db.prepare("SELECT * FROM scheduling_notification_outbox WHERE site_id=? AND kind='reminder' ORDER BY created_at").bind(site).all<{id:string;status:string;appointment_revision:number;reminder_offset_minutes:number;reminder_starts_at:number}>()).results;}
async function settings(patch:(config:ReturnType<typeof schedulingFixture>)=>void){const state=await fixture.config();patch(state.config);const response=await fixture.ownerPost('/configuration',state);assert.equal(response.status,200,await response.clone().text());}
async function preview(id:string){const response=await fixture.app.dispatchFetch(fixture.origin+'/api/modules/scheduling/notifications/'+id,{headers:{cookie:'vitris-admin-local='+fixture.sessions.get('owner')}});assert.equal(response.status,200);return await response.json() as {message:SchedulingEmailMessage;links:{cancel:string;reschedule:string}|null};}

test('reminder settings are optional, strict, unique, bounded and canonical',()=>{
 assert.equal(parseSchedulingConfig(schedulingFixture()).notifications,undefined);
 const config=schedulingFixture();config.notifications={enabled:true,mode:'capture',reminders:{enabled:true,offsetsMinutes:[120,1440]}};assert.deepEqual(parseSchedulingConfig(config).notifications!.reminders!.offsetsMinutes,[1440,120]);
 for(const offsetsMinutes of [[],[1,2,3,4],[120,120],[0],[-1],[43201],[1.5],['120'],[null]])assert.throws(()=>parseSchedulingConfig({...config,notifications:{enabled:true,mode:'capture',reminders:{enabled:true,offsetsMinutes}}}));
 assert.throws(()=>parseSchedulingConfig({...config,notifications:{enabled:true,mode:'capture',reminders:{enabled:'yes',offsetsMinutes:[120]}}}));
 assert.throws(()=>parseSchedulingConfig({...config,notifications:{enabled:true,mode:'capture',reminders:{enabled:true,offsetsMinutes:[120],recipient:'another@example.test'}}}));
});
test('only due confirmed reminders are captured, with current terms, ICS and private links',async()=>{
 const id=await create();await tick();assert.equal((await rows()).length,0);const starts=await due(id);await tick();const out=await rows();assert.equal(out.length,1);assert.equal(out[0].status,'captured');assert.equal(out[0].reminder_offset_minutes,120);const mail=await preview(out[0].id);assert.match(mail.message.subject,/Appointment reminder/);assert.match(mail.message.text,/upcoming confirmed appointment/);assert.ok(mail.links);const ics=Buffer.from(mail.message.attachments[0].content,'base64').toString('utf8');assert.match(ics,/STATUS:CONFIRMED/);assert.match(ics,/SEQUENCE:2/);assert.ok(mail.message.html.includes('Reminder Sample'));assert.equal(out[0].reminder_starts_at,starts);assert.equal(sent.length,0);
});
test('overlapping cron runs and later note revisions cannot duplicate a reminder',async()=>{
 const id=await create();await due(id);await Promise.all([tick(),tick(),tick()]);assert.equal((await rows()).length,1);assert.equal((await rows())[0].status,'captured');await fixture.db.prepare('UPDATE scheduling_appointments SET revision=revision+1 WHERE site_id=? AND id=?').bind(site,id).run();await tick();assert.equal((await rows()).length,1);assert.equal((await rows())[0].status,'captured');
});
test('disabled reminders, disabled emails, pending approval and terminal appointments do not remind',async()=>{
 const id=await create();await due(id);await settings(c=>{c.notifications!.reminders!.enabled=false;});await tick();assert.equal((await rows()).length,0);
 await settings(c=>{c.notifications!.reminders!.enabled=true;c.notifications!.enabled=false;});await due(id);await tick();assert.equal((await rows()).length,0);
 await settings(c=>{c.notifications!.enabled=true;});await due(id);for(const status of ['pending_approval','cancelled','declined','expired','completed','no_show']){await fixture.db.prepare('UPDATE scheduling_appointments SET status=?,expires_at=?,revision=revision+1,schedule_revision=(SELECT revision FROM scheduling_state WHERE site_id=scheduling_appointments.site_id) WHERE site_id=? AND id=?').bind(status,status==='pending_approval'?Date.now()+minute:null,site,id).run();await tick();assert.equal((await rows()).length,0,status);}
});
test('missed, already-started, newly booked and newly enabled reminder times are skipped',async()=>{
 const id=await create();await due(id,120,16);await tick();assert.equal((await rows()).length,0);await due(id,120,121);await tick();assert.equal((await rows()).length,0);
 await due(id);await fixture.db.prepare('UPDATE scheduling_reminder_windows SET eligible_at=? WHERE site_id=? AND appointment_id=?').bind(Date.now(),site,id).run();await tick();assert.equal((await rows()).length,0);
 await due(id);await settings(c=>{c.notifications!.reminders!.offsetsMinutes=[120];});await tick();assert.equal((await rows()).length,0);
});
test('rescheduling invalidates pending old-time reminders and permits a new-time reminder',async()=>{
 const id=await create();await due(id);await scheduler().enqueue();assert.equal((await rows())[0].status,'pending');await due(id,1440);await tick();const out=await rows();assert.equal(out.length,2);assert.equal(out.filter(r=>r.status==='captured').length,1);assert.equal(out.find(r=>r.reminder_offset_minutes===120)!.status,'superseded');assert.equal(out.find(r=>r.reminder_offset_minutes===1440)!.status,'captured');
});
test('cancellation, recipient changes and config changes fence already-queued reminders',async()=>{
 for(const change of ['cancel','recipient','disable','mode','offset']){
  await reset();const id=await create();await due(id);await scheduler().enqueue();const out=(await rows()).filter(r=>r.status==='pending').at(-1)!;
  if(change==='cancel')await fixture.db.prepare("UPDATE scheduling_appointments SET status='cancelled',revision=revision+1,schedule_revision=(SELECT revision FROM scheduling_state WHERE site_id=scheduling_appointments.site_id),updated_at=? WHERE site_id=? AND id=?").bind(Date.now(),site,id).run();
  if(change==='recipient')await fixture.db.prepare('UPDATE scheduling_appointments SET customer_json=?,revision=revision+1,schedule_revision=(SELECT revision FROM scheduling_state WHERE site_id=scheduling_appointments.site_id),updated_at=? WHERE site_id=? AND id=?').bind(JSON.stringify({name:'New Recipient',email:'new@example.test',phone:''}),Date.now(),site,id).run();
  if(change==='disable')await settings(c=>{c.notifications!.reminders!.enabled=false;});
  if(change==='mode')await settings(c=>{c.notifications!.mode='send';});
  if(change==='offset')await settings(c=>{c.notifications!.reminders!.offsetsMinutes=[60];});
  // A preparation lease alone cannot authorize sending obsolete work.
  await fixture.db.prepare("UPDATE scheduling_notification_outbox SET status='preparing',lease_id='fixture',lease_until=? WHERE site_id=? AND id=?").bind(Date.now()+minute,site,out.id).run();
  await assert.rejects(fixture.db.prepare('INSERT INTO notification_fences(id,site_id,outbox_id,lease_id,appointment_revision,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),site,out.id,'fixture',out.appointment_revision,Date.now()).run(),/notification_stale/);
  await fixture.db.prepare('UPDATE scheduling_notification_outbox SET lease_until=0 WHERE site_id=? AND id=?').bind(site,out.id).run();await tick();assert.equal((await rows()).find(r=>r.id===out.id)!.status,'superseded');
  await settings(c=>{c.notifications={enabled:true,mode:'capture',reminders:{enabled:true,offsetsMinutes:[1440,120]}};});
 }
 assert.equal(sent.length,0);
});
test('a benign revision before sending refreshes unsent work without changing its dedupe identity',async()=>{
 const id=await create();await due(id);await scheduler().enqueue();const original=(await rows())[0];await fixture.db.prepare('UPDATE scheduling_appointments SET revision=revision+1 WHERE site_id=? AND id=?').bind(site,id).run();await tick();const out=await rows();assert.equal(out.length,1);assert.equal(out[0].id,original.id);assert.equal(out[0].status,'captured');assert.equal(out[0].appointment_revision,3);
});
test('accepted and uncertain reminder sends never automatically repeat; stale explicit retries are suppressed',async()=>{
 await settings(c=>{c.notifications!.mode='send';});const id=await create();await due(id);lost=true;await tick();let out=await rows();assert.equal(out[0].status,'unknown');const count=sent.filter(m=>m.subject.startsWith('Appointment reminder')).length;assert.equal(count,1);await tick();assert.equal(sent.filter(m=>m.subject.startsWith('Appointment reminder')).length,count);
 await fixture.db.prepare('UPDATE scheduling_appointments SET revision=revision+1 WHERE site_id=? AND id=?').bind(site,id).run();await tick();assert.equal((await rows())[0].status,'unknown');lost=false;
 assert.equal((await fixture.ownerPost('/notifications/'+out[0].id+'/retry',{acknowledge:true})).status,200);assert.equal((await rows())[0].status,'superseded');await tick();assert.equal(sent.filter(m=>m.subject.startsWith('Appointment reminder')).length,count);
});
test('multiple configured offsets send once each; pausing new booking keeps existing reminders active',async()=>{
 await settings(c=>{c.notifications!.mode='send';c.notifications!.reminders!.offsetsMinutes=[130,120];});const id=await create();await due(id);await fixture.db.prepare('UPDATE scheduling_reminder_windows SET eligible_at=1 WHERE site_id=? AND appointment_id=?').bind(site,id).run();await settings(c=>{c.mode='disabled';});await tick();assert.deepEqual((await rows()).map(r=>r.status),['accepted','accepted']);await tick();assert.equal(sent.filter(m=>m.subject.startsWith('Appointment reminder')).length,2);
});
test('reminder scheduling and settings require the correct site and configuration authority',async()=>{
 const id=await create();await due(id);await new AppointmentReminders({DB:fixture.db} as unknown as AdminEnv,'another-site').enqueue();assert.equal((await rows()).length,0);const state=await fixture.config();const response=await fixture.app.dispatchFetch(fixture.origin+'/api/modules/scheduling/configuration',{method:'POST',headers:{origin:fixture.origin,cookie:'vitris-admin-local='+fixture.sessions.get('provider-user'),'content-type':'application/json'},body:JSON.stringify(state)});assert.equal(response.status,403);await tick();assert.equal((await rows()).length,1);
});
test('migration from 0007 preserves appointments and encrypted-message records without queuing overdue reminders',async()=>{
 const old=await createSchedulingBrowserFixture({migrationsThrough:7});
 try{
  const config=schedulingFixture();config.notifications={enabled:true,mode:'capture',reminders:{enabled:true,offsetsMinutes:[120]}};
  await old.db.prepare('INSERT INTO scheduling_state(site_id,revision,config_json,updated_at) VALUES(?,0,?,?)').bind(site,JSON.stringify(config),Date.now()-86400000).run();
  const at=Math.ceil((Date.now()+5*86400000)/3600000)*3600000;const response=await old.ownerPost('/appointments',{idempotencyKey:crypto.randomUUID(),revision:0,serviceId:'visit',locationId:'main',providerId:'provider-a',startsAt:new Date(at).toISOString(),customer:{name:'Retained fixture',email:'customer@example.test',phone:''}});assert.equal(response.status,201);const {id}=await response.json() as {id:string};
  const starts=Math.floor(Date.now()/1000)*1000+119*minute;await old.db.prepare('UPDATE scheduling_appointments SET starts_at=?,ends_at=?,occupied_starts_at=?,occupied_ends_at=?,revision=revision+1 WHERE site_id=? AND id=?').bind(starts,starts+30*minute,starts,starts+30*minute,site,id).run();
  // Opaque fixture bytes test storage preservation, without pretending this is decryptable mail.
  await old.db.prepare("UPDATE scheduling_notification_outbox SET message_cipher='opaque-fixture-ciphertext',status='captured'").run();
  const before=await old.db.prepare('SELECT * FROM scheduling_appointments').all();const mailBefore=await old.db.prepare('SELECT id,message_cipher,status,payload_json FROM scheduling_notification_outbox ORDER BY id').all();
  const sql=await readFile('packages/admin/migrations/0008_appointment_reminders.sql','utf8');for(const statement of sql.split('-- statement-breakpoint').map(s=>s.replace(/^--.*$/gm,'').trim()).filter(Boolean))await old.db.prepare(statement).run();
  assert.deepEqual((await old.db.prepare('SELECT * FROM scheduling_appointments').all()).results,before.results);assert.deepEqual((await old.db.prepare('SELECT id,message_cipher,status,payload_json FROM scheduling_notification_outbox ORDER BY id').all()).results,mailBefore.results);
  await new AppointmentReminders({DB:old.db} as unknown as AdminEnv,site).enqueue();assert.equal((await old.db.prepare("SELECT count(*) AS n FROM scheduling_notification_outbox WHERE kind='reminder'").first<{n:number}>())!.n,0);
 }finally{await old.app.dispose();}
});
