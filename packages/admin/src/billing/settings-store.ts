import {createStripeBilling, type StripeBillingConfig} from './module.ts';
import type {AdminModule} from '../worker.ts';
import {validatePolicies, type BillingPolicies} from './setup.ts';

export type Manifest = Parameters<NonNullable<AdminModule['scheduled']>>[1];
export interface BillingSettingsEnv {DB: D1Database; BILLING_SETTINGS_KEY?: string}
export type BillingMode = 'test' | 'live';
export interface BillingProfile {config: StripeBillingConfig; secretKey: string; webhookSecret: string; verifiedAt: number; policies?: BillingPolicies; appliedPolicy?: string; activation?: {at: number; actor: string}}
export interface StoredBilling extends BillingProfile {profiles?: Partial<Record<BillingMode, BillingProfile>>}
export function billingProfiles(value: StoredBilling): Partial<Record<BillingMode, BillingProfile>> {
  const {profiles, ...profile} = value;
  return {...profiles, [profile.config.mode]: profile};
}
function validProfile(value: BillingProfile, mode: BillingMode) {
  if (!value || value.config?.mode !== mode || value.config.allowLiveWrites !== false || !new RegExp(`^(sk|rk)_${mode}_[A-Za-z0-9_]{16,250}$`).test(value.secretKey) || typeof value.webhookSecret !== 'string' || value.webhookSecret && !/^whsec_[A-Za-z0-9_]{16,250}$/.test(value.webhookSecret) || !Number.isSafeInteger(value.verifiedAt)) throw Error('Invalid stored billing configuration');
  createStripeBilling(value.config);
  if (value.policies) validatePolicies(value.policies);
  if (value.activation && (!Number.isSafeInteger(value.activation.at) || typeof value.activation.actor !== 'string')) throw Error('Invalid activation');
}
export interface BillingSettingsRow {revision: number; encrypted_payload: string; updated_at: number; updated_by: string}
export class SettingsError extends Error {
  status: number;
  constructor(status: number, message: string) {super(message);this.status=status;}
}
export const identity = (manifest: Manifest) => [manifest.installationId, manifest.site.id, manifest.adminOrigin];
const hex = (bytes: ArrayBuffer | Uint8Array) => Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
const bytes = (value: string) => Uint8Array.from(value.match(/../g) || [], value => parseInt(value, 16));
async function key(env: BillingSettingsEnv) {
  if (!/^[a-f0-9]{64}$/.test(env.BILLING_SETTINGS_KEY || '')) throw new SettingsError(503, 'Billing setup is being prepared. Please try again shortly.');
  return crypto.subtle.importKey('raw', bytes(env.BILLING_SETTINGS_KEY!), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const additionalData = (manifest: Manifest) => new TextEncoder().encode(JSON.stringify(['vitris-billing-settings-v1', ...identity(manifest)]));
export async function encryptSettings(value: StoredBilling, env: BillingSettingsEnv, manifest: Manifest) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: additionalData(manifest)}, await key(env), new TextEncoder().encode(JSON.stringify(value)));
  return 'v1.' + hex(iv) + '.' + hex(encrypted);
}
export async function readSettings(env: BillingSettingsEnv, manifest: Manifest): Promise<{row: BillingSettingsRow; value: StoredBilling} | null> {
  const row = await env.DB.prepare('SELECT revision,encrypted_payload,updated_at,updated_by FROM billing_installation_settings WHERE installation_id=? AND site_id=? AND admin_origin=?').bind(...identity(manifest)).first<BillingSettingsRow>();
  if (!row) return null;
  const [version, iv, ciphertext] = row.encrypted_payload.split('.');
  if (version !== 'v1' || !/^[a-f0-9]{24}$/.test(iv || '') || !/^[a-f0-9]+$/.test(ciphertext || '') || ciphertext.length % 2) throw new SettingsError(503, 'Saved billing settings could not be opened. Contact your administrator.');
  try {
    const decrypted = await crypto.subtle.decrypt({name: 'AES-GCM', iv: bytes(iv), additionalData: additionalData(manifest)}, await key(env), bytes(ciphertext));
    const value = JSON.parse(new TextDecoder().decode(decrypted)) as StoredBilling;
    if (!value.config || !['test', 'live'].includes(value.config.mode)) throw Error('Invalid stored billing configuration');
    validProfile(value, value.config.mode);
    if (value.profiles) {
      if (typeof value.profiles !== 'object' || Array.isArray(value.profiles) || Object.keys(value.profiles).some(mode => !['test', 'live'].includes(mode))) throw Error('Invalid stored billing profiles');
      for (const [mode, profile] of Object.entries(value.profiles)) validProfile(profile, mode as BillingMode);
    }
    return {row, value};
  } catch {throw new SettingsError(503, 'Saved billing settings could not be opened. Contact your administrator.');}
}
export async function saveSettings(value: StoredBilling, revision: number, actor: string, env: BillingSettingsEnv, manifest: Manifest) {
  const encrypted = await encryptSettings(value, env, manifest), timestamp = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`INSERT INTO billing_installation_settings(installation_id,site_id,admin_origin,revision,encrypted_payload,updated_at,updated_by) VALUES(?,?,?,1,?,?,?)
    ON CONFLICT(installation_id,site_id,admin_origin) DO UPDATE SET revision=revision+1,encrypted_payload=excluded.encrypted_payload,updated_at=excluded.updated_at,updated_by=excluded.updated_by WHERE revision=? RETURNING revision`)
    .bind(...identity(manifest), encrypted, timestamp, actor, revision).first<{revision: number}>();
  if (!row) throw new SettingsError(409, 'Billing settings changed in another session. Reload before saving.');
  return row.revision;
}
