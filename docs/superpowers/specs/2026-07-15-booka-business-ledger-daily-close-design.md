# Booka Business Ledger & Daily Close — Design

**Date:** 2026-07-15
**Status:** Approved (brainstorm) — ready for implementation planning
**Scope:** First sub-project of the "Booka Operational Intelligence" backlog (Phase 1, narrowed).

---

## 1. Objective

Give Booka a **trustworthy financial ledger foundation**: an append-only record of what
happened in the business, merchant-level reconciliation data on the money-bearing tables,
a deterministic reconciliation engine, and a **daily close report** delivered to the owner.

This is the data-integrity foundation the rest of the Operational Intelligence backlog
depends on. Predictive/analytics/recommendation features are explicitly out of scope until
the ledger is trustworthy.

## 2. Scope

**In scope:**
- Append-only **business event timeline** (`business_events`), separate from the existing
  security-scoped `audit_logs`.
- Merchant **revenue/payment reconciliation fields** on existing money tables.
- Deterministic **reconciliation engine** computing the daily close.
- **Daily close report** delivered as: on-demand report API + scheduled WhatsApp send +
  dashboard archive with drill-down.

**Explicitly out of scope (future specs):**
- Owner natural-language WhatsApp operational commands (§1 of backlog).
- Granular staff-permission groups (§12 of backlog).
- Full discount-approval-threshold controls (§11). We add only the minimal
  `discount_cents`/`discount_reason` fields the close report needs.
- Full anomaly review workflow — `business_anomalies` with status lifecycle, reviewer
  assignment, resolution notes (§3 Phase 2). This spec surfaces review flags read-only;
  it does not let owners action their state.

## 3. Current-state findings (grounding)

Verified against `db/schema/baseline_2026-07-06.sql` and `src/`:

- **Two booking models exist**: `public.bookings` (event/capacity slots) and
  `public.reservations` (the actual per-customer appointment: `service_id`, `staff_id`,
  `customer_id`, `status`, `start_at`, `confirmed_at`). Reservations carry **no price** —
  price comes from the linked `services` row.
- `public.services` has `price` and `price_cents` (mutable).
- `public.transactions` has `amount`, `type`, `status`, `refund_amount`, `refund_reason`,
  `reconciliation_status`, `provider_reference` — but **no link to what it pays for**
  (no `reservation_id`/`order_id`). This is the core reconciliation blocker.
- `public.ledger_entries` is a double-entry-style financial ledger (`entry_type`, `amount`,
  `transaction_id`, `reference_id`).
- `public.retail_carts` / `retail_cart_items` / `retail_orders` / `retail_order_items`
  (migration 120) model product commerce. `retail_orders` has `status`, `payment_status`,
  `total_cents`, `subtotal_cents` but **no discount/paid/delivery fields**.
- `public.audit_logs` is **security-scoped**: `event_type` is constrained to
  `permission_check`, `role_change`, `access_granted`, etc. Not a business timeline.
  Helper: `src/lib/audit/log.ts::writeAuditLog` (best-effort, never throws).
- **Event bus** exists: `src/lib/eventbus/eventBus.ts` via `getEventBus()`, with a
  `subscribers/` directory — the intended hook point for cross-cutting writes.
- **WhatsApp is provider-agnostic**: `src/lib/whatsapp/providers/providerSelection.ts`
  → `resolveDefaultWhatsAppProvider()` resolves to **`meta` (WhatsApp Cloud API) by
  default** when `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` are set; `waha` and
  `evolution` are fallbacks. Outbound must go through `getProviderClient(...)`, never a
  hardcoded provider client.
- `public.tenants` already has a `timezone` column.
- **Existing `PaymentService.reconcileLedger(tenantId, date)`** (`/api/payments/reconcile`)
  reconciles the **payment-provider** ledger (Stripe/Paystack discrepancies). It is NOT
  business-revenue assurance and must not be conflated with the new engine — the new engine
  may *read* its outputs but computes a different thing.

## 4. Architecture decisions

### 4.1 Payment ↔ entity linkage: polymorphic on `transactions`
Add nullable `subject_type` (`reservation` | `retail_order`) + `subject_id` to
`transactions`. Reconciliation reads these tables directly. Chosen over a new unified
`sales` model (bigger migration touching live flows) and over a separate
`payment_allocations` table (more moving parts, only needed once split/partial payments
are a first-class requirement). Backward-compatible; existing rows keep NULL subject.

### 4.2 Price snapshot at completion
Add `reservations.price_cents_snapshot`, written when a reservation transitions to
completed. The close report reads the snapshot, **never the live `services.price`**.
Rationale: `services.price` is mutable; reading it live makes historical closes
non-reproducible (a price edit next month would silently rewrite last month's expected
revenue and create phantom gaps in reports already acted upon). The snapshot freezes the
price that actually applied to that booking, like a receipt. Cost: one nullable column +
a write at the completion transition. Also cleanly absorbs per-booking overrides later.

### 4.3 Business timeline = new table, not extended `audit_logs`
`audit_logs` is security-scoped with NOT NULL columns (`resource`, `permission`,
`security_level`) and a constrained `event_type`. Business events (`order.refunded`,
`payment.recorded`, `booking.completed`) do not fit that shape. A dedicated
`business_events` table keeps concerns separated and gives later backlog phases a clean
merchant timeline to write to.

### 4.4 Review flags = precursor, not Phase 2 workflow
`reconciliation_items` holds read-only "items requiring review" for a run. No
status/assignment/resolution lifecycle (that is Phase 2's `business_anomalies`). The table
is shaped so Phase 2 grows into it (adds lifecycle columns or references these rows as a
detection source) without breaking the close report.

## 5. Data model

All new tables include `id uuid pk`, `tenant_id uuid not null`, `created_at timestamptz`,
RLS mirroring existing service-role + tenant policies. **All money in integer cents.**

### 5.1 New tables

**`business_events`** — append-only merchant timeline.
| column | type | notes |
|---|---|---|
| actor_type | text | `user` \| `staff` \| `customer` \| `ai` \| `system` |
| actor_id | uuid null | |
| action | text not null | e.g. `order.refunded`, `payment.recorded`, `booking.completed` |
| entity_type | text | e.g. `reservation`, `retail_order`, `transaction` |
| entity_id | uuid null | |
| source | text | `whatsapp` \| `dashboard` \| `api` \| `system` |
| before | jsonb | prior state for sensitive changes |
| after | jsonb | new state |
| reason | text null | |
| metadata | jsonb default `{}` | |

- Append-only: `REVOKE UPDATE, DELETE` from app roles; RLS permits INSERT/SELECT only.
- Indexes: `(tenant_id, created_at desc)`, `(tenant_id, entity_type, entity_id)`,
  `(tenant_id, action, created_at)`.

**`reconciliation_runs`** — one row per tenant per business-day.
| column | type | notes |
|---|---|---|
| business_date | date not null | tenant-local calendar day |
| timezone | text not null | tz used to compute the window |
| status | text | `pending` \| `computed` \| `delivered` \| `failed` |
| currency | text default `NGN` | |
| expected_revenue_cents | bigint | |
| adjusted_expected_cents | bigint | |
| recorded_payments_cents | bigint | |
| approved_outstanding_cents | bigint | |
| revenue_gap_cents | bigint | |
| breakdown | jsonb | service/retail/order/delivery/discount/refund subtotals |
| computed_at | timestamptz null | |
| delivered_at | timestamptz null | |
| updated_at | timestamptz | |

- Unique `(tenant_id, business_date)` — idempotency key.

**`reconciliation_items`** — read-only review flags for a run.
| column | type | notes |
|---|---|---|
| run_id | uuid not null → reconciliation_runs | |
| item_type | text | `unpaid_completed_service` \| `delivered_unpaid_order` \| `discount_without_reason` |
| severity | text | `low` \| `medium` \| `high` |
| entity_type | text | |
| entity_id | uuid | |
| expected_cents | bigint null | |
| actual_cents | bigint null | |
| difference_cents | bigint null | |
| detail | jsonb default `{}` | display context |

### 5.2 Column additions (backward-compatible `ALTER TABLE … ADD COLUMN`, nullable/defaulted)

- `transactions`: `subject_type text` (check `reservation`|`retail_order`), `subject_id uuid`;
  index `(tenant_id, subject_type, subject_id)`. *(refund_amount/refund_reason already exist.)*
- `reservations`: `price_cents_snapshot bigint`, `discount_cents bigint default 0`,
  `discount_reason text`, `completed_at timestamptz`.
- `retail_orders`: `discount_cents bigint default 0`, `discount_reason text`,
  `delivery_fee_cents bigint default 0`, `amount_paid_cents bigint default 0`.
- `tenants` (or existing tenant-settings table — reconcile during implementation):
  `close_report_enabled boolean default true`, `close_report_time time default '20:00'`.

## 6. Business event timeline

- Written through the existing `getEventBus()` via a new `business-events` subscriber under
  `src/lib/eventbus/subscribers/`, hooking current publish points rather than scattering
  writes.
- Thin helper `recordBusinessEvent(admin, event)` in `src/lib/audit/` for call sites without
  an event. **Best-effort — never throws** (mirrors `writeAuditLog`).
- Every mutation introduced or touched by this spec emits a business event
  (e.g. `reservation.completed`, `payment.recorded`, `order.refunded`,
  `reconciliation.computed`).

## 7. Reconciliation engine

`ReconciliationService.computeDailyClose(tenantId, businessDate, tz)` — **pure &
deterministic, no LLM**. Location: `src/lib/reconciliation/`.

1. Resolve `[dayStart, dayEnd)` in `tenants.timezone` → UTC bounds.
2. **Expected revenue** = Σ completed reservations in window × `price_cents_snapshot`
   + Σ fulfilled/delivered `retail_orders` totals + Σ `delivery_fee_cents`.
3. **Adjusted expected** = expected − discounts (`reservations.discount_cents` +
   `retail_orders.discount_cents`) − refunds (`transactions.refund_amount` in window)
   − credits.
4. **Recorded payments** = Σ successful transactions in window
   + Σ `retail_orders.amount_paid_cents` for the window.
5. **Revenue gap** = adjusted − recorded − approved outstanding.
6. **Review items** (deterministic, read-only):
   - `unpaid_completed_service`: completed reservation with no linked successful
     transaction (`subject_type='reservation'`, `subject_id=reservation.id`, status success).
   - `delivered_unpaid_order`: `retail_orders` delivered/fulfilled with
     `payment_status != 'paid'`.
   - `discount_without_reason`: any `discount_cents > 0` with null/empty `discount_reason`.
7. Persist run + items **idempotently**: upsert on `(tenant_id, business_date)`; delete +
   re-insert items inside a single DB transaction. Emit `reconciliation.computed`.

Output object mirrors the run row + items, plus a WhatsApp-ready formatted summary.

## 8. Delivery

- **Report API** (owner-scoped, via `createHttpHandler`, roles `['owner','manager']`):
  - `GET /api/owner/close-reports` — list runs (archive).
  - `GET /api/owner/close-reports/:date` — one run + its items + drill-down references.
  - `POST /api/owner/close-reports/:date/recompute` — force recompute (idempotent).
- **Scheduled job**: BullMQ repeatable job (existing `enhancedJobManager`/`scheduler`),
  fanning out per tenant, firing at each tenant's local `close_report_time` using
  `tenants.timezone`. **Skips empty days** (no activity → no send). Marks run `delivered`.
- **WhatsApp**: concise, Naira-formatted (`₦`) report sent via
  `getProviderClient(buildDefaultWhatsAppProviderConfig())` (**Meta by default**) to the
  owner number. Never hardcode Evolution.
- **Dashboard archive**: owner route listing `reconciliation_runs` with drill-down through
  `reconciliation_items` to underlying reservations/orders/transactions.

## 9. Safety & isolation

- Deterministic math outside the LLM (§7). No AI writes to business tables.
- Idempotent recompute via unique `(tenant_id, business_date)`; items replaced atomically.
- RLS on all new tables; tenant-scoped queries throughout.
- `business_events` append-only (REVOKE UPDATE/DELETE).
- Integer cents everywhere; currency carried on the run.
- Every mutation emits a business event → complete audit trail.
- Report/job failures set run `status='failed'` with error context; never partial sends.

## 10. Testing

- Reconciliation math: expected / adjusted / gap across mixed service+retail days.
- **Timezone day-boundary rollover** (activity near local midnight lands in the right day).
- Snapshot-pricing immutability: changing `services.price` after completion does not move a
  prior day's expected revenue.
- `unpaid_completed_service` detection (with and without a linked successful transaction).
- `delivered_unpaid_order` detection.
- `discount_without_reason` flag.
- Idempotent recompute (second run overwrites, items not duplicated).
- Tenant isolation (RLS) on `business_events`, `reconciliation_runs`, `reconciliation_items`.
- `business_events` append-only constraint (UPDATE/DELETE rejected).
- Empty-day job skips send.
- Test types: unit (math, tz), integration (detection, idempotency), DB constraint (RLS,
  append-only), permission (owner-only APIs).

## 11. Migrations & rollback

- One forward migration per logical change (new tables; column additions; grants/RLS),
  numbered after `121_*`. Each ships a paired rollback (`_rollback.sql`) that drops added
  columns/tables and restores grants — following the repo's existing
  `NNN_*` / `NNN_*_rollback.sql` convention.
- Column additions are additive and nullable/defaulted → safe on live data.
- `price_cents_snapshot` backfill is **not** attempted for historical reservations (no
  reliable historical price); snapshots begin at rollout. Documented as a known limitation.

## 12. Implementation order (for the plan)

1. Migrations: new tables + column additions + RLS/grants (+ rollbacks).
2. `business_events` writer (helper + eventBus subscriber) and wire existing mutation points.
3. `price_cents_snapshot` write at reservation completion; transaction `subject_*` linkage
   at payment record time.
4. `ReconciliationService.computeDailyClose` + tests.
5. Report APIs.
6. Dashboard archive page.
7. Scheduled per-tenant delivery job + WhatsApp send (Meta via provider abstraction).
8. Docs update.

Ship as small reviewable units; do not land all steps in one change set.
