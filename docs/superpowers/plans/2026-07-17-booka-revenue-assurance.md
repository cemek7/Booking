# Booka Revenue Assurance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Grow spec 1's read-only `reconciliation_items` into a stateful `business_anomalies` case-management system: a deterministic rule registry (batch + real-time), dedup, dashboard review workflow, and WhatsApp digest + debounced high/critical alerts.

**Architecture:** `business_anomalies` is the canonical stateful record. A rule registry produces anomalies from two triggers — the nightly reconciliation batch and an action-indexed `business_events` subscriber. Upserts are dedup'd by a partial-unique key. Workflow transitions reuse `business_events`.

**Tech Stack:** Next.js 16, Supabase, TypeScript, Jest, BullMQ. Spec: `docs/superpowers/specs/2026-07-16-booka-revenue-assurance-design.md` (corrections applied 2026-07-17).

## Global Constraints

- Depends on spec 1 (`reconciliation_runs`/`reconciliation_items`/`business_events`, `computeDailyClose`) and spec 2 (`inventory_movements` for stock rules; `ai_action_log`). Build after both.
- **Deterministic detection, no LLM** (LLM only composes a grounded explanation).
- **Dedup:** partial-unique `(tenant_id, dedup_key) WHERE status IN ('open','investigating')`. Recompute/re-detection bumps `last_seen_at`, never duplicates. Resolved-then-recurs → NEW anomaly linked via `detail.previous_anomaly_id`.
- **`payment_without_matching_sale` guarded to post-rollout transactions** (legacy NULL `subject_*` must not false-flag — consolidation, spec 3 §5.1).
- **`stock_leaving_without_record` excludes `count_adjustment`** (consolidation §B).
- **Deposits exist** → `deposits_not_applied` is a shipped rule (consolidation §O).
- Real-time subscriber indexes rules by `business_events.action` (perf). Alerts debounced per tenant.
- `business_anomalies` retained with financial-audit history (no premature delete). Money in cents. Migrations after spec-2 numbers.

## File Structure

- `db/migrations/128_business_anomalies.sql`(+rollback) — table + partial-unique index; `reconciliation_items.anomaly_id`.
- `src/lib/anomalies/rules/registry.ts` — `AnomalyRule` type + `RULES` list + `runRules(admin, tenantId, trigger, ctx)`.
- `src/lib/anomalies/rules/{service,retail,inventory}.ts` — rule implementations.
- `src/lib/anomalies/upsertAnomaly.ts` — dedup'd upsert + `business_events`.
- `src/lib/anomalies/realtimeSubscriber.ts` — action-indexed `business_events` consumer.
- `src/lib/anomalies/notify.ts` — daily digest + debounced high/critical alerts.
- `src/app/api/owner/anomalies/route.ts`, `.../[id]/route.ts` (GET + PATCH).
- `src/app/(dashboard)/owner/anomalies/page.tsx`.
- Modify: `src/lib/reconciliation/reconciliationService.ts` (invoke batch rules; link items).

---

## Task 1: Migration — business_anomalies + item link

- [ ] **Step 1:** `128_business_anomalies.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.business_anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rule_key text NOT NULL,
  domain text NOT NULL CHECK (domain IN ('service','retail','inventory')),
  severity text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','dismissed','false_positive')),
  entity_type text, entity_id uuid,
  expected_value_cents bigint, actual_value_cents bigint, difference_cents bigint,
  detection_source text NOT NULL CHECK (detection_source IN ('reconciliation','realtime_event')),
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  dedup_key text NOT NULL,
  assigned_to uuid, assigned_at timestamptz,
  resolution_note text, resolved_by uuid, resolved_at timestamptz,
  run_id uuid REFERENCES public.reconciliation_runs(id) ON DELETE SET NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_anomalies_open ON public.business_anomalies (tenant_id, dedup_key) WHERE status IN ('open','investigating');
CREATE INDEX IF NOT EXISTS idx_business_anomalies_status ON public.business_anomalies (tenant_id, status, severity);
ALTER TABLE public.reconciliation_items ADD COLUMN IF NOT EXISTS anomaly_id uuid REFERENCES public.business_anomalies(id) ON DELETE SET NULL;
ALTER TABLE public.business_anomalies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_anomalies_service_role ON public.business_anomalies;
CREATE POLICY business_anomalies_service_role ON public.business_anomalies AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
```
Rollback: drop `reconciliation_items.anomaly_id`, drop `business_anomalies`.

- [ ] **Step 2:** Apply + verify partial-unique index exists. **Commit** `feat(assurance): business_anomalies table + item link`.

---

## Task 2: Dedup'd upsert

**Interfaces:** `async function upsertAnomaly(admin, candidate: AnomalyCandidate): Promise<string>` — on dedup hit (open/investigating) bump `last_seen_at`; if a resolved/dismissed row shares the dedup_key, create new with `detail.previous_anomaly_id`; emit `anomaly.detected` on create.

- [ ] **Step 1:** Test: two upserts with the same `dedup_key` → one open row, second bumps `last_seen_at` (assert single row). Third after resolving the first → new row with `previous_anomaly_id` set.
- [ ] **Step 2:** Implement using the partial-unique index (insert … on conflict do update set last_seen_at) plus a resolved-recurrence check. Emit `business_events` `anomaly.detected` on insert (add to `BUSINESS_EVENT_ACTIONS`).
- [ ] **Step 3:** PASS; **Commit** `feat(assurance): dedup'd anomaly upsert`.

---

## Task 3: Rule registry + core rules

**Interfaces:**
```ts
export interface AnomalyRule { key: string; domain: 'service'|'retail'|'inventory'; severity: Severity; mode: 'batch'|'realtime'|'both'; triggerActions?: string[]; detect(admin, tenantId, window, ctx): Promise<AnomalyCandidate[]>; dedupKey(c): string; }
export const RULES: AnomalyRule[];
export async function runRules(admin, tenantId, trigger: 'batch'|'realtime', ctx): Promise<void>;
```

- [ ] **Step 1:** Test `completed_service_unpaid`: given a completed reservation with no successful transaction, `detect` returns one candidate; with a payment, none. (Fixture the admin queries.)
- [ ] **Step 2:** Implement registry + these core rules (mode both/batch): `completed_service_unpaid`, `delivered_order_unpaid`, `refund_without_reason`, `discount_without_reason`. `runRules('batch')` iterates batch/both rules → `upsertAnomaly`.
- [ ] **Step 3:** Test `refund_without_reason` (transaction refund_amount set, refund_reason null).
- [ ] **Step 4:** PASS; **Commit** `feat(assurance): rule registry + core service/retail rules`.

---

## Task 4: Remaining rules + guards

- [ ] **Step 1:** Implement service rules: `payment_below_service_price`, `service_completed_without_staff`, `appointment_cancelled_after_completion` (reads `business_events` cancel time vs `end_at`), `deposits_not_applied` (completed service whose only linked payment is `type='deposit'`).
- [ ] **Step 2:** Retail rules: `sale_without_payment`, `payment_without_matching_sale` (**WHERE transaction.created_at >= rollout cutoff AND subject_id IS NULL/dangling** — test asserts legacy NULL-subject rows are NOT flagged), `cancelled_order_not_restocked`, `refund_without_stock_adjustment`, `excessive_manual_discount` (> tenant threshold default 15%).
- [ ] **Step 3:** Inventory rule `stock_leaving_without_record` — negative `adjustment`/drift **excluding `count_adjustment`** (test asserts a `count_adjustment` movement is not flagged).
- [ ] **Step 4:** PASS; **Commit** `feat(assurance): remaining rules with legacy + count_adjustment guards`.

---

## Task 5: Batch wiring + real-time subscriber

- [ ] **Step 1:** In `reconciliationService.computeDailyClose`, after persisting items, call `runRules(admin, tenantId, 'batch', {window, runId})`; link each produced anomaly back onto the matching `reconciliation_items.anomaly_id`. Test: a batch run creates anomalies and links items.
- [ ] **Step 2:** Implement `realtimeSubscriber.ts` — subscribe to `business_events` inserts (or a queue), index `realtime/both` rules by `triggerActions`, run only matching rules on the event. Test: an event with action `order.refunded` runs only the refund rule.
- [ ] **Step 3:** Register the subscriber where `business_events` are emitted (or poll the table). PASS; **Commit** `feat(assurance): batch wiring + action-indexed real-time subscriber`.

---

## Task 6: Anomaly APIs + review workflow

**Interfaces:** `GET /api/owner/anomalies` (filters status/severity/domain/date/assignee), `GET/PATCH /api/owner/anomalies/[id]` (assign / status transition / resolution note — note required on resolve/dismiss/false_positive). Capability `approve_anomalies` (stubbed until §12; use `roles:['owner','manager']` now).

- [ ] **Step 1:** Write PATCH test: resolving without a note → 400; with a note → status `resolved`, `resolved_by/at` set, emits `anomaly.resolved`.
- [ ] **Step 2:** Implement routes via `createHttpHandler` (pattern from spec 1 Task 5). Each transition emits a `business_events` row.
- [ ] **Step 3:** PASS + typecheck; **Commit** `feat(assurance): anomaly review APIs`.

---

## Task 7: Dashboard + notifications

- [ ] **Step 1:** Dashboard page `owner/anomalies` — list + filters + detail drawer + assign/resolve/dismiss (reuse spec 1's close-report dashboard shell). Drill-through to underlying entity.
- [ ] **Step 2:** `notify.ts`: (a) fold an anomaly summary into spec 1's close-report payload (modify `formatCloseReportText` to append "N open items, ₦X at risk" — consolidation §F, one message); (b) immediate high/critical alert on real-time detection with a per-tenant debounce (max 1 / N minutes; rest → daily digest). Test the debounce.
- [ ] **Step 3:** PASS; **Commit** `feat(assurance): anomaly dashboard + digest/debounced alerts`.

---

## Self-Review
**Spec coverage:** table+dedup → Tasks 1–2; rules (incl. deposits, guards) → Tasks 3–4; batch+realtime → Task 5; workflow APIs → Task 6; dashboard+notify → Task 7. **Placeholder scan:** clean; `approve_anomalies` stub explicitly bridged to §12. **Type consistency:** `AnomalyRule`/`RULES`/`runRules`/`upsertAnomaly`/`AnomalyCandidate` consistent. **Cross-spec:** §B (exclude count_adjustment), §F (single evening message), §O (deposits) honored; touch-point on spec 1's `formatCloseReportText` noted in Task 7.
