import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

test('Search Console desktop/mobile setup, reports, empty/errors and reader controls remain usable',async()=>{
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {SearchConsoleSettings,SearchConsoleAnalytics} from './packages/admin/ui/src/search-console.tsx';const settings=location.pathname==='/settings';createRoot(document.getElementById('root')).render(settings?<SearchConsoleSettings origin="https://example.test" canConfigure={location.search.includes("owner")}/>:<SearchConsoleAnalytics origin="https://example.test" manage={!location.search.includes('reader')}/>);`,resolveDir:resolve('.'),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'browser'});
  const css=(await Promise.all(['styles.css','typography.css','search-console.css'].map(file=>readFile('packages/admin/ui/src/'+file,'utf8')))).join('\n');
  let error=false,empty=false,connected=true,appConfigured=true;
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url!,'http://127.0.0.1');res.setHeader('content-type','application/json');
    if(url.pathname==='/api/search-console/status')return res.end(JSON.stringify({configured:appConfigured,connected,property:connected?'https://example.test/':null,revision:1,canSubmitSitemaps:true,lastSyncedAt:null,error:null}));
    if(url.pathname==='/api/search-console/app'){let body='';for await(const chunk of req)body+=chunk;if(req.method==='POST'){const data=JSON.parse(body);assert.equal(data.clientId,'12345-ui.apps.googleusercontent.com');assert.equal(data.clientSecret,'synthetic-ui-client-secret');appConfigured=true;}return res.end(JSON.stringify({revision:appConfigured?1:0,clientId:appConfigured?'12345-ui.apps.googleusercontent.com':'',clientSecretSet:appConfigured,encryptionReady:true,redirectUri:'https://admin.example.test/api/search-console/oauth/callback',source:appConfigured?'admin':'not-configured'}));}
    if(url.pathname==='/api/search-console/connect')return res.end(JSON.stringify({url:'https://accounts.google.com/o/oauth2/v2/auth?client_id=12345-ui.apps.googleusercontent.com'}));
    if(url.pathname==='/api/search-console/properties')return res.end(JSON.stringify({properties:[{siteUrl:'https://example.test/',permissionLevel:'siteOwner'}]}));
    if(url.pathname==='/api/search-console/report'){if(error){res.statusCode=429;return res.end(JSON.stringify({error:'Google quota reached. Try again later.'}));}return res.end(JSON.stringify({source:'google-search-console',property:'https://example.test/',timezone:'America/Los_Angeles',request:{startDate:'2026-10-01',endDate:'2026-10-28'},rows:empty?[]:[{keys:['Search phrase'],clicks:12,impressions:120,ctr:0.1,position:4.2}],fetchedAt:'2026-11-01T12:00:00Z',nextStartRow:null,persisted:true,limitations:['Google omits anonymized queries. Search clicks are separate from website visits.']}));}
    if(url.pathname==='/api/search-console/property')return res.end('{}');
    if(url.pathname==='/api/search-console/inspect')return res.end(JSON.stringify({inspectionResult:{indexStatusResult:{verdict:'PASS',coverageState:'Submitted and indexed'}}}));
    if(url.pathname==='/bundle.js'){res.setHeader('content-type','text/javascript');return res.end(bundle.outputFiles[0].text);}
    if(url.pathname==='/style.css'){res.setHeader('content-type','text/css');return res.end(css);}
    res.setHeader('content-type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><main class="content" id="root"></main><script type="module" src="/bundle.js"></script>');
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const address=server.address();assert.ok(address&&typeof address==='object');const origin='http://127.0.0.1:'+address.port;
  const browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await mkdir('artifacts/search-console',{recursive:true});
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:1000});await page.goto(origin+'/settings');await page.getByRole('button',{name:'Find matching properties'}).click();await page.getByLabel('Search Console property',{exact:true}).selectOption('https://example.test/');await page.getByRole('button',{name:'Use this property'}).click();await page.getByText('Property selected.',{exact:false}).waitFor();
      await page.goto(origin+'/analytics');await page.getByRole('cell',{name:'Search phrase',exact:true}).waitFor();
      await page.screenshot({path:`artifacts/search-console/analytics-${width}.png`,fullPage:true});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflowed viewport');
      await page.getByText('Sitemaps and URL inspection',{exact:true}).click();await page.getByRole('button',{name:'Inspect indexed URL'}).click();await page.getByText('Submitted and indexed',{exact:true}).waitFor();
    }
    await page.goto(origin+'/analytics?reader');await page.getByText('Sitemaps and URL inspection',{exact:true}).click();assert.equal(await page.getByRole('button',{name:'Submit sitemap to Google',exact:true}).count(),0);
    error=true;await page.reload();await page.getByRole('alert').filter({hasText:'Google quota reached'}).waitFor();assert.equal(await page.getByRole('cell',{name:'Search phrase',exact:true}).count(),0);
    error=false;empty=true;await page.reload();await page.getByText('No performance rows were returned',{exact:false}).waitFor();
    connected=false;await page.reload();await page.getByText('Google Search Console is not connected.',{exact:false}).waitFor();
    appConfigured=false;connected=false;await page.goto(origin+'/settings?owner');await page.getByLabel('Google authorized redirect URI').waitFor();
    assert.equal(await page.getByLabel('Google authorized redirect URI').inputValue(),'https://admin.example.test/api/search-console/oauth/callback');
    await page.getByLabel('Import Google OAuth client JSON').setInputFiles({name:'google-client.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({web:{client_id:'12345-ui.apps.googleusercontent.com',client_secret:'synthetic-ui-client-secret',redirect_uris:['https://admin.example.test/api/search-console/oauth/callback']}}))});
    await page.getByRole('button',{name:'Save Google application',exact:true}).click();await page.getByText('Google application saved.',{exact:false}).waitFor();assert.equal(await page.getByLabel('Google client secret',{exact:true}).inputValue(),'');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.route('https://accounts.google.com/**',route=>route.fulfill({contentType:'text/html',body:'Google authorization handoff'}));
    await page.getByRole('button',{name:'Connect Google',exact:true}).click();await page.getByText('Google authorization handoff').waitFor();
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise<void>(done=>server.close(()=>done()));}
});
