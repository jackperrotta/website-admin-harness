import {schedulingPermissions} from './scheduling.ts';
import {clientPortfolioPermissions} from './client-portfolio.ts';
import {clientOnboardingPermissions} from './client-onboarding.ts';
import {billingPermissions} from './billing.ts';
import {emailCampaignPermissions} from './email-campaigns.ts';
export * from './email-campaigns.ts';
export * from './billing.ts';
export * from './stripe-billing.ts';
export * from './client-portfolio.ts';
export * from './client-onboarding.ts';
export * from './scheduling.ts';
export * from './webmaster.ts';
export * from './pairing.ts';
export * from './signon.ts';
export const contractVersion = 1;
export const coreSections = ['overview', 'leads', 'analytics', 'settings', 'access', 'activity'] as const;
export const permissions = ['leads:read', 'leads:write', 'analytics:read', 'settings:write', 'access:read', 'access:write', 'activity:read', 'tasks:read', 'tasks:write', ...schedulingPermissions, ...clientPortfolioPermissions, ...clientOnboardingPermissions, ...billingPermissions, ...emailCampaignPermissions] as const;
export type Permission = typeof permissions[number];
export type Role = 'owner' | 'administrator' | 'editor' | 'analyst';
export const roles: Record<Role, readonly Permission[]> = {
  owner: permissions, administrator: permissions.filter(p => p!=='access:write' && !(clientPortfolioPermissions as readonly string[]).includes(p) && !(clientOnboardingPermissions as readonly string[]).includes(p) && !(billingPermissions as readonly string[]).includes(p) && !(emailCampaignPermissions as readonly string[]).includes(p)),
  editor: ['leads:read', 'leads:write', 'activity:read', 'tasks:read', 'tasks:write'],
  analyst: ['analytics:read', 'activity:read'],
};
export function can(role: Role, permission: Permission) { return roles[role]?.includes(permission) ?? false; }
export interface AdminManifest {
  webmasterSignOn?: import('./signon.ts').SignOnConfiguration;
  reportingPairing?: import('./pairing.ts').PairingConfiguration;
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
  ui?: 'stripe-billing' | 'stripe-account' | 'email-campaigns';
  id: string; version: number; label: string; permission: Permission;
  description: string;
}
export interface User {id: string; email: string; role: Role; webmaster?:{organizationId:string;organizationName:string;permissions:Permission[];revision:number}}
export function userCan(user:User, permission:Permission) {return user.webmaster ? user.webmaster.permissions.includes(permission) : can(user.role,permission);}
export interface BootstrapResponse {
  manifest: AdminManifest; user: User | null; passwordLogin: boolean;
  localDemo: boolean; connected: boolean; modules: ModuleDefinition[]; capabilities: string[];
  theme?: WebsiteTheme | null; themeStatus?: 'website' | 'installation' | 'unavailable' | 'default';
  accountAuth?: AccountCapabilities;
  emailLoginConfigured?: boolean;
  privateLocalSignIn?: boolean;
  webmasterEnabled?: boolean;
}
export type DataSource = 'synthetic' | 'connected' | 'not-connected';
export interface LeadRow {
  id: string; name: string; email: string; message: string; status: string; created_at: string;
  source?: string | null; phone?: string | null; fields_json?: string | null;
  notification_policy?: string | null; notification_status?: string | null; notification_error?: string | null;
  followUp?: LeadFollowUp;
}
export interface LeadFollowUp {assignedTo:string|null;dueDate:string|null;notes:string;completed:boolean;revision:number;updatedAt:string|null}
export interface LeadPagination {version:1;total:number;newCount:number;nextCursor:string|null}
export interface LeadTeamMember {id:string;email:string}
export function isLeadFollowUp(value:unknown):value is LeadFollowUp {
  if(!isObject(value))return false;
  return (value.assignedTo===null||typeof value.assignedTo==='string'&&value.assignedTo.length>0&&value.assignedTo.length<=100)&&(value.dueDate===null||typeof value.dueDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.dueDate)&&Number.isFinite(Date.parse(value.dueDate+'T00:00:00Z'))&&new Date(value.dueDate+'T00:00:00Z').toISOString().slice(0,10)===value.dueDate)&&typeof value.notes==='string'&&value.notes.length<=3000&&typeof value.completed==='boolean'&&Number.isSafeInteger(value.revision)&&Number(value.revision)>=0&&(value.updatedAt===null||typeof value.updatedAt==='string');
}
export function isLeadPagination(value:unknown):value is LeadPagination {
  return isObject(value)&&value.version===1&&[value.total,value.newCount].every(n=>Number.isSafeInteger(n)&&Number(n)>=0)&&(value.nextCursor===null||typeof value.nextCursor==='string'&&value.nextCursor.length<=4096);
}
export const analyticsMetricKeys = ['sessions','bounces','engaged','duration_ms','leave_count','scroll_25','scroll_50','scroll_75','scroll_100','converts_form','converts_tel','converts_mailto','converts_maps','engage_nav','engage_btn','engage_img','engage_carousel'] as const;
export const analyticsBreakdownKeys = ['top_paths_json','top_refs_json','channels_json','devices_json','hours_json','top_engage_json'] as const;
export type AnalyticsMetric = 'views' | 'visitors' | 'enquiries' | typeof analyticsMetricKeys[number];
export type AnalyticsBreakdown = typeof analyticsBreakdownKeys[number];
export interface AnalyticsItem {key: string; n: number}
export type AnalyticsRow = {day: string; views: number; visitors: number; enquiries: number} & Partial<Record<typeof analyticsMetricKeys[number],number>> & Partial<Record<AnalyticsBreakdown,string>>;
export interface LeadsResponse {rows: LeadRow[]; source: DataSource; writable?: boolean; message?: string; mode?: string; followUpsEnabled?:boolean; pagination?:LeadPagination; truncated?:boolean}
export interface AnalyticsResponse {rows: AnalyticsRow[]; previousRows?: AnalyticsRow[]; source: DataSource; timezone: string; days: number; generatedAt?: string}
export interface SettingsResponse {notification_email: string; revision: number}
export interface AccessRow extends User {active: number}
export interface AccountCapabilities {enabled:boolean;emailReady:boolean;setupAvailable:boolean;emailVerified:boolean;canInvite:boolean}
export interface AccountAction {purpose:'owner'|'invite'|'verify'|'reset';email:string;expiresAt:number;business:string}
export interface TeamInvitation {id:string;email:string;role:string;expiresAt:number;status:'accepted'|'canceled'|'expired'|'pending';delivery:'pending'|'sending'|'sent'|'failed'|'superseded'}
export interface AccessResponse extends RowsResponse<AccessRow & {email_verified_at?:number|null}> {invitations?:TeamInvitation[];accountAuth?:AccountCapabilities}
export interface ActivityRow {id: string; actor: string; action: string; created_at: string; person_id?:string|null;organization_id?:string|null;organization_name?:string|null}
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
    ['source', 'phone', 'fields_json', 'notification_policy', 'notification_status', 'notification_error'].every(key => value[key] === undefined || value[key] === null || typeof value[key] === 'string') && (value.followUp===undefined||isLeadFollowUp(value.followUp));
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
  let reportingPairing:AdminManifest['reportingPairing'];
  if(v.reportingPairing!==undefined){
    const config=object(v.reportingPairing);
    if(!Array.isArray(config.trustedWebmasters)||config.trustedWebmasters.length<1||config.trustedWebmasters.length>10)throw new Error('Configure trusted webmaster installations explicitly');
    const trustedWebmasters=config.trustedWebmasters.map(raw=>{const p=object(raw),adminOrigin=origin(p.adminOrigin,'trusted webmaster origin');if(isLoopback(adminOrigin)&&!isLoopback(String(v.adminOrigin)))throw new Error('A production issuer cannot trust a local webmaster');return {installationId:id(p.installationId,'webmaster installation ID'),siteId:id(p.siteId,'webmaster site ID'),adminOrigin,organizationId:id(p.organizationId,'webmaster organization ID'),organizationName:text(p.organizationName,'webmaster organization name')};});
    if(new Set(trustedWebmasters.map(p=>p.adminOrigin)).size!==trustedWebmasters.length)throw new Error('Duplicate trusted webmaster origin');
    reportingPairing={trustedWebmasters};
  }
  let webmasterSignOn:AdminManifest['webmasterSignOn'];
  if(v.webmasterSignOn!==undefined){
    const c=object(v.webmasterSignOn);
    if(c.mode==='broker')webmasterSignOn={mode:'broker'};
    else if(c.mode==='client'){
      const b=object(c.broker),k=object(c.publicKey),adminOrigin=origin(b.adminOrigin,'sign-on broker origin');
      if(isLoopback(adminOrigin)&&!isLoopback(String(v.adminOrigin)))throw Error('A production client cannot trust a local sign-on broker');
      if(k.kty!=='EC'||k.crv!=='P-256'||typeof k.x!=='string'||typeof k.y!=='string'||!/^[-\w]{43}$/.test(k.x)||!/^[-\w]{43}$/.test(k.y)||k.d!==undefined)throw Error('Pin the broker public P-256 key');
      webmasterSignOn={mode:'client',broker:{installationId:id(b.installationId,'broker installation ID'),siteId:id(b.siteId,'broker site ID'),adminOrigin},subjectId:text(c.subjectId,'approved broker subject',100),organizationId:id(c.organizationId,'webmaster organization ID'),publicKey:{kty:'EC',crv:'P-256',x:k.x,y:k.y}};
    }else throw Error('Unsupported webmaster sign-on mode');
  }
  return {
    schemaVersion: 1, installationId: id(v.installationId, 'installation ID'),
    business: {name: text(business.name, 'business name'), initials: text(business.initials, 'initials', 3)},
    site: {id: id(site.id, 'site ID'), name: text(site.name, 'site name'), origin: origin(site.origin, 'website origin')},
    adminOrigin: origin(v.adminOrigin, 'admin origin'), modules, ...(backend?{backend}:{}), ...(v.theme?{theme:v.theme as WebsiteTheme}:{}), ...(reportingPairing?{reportingPairing}:{}), ...(webmasterSignOn?{webmasterSignOn}:{}),
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

export * from './maintenance.ts';
