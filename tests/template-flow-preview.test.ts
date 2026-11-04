import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createPortfolioFixture} from './client-portfolio-fixture.ts';
import type {ProspectWorkspace} from '../packages/contracts/src/index.ts';

test('each template opens shared client screens without creating prospects, accounts, drafts, sessions or payment records', {timeout:120000},async()=>{
  const f=await createPortfolioFixture({onboarding:true}),browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1536,height:1100}}),writes:string[]=[],errors:string[]=[];
    page.on('request',request=>{if(request.method()!=='GET'&&request.url().includes('/api/'))writes.push(request.method()+' '+new URL(request.url()).pathname);});page.on('pageerror',e=>errors.push(e.message));
    await page.context().addCookies([{name:'vitris-admin-local',value:'synthetic-portfolio-owner',url:f.origin}]);
    await page.goto(f.origin+'/#client-onboarding?view=templates');
    await page.getByRole('button',{name:'Preview client flow',exact:true}).first().waitFor();
    assert.equal(await page.getByRole('button',{name:'Preview client flow',exact:true}).count(),3);
    const home=page.locator('.ob-template-card').filter({has:page.getByRole('heading',{name:'Home & construction',exact:true})});await home.getByRole('button',{name:'Preview client flow',exact:true}).click();
    await page.getByRole('heading',{name:'Home & construction',exact:true}).waitFor();await page.getByText('Preview only.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('navigation',{name:'Main navigation'}).count(),0);assert.equal(await page.getByRole('dialog').count(),0);
    await page.getByRole('button',{name:/Complete signup/}).click();await page.getByRole('heading',{name:'Let’s make it yours.'}).waitFor();
    await page.getByRole('button',{name:'Use sample answers',exact:true}).click();await page.getByRole('button',{name:/Save & continue/}).click();await page.getByRole('heading',{name:'Tell us what matters.'}).waitFor();
    await mkdir('artifacts/template-flow-preview',{recursive:true});await page.screenshot({path:'artifacts/template-flow-preview/desktop.png',fullPage:true});
    await page.getByRole('button',{name:/Save & continue/}).click();await page.getByRole('heading',{name:'Your space starts here.'}).waitFor();
    assert.equal(await page.getByLabel(/Choose a password/).isDisabled(),true);assert.equal(await page.getByLabel('Confirm password',{exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:/Preview account creation/}).click();await page.getByRole('heading',{name:'One last thing.'}).waitFor();
    await page.getByRole('button',{name:'Preview saved payment method',exact:true}).click();await page.getByRole('heading',{name:'You’re all set, Riley.'}).waitFor();
    await page.getByRole('button',{name:/Restart preview/}).click();await page.getByRole('heading',{name:'A little preview, Riley.'}).waitFor();
    await page.getByRole('button',{name:/Complete signup/}).click();assert.equal(await page.getByLabel(/Business phone/).inputValue(),'');
    await page.getByLabel(/Business phone/).fill('555-0123');await page.getByRole('button',{name:'Reset preview',exact:true}).click();await page.getByRole('heading',{name:'A little preview, Riley.'}).waitFor();
    await page.getByRole('button',{name:'← Back to templates',exact:true}).click();await home.waitFor();assert.equal(await page.getByRole('navigation',{name:'Main navigation'}).count(),1);
    const records=await f.db.prepare('SELECT COUNT(*) n FROM client_onboarding_prospects').first<{n:number}>();assert.equal(records?.n,0);
    assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM users').first<{n:number}>())?.n,3);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM sessions').first<{n:number}>())?.n,3);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM client_onboarding_sessions').first<{n:number}>())?.n,0);
    assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  } finally {await browser.close();await f.app.dispose();}
});

test('saved template previews honor custom copy and omitted steps, support phone width, and handle unavailable templates', {timeout:120000},async()=>{
  const f=await createPortfolioFixture({onboarding:true}),browser=await chromium.launch({headless:true});
  try {
    const read=await f.app.dispatchFetch(f.origin+'/api/modules/client-onboarding',{headers:{cookie:f.cookies.owner}}),source=(await read.json() as ProspectWorkspace).templates[0];
    const saved=await f.app.dispatchFetch(f.origin+'/api/modules/client-onboarding/templates',{method:'POST',headers:{cookie:f.cookies.owner,origin:f.origin,'content-type':'application/json'},body:JSON.stringify({...source,name:'Simple welcome',title:'A welcome shaped for you.',message:'A personal welcome from your website team.',requiresPayment:false,fields:[{id:'service',label:'Your primary service',kind:'text',section:'business',required:true,value:''}]})});
    const template=(await saved.json() as ProspectWorkspace).templates.find(t=>t.source==='saved')!;
    const page=await browser.newPage({viewport:{width:1440,height:1050}});await page.context().addCookies([{name:'vitris-admin-local',value:'synthetic-portfolio-owner',url:f.origin}]);
    await page.goto(f.origin+'/#client-onboarding?view=templates');const card=page.locator('.ob-template-card').filter({has:page.getByRole('heading',{name:'Simple welcome',exact:true})});await card.getByRole('button',{name:'Preview client flow',exact:true}).click();
    await page.getByText('A personal welcome from your website team.',{exact:true}).waitFor();
    const steps=await page.getByLabel('Preview step',{exact:true}).locator('option').allTextContents();assert.deepEqual(steps,['Welcome & site preview','Your business','Your account','Completion']);
    await page.getByLabel('Preview step',{exact:true}).selectOption('business');await page.getByRole('heading',{name:'A welcome shaped for you.'}).waitFor();await page.getByRole('button',{name:'Phone',exact:true}).click();
    assert.ok(await page.locator('.tp-canvas>.oj-root').evaluate(el=>el.getBoundingClientRect().width<=390));assert.equal(await page.locator('.oj-aside').evaluate(el=>getComputedStyle(el).display),'none');
    await mkdir('artifacts/template-flow-preview',{recursive:true});await page.screenshot({path:'artifacts/template-flow-preview/phone-width.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'artifacts/template-flow-preview/mobile.png',fullPage:true});
    await page.getByLabel('Your primary service',{exact:false}).fill('Example service');await page.getByRole('button',{name:/Save & continue/}).click();await page.getByRole('heading',{name:'Your space starts here.'}).waitFor();
    await page.getByRole('button',{name:/Preview account creation/}).click();await page.getByRole('heading',{name:'You’re all set, Riley.'}).waitFor();
    await page.reload();await page.getByRole('heading',{name:'A little preview, Riley.'}).waitFor();
    await page.goto(f.origin+'/#client-onboarding?preview=unavailable-template');await page.getByRole('heading',{name:'Template unavailable.'}).waitFor();await page.getByRole('button',{name:'← Back to templates'}).click();await card.waitFor();
    const after=await f.app.dispatchFetch(f.origin+'/api/modules/client-onboarding',{headers:{cookie:f.cookies.owner}});const current=(await after.json() as ProspectWorkspace).templates.find(t=>t.id===template.id)!;assert.equal(current.fields[0].value,'');assert.equal(current.revision,1);
  } finally {await browser.close();await f.app.dispose();}
});

test('template preview stays unavailable for unauthenticated, unauthorized and disabled installations', {timeout:120000},async()=>{
  const browser=await chromium.launch({headless:true});
  try {for(const item of [{role:'',enabled:true},{role:'analyst',enabled:true},{role:'owner',enabled:false}]){
    const f=await createPortfolioFixture({onboarding:true,enabled:item.enabled});const context=await browser.newContext();
    try {const page=await context.newPage(),requests:string[]=[];page.on('request',r=>{if(r.url().includes('/api/modules/client-onboarding'))requests.push(r.url());});if(item.role)await context.addCookies([{name:'vitris-admin-local',value:`synthetic-portfolio-${item.role}`,url:f.origin}]);
      await page.goto(f.origin+'/#client-onboarding?preview=starter-home');await page.getByRole('heading',{name:item.role?'Your website, at a glance.':'Welcome back',exact:true}).waitFor();assert.equal(await page.locator('.tp-preview').count(),0);assert.deepEqual(requests,[]);
      await page.goto(f.origin+'/#client-onboarding?preview-draft=1');await page.getByRole('heading',{name:item.role?'Your website, at a glance.':'Welcome back',exact:true}).waitFor();assert.equal(await page.locator('.tp-preview').count(),0);assert.deepEqual(requests,[]);
    }finally{await context.close();await f.app.dispose();}
  }}finally{await browser.close();}
});
