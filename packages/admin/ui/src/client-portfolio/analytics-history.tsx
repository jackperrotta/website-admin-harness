import React from 'react';
import type {PortfolioWebsite} from '../../../../contracts/src/index.ts';
import {trackingStartLabel, firstActivityDay, activityDateLabel, historyWindowNotice} from './history.ts';

export function TrackingStart({site}: {site: PortfolioWebsite}) {
  const label = trackingStartLabel(site);
  return <span className="cp-tracking-start">Tracking started <strong>{label}</strong>{label !== 'Not verified' && <span> · Eastern</span>}</span>;
}

export function AnalyticsHistory({site, days}: {site: PortfolioWebsite; days: number}) {
  const first = firstActivityDay(site);
  return <section className="cp-analytics-history" aria-label="Analytics history"><div><p className="cp-kicker">ANALYTICS HISTORY</p><TrackingStart site={site}/><p>{site.connection !== 'healthy' ? 'Recorded activity is currently unavailable.' : first ? <>First activity in retrieved records: <strong>{activityDateLabel(first)} · UTC</strong></> : 'No production activity appears in the retrieved records yet.'}</p></div><div><p>{historyWindowNotice(site, days)}</p><small>Start dates use Eastern time. Daily analytics use UTC. The first activity shown may be limited by the records returned for this range.</small></div></section>;
}
