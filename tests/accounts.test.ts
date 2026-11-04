import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accountFixture,syntheticPassword} from './accounts-fixture.ts';
import type {BootstrapResponse,AccessResponse} from '../packages/contracts/src/index.ts';

test('designated owner setup is neutral, scoped, explicit and atomic under competing completions',async()=>{
 const f=await accountFixture();try{await f.migrate();await f.db.prepare('INSERT INTO auth_owner_setup(installation_id,admin_origin,email) VALUES(?,?,?)').bind(f.manifest.installationId,f.origin,'owner@example.test').run();
 const boot=await(await f.request('/api/bootstrap')).json() as BootstrapResponse;assert.equal(boot.accountAuth?.setupAvailable,true);assert.equal(boot.localDemo,false);
 const known=await f.request('/api/auth/setup/request',{email:'owner@example.test'}),unknown=await f.request('/api/auth/setup/request',{email:'stranger@example.test'});assert.deepEqual(await known.json(),await unknown.json());
 assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM users').first<{n:number}>())?.n,0);await f.tick();const raw=await f.token('owner@example.test');
 const mail=await f.mail('owner@example.test');assert.equal(mail.from,'accounts@tryvitris.com');assert.ok(mail.text.includes(f.origin+'/account/activate#'));assert.match(mail.subject,/Synthetic Studio/);
 assert.equal((await f.request('/api/auth/action',{token:raw},'','https://other.synthetic.test')).status,400);
 assert.equal((await f.request('/api/auth/action',{token:raw},'',f.origin,'https://evil.test')).status,403);
 assert.equal((await f.request('/api/auth/action/complete',{token:raw,password:'short',confirmPassword:'short'})).status,400);
 assert.equal((await f.request('/api/auth/action',{token:raw})).status,200);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM users').first<{n:number}>())?.n,0);
 const results=await Promise.all([1,2].map(()=>f.request('/api/auth/action/complete',{token:raw,password:syntheticPassword,confirmPassword:syntheticPassword})));assert.deepEqual(results.map(x=>x.status).sort(),[200,400]);assert.ok(results.every(r=>!r.headers.get('set-cookie')));
 assert.equal((await f.request('/api/auth/action',{token:raw})).status,400);const cookie=await f.login('owner@example.test');const signed=await(await f.request('/api/bootstrap',undefined,cookie)).json() as BootstrapResponse;assert.equal(signed.accountAuth?.canInvite,true);assert.equal(signed.accountAuth?.setupAvailable,false);
 await assert.rejects(()=>f.db.prepare('INSERT INTO auth_owner_setup VALUES(?,?,?,NULL)').bind('other','https://other.synthetic.test','stranger@example.test').run(),/auth_owner_exists/);
 const stored=JSON.stringify((await f.db.prepare('SELECT * FROM auth_actions').all()).results)+JSON.stringify((await f.db.prepare('SELECT * FROM auth_mail_outbox').all()).results)+JSON.stringify((await f.db.prepare('SELECT * FROM audit').all()).results);assert.ok(!stored.includes(raw));assert.ok(!stored.includes(syntheticPassword));
 assert.equal((await f.request('/api/auth/request',{email:'owner@example.test'})).status,404);
 }finally{await f.app.dispose();}
});

test('existing credentials and sessions survive migration; verified owners alone may invite with a fresh password',async()=>{
 const f=await accountFixture();try{const address=await f.seed('owner');const cookie=await f.login(address,syntheticPassword,true);const before=await f.db.prepare('SELECT * FROM password_credentials').first();await f.migrate();assert.deepEqual(await f.db.prepare('SELECT * FROM password_credentials').first(),before);assert.equal((await f.request('/api/bootstrap',undefined,cookie)).status,200);
 assert.equal((await f.request('/api/access/invitations',{email:'editor@example.test',role:'editor',currentPassword:syntheticPassword},cookie)).status,403);
 await f.request('/api/auth/verification/request',{},cookie);await f.tick();const raw=await f.token(address);assert.equal((await f.request('/api/auth/action/complete',{token:raw})).status,200);
 assert.equal((await f.request('/api/access/invitations',{email:'editor@example.test',role:'editor',currentPassword:'wrong'},cookie)).status,403);
 assert.equal((await f.request('/api/access/invitations',{email:'editor@example.test',role:'owner',currentPassword:syntheticPassword},cookie)).status,400);
 const admin=await f.seed('admin','administrator');await f.db.prepare('INSERT INTO auth_profiles VALUES(?,?,?,unixepoch(),1)').bind(f.manifest.installationId,f.origin,'admin').run();const adminCookie=await f.login(admin);
 assert.equal((await f.request('/api/access/invitations',{email:'editor@example.test',role:'editor',currentPassword:syntheticPassword},adminCookie)).status,403);
 // A successful verification keeps this session; invitations get a separate scope and purpose.
 await f.db.prepare('DELETE FROM auth_limits').run();assert.equal((await f.request('/api/access/invitations',{email:'editor@example.test',role:'editor',currentPassword:syntheticPassword},cookie)).status,200);await f.tick();const invite=await f.token('editor@example.test');assert.equal((await f.request('/api/auth/action/complete',{token:invite,password:syntheticPassword,confirmPassword:syntheticPassword})).status,200);
 const editorCookie=await f.login('editor@example.test');assert.equal((await f.request('/api/access',undefined,editorCookie)).status,403);const users=await(await f.request('/api/access',undefined,cookie)).json() as AccessResponse;assert.equal(users.rows.find(u=>u.email==='editor@example.test')?.email_verified_at!>0,true);assert.equal(users.invitations?.[0].status,'accepted');assert.ok(!JSON.stringify(users).includes(invite));
 }finally{await f.app.dispose();}
});

test('reset uses only the newest link, revokes sessions and legacy login tokens, preserves role and never auto-signs in',async()=>{
 const f=await accountFixture();try{await f.seed('owner');await f.migrate();const cookie=await f.login('owner@example.test');await f.db.prepare('INSERT INTO login_tokens VALUES(?,?,?)').bind(f.hash('old-login-link'),'owner',Math.floor(Date.now()/1000)+600).run();
 const known=await f.request('/api/auth/password/reset/request',{email:'owner@example.test'}),unknown=await f.request('/api/auth/password/reset/request',{email:'unknown@example.test'});assert.deepEqual(await known.json(),await unknown.json());await f.tick();const old=await f.token('owner@example.test');await f.request('/api/auth/password/reset/request',{email:'owner@example.test'});await f.tick();const raw=await f.token('owner@example.test');assert.notEqual(raw,old);assert.equal((await f.request('/api/auth/action',{token:old})).status,400);
 const password='A different synthetic passphrase';const result=await f.request('/api/auth/action/complete',{token:raw,password,confirmPassword:password});assert.equal(result.status,200);assert.equal(result.headers.get('set-cookie'),null);
 const boot=await(await f.request('/api/bootstrap',undefined,cookie)).json() as BootstrapResponse;assert.equal(boot.user,null);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM login_tokens').first<{n:number}>())?.n,0);assert.equal((await f.request('/api/auth/password',{email:'owner@example.test',password:syntheticPassword})).status,401);await f.login('owner@example.test',password);assert.equal((await f.db.prepare("SELECT role FROM users WHERE id='owner'").first<{role:string}>())?.role,'owner');await f.tick();assert.match((await f.mail('owner@example.test')).subject,/Password changed/);
 assert.equal((await f.request('/api/auth/action/complete',{token:raw,password,confirmPassword:password})).status,400);
 }finally{await f.app.dispose();}
});

test('revocation, expiration and ownership changes invalidate invitations; disabled/not-ready routes fail closed',async()=>{
 const f=await accountFixture();try{await f.seed('owner');await f.migrate();await f.db.prepare('INSERT INTO auth_profiles VALUES(?,?,?,unixepoch(),1)').bind(f.manifest.installationId,f.origin,'owner').run();const cookie=await f.login('owner@example.test');
 const invite=async(email:string)=>{await f.request('/api/access/invitations',{email,role:'analyst',currentPassword:syntheticPassword},cookie);await f.tick();return f.token(email);};
 const raw=await invite('canceled@example.test'),id=f.hash(raw);assert.equal((await f.request(`/api/access/invitations/${id}/cancel`,{},cookie)).status,200);assert.equal((await f.request('/api/auth/action',{token:raw})).status,400);
 const expired=await invite('expired@example.test');await f.db.prepare('UPDATE auth_actions SET expires_at=1 WHERE digest=?').bind(f.hash(expired)).run();assert.equal((await f.request('/api/auth/action/complete',{token:expired,password:syntheticPassword,confirmPassword:syntheticPassword})).status,400);
 await f.db.prepare('DELETE FROM auth_limits').run();const revoked=await invite('revoked@example.test');await f.db.prepare("UPDATE users SET role='administrator' WHERE id='owner'").run();assert.equal((await f.request('/api/auth/action/complete',{token:revoked,password:syntheticPassword,confirmPassword:syntheticPassword})).status,400);assert.equal((await f.request('/api/access',undefined,cookie)).status,401);
 assert.equal((await f.request('/api/auth/setup/request',{email:'owner@example.test'},'','https://disabled.synthetic.test')).status,401);assert.equal((await f.request('/__test/not-ready')).status,503);
 }finally{await f.app.dispose();}
});

test('mail failures stay private and require a new link; email changes revoke pending reset and sign-in sessions',async()=>{
 const f=await accountFixture();try{await f.seed('owner');await f.migrate();const cookie=await f.login('owner@example.test');await f.db.prepare('INSERT INTO auth_test_config VALUES(1)').run();assert.equal((await f.request('/api/auth/password/reset/request',{email:'owner@example.test'})).status,200);await f.tick();await f.tick();assert.equal((await f.db.prepare('SELECT attempts FROM auth_mail_outbox').first<{attempts:number}>())?.attempts,1);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM auth_test_mail').first<{n:number}>())?.n,0);
 await f.db.prepare('DELETE FROM auth_test_config').run();await f.request('/api/auth/password/reset/request',{email:'owner@example.test'});await f.tick();const raw=await f.token('owner@example.test');await f.db.prepare("UPDATE users SET email='changed@example.test' WHERE id='owner'").run();assert.equal((await f.request('/api/auth/action/complete',{token:raw,password:syntheticPassword,confirmPassword:syntheticPassword})).status,400);assert.equal((await f.request('/api/access',undefined,cookie)).status,401);
 }finally{await f.app.dispose();}
});

test('rate limits, concurrent email leases, disabled APIs and stale password sign-in fail safely',async()=>{
 const f=await accountFixture();try{await f.seed('owner');await f.migrate();
 assert.equal((await f.request('/api/access/invitations',{email:'team@example.test',role:'analyst',currentPassword:syntheticPassword})).status,401);
 assert.equal((await f.request('/__test/login-race',{email:'owner@example.test',password:syntheticPassword})).status,401);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM sessions').first<{n:number}>())?.n,0);
 for(let i=0;i<5;i++)assert.equal((await f.request('/api/auth/password/reset/request',{email:'unknown@example.test'})).status,200);assert.equal((await f.request('/api/auth/password/reset/request',{email:'unknown@example.test'})).status,429);
 await f.request('/api/auth/password/reset/request',{email:'owner@example.test'});await Promise.all([f.tick(),f.tick(),f.tick()]);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM auth_test_mail').first<{n:number}>())?.n,1);
 const before=(await f.db.prepare('SELECT COUNT(*) AS n FROM auth_actions').first<{n:number}>())?.n;assert.equal((await f.request('/api/auth/password/reset/request',{email:'owner@example.test'},'','https://disabled.synthetic.test')).status,401);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM auth_actions').first<{n:number}>())?.n,before);
 }finally{await f.app.dispose();}
});
