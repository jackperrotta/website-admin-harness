import {createAdmin} from '../../../packages/admin/src/worker.ts';
import config from './admin.config.json';
import billing from './modules/account-billing/index.ts';
export default createAdmin(config, {modules:[billing]});
