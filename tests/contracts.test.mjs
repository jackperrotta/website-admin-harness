import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseManifest,validateModules,can,workQueueModule,coreSections} from '../packages/contracts/dist/index.js';
const config={schemaVersion:1,installationId:'acme',business:{name:'Acme',initials:'A'},site:{id:'acme',name:'Main',origin:'https://acme.test'},adminOrigin:'https://admin.acme.test',modules:['work-queue']};
test('manifest rejects remote HTTP, path origins, duplicate and unknown modules',()=>{
  assert.equal(parseManifest(config).installationId,'acme');
  for(const origin of ['http://admin.acme.test','https://admin.acme.test/login','https://admin.acme.test/'])assert.throws(()=>parseManifest({...config,adminOrigin:origin}));
  assert.throws(()=>parseManifest({...config,modules:['work-queue','work-queue']}));
  assert.throws(()=>validateModules({...config,modules:['unknown']},[workQueueModule]));
  assert.throws(()=>validateModules(config,[workQueueModule,workQueueModule]));
  assert.throws(()=>validateModules(config,[{...workQueueModule,id:'leads'}]));
});
test('scope omits page and media editors; capabilities are role based',()=>{
  assert.ok(!coreSections.includes('pages')&&!coreSections.includes('media'));
  assert.equal(can('analyst','leads:write'),false);assert.equal(can('owner','settings:write'),true);
});
