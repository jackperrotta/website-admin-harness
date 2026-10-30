import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createSchedulingBrowserFixture} from './scheduling-browser-fixture.ts';
import {schedulingFixture} from './scheduling-fixture.ts';
import {CalendarProviderFixture} from './calendar-provider-fixture.ts';
import type {PublicBookingCatalog,PublicBookingReceipt,SchedulingAvailabilityResponse} from '../packages/contracts/src/scheduling.ts';
const website='http://127.0.0.1:4392',provider=new CalendarProviderFixture();let fixture:Awaited<ReturnType<typeof createSchedulingBrowserFixture>>;
const start=Math.ceil((Date.now()+5*86400000)/3600000)*3600000,iso=(minutes=0)=>new Date(start+minutes*60000).toISOString();
before(async()=>{fixture=await createSchedulingBrowserFixture({websiteOrigin:website,calendar:provider,simulated:true,bindings:{BOOKING_ENABLED:'1',BOOKING_LOCAL_TEST:'1'}});});
after(async()=>{await fixture?.app.dispose();});
beforeEach(async()=>{provider.reset();const config=schedulingFixture();config.publicBooking={enabled:true,serviceIds:['visit','consult'],allowProviderChoice:true,policyText:'For changes, contact the business.\nRequests requiring approval are not yet confirmed.'};await fixture.reset(config);await provider.seed(fixture.db);});
const call=(path:string,value?:unknown,origin=website)=>fixture.app.dispatchFetch(fixture.origin+'/api/booking/v1'+path,{method:value===undefined?'GET':'POST',headers:{origin,...(value===undefined?{}:{'content-type':'application/json'})},...(value===undefined?{}:{body:JSON.stringify(value)})});
const admin=(path:string)=>fixture.app.dispatchFetch(fixture.origin+'/api/modules/scheduling'+path,{headers:{cookie:`vitris-admin-local=${fixture.sessions.get('owner')}`}});
async function slots(minutes=0){return call('/availability?'+new URLSearchParams({serviceId:'visit',locationId:'main',providerId:'provider-a',startsAt:iso(minutes),endsAt:iso(minutes+1)}));}
async function request(minutes=0){const available=await slots(minutes);assert.equal(available.status,200,await available.clone().text());const data=await available.json() as SchedulingAvailabilityResponse;return {idempotencyKey:crypto.randomUUID(),revision:data.revision,serviceId:'visit',locationId:'main',providerId:'provider-a',startsAt:iso(minutes),customer:{name:'Website Customer',email:'website@example.test',phone:''},acceptedPolicy:true,challengeToken:'',company:''};}

test('public catalog is explicit, identity-bound and excludes private accounts, resources, policies and appointment records',async()=>{
 const response=await call('/catalog');assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),website);assert.equal(response.headers.get('access-control-allow-credentials'),null);assert.equal(response.headers.get('cache-control'),'no-store');
 const catalog=await response.json() as PublicBookingCatalog;assert.equal(catalog.siteOrigin,website);assert.equal(catalog.siteId,'scheduling-browser');assert.equal(catalog.challenge.kind,'local-fixture');assert.deepEqual(catalog.services.map(s=>s.id),['visit','consult']);assert.ok(!JSON.stringify(catalog).includes('provider-user'));assert.ok(!JSON.stringify(catalog).includes('Synthetic room'));assert.ok(!('grants' in catalog));
 const state=await fixture.config();state.config.publicBooking!.serviceIds=['visit'];await fixture.ownerPost('/configuration',state);assert.deepEqual((await(await call('/catalog')).json() as PublicBookingCatalog).services.map(s=>s.id),['visit']);
});

test('a guest booking uses native reservations and appears in the authenticated admin calendar and history',async()=>{
 const input=await request(),response=await call('/appointments',input);assert.equal(response.status,201,await response.clone().text());const receipt=await response.json() as PublicBookingReceipt;assert.equal(receipt.status,'confirmed');assert.match(receipt.calendar.content,/BEGIN:VCALENDAR/);assert.equal(receipt.delivery,'captured');
 const list=await(await admin('/appointments?'+new URLSearchParams({startsAt:iso(),endsAt:iso(60)}))).json() as {rows:{id:string;customer:{email:string}}[]};assert.equal(list.rows.length,1);assert.equal(list.rows[0].id,receipt.reference);assert.equal(list.rows[0].customer.email,input.customer.email);
 const history=await(await admin(`/appointments/${receipt.reference}/history`)).json() as {rows:{action:string}[]};assert.ok(history.rows.some(row=>row.action==='Customer booked on website'));
 assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM scheduling_reservations').first<{n:number}>())?.n,2);assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM scheduling_commands').first<{n:number}>())?.n,0);assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM scheduling_jobs').first<{n:number}>())?.n,2);
});

test('summary and booking details retain website provenance and accepted policy with provider and account isolation',async()=>{
 const input=await request(),receipt=await(await call('/appointments',input)).json() as PublicBookingReceipt;
 const state=await fixture.config(); state.config.publicBooking!.policyText='New policy after booking'; state.config.grants=[{userId:'provider-user',scope:'own',permissions:['appointments:read']}]; await fixture.ownerPost('/configuration',state);
 const detail=await(await admin(`/appointments/${receipt.reference}`)).json() as {source:string;acceptedPolicy:string};
 assert.equal(detail.source,'website');assert.equal(detail.acceptedPolicy,receipt.policyText);
 const summary=await(await admin('/summary')).json() as {upcoming:number;pendingApproval:number;next:{source:string}[]};
 assert.equal(summary.upcoming,1);assert.equal(summary.pendingApproval,0);assert.equal(summary.next[0].source,'website');
 const scoped=(path:string,user:string)=>fixture.app.dispatchFetch(fixture.origin+'/api/modules/scheduling'+path,{headers:{cookie:`vitris-admin-local=${fixture.sessions.get(user)}`}});
 assert.equal((await scoped('/summary','reader')).status,403);assert.equal((await scoped('/booking-readiness','provider-user')).status,403);
 const config=await fixture.config();delete config.config.resources.find(r=>r.id==='provider-a')!.userId;config.config.resources.find(r=>r.id==='provider-b')!.userId='provider-user';const changed=await fixture.ownerPost('/configuration',config);assert.equal(changed.status,200,await changed.text());
 assert.equal((await(await scoped('/summary','provider-user')).json() as {upcoming:number}).upcoming,0);
 assert.equal((await scoped(`/appointments/${receipt.reference}`,'provider-user')).status,404);
 await fixture.db.prepare("UPDATE users SET active=0 WHERE id='provider-user'").run();
 assert.equal((await scoped('/summary','provider-user')).status,401);
 await fixture.db.prepare("UPDATE users SET active=1 WHERE id='provider-user'").run();
});

test('readiness separates server flags, local challenge fixtures, publication and unhealthy calendars',async()=>{
 const ready=await(await admin('/booking-readiness')).json() as {ready:boolean;simulated:boolean;checks:{id:string;ready:boolean}[];connection:{siteId:string}};
 assert.equal(ready.ready,true);assert.equal(ready.simulated,true);assert.equal(ready.connection.siteId,'scheduling-browser');
 const destination=provider.calendars('google')[0].id;assert.equal((await fixture.ownerPost('/connections/synthetic-google/select',{revision:0,blocking:[destination],destination,acknowledge:true})).status,200);
 await fixture.db.prepare("UPDATE calendar_connections SET health='error' WHERE site_id=? AND id='synthetic-google'").bind('scheduling-browser').run();
 const unhealthy=await(await admin('/booking-readiness')).json() as typeof ready;assert.equal(unhealthy.checks.find(c=>c.id==='calendars')?.ready,false);
 const state=await fixture.config();state.config.publicBooking!.enabled=false;await fixture.ownerPost('/configuration',state);
 const paused=await(await admin('/booking-readiness')).json() as typeof ready;
 assert.equal(paused.ready,false);assert.equal(paused.checks.find(c=>c.id==='publication')?.ready,false);assert.equal(paused.checks.find(c=>c.id==='challenge')?.ready,true);
});

test('guest retries and races produce one appointment while changed content conflicts',async()=>{
 const input=await request(),responses=await Promise.all([call('/appointments',input),call('/appointments',input)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);const a=await responses[0].json() as PublicBookingReceipt,b=await responses[1].json() as PublicBookingReceipt;assert.equal(a.reference,b.reference);
 assert.equal((await call('/appointments',{...input,customer:{...input.customer,name:'Changed'}})).status,409);
 assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM scheduling_appointments').first<{n:number}>())?.n,1);
});

test('different guests racing for a last slot cannot both book, and a stale selection never overwrites a booking',async()=>{
 const input=await request(),responses=await Promise.all([call('/appointments',input),call('/appointments',{...input,idempotencyKey:crypto.randomUUID()})]);assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM scheduling_appointments').first<{n:number}>())?.n,1);
});

test('approval requests reserve time and admin approval operates on the same customer appointment',async()=>{
 const state=await fixture.config();state.config.services[0].bookingMode='approval';await fixture.ownerPost('/configuration',state);const response=await call('/appointments',await request());assert.equal(response.status,201);const receipt=await response.json() as PublicBookingReceipt;assert.equal(receipt.status,'pending_approval');assert.ok(receipt.expiresAt);assert.match(receipt.calendar.content,/STATUS:TENTATIVE/);
 const approval=await fixture.ownerPost(`/appointments/${receipt.reference}/status`,{idempotencyKey:crypto.randomUUID(),revision:(await fixture.config()).revision,appointmentRevision:1,status:'confirmed'});assert.equal(approval.status,200,await approval.clone().text());assert.equal((await(await admin(`/appointments/${receipt.reference}`)).json() as {status:string}).status,'confirmed');
});

test('exact origins, JSON, strict inputs, public visibility and paused settings are enforced without admin authority',async()=>{
 assert.equal((await call('/catalog',undefined,'https://evil.example')).status,403);assert.equal((await call('/catalog',undefined,'null')).headers.get('access-control-allow-origin'),null);
 assert.equal((await fixture.app.dispatchFetch(fixture.origin+'/api/booking/v1/catalog')).status,403);
 const preflight=await fixture.app.dispatchFetch(fixture.origin+'/api/booking/v1/appointments',{method:'OPTIONS',headers:{origin:website,'access-control-request-method':'POST','access-control-request-headers':'content-type'}});assert.equal(preflight.status,204);
 const input=await request();for(const patch of [{status:'confirmed'},{siteId:'other'},{price:1},{acceptedPolicy:false},{company:'spam'},{idempotencyKey:'guessable'}])assert.equal((await call('/appointments',{...input,...patch})).status,400);
 assert.equal((await call('/availability?'+new URLSearchParams({serviceId:'visit',locationId:'main',startsAt:iso(),endsAt:iso(1),appointmentId:'private'}))).status,400);
 const state=await fixture.config();state.config.publicBooking!.enabled=false;await fixture.ownerPost('/configuration',state);assert.equal((await call('/catalog')).status,503);assert.equal((await call('/appointments',input)).status,503);
 assert.equal((await fixture.app.dispatchFetch(fixture.origin+'/api/modules/scheduling/appointments',{method:'POST',headers:{origin:website,'content-type':'application/json'},body:JSON.stringify(input)})).status,403);
});

test('changed service price and policy are returned with availability before submission',async()=>{
 const state=await fixture.config();state.config.services[0].price.amountMinor=7500;state.config.publicBooking!.policyText='Revised policy';await fixture.ownerPost('/configuration',state);
 const data=await(await slots()).json() as {terms:{price:{amountMinor:number}};policyText:string};assert.equal(data.terms.price.amountMinor,7500);assert.equal(data.policyText,'Revised policy');
});

test('required external calendars block guest availability and receive guest appointment exports',async()=>{
 const destination=provider.calendars('google')[0].id;assert.equal((await fixture.ownerPost('/connections/synthetic-google/select',{revision:0,blocking:[destination],destination,acknowledge:true})).status,200);
 provider.add('google',start,start+3600000);await fixture.ownerPost('/connections/synthetic-google/sync',{});assert.equal((await(await slots()).json() as SchedulingAvailabilityResponse).slots.length,0);
 const response=await call('/appointments',await request(120));assert.equal(response.status,201,await response.clone().text());assert.equal([...provider.events.values()].filter(e=>e.marker).length,1);
});

test('submission limits are atomic, bounded, and store no raw IP address',async()=>{
 const input=await request();const responses=await Promise.all(Array.from({length:8},()=>call('/appointments',{...input,idempotencyKey:crypto.randomUUID(),company:'spam'})));assert.ok(responses.some(r=>r.status===429));assert.ok(responses.every(r=>[400,429].includes(r.status)));
 const rows=(await fixture.db.prepare('SELECT key_hash FROM booking_rate_limits').all<{key_hash:string}>()).results;assert.ok(rows.every(r=>/^[a-f0-9]{64}$/.test(r.key_hash)));
});

test('a non-loopback site cannot enable the local challenge bypass and real validation checks action and hostname',async()=>{
 let valid=false,calls=0;
 const real=await createSchedulingBrowserFixture({websiteOrigin:'https://booking.example.test',bindings:{BOOKING_ENABLED:'1',BOOKING_LOCAL_TEST:'1',BOOKING_RATE_SECRET:'synthetic-rate-key-for-provider-tests-123456',BOOKING_TURNSTILE_SITE_KEY:'synthetic-public-site-key',BOOKING_TURNSTILE_SECRET:'synthetic-private-secret'},challengeHttp:async request=>{calls++;const values=new URLSearchParams(await request.text());assert.equal(values.get('secret'),'synthetic-private-secret');return Response.json({success:true,hostname:valid?'booking.example.test':'evil.example.test',action:'booking'});}});
 try{const config=schedulingFixture();config.publicBooking={enabled:true,serviceIds:['visit'],allowProviderChoice:true,policyText:'Test policy'};await real.reset(config);
 const run=(path:string,input?:unknown)=>real.app.dispatchFetch(real.origin+'/api/booking/v1'+path,{method:input?'POST':'GET',headers:{origin:'https://booking.example.test','cf-connecting-ip':'192.0.2.41',...(input?{'content-type':'application/json'}:{})},...(input?{body:JSON.stringify(input)}:{})});
 const catalog=await(await run('/catalog')).json() as PublicBookingCatalog;assert.equal(catalog.challenge.kind,'turnstile');
 const input={...await request(),revision:0,challengeToken:'synthetic-challenge'};assert.equal((await run('/appointments',input)).status,400);valid=true;assert.equal((await run('/appointments',input)).status,201);assert.equal((await run('/appointments',input)).status,200);assert.equal(calls,2);
 }finally{await real.app.dispose();}
});
