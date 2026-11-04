import type {AnalyticsRow, AnalyticsResponse} from './index.ts';

export const clientPortfolioPermissions = ['clients:read', 'client-changes:request', 'client-releases:publish'] as const;
export type PortfolioStatus = 'requested' | 'in_progress' | 'preview_ready' | 'queued' | 'published' | 'failed' | 'canceled';
export interface PortfolioClient {id: string; name: string; contact: string; sector: string}
export interface PortfolioWebsite {
  id: string; clientId: string; name: string; origin: string; initials: string; color: string;
  connection: 'healthy' | 'unavailable' | 'not_configured'; lastSuccess: string | null;
  rows: AnalyticsRow[]; previousRows: AnalyticsRow[];
  source?: 'synthetic' | 'connected' | 'not-connected'; message?: string;
  windows?: Partial<Record<'14' | '30', AnalyticsResponse>>;
  /** Verified collector activation, independent of padded/reporting-window rows. */
  trackingStartedAt?: string;
}
export interface PortfolioChange {
  id: string; websiteId: string; title: string; request: string; status: PortfolioStatus;
  candidate: string | null; createdAt: string; updatedAt: string; idempotencyKey: string;
  history: {label: string; at: string}[];
  checks: {label: string; result: 'simulated' | 'failed'}[];
  receipt: {id: string; candidate: string; publishedAt: string; simulated: true} | null;
}
export interface PortfolioState {
  clients: PortfolioClient[]; websites: PortfolioWebsite[]; changes: PortfolioChange[]; runnerOnline: boolean;
}
export interface PortfolioResponse extends PortfolioState {revision: number; simulated: true; analyticsMode?: 'live'}
export type PortfolioAction = 'start' | 'prepare' | 'fail' | 'retry' | 'cancel' | 'queue' | 'publish';

export function isTrackingTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
