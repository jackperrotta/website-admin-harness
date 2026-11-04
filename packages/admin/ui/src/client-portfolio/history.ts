import {isTrackingTimestamp, type PortfolioWebsite} from '../../../../contracts/src/index.ts';

export function trackingStartLabel(site: PortfolioWebsite): string {
  if (!isTrackingTimestamp(site.trackingStartedAt)) return 'Not verified';
  return new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric'}).format(new Date(site.trackingStartedAt));
}

/** Padded empty days are reporting structure, not evidence that traffic was collected. */
export function firstActivityDay(site: PortfolioWebsite): string | null {
  if (site.connection !== 'healthy') return null;
  const rows = [...site.rows, ...site.previousRows, ...Object.values(site.windows || {}).flatMap(w => [...w.rows, ...(w.previousRows || [])])];
  return rows.filter(r => r.views > 0 || r.visitors > 0 || r.enquiries > 0 || (r.sessions || 0) > 0).map(r => r.day).sort()[0] || null;
}

export function historyWindowNotice(site: PortfolioWebsite, days: number, now = new Date()): string {
  if (site.connection !== 'healthy') return 'Record history is unavailable while the analytics connection is offline.';
  if (!isTrackingTimestamp(site.trackingStartedAt)) return 'The tracking start has not been verified. Daily rows do not establish when collection began.';
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1);
  if (Date.parse(site.trackingStartedAt) > start) return `The selected ${days}-day range includes time before tracking started. Earlier traffic was not collected; the activation day is partial.`;
  return 'The selected range begins after tracking was enabled. Days without recorded activity may show zero.';
}

export function activityDateLabel(day: string): string {
  return new Intl.DateTimeFormat('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'}).format(new Date(`${day}T12:00:00Z`));
}
