import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pairingFixture} from './pairing-fixture.ts';

test('client-owner approval creates analytics-only reporting with no human membership or billing access',async()=>{
 const f=await pairingFixture();try{
 const pending=await f.start();assert.equal((await f.request(f.sdk.pairingBase+'/approve',{requestId:pending.requestId,approved:true},'editor')).status,403);
 assert.equal((await f.request(f.sdk.pairingBase+'/approve',{requestId:pending.requestId,approved:true},'owner',{origin:'https://foreign.example.com'})).status,403);
 const view=await(await f.request(f.sdk.pairingBase+'/approval?id='+pending.requestId)).json() as any;assert.equal(view.createsRelationship,true);assert.equal(view.scope,'analytics:read');assert.ok(!JSON.stringify(view).includes('verifier'));
 assert.equal((await f.approve(pending.requestId)).status,200);const code=(await f.client.call(f.manifest.adminOrigin,'poll',{requestId:pending.requestId})).code;
 const input={requestId:pending.requestId,code,verifier:pending.verifier};
 const [a,b]=await Promise.all([f.client.call(f.manifest.adminOrigin,'exchange',input),f.client.call(f.manifest.adminOrigin,'exchange',input)]);assert.deepEqual(a,b);assert.equal((await f.db.prepare('SELECT count(*) n FROM webmaster_reporting_grants').first<any>()).n,1);
 assert.equal((await f.db.prepare('SELECT count(*) n FROM webmaster_members').first<any>()).n,0);
 const report=await f.client.call(f.manifest.adminOrigin,'report',{grantId:a.grantId,operation:'analytics',days:14},a.token);assert.equal(report.data.rows[0].views,3);assert.deepEqual(JSON.parse(report.data.rows[0].top_paths_json),[{key:'/',n:3}]);assert.ok(!JSON.stringify(report).includes('synthetic-backend-secret'));assert.ok(!JSON.stringify(report).includes('leads:write'));
 await assert.rejects(f.client.call(f.manifest.adminOrigin,'report',{grantId:a.grantId,operation:'leads'},a.token));
 const listed=await(await f.request(f.sdk.pairingBase+'/grants')).text();assert.ok(!listed.includes(a.token));assert.ok(!listed.includes('key_json'));
 const audit=JSON.stringify((await f.db.prepare('SELECT * FROM audit').all()).results);assert.ok(!audit.includes(code));assert.ok(!audit.includes(a.token));
 }finally{await f.app.dispose();}
});

test('credentials require the pinned consumer key; expiry, audience, replay and disabled issuers fail closed',async()=>{
 const f=await pairingFixture();try{
 const {credential:c}=await f.paired();const foreign=new f.sdk.PairingClient({...f.peer,installationId:'wrong-installation'},f.privateJWK,f.transport,true);await assert.rejects(foreign.call(f.manifest.adminOrigin,'report',{grantId:c.grantId,operation:'status'},c.token));
 const key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const attackerKey=JSON.stringify(await crypto.subtle.exportKey('jwk',key.privateKey));const attacker=new f.sdk.PairingClient(f.peer,attackerKey,f.transport,true);
 f.controls.proofKey=attackerKey;await assert.rejects(attacker.call(f.manifest.adminOrigin,'report',{grantId:c.grantId,operation:'status'},c.token));assert.equal((await f.client.call(f.manifest.adminOrigin,'report',{grantId:c.grantId,operation:'status'},c.token)).scope,'analytics:read');
 assert.equal((await f.request(f.sdk.pairingBase+'/capabilities',undefined,'owner',{'x-fixture':'disabled'})).status,404);
 let captured:Request|undefined;const capture=new f.sdk.PairingClient(f.peer,f.privateJWK,async(request:Request)=>{captured=request.clone() as unknown as Request;return f.transport(request);},true);await capture.call(f.manifest.adminOrigin,'report',{grantId:c.grantId,operation:'status'},c.token);assert.equal((await f.transport(captured!)).status,409);
 f.controls.proofKey=f.privateJWK;const pending=await f.start();await f.db.prepare('UPDATE webmaster_pairing_requests SET expires_at=0 WHERE id=?').bind(pending.requestId).run();assert.equal((await f.approve(pending.requestId)).status,410);
 }finally{await f.app.dispose();}
});

test('rotation retries recover the same credential and organization revocation survives reconnect',async()=>{
 const f=await pairingFixture();try{
 const {credential:c}=await f.paired(),op={grantId:c.grantId,operationId:f.sdk.random()};const rotated=await f.client.call(f.manifest.adminOrigin,'rotate',op,c.token);assert.deepEqual(await f.client.call(f.manifest.adminOrigin,'rotate',op,c.token),rotated);
 await assert.rejects(f.client.call(f.manifest.adminOrigin,'report',{grantId:c.grantId,operation:'status'},c.token));
 const config={organizationId:f.peer.organizationId,organizationName:f.peer.organizationName,billingProvider:false,members:[{userId:'editor',permissions:['analytics:read']}],revision:1};assert.equal((await f.request('/api/modules/webmaster',config)).status,200);assert.equal((await f.request('/api/modules/webmaster',{...config,members:[],revision:2})).status,200);
 assert.equal((await f.client.call(f.manifest.adminOrigin,'report',{grantId:c.grantId,operation:'status'},rotated.token)).scope,'analytics:read');
 assert.equal((await f.request('/api/modules/webmaster/disconnect',{revision:3,acknowledgeSubscription:true})).status,200);await assert.rejects(f.client.call(f.manifest.adminOrigin,'report',{grantId:c.grantId,operation:'status'},rotated.token));
 assert.equal((await f.request('/api/modules/webmaster',{...config,members:[],revision:4})).status,200);await assert.rejects(f.client.call(f.manifest.adminOrigin,'report',{grantId:c.grantId,operation:'status'},rotated.token));
 }finally{await f.app.dispose();}
});

test('a grant revoked during a backend read cannot return or record a successful report',async()=>{
 const f=await pairingFixture();try{const {credential:c}=await f.paired();f.controls.afterAnalytics=async()=>{await f.db.prepare('UPDATE webmaster_reporting_grants SET revoked_at=1 WHERE id=?').bind(c.grantId).run();};await assert.rejects(f.client.call(f.manifest.adminOrigin,'report',{grantId:c.grantId,operation:'analytics',days:30},c.token));assert.equal((await f.db.prepare('SELECT last_used_at FROM webmaster_reporting_grants WHERE id=?').bind(c.grantId).first<any>()).last_used_at,null);}finally{await f.app.dispose();}
});


test('exchange recovery outlives code expiry; re-pairing replaces old grants and DB-level organization revocation survives old runtimes',async()=>{
 const f=await pairingFixture();try{
 const first=await f.paired();await f.db.prepare('UPDATE webmaster_pairing_requests SET expires_at=0 WHERE id=?').bind(first.requestId).run();assert.deepEqual(await f.client.call(f.manifest.adminOrigin,'exchange',first.data),first.credential);
 const second=await f.paired();await assert.rejects(f.client.call(f.manifest.adminOrigin,'report',{grantId:first.credential.grantId,operation:'status'},first.credential.token));
 // Simulate the previous runtime's ordinary relationship UPDATE, without new route hooks.
 await f.db.prepare("UPDATE webmaster_connections SET status='disconnected' WHERE installation_id=? AND site_id=? AND admin_origin=?").bind(f.manifest.installationId,f.manifest.site.id,f.manifest.adminOrigin).run();
 await f.db.prepare("UPDATE webmaster_connections SET status='connected' WHERE installation_id=? AND site_id=? AND admin_origin=?").bind(f.manifest.installationId,f.manifest.site.id,f.manifest.adminOrigin).run();await assert.rejects(f.client.call(f.manifest.adminOrigin,'report',{grantId:second.credential.grantId,operation:'status'},second.credential.token));
 }finally{await f.app.dispose();}
});

test('client owners can decline pending approval; unknown fields, scopes and stale signed envelopes cannot issue grants',async()=>{
 const f=await pairingFixture();try{
 const pending=await f.start();assert.equal((await f.request(f.sdk.pairingBase+'/reject',{requestId:pending.requestId},'administrator')).status,403);assert.equal((await f.request(f.sdk.pairingBase+'/reject',{requestId:pending.requestId})).status,200);await assert.rejects(f.client.call(f.manifest.adminOrigin,'poll',{requestId:pending.requestId}));
 const rejected=new f.sdk.PairingClient(f.peer,f.privateJWK,async(request:Request)=>{const body=JSON.parse(await request.text());body.time-=10000;const key=await f.sdk.signingKey(f.privateJWK),raw=JSON.stringify(body);return f.transport(new Request(request.url,{method:'POST',headers:{'content-type':'application/json','x-webmaster-signature':await f.sdk.sign(raw,key.privateKey)},body:raw}));},true);
 await assert.rejects(rejected.call(f.manifest.adminOrigin,'request',{requestId:f.sdk.random(),challenge:await f.sdk.hash(f.sdk.random())}));
 await assert.rejects(f.client.call(f.manifest.adminOrigin,'request',{requestId:f.sdk.random(),challenge:await f.sdk.hash(f.sdk.random()),scope:'leads:read'}));
 assert.equal((await f.db.prepare('SELECT count(*) n FROM webmaster_reporting_grants').first<any>()).n,0);
 }finally{await f.app.dispose();}
});


test('reporting transport is redirect-free, bounded and never delivers secrets to a changed path',async()=>{
 const f=await pairingFixture();try{
  const {credential:c}=await f.paired();
  let seen:Request|undefined;const redirected=new f.sdk.PairingClient(f.peer,f.privateJWK,async(request:Request)=>{seen=request;return new Response('',{status:302,headers:{location:'https://untrusted.example.com/collect'}});},true);
  await assert.rejects(redirected.call(f.manifest.adminOrigin,'report',{grantId:c.grantId,operation:'status'},c.token));assert.equal(seen!.redirect,'manual');
  await assert.rejects(f.sdk.boundedJSON(new Response(JSON.stringify({data:'x'.repeat(200)})),100));
  await assert.rejects(f.sdk.readJSON(new Request(f.manifest.adminOrigin,{method:'POST',headers:{'content-type':'application/json-attacker'},body:'{}'})));
  const foreign=new f.sdk.PairingClient(f.peer,f.privateJWK,async(request:Request)=>{const response=await f.app.dispatchFetch(request.url,{method:'POST',headers:{...Object.fromEntries(request.headers),'x-fixture':'foreign'},body:await request.text()});return new Response(await response.text(),{status:response.status});},true);
  await assert.rejects(foreign.call(f.manifest.adminOrigin,'report',{grantId:c.grantId,operation:'status'},c.token));
  assert.equal((await f.client.call(f.manifest.adminOrigin,'report',{grantId:c.grantId,operation:'status'},c.token)).scope,'analytics:read');
 }finally{await f.app.dispose();}
});
