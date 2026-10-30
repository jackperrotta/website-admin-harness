import {CalendarError, type CalendarEnv} from './types.ts';

export const base64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
function decode(value: string): Uint8Array<ArrayBuffer> {return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));}
export async function digest(value: string): Promise<string> {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');}
export function random(): string {return base64url(crypto.getRandomValues(new Uint8Array(32)));}
interface KeyRing {current: string; keys: Record<string, string>}
function ring(env: Pick<CalendarEnv, 'CALENDAR_TOKEN_KEYS'>): KeyRing {
  try {
    const value = JSON.parse(env.CALENDAR_TOKEN_KEYS ?? '') as KeyRing;
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(value.current) || !value.keys || !value.keys[value.current]) throw new Error();
    for (const [id, key] of Object.entries(value.keys)) if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id) || typeof key !== 'string' || decode(key).length !== 32) throw new Error();
    return value;
  } catch {throw new CalendarError(503, 'calendar_setup_required', 'Configure a valid calendar token encryption key ring before connecting accounts.');}
}
export function encryptionReady(env: Pick<CalendarEnv, 'CALENDAR_TOKEN_KEYS'>): boolean {try {ring(env); return true;} catch {return false;}}
export async function encrypt(env: Pick<CalendarEnv, 'CALENDAR_TOKEN_KEYS'>, context: string, value: unknown): Promise<string> {
  const keys = ring(env), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', decode(keys.keys[keys.current]), 'AES-GCM', false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`${context}|${keys.current}`)}, key, new TextEncoder().encode(JSON.stringify(value)));
  return JSON.stringify({v: 1, key: keys.current, iv: base64url(iv), data: base64url(new Uint8Array(encrypted))});
}
export async function decrypt<T>(env: Pick<CalendarEnv, 'CALENDAR_TOKEN_KEYS'>, context: string, cipher: string): Promise<T> {
  try {
    const keys = ring(env), item = JSON.parse(cipher) as {v: number; key: string; iv: string; data: string};
    if (item.v !== 1 || !keys.keys[item.key]) throw new Error();
    const key = await crypto.subtle.importKey('raw', decode(keys.keys[item.key]), 'AES-GCM', false, ['decrypt']);
    const clear = await crypto.subtle.decrypt({name: 'AES-GCM', iv: decode(item.iv), additionalData: new TextEncoder().encode(`${context}|${item.key}`)}, key, decode(item.data));
    return JSON.parse(new TextDecoder().decode(clear)) as T;
  } catch {throw new CalendarError(503, 'calendar_credentials_unavailable', 'Calendar credentials cannot be read. Restore the configured encryption key or reconnect this account.');}
}
