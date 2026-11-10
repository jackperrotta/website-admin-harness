import {parseManifest} from '../../../contracts/src/index.ts';
import {SearchConsoleService} from './service.ts';
import type {SearchConsoleEnv} from './types.ts';
export type SearchConsoleWorkerEnv=SearchConsoleEnv&{DB:D1Database;MODE?:string};
/** Optional cron companion for Pages installations; no browser or machine API is exposed. */
export function createSearchConsoleWorker(input:unknown){
  const manifest=parseManifest(input);
  return {
    fetch(){return new Response('Not found',{status:404});},
    async scheduled(_controller:ScheduledController,env:SearchConsoleWorkerEnv){if(manifest.modules.includes('search-console'))await new SearchConsoleService(env,manifest).tick();},
  };
}
