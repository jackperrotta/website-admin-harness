import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import type {AdminManifest} from '../packages/contracts/src/index.ts';

export async function searchConsoleFixture(packageRoot=resolve('packages/admin'),enabled=true,site='acme',environmentCredentials=true){
  const root=await mkdtemp(join(tmpdir(),'vitris-search-console-'));
  const manifest:AdminManifest={schemaVersion:1,installationId:'example-installation',business:{name:'Example',initials:'EX'},site:{id:site,name:'Example',origin:'https://example.test'},adminOrigin:'http://127.0.0.1:4391',modules:enabled?['search-console']:[]};
  const entry=join(root,'entry.ts');
  await writeFile(entry,`import {createAdmin} from ${JSON.stringify(join(packageRoot,'dist/worker.js'))};
    import {createSearchConsoleWorker} from ${JSON.stringify(join(packageRoot,'dist/search-console.js'))};
    const app=createAdmin(${JSON.stringify(manifest)});const searchWorker=createSearchConsoleWorker(${JSON.stringify(manifest)});
    export default {async fetch(request,env,ctx){
      env.SEARCH_CONSOLE_HTTP={async fetch(req){const u=new URL(req.url),text=await req.text();await env.DB.prepare('INSERT INTO fixture_calls(path,body) VALUES(?,?)').bind(u.pathname,text).run();
        const flag=await env.DB.prepare('SELECT status FROM fixture_flags LIMIT 1').first();
        if(flag&&u.hostname!=='oauth2.googleapis.com'&&flag.status>0)return Response.json({error:'synthetic'}, {status:flag.status});
        if(flag&&flag.status===0&&u.pathname.endsWith('/searchAnalytics/query'))await env.DB.prepare('UPDATE search_console_connections SET revision=revision+1,tokens_cipher=NULL').run();
        if(flag&&flag.status===-1&&u.hostname==='oauth2.googleapis.com'&&new URLSearchParams(text).get('grant_type')==='authorization_code')await env.DB.prepare("UPDATE users SET role='analyst' WHERE id='owner'").run();
        if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',scope:'https://www.googleapis.com/auth/'+(new URLSearchParams(text).get('code')==='writable'?'webmasters':'webmasters.readonly')});
        if(u.pathname==='/webmasters/v3/sites')return Response.json({siteEntry:[{siteUrl:'https://example.test/',permissionLevel:'siteOwner'},{siteUrl:'sc-domain:example.test',permissionLevel:'siteOwner'},{siteUrl:'https://other.test/',permissionLevel:'siteOwner'}]});
        if(u.pathname.endsWith('/searchAnalytics/query')){const q=JSON.parse(text);const rows=q.startRow?[]:Array.from({length:Math.min(q.rowLimit,2)},(_,i)=>({keys:q.dimensions.map(d=>d==='date'?q.startDate:d+'-'+i),clicks:10-i,impressions:100,ctr:(10-i)/100,position:3+i}));return Response.json({rows,responseAggregationType:'byProperty',metadata:{first_incomplete_date:'2026-11-01'}});}
        if(u.pathname.endsWith('/index:inspect'))return Response.json({inspectionResult:{indexStatusResult:{verdict:'PASS',coverageState:'Submitted and indexed',robotsTxtState:'ALLOWED'}}});
        if(u.pathname.endsWith('/sitemaps'))return Response.json({sitemap:[{path:'https://example.test/sitemap.xml',errors:'0',warnings:'0',isPending:false,lastDownloaded:'2026-11-01T00:00:00Z'}]});
        if(req.method==='PUT')return new Response(null,{status:204});
        return Response.json({siteUrl:decodeURIComponent(u.pathname.slice('/webmasters/v3/sites/'.length)),permissionLevel:'siteOwner'});
      }};
      if(new URL(request.url).pathname==='/_fixture/search-tick'){await searchWorker.scheduled({},env);return Response.json({ok:true});}
      if(new URL(request.url).pathname==='/_fixture/tick'){try{await app.scheduled({},env);return Response.json({ok:true});}catch{return Response.json({error:'scheduled failed'},{status:503});}}
      return app.fetch(request,env,ctx);
    }};`);
  const bundle=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'neutral'});
  const app=new Miniflare(convertV4MiniflareOptions({workers:[{name:'search-console-test',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-01',d1Databases:{DB:'db'},bindings:{MODE:'local',...(environmentCredentials?{SEARCH_CONSOLE_CLIENT_ID:'synthetic-client',SEARCH_CONSOLE_CLIENT_SECRET:'synthetic-secret'}:{}),SEARCH_CONSOLE_TOKEN_KEYS:JSON.stringify({current:'test',keys:{test:Buffer.alloc(32,1).toString('base64url')}}),SEARCH_CONSOLE_FIXTURE_MODE:'1'},serviceBindings:{ASSETS:async()=>new Response('Example')}}]}));
  const db=await app.getD1Database('DB','search-console-test');
  try{
  const migrations=(await readdir(join(packageRoot,'migrations'))).filter(f=>f.endsWith('.sql')).sort();
  for(const file of migrations){const sql=await readFile(join(packageRoot,'migrations',file),'utf8');const statements=(sql.includes('-- statement-breakpoint')?sql.split('-- statement-breakpoint'):sql.replace(/^--.*$/gm,'').split(';')).map(s=>s.replace(/^--.*$/gm,'').trim()).filter(Boolean);for(const statement of statements)await db.prepare(statement).run();}
  await db.prepare('CREATE TABLE fixture_calls(path TEXT,body TEXT)').run();await db.prepare('CREATE TABLE fixture_flags(status INTEGER)').run();
  const sessions:Record<string,string>={};
  for(const role of ['owner','administrator','analyst','editor']){await db.prepare('INSERT INTO users(id,email,role) VALUES(?,?,?)').bind(role,role+'@example.test',role).run();const raw='synthetic-session-'+role;sessions[role]='vitris-admin-local='+raw;await db.prepare('INSERT INTO sessions(digest,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(raw).digest('hex'),role,Math.floor(Date.now()/1000)+3600).run();}
  const request=(path:string,data?:unknown,role='owner',headers:Record<string,string>={})=>app.dispatchFetch(manifest.adminOrigin+path,{redirect:'manual',method:data===undefined?'GET':'POST',headers:{cookie:sessions[role]??'',...(data===undefined?{}:{origin:manifest.adminOrigin,'content-type':'application/json'}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const connect=async(writable=false)=>{
    const begun=await request('/api/search-console/connect',{manageSitemaps:writable});if(!begun.ok)throw Error(await begun.text());
    const {url}=await begun.json() as {url:string};const state=new URL(url).searchParams.get('state')!;const cookie=begun.headers.get('set-cookie')!.split(';')[0];
    const callback='/api/search-console/oauth/callback?'+new URLSearchParams({state,code:writable?'writable':'readonly'});
    const completed=await request(callback,undefined,'owner',{cookie});if(completed.status!==303)throw Error(await completed.text());
    const status=await (await request('/api/search-console/status')).json() as {revision:number};
    const selected=await request('/api/search-console/property',{property:'https://example.test/',revision:status.revision});if(!selected.ok)throw Error(await selected.text());
  };
  return {app,db,manifest,request,connect,dispose:()=>app.dispose()};
  }catch(error){await app.dispose();throw error;}
}
