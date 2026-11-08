import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {emailFixture} from '../tests/email-campaigns-fixture.ts';
const started=Date.now(),f=await emailFixture({trace:true});
try{
 console.log('Load fixture ready');await f.settings({perMinute:100,recipientCap:5000,spacingHours:0,dailyLimit:10000,monthlyLimit:20000,reservedDaily:0});
 const csv=['email,name,company,serviceRef',...Array.from({length:5000},(_,i)=>`load-${i}@example.test,Synthetic Recipient ${i},Synthetic Company,agreed-load-test`)].join('\n');
 await f.result(await f.post('/imports/start',{csv,mapping:{email:'email',name:'name',company:'company',serviceRef:'serviceRef'},evidence:'Entirely synthetic load fixture',reviewed:true}));
 console.log('Encrypted import queued');for(let i=0;i<5;i++){await f.tick();console.log('Import tick '+(i+1));}
 assert.equal((await f.db.prepare('SELECT count(*) n FROM email_contacts').first<{n:number}>())?.n,5000);
 await f.db.prepare("INSERT INTO email_preferences(site_id,contact_id,topic,status,evidence_json,updated_at) SELECT site_id,id,'service','subscribed','{}',? FROM email_contacts").bind(Date.now()).run();
 const c=await f.campaign();await f.result(await f.post('/campaigns/approve',{id:c.id,revision:c.revision,audienceCount:5000,reviewed:true}));
 const adminResponseMs:number[]=[];let ticks=0,captured=0;while(captured<5000&&ticks<250){const scheduled=f.tick();if(ticks%10===0){const start=Date.now(),response=await f.app.dispatchFetch(f.origin+'/api/bootstrap',{headers:{cookie:f.cookies.owner}});assert.equal(response.status,200);adminResponseMs.push(Date.now()-start);}await scheduled;ticks++;captured=(await f.db.prepare("SELECT count(*) n FROM email_jobs WHERE state='captured'").first<{n:number}>())?.n||0;await f.advance(61000);if(ticks%10===0)console.log(JSON.stringify({ticks,captured,target:5000}));}
 assert.equal(captured,5000);assert.equal((await f.db.prepare('SELECT count(*) n FROM email_jobs').first<{n:number}>())?.n,5000);assert.equal((await f.db.prepare('SELECT count(*) n FROM (SELECT contact_id FROM email_jobs GROUP BY contact_id HAVING count(*)>1)').first<{n:number}>())?.n,0);
 const report={contacts:5000,captured,duplicateRecipients:0,schedulerTicks:ticks,virtualMinutes:ticks*61/60,elapsedMs:Date.now()-started,concurrentAdminResponseMs:adminResponseMs,transport:'encrypted local captures; no email provider or live recipients',clock:'fixture advances between bounded scheduler invocations'};await mkdir('artifacts/email-campaigns',{recursive:true});await writeFile('artifacts/email-campaigns/load-test.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await f.dispose();}
