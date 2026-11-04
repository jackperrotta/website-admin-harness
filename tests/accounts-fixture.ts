import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {resolve,join,relative,extname} from 'node:path';
import {createServer} from 'node:net';
import {createHash,createHmac,pbkdf2Sync} from 'node:crypto';
import type {AdminManifest} from '../packages/contracts/src/index.ts';

export const syntheticPassword='A synthetic account passphrase';
export const syntheticPepper='synthetic-account-pepper-only-32-characters';
export async function accountFixture(browser=false,runtimeRoot='packages/admin',passwordConfigured=true){
 const reservation=createServer();await new Promise<void>(done=>reservation.listen(0,'127.0.0.1',done));const address=reservation.address();if(!address||typeof address==='string')throw Error('No port');const port=address.port;await new Promise<void>(done=>reservation.close(()=>done()));
 const origin=browser?`http://127.0.0.1:${port}`:'https://admin.synthetic.test';
 const manifest:AdminManifest={schemaVersion:1,installationId:'accounts-synthetic',business:{name:'Synthetic Studio',initials:'SS'},site:{id:'synthetic',name:'Synthetic website',origin:'https://synthetic.test'},adminOrigin:origin,modules:[],theme:{colorAccent:'#7a4f36',colorBg:'#f9f6f2',colorText:'#30261f'}};
 // These fixture-only routes and mailbox cannot be reached in a packaged installation.
 const source=`import {createAdmin} from ${JSON.stringify(resolve(runtimeRoot,'dist/worker.js'))};
 const config=${JSON.stringify(manifest)};const app=createAdmin(config);const other=createAdmin({...config,installationId:'other',adminOrigin:'https://other.synthetic.test'});const disabled=createAdmin({...config,adminOrigin:'https://disabled.synthetic.test'});
 export default {async fetch(request,env){const url=new URL(request.url);env.AUTH_EMAIL={send:async message=>{if(await env.DB.prepare('SELECT 1 FROM auth_test_config WHERE fail=1').first())throw Error('synthetic provider failure');await env.DB.prepare('INSERT INTO auth_test_mail(message) VALUES(?)').bind(JSON.stringify(message)).run();return {messageId:'synthetic'};}};
 if(url.pathname==='/__test/legacy-login')return app.fetch(new Request(config.adminOrigin+'/api/auth/password',request),{...env,AUTH_ACCOUNTS_ENABLED:'0'});
 if(url.pathname==='/__test/login-race'){const original=env.DB;const raced={prepare(sql){const statement=original.prepare(sql);if(!sql.startsWith('INSERT INTO sessions'))return statement;return {bind(...args){const bound=statement.bind(...args);return {run:async()=>{await original.prepare("UPDATE auth_profiles SET revision=revision+1 WHERE user_id='owner'").run();return bound.run();}};}};}};return app.fetch(new Request(config.adminOrigin+'/api/auth/password',request),{...env,DB:raced});}
 if(url.pathname==='/__test/tick'){await app.scheduled({},env);return new Response('ok');}
 if(url.origin==='https://other.synthetic.test')return other.fetch(request,env);
 if(url.origin==='https://disabled.synthetic.test')return disabled.fetch(request,{...env,AUTH_ACCOUNTS_ENABLED:'0'});
 if(url.pathname==='/__test/not-ready'){return app.fetch(new Request(config.adminOrigin+'/api/auth/password/reset/request',{method:'POST',headers:{origin:config.adminOrigin,'content-type':'application/json'},body:JSON.stringify({email:'owner@example.test'})}),{...env,AUTH_EMAIL_READY:'0'});}
 return app.fetch(request,env);}};`;
 const bundle=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral'});
 const assets=resolve(runtimeRoot,'dist/client');
 const app=new Miniflare(convertV4MiniflareOptions({...browser?{port,host:'127.0.0.1'}:{},workers:[{name:'accounts',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-01',d1Databases:{DB:'accounts'},bindings:{MODE:browser?'local':'production',PASSWORD_LOGIN:'1',PASSWORD_PEPPER:passwordConfigured?syntheticPepper:'',AUTH_ACCOUNTS_ENABLED:'1',AUTH_EMAIL_READY:'1',AUTH_FROM:'accounts@tryvitris.com',AUTH_EMAIL_ENCRYPTION_KEY:'ab'.repeat(32)},serviceBindings:{ASSETS:async request=>{const path=new URL(request.url).pathname,file=resolve(assets,/\.(js|css)$/.test(path)?`.${path}`:'index.html');if(relative(assets,file).startsWith('..'))return new Response('Not found',{status:404});return new Response(await readFile(file),{headers:{'content-type':({'.js':'text/javascript','.css':'text/css'} as Record<string,string>)[extname(file)]||'text/html'}});}}}]}));
 try{
 await app.ready;const db=await app.getD1Database('DB','accounts');
 for(const name of ['0001_core.sql','0002_work_queue.sql','0003_password_credentials.sql'])for(const statement of (await readFile(resolve(runtimeRoot,'migrations',name),'utf8')).replace(/^--.*$/gm,'').split(';').filter(s=>s.trim()))await db.prepare(statement).run();
 await db.prepare('CREATE TABLE auth_test_mail(id INTEGER PRIMARY KEY AUTOINCREMENT,message TEXT NOT NULL)').run();await db.prepare('CREATE TABLE auth_test_config(fail INTEGER)').run();
 const migrate=async()=>{for(const statement of (await readFile(resolve(runtimeRoot,'migrations/0009_account_lifecycle.sql'),'utf8')).split('-- statement-breakpoint').filter(s=>/CREATE /i.test(s)))await db.prepare(statement).run();};
 const request=(path:string,data?:unknown,cookie='',base=origin,requestOrigin=base)=>app.dispatchFetch(base+path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{origin:requestOrigin,'content-type':'application/json'}),...(cookie?{cookie}:{} )},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const tick=()=>request('/__test/tick');
 const mail=async(to:string)=>{const row=await db.prepare('SELECT message FROM auth_test_mail WHERE json_extract(message,\'$.to\')=? ORDER BY id DESC LIMIT 1').bind(to).first<{message:string}>();if(!row)throw Error('No captured synthetic mail');return JSON.parse(row.message) as {to:string;from:string;text:string;subject:string};};
 const token=async(to:string)=>{const raw=(await mail(to)).text.match(/#token=([a-f0-9]{64})/)?.[1];if(!raw)throw Error('No synthetic link');return raw;};
 const login=async(email:string,password=syntheticPassword,legacy=false)=>{const response=await request(legacy?'/__test/legacy-login':'/api/auth/password',{email,password});if(response.status!==200)throw Error(`Synthetic login failed: ${response.status}`);return response.headers.get('set-cookie')!.split(';')[0];};
 const seed=async(id:string,role='owner')=>{const email=`${id}@example.test`;await db.prepare('INSERT INTO users(id,email,role) VALUES(?,?,?)').bind(id,email,role).run();const salt='cd'.repeat(32);const tag=createHmac('sha256',syntheticPepper).update(pbkdf2Sync(syntheticPassword,Buffer.from(salt,'hex'),100000,192,'sha256')).digest('hex');await db.prepare('INSERT INTO password_credentials(user_id,salt,tag,iterations,key_bits) VALUES(?,?,?,?,?)').bind(id,salt,tag,100000,1536).run();return email;};
 return {app,db,origin,manifest,request,tick,mail,token,login,seed,migrate,hash:(value:string)=>createHash('sha256').update(value).digest('hex')};
 }catch(e){await app.dispose();throw e;}
}
