# Booka Business Ledger & Daily Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Booka a trustworthy financial foundation — an append-only business event timeline, merchant reconciliation fields, a deterministic daily-close engine, and a daily close report delivered via API, scheduled WhatsApp, and a dashboard archive.

**Architecture:** New Postgres tables (`business_events`, `reconciliation_runs`, `reconciliation_items`) + additive columns on existing money tables. A pure reconciliation math function is unit-tested in isolation; a thin service fetches data, calls it, and persists idempotently. Delivery is a per-tenant BullMQ job sending via the provider-agnostic WhatsApp layer (Meta by default), plus owner-scoped APIs and a dashboard page.

**Tech Stack:** Next.js 16 (App Router), React 19, Supabase (Postgres + RLS), TypeScript, BullMQ, Jest. `psql -f` migrations.

## Global Constraints

- **Money is integer cents** (`bigint`); currency carried on the record (default `NGN`).
- **Tenant isolation:** every new table has RLS; mirror the existing service-role policy pattern (see `db/migrations/079_finance_ledgers.sql`).
- **Determinism:** all reconciliation math is pure code, **no LLM**.
- **Reservations are multi-service:** revenue sums `services.price_cents × reservation_services.quantity` over a reservation's lines (consolidation §N). Never "reservation × one service."
- **Deposits are partial payments:** `transactions.type` ∈ {`deposit`,`payment`,`sale`,`refund`}; deposits count as recorded payment (consolidation §O).
- **`business_events` is append-only** by convention (no UPDATE/DELETE code paths); helper is best-effort (never throws).
- **Schema authority = `db/schema/baseline_2026-07-06.sql` + migrations 114–121** (consolidation §Q). `retail_orders` is defined in `db/migrations/120_retail_orders.sql`. New migrations number after 121.
- **WhatsApp send** goes through `getProviderClient(buildDefaultWhatsAppProviderConfig())` (Meta by default) — never a hardcoded provider.
- **Event action names** come from the shared `BUSINESS_EVENT_ACTIONS` registry (Task 2, consolidation §C).
- **Migrations** ship a paired `_rollback.sql`; column additions are nullable/defaulted.

---

## File Structure

- `db/migrations/122_business_events.sql` (+ `_rollback.sql`) — timeline table.
- `db/migrations/123_reconciliation.sql` (+ `_rollback.sql`) — run + item tables.
- `db/migrations/124_ledger_columns.sql` (+ `_rollback.sql`) — additive columns + tenant close settings.
- `src/lib/audit/businessEvents.ts` — `BUSINESS_EVENT_ACTIONS` + `recordBusinessEvent()`.
- `src/lib/reconciliation/computeClose.ts` — pure math (`computeCloseFromInputs`).
- `src/lib/reconciliation/reconciliationService.ts` — fetch + compute + persist (`computeDailyClose`).
- `src/lib/reconciliation/reservationSnapshot.ts` — `snapshotReservationTotalCents()`.
- `src/app/api/owner/close-reports/route.ts` — list.
- `src/app/api/owner/close-reports/[date]/route.ts` — one run + items.
- `src/app/api/owner/close-reports/[date]/recompute/route.ts` — force recompute.
- `src/lib/reconciliation/closeReportJob.ts` — scheduled per-tenant delivery.
- `src/lib/reconciliation/formatCloseReport.ts` — WhatsApp Naira formatting.
- `src/app/(dashboard)/owner/close-reports/page.tsx` — archive UI.
- Tests co-located as `*.test.ts` (Jest, `@jest/globals`).

Test command: `npm test -- <path>` (Jest). Type check: `npm run typecheck`.

---

## Task 1: Migrations — tables, columns, RLS, rollbacks

**Files:**
- Create: `db/migrations/122_business_events.sql`, `db/migrations/122_business_events_rollback.sql`
- Create: `db/migrations/123_reconciliation.sql`, `db/migrations/123_reconciliation_rollback.sql`
- Create: `db/migrations/124_ledger_columns.sql`, `db/migrations/124_ledger_columns_rollback.sql`

**Interfaces:**
- Produces tables: `business_events`, `reconciliation_runs`, `reconciliation_items`.
- Produces columns: `transactions.subject_type`, `transactions.subject_id`; `reservations.price_cents_snapshot`, `reservations.discount_cents`, `reservations.discount_reason`, `reservations.completed_at`; `retail_orders.discount_cents`, `retail_orders.delivery_fee_cents`, `retail_orders.amount_paid_cents`; `tenants.close_report_enabled`, `tenants.close_report_time`.

- [ ] **Step 1: Write `122_business_events.sql`**

```sql
-- 122_business_events.sql — append-only merchant activity timeline (separate from security audit_logs)
CREATE TABLE IF NOT EXISTS public.business_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_type   text NOT NULL CHECK (actor_type IN ('user','staff','customer','ai','system')),
  actor_id     uuid,
  action       text NOT NULL,
  entity_type  text,
  entity_id    uuid,
  source       text NOT NULL DEFAULT 'system' CHECK (source IN ('whatsapp','dashboard','api','system')),
  before       jsonb,
  after        jsonb,
  reason       text,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_events_tenant_created ON public.business_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_events_entity ON public.business_events (tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_business_events_action ON public.business_events (tenant_id, action, created_at DESC);

ALTER TABLE public.business_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_events_service_role ON public.business_events;
CREATE POLICY business_events_service_role ON public.business_events
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Write `122_business_events_rollback.sql`**

```sql
DROP TABLE IF EXISTS public.business_events CASCADE;
```

- [ ] **Step 3: Write `123_reconciliation.sql`**

```sql
-- 123_reconciliation.sql — daily close runs + review items
CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  business_date              date NOT NULL,
  timezone                   text NOT NULL,
  status                     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','computed','delivered','failed')),
  currency                   text NOT NULL DEFAULT 'NGN',
  expected_revenue_cents     bigint NOT NULL DEFAULT 0,
  adjusted_expected_cents    bigint NOT NULL DEFAULT 0,
  recorded_payments_cents    bigint NOT NULL DEFAULT 0,
  approved_outstanding_cents bigint NOT NULL DEFAULT 0,
  revenue_gap_cents          bigint NOT NULL DEFAULT 0,
  breakdown                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at                timestamptz,
  delivered_at               timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_runs_unique_day UNIQUE (tenant_id, business_date)
);

CREATE TABLE IF NOT EXISTS public.reconciliation_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id           uuid NOT NULL REFERENCES public.reconciliation_runs(id) ON DELETE CASCADE,
  item_type        text NOT NULL CHECK (item_type IN ('unpaid_completed_service','delivered_unpaid_order','discount_without_reason')),
  severity         text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  entity_type      text,
  entity_id        uuid,
  expected_cents   bigint,
  actual_cents     bigint,
  difference_cents bigint,
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_items_run ON public.reconciliation_items (run_id);

ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reconciliation_runs_service_role ON public.reconciliation_runs;
CREATE POLICY reconciliation_runs_service_role ON public.reconciliation_runs
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS reconciliation_items_service_role ON public.reconciliation_items;
CREATE POLICY reconciliation_items_service_role ON public.reconciliation_items
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
```

- [ ] **Step 4: Write `123_reconciliation_rollback.sql`**

```sql
DROP TABLE IF EXISTS public.reconciliation_items CASCADE;
DROP TABLE IF EXISTS public.reconciliation_runs CASCADE;
```

- [ ] **Step 5: Write `124_ledger_columns.sql`**

```sql
-- 124_ledger_columns.sql — additive merchant reconciliation fields + tenant close settings
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS subject_type text CHECK (subject_type IN ('reservation','retail_order')),
  ADD COLUMN IF NOT EXISTS subject_id   uuid;
CREATE INDEX IF NOT EXISTS idx_transactions_subject ON public.transactions (tenant_id, subject_type, subject_id);

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS price_cents_snapshot bigint,
  ADD COLUMN IF NOT EXISTS discount_cents       bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_reason      text,
  ADD COLUMN IF NOT EXISTS completed_at         timestamptz;

ALTER TABLE public.retail_orders
  ADD COLUMN IF NOT EXISTS discount_cents     bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_fee_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_paid_cents  bigint NOT NULL DEFAULT 0;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS close_report_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS close_report_time    time NOT NULL DEFAULT '20:00';
```

Note: `transactions.tenant_id` exists (per baseline). `retail_orders` is from migration 120 — confirm it is applied before running this.

- [ ] **Step 6: Write `124_ledger_columns_rollback.sql`**

```sql
ALTER TABLE public.transactions DROP COLUMN IF EXISTS subject_type, DROP COLUMN IF EXISTS subject_id;
ALTER TABLE public.reservations DROP COLUMN IF EXISTS price_cents_snapshot, DROP COLUMN IF EXISTS discount_cents, DROP COLUMN IF EXISTS discount_reason, DROP COLUMN IF EXISTS completed_at;
ALTER TABLE public.retail_orders DROP COLUMN IF EXISTS discount_cents, DROP COLUMN IF EXISTS delivery_fee_cents, DROP COLUMN IF EXISTS amount_paid_cents;
ALTER TABLE public.tenants DROP COLUMN IF EXISTS close_report_enabled, DROP COLUMN IF EXISTS close_report_time;
```

- [ ] **Step 7: Apply against a scratch DB and verify**

Run: `psql "$DATABASE_URL" -f db/migrations/122_business_events.sql && psql "$DATABASE_URL" -f db/migrations/123_reconciliation.sql && psql "$DATABASE_URL" -f db/migrations/124_ledger_columns.sql`
Expected: `CREATE TABLE` / `ALTER TABLE` with no errors.
Verify: `psql "$DATABASE_URL" -c "\d public.reconciliation_runs"` shows the unique `(tenant_id, business_date)` constraint.

- [ ] **Step 8: Commit**

```bash
git add db/migrations/122_* db/migrations/123_* db/migrations/124_*
git commit -m "feat(ledger): migrations for business_events, reconciliation, and reconciliation fields"
```

---

## Task 2: Business event writer + action registry

**Files:**
- Create: `src/lib/audit/businessEvents.ts`
- Test: `src/lib/audit/businessEvents.test.ts`

**Interfaces:**
- Produces:
  - `BUSINESS_EVENT_ACTIONS` — a `const` object of canonical action strings (e.g. `RESERVATION_COMPLETED: 'reservation.completed'`, `PAYMENT_RECORDED: 'payment.recorded'`, `RECONCILIATION_COMPUTED: 'reconciliation.computed'`).
  - `type BusinessEventInput = { tenantId: string; actorType: 'user'|'staff'|'customer'|'ai'|'system'; actorId?: string|null; action: string; entityType?: string|null; entityId?: string|null; source?: 'whatsapp'|'dashboard'|'api'|'system'; before?: unknown; after?: unknown; reason?: string|null; metadata?: Record<string, unknown>; }`
  - `async function recordBusinessEvent(admin: SupabaseClient, e: BusinessEventInput): Promise<void>` — best-effort insert, never throws.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/audit/businessEvents.test.ts
import { describe, it, expect, jest } from '@jest/globals';
import { recordBusinessEvent, BUSINESS_EVENT_ACTIONS } from './businessEvents';

function mockAdmin(insert: jest.Mock) {
  return { from: jest.fn(() => ({ insert })) } as any;
}

describe('recordBusinessEvent', () => {
  it('inserts a normalized row into business_events', async () => {
    const insert = jest.fn(async () => ({ error: null }));
    const admin = mockAdmin(insert);
    await recordBusinessEvent(admin, {
      tenantId: 't1', actorType: 'system',
      action: BUSINESS_EVENT_ACTIONS.RECONCILIATION_COMPUTED,
      entityType: 'reconciliation_run', entityId: 'r1',
    });
    expect(admin.from).toHaveBeenCalledWith('business_events');
    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({
      tenant_id: 't1', actor_type: 'system',
      action: 'reconciliation.computed', source: 'system', metadata: {},
    });
  });

  it('never throws when the insert errors', async () => {
    const insert = jest.fn(async () => ({ error: { message: 'boom' } }));
    await expect(
      recordBusinessEvent(mockAdmin(insert), { tenantId: 't1', actorType: 'system', action: 'x.y' })
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/audit/businessEvents.test.ts`
Expected: FAIL — module not found / export missing.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/audit/businessEvents.ts
import type { SupabaseClient } from '@supabase/supabase-js';

/** Canonical business-event action names. Every emitter references this (consolidation §C). */
export const BUSINESS_EVENT_ACTIONS = {
  RESERVATION_COMPLETED: 'reservation.completed',
  PAYMENT_RECORDED: 'payment.recorded',
  ORDER_REFUNDED: 'order.refunded',
  RECONCILIATION_COMPUTED: 'reconciliation.computed',
  CLOSE_REPORT_DELIVERED: 'close_report.delivered',
} as const;

export type BusinessEventInput = {
  tenantId: string;
  actorType: 'user' | 'staff' | 'customer' | 'ai' | 'system';
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  source?: 'whatsapp' | 'dashboard' | 'api' | 'system';
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

/** Append-only, best-effort. Auditing must never break the action it records. */
export async function recordBusinessEvent(admin: SupabaseClient, e: BusinessEventInput): Promise<void> {
  try {
    const { error } = await admin.from('business_events').insert({
      tenant_id: e.tenantId,
      actor_type: e.actorType,
      actor_id: e.actorId ?? null,
      action: e.action,
      entity_type: e.entityType ?? null,
      entity_id: e.entityId ?? null,
      source: e.source ?? 'system',
      before: e.before ?? null,
      after: e.after ?? null,
      reason: e.reason ?? null,
      metadata: e.metadata ?? {},
    });
    if (error) console.warn('[business_events] write failed', { action: e.action, error: error.message });
  } catch (err) {
    console.warn('[business_events] write threw', { action: e.action, err });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/audit/businessEvents.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/businessEvents.ts src/lib/audit/businessEvents.test.ts
git commit -m "feat(ledger): business event writer + canonical action registry"
```

---

## Task 3: Reservation price snapshot + payment subject linkage

Implements consolidation §A (completion hook) and §N (multi-service) and the polymorphic payment linkage.

**Files:**
- Create: `src/lib/reconciliation/reservationSnapshot.ts`
- Test: `src/lib/reconciliation/reservationSnapshot.test.ts`
- Modify: `src/app/api/reservations/[id]/route.ts` (hook the snapshot on transition to `completed`)

**Interfaces:**
- Produces: `async function snapshotReservationTotalCents(admin, tenantId, reservationId): Promise<number>` — sums `services.price_cents × reservation_services.quantity` over the reservation's lines; falls back to the single `reservations.service_id × 1` when no `reservation_services` rows exist (legacy single-service bookings).
- Produces: `async function markReservationCompleted(admin, tenantId, reservationId, actorId): Promise<void>` — sets `status='completed'`, `completed_at=now()`, `price_cents_snapshot=<computed>`, and emits `RESERVATION_COMPLETED`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/reconciliation/reservationSnapshot.test.ts
import { describe, it, expect, jest } from '@jest/globals';
import { snapshotReservationTotalCents } from './reservationSnapshot';

// admin returns reservation_services lines and a services price map
function mockAdmin({ lines, prices, fallbackServiceId }: any) {
  return {
    from: (table: string) => {
      if (table === 'reservation_services') return {
        select: () => ({ eq: () => ({ eq: async () => ({ data: lines, error: null }) }) }),
      };
      if (table === 'reservations') return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { service_id: fallbackServiceId }, error: null }) }) }) }),
      };
      if (table === 'services') return {
        select: () => ({ eq: () => ({ in: async () => ({ data: prices, error: null }) }) }),
      };
      throw new Error('unexpected table ' + table);
    },
  } as any;
}

describe('snapshotReservationTotalCents', () => {
  it('sums price_cents × quantity across multiple service lines', async () => {
    const admin = mockAdmin({
      lines: [{ service_id: 's1', quantity: 2 }, { service_id: 's2', quantity: 1 }],
      prices: [{ id: 's1', price_cents: 500000 }, { id: 's2', price_cents: 800000 }],
    });
    // 2×5000 + 1×8000 = ₦18,000 = 1_800_000 cents
    expect(await snapshotReservationTotalCents(admin, 't1', 'res1')).toBe(1_800_000);
  });

  it('falls back to the single service_id when no reservation_services rows exist', async () => {
    const admin = mockAdmin({ lines: [], fallbackServiceId: 's9', prices: [{ id: 's9', price_cents: 300000 }] });
    expect(await snapshotReservationTotalCents(admin, 't1', 'res1')).toBe(300_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/reconciliation/reservationSnapshot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/reconciliation/reservationSnapshot.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordBusinessEvent, BUSINESS_EVENT_ACTIONS } from '@/lib/audit/businessEvents';

/** Sum services.price_cents × reservation_services.quantity over a reservation's lines (multi-service, §N). */
export async function snapshotReservationTotalCents(
  admin: SupabaseClient, tenantId: string, reservationId: string,
): Promise<number> {
  const { data: lines } = await admin
    .from('reservation_services')
    .select('service_id, quantity')
    .eq('tenant_id', tenantId)
    .eq('reservation_id', reservationId);

  let serviceLines: Array<{ service_id: string; quantity: number }> = (lines ?? []).map((l: any) => ({
    service_id: l.service_id, quantity: l.quantity ?? 1,
  }));

  if (serviceLines.length === 0) {
    // Legacy single-service reservation: use reservations.service_id × 1
    const { data: res } = await admin
      .from('reservations').select('service_id').eq('tenant_id', tenantId).eq('id', reservationId).maybeSingle();
    if (res?.service_id) serviceLines = [{ service_id: res.service_id, quantity: 1 }];
  }
  if (serviceLines.length === 0) return 0;

  const ids = [...new Set(serviceLines.map((l) => l.service_id))];
  const { data: services } = await admin.from('services').select('id, price_cents').eq('tenant_id', tenantId).in('id', ids);
  const priceById = new Map((services ?? []).map((s: any) => [s.id, Number(s.price_cents ?? 0)]));

  return serviceLines.reduce((sum, l) => sum + (priceById.get(l.service_id) ?? 0) * (l.quantity ?? 1), 0);
}

/** Idempotently mark a reservation completed with a frozen price snapshot and emit the event. */
export async function markReservationCompleted(
  admin: SupabaseClient, tenantId: string, reservationId: string, actorId: string | null,
): Promise<void> {
  const total = await snapshotReservationTotalCents(admin, tenantId, reservationId);
  const nowIso = new Date().toISOString();
  await admin.from('reservations')
    .update({ status: 'completed', completed_at: nowIso, price_cents_snapshot: total })
    .eq('tenant_id', tenantId).eq('id', reservationId);
  await recordBusinessEvent(admin, {
    tenantId, actorType: actorId ? 'user' : 'system', actorId,
    action: BUSINESS_EVENT_ACTIONS.RESERVATION_COMPLETED,
    entityType: 'reservation', entityId: reservationId,
    after: { status: 'completed', price_cents_snapshot: total }, source: 'api',
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/reconciliation/reservationSnapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Hook the completion path**

In `src/app/api/reservations/[id]/route.ts`, find the handler that updates reservation status (grep: `grep -n "status" src/app/api/reservations/[id]/route.ts`). Where the status is being set to `'completed'`, replace the direct `.update({ status: 'completed' })` with a call to `markReservationCompleted(admin, tenantId, id, actorId)` so the snapshot + event fire in the same path. If completion also happens elsewhere, run `grep -rn "status.*completed" src/app/api/reservations src/lib/booking` and route each write through the helper. Add a code comment: `// price_cents_snapshot frozen here — do not read live services.price for revenue (spec 1 §4.2)`.

- [ ] **Step 6: Verify no reservation completion bypasses the helper**

Run: `grep -rn "'completed'" src/app/api/reservations src/lib/booking | grep -i reservation`
Expected: the only status→completed writes for reservations go through `markReservationCompleted`. Note any that don't in the PR description.

- [ ] **Step 7: Commit**

```bash
git add src/lib/reconciliation/reservationSnapshot.ts src/lib/reconciliation/reservationSnapshot.test.ts src/app/api/reservations/[id]/route.ts
git commit -m "feat(ledger): multi-service price snapshot on reservation completion"
```

- [ ] **Step 8: Wire payment subject linkage**

Where payments are recorded against a booking/order (grep: `grep -rn "from('transactions').insert" src/lib`), set `subject_type` and `subject_id` on insert (`'reservation'`/`'retail_order'` + the id) and emit `PAYMENT_RECORDED`. Add a test asserting the inserted row carries `subject_type`/`subject_id`. Commit: `git commit -m "feat(ledger): link payments to their subject (reservation/retail_order)"`.

---

## Task 4: Reconciliation engine (pure math + service)

**Files:**
- Create: `src/lib/reconciliation/computeClose.ts` (pure)
- Test: `src/lib/reconciliation/computeClose.test.ts`
- Create: `src/lib/reconciliation/reconciliationService.ts`
- Test: `src/lib/reconciliation/reconciliationService.test.ts`

**Interfaces:**
- Produces (pure):
  ```ts
  export interface CloseInputs {
    completedReservations: Array<{ id: string; priceSnapshotCents: number; discountCents: number; discountReason: string | null; paidCents: number }>;
    fulfilledOrders: Array<{ id: string; totalCents: number; deliveryFeeCents: number; discountCents: number; paidCents: number; paymentStatus: string }>;
    refundsCents: number;
    creditsCents: number;
    approvedOutstandingCents: number;
  }
  export interface CloseResult {
    expectedRevenueCents: number; adjustedExpectedCents: number; recordedPaymentsCents: number;
    approvedOutstandingCents: number; revenueGapCents: number;
    breakdown: Record<string, number>;
    items: Array<{ itemType: 'unpaid_completed_service'|'delivered_unpaid_order'|'discount_without_reason'; severity: 'low'|'medium'|'high'; entityType: string; entityId: string; expectedCents: number|null; actualCents: number|null; differenceCents: number|null; detail: Record<string, unknown> }>;
  }
  export function computeCloseFromInputs(i: CloseInputs): CloseResult;
  ```
- Produces (service): `async function computeDailyClose(admin, tenantId, businessDate: string, tz: string): Promise<{ runId: string }>` — resolves the tz day window, fetches inputs, calls `computeCloseFromInputs`, upserts the run + replaces items atomically, emits `RECONCILIATION_COMPUTED`.

- [ ] **Step 1: Write the failing test for the pure math**

```ts
// src/lib/reconciliation/computeClose.test.ts
import { describe, it, expect } from '@jest/globals';
import { computeCloseFromInputs } from './computeClose';

describe('computeCloseFromInputs', () => {
  it('computes expected, adjusted, recorded, gap and flags review items', () => {
    const r = computeCloseFromInputs({
      completedReservations: [
        { id: 'a', priceSnapshotCents: 1_800_000, discountCents: 0, discountReason: null, paidCents: 1_800_000 },
        { id: 'b', priceSnapshotCents: 800_000, discountCents: 100_000, discountReason: null, paidCents: 0 }, // unpaid + discount w/o reason
      ],
      fulfilledOrders: [
        { id: 'o1', totalCents: 3_000_000, deliveryFeeCents: 250_000, discountCents: 0, paidCents: 3_250_000, paymentStatus: 'paid' },
        { id: 'o2', totalCents: 500_000, deliveryFeeCents: 0, discountCents: 0, paidCents: 0, paymentStatus: 'unpaid' }, // delivered unpaid
      ],
      refundsCents: 0, creditsCents: 0, approvedOutstandingCents: 0,
    });
    // expected = 1.8M + 0.8M + 3M + 0.25M + 0.5M = 6_350_000
    expect(r.expectedRevenueCents).toBe(6_350_000);
    // adjusted = expected − discounts(100_000) − refunds(0) − credits(0) = 6_250_000
    expect(r.adjustedExpectedCents).toBe(6_250_000);
    // recorded = 1.8M + 0 + 3.25M + 0 = 5_050_000
    expect(r.recordedPaymentsCents).toBe(5_050_000);
    // gap = adjusted − recorded − outstanding = 1_200_000
    expect(r.revenueGapCents).toBe(1_200_000);
    const types = r.items.map((i) => i.itemType).sort();
    expect(types).toEqual(['delivered_unpaid_order', 'discount_without_reason', 'unpaid_completed_service']);
  });

  it('does not flag a discount that has a reason', () => {
    const r = computeCloseFromInputs({
      completedReservations: [{ id: 'a', priceSnapshotCents: 500_000, discountCents: 50_000, discountReason: 'loyal customer', paidCents: 450_000 }],
      fulfilledOrders: [], refundsCents: 0, creditsCents: 0, approvedOutstandingCents: 0,
    });
    expect(r.items.find((i) => i.itemType === 'discount_without_reason')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/lib/reconciliation/computeClose.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure math**

```ts
// src/lib/reconciliation/computeClose.ts
export interface CloseInputs {
  completedReservations: Array<{ id: string; priceSnapshotCents: number; discountCents: number; discountReason: string | null; paidCents: number }>;
  fulfilledOrders: Array<{ id: string; totalCents: number; deliveryFeeCents: number; discountCents: number; paidCents: number; paymentStatus: string }>;
  refundsCents: number;
  creditsCents: number;
  approvedOutstandingCents: number;
}
type Item = CloseResult['items'][number];
export interface CloseResult {
  expectedRevenueCents: number; adjustedExpectedCents: number; recordedPaymentsCents: number;
  approvedOutstandingCents: number; revenueGapCents: number;
  breakdown: Record<string, number>;
  items: Array<{ itemType: 'unpaid_completed_service'|'delivered_unpaid_order'|'discount_without_reason'; severity: 'low'|'medium'|'high'; entityType: string; entityId: string; expectedCents: number|null; actualCents: number|null; differenceCents: number|null; detail: Record<string, unknown> }>;
}

export function computeCloseFromInputs(i: CloseInputs): CloseResult {
  const serviceExpected = i.completedReservations.reduce((s, r) => s + r.priceSnapshotCents, 0);
  const orderExpected = i.fulfilledOrders.reduce((s, o) => s + o.totalCents + o.deliveryFeeCents, 0);
  const deliveryTotal = i.fulfilledOrders.reduce((s, o) => s + o.deliveryFeeCents, 0);
  const expectedRevenueCents = serviceExpected + orderExpected;

  const discountsTotal =
    i.completedReservations.reduce((s, r) => s + r.discountCents, 0) +
    i.fulfilledOrders.reduce((s, o) => s + o.discountCents, 0);
  const adjustedExpectedCents = expectedRevenueCents - discountsTotal - i.refundsCents - i.creditsCents;

  const recordedPaymentsCents =
    i.completedReservations.reduce((s, r) => s + r.paidCents, 0) +
    i.fulfilledOrders.reduce((s, o) => s + o.paidCents, 0);

  const revenueGapCents = adjustedExpectedCents - recordedPaymentsCents - i.approvedOutstandingCents;

  const items: Item[] = [];
  for (const r of i.completedReservations) {
    if (r.paidCents <= 0) items.push({ itemType: 'unpaid_completed_service', severity: 'high', entityType: 'reservation', entityId: r.id, expectedCents: r.priceSnapshotCents, actualCents: r.paidCents, differenceCents: r.priceSnapshotCents - r.paidCents, detail: {} });
    if (r.discountCents > 0 && !r.discountReason) items.push({ itemType: 'discount_without_reason', severity: 'medium', entityType: 'reservation', entityId: r.id, expectedCents: null, actualCents: r.discountCents, differenceCents: null, detail: {} });
  }
  for (const o of i.fulfilledOrders) {
    if (o.paymentStatus !== 'paid') items.push({ itemType: 'delivered_unpaid_order', severity: 'high', entityType: 'retail_order', entityId: o.id, expectedCents: o.totalCents + o.deliveryFeeCents, actualCents: o.paidCents, differenceCents: (o.totalCents + o.deliveryFeeCents) - o.paidCents, detail: {} });
    if (o.discountCents > 0) { /* order discounts count in totals; reason enforcement lives in §11 */ }
  }

  return {
    expectedRevenueCents, adjustedExpectedCents, recordedPaymentsCents,
    approvedOutstandingCents: i.approvedOutstandingCents, revenueGapCents,
    breakdown: { serviceExpected, orderExpected, deliveryTotal, discountsTotal, refunds: i.refundsCents, credits: i.creditsCents },
    items,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- src/lib/reconciliation/computeClose.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Write the service test (tz window + idempotent upsert)**

```ts
// src/lib/reconciliation/reconciliationService.test.ts
import { describe, it, expect } from '@jest/globals';
import { resolveDayWindowUtc } from './reconciliationService';

describe('resolveDayWindowUtc', () => {
  it('maps a tenant-local date to a UTC [start,end) window', () => {
    const { startUtc, endUtc } = resolveDayWindowUtc('2026-07-15', 'Africa/Lagos'); // UTC+1, no DST
    expect(startUtc).toBe('2026-07-14T23:00:00.000Z');
    expect(endUtc).toBe('2026-07-15T23:00:00.000Z');
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test -- src/lib/reconciliation/reconciliationService.test.ts`
Expected: FAIL — `resolveDayWindowUtc` not exported.

- [ ] **Step 7: Implement the service (window + fetch + persist)**

```ts
// src/lib/reconciliation/reconciliationService.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeCloseFromInputs, type CloseInputs } from './computeClose';
import { recordBusinessEvent, BUSINESS_EVENT_ACTIONS } from '@/lib/audit/businessEvents';

/** Tenant-local calendar date → UTC [start, end). Uses Intl to get the tz offset. */
export function resolveDayWindowUtc(businessDate: string, tz: string): { startUtc: string; endUtc: string } {
  const offsetMs = tzOffsetMs(businessDate, tz);
  const startLocalMidnightUtc = new Date(`${businessDate}T00:00:00.000Z`).getTime() - offsetMs;
  const start = new Date(startLocalMidnightUtc);
  const end = new Date(startLocalMidnightUtc + 24 * 60 * 60 * 1000);
  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

function tzOffsetMs(date: string, tz: string): number {
  // offset = (time interpreted as if it were in tz) − UTC, at local noon to avoid DST edges
  const probe = new Date(`${date}T12:00:00.000Z`);
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const parts = Object.fromEntries(dtf.formatToParts(probe).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - probe.getTime();
}

export async function computeDailyClose(
  admin: SupabaseClient, tenantId: string, businessDate: string, tz: string,
): Promise<{ runId: string }> {
  const { startUtc, endUtc } = resolveDayWindowUtc(businessDate, tz);
  const inputs = await fetchInputs(admin, tenantId, startUtc, endUtc);
  const result = computeCloseFromInputs(inputs);

  // Upsert the run on the unique (tenant_id, business_date) key.
  const { data: run, error } = await admin.from('reconciliation_runs').upsert({
    tenant_id: tenantId, business_date: businessDate, timezone: tz, status: 'computed', currency: 'NGN',
    expected_revenue_cents: result.expectedRevenueCents, adjusted_expected_cents: result.adjustedExpectedCents,
    recorded_payments_cents: result.recordedPaymentsCents, approved_outstanding_cents: result.approvedOutstandingCents,
    revenue_gap_cents: result.revenueGapCents, breakdown: result.breakdown, computed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id,business_date' }).select('id').single();
  if (error || !run) throw new Error(`reconciliation upsert failed: ${error?.message}`);

  // Replace items for this run (idempotent recompute).
  await admin.from('reconciliation_items').delete().eq('run_id', run.id);
  if (result.items.length > 0) {
    await admin.from('reconciliation_items').insert(result.items.map((it) => ({
      tenant_id: tenantId, run_id: run.id, item_type: it.itemType, severity: it.severity,
      entity_type: it.entityType, entity_id: it.entityId, expected_cents: it.expectedCents,
      actual_cents: it.actualCents, difference_cents: it.differenceCents, detail: it.detail,
    })));
  }

  await recordBusinessEvent(admin, {
    tenantId, actorType: 'system', action: BUSINESS_EVENT_ACTIONS.RECONCILIATION_COMPUTED,
    entityType: 'reconciliation_run', entityId: run.id, source: 'system',
    metadata: { businessDate, gapCents: result.revenueGapCents, itemCount: result.items.length },
  });
  return { runId: run.id };
}

/** Fetch completed reservations, fulfilled orders, refunds/deposits in the window. */
async function fetchInputs(admin: SupabaseClient, tenantId: string, startUtc: string, endUtc: string): Promise<CloseInputs> {
  const { data: reservations } = await admin.from('reservations')
    .select('id, price_cents_snapshot, discount_cents, discount_reason')
    .eq('tenant_id', tenantId).eq('status', 'completed').gte('completed_at', startUtc).lt('completed_at', endUtc);

  const { data: orders } = await admin.from('retail_orders')
    .select('id, total_cents, delivery_fee_cents, discount_cents, amount_paid_cents, payment_status, fulfillment_status')
    .eq('tenant_id', tenantId).in('fulfillment_status', ['fulfilled']).gte('updated_at', startUtc).lt('updated_at', endUtc);

  // Payments (incl. deposits) linked to each reservation, in-window.
  const { data: txns } = await admin.from('transactions')
    .select('subject_type, subject_id, amount, type, status, refund_amount')
    .eq('tenant_id', tenantId).gte('created_at', startUtc).lt('created_at', endUtc);

  const paidByReservation = new Map<string, number>();
  let refundsCents = 0;
  for (const t of txns ?? []) {
    const cents = Math.round(Number(t.amount ?? 0) * 100);
    if (t.type === 'refund') { refundsCents += Math.round(Number(t.refund_amount ?? t.amount ?? 0) * 100); continue; }
    if (t.status === 'success' && (t.type === 'payment' || t.type === 'deposit' || t.type === 'sale') && t.subject_type === 'reservation' && t.subject_id) {
      paidByReservation.set(t.subject_id, (paidByReservation.get(t.subject_id) ?? 0) + cents);
    }
  }

  return {
    completedReservations: (reservations ?? []).map((r: any) => ({
      id: r.id, priceSnapshotCents: Number(r.price_cents_snapshot ?? 0),
      discountCents: Number(r.discount_cents ?? 0), discountReason: r.discount_reason ?? null,
      paidCents: paidByReservation.get(r.id) ?? 0,
    })),
    fulfilledOrders: (orders ?? []).map((o: any) => ({
      id: o.id, totalCents: Number(o.total_cents ?? 0), deliveryFeeCents: Number(o.delivery_fee_cents ?? 0),
      discountCents: Number(o.discount_cents ?? 0), paidCents: Number(o.amount_paid_cents ?? 0), paymentStatus: o.payment_status,
    })),
    refundsCents, creditsCents: 0, approvedOutstandingCents: 0,
  };
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npm test -- src/lib/reconciliation/reconciliationService.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/reconciliation/computeClose.ts src/lib/reconciliation/computeClose.test.ts src/lib/reconciliation/reconciliationService.ts src/lib/reconciliation/reconciliationService.test.ts
git commit -m "feat(ledger): deterministic daily-close engine (multi-service, deposits, idempotent)"
```

---

## Task 5: Close-report APIs

**Files:**
- Create: `src/app/api/owner/close-reports/route.ts` (GET list)
- Create: `src/app/api/owner/close-reports/[date]/route.ts` (GET one + items)
- Create: `src/app/api/owner/close-reports/[date]/recompute/route.ts` (POST)
- Test: `src/app/api/owner/close-reports/route.test.ts`

**Interfaces:**
- Consumes: `computeDailyClose` (Task 4); `createHttpHandler`, `getVerifiedTenantId` from `src/lib/error-handling/route-handler.ts` (pattern per `src/app/api/payments/reconcile/route.ts`).
- Produces: `GET /api/owner/close-reports` → `{ runs: Run[] }`; `GET /api/owner/close-reports/:date` → `{ run, items }`; `POST /api/owner/close-reports/:date/recompute` → `{ runId }`.

- [ ] **Step 1: Write the list route**

```ts
// src/app/api/owner/close-reports/route.ts
export const dynamic = 'force-dynamic';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';

export const GET = createHttpHandler(async (ctx) => {
  const tenantId = getVerifiedTenantId(ctx);
  const { data, error } = await ctx.supabase
    .from('reconciliation_runs')
    .select('id, business_date, status, currency, expected_revenue_cents, adjusted_expected_cents, recorded_payments_cents, revenue_gap_cents, delivered_at')
    .eq('tenant_id', tenantId).order('business_date', { ascending: false }).limit(90);
  if (error) throw error;
  return { runs: data ?? [] };
}, 'GET', { auth: true, roles: ['owner', 'manager'] });
```

- [ ] **Step 2: Write the detail route**

```ts
// src/app/api/owner/close-reports/[date]/route.ts
export const dynamic = 'force-dynamic';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

export const GET = createHttpHandler(async (ctx) => {
  const tenantId = getVerifiedTenantId(ctx);
  const date = ctx.params?.date as string;
  const { data: run } = await ctx.supabase.from('reconciliation_runs')
    .select('*').eq('tenant_id', tenantId).eq('business_date', date).maybeSingle();
  if (!run) throw ApiErrorFactory.notFound('No close report for that date');
  const { data: items } = await ctx.supabase.from('reconciliation_items')
    .select('*').eq('run_id', run.id).order('severity', { ascending: false });
  return { run, items: items ?? [] };
}, 'GET', { auth: true, roles: ['owner', 'manager'] });
```

- [ ] **Step 3: Write the recompute route**

```ts
// src/app/api/owner/close-reports/[date]/recompute/route.ts
export const dynamic = 'force-dynamic';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { computeDailyClose } from '@/lib/reconciliation/reconciliationService';

export const POST = createHttpHandler(async (ctx) => {
  const tenantId = getVerifiedTenantId(ctx);
  const date = ctx.params?.date as string;
  const admin = createSupabaseAdminClient();
  const { data: tenant } = await admin.from('tenants').select('timezone').eq('id', tenantId).single();
  const { runId } = await computeDailyClose(admin, tenantId, date, tenant?.timezone ?? 'Africa/Lagos');
  return { runId };
}, 'POST', { auth: true, roles: ['owner', 'manager'] });
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors in `src/app/api/owner/close-reports/**`. (Confirm `ctx.params` access matches the repo's handler signature; adjust to the established pattern in a neighboring `[id]` route if different.)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/owner/close-reports
git commit -m "feat(ledger): owner close-report APIs (list, detail, recompute)"
```

---

## Task 6: Dashboard archive page

**Files:**
- Create: `src/app/(dashboard)/owner/close-reports/page.tsx`

**Interfaces:**
- Consumes: `GET /api/owner/close-reports`, `GET /api/owner/close-reports/:date` (Task 5).

- [ ] **Step 1: Build the archive list + detail view**

Follow an existing owner dashboard page for layout/auth (grep: `find src/app -path '*owner*' -name page.tsx | head`). Render the runs table (date, expected, recorded, gap — format cents as `₦${(c/100).toLocaleString()}`) with a row link that fetches `:date` detail and lists `reconciliation_items` (item_type, severity, amounts) with drill-through links to the underlying reservation/order. Use React Query (`@tanstack/react-query`, already in the stack) for fetching.

- [ ] **Step 2: Verify it renders**

Run: `npm run dev`, visit `/owner/close-reports`, confirm the table renders and a row expands to items. (If no data yet, seed one run via the recompute endpoint.)

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/owner/close-reports/page.tsx"
git commit -m "feat(ledger): dashboard close-report archive with drill-through"
```

---

## Task 7: Scheduled per-tenant WhatsApp delivery

**Files:**
- Create: `src/lib/reconciliation/formatCloseReport.ts` (+ `.test.ts`)
- Create: `src/lib/reconciliation/closeReportJob.ts`
- Modify: the BullMQ registration in `src/lib/worker/queue.ts` (add a repeatable close-report job)

**Interfaces:**
- Consumes: `computeDailyClose` (Task 4); `getProviderClient`, `buildDefaultWhatsAppProviderConfig` from `src/lib/whatsapp/providers`; `sendTextMessage(to, text)`.
- Produces: `formatCloseReportText(run, items): string`; `runCloseReportForTenant(admin, tenantId): Promise<void>`.

- [ ] **Step 1: Write the formatter test**

```ts
// src/lib/reconciliation/formatCloseReport.test.ts
import { describe, it, expect } from '@jest/globals';
import { formatCloseReportText } from './formatCloseReport';

describe('formatCloseReportText', () => {
  it('renders Naira amounts and an items-requiring-review section', () => {
    const text = formatCloseReportText(
      { business_date: '2026-07-15', expected_revenue_cents: 42000000, recorded_payments_cents: 38000000, approved_outstanding_cents: 2500000, revenue_gap_cents: 1500000, currency: 'NGN' } as any,
      [{ item_type: 'unpaid_completed_service' } as any, { item_type: 'delivered_unpaid_order' } as any],
    );
    expect(text).toContain('₦420,000');
    expect(text).toContain('₦15,000');
    expect(text).toMatch(/review/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement the formatter**

Run: `npm test -- src/lib/reconciliation/formatCloseReport.test.ts` (FAIL), then:

```ts
// src/lib/reconciliation/formatCloseReport.ts
const naira = (cents: number) => `₦${Math.round(cents / 100).toLocaleString()}`;
export function formatCloseReportText(run: any, items: any[]): string {
  const counts = items.reduce((m: Record<string, number>, it) => ((m[it.item_type] = (m[it.item_type] ?? 0) + 1), m), {});
  const label: Record<string, string> = {
    unpaid_completed_service: 'completed appointments without payments',
    delivered_unpaid_order: 'delivered orders marked unpaid',
    discount_without_reason: 'discounts without a reason',
  };
  const lines = Object.entries(counts).map(([k, n]) => `- ${n} ${label[k] ?? k}`);
  return [
    `Today's Revenue Assurance Report (${run.business_date})`, '',
    `Expected revenue: ${naira(run.expected_revenue_cents)}`,
    `Recorded payments: ${naira(run.recorded_payments_cents)}`,
    `Approved outstanding: ${naira(run.approved_outstanding_cents)}`,
    `Unexplained difference: ${naira(run.revenue_gap_cents)}`,
    ...(lines.length ? ['', 'Items requiring review:', ...lines] : []),
  ].join('\n');
}
```
Run again → PASS.

- [ ] **Step 3: Implement the per-tenant job (skip empty days, send via provider abstraction)**

```ts
// src/lib/reconciliation/closeReportJob.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeDailyClose } from './reconciliationService';
import { formatCloseReportText } from './formatCloseReport';
import { recordBusinessEvent, BUSINESS_EVENT_ACTIONS } from '@/lib/audit/businessEvents';
import { getProviderClient, buildDefaultWhatsAppProviderConfig } from '@/lib/whatsapp/providers';

export async function runCloseReportForTenant(admin: SupabaseClient, tenantId: string): Promise<void> {
  const { data: tenant } = await admin.from('tenants').select('timezone, close_report_enabled').eq('id', tenantId).single();
  if (!tenant?.close_report_enabled) return;
  const tz = tenant.timezone ?? 'Africa/Lagos';
  const businessDate = localDateString(tz);

  const { runId } = await computeDailyClose(admin, tenantId, businessDate, tz);
  const { data: run } = await admin.from('reconciliation_runs').select('*').eq('id', runId).single();
  const { data: items } = await admin.from('reconciliation_items').select('*').eq('run_id', runId);

  // Skip empty/meaningless days.
  if ((run?.expected_revenue_cents ?? 0) === 0 && (run?.recorded_payments_cents ?? 0) === 0) return;

  const ownerPhone = await ownerWhatsappNumber(admin, tenantId);
  if (ownerPhone) {
    const client = getProviderClient(buildDefaultWhatsAppProviderConfig()!); // Meta by default
    await client.sendTextMessage(ownerPhone, formatCloseReportText(run, items ?? []));
    await admin.from('reconciliation_runs').update({ status: 'delivered', delivered_at: new Date().toISOString() }).eq('id', runId);
    await recordBusinessEvent(admin, { tenantId, actorType: 'system', action: BUSINESS_EVENT_ACTIONS.CLOSE_REPORT_DELIVERED, entityType: 'reconciliation_run', entityId: runId, source: 'system' });
  }
}

function localDateString(tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date()); // yesterday-vs-today policy: run after local midnight for the day that just closed
}
async function ownerWhatsappNumber(admin: SupabaseClient, tenantId: string): Promise<string | null> {
  const { data } = await admin.from('tenant_users').select('phone').eq('tenant_id', tenantId).eq('role', 'owner').limit(1).maybeSingle();
  return data?.phone ?? null;
}
```

- [ ] **Step 4: Register the repeatable job**

In `src/lib/worker/queue.ts`, add a `close_report` job type (zod schema `{ type: 'close_report', tenant_id: string }`) and a repeatable schedule that enqueues `runCloseReportForTenant` per active tenant near each tenant's `close_report_time`. Follow the existing repeatable-job pattern in that file. Keep the handler thin — it calls `runCloseReportForTenant(admin, tenant_id)`.

- [ ] **Step 5: Verify the job path manually**

Trigger `runCloseReportForTenant(admin, '<test-tenant>')` from a scratch script or the recompute endpoint variant; confirm a `reconciliation_runs` row goes to `status='delivered'` and a `close_report.delivered` business event is written. If no WhatsApp creds in dev, stub the provider and assert `sendTextMessage` is called with the formatted text.

- [ ] **Step 6: Commit**

```bash
git add src/lib/reconciliation/formatCloseReport.ts src/lib/reconciliation/formatCloseReport.test.ts src/lib/reconciliation/closeReportJob.ts src/lib/worker/queue.ts
git commit -m "feat(ledger): scheduled per-tenant close-report WhatsApp delivery (Meta default)"
```

---

## Task 8: Apply-scripts and docs

**Files:**
- Create: `scripts/sql/apply_business_ledger.sql` (concatenates 122–124 in order)
- Modify: `package.json` (add `db:apply:business-ledger`)
- Modify: `docs/README.md` or the architecture map — note the new ledger subsystem.

- [ ] **Step 1: Write the apply script**

```sql
-- scripts/sql/apply_business_ledger.sql
\i db/migrations/122_business_events.sql
\i db/migrations/123_reconciliation.sql
\i db/migrations/124_ledger_columns.sql
```

- [ ] **Step 2: Add the npm script**

In `package.json` scripts: `"db:apply:business-ledger": "psql \"$DATABASE_URL\" -f scripts/sql/apply_business_ledger.sql"`.

- [ ] **Step 3: Document the subsystem**

Add a short section to the docs index describing: the three new tables, the deterministic `computeDailyClose` engine, the daily WhatsApp close report, and the cross-spec touch-points (this is spec 1 of the Operational Intelligence stack; specs 2–3 depend on `business_events`/`transactions.subject_*`).

- [ ] **Step 4: Full test + typecheck sweep**

Run: `npm test -- src/lib/reconciliation src/lib/audit && npm run typecheck`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add scripts/sql/apply_business_ledger.sql package.json docs/
git commit -m "chore(ledger): apply script + docs for business ledger subsystem"
```

---

## Self-Review

**Spec coverage:**
- §5 tables → Task 1. §6 event writer → Task 2. §4.2 snapshot + §4.1 linkage + §A hook → Task 3. §7 engine (multi-service §N, deposits §O) → Task 4. §8 APIs → Task 5, dashboard → Task 6, scheduled WhatsApp → Task 7. §11 apply/rollback → Task 1 + Task 8. §C action registry → Task 2. §10 tests → each task's TDD steps.
- Deferred correctly (not in this plan): owner NL commands, permissions, anomaly workflow — later specs.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to". Two steps intentionally reference existing repo patterns to match (Task 5 `ctx.params` shape, Task 6 dashboard layout, Task 7 repeatable-job registration) with a concrete grep to find the pattern — acceptable because they adapt to established conventions rather than inventing.

**Type consistency:** `computeCloseFromInputs`/`CloseInputs`/`CloseResult` (Task 4) are consumed by name in `computeDailyClose`; `recordBusinessEvent`/`BUSINESS_EVENT_ACTIONS` (Task 2) used consistently in Tasks 3, 4, 7; `snapshotReservationTotalCents`/`markReservationCompleted` (Task 3) names stable; `formatCloseReportText`/`runCloseReportForTenant` (Task 7) consistent.

**Known adaptation points for the implementer** (flagged, not placeholders): confirm `ctx.params` access and `ApiErrorFactory.notFound` exist as named (mirror a neighboring route); confirm `retail_orders.updated_at` is the right window column for fulfilled orders (fall back to a fulfilled-at timestamp if one exists); the day-close policy (report "today" after local midnight vs the day that just closed) should match tenant expectation — default is the calendar day that just ended.
