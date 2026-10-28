import {createAdmin} from '../../packages/admin/dist/worker.js';
import manifest from './admin.config.json';
export default createAdmin(manifest);
