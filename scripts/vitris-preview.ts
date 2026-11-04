import {createPortfolioFixture} from '../tests/client-portfolio-fixture.ts';
import {loadPortfolioConnections} from './portfolio-connections.ts';
import {access} from 'node:fs/promises';
import {startPortfolioOwnerAccess} from './portfolio-owner-access.ts';
import {portfolioLocalPepper,restorePortfolioLocalRecords} from './portfolio-local-state.ts';

// Explicit local installation. Private connections opt into authenticated read-only analytics.
const config = '.vitris/portfolio-connections.json';
const live = await access(config).then(() => loadPortfolioConnections(config), () => undefined);
const preview = await createPortfolioFixture({port: 4393, live, onboarding: true, persistencePath:'.vitris/portfolio-state', onboardingPepper:await portfolioLocalPepper()});
if (live) await restorePortfolioLocalRecords(preview);
const ownerAccess = live ? await startPortfolioOwnerAccess(preview) : undefined;
console.log(`Vitris client workspace: ${preview.origin}/#client-portfolio`);
console.log(live ? 'LIVE READ-ONLY ANALYTICS. Demo login is disabled. Use the private single-use owner sign-in. Updates and publishing are simulated.' : 'Choose Open local demo. All clients, analytics, agent activity and publishing are simulated.');
console.log('Local prospects, templates, and progress are saved privately across preview restarts.');
if (live) console.log('Open or renew private sign-in without resetting records: npm run vitris:signin');
const close = () => {void Promise.resolve(ownerAccess?.close()).then(() => preview.app.dispose()).then(() => process.exit(0));};
process.once('SIGINT', close); process.once('SIGTERM', close);
await new Promise(() => {});
