import test from 'node:test';import assert from 'node:assert/strict';import {signOnFixture} from './signon-fixture.ts';
const base='/api/webmaster-sso/v1';
function authCookie(response:Response){return /vitris-admin-local=([^;, ]+)/.exec(response.headers.get('set-cookie')||'')?.[0]||'';}
test('named sign-on requires explicit client-owner mapping, preserves approved permissions and ends with Vitris logout',async()=>{
 const f=await signOnFixture();try{const flow=await f.handshake(),pending=await f.complete(flow);assert.equal(pending.status,200);assert.equal((await pending.json() as any).status,'approval-required');assert.equal((await f.client.db.prepare('SELECT count(*) n FROM users').first<any>()).n,3);
 assert.equal((await f.client.request(base+'/approve',{stateId:flow.stateId,localUserId:'editor',approved:true},'editor',{cookie:f.client.cookies.editor+'; '+flow.flowCookie})).status,403);
 const response=await f.approve(flow);assert.equal(response.status,200,await response.clone().text());const cookie=authCookie(response as unknown as Response);assert.ok(cookie);const headers={cookie};
 const bootstrap=await(await f.client.request('/api/bootstrap',undefined,'',headers)).json() as any;assert.equal(bootstrap.user.id,'editor');assert.deepEqual(bootstrap.user.webmaster.permissions,['analytics:read']);assert.equal((await f.client.request('/api/leads',undefined,'',headers)).status,403);assert.equal((await f.client.request('/api/analytics',undefined,'',headers)).status,200);
 assert.equal((await f.broker.request('/api/auth/logout',{})).status,200);assert.equal((await f.client.request('/api/analytics',undefined,'',headers)).status,401);assert.equal((await(await f.client.request('/api/bootstrap',undefined,'',headers)).json() as any).user,null);
 assert.equal((await f.client.request('/api/analytics')).status,200);assert.equal((await f.client.db.prepare("SELECT status FROM webmaster_connections").first<any>()).status,'connected');
 }finally{await f.dispose();}
});
test('code replay, wrong browser, wrong audience, stale codes and changed/disabled sign-on identities fail closed',async()=>{
 const f=await signOnFixture();try{
 const flow=await f.handshake();assert.equal((await f.client.request(base+'/complete',{stateId:flow.stateId,flowId:flow.flowId,code:flow.code},'')).status,403);assert.equal((await f.complete(flow)).status,200);const approved=await f.approve(flow),cookie=authCookie(approved as unknown as Response);assert.ok(cookie);assert.equal((await f.complete(flow)).status,410);
 assert.equal((await f.client.request('/api/analytics',undefined,'',{cookie,'x-fixture':'disabled'})).status,401);assert.equal((await f.client.request('/api/analytics',undefined,'',{cookie,'x-fixture':'foreign'})).status,401);
 f.controls.unavailable=true;assert.equal((await f.client.request('/api/analytics',undefined,'',{cookie})).status,401);f.controls.unavailable=false;f.controls.wrongKey=true;assert.equal((await f.client.request('/api/analytics',undefined,'',{cookie})).status,401);f.controls.wrongKey=false;
 f.controls.redirect=true;assert.equal((await f.client.request('/api/analytics',undefined,'',{cookie})).status,401);f.controls.redirect=false;
 const expired=await f.handshake();await f.broker.db.prepare('UPDATE webmaster_sso_broker_flows SET code_expires_at=0 WHERE id=?').bind(expired.flowId).run();assert.notEqual((await f.complete(expired)).status,200);
 assert.equal((await f.client.request(base+'/revoke',{grantId:(await f.client.db.prepare('SELECT id FROM webmaster_sso_grants').first<any>()).id})).status,200);assert.equal((await f.client.request('/api/analytics',undefined,'',{cookie})).status,401);
 }finally{await f.dispose();}
});
test('individual membership removal stops human sign-on without disconnecting the organization',async()=>{
 const f=await signOnFixture();try{const flow=await f.handshake();await f.complete(flow);const response=await f.approve(flow),cookie=authCookie(response as unknown as Response);assert.ok(cookie);
 assert.equal((await f.client.request('/api/modules/webmaster',{organizationId:'vitris',organizationName:'Vitris',billingProvider:false,members:[],revision:1})).status,200);assert.equal((await f.client.request('/api/analytics',undefined,'',{cookie})).status,401);assert.equal((await f.client.db.prepare('SELECT status FROM webmaster_connections').first<any>()).status,'connected');
 const next=await f.handshake();assert.equal((await f.complete(next)).status,403);
 }finally{await f.dispose();}
});

test('only the configured broker subject may launch, and browser Origin checks apply to client approval',async()=>{
 const f=await signOnFixture();try{
 assert.equal((await f.broker.request('/api/modules/sso-fixture',{},'administrator')).status,403);assert.equal((await f.broker.request('/api/modules/sso-fixture',{},'')).status,401);assert.equal((await f.broker.request('/api/modules/sso-fixture',{},'owner',{origin:'https://attacker.example.com'})).status,403);assert.equal((await f.broker.request('/api/modules/sso-fixture')).status,403);
 const flow=await f.handshake();assert.equal((await f.client.request(base+'/complete',{stateId:flow.stateId,flowId:flow.flowId,code:flow.code},'',{cookie:flow.flowCookie,origin:'https://attacker.example.com'})).status,403);await f.complete(flow);
 assert.equal((await f.client.request(base+'/approve',{stateId:flow.stateId,localUserId:'editor',approved:true},'owner',{cookie:f.client.cookies.owner+'; '+flow.flowCookie,origin:'https://attacker.example.com'})).status,403);
 assert.equal((await f.client.db.prepare('SELECT count(*) n FROM webmaster_sso_grants').first<any>()).n,0);
 }finally{await f.dispose();}
});
test('Vitris logout before code exchange cannot establish a client session; organization disconnect cannot resurrect one',async()=>{
 const f=await signOnFixture();try{const flow=await f.handshake();await f.broker.request('/api/auth/logout',{});assert.equal((await f.complete(flow)).status,401);assert.equal((await f.client.db.prepare('SELECT count(*) n FROM webmaster_sso_sessions').first<any>()).n,0);}finally{await f.dispose();}
 const g=await signOnFixture();try{const flow=await g.handshake();await g.complete(flow);const response=await g.approve(flow),cookie=authCookie(response as unknown as Response);assert.ok(cookie);assert.equal((await g.client.request('/api/modules/webmaster/disconnect',{revision:1,acknowledgeSubscription:true})).status,200);assert.equal((await g.client.request('/api/modules/webmaster',{organizationId:'vitris',organizationName:'Vitris',billingProvider:false,members:[{userId:'editor',permissions:['analytics:read']}],revision:2})).status,200);assert.equal((await g.client.request('/api/analytics',undefined,'',{cookie})).status,401);assert.notEqual((await g.client.db.prepare('SELECT revoked_at FROM webmaster_sso_grants').first<any>()).revoked_at,null);}finally{await g.dispose();}
});
