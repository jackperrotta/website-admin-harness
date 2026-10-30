import {schedulingPermissions} from './scheduling.ts';
export * from './scheduling.ts';
export const contractVersion = 1;
export const coreSections = ['overview', 'leads', 'analytics', 'settings', 'access', 'activity'] as const;
export const permissions = ['leads:read', 'leads:write', 'analytics:read', 'settings:write', 'access:read', 'activity:read', 'tasks:read', 'tasks:write', ...schedulingPermissions] as const;
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
  theme?: WebsiteTheme;
}
export const websiteColorKeys = ['colorBg','colorText','colorMuted','colorAccent','colorAccentText','colorSurface','colorSurface2','colorBorder','colorFocus'] as const;
export type WebsiteTheme = Partial<Record<typeof websiteColorKeys[number], string>>;
export function isThemeColor(value: unknown): value is string {
  if(typeof value!=='string'||value.length>100)return false;
  if(/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value))return true;
  const match=value.match(/^(rgb|rgba|hsl|hsla)\(([^()]+)\)$/i);if(!match)return false;
  const parts=match[2].trim().split(/[\s,/]+/);if(parts.length<3||parts.length>4)return false;
  const numeric=(part:string,max:number)=>/^\d+(?:\.\d+)?%?$/.test(part)&&parseFloat(part)>=0&&parseFloat(part)<=(part.endsWith('%')?100:max);
  const components=match[1].toLowerCase().startsWith('rgb')?parts.slice(0,3).every(p=>numeric(p,255)):/^[+-]?\d+(?:\.\d+)?(?:deg)?$/.test(parts[0])&&parts.slice(1,3).every(p=>p.endsWith('%')&&numeric(p,100));
  return components&&(parts.length===3||numeric(parts[3],1));
}
export function isWebsiteTheme(value: unknown): value is WebsiteTheme {
  return isObject(value) && Object.keys(value).length > 0 && Object.entries(value).every(([key,color]) => (websiteColorKeys as readonly string[]).includes(key) && isThemeColor(color));
}
export interface ModuleDefinition {
  id: string; version: number; label: string; permission: Permission;
  description: string;
}
export interface User {id: string; email: string; role: Role}
export interface BootstrapResponse {
  manifest: AdminManifest; user: User | null; passwordLogin: boolean;
  localDemo: boolean; connected: boolean; modules: ModuleDefinition[]; capabilities: string[];
  theme?: WebsiteTheme | null; themeStatus?: 'website' | 'installation' | 'unavailable' | 'default';
}
export type DataSource = 'synthetic' | 'connected' | 'not-connected';
export interface LeadRow {
  id: string; name: string; email: string; message: string; status: string; created_at: string;
  source?: string | null; phone?: string | null; fields_json?: string | null;
  notification_policy?: string | null; notification_status?: string | null; notification_error?: string | null;
}
export const analyticsMetricKeys = ['sessions','bounces','engaged','duration_ms','leave_count','scroll_25','scroll_50','scroll_75','scroll_100','converts_form','converts_tel','converts_mailto','converts_maps','engage_nav','engage_btn','engage_img','engage_carousel'] as const;
export const analyticsBreakdownKeys = ['top_paths_json','top_refs_json','channels_json','devices_json','hours_json','top_engage_json'] as const;
export type AnalyticsMetric = 'views' | 'visitors' | 'enquiries' | typeof analyticsMetricKeys[number];
export type AnalyticsBreakdown = typeof analyticsBreakdownKeys[number];
export interface AnalyticsItem {key: string; n: number}
export type AnalyticsRow = {day: string; views: number; visitors: number; enquiries: number} & Partial<Record<typeof analyticsMetricKeys[number],number>> & Partial<Record<AnalyticsBreakdown,string>>;
export interface LeadsResponse {rows: LeadRow[]; source: DataSource; writable?: boolean; message?: string; mode?: string}
export interface AnalyticsResponse {rows: AnalyticsRow[]; previousRows?: AnalyticsRow[]; source: DataSource; timezone: string; days: number; generatedAt?: string}
export interface SettingsResponse {notification_email: string; revision: number}
export interface AccessRow extends User {active: number}
export interface ActivityRow {id: string; actor: string; action: string; created_at: string}
export interface TaskRow {id: string; title: string; done: number}
export interface RowsResponse<T> {rows: T[]; message?: string}
export interface ModuleRow {id?: string; title?: string; name?: string}
export interface MutationResponse {ok: true}
export interface AuthRequestResponse {ok: true; message: string}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function isLeadRow(value: unknown): value is LeadRow {
  if (!isObject(value)) return false;
  return ['id', 'name', 'email', 'message', 'status', 'created_at'].every(key => typeof value[key] === 'string') &&
    ['source', 'phone', 'fields_json', 'notification_policy', 'notification_status', 'notification_error'].every(key => value[key] === undefined || value[key] === null || typeof value[key] === 'string');
}
export function isAnalyticsRow(value: unknown): value is AnalyticsRow {
  if (!isObject(value) || typeof value.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)) return false;
  const count=(n:unknown)=>typeof n==='number' && Number.isSafeInteger(n) && n>=0;
  if (!['views', 'visitors', 'enquiries'].every(key => count(value[key])) || !analyticsMetricKeys.every(key=>value[key]===undefined || count(value[key]))) return false;
  return analyticsBreakdownKeys.every(key=>{
    const raw=value[key];if(raw===undefined)return true;if(typeof raw!=='string'||raw.length>100_000)return false;
    try{const items:unknown=JSON.parse(raw);return Array.isArray(items)&&items.length<=200&&items.every((item:unknown)=>isObject(item)&&typeof item.key==='string'&&item.key.length<=300&&count(item.n)&&(key!=='hours_json'||/^(?:[0-9]|1[0-9]|2[0-3])$/.test(item.key)));}catch{return false;}
  });
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
  if(v.theme!==undefined&&!isWebsiteTheme(v.theme))throw new Error('Invalid website theme colors');
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
    adminOrigin: origin(v.adminOrigin, 'admin origin'), modules, ...(backend?{backend}:{}), ...(v.theme?{theme:v.theme as WebsiteTheme}:{}),
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
