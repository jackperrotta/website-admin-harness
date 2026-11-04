import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createSchedulingBrowserFixture} from './scheduling-browser-fixture.ts';

test('saved lead follow-up, full-history search, due queue and readable admin type on desktop/mobile',{timeout:180000},async t=>{
 const fixture=await createSchedulingBrowserFixture({modules:[]});t.after(()=>fixture.app.dispose());
 for(const sql of (await readFile('packages/admin/migrations/0010_lead_followups.sql','utf8')).replace(/^--.*$/gm,'').split(';').map(v=>v.trim()).filter(Boolean))await fixture.db.prepare(sql).run();
 await fixture.db.batch(Array.from({length:210},(_,i)=>fixture.db.prepare("INSERT INTO leads(id,site_id,name,email,message,source) VALUES(?,'scheduling-browser',?,'synthetic@example.test','Synthetic enquiry for UI acceptance','Synthetic fixture')").bind('recent-'+i,'Recent Visitor '+i)));
 await fixture.db.prepare("INSERT INTO leads(id,site_id,name,email,message,source,created_at) VALUES('older','scheduling-browser','Follow-up Visitor','visitor@example.test','Please call about the project.','Synthetic fixture','2000-01-01 00:00:00')").run();
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());await mkdir('artifacts/lead-follow-up',{recursive:true});
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1000}});await context.addCookies([{name:'vitris-admin-local',value:fixture.sessions.get('owner')!,url:fixture.origin}]);const page=await context.newPage();
  try{
   await page.goto(fixture.origin+'/#leads');await page.getByRole('status').filter({hasText:'211 matching enquiries'}).waitFor();
   await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText('Page 2',{exact:true}).waitFor();
   await page.getByLabel('Search leads',{exact:true}).fill('Follow-up Visitor');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('status').filter({hasText:'1 matching enquiries'}).waitFor();
   await page.getByRole('button',{name:'Follow-up Visitor',exact:true}).click();await page.getByLabel('Assigned teammate',{exact:true}).selectOption('owner');
   await page.getByLabel('Follow-up date (UTC)',{exact:true}).fill('2020-01-01');await page.getByLabel('Follow-up notes',{exact:true}).fill('Call about the project. Width '+width);
   await page.getByLabel('Follow-up complete',{exact:true}).uncheck();await page.getByRole('button',{name:'Save follow-up',exact:true}).click();await page.getByText('Follow-up saved.',{exact:true}).waitFor();
   await page.reload();await page.getByRole('status').filter({hasText:'211 matching enquiries'}).waitFor();await page.getByLabel('Follow-up queue',{exact:true}).selectOption('due');await page.getByRole('status').filter({hasText:'1 matching enquiries'}).waitFor();
   await page.getByLabel('Assigned to me',{exact:true}).check();await page.getByRole('button',{name:'Follow-up Visitor',exact:true}).click();assert.equal(await page.getByLabel('Follow-up notes',{exact:true}).inputValue(),'Call about the project. Width '+width);
   const small=await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).filter(e=>e.checkVisibility({checkVisibilityCSS:true,checkOpacity:true})&&Array.from(e.childNodes).some(n=>n.nodeType===3&&n.textContent?.trim())).map(e=>({text:e.textContent?.slice(0,80),size:parseFloat(getComputedStyle(e).fontSize)})).filter(e=>e.size<12));assert.deepEqual(small,[]);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:'artifacts/lead-follow-up/admin-'+width+'.png',fullPage:true});
   // Another session wins; the current draft is retained instead of overwriting it.
   const current=await fixture.db.prepare("SELECT revision FROM lead_followups WHERE lead_id='older'").first<{revision:number}>();
   await fixture.app.dispatchFetch(fixture.origin+'/api/leads/follow-up',{method:'POST',headers:{cookie:'vitris-admin-local='+fixture.sessions.get('owner'),origin:fixture.origin,'content-type':'application/json'},body:JSON.stringify({id:'older',assignedTo:'owner',dueDate:'2020-01-01',notes:'Other session',completed:false,revision:current!.revision})});
   await page.getByLabel('Follow-up notes',{exact:true}).fill('Keep this unsaved draft');await page.getByRole('button',{name:'Save follow-up',exact:true}).click();await page.getByRole('alert').filter({hasText:'changed in another session'}).waitFor();assert.equal(await page.getByLabel('Follow-up notes',{exact:true}).inputValue(),'Keep this unsaved draft');
   page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Reload saved follow-up',exact:true}).click();await page.getByText('Loaded the latest saved follow-up.',{exact:true}).waitFor();assert.equal(await page.getByLabel('Follow-up notes',{exact:true}).inputValue(),'Other session');
   await page.getByLabel('Follow-up complete',{exact:true}).check();await page.getByRole('button',{name:'Save follow-up',exact:true}).click();await page.getByRole('status').filter({hasText:'0 matching enquiries'}).waitFor();
  }catch(error){await page.screenshot({path:'artifacts/lead-follow-up/failure-'+width+'.png',fullPage:true});throw error;}finally{await context.close();}
 }
});
