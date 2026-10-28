import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,readFile,writeFile,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash,pbkdf2Sync,createHmac} from 'node:crypto';
import {build} from 'esbuild';
const manifest={schemaVersion:1,installationId:'acme',business:{name:'Acme',initials:'AC'},site:{id:'acme',name:'Main',origin:'https://acme.test'},adminOrigin:'http://127.0.0.1:4391',modules:['work-queue']};
let local,prod,db,prodDB,cookie;
async function fixture(config,mode,mail=false){
  const root=await mkdtemp(join(tmpdir(),'vitris-admin-test-'));
  await cp(resolve('packages/admin/dist/worker.js'),join(root,'worker.js'));
  await writeFile(join(root,'entry.js'),`import {createAdmin} from './worker.js';const app=createAdmin(${JSON.stringify(config)});export default {fetch(request,env){${mail?`env.AUTH_FROM='login@acme.test';env.AUTH_EMAIL={send:async(message)=>{await env.DB.prepare('INSERT INTO mailbox(body) VALUES(?)').bind(message.text).run();}};`:''}return app.fetch(request,env);}};`);
  const bundled=await build({entryPoints:[join(root,'entry.js')],bundle:true,write:false,format:'esm',platform:'neutral'});
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'admin-test',modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-01',d1Databases:{DB:'db'},bindings:{MODE:mode,...(mail?{PASSWORD_LOGIN:'1',PASSWORD_PEPPER:'synthetic-test-pepper-32-characters-minimum'}:{})},serviceBindings:{ASSETS:async()=>new Response('<html>App</html>',{headers:{'content-type':'text/html'}})}}]}));
  const store=await mf.getD1Database('DB','admin-test');
  for(const file of ['0001_core.sql','0002_work_queue.sql','0003_password_credentials.sql']){const sql=await readFile(`packages/admin/migrations/${file}`,'utf8');for(const statement of sql.replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await store.prepare(statement).run();}
  return [mf,store];
}
async function request(app,path,{data,session,origin='http://127.0.0.1:4391',method,base='http://127.0.0.1:4391'}={}){
  return app.dispatchFetch(`${base}${path}`,{method:method||(data===undefined?'GET':'POST'),headers:{...(data!==undefined?{'content-type':'application/json',origin}:{}),...(session?{cookie:session}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{})});
}
before(async()=>{
  [local,db]=await fixture(manifest,'local');
  const response=await request(local,'/api/auth/demo',{data:{}});assert.equal(response.status,200);cookie=response.headers.get('set-cookie').split(';')[0];
  [prod,prodDB]=await fixture({...manifest,adminOrigin:'https://admin.acme.test',modules:[]},'production',true);
  await prodDB.prepare('CREATE TABLE mailbox(body TEXT)').run();
  await prodDB.prepare("INSERT INTO users(id,email,role) VALUES('owner','owner@acme.test','owner')").run();
});
after(async()=>{await Promise.all([local?.dispose(),prod?.dispose()]);});
test('only canonical hosts work; protected API and CSRF are enforced',async()=>{
  assert.equal((await request(local,'/api/leads')).status,401);
  assert.equal((await request(local,'/api/bootstrap',{base:'http://localhost:4391'})).status,421);
  assert.equal((await request(local,'/api/settings',{data:{notification_email:'x@acme.test',revision:0},session:cookie,origin:'https://evil.test'})).status,403);
  assert.equal((await request(prod,'/api/auth/demo',{data:{},origin:'https://admin.acme.test',base:'https://admin.acme.test'})).status,404);
});
test('lead status, task actions and settings revisions persist with site isolation',async()=>{
  const leads=await (await request(local,'/api/leads',{session:cookie})).json();assert.equal(leads.rows.length,3);
  await db.prepare("INSERT INTO leads(id,site_id,name,email,message,source) VALUES('other','another-site','Private','private@example.test','Private','Form')").run();
  assert.equal((await request(local,'/api/leads/status',{session:cookie,data:{id:'other',status:'closed'}})).status,404);
  assert.equal((await request(local,'/api/leads/status',{session:cookie,data:{id:'demo-lead-1',status:'contacted'}})).status,200);
  assert.equal((await request(local,'/api/modules/work-queue',{session:cookie,data:{title:'A real follow-up'}})).status,201);
  const tasks=await (await request(local,'/api/modules/work-queue',{session:cookie})).json();assert.equal(tasks.rows.length,3);
  const task=tasks.rows.find(x=>x.title==='A real follow-up');assert.equal((await request(local,'/api/modules/work-queue/status',{session:cookie,data:{id:task.id,done:true}})).status,200);
  assert.equal((await request(local,'/api/settings',{session:cookie,data:{notification_email:'owner@acme.test',revision:0}})).status,200);
  assert.equal((await request(local,'/api/settings',{session:cookie,data:{notification_email:'other@acme.test',revision:0}})).status,409);
  const activity=await (await request(local,'/api/activity',{session:cookie})).json();assert.ok(activity.rows.length>=4);
});
test('revoked users immediately lose access and analysts cannot mutate',async()=>{
  await db.prepare("UPDATE users SET role='analyst' WHERE id='local-owner'").run();
  assert.equal((await request(local,'/api/leads',{session:cookie})).status,403);
  assert.equal((await request(local,'/api/analytics',{session:cookie})).status,200);
  assert.equal((await request(local,'/api/modules/work-queue',{session:cookie,data:{title:'Denied'}})).status,403);
  await db.prepare("UPDATE users SET active=0 WHERE id='local-owner'").run();
  assert.equal((await request(local,'/api/analytics',{session:cookie})).status,401);
  await db.prepare("UPDATE users SET role='owner',active=1 WHERE id='local-owner'").run();
});
test('Cloudflare email login is neutral, single use under races, and host scoped',async()=>{
  const opts={base:'https://admin.acme.test',origin:'https://admin.acme.test'};
  const known=await request(prod,'/api/auth/request',{...opts,data:{email:'owner@acme.test'}});
  const unknown=await request(prod,'/api/auth/request',{...opts,data:{email:'unknown@acme.test'}});
  assert.deepEqual(await known.json(),await unknown.json());
  const mail=await prodDB.prepare('SELECT body FROM mailbox').first();assert.ok(mail.body.includes('https://admin.acme.test/auth#token='));
  const raw=mail.body.match(/#token=(\S+)/)[1];
  const results=await Promise.all([request(prod,'/api/auth/confirm',{...opts,data:{token:raw}}),request(prod,'/api/auth/confirm',{...opts,data:{token:raw}})]);
  assert.deepEqual(results.map(x=>x.status).sort(),[200,401]);
  const accepted=results.find(x=>x.status===200);const productionCookie=accepted.headers.get('set-cookie');assert.match(productionCookie,/^__Host-vitris-admin=/);assert.match(productionCookie,/; Secure/);
  const session=productionCookie.split(';')[0];
  assert.equal((await request(prod,'/api/modules/work-queue',{...opts,session})).status,404);
  const boot=await (await request(prod,'/api/bootstrap',{...opts,session})).json();assert.equal(boot.user.email,'owner@acme.test');assert.equal(boot.localDemo,false);
  const isolatedLeads=await (await request(prod,'/api/leads',{...opts,session})).json();assert.equal(isolatedLeads.rows.length,0);
});
test('expired links, missing email configuration and oversized bodies fail closed',async()=>{
  assert.equal((await request(local,'/api/auth/request',{data:{email:'owner@acme.test'}})).status,503);
  const raw='x'.repeat(72);await prodDB.prepare('INSERT INTO login_tokens(digest,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(raw).digest('hex'),'owner',1).run();
  assert.equal((await request(prod,'/api/auth/confirm',{base:'https://admin.acme.test',origin:'https://admin.acme.test',data:{token:raw}})).status,401);
  assert.equal((await request(local,'/api/settings',{session:cookie,data:{notification_email:'x'.repeat(9000),revision:0}})).status,413);
});

test('imported password credentials preserve identity, enforce CSRF and reject unknown, invalid and revoked users',async()=>{
  const opts={base:'https://admin.acme.test',origin:'https://admin.acme.test'};
  const password='Synthetic account password only';const salt='ab'.repeat(32);
  const derived=pbkdf2Sync(password.normalize('NFC'),Buffer.from(salt,'hex'),100000,192,'sha256');
  const tag=createHmac('sha256','synthetic-test-pepper-32-characters-minimum').update(derived).digest('hex');
  await prodDB.prepare('INSERT INTO password_credentials(user_id,salt,tag,iterations,key_bits) VALUES(?,?,?,?,?)').bind('owner',salt,tag,100000,1536).run();
  assert.equal((await (await request(prod,'/api/bootstrap',opts)).json()).passwordLogin,true);
  assert.equal((await request(prod,'/api/auth/password',{...opts,origin:'https://evil.test',data:{email:'owner@acme.test',password}})).status,403);
  const bad=await request(prod,'/api/auth/password',{...opts,data:{email:'owner@acme.test',password:'incorrect'}});
  const unknown=await request(prod,'/api/auth/password',{...opts,data:{email:'missing@acme.test',password}});
  assert.equal(bad.status,401);assert.deepEqual(await bad.json(),await unknown.json());
  const good=await request(prod,'/api/auth/password',{...opts,data:{email:'OWNER@acme.test',password}});assert.equal(good.status,200);
  const session=good.headers.get('set-cookie');assert.match(session,/Secure/);assert.match(session,/HttpOnly/);
  assert.equal((await (await request(prod,'/api/bootstrap',{...opts,session})).json()).user.id,'owner');
  await prodDB.prepare("UPDATE users SET active=0 WHERE id='owner'").run();
  assert.equal((await request(prod,'/api/leads',{...opts,session})).status,401);
  assert.equal((await request(prod,'/api/auth/password',{...opts,data:{email:'owner@acme.test',password}})).status,401);
  await prodDB.prepare("UPDATE users SET active=1 WHERE id='owner'").run();
});
