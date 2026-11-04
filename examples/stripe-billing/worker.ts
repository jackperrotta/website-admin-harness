import {createAdmin} from '../../packages/admin/src/worker.ts';
import manifest from './admin.config.json';
import billing from './modules/billing/index.ts';
// Copy into a separately owned installation and configure its own account.
export default createAdmin(manifest,{modules:[billing]});
