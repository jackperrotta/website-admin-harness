import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createSchedulingBrowserFixture} from './scheduling-browser-fixture.ts';
import {schedulingFixture} from './scheduling-fixture.ts';

test('admin core and scheduling screens retain readable type and contained mobile layouts',{timeout:120000},async t=>{
 const fixture=await createSchedulingBrowserFixture();t.after(()=>fixture.app.dispose());await fixture.reset(schedulingFixture());
 await fixture.db.batch(Array.from({length:14},(_,i)=>fixture.db.prepare("INSERT INTO analytics_daily(site_id,day,views,visitors,enquiries) VALUES('scheduling-browser',?,?,?,?)").bind(new Date(Date.now()-i*86400000).toISOString().slice(0,10),35+i,20+i,i%3===0?1:0)));
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());await mkdir('artifacts/admin-typography',{recursive:true});
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1000}});await context.addCookies([{name:'vitris-admin-local',value:fixture.sessions.get('owner')!,url:fixture.origin}]);const page=await context.newPage();
  try{
   const check=async(route:string)=>{
    await page.waitForLoadState('networkidle');
    const tiny=await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).filter(el=>el.checkVisibility({checkVisibilityCSS:true,checkOpacity:true})&&Array.from(el.childNodes).some(node=>node.nodeType===3&&node.textContent?.trim())).filter(el=>{const rect=el.getBoundingClientRect();return rect.width>1&&rect.height>1;}).map(el=>({text:el.textContent?.trim().slice(0,80),size:parseFloat(getComputedStyle(el).fontSize)})).filter(value=>value.size<12));
    assert.deepEqual(tiny,[],route+' '+width);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route+' should contain mobile overflow');
    await page.screenshot({path:`artifacts/admin-typography/${route}-${width}.png`,fullPage:true});
   };
   const routes=[['overview','Your website, at a glance.','analytics'],['leads','Every enquiry starts here.','leads'],['analytics','Understand what brings people in.','analytics'],['settings','Make it work for your business.','settings'],['access','The right people. The right access.','access'],['activity','A record of what changed.','activity'],['scheduling','','modules/scheduling/workspace']];
   for(const [route,title,resource] of routes){
    const loaded=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/'+resource&&response.ok());
    await page.goto(fixture.origin+'/#'+route);await loaded;
    if(title)await page.getByRole('heading',{name:title,exact:true}).waitFor();else await page.getByRole('navigation',{name:'Scheduling sections'}).waitFor();
    await page.getByText('Loading your workspace…',{exact:true}).waitFor({state:'hidden'});await check(route);
   }
   const navigation=page.getByRole('navigation',{name:'Scheduling sections'}),tabs=await navigation.getByRole('button').allTextContents();
   for(const [i,name] of tabs.entries()){await navigation.getByRole('button',{name,exact:true}).click();await page.waitForFunction(name=>Array.from(document.querySelectorAll('[aria-label="Scheduling sections"] button')).some(button=>button.textContent===name&&button.getAttribute('aria-current')==='page'),name);await check('scheduling-'+i);}
  }finally{await context.close();}
 }
});
