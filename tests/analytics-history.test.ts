import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isTrackingTimestamp, type PortfolioWebsite} from '../packages/contracts/src/index.ts';
import {trackingStartLabel, firstActivityDay, historyWindowNotice} from '../packages/admin/ui/src/client-portfolio/history.ts';

const site: PortfolioWebsite = {id:'history',clientId:'owner',name:'Example',origin:'https://example.test',initials:'E',color:'#ccc',connection:'healthy',lastSuccess:null,trackingStartedAt:'2026-11-04T02:31:21.474Z',rows:[{day:'2026-10-06',views:0,visitors:0,enquiries:0},{day:'2026-11-04',views:2,visitors:1,enquiries:0}],previousRows:[]};
test('activation uses the owner timezone while record dates remain UTC and padded rows do not establish history',()=>{
  assert.equal(trackingStartLabel(site),'Nov 3, 2026');
  assert.equal(firstActivityDay(site),'2026-11-04');
  assert.match(historyWindowNotice(site,30,new Date('2026-11-04T12:00:00Z')),/before tracking started/);
  assert.match(historyWindowNotice(site,14,new Date('2026-12-04T12:00:00Z')),/begins after tracking was enabled/);
  assert.equal(trackingStartLabel({...site,windows:{'14':{source:'connected',timezone:'UTC',days:14,rows:[],previousRows:[]}}}),'Nov 3, 2026');
});
test('unknown dates, zero traffic and failed connections cannot imply a tracking start or historical visits',()=>{
  assert.equal(trackingStartLabel({...site,trackingStartedAt:undefined}),'Not verified');
  assert.equal(isTrackingTimestamp('2026-02-30T00:00:00.000Z'),false);
  assert.equal(isTrackingTimestamp('yesterday'),false);
  assert.equal(isTrackingTimestamp('2026-11-04T02:31:21.474Z'),true);
  assert.equal(firstActivityDay({...site,rows:site.rows.slice(0,1)}),null);
  assert.equal(firstActivityDay({...site,connection:'unavailable'}),null);
  assert.match(historyWindowNotice({...site,connection:'unavailable'},30),/unavailable/);
  assert.match(historyWindowNotice({...site,trackingStartedAt:undefined},30),/not been verified/);
});
test('history card labels activation and retrieved activity separately for empty and unavailable sources',async()=>{
  const built=await build({entryPoints:['packages/admin/ui/src/client-portfolio/analytics-history.tsx'],bundle:true,write:false,format:'esm',platform:'node',packages:'external'});
  const {mkdir,writeFile}=await import('node:fs/promises');await mkdir('artifacts/vitris-prototype',{recursive:true});
  await writeFile('artifacts/vitris-prototype/history-component.mjs',built.outputFiles[0].text);
  const {AnalyticsHistory}=await import(pathToFileURL(resolve('artifacts/vitris-prototype/history-component.mjs')).href);
  const markup=renderToStaticMarkup(React.createElement(AnalyticsHistory,{site,days:30}));
  assert.match(markup,/Nov 3, 2026/);assert.match(markup,/Nov 4, 2026/);assert.match(markup,/First activity in retrieved records/);
  const empty=renderToStaticMarkup(React.createElement(AnalyticsHistory,{site:{...site,rows:[]},days:30}));assert.match(empty,/No production activity/);
  const unavailable=renderToStaticMarkup(React.createElement(AnalyticsHistory,{site:{...site,connection:'unavailable'},days:30}));assert.match(unavailable,/currently unavailable/);assert.doesNotMatch(unavailable,/No production activity/);
});
