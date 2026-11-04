import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {readFile} from 'node:fs/promises';
import {resolve,join,relative,extname} from 'node:path';
import type {AdminManifest,WebmasterResponse} from '../packages/contracts/src/index.ts';

export async function webmasterFixture({browser=false,runtimeRoot='packages/admin',migrate=true}={}){
  const reservation=createServer();await new Promise<void>(done=>reservation.listen(0,'127.0.0.1',done));const address=reservation.address();if(!address||typeof address==='string')throw Error('No port');const port=address.port;await new Promise<void>(done=>reservation.close(()=>done()));
  const origin=browser?`http://127.0.0.1:${port}`:'https://admin.webmaster.example.test';
  const manifest:AdminManifest={schemaVersion:1,installationId:'webmaster-fixture',business:{name:'Synthetic Client',initials:'SC'},site:{id:'client-site',name:'Client website',origin:'https://client.example.test'},adminOrigin:origin,modules:['work-queue','webmaster','account-billing']};
  const runtime=resolve(runtimeRoot),assets=join(runtime,'dist/client');
  // Synthetic billing sentinel proves routing remains independent; real paired billing has separate protocol coverage.
  const source=`import {createAdmin} from ${JSON.stringify(join(runtime,'dist/worker.js'))};const config=${JSON.stringify(manifest)};
  const modules=[{id:'account-billing',version:1,label:'Your billing',permission:'account-billing:read',description:'Synthetic billing sentinel',handle:async()=>Response.json({subscription:'unchanged'})}];
  const app=createAdmin(config,{modules}),disabled=createAdmin({...config,modules:config.modules.filter(id=>id!=='webmaster')},{modules}),other=createAdmin({...config,installationId:'other-installation'},{modules}),otherSite=createAdmin({...config,site:{...config.site,id:'other-site'}},{modules}),scheduling=createAdmin({...config,modules:[...config.modules,'scheduling']},{modules}),otherOrigin=createAdmin({...config,adminOrigin:'https://other.webmaster.example.test'},{modules});
  export default {fetch(request,env,context){const variant=request.headers.get('x-fixture-variant');
  if(variant==='login-race'){const original=env.DB;env={...env,DB:{prepare(sql){const statement=original.prepare(sql);if(!sql.startsWith('INSERT INTO sessions'))return statement;return {bind(...args){const bound=statement.bind(...args);return {run:async()=>{await original.prepare("UPDATE webmaster_connections SET status='disconnected',revision=revision+1").run();return bound.run();}};}};},batch(statements){return original.batch(statements);}}};}
  return (variant==='disabled'?disabled:variant==='other'?other:variant==='other-site'?otherSite:variant==='other-origin'?otherOrigin:variant==='scheduling'?scheduling:app).fetch(request,env,context);}};`;
  const bundle=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral'});
  const app=new Miniflare(convertV4MiniflareOptions({...browser?{port,host:'127.0.0.1'}:{},workers:[{name:'webmaster',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-01',d1Databases:{DB:'webmaster'},bindings:{MODE:browser?'local':'production'},serviceBindings:{ASSETS:async request=>{const p=new URL(request.url).pathname,file=resolve(assets,/\.(js|css)$/.test(p)?`.${p}`:'index.html');if(relative(assets,file).startsWith('..'))return new Response('Not found',{status:404});return new Response(await readFile(file),{headers:{'content-type':({'.js':'text/javascript','.css':'text/css'} as Record<string,string>)[extname(file)]||'text/html'}});}}}]}));
  try{
    await app.ready;const db=await app.getD1Database('DB','webmaster');
    const migration=async(file:string)=>{for(const statement of(await readFile(join(runtime,'migrations',file),'utf8')).replace(/^--.*$/gm,'').split(';').filter(s=>s.trim()))await db.prepare(statement).run();};
    for(const file of ['0001_core.sql','0002_work_queue.sql','0003_password_credentials.sql'])await migration(file);
    const cookies:Record<string,string>={};for(const role of ['owner','administrator','editor','analyst']){
      const raw=randomUUID();await db.prepare('INSERT INTO users(id,email,role) VALUES(?,?,?)').bind(role,role+'@example.test',role).run();await db.prepare('INSERT INTO sessions(digest,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(raw).digest('hex'),role,Math.floor(Date.now()/1000)+3600).run();cookies[role]=`${browser?'vitris-admin-local':'__Host-vitris-admin'}=${raw}`;
    }
    await db.prepare("INSERT INTO leads(id,site_id,name,email,message,source) VALUES('client-lead','client-site','Synthetic Lead','lead@example.test','Synthetic only','Form')").run();
    await db.prepare("INSERT INTO leads(id,site_id,name,email,message,source) VALUES('foreign-lead','other-site','Other Lead','other@example.test','Private','Form')").run();
    await db.prepare("INSERT INTO audit(id,actor,action) VALUES('legacy','owner@example.test','Existing activity')").run();
    if(migrate)await migration('0011_webmaster_connections.sql');
    const request=(path='/api/modules/webmaster',data?:unknown,role='owner',headers:Record<string,string>={},base=origin)=>app.dispatchFetch(base+path,{method:data===undefined?'GET':'POST',headers:{cookie:cookies[role]||'',...(data===undefined?{}:{origin:base,'content-type':'application/json'}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const view=async(role='owner')=>await(await request(undefined,undefined,role)).json() as WebmasterResponse;
    const renew=async(role:string)=>{const raw=randomUUID();await db.prepare('INSERT INTO sessions(digest,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(raw).digest('hex'),role,Math.floor(Date.now()/1000)+3600).run();cookies[role]=`${browser?'vitris-admin-local':'__Host-vitris-admin'}=${raw}`;};
    return {app,db,manifest,origin,cookies,request,view,migration,renew};
  }catch(error){await app.dispose();throw error;}
}
export const webmasterConfig={organizationId:'synthetic-studio',organizationName:'Synthetic Website Studio',billingProvider:false,members:[{userId:'editor',permissions:['analytics:read','tasks:read','tasks:write']}],revision:0};
