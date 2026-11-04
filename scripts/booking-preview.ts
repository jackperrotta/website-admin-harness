import {createWebsiteBookingFixture} from '../tests/website-booking-fixture.ts';
import {readFile} from 'node:fs/promises';
const args=process.argv.slice(2),index=args.indexOf('--website-harness');
const port=(flag:string,fallback:number)=>{const i=args.indexOf(flag),value=i<0?fallback:Number(args[i+1]);if(!Number.isInteger(value)||value<1024||value>65535)throw Error(`Invalid ${flag}`);return value;};
const preview=await createWebsiteBookingFixture({port:port('--website-port',4392),adminPort:port('--admin-port',4391),...(index>=0?{websiteHarness:args[index+1]}:{})});
if(args.includes('--leads')){
 for(const sql of (await readFile('packages/admin/migrations/0010_lead_followups.sql','utf8')).replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await preview.backend.db.prepare(sql).run();
 for(const [id,name,email,message,status] of [
  ['preview-enquiry-1','Synthetic project enquiry','visitor@example.test','We would like to discuss a kitchen project. Please call to arrange a conversation.','new'],
  ['preview-enquiry-2','Synthetic consultation','consultation@example.test','Following up on our initial consultation.','contacted'],
  ['preview-enquiry-3','Synthetic completed enquiry','completed@example.test','This is a completed example enquiry.','closed']
 ])await preview.backend.db.prepare("INSERT INTO leads(id,site_id,name,email,message,status,source) VALUES(?,'scheduling-browser',?,?,?,?,'Synthetic local preview')").bind(id,name,email,message,status).run();
 await preview.backend.db.prepare("INSERT INTO lead_followups(tenant_id,installation_id,lead_id,assigned_to,due_date,notes) VALUES('scheduling-browser','scheduling-browser','preview-enquiry-1','local-owner',?,?)").bind(new Date().toISOString().slice(0,10),'Call to discuss scope and agree the next step.').run();
 console.log(`Lead follow-up: ${preview.backend.origin}/#leads (synthetic records only)`);
}
let running=false;
const timer=setInterval(async()=>{if(running)return;running=true;try{await(await preview.backend.app.getWorker()).scheduled({cron:'* * * * *'});}catch{console.error('Simulated calendar polling needs attention. Check Calendar connections.');}finally{running=false;}},60000);
console.log(`Website booking: ${preview.origin}/book`);
console.log(`Admin calendar: ${preview.backend.origin}/#scheduling`);
console.log('LOCAL TEST ONLY: shared ephemeral D1, simulated Google/Outlook, captured email, isolated loopback security fixture.');
console.log('Choose Open local demo in admin. Book on the website, then view that date in the admin calendar.');
console.log(`Compiled website: ${preview.out}`);
const close=()=>{clearInterval(timer);void preview.close().then(()=>process.exit(0));};process.on('SIGINT',close);process.on('SIGTERM',close);await new Promise(()=>{});
