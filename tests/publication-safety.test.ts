import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {assertSafeArchive,credentialIssue} from '../scripts/publication-safety.ts';

const secret=()=>['rk','live','A'.repeat(80)].join('_');
test('publication rejects credentials in actual npm archives and private files even without secret contents',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vitris-publication-')),directory=join(root,'package');await mkdir(join(directory,'dist'),{recursive:true});
  const archive=join(root,'candidate.tgz'),entry=join(directory,'dist/runtime.js');
  const pack=()=>execFileSync('tar',['-czf',archive,'-C',root,'package'],{stdio:'pipe'});
  await writeFile(entry,'export const provider="stripe";');pack();await assertSafeArchive(archive);
  await writeFile(entry,`export const accidentallyBundled=${JSON.stringify(secret())};`);pack();
  await assert.rejects(assertSafeArchive(archive),error=>error instanceof Error&&error.message.includes('Stripe secret')&&!error.message.includes(secret()));
  await writeFile(entry,'export const provider="stripe";');await writeFile(join(directory,'stripe.live.env'),'# No value yet');pack();
  await assert.rejects(assertSafeArchive(archive),/Unsafe package file/);
  assert.equal(credentialIssue('STRIPE_SECRET_KEY=YOUR_PRIVATE_KEY'),undefined);
  assert.equal(credentialIssue(['whsec','B'.repeat(40)].join('_')),'Stripe webhook signing secret');
});

test('Git privacy scan covers untracked source and force-added private files without echoing credentials',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vitris-git-privacy-'));execFileSync('git',['init','--quiet'],{cwd:root});
  await writeFile(join(root,'.gitignore'),'*.env\n');await writeFile(join(root,'stripe.live.env'),secret());
  const scan=()=>spawnSync(process.execPath,['--experimental-strip-types',resolve('scripts/check-privacy.ts')],{cwd:root,encoding:'utf8'});
  assert.equal(scan().status,0);
  await writeFile(join(root,'oops.js'),secret());const leaked=scan();assert.equal(leaked.status,1);assert.match(leaked.stderr,/oops.js/);assert.ok(!leaked.stderr.includes(secret()));
  execFileSync('git',['add','oops.js'],{cwd:root});await writeFile(join(root,'oops.js'),'// cleaned working copy');
  const staged=scan();assert.equal(staged.status,1);assert.match(staged.stderr,/Git index/);assert.ok(!staged.stderr.includes(secret()));
  execFileSync('git',['add','oops.js'],{cwd:root});execFileSync('git',['add','--force','stripe.live.env'],{cwd:root});
  const forced=scan();assert.equal(forced.status,1);assert.match(forced.stderr,/stripe.live.env/);assert.ok(!forced.stderr.includes(secret()));
});

test('Stripe verifier requires explicit installation files rather than adopting harness defaults',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vitris-verifier-'));await mkdir(join(root,'.vitris/stripe'),{recursive:true});
  const oldReport=join(root,'.vitris/stripe/sandbox-verification.json');await writeFile(oldReport,'preserve');
  const result=spawnSync(process.execPath,['--experimental-strip-types',resolve('scripts/stripe-verify.ts')],{cwd:root,encoding:'utf8',env:{...process.env,STRIPE_SECRET_KEY:secret()}});
  assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).code,'installation_paths_required');assert.ok(!result.stdout.includes(secret()));assert.equal(await readFile(oldReport,'utf8'),'preserve');
});
