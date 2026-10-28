export const contractVersion = 1;
export const coreSections = ['overview', 'leads', 'analytics', 'settings', 'access', 'activity'] as const;
export const permissions = ['leads:read', 'leads:write', 'analytics:read', 'settings:write', 'access:read', 'activity:read', 'tasks:read', 'tasks:write'] as const;
export type Permission = typeof permissions[number];
export type Role = 'owner' | 'administrator' | 'editor' | 'analyst';
export const roles: Record<Role, readonly Permission[]> = {
  owner: permissions, administrator: permissions,
  editor: ['leads:read', 'leads:write', 'activity:read', 'tasks:read', 'tasks:write'],
  analyst: ['analytics:read', 'activity:read'],
};
export function can(role: Role, permission: Permission) { return roles[role]?.includes(permission) ?? false; }
export interface AdminManifest {
  schemaVersion: 1;
  installationId: string;
  business: {name: string; initials: string};
  site: {id: string; name: string; origin: string};
  adminOrigin: string;
  modules: string[];
  backend?: {provider:'vitris-harness';origin:string;tenantId:string};
}
export interface ModuleDefinition {
  id: string; version: number; label: string; permission: Permission;
  description: string;
}
export const workQueueModule: ModuleDefinition = {
  id: 'work-queue', version: 1, label: 'Work queue', permission: 'tasks:read',
  description: 'An example business module for tracking follow-up work.',
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, limit = 100): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`Invalid ${name}`);
  return value.trim();
}
function id(value: unknown, name: string) {
  const result = text(value, name, 64);
  if (!/^[a-z][a-z0-9-]*$/.test(result)) throw new Error(`Invalid ${name}`);
  return result;
}
export function isLoopback(origin: string) {
  const url = new URL(origin);
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}
function origin(value: unknown, name: string) {
  const raw = text(value, name, 250); const url = new URL(raw);
  if (raw !== url.origin || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(raw)))) throw new Error(`Invalid ${name}: use an exact HTTPS origin (HTTP is local only)`);
  return raw;
}
export function parseManifest(value: unknown): AdminManifest {
  const v = object(value); const business = object(v.business); const site = object(v.site);
  if (v.schemaVersion !== 1) throw new Error('Unsupported admin contract version');
  if (!Array.isArray(v.modules) || v.modules.length > 20) throw new Error('Invalid modules');
  const modules = v.modules.map(x => id(x, 'module ID'));
  if (new Set(modules).size !== modules.length) throw new Error('Duplicate module');
  let backend:AdminManifest['backend'];
  if(v.backend!==undefined){
    const b=object(v.backend);
    if(b.provider!=='vitris-harness')throw new Error('Unsupported backend provider');
    const tenantId=text(b.tenantId,'tenant ID',100);
    if(!/^[a-zA-Z0-9_-]+$/.test(tenantId))throw new Error('Invalid tenant ID');
    backend={provider:'vitris-harness',origin:origin(b.origin,'backend origin'),tenantId};
    if(isLoopback(backend.origin)&&!isLoopback(String(v.adminOrigin)))throw new Error('Production admin cannot connect to a local backend');
  }
  return {
    schemaVersion: 1, installationId: id(v.installationId, 'installation ID'),
    business: {name: text(business.name, 'business name'), initials: text(business.initials, 'initials', 3)},
    site: {id: id(site.id, 'site ID'), name: text(site.name, 'site name'), origin: origin(site.origin, 'website origin')},
    adminOrigin: origin(v.adminOrigin, 'admin origin'), modules, ...(backend?{backend}:{}),
  };
}
export function validateModules(manifest: AdminManifest, modules: ModuleDefinition[]) {
  const ids = new Set<string>();
  for (const module of modules) {
    id(module.id, 'module ID');
    if (ids.has(module.id) || (coreSections as readonly string[]).includes(module.id)) throw new Error('Duplicate or reserved module ID');
    if (!permissions.includes(module.permission)) throw new Error('Unknown module permission');
    ids.add(module.id);
  }
  for (const enabled of manifest.modules) if (!ids.has(enabled)) throw new Error(`Module ${enabled} is not installed`);
}
