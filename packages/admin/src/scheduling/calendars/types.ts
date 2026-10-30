import type {CalendarProvider, CalendarConnectionHealth} from '../../../../contracts/src/scheduling.ts';

export interface CalendarEnv {
  DB: D1Database; MODE?: string; CALENDAR_SYNC_ENABLED?: string;
  CALENDAR_GOOGLE_CLIENT_ID?: string; CALENDAR_GOOGLE_CLIENT_SECRET?: string;
  CALENDAR_MICROSOFT_CLIENT_ID?: string; CALENDAR_MICROSOFT_CLIENT_SECRET?: string; CALENDAR_MICROSOFT_TENANT?: string;
  CALENDAR_TOKEN_KEYS?: string;
  /** Trusted server-side transport for isolated acceptance; never configured by browser input. */
  CALENDAR_HTTP?: Pick<Fetcher, 'fetch'>;
  CALENDAR_FIXTURE_MODE?: string;
}
export interface CalendarTokens {accessToken: string; refreshToken: string; expiresAt: number}
export interface CalendarSelection {blocking: string[]; destination: string | null}
export interface ConnectionRow {
  site_id: string; id: string; resource_id: string; provider: CalendarProvider; created_by: string;
  account_id: string; account_label: string; tokens_cipher: string | null; selection_json: string;
  enabled: number; health: CalendarConnectionHealth; revision: number; current_batch: string | null;
  snapshot_hash: string | null; last_synced_at: number | null; range_start: number | null; range_end: number | null;
  next_sync_at: number; error_code: string | null; lease_id: string | null; lease_until: number;
}
export interface RemoteCalendar {id: string; name: string; writable: boolean; timezone: string}
export interface RemoteEvent {
  id: string; calendarId: string; start: number; end: number; busy: boolean; cancelled: boolean;
  marker: string | null; etag: string | null; summary: string;
}
export interface ExportEvent {marker: string; summary: string; start: number; end: number; pending: boolean}
export interface EventLink {
  site_id: string; connection_id: string; appointment_id: string; calendar_id: string;
  external_id: string | null; marker: string; generation: number; exported_revision: number;
  payload_hash: string | null; remote_etag: string | null; state: 'active' | 'deleted' | 'conflict';
}
export interface CalendarAppointmentRow {
  id: string; provider_id: string; starts_at: number; ends_at: number; occupied_starts_at: number; occupied_ends_at: number;
  status: string; expires_at: number | null; customer_json: string; snapshot_json: string; revision: number;
}
export class CalendarError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) {super(message); this.status = status; this.code = code;}
}
