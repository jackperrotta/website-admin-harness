import {syntheticNotificationBindings} from './notification-fixture.ts';
import {createServer} from 'node:http';
import {mkdtemp,readFile} from 'node:fs/promises';
import {resolve,join,relative,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createSchedulingBrowserFixture} from './scheduling-browser-fixture.ts';
import {CalendarProviderFixture} from './calendar-provider-fixture.ts';
import {schedulingFixture} from './scheduling-fixture.ts';
/** Paired-source acceptance helper. Not included in runtime packages or customer installations. */
export async function createWebsiteBookingFixture(options:{port?:number;adminPort?:number;websiteHarness?:string;runtimeRoot?:string;packed?:boolean}={}){
 const out=await mkdtemp(join(tmpdir(),'vitris-website-booking-'));
 const server=createServer(async(request,response)=>{
  const url=new URL(request.url||'/','http://localhost'),path=decodeURIComponent(url.pathname);
  const file=resolve(out,'.'+path+(path.endsWith('/')?'index.html':extname(path)?'':'/index.html'));
  if(relative(out,file).startsWith('..')){response.writeHead(404).end();return;}
  try{const body=await readFile(file);response.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'} as Record<string,string>)[extname(file)]||'application/octet-stream','cache-control':'no-store'}).end(body);}catch{response.writeHead(404).end('Not found');}
 });
 await new Promise<void>(resolve=>server.listen(options.port??0,'127.0.0.1',resolve));
 const origin=`http://localhost:${(server.address() as {port:number}).port}`,calendar=new CalendarProviderFixture();
 let backend:Awaited<ReturnType<typeof createSchedulingBrowserFixture>>|undefined;
 try{
  backend=await createSchedulingBrowserFixture({port:options.adminPort,hostname:'localhost',websiteOrigin:origin,calendar,simulated:true,runtimeRoot:options.runtimeRoot,bindings:{BOOKING_ENABLED:'1',BOOKING_LOCAL_TEST:'1',...syntheticNotificationBindings}});
  const config=schedulingFixture();config.publicBooking={enabled:true,serviceIds:['visit','consult'],allowProviderChoice:true,policyText:'For changes, contact the business directly. Requests that need approval are confirmed only after the business accepts them. This is a local test; no email is sent.'};
  config.notifications={enabled:true,mode:'capture'};config.customerManagement={enabled:true,cancellationCutoffMinutes:0,rescheduleCutoffMinutes:0};
  await backend.reset(config);await calendar.seed(backend.db);
  for(const kind of ['google','microsoft'] as const){const destination=calendar.calendars(kind)[0].id;const result=await backend.ownerPost(`/connections/synthetic-${kind}/select`,{revision:0,blocking:[destination],destination,acknowledge:true});if(!result.ok)throw Error(`Calendar fixture failed: ${result.status}`);}
  const root=resolve(options.websiteHarness??'../vitris-harness');
  // Dynamic import keeps the two source packages independently installable and releasable.
  const {buildSite}=await import(pathToFileURL(join(root,options.packed?'bin/api/index.js':'src/build/index.ts')).href);
  await buildSite({site:{name:'Studio Test Business',slug:'scheduling-preview',environment:'preview',indexing:'noindex'},pages:[{path:'/',file:'index.html',title:'Studio Test Business',body:'<main class="section"><div class="container"><p>LOCAL BOOKING PREVIEW</p><h1>Make time for your next appointment.</h1><p>A synthetic business for testing the standard website booking component.</p><a class="btn" href="/book">Book an appointment</a></div></main>'}],catalog:{},theme:{colorAccent:'#244957',colorAccentText:'#ffffff',colorText:'#1d3340',colorMuted:'#50636c',colorBg:'#f7f8f8',colorSurface:'#ffffff',colorSurface2:'#edf2f3',colorBorder:'#c3cfd3',colorFocus:'#186c96'},publicOrigin:origin,scheduling:{version:1,enabled:true,apiOrigin:backend.origin,siteId:'scheduling-browser',installationId:'scheduling-browser',route:'/book'},outDir:out});
  const app=backend;
  return {backend:app,calendar,origin,out,async close(){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await app.app.dispose();}};
 }catch(error){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await backend?.app.dispose();throw error;}
}
