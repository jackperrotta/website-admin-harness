import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {applyWebsiteTheme} from '../packages/admin/ui/src/theme.ts';
import {analyticsMetricKeys,analyticsBreakdownKeys,isAnalyticsRow,isWebsiteTheme,parseManifest,type AnalyticsResponse} from '../packages/contracts/src/index.ts';

test('analytics contract validates optional fields and preserves basic backend compatibility',()=>{
 const basic={day:'2026-10-28',views:8,visitors:4,enquiries:1};
 assert.equal(isAnalyticsRow(basic),true);
 assert.equal(isAnalyticsRow({...basic,sessions:4,hours_json:'[{"key":"23","n":2}]'}),true);
 for(const fields of [{sessions:-1},{duration_ms:NaN},{sessions:'4'},{channels_json:'oops'},{devices_json:'{}'},{hours_json:'[{"key":"24","n":2}]'},{channels_json:'[{"key":"organic","n":-1}]'}])assert.equal(isAnalyticsRow({...basic,...fields}),false);
 assert.equal(isWebsiteTheme({colorAccent:'#ffbb33',colorBg:'rgb(250, 248, 245)'}),true);
 for(const value of [{colorAccent:'url(https://bad.test)'},{colorAccent:'red; background: url(x)'},{colorAccent:'rgb(1)'},{colorAccent:'rgb(999,0,0)'},{fontBody:'anything'},{}])assert.equal(isWebsiteTheme(value),false);
 const config={schemaVersion:1,installationId:'fixture',business:{name:'Fixture',initials:'F'},site:{id:'fixture',name:'Main',origin:'https://fixture.test'},adminOrigin:'https://admin.fixture.test',modules:[]};
 assert.deepEqual(parseManifest({...config,theme:{colorAccent:'#8844aa'}}).theme,{colorAccent:'#8844aa'});assert.throws(()=>parseManifest({...config,theme:{colorAccent:'url(x)'}}));
});

test('website color application changes the whole palette and resets missing installation colors',()=>{
 const properties=new Map<string,string>();const root={style:{setProperty:(key:string,value:string)=>properties.set(key,value),colorScheme:''}} as unknown as HTMLElement;
 applyWebsiteTheme(root,{colorAccent:'#ffdd22',colorBg:'#fff9e0',colorText:'#292010',colorSurface:'#fffdf4',colorSurface2:'#f2e9ca',colorBorder:'#e0d3a0'});
 assert.equal(properties.get('--accent'),'#ffdd22');assert.equal(properties.get('--accent-ink'),'#111111');assert.equal(properties.get('--canvas'),'#fff9e0');assert.equal(properties.get('--sidebar'),'#f2e9ca');assert.equal(properties.get('--surface'),'#fffdf4');
 applyWebsiteTheme(root,{colorAccent:'#442266'});assert.equal(properties.get('--accent-ink'),'#ffffff');assert.notEqual(properties.get('--canvas'),'#fff9e0');
 applyWebsiteTheme(root,null);assert.notEqual(properties.get('--accent'),'#442266');
 applyWebsiteTheme(root,{colorBg:'#10141a',colorText:'#ffffff',colorAccent:'#aaccff'});assert.equal(root.style.colorScheme,'dark');assert.equal(properties.get('--focus'),'#aaccff');
});

test('analytics UI handles empty, zero, legacy and detailed data without fictitious metrics',async()=>{
 const bundle=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {AnalyticsDashboard} from './packages/admin/ui/src/analytics-dashboard.tsx';export const render=(data)=>renderToStaticMarkup(React.createElement(AnalyticsDashboard,{data}));",resolveDir:resolve('.'),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'node',packages:'external'});
 const {mkdtemp,writeFile}=await import('node:fs/promises');
 // Keep resolution under the repository for installed React; no browser/network is needed.
 const folder=await mkdtemp(resolve('node_modules/.analytics-ui-test-'));
 const path=resolve(folder,'render.mjs');await writeFile(path,bundle.outputFiles[0].text);
 const {pathToFileURL}=await import('node:url');const {render}=await import(pathToFileURL(path).href) as {render:(data:AnalyticsResponse)=>string};
 const base:AnalyticsResponse={source:'connected',days:14,timezone:'UTC',rows:[]};
 assert.match(render(base),/No analytics for this period/);assert.match(render({...base,source:'not-connected'}),/Connect your website analytics/);
 const basic={day:'2026-10-28',views:10,visitors:5,enquiries:1};const legacy=render({...base,rows:[basic]});
 assert.match(legacy,/No comparable history/);assert.match(legacy,/Detailed breakdowns become available/);assert.ok(!legacy.includes('Sample analytics'));
 const zero=render({...base,rows:[{...basic,views:0,visitors:0,enquiries:0,sessions:0,leave_count:0}]});assert.ok(!/NaN|Infinity/.test(zero));
 const full=Object.assign({},Object.fromEntries(analyticsMetricKeys.map(key=>[key,0])),Object.fromEntries(analyticsBreakdownKeys.map(key=>[key,'[]'])));
 const detail=render({...base,rows:[{...basic,...full,sessions:4,leave_count:2,duration_ms:180000,engaged:2,bounces:1,hours_json:'[{"key":"23","n":10}]',devices_json:'[{"key":"mobile","n":10}]'}]});
 assert.match(detail,/1m 30s/);assert.match(detail,/Website analytics/);assert.equal((detail.match(/ax-hour-bar/g)||[]).length,24);assert.ok(!detail.includes('fictional'));
});
