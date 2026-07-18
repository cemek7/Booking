# Booka Conversational Analytics & Briefings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Answer natural-language business questions via a controlled metrics layer (no raw LLM SQL) and send proactive morning/evening/weekly briefings over WhatsApp.

**Architecture:** A code metric registry (parameterized SQL builders + allowed dimensions/filters/aggregations + required permission). The LLM only maps a question to an approved `metric_key` + params (structured output, validated). Briefings reuse spec 1's evening delivery + tenant tz/schedule.

**Tech Stack:** Next.js 16, Supabase, TypeScript, Jest, BullMQ. Spec: `docs/superpowers/specs/2026-07-17-booka-conversational-analytics-briefings-design.md`.

## Global Constraints
- Depends on specs 1 (close report/tz), 2 (business_events), 3 (anomalies). Migrations after spec-9.
- **No unrestricted SQL** — only registry metrics; every builder is tenant-scoped and parameterized. Deterministic aggregation outside the LLM.
- Return summary + supporting rows + data period + incompleteness notes. Log every request.
- Sensitive metrics gated by `VIEW_ANALYTICS`/`VIEW_REVENUE` (§12).
- **Evening briefing stays one message** with spec 1 close report + spec 3 anomalies (consolidation §F/§L). Skip empty reports.

## File Structure
- `db/migrations/135_analytics_briefings.sql`(+rollback) — `analytics_query_log`, `briefing_schedules`, `briefing_runs`.
- `src/lib/analytics/metrics/registry.ts` — `Metric` type + `METRICS` + `runMetric(admin, tenantId, key, params)`.
- `src/lib/analytics/nlToMetric.ts` — LLM maps question → `{metricKey, dimensions, filters, period}` (validated against registry).
- `src/lib/analytics/answer.ts` — `answerQuestion(admin, tenantId, question)`.
- `src/lib/briefings/{morning,weekly}.ts` + `src/lib/briefings/job.ts`.
- `src/app/api/owner/ask/route.ts`; briefings archive dashboard.

---

## Task 1: Migration + metric registry framework
- [ ] **Step 1:** `135_analytics_briefings.sql` — `analytics_query_log` (`question`, `metric_key`, `params`, `row_count`, `latency_ms`, `actor_id`), `briefing_schedules` (`type` morning|weekly, `time`, `enabled`), `briefing_runs` (archive). RLS on all. Rollback drops them.
- [ ] **Step 2:** Define `Metric` type: `{ key, title, requiredPermission, allowedDimensions, allowedFilters, allowedAggregations, build(params): { sql, args } }`. Implement `runMetric` (validate params against the metric's allow-lists; execute the parameterized query tenant-scoped). Test that an out-of-allow-list dimension/filter is rejected.
- [ ] **Step 3:** Apply + PASS. **Commit** `feat(analytics): metric registry framework + log/schedule tables`.

---

## Task 2: Core metrics
- [ ] **Step 1:** Implement metrics: `revenue_total` (period), `revenue_by_day`, `outstanding_total`, `top_products`, `dead_stock`, `low_stock`, `top_customers`, `lapsed_customers`, `top_services`, `service_revenue_per_hour`, `staff_revenue`, `staff_discounts`. Each with a tested build+run against fixtures.
- [ ] **Step 2:** Test `revenue_total` sums recorded payments in the tenant tz window; `top_products` ranks by qty. **Commit** `feat(analytics): core metric implementations`.

---

## Task 3: NL → metric mapping
**Interfaces:** `answerQuestion(admin, tenantId, question): Promise<{ summary, rows, period, limitations }>`.
- [ ] **Step 1:** Test: "how much did we make today" maps to `revenue_total` with `period=today`; an unmappable question returns a clarification (never SQL). Mock the LLM to return a structured `{metricKey, params}`.
- [ ] **Step 2:** Implement `nlToMetric` (structured output validated against `METRICS`; unknown key → clarification) + `answerQuestion` (permission check, run, format summary + rows + period, log to `analytics_query_log`).
- [ ] **Step 3:** API `POST /api/owner/ask` + a WhatsApp owner-command `owner_analytics_query` (reuse spec 2 dispatcher). PASS; **Commit** `feat(analytics): NL-to-metric mapping + ask API`.

---

## Task 4: Briefings
- [ ] **Step 1:** Morning briefing (`morning.ts`): today's appointments, pending orders, expected deliveries, low-stock, outstanding balances, unconfirmed bookings, high-priority anomalies. Test the assembled content + empty-skip.
- [ ] **Step 2:** Evening: **extend spec 1's close-report payload** (already carries anomalies from spec 3 §F) — do not send a separate evening message.
- [ ] **Step 3:** Weekly (`weekly.ts`): vs prior week, margins where cost exists, best products/services, top customers, staff performance, cancellation/no-show rate, inventory losses, dead stock, outstanding, recommended actions (spec 11). Test content.
- [ ] **Step 4:** `job.ts` — per-tenant scheduler (tz, opt-in via `briefing_schedules`, empty-skip), WhatsApp send via provider abstraction, archive to `briefing_runs`. **Commit** `feat(analytics): morning/weekly briefings + scheduler`.

---

## Self-Review
**Spec coverage:** registry+log+schedule → Task 1; metrics → Task 2; NL mapping → Task 3; briefings → Task 4. **Placeholder scan:** clean. **Type consistency:** `Metric`/`METRICS`/`runMetric`/`answerQuestion` consistent. **Cross-spec:** §F/§L (single evening message via spec 1 payload), §12 permission gating honored; weekly "recommended actions" consumes spec 11.
