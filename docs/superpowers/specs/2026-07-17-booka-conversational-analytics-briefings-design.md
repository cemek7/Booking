# Booka Conversational Analytics & Briefings — Design

**Date:** 2026-07-17
**Status:** Approved (brainstorm) — ready for implementation planning
**Scope:** Tenth sub-project (§7 + §8, Phase 5). NL business questions + morning/evening/weekly
briefings. Depends on specs 1 (close report/tz), 3 (anomalies), 2 (business_events).

**Scope decisions (self-made):** a **controlled metrics layer** (no raw LLM SQL); the LLM only
maps a question to an approved metric+dimensions+filters; briefings reuse spec 1's evening
delivery + tenant tz/schedule.

---

## 1. Objective
Let owners ask natural-language questions and receive proactive daily/weekly briefings —
without ever letting the model generate/execute unrestricted SQL.

## 2. Current-state findings
`analyticsService.ts` + `analytics/` (events, track, server) exist. Spec 1 delivers the
**evening** close report with tenant `timezone` + `close_report_time`; spec 3 folds anomalies
into it. No approved-metrics registry or briefing scheduler for morning/weekly.

## 3. Controlled metrics layer
- **Metric registry** (code): each metric = `{ key, title, sql_builder (parameterized),
  allowed_dimensions, allowed_filters, allowed_aggregations, required_permission }`. Covers
  the backlog's revenue/products/services/customers/staff/operations questions.
- **NL → metric mapping**: the LLM selects a `metric_key` + dimensions + filters + period from
  the **approved set only** (structured output, validated against the registry). Anything
  unmappable → clarification, never freeform SQL.
- Query is built deterministically from the registry entry with parameterized inputs and
  tenant scoping; returns **summary + supporting rows + the data period**, and states
  limitations when data is incomplete.
- Every request/response logged (`analytics_query_log`): question, chosen metric, params,
  row count, latency, actor.

## 4. Briefings
- **Morning**: today's appointments, pending orders, expected deliveries, low-stock,
  outstanding balances, unconfirmed bookings, high-priority anomalies (spec 3).
- **Evening**: **extends spec 1's close report** (revenue by method, completed services,
  retail sales, delivered orders, discounts, refunds, adjustments, gaps, open anomalies).
- **Weekly**: vs prior week, gross margin where cost exists, best products/services, top
  customers, staff performance, cancellation/no-show rate, inventory losses, dead stock,
  outstanding balances, recommended actions (Phase 6).
- Tenant-configurable schedule + tz + opt-in/out; **skips empty/meaningless reports**;
  WhatsApp-formatted (concise, Naira); dashboard archive; each metric links to underlying records.

## 5. Safety
No unrestricted SQL · approved metrics/dimensions/aggregations only · tenant isolation
enforced in every builder · deterministic aggregation outside the LLM · `VIEW_ANALYTICS`/
`VIEW_REVENUE` (§12) gate sensitive metrics · request logging.

## 6. Data model
`analytics_query_log`; `briefing_schedules` (tenant, type morning|weekly, time, enabled);
`briefing_runs` (archive). RLS tenant-scoped. (Evening reuses `reconciliation_runs`.)

## 7. Testing
NL→metric mapping (valid → correct metric; unmappable → clarification, never SQL) · metric
math correctness · tenant-scoping in every builder · period reporting + incompleteness notes ·
permission gating on sensitive metrics · morning/weekly content + empty-skip · tz boundary ·
WhatsApp formatting · request logging · isolation.

## 8. Boundaries
Recommendations = Phase 6 (weekly "recommended actions" surfaces them). Evening briefing must
remain a single message with spec 1/3 (consolidation §F).

## 9. Implementation order
1. Metric registry framework + first metrics (revenue/products/services).
2. NL→metric mapper (structured output, registry-validated) + `analytics_query_log`.
3. Query API + WhatsApp formatter.
4. Morning briefing + scheduler (tz, opt-in, empty-skip).
5. Weekly briefing.
6. Dashboard archive; remaining metrics; docs.
