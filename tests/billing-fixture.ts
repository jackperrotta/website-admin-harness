import {createServer} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join,relative,extname} from 'node:path';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import type {AdminManifest,BillingResponse} from '../packages/contracts/src/index.ts';

export async function createBillingFixture(options:{audience?:'seller'|'customer';port?:number;enabled?:boolean;mode?:string;adminOrigin?:string;backend?:AdminManifest['backend'];applyModuleMigration?:boolean;runtimeRoot?:string;provider?:(request:Request)=>Promise<Response>}={}) {
  const reservation=createServer();await new Promise<void>(done=>reservation.listen(0,'127.0.0.1',done));const address=reservation.address();if(!address||typeof address==='string')throw Error('No preview port');const port=options.port??address.port;await new Promise<void>((done,reject)=>reservation.close(e=>e?reject(e):done()));
  const audience=options.audience??'seller',id=audience==='seller'?'billing':'account-billing',origin=options.adminOrigin??`http://${audience==='customer'?'localhost':'127.0.0.1'}:${port}`;
  const runtime=resolve(options.runtimeRoot??'packages/admin'),assets=join(runtime,'dist/client');
  const manifest:AdminManifest={schemaVersion:1,installationId:`billing-${audience}-preview`,business:audience==='seller'?{name:'Vitris Studio',initials:'V'}:{name:'Alder & Stone',initials:'AS'},site:{id:`billing-${audience}-preview`,name:audience==='seller'?'Studio workspace':'Alder & Stone',origin:audience==='seller'?'https://studio.example.test':'https://alder.example.test'},adminOrigin:origin,modules:options.enabled===false?[]:[id],...(options.backend?{backend:options.backend}:{})};
  const moduleName=audience==='seller'?'billingPrototype':'accountBillingPrototype';
  const source=`import {createAdmin} from ${JSON.stringify(join(runtime,'dist/worker.js'))};import {${moduleName}} from ${JSON.stringify(join(runtime,'dist/billing-prototype.js'))};export default createAdmin(${JSON.stringify(manifest)},{modules:[${moduleName}]});`;
  const bundle=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral'});
  const app=new Miniflare(convertV4MiniflareOptions({port,host:audience==='customer'?'localhost':'127.0.0.1',workers:[{name:'billing-preview',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-01',d1Databases:{DB:'billing-preview'},bindings:{MODE:options.mode??'local'},serviceBindings:{...(options.provider?{BILLING_PREVIEW:options.provider}:{}),ASSETS:async request=>{
    const url=new URL(request.url),file=resolve(assets,['/','/auth'].includes(url.pathname)?'index.html':`.${url.pathname}`);if(relative(assets,file).startsWith('..'))return new Response('Not found',{status:404});
    try{return new Response(await readFile(file),{headers:{'content-type':({'.html':'text/html','.css':'text/css','.js':'text/javascript'} as Record<string,string>)[extname(file)]??'application/octet-stream'}});}catch{return new Response('Not found',{status:404});}
  }}}]}));
  try {
    await app.ready;const db=await app.getD1Database('DB','billing-preview');
    for(const file of(await readdir(join(runtime,'migrations'))).filter(f=>/^000[123]_/.test(f)).sort()) {
      const sql=await readFile(join(runtime,'migrations',file),'utf8');for(const statement of sql.replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
    }
    if(audience==='seller'&&options.applyModuleMigration!==false){const sql=await readFile(join(runtime,'prototypes/billing/migrations/0001_billing_prototype.sql'),'utf8');for(const statement of sql.replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();}
    const cookies:Record<string,string>={};
    for(const role of ['owner','administrator','analyst','editor']){const raw=randomUUID();await db.prepare('INSERT INTO users(id,email,role) VALUES(?,?,?)').bind(role,`billing-${role}@example.test`,role).run();await db.prepare('INSERT INTO sessions(digest,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(raw).digest('hex'),role,Math.floor(Date.now()/1000)+86400).run();cookies[role]=`${new URL(origin).protocol==='http:'?'vitris-admin-local':'__Host-vitris-admin'}=${raw}`;}
    const request=(path='',data?:unknown,role='owner',headers:Record<string,string>={})=>app.dispatchFetch(`${origin}/api/modules/${id}${path}`,{method:data===undefined?'GET':'POST',headers:{cookie:cookies[role]??'',...(data===undefined?{}:{origin,'content-type':'application/json'}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const state=async()=>await(await request()).json() as BillingResponse;
    return {app,db,origin,manifest,cookies,request,state};
  } catch(error){await app.dispose();throw error;}
}
export async function createBillingPair(options:{sellerPort?:number;clientPort?:number;runtimeRoot?:string}={}) {
  const seller=await createBillingFixture({port:options.sellerPort,runtimeRoot:options.runtimeRoot});
  try {
    // Fixed synthetic account pairing. No caller-selected origin, customer, credential, or role.
    const client=await createBillingFixture({audience:'customer',port:options.clientPort,runtimeRoot:options.runtimeRoot,provider:async request=>{
      const path=new URL(request.url).pathname;
      const response=await seller.app.dispatchFetch(`${seller.origin}/api/modules/billing/account/alder${path==='/'?'':path}`,{method:request.method,headers:{cookie:seller.cookies.owner,...(request.method==='POST'?{origin:seller.origin,'content-type':'application/json'}:{})},...(request.method==='POST'?{body:await request.text()}:{})});
      return new Response(await response.text(),{status:response.status,headers:Object.fromEntries(response.headers)});
    }});
    return {seller,client,dispose:async()=>{await Promise.all([seller.app.dispose(),client.app.dispose()]);}};
  }catch(error){await seller.app.dispose();throw error;}
}
