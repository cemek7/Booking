Monitoring Dashboard Spec — Super Admin

Goal: give Super Admin a single-screen command center to detect problems early, understand business health, and trigger playbook actions. Focus on bookings, reliability, payments, and support.

Overview & UX

Layout: three-row grid.

Row 1: Business KPIs (top-line) — single-row tiles.

Row 2: Real-time operational health — charts + small KPI tiles.

Row 3: Incidents & activity feed + drilldowns (Bookings table, Payments table, Logs).

Default time range: Last 24 hours; quick buttons: 1h, 6h, 24h, 7d, 30d.

Auto-refresh: 15s for live tiles (booking count, API error rate), 60s for charts, configurable by admin.

Permissions: Super Admin only — full drilldown + CSV export + alert management. Other roles can view but not modify alerts.

Primary Dashboard Tiles (Top-line KPIs)

Active Bookings (24h) — count of confirmed bookings in last 24h.

Booked Revenue (24h) — gross amount captured (or authorized) in last 24h.

Conversion Rate (site/session → booking) — % for selected time range.

Booking Conflict Rate — number of double-booking incidents / total bookings.

Payment Reconciliation Drift — mismatches between PSP reported vs internal records (%).

API Error Rate (5xx) — % of API responses that are 5xx.

Uptime / Service Health — % of core services up (booking API, payment webhook handler, calendar sync).

Open Support Tickets — count and average time to resolve.

Real-time Operational Widgets (Row 2)

Bookings Timeline (live stream) — line chart: bookings per minute, with anomaly markers (sudden drops or spikes).

Payment Events — live event feed showing charge.success, charge.failed, chargeback events (with filter by severity).

Webhook Queue Depth — number of unprocessed webhooks, average retry success.

Calendar Sync Failures — count of failed syncs and rate per calendar.

API Latency Heatmap — 95th percentile latency for booking API by endpoint.

Incidents & Activity (Row 3)

Active Incidents — list with severity, affected services, started-at timestamp, owner, status. Click to open incident runbook.

Audit Trail / Activity Feed — admin actions, major system changes, manual overrides.

Recent Double-bookings — table: booking_id, user_id, time, resources involved, resolution status.

Recent Payment Mismatches — table: transaction_id, internal_amount, PSP_amount, delta, status.

Drilldowns (click from any tile)

Each tile links to detailed pages:

Bookings → search/filter by date range, location, staff, status. Export CSV.

Payments → reconciliation ledger, PSP vs internal, refund log, payout dates.

Webhooks → raw payload + retry history.

Logs → errors with stack trace, request id, user context.

Alerts & Thresholds (default, editable)

Booking Conflict Rate > 0.1% (24h) → Severity: High → Notify Slack channel #ops-booka + email to on-call → runbook: investigate locking mechanism.

API Error Rate (5xx) > 1% (5m window) → Severity: High → Pager to on-call + open incident.

Webhook Retry Queue > 50 → Severity: Medium → Slack alert + email to eng.

Payment Reconciliation Drift > 0.5% (24h) → Severity: High → Finance and Ops notified; pause payouts if >1%.

Chargeback Rate > 0.5% (30d rolling) → Severity: High → Finance notified.

Unprocessed Bookings > 10 (queued, stuck) → Severity: Medium → Runbook: process dead-letter queue.

Downtime > 1 minute for booking API → Severity: Critical → On-call page + public status page update.

Open Support Tickets > SLA (avg time-to-resolution > 24h) → Severity: Medium → CS lead notified.

Alert Delivery & Escalation

Channels: Slack, Email, SMS (for critical), PagerDuty integration optional.

Escalation policy: 0–15m -> primary on-call; 15–45m -> secondary; 45–120m -> Eng Lead + Head of Ops.

Each alert includes runbook link, suggested remediation, and one-click actions: “Acknowledge”, “Create Incident”, “Mute 1h”.

Sample SQL / Queries (Postgres)

Booking conflict rate (24h):

-- bookings table: id, resource_id, start_at, end_at, status, created_at
WITH booked AS (
  SELECT resource_id, start_at, end_at
  FROM bookings
  WHERE status = 'confirmed'
    AND created_at >= now() - interval '24 hours'
)
SELECT
  COUNT(*) AS conflicts
FROM (
  SELECT b1.resource_id, b1.id AS id1, b2.id AS id2
  FROM booked b1
  JOIN booked b2
    ON b1.resource_id = b2.resource_id
   AND b1.id < b2.id
   AND b1.start_at < b2.end_at
   AND b2.start_at < b1.end_at
) t;


API error rate (5xx) — requires api_logs (status_code, path, timestamp):

SELECT
  SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END)::float / COUNT(*) AS error_rate
FROM api_logs
WHERE timestamp >= now() - interval '5 minutes';


Payment reconciliation drift (24h):

-- transactions: id, amount_cents, status, created_at, psp_id
-- psp_transactions: psp_id, amount_cents, status, received_at
SELECT
  SUM(abs(t.amount_cents - COALESCE(p.amount_cents,0))) AS total_delta_cents,
  SUM(t.amount_cents) AS total_internal_cents,
  SUM(abs(t.amount_cents - COALESCE(p.amount_cents,0)))::float / SUM(t.amount_cents) AS drift_percent
FROM transactions t
LEFT JOIN psp_transactions p ON t.psp_id = p.psp_id
WHERE t.created_at >= now() - interval '24 hours';

Implementation Notes (tech stack & suggestions)

Data sources: Postgres (bookings, transactions), Prometheus (metrics), ElasticSearch or Timescale for logs/time-series, Stripe/Paystack webhooks, Sentry for errors.

Front-end UI: Grafana for quick wins or a custom React dashboard using Chart.js / Recharts. Grafana is fast for time series, alerting, and multi-data-source.

Alerting/Incident: PagerDuty or Opsgenie for paging; Slack + email for lower severity.

Webhook handling: idempotency keys, dead-letter queue (SQS/RabbitMQ/Kafka), retry backoff.

Authentication: SSO for Super Admin; two-factor enforced.

Export & Compliance: Audit logs stored immutable for 90 days, exportable CSV/JSON.

Retention: raw API logs 30 days, aggregated metrics 13 months (or per legal needs).

Runbooks & One-Click Actions (examples)

Booking conflict detected:

One-click actions: “Mute alert 1h”, “Open incident”, “Notify partners” (template).

Runbook: identify offending bookings (query), isolate root cause (DB lock timeout? calendar sync?), if needed, flip maintenance mode and notify partners.

Payment reconciliation drift:

One-click: “Suspend payouts”, “Open finance ticket”, “Send partner comms”.

Runbook: compare PSP feed vs internal ledger, reprocess missing webhooks, manual refunds if needed.

Security & Access

Role-based access control: Super Admin -> full; Ops -> limited to incidents and metrics; Finance -> access to payment dashboards, masked PII.

Mask PII in dashboards by default (show hashed or last 4 digits only). Unmask requires justification & audit log entry.

Example Dashboard Wireframe (text)

Row1 (tiles): Active Bookings | Booked Revenue | Conversion % | Conflict Rate | Payment Drift | API Error Rate | Uptime | Open Tickets
Row2 (left): Bookings Timeline (live) — 50% width | Payment Events Stream — 25% | Webhook Queue Depth — 25%
Row3 (left): Active Incidents list (50%) | Recent Double-bookings table (25%) | Recent Payment Mismatches (25%)

Suggested Initial Alerts & Thresholds (first month; tune later)

Booking conflict rate > 0.1% (24h) — High

API 5xx rate > 1% (5m) — Critical

Webhook queue > 50 — Medium

Payment drift > 0.5% (24h) — High

Chargeback > 0.5% (30d) — High

Support avg TTR > 24h — Medium

Tune thresholds after 2–4 weeks of baseline data.