# Analytics tracking start dates

Show verified tracking activation dates in the optional Clients portfolio, website analytics view and connection details. Keep owner-specific dates in private connection configuration; expose only the validated timestamp. Distinguish activation from the first nonzero activity in retrieved records and the requested reporting window. Zero-filled daily rows must never establish a tracking start or first recorded activity. Unknown dates and unavailable connections remain explicit.

Evidence: Perrotta Built's production publication receipt and live-HTML verification establish October 27, 2026; its tenant-scoped raw events and nonzero daily rollups also begin October 27. Jack's analytics-only production deployment establishes November 3, 2026 in America/New_York (November 4 UTC). Display activation dates in Eastern time and label daily record dates UTC. No production data, backend schema, credentials, grants or collection settings change.

Validate timezone boundaries, missing/invalid dates, padded zero days, empty and failed connections, date-range changes, and desktop/mobile presentation. Run npm run check, retain the requested local preview, and preserve unrelated account-lifecycle work.

Completed: npm run check passed all 147 tests, including external packed installation. Live browser acceptance verified both private website activation dates, stable labels across 14/30-day ranges, partial-history notices, first retrieved activity, and no desktop/mobile overflow. Screenshots and the browser receipt are in ignored artifacts/vitris-prototype/tracking-dates-*. The authenticated local preview remains available on port 4393.
