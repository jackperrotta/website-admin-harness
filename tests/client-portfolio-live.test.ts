import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {createPortfolioFixture} from './client-portfolio-fixture.ts';
import type {PortfolioState, PortfolioResponse, BootstrapResponse} from '../packages/contracts/src/index.ts';

test('live analytics requires authenticated ownership, disables demo access and never substitutes fixture data', {timeout:90000}, async () => {
  const catalog: PortfolioState = {clients:[{id:'owner',name:'Owner',contact:'',sector:'Studio'}],websites:[{id:'live-site',clientId:'owner',name:'Live fixture',origin:'https://live.example.test',initials:'LF',color:'#ccc',connection:'unavailable',source:'not-connected',rows:[],previousRows:[],lastSuccess:null},{id:'unconfigured',clientId:'owner',name:'Not configured',origin:'https://empty.example.test',initials:'NC',color:'#ccc',connection:'not_configured',rows:[],previousRows:[],lastSuccess:null}],changes:[],runnerOnline:false};
  let calls=0, fail=false;
  const fixture = await createPortfolioFixture({live:{catalog,analytics:async request=>{calls++;if(fail)return Response.json({error:'Unavailable'},{status:503});const days=Number(new URL(request.url).searchParams.get('days'));return Response.json({source:'connected',days,timezone:'UTC',rows:[{day:'2026-11-03',views:7,visitors:5,enquiries:0}],previousRows:[]});}}});
  try {
    const authPage=await fixture.app.dispatchFetch(`${fixture.origin}/auth`);assert.equal(authPage.status,200);assert.match(await authPage.text(),/<html/);
    assert.deepEqual(fixture.cookies,{});
    assert.equal((await fixture.app.dispatchFetch(`${fixture.origin}/api/auth/demo`,{method:'POST',headers:{origin:fixture.origin}})).status,404);
    assert.equal((await fixture.request()).status,401);assert.equal(calls,0);
    const boot=await (await fixture.app.dispatchFetch(`${fixture.origin}/api/bootstrap`)).json() as BootstrapResponse;assert.equal(boot.localDemo,false);
    assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM users').first<{n:number}>())?.n,0);
    const token=randomUUID()+randomUUID();
    await fixture.db.prepare("INSERT INTO users(id,email,role) VALUES('real-owner','owner@example.test','owner')").run();
    await fixture.db.prepare('INSERT INTO login_tokens(digest,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(token).digest('hex'),'real-owner',Math.floor(Date.now()/1000)+600).run();
    const login=await fixture.app.dispatchFetch(`${fixture.origin}/api/auth/confirm`,{method:'POST',headers:{origin:fixture.origin,'content-type':'application/json'},body:JSON.stringify({token})});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie')!.split(';')[0];
    const read=()=>fixture.request('',undefined,'none',{cookie});
    let response=await read(), value=await response.json() as PortfolioResponse;assert.equal(response.status,200);assert.equal(value.analyticsMode,'live');assert.equal(value.websites[0].source,'connected');assert.equal(value.websites[0].rows[0].views,7);assert.equal(value.websites[0].windows?.['14']?.days,14);
    assert.equal(value.websites[1].connection,'not_configured');assert.deepEqual(value.websites[1].rows,[]);
    const stored=await fixture.db.prepare('SELECT payload FROM client_portfolio_prototype').first<{payload:string}>();assert.ok(stored && !stored.payload.includes('"views":7'));
    fail=true;response=await read();value=await response.json() as PortfolioResponse;assert.equal(value.websites[0].connection,'unavailable');assert.equal(value.websites[0].source,'not-connected');assert.deepEqual(value.websites[0].rows,[]);
    assert.equal((await fixture.app.dispatchFetch(`${fixture.origin}/api/auth/confirm`,{method:'POST',headers:{origin:fixture.origin,'content-type':'application/json'},body:JSON.stringify({token})})).status,401);
    await fixture.db.prepare("UPDATE users SET active=0 WHERE id='real-owner'").run();const previous=calls;assert.equal((await read()).status,401);assert.equal(calls,previous);
  } finally {await fixture.app.dispose();}
});
