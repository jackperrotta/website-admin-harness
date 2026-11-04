import {createAdmin} from '../../packages/admin/src/worker.ts';
import config from './admin.config.json';
import portfolio from './modules/client-portfolio/index.ts';
import onboarding from './modules/client-onboarding/index.ts';

// Deliberately local-only. No production configuration or client credentials.
export default createAdmin(config, {modules: [portfolio, onboarding]});
