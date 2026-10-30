export interface CliOptions {
  dir?: string; name?: string; slug?: string; domain?: string; website?: string; email?: string;
  site?: string; plan?: boolean; apply?: boolean; from?: string; 'backend-origin'?: string;
  tenant?: string; 'lead-write'?: boolean;
}
export interface PackageManifest {name: string; version: string}
export interface LaunchConfig extends Record<string, unknown> {
  slug?: string; name?: string; publicOrigin?: string; backendOrigin?: string; kernelOrigin?: string;
  admin?: {url: string; tenantId?: string};
}
export interface WranglerConfig {
  name: string; main: string; compatibility_date: string; workers_dev: boolean;
  assets: {directory: string; binding: string; not_found_handling: string; run_worker_first: boolean};
  d1_databases: {binding: string; database_name: string; database_id: string; migrations_dir: string}[];
  r2_buckets: {binding: string; bucket_name: string}[];
  vars: {MODE: string; AUTH_FROM?: string}; routes: {pattern: string; custom_domain: boolean}[];
  send_email?: {name: string; allowed_sender_addresses: string[]}[];
}
export interface SetupState {
  stage: 'creating' | 'configured'; directory: string; planDigest: string; configuredLaunchDigest?: string;
}
export interface SetupPlan {
  schemaVersion: number; site: string; directory: string; package: string; version: string;
  cliDigest: string; launchDigest: string; connection: Record<string, string | number>;
  backendOrigin: string; name: string; scopes: string[]; cloudWrites: boolean;
}
