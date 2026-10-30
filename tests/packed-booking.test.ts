import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {createWebsiteBookingFixture} from './website-booking-fixture.ts';

test('packed website and admin packages accept a booking into an already-open panel outside the workspace', {timeout:300000}, async () => {
  assert.ok(process.env.npm_execpath,'Run this test through npm run check');
  const root=await mkdtemp(join(tmpdir(),'vitris-packed-booking-')), tool=join(root,'installation');await mkdir(tool);
  const npm=(args:string[],cwd:string)=>execFileSync(process.execPath,[process.env.npm_execpath!,...args],{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
  const packages:string[]=[];
  for(const path of ['packages/admin','packages/contracts','packages/create-admin','../vitris-harness']) {
    if(path==='../vitris-harness')npm(['run','build:cli'],resolve(path));
    const archive=JSON.parse(npm(['pack','--ignore-scripts','--json','--pack-destination',root],resolve(path))) as {filename:string}[];
    packages.push(join(root,archive[0].filename));
  }
  npm(['install','--ignore-scripts','--no-audit','--no-fund',...packages],tool);
  const runtimeRoot=join(tool,'node_modules/@tryvitris/website-admin-harness'), websiteHarness=join(tool,'node_modules/@tryvitris/website-harness');
  const fixture=await createWebsiteBookingFixture({runtimeRoot,websiteHarness,packed:true});
  const browser=await chromium.launch({headless:true});
  try {
    // Exercise the packed CLI without a forms/analytics backend or a server-side credential.
    const site=join(root,'website'),adminDir=join(root,'admin');await mkdir(site);await mkdir(adminDir);
    await writeFile(join(site,'launch.json'),JSON.stringify({slug:'packed',publicOrigin:fixture.origin,forms:[{id:'keep'}]}));
    await writeFile(join(adminDir,'admin.local.json'),JSON.stringify({schemaVersion:1,installationId:'scheduling-browser',business:{name:'Packed fixture',initials:'P'},site:{id:'scheduling-browser',name:'Website',origin:fixture.origin},adminOrigin:fixture.backend.origin,modules:['scheduling']}));
    for(const flag of ['--plan','--apply','--apply'])execFileSync(process.execPath,[join(runtimeRoot,'bin/admin.mjs'),'scheduling-connect','--site',site,'--dir',adminDir,'--local',flag],{cwd:tool,windowsHide:true,stdio:'pipe'});
    assert.equal(JSON.parse(await readFile(join(site,'launch.json'),'utf8')).scheduling.apiOrigin,fixture.backend.origin);
    const context=await browser.newContext();await context.addCookies([{name:'vitris-admin-local',value:fixture.backend.sessions.get('owner')!,url:fixture.backend.origin,httpOnly:true,sameSite:'Strict'}]);
    const admin=await context.newPage(),website=await context.newPage();
    const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
    await admin.goto(fixture.backend.origin+'/#scheduling');await admin.getByRole('button',{name:'Day',exact:true}).click();await admin.getByLabel('Calendar date',{exact:true}).fill(date);await admin.getByText('0 displayed appointments',{exact:true}).waitFor();
    await website.goto(fixture.origin+'/book');await website.getByRole('button',{name:'Choose a time',exact:true}).click();await website.getByLabel('Appointment date',{exact:true}).fill(date);await website.getByRole('button',{name:'Find available times',exact:true}).click();await website.getByRole('button',{name:/at 12:00 PM GMT/}).click();await website.getByRole('button',{name:'Continue to your details',exact:true}).click();
    await website.getByLabel('Full name',{exact:true}).fill('Packed Website Customer');await website.getByLabel('Email address',{exact:true}).fill('packed@example.test');await website.getByRole('button',{name:'Review appointment',exact:true}).click();await website.getByRole('checkbox',{name:'I have read and accept the booking policy.',exact:true}).check();await website.getByRole('button',{name:'Confirm appointment',exact:true}).click();await website.getByRole('heading',{name:'Appointment confirmed',exact:true}).waitFor();
    await admin.getByRole('button').filter({hasText:'Packed Website Customer'}).waitFor({timeout:40000});
    await admin.getByRole('button').filter({hasText:'Packed Website Customer'}).click();await admin.getByText('Accepted booking policy',{exact:true}).waitFor();
    await mkdir('artifacts/admin-booking-integration',{recursive:true});await admin.screenshot({path:resolve('artifacts/admin-booking-integration/packed-booking.png'),fullPage:true});
    assert.equal((await fixture.backend.db.prepare('SELECT count(*) AS n FROM scheduling_appointments').first<{n:number}>())?.n,1);
  } finally {await browser.close();await fixture.close();}
});
