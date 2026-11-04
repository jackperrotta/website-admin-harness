import {readFile, writeFile, mkdir, access} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import type {createPortfolioFixture} from '../tests/client-portfolio-fixture.ts';

export async function portfolioLocalPepper(directory='.vitris') {
  const path=join(directory,'portfolio-runtime.json');
  try {const value=JSON.parse(await readFile(path,'utf8')) as {onboardingPepper?:string}; if (!value.onboardingPepper || !/^[a-f0-9]{64}$/.test(value.onboardingPepper)) throw Error('Invalid private local runtime configuration.'); return value.onboardingPepper;}
  catch(error) {if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;}
  if (await access(join(directory,'portfolio-state')).then(()=>true,()=>false)) throw Error('The private local credential key is missing. Restore portfolio-runtime.json before opening the saved preview.');
  await mkdir(directory,{recursive:true}); const onboardingPepper=randomBytes(32).toString('hex'); await writeFile(path,JSON.stringify({onboardingPepper}),{mode:0o600}); return onboardingPepper;
}
export async function restorePortfolioLocalRecords(preview: Pick<Awaited<ReturnType<typeof createPortfolioFixture>>,'db'|'origin'|'manifest'>) {
  const already=await preview.db.prepare('SELECT COUNT(*) n FROM users').first<{n:number}>(); if (already?.n) return;
  let snapshot:{origin:string;siteId:string;installationId:string;tables:Record<string,Record<string,string|number|null>[]>};
  try {snapshot=JSON.parse(await readFile('.vitris/portfolio-records-snapshot.json','utf8')) as typeof snapshot;} catch(error) {if ((error as NodeJS.ErrnoException).code==='ENOENT') return; throw error;}
  if (snapshot.origin!==preview.origin || snapshot.siteId!==preview.manifest.site.id || snapshot.installationId!==preview.manifest.installationId) throw Error('The private snapshot belongs to another local installation.');
  const tables=['users','login_tokens','sessions','auth_limits','leads','analytics_daily','settings','audit','tasks','password_credentials','client_portfolio_prototype','client_onboarding_prospects','client_onboarding_sessions'];
  const statements=[];
  for (const table of tables) for (const row of snapshot.tables[table] || []) {
    const columns=Object.keys(row); if (columns.some(c=>!/^[a-z_]+$/.test(c))) throw Error('Invalid local snapshot column.');
    statements.push(preview.db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).bind(...columns.map(c=>row[c])));
  }
  if (statements.length) await preview.db.batch(statements);
}
