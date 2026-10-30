import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createSchedulingBrowserFixture} from './scheduling-browser-fixture.ts';
import {schedulingFixture} from './scheduling-fixture.ts';
import {syntheticNotificationBindings} from './notification-fixture.ts';
import type {PublicBookingReceipt,CustomerAppointment,PublicBookingRequest} from '../packages/contracts/src/scheduling.ts';
import type {SchedulingEmailMessage} from '../packages/admin/src/scheduling/booking-env.ts';
let fixture:Awaited<ReturnType<typeof createSchedulingBrowserFixture>>;
const website='http://localhost:4392',sent:SchedulingEmailMessage[]=[];let sendFails=false;
const start=Math.ceil((Date.now()+5*86400000)/3600000)*3600000,iso=(minutes=0)=>new Date(start+minutes*60000).toISOString();
before(async()=>{fixture=await createSchedulingBrowserFixture({websiteOrigin:website,bindings:{BOOKING_ENABLED:'1',BOOKING_LOCAL_TEST:'1',...syntheticNotificationBindings},mail:async message=>{sent.push(message as SchedulingEmailMessage);if(sendFails)throw Error('Synthetic send response lost');return {messageId:'synthetic-message-'+sent.length};}});});
after(async()=>{await fixture?.app.dispose();});
beforeEach(async()=>{sent.length=0;sendFails=false;const config=schedulingFixture();config.notifications={enabled:true,mode:'capture'};config.customerManagement={enabled:true,cancellationCutoffMinutes:0,rescheduleCutoffMinutes:0};config.publicBooking={enabled:true,serviceIds:['visit','consult'],allowProviderChoice:true,policyText:'Changes must follow the business notice rules.'};await fixture.reset(config);});
const post=(path:string,data:unknown,session?:string)=>fixture.app.dispatchFetch(fixture.origin+'/api/booking/v1'+path,{method:'POST',headers:{origin:website,'content-type':'application/json',...(session?{authorization:'Bearer '+session}:{})},body:JSON.stringify(data)});
const admin=(path:string,user='owner')=>fixture.app.dispatchFetch(fixture.origin+'/api/modules/scheduling'+path,{headers:{cookie:'vitris-admin-local='+fixture.sessions.get(user)}});
async function create(minutes=0,customer={name:'Email Customer',email:'customer@example.test',phone:''}){const body={idempotencyKey:crypto.randomUUID(),revision:(await fixture.config()).revision,serviceId:'visit',locationId:'main',providerId:'provider-a',startsAt:iso(minutes),customer,acceptedPolicy:true,company:'',challengeToken:''};const response=await post('/appointments',body);assert.equal(response.status,201,await response.clone().text());return {receipt:await response.json() as PublicBookingReceipt,body};}
async function mails(){return (await(await admin('/notifications')).json() as {rows:{id:string;appointmentId:string;kind:string;status:string;revision:number}[]}).rows;}
async function preview(id:string){return await(await admin('/notifications/'+id)).json() as {message:SchedulingEmailMessage;links:{cancel:string;reschedule:string}|null};}
async function access(id:string){const row=(await mails()).find(m=>m.appointmentId===id)!;const captured=await preview(row.id);assert.ok(captured.links);const token=new URLSearchParams(new URL(captured.links.cancel).hash.slice(1)).get('token')!;const response=await post('/manage/exchange',{token});assert.equal(response.status,200,await response.clone().text());return {...await response.json() as {sessionToken:string;appointment:CustomerAppointment},token,captured};}
const command=(appointment:CustomerAppointment)=>({idempotencyKey:crypto.randomUUID(),revision:appointment.scheduleRevision,appointmentRevision:appointment.revision});
async function view(session:string){const response=await post('/manage/appointment',{},session);assert.equal(response.status,200,await response.clone().text());return await response.json() as CustomerAppointment;}

test('confirmation captures escaped text/HTML, a UTF-8 calendar attachment and fragment-only appointment links',async()=>{
 const {receipt}=await create(0,{name:'<script>unsafe</script>',email:'customer@example.test',phone:''});assert.equal(receipt.emailStatus,'captured');const rows=await mails();assert.equal(rows.length,1);assert.equal(rows[0].status,'captured');const captured=await preview(rows[0].id);assert.match(captured.message.subject,/Appointment confirmed/);assert.ok(captured.message.html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));assert.ok(!captured.message.html.includes('<script>unsafe'));
 const calendar=Buffer.from(captured.message.attachments[0].content,'base64').toString('utf8');assert.match(calendar,/BEGIN:VCALENDAR/);assert.match(calendar,/STATUS:CONFIRMED/);assert.match(calendar,/SEQUENCE:1/);assert.equal(captured.message.attachments[0].disposition,'attachment');assert.ok(!('Message-ID' in captured.message.headers));assert.ok(captured.links);
 for(const url of Object.values(captured.links)){const link=new URL(url);assert.equal(link.pathname,'/book/manage');assert.equal(link.search,'');assert.equal(new URLSearchParams(link.hash.slice(1)).get('token')?.length,43);}
 const token=new URLSearchParams(new URL(captured.links.cancel).hash.slice(1)).get('token')!;const stored=await fixture.db.prepare('SELECT message_cipher FROM scheduling_notification_outbox').first<{message_cipher:string}>();assert.ok(stored&&!stored.message_cipher.includes(token));const tokens=(await fixture.db.prepare('SELECT token_hash FROM customer_access_tokens').all<{token_hash:string}>()).results;assert.equal(tokens.length,1);assert.match(tokens[0].token_hash,/^[a-f0-9]{64}$/);assert.equal(sent.length,0);
});

test('pending requests and approval updates have truthful status and stable calendar identity',async()=>{
 const state=await fixture.config();state.config.services[0].bookingMode='approval';await fixture.ownerPost('/configuration',state);const {receipt}=await create();const first=await preview((await mails())[0].id);assert.match(first.message.subject,/request received/);assert.match(first.message.text,/not yet confirmed/);assert.match(Buffer.from(first.message.attachments[0].content,'base64').toString(),/STATUS:TENTATIVE/);
 assert.equal((await fixture.ownerPost('/appointments/'+receipt.reference+'/status',{idempotencyKey:crypto.randomUUID(),revision:(await fixture.config()).revision,appointmentRevision:1,status:'confirmed'})).status,200);const approved=(await mails()).find(r=>r.revision===2)!;assert.equal(approved.kind,'approved');const second=await preview(approved.id),a=Buffer.from(first.message.attachments[0].content,'base64').toString(),b=Buffer.from(second.message.attachments[0].content,'base64').toString();assert.equal(a.match(/UID:.*\r\n/)?.[0],b.match(/UID:.*\r\n/)?.[0]);assert.match(b,/SEQUENCE:2/);assert.match(b,/STATUS:CONFIRMED/);
});

test('guest retries do not duplicate emails and customer cancellation revokes access while its own receipt remains retryable',async()=>{
 const {receipt,body}=await create();assert.equal((await post('/appointments',body)).status,200);assert.equal((await mails()).length,1);const cap=await access(receipt.reference);const input=command(cap.appointment);const results=await Promise.all([post('/manage/cancel',input,cap.sessionToken),post('/manage/cancel',input,cap.sessionToken)]);assert.deepEqual(results.map(r=>r.status),[200,200]);const result=await results[0].json() as CustomerAppointment;assert.equal(result.status,'cancelled');assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM scheduling_reservations').first<{n:number}>())?.n,0);assert.equal((await post('/manage/appointment',{},cap.sessionToken)).status,401);assert.equal((await post('/manage/exchange',{token:cap.token})).status,401);assert.equal((await post('/manage/cancel',input,cap.sessionToken)).status,200);assert.equal((await mails()).length,2);const cancelled=await preview((await mails()).find(row=>row.kind==='cancelled')!.id);assert.equal(cancelled.links,null);assert.match(Buffer.from(cancelled.message.attachments[0].content,'base64').toString(),/STATUS:CANCELLED/);
});

test('customer rescheduling keeps original staff/location/price/duration and updates the same appointment',async()=>{
 const {receipt}=await create();const cap=await access(receipt.reference);const state=await fixture.config();state.config.services[0].price.amountMinor=9900;state.config.services[0].durationMinutes=60;await fixture.ownerPost('/configuration',state);const latest=await view(cap.sessionToken);const response=await post('/manage/reschedule',{...command(latest),startsAt:iso(120)},cap.sessionToken);assert.equal(response.status,200,await response.clone().text());const changed=await response.json() as CustomerAppointment;assert.equal(changed.reference,receipt.reference);assert.equal(changed.startsAt,iso(120));assert.equal(changed.price.amountMinor,5000);assert.equal(Date.parse(changed.endsAt)-Date.parse(changed.startsAt),30*60000);assert.equal((await fixture.db.prepare('SELECT provider_id,location_id FROM scheduling_appointments').first<{provider_id:string;location_id:string}>())?.provider_id,'provider-a');assert.equal((await mails()).filter(r=>r.kind==='rescheduled').length,1);
});

test('a failed reschedule retains original reservations and customer commands cannot choose another appointment/staff/location',async()=>{
 const {receipt}=await create();const cap=await access(receipt.reference);const blocked=await fixture.ownerPost('/appointments',{idempotencyKey:crypto.randomUUID(),revision:(await fixture.config()).revision,serviceId:'visit',locationId:'main',providerId:'provider-b',startsAt:iso(120),customer:{name:'Other customer',email:'other@example.test',phone:''}});assert.equal(blocked.status,201);const latest=await view(cap.sessionToken);
 assert.equal((await post('/manage/reschedule',{...command(latest),startsAt:iso(120)},cap.sessionToken)).status,409);const row=await fixture.db.prepare('SELECT starts_at FROM scheduling_appointments WHERE id=?').bind(receipt.reference).first<{starts_at:number}>();assert.equal(row?.starts_at,start);
 for(const patch of [{appointmentId:'other'},{providerId:'provider-b'},{locationId:'remote'},{price:1}])assert.equal((await post('/manage/reschedule',{...command(latest),startsAt:iso(180),...patch},cap.sessionToken)).status,400);
 assert.equal((await post('/manage/appointment',{appointmentId:'other'},cap.sessionToken)).status,400);
});

test('notice cutoffs are snapshotted, enforced by server and transaction guard, and global disabling cannot be bypassed',async()=>{
 const state=await fixture.config();state.config.customerManagement={enabled:true,cancellationCutoffMinutes:1440,rescheduleCutoffMinutes:1440};await fixture.ownerPost('/configuration',state);const {receipt}=await create();const cap=await access(receipt.reference);
 const after=await fixture.config();after.config.customerManagement!.cancellationCutoffMinutes=0;await fixture.ownerPost('/configuration',after);
 const soon=Math.floor((Date.now()+23*3600000)/60000)*60000;await fixture.db.prepare('UPDATE scheduling_appointments SET starts_at=?,ends_at=?,occupied_starts_at=?,occupied_ends_at=?,revision=revision+1,schedule_revision=(SELECT revision FROM scheduling_state WHERE site_id=scheduling_appointments.site_id) WHERE site_id=? AND id=?').bind(soon,soon+30*60000,soon,soon+30*60000,'scheduling-browser',receipt.reference).run();const latest=await view(cap.sessionToken);assert.equal(latest.canCancel,false);assert.equal(latest.canReschedule,false);assert.equal((await post('/manage/cancel',command(latest),cap.sessionToken)).status,409);
 const session=await fixture.db.prepare('SELECT session_hash FROM customer_management_sessions LIMIT 1').first<{session_hash:string}>();await assert.rejects(fixture.db.prepare("INSERT INTO customer_management_commands(site_id,command_key,session_hash,appointment_id,request_hash,kind,expected_revision,appointment_revision,response_json,created_at) VALUES('scheduling-browser','forged',?,?,?,'cancel',?,?,?,?)").bind(session!.session_hash,receipt.reference,'hash',latest.scheduleRevision,latest.revision,'{}',Date.now()).run(),/customer_action_unavailable/);
});

test('pausing new booking still allows eligible cancellation but prevents rescheduling',async()=>{
 const {receipt}=await create();const cap=await access(receipt.reference),state=await fixture.config();state.config.mode='disabled';state.config.publicBooking!.enabled=false;await fixture.ownerPost('/configuration',state);const current=await view(cap.sessionToken);assert.equal(current.canCancel,true);assert.equal(current.canReschedule,false);assert.equal((await post('/manage/cancel',command(current),cap.sessionToken)).status,200);
});

test('expired links/sessions and recipient changes revoke authority; GETs and admin routes grant no customer action',async()=>{
 const {receipt}=await create();const cap=await access(receipt.reference);assert.equal((await fixture.app.dispatchFetch(fixture.origin+'/api/booking/v1/manage/cancel',{headers:{origin:website,authorization:'Bearer '+cap.sessionToken}})).status,405);assert.equal((await post('/manage/exchange',{token:'bad'})).status,401);assert.equal((await fixture.app.dispatchFetch(fixture.origin+'/api/modules/scheduling/appointments',{headers:{authorization:'Bearer '+cap.sessionToken}})).status,401);
 await fixture.db.prepare('UPDATE customer_management_sessions SET expires_at=1').run();assert.equal((await post('/manage/appointment',{},cap.sessionToken)).status,401);const fresh=await access(receipt.reference);await fixture.db.prepare('UPDATE scheduling_appointments SET customer_json=?,revision=revision+1 WHERE id=?').bind(JSON.stringify({name:'New customer',email:'new@example.test',phone:''}),receipt.reference).run();assert.equal((await post('/manage/appointment',{},fresh.sessionToken)).status,401);assert.equal((await post('/manage/exchange',{token:cap.token})).status,401);
});

test('email captures and retries require configuration authority and explicit acknowledgment',async()=>{
 await create();const row=(await mails())[0];assert.equal((await admin('/notifications','reader')).status,403);assert.equal((await admin('/notifications/'+row.id,'provider-user')).status,403);assert.equal((await fixture.ownerPost('/notifications/'+row.id+'/retry',{acknowledge:false})).status,400);
});

test('send mode uses the Cloudflare builder and records provider acceptance without claiming mailbox delivery',async()=>{
 const state=await fixture.config();state.config.notifications={enabled:true,mode:'send'};await fixture.ownerPost('/configuration',state);const {receipt}=await create();assert.equal(receipt.emailStatus,'accepted');assert.equal(sent.length,1);assert.equal(sent[0].attachments[0].type,'text/calendar; charset=utf-8');assert.ok(sent[0].html&&sent[0].text);const stored=await fixture.db.prepare('SELECT status,provider_message_id FROM scheduling_notification_outbox').first<{status:string;provider_message_id:string}>();assert.equal(stored?.status,'accepted');assert.equal(stored.provider_message_id,'synthetic-message-1');await(await fixture.app.getWorker()).scheduled({cron:'* * * * *'});assert.equal(sent.length,1);
});

test('ambiguous send responses never automatically resend, and retrying requires acknowledgment',async()=>{
 const state=await fixture.config();state.config.notifications={enabled:true,mode:'send'};await fixture.ownerPost('/configuration',state);sendFails=true;const {receipt}=await create();assert.equal(receipt.emailStatus,'unknown');assert.equal(sent.length,1);await(await fixture.app.getWorker()).scheduled({cron:'* * * * *'});assert.equal(sent.length,1);const row=(await mails())[0];sendFails=false;assert.equal((await fixture.ownerPost('/notifications/'+row.id+'/retry',{acknowledge:false})).status,400);assert.equal(sent.length,1);assert.equal((await fixture.ownerPost('/notifications/'+row.id+'/retry',{acknowledge:true})).status,200);assert.equal(sent.length,2);
});

test('test-recipient allowlisting blocks unapproved recipients before sending',async()=>{
 const state=await fixture.config();state.config.notifications={enabled:true,mode:'send'};await fixture.ownerPost('/configuration',state);const {receipt}=await create(0,{name:'Not allowed',email:'not-allowed@example.test',phone:''});assert.equal(receipt.emailStatus,'blocked');assert.equal(sent.length,0);
});


test('global management disabling, expired capabilities and foreign-site command guards cannot be bypassed',async()=>{
 const {receipt}=await create();const cap=await access(receipt.reference);const state=await fixture.config();state.config.customerManagement!.enabled=false;await fixture.ownerPost('/configuration',state);const current=await view(cap.sessionToken);assert.equal(current.canCancel,false);assert.equal((await post('/manage/cancel',command(current),cap.sessionToken)).status,409);
 await fixture.db.prepare('UPDATE customer_access_tokens SET expires_at=1').run();assert.equal((await post('/manage/exchange',{token:cap.token})).status,401);assert.equal((await post('/manage/appointment',{},cap.sessionToken)).status,401);
 const session=await fixture.db.prepare('SELECT session_hash FROM customer_management_sessions LIMIT 1').first<{session_hash:string}>();await assert.rejects(fixture.db.prepare("INSERT INTO customer_management_commands(site_id,command_key,session_hash,appointment_id,request_hash,kind,expected_revision,appointment_revision,response_json,created_at) VALUES('another-site','forged',?,?,?,'cancel',?,?,?,?)").bind(session!.session_hash,receipt.reference,'hash',current.scheduleRevision,current.revision,'{}',Date.now()).run(),/customer_access_denied/);
});

test('expired approval holds generate a cancellation calendar email without an active calendar connection',async()=>{
 const state=await fixture.config();state.config.services[0].bookingMode='approval';await fixture.ownerPost('/configuration',state);const {receipt}=await create();await fixture.db.prepare('UPDATE scheduling_appointments SET expires_at=1,revision=revision+1 WHERE id=?').bind(receipt.reference).run();await(await fixture.app.getWorker()).scheduled({cron:'* * * * *'});assert.equal((await fixture.db.prepare('SELECT status FROM scheduling_appointments WHERE id=?').bind(receipt.reference).first<{status:string}>())?.status,'expired');const out=(await mails()).find(row=>row.kind==='expired');assert.ok(out);const captured=await preview(out.id);assert.equal(captured.links,null);assert.match(Buffer.from(captured.message.attachments[0].content,'base64').toString(),/STATUS:CANCELLED/);
});

test('an expired in-flight send is marked uncertain and is not automatically repeated',async()=>{
 const {receipt}=await create();const row=(await mails())[0];await fixture.db.prepare("UPDATE scheduling_notification_outbox SET mode='send',status='sending',lease_id='expired-fixture',lease_until=1 WHERE id=?").bind(row.id).run();await(await fixture.app.getWorker()).scheduled({cron:'* * * * *'});assert.equal((await mails()).find(r=>r.appointmentId===receipt.reference)?.status,'unknown');assert.equal(sent.length,0);
});
