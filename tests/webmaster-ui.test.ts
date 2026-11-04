import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {webmasterFixture} from './webmaster-fixture.ts';

test('lead controls and assignment candidates use agreed capabilities for both analyst and editor accounts',{timeout:90000},async()=>{
  const f=await webmasterFixture({browser:true}),browser=await chromium.launch({headless:true});try{
    await f.request(undefined,{organizationId:'studio',organizationName:'Synthetic Studio',billingProvider:false,members:[{userId:'editor',permissions:['leads:read']},{userId:'analyst',permissions:['leads:read','leads:write']}],revision:0});
    await f.migration('0010_lead_followups.sql');
    const team=await(await f.request('/api/leads/team',undefined,'analyst')).json() as {rows:Array<{id:string}>};assert.ok(team.rows.some(u=>u.id==='analyst'));assert.ok(!team.rows.some(u=>u.id==='editor'));
    const followUp={id:'client-lead',assignedTo:'editor',dueDate:null,notes:'Synthetic follow-up',completed:false,revision:0};assert.equal((await f.request('/api/leads/follow-up',followUp)).status,400);assert.equal((await f.request('/api/leads/follow-up',{...followUp,assignedTo:'analyst'})).status,200);
    const writer=await browser.newContext();await writer.addCookies([{name:'vitris-admin-local',value:f.cookies.analyst.split('=')[1],url:f.origin}]);const page=await writer.newPage();await page.goto(f.origin+'/#leads');await page.getByRole('button',{name:'Synthetic Lead',exact:true}).click();const detail=page.getByRole('region',{name:'Lead details'});await detail.getByLabel('Status',{exact:true}).selectOption('closed');await detail.getByRole('status').filter({hasText:'Lead status saved.'}).waitFor();assert.equal((await f.db.prepare("SELECT status FROM leads WHERE id='client-lead'").first<{status:string}>())?.status,'closed');
    const reader=await browser.newContext();await reader.addCookies([{name:'vitris-admin-local',value:f.cookies.editor.split('=')[1],url:f.origin}]);const readPage=await reader.newPage(),teamRequests:string[]=[];readPage.on('request',request=>{if(new URL(request.url()).pathname==='/api/leads/team')teamRequests.push(request.url());});await readPage.goto(f.origin+'/#leads');await readPage.getByRole('button',{name:'Synthetic Lead',exact:true}).click();assert.equal(await readPage.getByRole('region',{name:'Lead details'}).getByLabel('Status',{exact:true}).isDisabled(),true);assert.deepEqual(teamRequests,[]);
  }finally{await browser.close();await f.app.dispose();}
});

test('owners configure and revoke scoped management; members see the relationship on desktop and mobile',{timeout:180000},async()=>{
  const f=await webmasterFixture({browser:true}),browser=await chromium.launch({headless:true});try{
    await mkdir('artifacts/webmaster',{recursive:true});
    const owner=await browser.newContext({viewport:{width:1440,height:1000}}),member=await browser.newContext({viewport:{width:390,height:844}});
    await owner.addCookies([{name:'vitris-admin-local',value:f.cookies.owner.split('=')[1],url:f.origin}]);await member.addCookies([{name:'vitris-admin-local',value:f.cookies.editor.split('=')[1],url:f.origin}]);
    const page=await owner.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(f.origin+'/#settings');
    const panel=page.getByRole('region',{name:'Managed by Webmaster'});await panel.getByText('No webmaster is connected.',{exact:false}).waitFor();await panel.getByRole('button',{name:'Connect a webmaster'}).click();
    await panel.getByLabel('Organization ID',{exact:true}).fill('synthetic-studio');await panel.getByLabel('Webmaster organization',{exact:true}).fill('Synthetic Website Studio');
    await panel.getByLabel('Grant webmaster access to editor@example.test').check();await panel.getByLabel('View analytics',{exact:true}).check();await panel.getByLabel('Manage work queue',{exact:true}).check();
    assert.equal(await panel.getByLabel('View leads',{exact:true}).isChecked(),false);assert.equal(await panel.getByLabel('This organization also provides our billing.').isChecked(),false);
    await panel.getByRole('button',{name:'Save webmaster connection'}).click();await panel.getByRole('status').filter({hasText:'Webmaster connection saved.'}).waitFor();await panel.getByText('This management connection has no billing relationship.').waitFor();
    assert.equal(await panel.getByRole('button',{name:'Disconnect management access',exact:true}).isEnabled(),false);
    await page.screenshot({path:resolve('artifacts/webmaster/connection-desktop.png'),fullPage:true});
    const teammate=await member.newPage();teammate.on('pageerror',e=>errors.push(e.message));await teammate.goto(f.origin+'/#settings');const memberPanel=teammate.getByRole('region',{name:'Managed by Webmaster'});
    await memberPanel.getByText('Synthetic Website Studio',{exact:true}).waitFor();assert.equal(await memberPanel.getByRole('button',{name:'Disconnect management access',exact:true}).count(),0);assert.equal(await teammate.getByRole('link',{name:'Leads',exact:true}).count(),0);assert.equal(await teammate.getByRole('link',{name:'Your billing',exact:true}).count(),0);assert.equal(await teammate.getByRole('alert').count(),0);
    await memberPanel.scrollIntoViewIfNeeded();assert.ok(await teammate.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await teammate.screenshot({path:resolve('artifacts/webmaster/member-mobile.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve('artifacts/webmaster/connection-mobile.png'),fullPage:true});
    await panel.getByLabel('I understand that disconnecting access does not cancel a subscription.').check();await panel.getByRole('button',{name:'Disconnect management access',exact:true}).click();await panel.getByRole('status').filter({hasText:'Management access disconnected.'}).waitFor();await panel.getByText('Management disconnected',{exact:false}).waitFor();
    assert.equal((await f.request('/api/analytics',undefined,'editor')).status,401);assert.equal((await f.request('/api/modules/account-billing')).status,200);await teammate.reload();await teammate.getByRole('heading',{name:'Welcome back'}).waitFor();assert.deepEqual(errors,[]);
  }finally{await browser.close();await f.app.dispose();}
});


test('owners can remove a member whose account is no longer eligible without losing the connection',{timeout:90000},async()=>{
  const f=await webmasterFixture({browser:true}),browser=await chromium.launch({headless:true});try{
    assert.equal((await f.request(undefined,{organizationId:'studio',organizationName:'Synthetic Studio',billingProvider:false,members:[{userId:'editor',permissions:['analytics:read']}],revision:0})).status,200);
    await f.db.prepare("UPDATE users SET role='administrator' WHERE id='editor'").run();
    const context=await browser.newContext();await context.addCookies([{name:'vitris-admin-local',value:f.cookies.owner.split('=')[1],url:f.origin}]);const page=await context.newPage();await page.goto(f.origin+'/#settings');const panel=page.getByRole('region',{name:'Managed by Webmaster'});await panel.getByRole('button',{name:'Edit webmaster connection'}).click();
    await panel.getByRole('button',{name:'Remove unavailable member'}).click();await panel.getByRole('button',{name:'Save webmaster connection'}).click();await panel.getByRole('status').filter({hasText:'Webmaster connection saved.'}).waitFor();assert.deepEqual((await f.view()).connection?.members,[]);assert.equal((await f.request('/api/access',undefined,'editor')).status,401);
  }finally{await browser.close();await f.app.dispose();}
});
