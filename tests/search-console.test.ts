import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchConsoleFixture} from './search-console-fixture.ts';
import {matchingProperty,parseSearchQuery} from '../packages/admin/src/search-console/query.ts';
import type {SearchReport,SearchConsoleStatus,SearchConsoleAppSettings} from '../packages/contracts/src/search-console.ts';
const base='/api/search-console';
const query={startDate:'2026-10-01',endDate:'2026-10-28',type:'web',dimensions:['query'],rowLimit:2};
test('property matching and query validation constrain origin, types, dimensions, dates and page bounds',()=>{
  assert.equal(matchingProperty('sc-domain:example.test','https://www.example.test'),true);assert.equal(matchingProperty('sc-domain:example.test','https://evil-example.test'),false);
  for(const property of ['https://other.test/','https://example.test/sub/','https://example.test','https://example.test.evil/'])assert.equal(matchingProperty(property,'https://example.test'),false);
  for(const q of [{...query,startDate:'2026-02-30'},{...query,rowLimit:25001},{...query,dimensions:['query','query']},{...query,type:'discover'},{...query,dimensions:['hour']},{...query,dataState:'hourly_all'},{...query,dimensionFilterGroups:[{groupType:'and',filters:[{dimension:'query',operator:'bad',expression:'x'}]}]}])assert.throws(()=>parseSearchQuery(q));
  assert.equal(parseSearchQuery({...query,dimensions:['hour'],dataState:'hourly_all'}).dataState,'hourly_all');
});
test('disabled, unauthenticated, unauthorized, foreign-origin and unrelated property access is denied',async()=>{
  const f=await searchConsoleFixture();const disabled=await searchConsoleFixture(undefined,false);try{
    assert.equal((await disabled.request(base+'/status')).status,404);assert.equal((await disabled.request(base+'/oauth/callback?state=x&code=x')).status,404);
    assert.equal((await f.request(base+'/status',undefined,'nobody')).status,401);assert.equal((await f.request(base+'/status',undefined,'editor')).status,403);
    assert.equal((await f.request(base+'/connect',{},'analyst')).status,403);assert.equal((await f.request(base+'/connect',{},'owner',{origin:'https://evil.test'})).status,403);
    assert.equal((await f.request(base+'/property',{property:'https://other.test/',revision:0})).status,400);
    assert.equal((await f.app.dispatchFetch('http://localhost:4391'+base+'/status')).status,421);
  }finally{await f.dispose();await disabled.dispose();}
});
test('OAuth is browser-bound, single-use, offline, encrypted, scoped and fenced against disconnects',async()=>{
  const f=await searchConsoleFixture();try{
    const response=await f.request(base+'/connect',{});const {url}=await response.json() as {url:string};const u=new URL(url);
    assert.equal(u.searchParams.get('scope'),'https://www.googleapis.com/auth/webmasters.readonly');assert.equal(u.searchParams.get('code_challenge_method'),'S256');
    const callback=base+'/oauth/callback?'+new URLSearchParams({state:u.searchParams.get('state')!,code:'readonly'});const cookie=response.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await f.request(callback)).status,400);
    const completed=await Promise.all([f.request(callback,undefined,'owner',{cookie}),f.request(callback,undefined,'owner',{cookie})]);assert.deepEqual(completed.map(r=>r.status).sort(),[303,400]);
    const row=await f.db.prepare('SELECT tokens_cipher FROM search_console_connections').first<{tokens_cipher:string}>();assert.ok(row);assert.doesNotMatch(row.tokens_cipher,/synthetic-refresh/);
    const properties=await (await f.request(base+'/properties')).json() as {properties:unknown[]};assert.equal(properties.properties.length,2);
    const s=await (await f.request(base+'/status')).json() as SearchConsoleStatus;assert.equal(s.connected,true);
    assert.equal((await f.request(base+'/property',{property:'https://example.test/',revision:s.revision})).status,200);
    const stale=await f.request(base+'/disconnect',{revision:s.revision});assert.equal(stale.status,409);
    const next=await (await f.request(base+'/status')).json() as SearchConsoleStatus;assert.equal((await f.request(base+'/disconnect',{revision:next.revision})).status,200);
    assert.equal((await f.request(base+'/report')).status,409);
  }finally{await f.dispose();}
});
test('reports retain metadata and Pacific dates, paginate and cache without treating source failure as zero',async()=>{
  const f=await searchConsoleFixture();try{
    await f.connect();const response=await f.request(base+'/report',query,'analyst');assert.equal(response.status,200);
    const report=await response.json() as SearchReport;assert.equal(report.timezone,'America/Los_Angeles');assert.equal(report.rows.length,2);assert.equal(report.nextStartRow,2);assert.ok(report.metadata);assert.ok(report.persisted);
    assert.equal((await f.request(base+'/report',{...query,startRow:2},'analyst')).status,200);
    const calls=async()=>(await f.db.prepare("SELECT count(*) n FROM fixture_calls WHERE path LIKE '%searchAnalytics/query'").first<{n:number}>())!.n;
    const before=await calls();await f.request(base+'/report',query);assert.equal(await calls(),before);
    await f.db.prepare('INSERT INTO fixture_flags(status) VALUES(429)').run();assert.equal((await f.request(base+'/report',{...query,dimensions:['page']})).status,429);
    assert.equal((await f.request(base+'/report',query)).status,200);
    const last=await f.db.prepare('SELECT report_json FROM search_console_reports LIMIT 1').first<{report_json:string}>();assert.ok(last?.report_json.includes('limitations'));
  }finally{await f.dispose();}
});
test('readers inspect only this site and sitemap writes need both management permission and Google scope',async()=>{
  const f=await searchConsoleFixture();try{
    await f.connect();assert.equal((await f.request(base+'/sitemaps',undefined,'analyst')).status,200);
    assert.equal((await f.request(base+'/inspect',{url:'https://other.test/'},'analyst')).status,400);
    assert.equal((await f.request(base+'/inspect',{url:'https://example.test/'},'analyst')).status,200);
    assert.equal((await f.request(base+'/sitemaps/submit',{url:'https://example.test/sitemap.xml'},'analyst')).status,403);
    assert.equal((await f.request(base+'/sitemaps/submit',{url:'https://example.test/sitemap.xml'})).status,403);
    await f.connect(true);assert.equal((await f.request(base+'/sitemaps/submit',{url:'https://other.test/sitemap.xml'})).status,400);
    assert.equal((await f.request(base+'/sitemaps/submit',{url:'https://example.test/sitemap.xml'})).status,200);
    assert.equal((await f.request('/_fixture/search-tick')).status,200);assert.ok((await (await f.request(base+'/status')).json() as SearchConsoleStatus).lastSyncedAt);
  }finally{await f.dispose();}
});
test('revoked initiators cannot finish authorization and expired OAuth cannot be replayed',async()=>{
  const f=await searchConsoleFixture();try{
    const response=await f.request(base+'/connect',{});const {url}=await response.json() as {url:string};const cookie=response.headers.get('set-cookie')!.split(';')[0];
    await f.db.prepare("UPDATE users SET role='analyst' WHERE id='owner'").run();
    const callback=base+'/oauth/callback?'+new URLSearchParams({state:new URL(url).searchParams.get('state')!,code:'readonly'});
    assert.equal((await f.request(callback,undefined,'owner',{cookie})).status,403);
    assert.equal((await f.request(callback,undefined,'owner',{cookie})).status,400);
  }finally{await f.dispose();}
});
test('Domain property reports apply an unremovable website origin filter and concurrent disconnect fences snapshots',async()=>{
  const f=await searchConsoleFixture();try{
    await f.connect();const s=await (await f.request(base+'/status')).json() as SearchConsoleStatus;
    assert.equal((await f.request(base+'/property',{property:'sc-domain:example.test',revision:s.revision})).status,200);
    const response=await f.request(base+'/report',query);assert.equal(response.status,200);const report=await response.json() as SearchReport;
    const filter=report.request.dimensionFilterGroups!.at(-1)!.filters[0];assert.equal(filter.dimension,'page');assert.equal(filter.operator,'includingRegex');
    assert.equal(new RegExp(filter.expression).test('https://example.test/page'),true);assert.equal(new RegExp(filter.expression).test('https://other.example.test/page'),false);assert.equal(new RegExp(filter.expression).test('https://exampleXtest/page'),false);
    await f.db.prepare('INSERT INTO fixture_flags(status) VALUES(0)').run();
    assert.equal((await f.request(base+'/report',{...query,dimensions:['page']})).status,409);
    assert.equal((await (await f.request(base+'/status')).json() as SearchConsoleStatus).connected,false);
    const count=await f.db.prepare('SELECT count(*) n FROM search_console_reports').first<{n:number}>();assert.equal(count!.n,1);
  }finally{await f.dispose();}
});
test('connection scope separates installations and expired authorization cannot attach credentials',async()=>{
  const f=await searchConsoleFixture();try{
    await f.connect();
    const stored=await f.db.prepare('SELECT scope,site_id FROM search_console_connections').first<{scope:string;site_id:string}>();assert.ok(stored);assert.equal(stored.site_id,'acme');assert.deepEqual(JSON.parse(stored.scope),['example-installation','acme',f.manifest.adminOrigin]);
    await f.db.prepare('UPDATE search_console_connections SET scope=?,site_id=?').bind(JSON.stringify(['another-installation','another-site',f.manifest.adminOrigin]),'another-site').run();
    assert.equal((await (await f.request(base+'/status')).json() as SearchConsoleStatus).connected,false);
    assert.equal((await f.request(base+'/report',query)).status,409);
    const response=await f.request(base+'/connect',{});const {url}=await response.json() as {url:string};const cookie=response.headers.get('set-cookie')!.split(';')[0];
    await f.db.prepare('UPDATE search_console_oauth SET expires_at=0').run();
    assert.equal((await f.request(base+'/oauth/callback?'+new URLSearchParams({state:new URL(url).searchParams.get('state')!,code:'readonly'}),undefined,'owner',{cookie})).status,400);
  }finally{await f.dispose();}
});
test('authorization revoked during Google token exchange cannot save credentials',async()=>{
  const f=await searchConsoleFixture();try{
    const begun=await f.request(base+'/connect',{});const {url}=await begun.json() as {url:string};const cookie=begun.headers.get('set-cookie')!.split(';')[0];
    await f.db.prepare('INSERT INTO fixture_flags(status) VALUES(-1)').run();
    const response=await f.request(base+'/oauth/callback?'+new URLSearchParams({state:new URL(url).searchParams.get('state')!,code:'readonly'}),undefined,'owner',{cookie});
    assert.equal(response.status,403);assert.equal((await f.db.prepare('SELECT tokens_cipher FROM search_console_connections').first<{tokens_cipher:string|null}>())!.tokens_cipher,null);
  }finally{await f.dispose();}
});
test('owners configure OAuth inside the admin with encrypted secrets and no operator client credentials',async()=>{
  const f=await searchConsoleFixture(undefined,true,'acme',false);try{
    assert.equal((await (await f.request(base+'/status')).json() as SearchConsoleStatus).configured,false);
    for(const role of ['administrator','analyst','editor']){assert.equal((await f.request(base+'/app',undefined,role)).status,403);assert.equal((await f.request(base+'/app',{revision:0,clientId:'ignored',clientSecret:'ignored'},role)).status,403);}
    const setup=await (await f.request(base+'/app')).json() as SearchConsoleAppSettings;assert.equal(setup.encryptionReady,true);assert.equal(setup.redirectUri,f.manifest.adminOrigin+base+'/oauth/callback');
    const input={revision:setup.revision,clientId:'12345-test.apps.googleusercontent.com',clientSecret:'synthetic-private-app-secret'};
    assert.equal((await f.request(base+'/app',input,'owner',{origin:'https://other.test'})).status,403);
    const result=await f.request(base+'/app',input);assert.equal(result.status,200);const text=await result.text();assert.ok(!text.includes(input.clientSecret));assert.equal((JSON.parse(text) as SearchConsoleAppSettings).clientSecretSet,true);
    const stored=await f.db.prepare('SELECT credentials_cipher FROM search_console_apps').first<{credentials_cipher:string}>();assert.ok(stored);assert.ok(!stored.credentials_cipher.includes(input.clientSecret));
    assert.equal((await (await f.request(base+'/status')).json() as SearchConsoleStatus).configured,true);
    await f.connect();assert.equal((await (await f.request(base+'/status')).json() as SearchConsoleStatus).connected,true);
    assert.equal((await f.request(base+'/app',input)).status,409);
    assert.equal((await f.request(base+'/app',{...input,revision:1,clientSecret:''})).status,200);
    assert.equal((await (await f.request(base+'/status')).json() as SearchConsoleStatus).connected,false);
    const exposed=await (await f.request(base+'/app')).text();assert.ok(!exposed.includes(input.clientSecret));
  }finally{await f.dispose();}
});
test('changing the OAuth application invalidates pending account authorization',async()=>{
  const f=await searchConsoleFixture();try{
    const begun=await f.request(base+'/connect',{});const {url}=await begun.json() as {url:string};const cookie=begun.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await f.request(base+'/app',{revision:0,clientId:'12345-new.apps.googleusercontent.com',clientSecret:'synthetic-replacement-secret'})).status,200);
    assert.equal((await f.request(base+'/oauth/callback?'+new URLSearchParams({state:new URL(url).searchParams.get('state')!,code:'readonly'}),undefined,'owner',{cookie})).status,400);
  }finally{await f.dispose();}
});
