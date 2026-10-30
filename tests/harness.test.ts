import type {AdminEnv} from '../packages/admin/src/worker.ts';
import type {BootstrapResponse, LeadsResponse, AnalyticsResponse} from '../packages/contracts/src/index.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createAdmin} from '../packages/admin/dist/worker.js';

test('connected admin reads backend data, enforces identities, and never falls back to demo rows',async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'adapter-test',modules:true,script:'export default{fetch(){return new Response("fixture")}}',d1Databases:['DB'],compatibilityDate:'2026-09-01'}]}));
  try{
    const DB=await mf.getD1Database('DB','adapter-test');
    for(const file of ['0001_core.sql','0002_work_queue.sql','0003_password_credentials.sql'])for(const sql of (await readFile(`packages/admin/migrations/${file}`,'utf8')).replace(/^--.*$/gm,'').split(';').map(x=>x.trim()).filter(Boolean))await DB.prepare(sql).run();
    await DB.prepare("INSERT INTO users(id,email,role) VALUES('owner','owner@example.test','owner')").run();
    const session='synthetic-session-secret';await DB.prepare('INSERT INTO sessions(digest,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(session).digest('hex'),'owner',Math.floor(Date.now()/1000)+600).run();
    await DB.prepare("INSERT INTO leads(id,site_id,name,email,message,source) VALUES('local-demo','site','Local demo','local@example.test','Must not leak into connected view','demo')").run();
    const manifest={schemaVersion:1,installationId:'business',business:{name:'Business',initials:'B'},site:{id:'site',name:'Main',origin:'https://business.test'},adminOrigin:'https://admin.business.test',modules:[],backend:{provider:'vitris-harness',origin:'https://backend.test',tenantId:'tenant'}};
    const app=createAdmin(manifest);let backendStatus=200;let wrongIdentity=false;let badAnalytics=false;let override: unknown;const seen: Request[]=[];
    const env: AdminEnv={DB,MODE:'production',HARNESS_API_TOKEN:'synthetic-backend-token-with-over-32-characters',HARNESS_SERVICE:{async fetch(input){const request=new Request(input);seen.push(request);if(override!==undefined)return Response.json(override);if(backendStatus!==200)return Response.json({error:'Denied'},{status:backendStatus});const resource=new URL(request.url).pathname.split('/').at(-1);const identity={schemaVersion:1,installationId:wrongIdentity?'another-installation':'business',tenantId:'tenant',siteOrigin:'https://business.test'};return Response.json(resource==='status'?{...identity,scopes:['leads:read','analytics:read']}:resource==='analytics'?{...identity,source:'connected',rows:[{day:'2026-10-27',views:badAnalytics?'fake':19,visitors:8,enquiries:1}],timezone:'UTC',days:14}:{...identity,source:'connected',writable:false,rows:[{id:'remote-lead',name:'Website lead',email:'website@example.test',message:'From backend D1',created_at:'2026-10-27 12:00:00',status:'new'}]});}},ASSETS:{fetch:async()=>new Response('fixture')}};
    const request=(path: string)=>app.fetch(new Request(`https://admin.business.test/api/${path}`,{headers:{cookie:`__Host-vitris-admin=${session}`}}),env);
    const leads=await (await request('leads')).json() as LeadsResponse;assert.equal(leads.source,'connected');assert.equal(leads.rows[0].id,'remote-lead');assert.equal(leads.rows.length,1);
    assert.equal(new URL(seen[0].url).origin,'https://backend.test');assert.equal(seen[0].headers.get('authorization'),`Bearer ${env.HARNESS_API_TOKEN}`);assert.equal(seen[0].redirect,'manual');
    await request('leads?mode=test');assert.equal(new URL(seen.at(-1)!.url).searchParams.get('mode'),'test');
    const boot=await (await request('bootstrap')).json() as BootstrapResponse;assert.ok(!JSON.stringify(boot).includes(env.HARNESS_API_TOKEN!));assert.equal(boot.localDemo,false);
    assert.equal((await request('connection')).status,200);
    wrongIdentity=true;assert.equal((await request('leads')).status,502);wrongIdentity=false;
    backendStatus=302;assert.equal((await request('leads')).status,502);
    backendStatus=401;assert.equal((await request('leads')).status,503);backendStatus=200;
    badAnalytics=true;assert.equal((await request('analytics')).status,502);badAnalytics=false;
    const analytics=await (await request('analytics?days=30')).json() as AnalyticsResponse;assert.equal(analytics.rows[0].views,19);assert.match(seen.at(-1)!.url,/days=30/);
    const identity={schemaVersion:1,installationId:'business',tenantId:'tenant',siteOrigin:'https://business.test'};
    const extended={...analytics.rows[0],sessions:8,bounces:2,engaged:5,leave_count:4,duration_ms:300000,hours_json:'[{"key":"23","n":19}]',channels_json:'[{"key":"organic","n":19}]'};
    override={...identity,source:'connected',rows:[extended],previousRows:[{...extended,day:'2026-10-01'}],timezone:'UTC',days:30};
    const rich=await (await request('analytics?days=30')).json() as AnalyticsResponse;assert.equal(rich.rows[0].sessions,8);assert.equal(rich.previousRows?.[0].day,'2026-10-01');
    override={...identity,scopes:['analytics:read'],theme:{colorAccent:'#772244',colorBg:'#fff4f8'}};
    const themed=await (await request('bootstrap')).json() as BootstrapResponse;assert.equal(themed.theme?.colorAccent,'#772244');assert.equal(themed.themeStatus,'website');
    for(const [path,body] of [
      ['leads',null], ['leads',[]],
      ['leads',{...identity,source:'connected',rows:[{...leads.rows[0],phone:123}]}],
      ['leads',{...identity,source:'connected',rows:leads.rows,writable:'yes'}],
      ['analytics',{...identity,source:'connected',rows:analytics.rows,timezone:12,days:14}],
      ['analytics',{...identity,source:'connected',rows:analytics.rows,timezone:'UTC',days:'14'}],
      ['analytics',{...identity,source:'connected',rows:[{...extended,sessions:-1}],timezone:'UTC',days:14}],
      ['analytics',{...identity,source:'connected',rows:[{...extended,hours_json:'[{"key":"40","n":1}]'}],timezone:'UTC',days:14}],
      ['analytics',{...identity,source:'connected',rows:[extended],previousRows:[{...extended,views:'fake'}],timezone:'UTC',days:14}],
      ['connection',{...identity,scopes:[123]}],
      ['connection',{...identity,scopes:[],theme:{colorAccent:'url(https://bad.test)'}}],
    ] satisfies [string,unknown][]) {
      override=body;assert.equal((await request(path)).status,502,`Reject invalid ${path} response`);
    }
    override={...identity,source:'connected',rows:[{...leads.rows[0],phone:null,fields_json:null}]};
    assert.equal((await request('leads')).status,200,'Nullable optional lead details remain compatible');
    override=undefined;
    const local=createAdmin({...manifest,adminOrigin:'http://127.0.0.1:4391'});
    const login=await local.fetch(new Request('http://127.0.0.1:4391/api/auth/demo',{method:'POST',headers:{origin:'http://127.0.0.1:4391'}}),{...env,MODE:'local'});assert.equal(login.status,404);
    delete env.HARNESS_API_TOKEN;assert.equal((await request('leads')).status,503);
  }finally{await mf.dispose();}
});

test('harness adapter executes inside the Cloudflare runtime, including native Request construction',async()=>{
  const root=await mkdtemp(join(tmpdir(),'admin-cloudflare-adapter-'));
  const manifest={schemaVersion:1,installationId:'runtime',business:{name:'Runtime fixture',initials:'RT'},site:{id:'site',name:'Main',origin:'https://runtime.test'},adminOrigin:'https://admin.runtime.test',modules:[],backend:{provider:'vitris-harness',origin:'https://backend.test',tenantId:'tenant'}};
  await writeFile(join(root,'entry.js'),`import {createAdmin} from ${JSON.stringify(resolve('packages/admin/dist/worker.js').replaceAll('\\','/'))};const app=createAdmin(${JSON.stringify(manifest)});export default{fetch(request,env){env.HARNESS_SERVICE={fetch:async(upstream)=>{if(upstream.redirect!=='manual')throw Error('Redirects must be inspected');return Response.json({schemaVersion:1,installationId:'runtime',tenantId:'tenant',siteOrigin:'https://runtime.test',source:'connected',rows:[]});}};return app.fetch(request,env);}};`);
  const bundle=await build({entryPoints:[join(root,'entry.js')],bundle:true,write:false,format:'esm',platform:'neutral'});
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'native-adapter',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-01',d1Databases:{DB:'db'},bindings:{MODE:'production',HARNESS_API_TOKEN:'synthetic-token-more-than-32-characters'}}]}));
  try{
    const db=await mf.getD1Database('DB','native-adapter');
    for(const sql of (await readFile('packages/admin/migrations/0001_core.sql','utf8')).split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
    await db.prepare("INSERT INTO users(id,email,role) VALUES('owner','owner@example.test','owner')").run();
    const raw='synthetic-native-runtime-session';await db.prepare('INSERT INTO sessions(digest,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(raw).digest('hex'),'owner',Math.floor(Date.now()/1000)+600).run();
    const response=await mf.dispatchFetch('https://admin.runtime.test/api/leads',{headers:{cookie:`__Host-vitris-admin=${raw}`}});assert.equal(response.status,200);assert.equal((await response.json() as LeadsResponse).source,'connected');
  }finally{await mf.dispose();}
});
