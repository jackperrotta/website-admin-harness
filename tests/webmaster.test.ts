import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {webmasterFixture,webmasterConfig} from './webmaster-fixture.ts';
import {userCan,validWebmasterScopes,type BootstrapResponse,type RowsResponse,type ActivityRow,type LeadsResponse} from '../packages/contracts/src/index.ts';

test('operational grant contract excludes ownership, access and billing',()=>{
  for(const p of ['access:write','access:read','account-billing:read','account-billing:manage','billing:read','appointments:read','unknown'])assert.equal(validWebmasterScopes([p]),false);
  assert.equal(validWebmasterScopes(['leads:write']),false);assert.equal(validWebmasterScopes(['tasks:write']),false);assert.equal(validWebmasterScopes(['analytics:read','analytics:read']),false);
  assert.equal(userCan({id:'member',email:'member@example.test',role:'owner',webmaster:{organizationId:'studio',organizationName:'Studio',permissions:['analytics:read'],revision:1}},'access:write'),false);
});

test('migration preserves existing accounts and records; disabled and unauthorized controls fail closed',async()=>{
  const f=await webmasterFixture({migrate:false});try{
    assert.equal((await f.request()).status,503);await f.migration('0011_webmaster_connections.sql');
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM users').first<{n:number}>())?.n,4);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM leads').first<{n:number}>())?.n,2);assert.ok(await f.db.prepare("SELECT 1 FROM audit WHERE id='legacy'").first());
    assert.equal((await f.request(undefined,undefined,'')).status,401);
    assert.equal((await f.request(undefined,undefined,'owner',{'x-fixture-variant':'disabled'})).status,404);
    assert.equal((await f.request(undefined,webmasterConfig,'administrator')).status,403);
    assert.equal((await f.request(undefined,webmasterConfig,'owner',{origin:'https://foreign.example.test'})).status,403);
    for(const member of ['owner','administrator','missing'])assert.equal((await f.request(undefined,{...webmasterConfig,members:[{userId:member,permissions:[]}]})).status,400);
    for(const permissions of [['leads:write'],['billing:read'],['access:write'],['tasks:read','tasks:read']])assert.equal((await f.request(undefined,{...webmasterConfig,members:[{userId:'editor',permissions}]})).status,400);
    assert.equal((await f.request(undefined,{...webmasterConfig,organizationName:'bad\nname'})).status,400);
    assert.equal((await f.request(undefined,{...webmasterConfig,role:'owner'})).status,400);
    assert.equal((await f.request(undefined,{...webmasterConfig,members:[webmasterConfig.members[0],webmasterConfig.members[0]]})).status,400);
    assert.equal((await f.view()).connection,null);
  }finally{await f.app.dispose();}
});

test('webmaster grants replace local role access, attribute actions, and keep leads and billing separate',async()=>{
  const f=await webmasterFixture();try{
    assert.equal((await f.request(undefined,webmasterConfig)).status,200);
    const boot=await(await f.request('/api/bootstrap',undefined,'editor')).json() as BootstrapResponse;
    assert.equal(boot.user?.webmaster?.organizationName,webmasterConfig.organizationName);assert.deepEqual(boot.capabilities,['analytics','settings']);assert.deepEqual(boot.modules.map(m=>m.id),['work-queue']);
    assert.equal((await f.request('/api/analytics',undefined,'editor')).status,200);
    for(const path of ['/api/leads','/api/settings','/api/activity','/api/access','/api/modules/account-billing'])assert.equal((await f.request(path,undefined,'editor')).status,403,path);
    assert.equal((await f.request('/api/modules/scheduling',undefined,'editor',{'x-fixture-variant':'scheduling'})).status,403);
    assert.equal((await f.request(undefined,{...webmasterConfig,revision:1},'editor')).status,403);
    assert.equal((await f.request('/api/modules/work-queue',{title:'Agreed website work'},'editor')).status,201);
    let activity=await(await f.request('/api/activity')).json() as RowsResponse<ActivityRow>;const action=activity.rows.find(r=>r.action==='Added a work queue task');assert.ok(action);assert.equal(action.actor,'editor@example.test');assert.equal(action.person_id,'editor');assert.equal(action.organization_id,webmasterConfig.organizationId);assert.equal(action.organization_name,webmasterConfig.organizationName);
    assert.equal((await f.request(undefined,{...webmasterConfig,organizationName:'Renamed Studio',revision:1,billingProvider:true,members:[{userId:'editor',permissions:['leads:read']}]})).status,200);
    const read=await(await f.request('/api/leads',undefined,'editor')).json() as LeadsResponse;assert.equal(read.writable,false);assert.deepEqual(read.rows.map(r=>r.id),['client-lead']);
    assert.equal((await f.request('/api/leads/status',{id:'client-lead',status:'closed'},'editor')).status,403);
    assert.equal((await f.request('/api/modules/work-queue',{title:'Removed grant'},'editor')).status,403);
    assert.equal((await f.request(undefined,{...webmasterConfig,revision:2,billingProvider:true,members:[{userId:'editor',permissions:['leads:read','leads:write','settings:write']}]})).status,200);
    assert.equal((await f.request('/api/leads/status',{id:'foreign-lead',status:'closed'},'editor')).status,404);
    assert.equal((await f.request('/api/leads/status',{id:'client-lead',status:'closed'},'editor')).status,200);
    assert.equal((await f.request('/api/settings',{notification_email:'client@example.test',revision:0},'editor')).status,200);
    activity=await(await f.request('/api/activity')).json() as RowsResponse<ActivityRow>;assert.equal(activity.rows.find(r=>r.id===action.id)?.organization_name,webmasterConfig.organizationName);
    assert.equal((await f.request('/api/modules/account-billing')).status,200);assert.equal((await f.view()).connection?.billingProvider,true);
    await f.db.prepare("UPDATE webmaster_members SET permissions_json='[\"account-billing:manage\"]' WHERE user_id='editor'").run();assert.equal((await f.request('/api/analytics',undefined,'editor')).status,401);assert.equal((await f.request()).status,503);
  }finally{await f.app.dispose();}
});

test('revisions serialize changes; disconnection, removal and module disablement immediately block existing sessions without canceling billing',async()=>{
  const f=await webmasterFixture();try{
    const results=await Promise.all([f.request(undefined,webmasterConfig),f.request(undefined,{...webmasterConfig,organizationName:'Concurrent Studio'})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    assert.equal((await f.request(undefined,{...webmasterConfig,revision:0})).status,409);
    assert.equal((await f.request('/api/modules/webmaster/disconnect',{revision:1})).status,400);
    assert.equal((await f.request('/api/modules/webmaster/disconnect',{revision:1,acknowledgeSubscription:true},'administrator')).status,403);
    assert.equal((await f.request('/api/analytics',undefined,'editor',{'x-fixture-variant':'disabled'})).status,401);
    const before=await(await f.request('/api/modules/account-billing')).json();
    assert.equal((await f.request('/api/modules/webmaster/disconnect',{revision:1,acknowledgeSubscription:true})).status,200);
    assert.equal((await f.view()).connection?.status,'disconnected');assert.equal((await f.request('/api/analytics',undefined,'editor')).status,401);assert.equal((await f.request('/api/bootstrap',undefined,'editor')).status,200);
    assert.equal((await(await f.request('/api/bootstrap',undefined,'editor')).json() as BootstrapResponse).user,null);
    assert.deepEqual(await(await f.request('/api/modules/account-billing')).json(),before);
    assert.equal((await f.request(undefined,{...webmasterConfig,revision:2})).status,200);assert.equal((await f.request('/api/analytics',undefined,'editor')).status,401);
    await f.renew('editor');assert.equal((await f.request('/api/analytics',undefined,'editor')).status,200);
    assert.equal((await f.request(undefined,{...webmasterConfig,revision:3,members:[]})).status,200);assert.equal((await f.request('/api/leads',undefined,'editor')).status,401);
    assert.equal((await f.db.prepare("SELECT active FROM webmaster_members WHERE user_id='editor'").first<{active:number}>())?.active,0);
  }finally{await f.app.dispose();}
});

test('connection identity and managed sessions cannot cross installations, sites or exact admin origins',async()=>{
  const f=await webmasterFixture();try{
    await f.request(undefined,webmasterConfig);
    for(const variant of ['other','other-site','other-origin']){
      const base=variant==='other-origin'?'https://other.webmaster.example.test':f.origin;
      const response=await f.request(undefined,undefined,'owner',{'x-fixture-variant':variant},base);assert.equal(response.status,200);assert.equal((await response.json() as {connection:null}).connection,null);
      assert.equal((await f.request('/api/analytics',undefined,'editor',{'x-fixture-variant':variant},base)).status,401);
      assert.equal((await f.request('/api/modules/webmaster/disconnect',{revision:1,acknowledgeSubscription:true},'owner',{'x-fixture-variant':variant},base)).status,409);
    }
    assert.equal((await f.view()).connection?.status,'connected');
    await f.db.prepare("UPDATE users SET active=0 WHERE id='editor'").run();assert.equal((await f.request('/api/analytics',undefined,'editor')).status,401);
  }finally{await f.app.dispose();}
});


test('a disconnect racing sign-in cannot mint a session that revives on reconnection',async()=>{
  const f=await webmasterFixture();try{
    await f.request(undefined,webmasterConfig);
    await f.db.prepare("DELETE FROM sessions WHERE user_id='editor'").run();
    const raw=randomUUID()+randomUUID();await f.db.prepare('INSERT INTO login_tokens(digest,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(raw).digest('hex'),'editor',Math.floor(Date.now()/1000)+600).run();
    assert.equal((await f.request('/api/auth/confirm',{token:raw},'editor',{'x-fixture-variant':'login-race'})).status,401);
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM sessions WHERE user_id='editor'").first<{n:number}>())?.n,0);
    assert.equal((await f.request(undefined,{...webmasterConfig,revision:2})).status,200);
    assert.equal((await f.request('/api/auth/confirm',{token:raw},'editor')).status,401);
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM audit WHERE actor='editor@example.test' AND action='Signed in'").first<{n:number}>())?.n,0);
  }finally{await f.app.dispose();}
});
