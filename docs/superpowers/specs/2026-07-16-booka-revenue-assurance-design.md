# Booka Revenue Assurance — Design

**Date:** 2026-07-16
**Status:** Approved (brainstorm) — ready for implementation planning
**Scope:** Third sub-project of the "Booka Operational Intelligence" backlog (§3, Phase 2).
Depends on the Business Ledger & Daily Close spec (2026-07-15) for `reconciliation_runs`,
`reconciliation_items`, `business_events`; and the Owner Commerce Commands spec (2026-07-16)
for `inventory_movements` and the capability map (several rules are stock-related).

---

## 1. Objective

Turn spec 1's read-only `reconciliation_items` precursor into a full anomaly
**case-management** system: deterministic detection rules (batch + real-time), a stateful
`business_anomalies` record with a review workflow, dashboard resolution, and WhatsApp
notification of what is leaking money.

## 2. Current-state findings (grounding)

- Existing alerting (`src/lib/monitoring/alerting.ts`, `monitoring/telegramAlert.ts`,
  `status/alerting.ts`, `billing/spendCaps/spendAlerts.ts`) is **platform/operator-facing**
  (Telegram, uptime, spend caps) — NOT merchant revenue anomalies. Phase 2's workflow is
  net-new; owner delivery reuses spec 1's provider-agnostic (Meta-default) WhatsApp path.
- `src/lib/integrations/notification-aggregator.ts` exists for consolidation but may be
  operator-oriented; fit-for-owner-WhatsApp is reconciled at implementation (see §5).
- Spec 1 tables (`reconciliation_runs`/`reconciliation_items`/`business_events`) and spec 2
  tables (`inventory_movements`, `ai_action_log`) are **not implemented yet** — Phase 2
  sequences after them.

## 3. Architecture decisions

### 3.1 Detection (stateless) vs case-management (stateful) split
`business_anomalies` is the canonical stateful record. Detection rules are stateless
producers with two triggers (batch + real-time) feeding the one workflow.

### 3.2 `reconciliation_items` gains one nullable `anomaly_id` FK
Minimal change to the committed spec 1. The reconciliation engine now **upserts a
`business_anomalies` row (dedup'd) and links the item to it.** The close report keeps its
immutable per-run snapshot; drilling into an item follows the FK to the anomaly's *live*
status. No double-model; spec 1 stays coherent. `reconciliation_items` deletion (on
recompute) does not touch anomalies (FK is item→anomaly, anomaly `ON DELETE RESTRICT`).

### 3.3 Idempotent detection — no double-counting
Anomalies are keyed by `dedup_key` (tenant + rule_key + entity granularity). A **partial
unique index** on `dedup_key WHERE status IN ('open','investigating')` guarantees one live
anomaly per condition. Recompute of a day (spec 1's delete+re-insert of items) or a batch
rule re-seeing a real-time-raised anomaly only updates `last_seen_at` — never creates a
duplicate. A resolved/dismissed condition that recurs creates a **new** anomaly linked to
the prior via `detail.previous_anomaly_id` (no silent reopen).

### 3.4 Workflow transitions reuse `business_events`
`anomaly.detected`, `anomaly.assigned`, `anomaly.resolved`, `anomaly.dismissed` emit to
spec 1's append-only timeline. No separate audit table.

### 3.5 Deterministic detection, no LLM
Rules are pure code. The LLM only optionally composes a grounded human-readable explanation
for the owner (same pattern as spec 1). No LLM writes anomalies or decides severity.

## 4. Data model

### 4.1 `business_anomalies` (new, stateful)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid not null | RLS-scoped |
| rule_key | text not null | which rule detected it |
| domain | text | service \| retail \| inventory |
| severity | text | low \| medium \| high \| critical |
| status | text not null default 'open' | open \| investigating \| resolved \| dismissed \| false_positive |
| entity_type | text null | reservation \| retail_order \| transaction \| product |
| entity_id | uuid null | |
| expected_value_cents | bigint null | nullable — not all anomalies are monetary |
| actual_value_cents | bigint null | |
| difference_cents | bigint null | |
| detection_source | text | reconciliation \| realtime_event |
| first_detected_at | timestamptz not null | |
| last_seen_at | timestamptz not null | bumped on re-detection |
| dedup_key | text not null | tenant + rule_key + entity granularity |
| assigned_to | uuid null → tenant_users | |
| assigned_at | timestamptz null | |
| resolution_note | text null | required on resolve/dismiss/false_positive |
| resolved_by | uuid null | |
| resolved_at | timestamptz null | |
| run_id | uuid null → reconciliation_runs | run that surfaced it (batch) |
| detail | jsonb default '{}' | drill-through refs, previous_anomaly_id, rule context |
| created_at / updated_at | timestamptz | |

- **Partial unique index**: `(tenant_id, dedup_key) WHERE status IN ('open','investigating')`.
- Indexes: `(tenant_id, status, severity)`, `(tenant_id, domain, first_detected_at)`,
  `(tenant_id, assigned_to)`.
- RLS tenant-scoped. Retained with financial-audit history (no premature delete — §6 of backlog).
- **No `occurrence_count`** — `first_detected_at` + `last_seen_at` carry the recurring/
  still-open signal without ambiguous increment semantics under entity-granular dedup.

### 4.2 `reconciliation_items` (spec 1) — additive
`+ anomaly_id uuid null → business_anomalies` (`ON DELETE SET NULL`).

## 5. Anomaly rules engine

A **rule registry** — each rule:
```ts
interface AnomalyRule {
  key: string;
  domain: 'service' | 'retail' | 'inventory';
  severity: Severity;                 // default; scaled by monetary thresholds
  mode: 'batch' | 'realtime' | 'both';
  triggerActions?: string[];          // for realtime: which business_events.action fire it
  detect(ctx): Promise<Candidate[]>;  // pure; may read current-state tables AND business_events
  dedupKey(c: Candidate): string;
  buildDetail(c: Candidate): object;
}
```
- **Batch**: the reconciliation job runs `batch|both` rules over the day window → upsert anomalies (link `reconciliation_items`).
- **Real-time**: a `business_events` eventBus subscriber runs only rules whose `triggerActions` include the event's `action` (indexed by action for performance) → upsert immediately. Cheap rules only (refund-without-reason, discount-over-threshold).

### 5.1 Rules shipped (data-supported by specs 1+2)
**Service:** `completed_service_unpaid`, `payment_below_service_price`,
`service_completed_without_staff`, `refund_without_reason`,
`discount_without_reason`, `discount_over_threshold`,
`appointment_cancelled_after_completion` (reads `business_events` cancel time vs `end_at`).
**Retail:** `sale_without_payment`, `delivered_order_unpaid`,
`payment_without_matching_sale` (**guarded to post-rollout transactions** so legacy
NULL-`subject` payments are not false-flagged), `cancelled_order_not_restocked`
(no refund_restock/return `inventory_movements`), `refund_without_stock_adjustment`,
`excessive_manual_discount`.
**Inventory:** `stock_leaving_without_record` (negative `adjustment` movement with no reason,
or projection drift vs `Σ quantity_change`). **Must exclude `count_adjustment` movements**
(explained by an approved stock count — see consolidation §B). *(Existing `inventory_movements`
uses `quantity_change` + `movement_type='adjustment'`, not `quantity_delta` — see spec 2 §5.1 correction.)*
**Deposits:** `deposits_not_applied` — a completed service whose only linked payment is a
`type='deposit'` transaction and no subsequent balance payment (deposits exist, §5.2 correction).

Severity is per-rule default, scaled by tenant-configurable monetary thresholds (defaults
provided). Discount thresholds are a **tenant-config default here (e.g. 15%), superseded by
§11's per-role approval thresholds** when that spec lands (documented seam).

### 5.2 Deferred rules (data not yet modeled)
`outstanding_balance_aging` (no `customer_balances` ledger — backlog §13, later),
`staff_created_appointment_unpaid` (no reservation-creator field). Listed, not silently dropped.
**CORRECTION (2026-07-17 review): `deposits_not_applied` is NOT deferred** — deposits exist
(`transactions.type='deposit'`), so it ships as a service rule (§5.1).

## 6. Review workflow & delivery

- **APIs** (owner/manager; capability `approve_anomalies` — extends spec 2's capability map):
  `GET /api/owner/anomalies` (filters: status, severity, domain, date, assignee, entity),
  `GET /:id`, `PATCH /:id` (assign / status transition / resolution note — note required on
  resolve/dismiss/false_positive). Each transition emits a `business_event`.
- **Dashboard**: anomalies list + filters, detail drawer, assign, resolve/dismiss with note,
  drill-through to the underlying reservation/order/transaction/movement. **Reuses spec 1's
  close-report dashboard shell/components** for consistency and less work.
- **WhatsApp**:
  (a) **daily anomaly digest** folded into spec 1's close-report payload
      ("N open items, ₦X at risk") — Phase 2 augments that payload (touch-point on spec 1);
  (b) **immediate high/critical alerts** when a real-time rule fires — **dedicated
      per-tenant debounce/rate-limit** (max 1 alert per tenant per N minutes; rest batched
      into the daily digest), reconciled with `notification-aggregator` at implementation.
  Provider-agnostic Meta send (spec 1).

## 7. Safety & reliability
Deterministic detection · partial-unique dedup prevents alert storms and double-raise on
eventBus redelivery · real-time alerts rate-limited/debounced · capability-gated resolution
· every transition audited via `business_events` · tenant isolation on all reads/writes ·
recompute is idempotent (no duplicate anomalies).

## 8. Testing
- Each rule: true-positive detection + **no false-positive on clean data**.
- `payment_without_matching_sale` does **not** flag legacy NULL-subject transactions.
- Dedup: same condition batch+realtime → one anomaly (`last_seen_at` bumped, no dup).
- Recompute of a day → no duplicate anomalies.
- Resolved-then-recurs → new anomaly linked via `detail.previous_anomaly_id`.
- Real-time subscriber fires only for matching `triggerActions`.
- Batch raises in reconciliation; `reconciliation_item.anomaly_id` linkage correct.
- Severity monetary-threshold scaling.
- `approve_anomalies` capability gating on PATCH.
- Notification debounce (N alerts collapse to 1 + digest).
- `appointment_cancelled_after_completion` reads `business_events` correctly.
- Tenant isolation (RLS) on `business_anomalies`.
- Test types: unit (rules, severity, dedup key), integration (batch + realtime pipelines,
  workflow transitions), DB constraint (partial-unique, RLS), permission (gating).

## 9. Migrations & rollback
- Forward: `business_anomalies` (+ partial-unique index, RLS, grants);
  `reconciliation_items.anomaly_id` (additive). Each with paired `_rollback.sql`.
- Additive/nullable → safe on live data. No historical backfill of anomalies.

## 10. Implementation order (for the plan)
1. Migration: `business_anomalies` + `reconciliation_items.anomaly_id` (+ rollback, RLS).
2. Rule-registry framework + upsert-with-dedup + `business_events` emission.
3. Wire batch trigger into spec 1's reconciliation job; link `reconciliation_items`.
4. Ship a **core rule set first** (`completed_service_unpaid`, `delivered_order_unpaid`,
   `refund_without_reason`, `discount_without_reason`) — reviewable slice.
5. Real-time eventBus subscriber (action-indexed) + the cheap real-time rules.
6. Remaining service/retail/inventory rules incrementally.
7. Anomaly APIs + capability `approve_anomalies`.
8. Dashboard (reusing spec 1 shell).
9. WhatsApp: digest augmentation of close report + debounced high/critical alerts.
10. Docs update.

Ship as small reviewable units; do not land all steps in one change set.
