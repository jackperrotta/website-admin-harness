import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPortfolioFixture} from './client-portfolio-fixture.ts';
import type {OnboardingTemplate,ProspectWorkspace,ProspectPortal} from '../packages/contracts/src/index.ts';
import {portfolioLocalPepper} from '../scripts/portfolio-local-state.ts';

function api(f:Awaited<ReturnType<typeof createPortfolioFixture>>) {
  const request=(path='',data?:unknown,cookie=f.cookies.owner,origin=f.origin)=>f.app.dispatchFetch(f.origin+'/api/modules/client-onboarding'+path,{method:data===undefined?'GET':'POST',headers:{cookie,...(data===undefined?{}:{origin,'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const state=async()=>{const r=await request();assert.equal(r.status,200);return r.json() as Promise<ProspectWorkspace>;};
  return {request,state};
}
const prospect=(template:OnboardingTemplate,email='morgan@example.test')=>({business:'Sample workshop',name:'Morgan',email,previewUrl:'',message:template.message,title:template.title,intro:template.intro,fields:template.fields,requiresPayment:template.requiresPayment,templateId:template.id,templateRevision:template.revision});

test('saved local credentials retain their key and a missing key cannot silently replace it',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'vitris-local-key-'));
  const first=await portfolioLocalPepper(directory);assert.equal(await portfolioLocalPepper(directory),first);
  await mkdir(join(directory,'portfolio-state'));await rm(join(directory,'portfolio-runtime.json'));
  await assert.rejects(portfolioLocalPepper(directory),/key is missing/);
});

test('reusable templates exclude client answers, use optimistic revisions, and preserve prospect snapshots after edits/archive', {timeout:90000},async()=>{
  const f=await createPortfolioFixture({onboarding:true}),h=api(f);
  try {
    const initial=await h.state();assert.equal(initial.templates.length,3);
    const source=initial.templates.find(t=>t.id==='starter-home')!;
    const created=await h.request('/templates',{...source,name:'Home service welcome',fields:source.fields.map(v=>({...v,value:'Private client answer'}))});assert.equal(created.status,200);
    const template=(await created.json() as ProspectWorkspace).templates.find(t=>t.source==='saved')!;
    assert.ok(template.fields.every(f=>f.value===''));
    const prepared=await h.request('',prospect(template));assert.equal(prepared.status,200);
    const p=(await prepared.json() as ProspectWorkspace).rows[0];assert.equal(p.onboarding?.templateName,template.name);
    const changed=await h.request(`/templates/${template.id}`,{...template,name:'Updated home welcome',fields:[]});assert.equal(changed.status,200);
    assert.equal((await h.request(`/templates/${template.id}`,{...template,name:'Stale edit'})).status,409);
    assert.equal((await h.request('',prospect(template,'second@example.test'))).status,409);
    const state=await h.state();assert.deepEqual(state.rows[0].fields,p.fields);assert.equal(state.rows[0].onboarding?.templateName,template.name);
    const updated=state.templates.find(t=>t.id===template.id)!;
    assert.equal((await h.request(`/templates/${template.id}/archive`,{revision:updated.revision})).status,200);
    assert.ok(!(await h.state()).templates.some(t=>t.id===template.id));assert.deepEqual((await h.state()).rows[0].fields,p.fields);
    assert.equal((await h.request('',prospect(updated,'third@example.test'))).status,404);
    assert.equal((await h.request('/templates',{...source,name:'No permission'},f.cookies.administrator)).status,403);
    assert.equal((await h.request('/templates',{...source,name:'Bad origin'},f.cookies.owner,'https://other.test')).status,403);
    assert.equal((await h.request('/templates',{...source,name:'Invalid',fields:[{...source.fields[0],section:'system'}]})).status,400);
    const saved=await h.request('/templates',{...source,name:'Scoped template'});const scoped=(await saved.json() as ProspectWorkspace).templates.find(t=>t.source==='saved')!;
    await f.db.prepare("UPDATE client_onboarding_templates SET installation_id='another-installation' WHERE id=?").bind(scoped.id).run();
    assert.equal((await h.request(`/templates/${scoped.id}`,{...scoped,name:'Cross-installation edit'})).status,409);
    assert.equal((await h.request('',prospect(scoped,'fourth@example.test'))).status,404);
  } finally {await f.app.dispose();}
});

test('invitation cookies resume only their assigned non-secret draft and cannot bypass question definitions or expiry', {timeout:90000},async()=>{
  const f=await createPortfolioFixture({onboarding:true}),h=api(f);
  try {
    const template=(await h.state()).templates.find(t=>t.id==='starter-home')!;
    const made=await h.request('',prospect(template));const p=(await made.json() as ProspectWorkspace).rows[0];
    const invited=await h.request(`/${p.id}/invite`,{}),link=(await invited.json() as {invitation:{url:string}}).invitation.url,token=new URLSearchParams(new URL(link).hash.slice(1)).get('token');
    const inspected=await h.request('/hooks/invitation',{token},'');assert.equal(inspected.status,200);
    const cookie=inspected.headers.get('set-cookie')!.split(';')[0];assert.match(cookie,/^vitris-prospect-setup-/);assert.match(inspected.headers.get('set-cookie')!,/HttpOnly/);
    const fields=p.fields.map(f=>({...f,value:f.id==='phone'?'555-0100':f.id==='areas'?'Example city':f.id==='specialties'?'Custom kitchens':''}));
    const data={inviteId:p.id,name:'Morgan',fields,step:'account',password:'this must never be stored'};
    assert.equal((await h.request('/hooks/progress',data,cookie)).status,200);
    const resumed=await h.request('/hooks/invitation',{inviteId:p.id},cookie);assert.equal(resumed.status,200);const portal=await resumed.json() as ProspectPortal;
    assert.equal(portal.draft?.step,'account');assert.equal(portal.draft?.fields?.[0].value,'555-0100');assert.equal(portal.inviteId,p.id);
    const stored=await f.db.prepare('SELECT onboarding_draft FROM client_onboarding_prospects WHERE id=?').bind(p.id).first<{onboarding_draft:string}>();assert.ok(!stored!.onboarding_draft.includes('password'));
    assert.equal((await h.request('/hooks/invitation',{inviteId:'another-prospect'},cookie)).status,410);
    assert.equal((await h.request('/hooks/progress',{...data,fields:fields.map(v=>({...v,required:false}))},cookie)).status,400);
    assert.equal((await h.request('/hooks/progress',{...data,step:'payment'},cookie)).status,400);
    const password='a local sample password for testing';
    assert.equal((await h.request('/hooks/activate',{...data,password,confirmPassword:password,fields:fields.map(v=>({...v,value:v.id==='phone'?'invalid':v.value}))},cookie)).status,400);
    const accepted=await h.request('/hooks/activate',{...data,password,confirmPassword:password},cookie);assert.equal(accepted.status,200);
    assert.equal((await h.request('/hooks/invitation',{inviteId:p.id},cookie)).status,410);
    const ownerState=await h.state();assert.equal(ownerState.rows[0].status,'active');assert.equal(ownerState.rows[0].fields[0].value,'555-0100');
    const next=await h.request('',prospect(template,'next@example.test'));const q=(await next.json() as ProspectWorkspace).rows[0];await h.request(`/${q.id}/invite`,{});
    await f.db.prepare('UPDATE client_onboarding_prospects SET expires_at=1 WHERE id=?').bind(q.id).run();
    assert.equal((await h.request('/hooks/progress',{...data,inviteId:q.id},cookie)).status,410);
  } finally {await f.app.dispose();}
});

test('additive template migration preserves older prospects; local persistence retains templates, accounts and password login', {timeout:120000},async()=>{
  const old=await createPortfolioFixture({onboarding:true,applyTemplatesMigration:false});
  try {
    await old.db.prepare("INSERT INTO client_onboarding_prospects(site_id,installation_id,admin_origin,id,business,name,email,created_at,fields) VALUES(?,?,?,?,?,?,?,?,?)").bind(old.manifest.site.id,old.manifest.installationId,old.origin,'legacy-prospect','Legacy fixture','Morgan','legacy@example.test',new Date().toISOString(),'[]').run();
    const sql=await readFile('packages/admin/prototypes/client-onboarding/migrations/0011_onboarding_templates.sql','utf8');for(const statement of sql.replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await old.db.prepare(statement).run();
    const state=await api(old).state();assert.equal(state.rows[0].id,'legacy-prospect');assert.equal(state.rows[0].onboarding?.title,'Let’s make it yours.');
    assert.equal((await old.db.prepare('SELECT COUNT(*) n FROM users').first<{n:number}>())?.n,3);
  } finally {await old.app.dispose();}
  const directory=await mkdtemp(join(tmpdir(),'vitris-onboarding-persist-')),pepper='synthetic-local-pepper-for-preserved-credentials-12345';
  const first=await createPortfolioFixture({onboarding:true,persistencePath:directory,onboardingPepper:pepper}),h=api(first);const port=Number(new URL(first.origin).port);
  const source=(await h.state()).templates[0];const saved=await h.request('/templates',{...source,name:'Persistent template'});const template=(await saved.json() as ProspectWorkspace).templates.find(t=>t.source==='saved')!;
  const made=await h.request('',{...prospect(template),fields:[]});const row=(await made.json() as ProspectWorkspace).rows[0];
  const invited=await h.request(`/${row.id}/invite`,{});const link=(await invited.json() as {invitation:{url:string}}).invitation.url;const token=new URLSearchParams(new URL(link).hash.slice(1)).get('token'),password='a local sample password for testing';
  assert.equal((await h.request('/hooks/activate',{token,name:'Morgan',fields:[],password,confirmPassword:password},'')).status,200);
  await first.app.dispose();
  const second=await createPortfolioFixture({port,onboarding:true,persistencePath:directory,onboardingPepper:pepper});
  try {const state=await api(second).state();assert.equal(state.rows[0].id,row.id);assert.equal(state.rows[0].status,'active');assert.ok(state.templates.some(t=>t.name==='Persistent template'));assert.equal((await api(second).request('/hooks/login',{email:row.email,password},'')).status,200);}finally{await second.app.dispose();}
});
