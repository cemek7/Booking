# WhatsApp Message Metering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meter, gate, settle and reconcile the cost of every outbound WhatsApp message so Booka can charge tenants correctly when Meta starts billing service messages on 2026-10-01.

**Architecture:** A `withMetering` decorator wraps the provider client and reserves credits from the tenant's existing `ai_wallets` balance before each send; Meta's status webhook settles that reservation using Meta's own `pricing` object, so the same code is correct before and after the pricing change. A `whatsapp_message_charges` table correlates the wamid to the wallet reservation. A 15-minute sweeper releases reservations that never settled, so an undelivered message is never billed.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (PostgreSQL 16) with plpgsql RPCs, Jest (`@jest/globals`), path alias `@/` → `src/`.

**Spec:** `docs/superpowers/specs/2026-08-28-whatsapp-message-metering-design.md`

## Global Constraints

- **Branch:** `feat/whatsapp-message-metering`, worktree `/home/ccemeka/Techclave/Booking/worktrees/whatsapp-metering`, based on `staging`. Never `git checkout` in a shared working directory.
- **The user runs migrations on the VPS.** Never run a migration against the real database. Validate only against a throwaway `postgres:16-alpine` container.
- Migrations are plaintext, idempotent and RLS-aware. Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. **Never `CREATE TABLE IF NOT EXISTS` when the goal is adding columns or constraints to an existing table** — it silently skips.
- Every migration ships a `_rollback.sql` companion (convention from `136_recommendations.sql` / `136_recommendations_rollback.sql`).
- Next free migration number is **139**. Highest on `staging` is `138_harden_retail_sale_functions.sql`.
- Unit tests: `jest` (default `jest.config.cjs`). Integration: `jest --config jest.integration.config.cjs --runInBand`.
- Typecheck with `npm run typecheck` before every commit. `staging` has an active campaign to remove `@ts-nocheck` — **do not add `@ts-nocheck` to any new file.**
- All money is `NUMERIC(20,6)` credits. Never `float`.
- Metering defaults to `shadow`. Nothing in this plan may gate a real send until `BOOKA_MESSAGE_METERING_MODE=live` is set, which happens on 2026-10-01.
- Schema drift rules that apply here: `reservations` uses `customer_number` (not `phone`/`customer_phone`) and `staff_id` (not `staff_user_id`), and has no `updated_at`. `messages` has no `booking_id` or `text` column.

---

### Task 1: Fix the status-webhook idempotency collision

Blocks every later task. `statuses[].id` **is the wamid**, and Meta sends `sent`, `delivered` and `read` as separate webhooks carrying the same `id`. The current dedupe key collapses them into one, so settlement (Task 9) would fire on `sent`, never on `delivered`, and silently never charge in production.

**Files:**
- Modify: `src/app/api/webhooks/whatsapp/meta/route.ts:39-43` (widen `statuses` type)
- Modify: `src/app/api/webhooks/whatsapp/meta/route.ts:171-179` (dedupe key)
- Test: `src/__tests__/api/webhooks/meta-status-idempotency.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the widened `statuses` element type, which Task 9 reads:
  ```ts
  statuses?: Array<{
    id?: string;
    status?: string;
    timestamp?: string;
    recipient_id?: string;
    conversation?: { id?: string; origin?: { type?: string } };
    pricing?: {
      billable?: boolean;
      pricing_model?: string;
      category?: string;
      type?: string;
    };
  }>;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/api/webhooks/meta-status-idempotency.test.ts`. It asserts the dedupe key for a status webhook includes the status verb, via a small pure helper exported from the route so the test does not need to boot the route.

```ts
import { describe, it, expect } from '@jest/globals';
import { buildStatusIdempotencyKey } from '@/app/api/webhooks/whatsapp/meta/route';

describe('buildStatusIdempotencyKey', () => {
  it('distinguishes sent from delivered for the same wamid', () => {
    expect(buildStatusIdempotencyKey('wamid.ABC', 'sent'))
      .not.toBe(buildStatusIdempotencyKey('wamid.ABC', 'delivered'));
  });

  it('is stable for a replay of the same status', () => {
    expect(buildStatusIdempotencyKey('wamid.ABC', 'delivered'))
      .toBe(buildStatusIdempotencyKey('wamid.ABC', 'delivered'));
  });

  it('falls back to a literal when the status verb is missing', () => {
    expect(buildStatusIdempotencyKey('wamid.ABC', undefined))
      .toBe('wamid.ABC:unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/api/webhooks/meta-status-idempotency.test.ts`
Expected: FAIL — `buildStatusIdempotencyKey is not a function`.

- [ ] **Step 3: Add the helper and use it**

In `src/app/api/webhooks/whatsapp/meta/route.ts`, add near the other helpers:

```ts
export function buildStatusIdempotencyKey(wamid: string, status?: string): string {
  return `${wamid}:${status ?? 'unknown'}`;
}
```

Replace the statuses loop body (currently at L171-179):

```ts
      for (const status of value.statuses ?? []) {
        if (!status.id) continue;
        await handleIdempotency(
          supabase,
          'meta',
          `${metaPhoneNumberId}:status`,
          buildStatusIdempotencyKey(status.id, status.status),
          { type: 'status', status, value }
        );
      }
```

Widen the `statuses` type at L39-43 to the shape given under **Interfaces** above.
Task 10 declares a standalone `MetaStatusEvent` interface with the same shape and the
`statuses` array is typed as `MetaStatusEvent[]` there, so the shape is declared once.

Note: `handleIdempotency` composes `externalId = \`${instanceScope}:${messageId}\`` internally (route.ts:324), so passing the composed key as `messageId` yields `<phoneNumberId>:status:<wamid>:<verb>`. That is the intended key.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/api/webhooks/meta-status-idempotency.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/app/api/webhooks/whatsapp/meta/route.ts src/__tests__/api/webhooks/meta-status-idempotency.test.ts
git commit -m "fix(webhooks): key meta status idempotency on wamid+verb, not wamid alone

statuses[].id is the wamid, and sent/delivered/read all carry it. Deduping
on the wamid alone discards every status after the first, which would make
message settlement silently never fire. Also widens the statuses type to
carry Meta's pricing and conversation objects."
```

---

### Task 2: Migration 139 — meter dimension and wallet knobs

**Files:**
- Create: `db/migrations/139_whatsapp_metering_wallet.sql`
- Create: `db/migrations/139_whatsapp_metering_wallet_rollback.sql`

**Interfaces:**
- Consumes: `public.ai_wallets`, `public.ai_wallet_ledger` from `077_ai_wallets.sql`.
- Produces: columns `ai_wallets.message_rate_credits`, `ai_wallets.grace_overdraft_credits`, `ai_wallets.auto_recharge_enabled`, `ai_wallets.auto_recharge_threshold_credits`, `ai_wallets.auto_recharge_amount_credits`, and `ai_wallet_ledger.meter`. Tasks 4 and 7 read these.

- [ ] **Step 1: Write the migration**

`db/migrations/139_whatsapp_metering_wallet.sql`:

```sql
-- Migration 139: WhatsApp metering — meter dimension and wallet knobs
-- Extends the existing AI wallet so a single tenant balance funds two meters
-- (LLM tokens and WhatsApp messages) without duplicating reserve/settle logic.

ALTER TABLE public.ai_wallets
  ADD COLUMN IF NOT EXISTS message_rate_credits NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS grace_overdraft_credits NUMERIC(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_recharge_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_recharge_threshold_credits NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS auto_recharge_amount_credits NUMERIC(20,6);

COMMENT ON COLUMN public.ai_wallets.message_rate_credits IS
  'Per-tenant override for the WhatsApp message sell rate. NULL = platform default.';
COMMENT ON COLUMN public.ai_wallets.grace_overdraft_credits IS
  'How far below zero this wallet may go for message sends before handoff.';

ALTER TABLE public.ai_wallet_ledger
  ADD COLUMN IF NOT EXISTS meter TEXT NOT NULL DEFAULT 'llm';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_wallet_ledger_meter_check'
  ) THEN
    ALTER TABLE public.ai_wallet_ledger
      ADD CONSTRAINT ai_wallet_ledger_meter_check
      CHECK (meter IN ('llm', 'whatsapp'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_wallet_ledger_tenant_meter_created_at
  ON public.ai_wallet_ledger (tenant_id, meter, created_at DESC);
```

The `DEFAULT 'llm'` backfills every existing row correctly — all historical spend is LLM spend.

- [ ] **Step 2: Write the rollback**

`db/migrations/139_whatsapp_metering_wallet_rollback.sql`:

```sql
-- Rollback for migration 139
DROP INDEX IF EXISTS public.idx_ai_wallet_ledger_tenant_meter_created_at;

ALTER TABLE public.ai_wallet_ledger
  DROP CONSTRAINT IF EXISTS ai_wallet_ledger_meter_check;

ALTER TABLE public.ai_wallet_ledger
  DROP COLUMN IF EXISTS meter;

ALTER TABLE public.ai_wallets
  DROP COLUMN IF EXISTS message_rate_credits,
  DROP COLUMN IF EXISTS grace_overdraft_credits,
  DROP COLUMN IF EXISTS auto_recharge_enabled,
  DROP COLUMN IF EXISTS auto_recharge_threshold_credits,
  DROP COLUMN IF EXISTS auto_recharge_amount_credits;
```

- [ ] **Step 3: Validate in a throwaway container**

```bash
docker run --rm -d --name booka-mig-test -e POSTGRES_PASSWORD=pw -p 55439:5432 postgres:16-alpine
sleep 5
export MIG_URL="postgresql://postgres:pw@localhost:55439/postgres"
psql "$MIG_URL" -v ON_ERROR_STOP=1 -c "CREATE TABLE public.tenants (id UUID PRIMARY KEY, timezone TEXT);"
psql "$MIG_URL" -v ON_ERROR_STOP=1 -f db/migrations/077_ai_wallets.sql
psql "$MIG_URL" -v ON_ERROR_STOP=1 -f db/migrations/139_whatsapp_metering_wallet.sql
# idempotency: running twice must succeed
psql "$MIG_URL" -v ON_ERROR_STOP=1 -f db/migrations/139_whatsapp_metering_wallet.sql
psql "$MIG_URL" -v ON_ERROR_STOP=1 -f db/migrations/139_whatsapp_metering_wallet_rollback.sql
psql "$MIG_URL" -v ON_ERROR_STOP=1 -f db/migrations/139_whatsapp_metering_wallet.sql
```

Expected: every command exits 0. `077` will warn that `service_role` does not exist — create it first if psql errors:
`psql "$MIG_URL" -c "CREATE ROLE service_role;"`

Leave the container running; Tasks 3 and 4 reuse it. Tear down with `docker rm -f booka-mig-test` after Task 4.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/139_whatsapp_metering_wallet.sql db/migrations/139_whatsapp_metering_wallet_rollback.sql
git commit -m "feat(db): migration 139 — wallet meter dimension and message rate knobs"
```

---

### Task 3: Migration 140 — `whatsapp_message_charges`

**Files:**
- Create: `db/migrations/140_whatsapp_message_charges.sql`
- Create: `db/migrations/140_whatsapp_message_charges_rollback.sql`

**Interfaces:**
- Consumes: `public.tenants`, and `ai_wallet_ledger.id` values as `wallet_reservation_id`.
- Produces: table `public.whatsapp_message_charges` with the exact column names used by Tasks 7, 10, 11 and 12.

- [ ] **Step 1: Write the migration**

`db/migrations/140_whatsapp_message_charges.sql`:

```sql
-- Migration 140: WhatsApp message charges
-- Correlates a Meta wamid to the wallet reservation taken before the send, so
-- settlement can charge from Meta's own pricing object and undelivered
-- messages can be released instead of billed.

CREATE TABLE IF NOT EXISTS public.whatsapp_message_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  wamid TEXT,
  wallet_reservation_id UUID,
  reserved_credits NUMERIC(20,6) NOT NULL DEFAULT 0,
  settled_credits NUMERIC(20,6),
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'settled', 'released', 'failed')),
  billable BOOLEAN,
  pricing_category TEXT,
  pricing_type TEXT,
  pricing_model TEXT,
  delivery_status TEXT,
  message_kind TEXT,
  mode TEXT NOT NULL DEFAULT 'live'
    CHECK (mode IN ('shadow', 'live')),
  attribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_message_charges_tenant_wamid
  ON public.whatsapp_message_charges (tenant_id, wamid) WHERE wamid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_charges_sweeper
  ON public.whatsapp_message_charges (sent_at) WHERE status = 'reserved';

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_charges_tenant_sent_at
  ON public.whatsapp_message_charges (tenant_id, sent_at DESC);

ALTER TABLE public.whatsapp_message_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_message_charges_service_role
  ON public.whatsapp_message_charges;
CREATE POLICY whatsapp_message_charges_service_role
  ON public.whatsapp_message_charges
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON COLUMN public.whatsapp_message_charges.attribution IS
  'Free-form {conversation_id, booking_id, flow, ai_layer} used by cost reporting.';
COMMENT ON COLUMN public.whatsapp_message_charges.mode IS
  'shadow rows record volume but never move money; live rows are real revenue.';
```

- [ ] **Step 2: Write the rollback**

`db/migrations/140_whatsapp_message_charges_rollback.sql`:

```sql
-- Rollback for migration 140
DROP TABLE IF EXISTS public.whatsapp_message_charges;
```

- [ ] **Step 3: Validate**

Against the container from Task 2:

```bash
psql "$MIG_URL" -v ON_ERROR_STOP=1 -f db/migrations/140_whatsapp_message_charges.sql
psql "$MIG_URL" -v ON_ERROR_STOP=1 -f db/migrations/140_whatsapp_message_charges.sql
psql "$MIG_URL" -v ON_ERROR_STOP=1 -c "
  INSERT INTO public.tenants (id) VALUES ('11111111-1111-1111-1111-111111111111');
  INSERT INTO public.whatsapp_message_charges (tenant_id, provider, wamid)
    VALUES ('11111111-1111-1111-1111-111111111111', 'meta', 'wamid.A');
"
psql "$MIG_URL" -c "
  INSERT INTO public.whatsapp_message_charges (tenant_id, provider, wamid)
    VALUES ('11111111-1111-1111-1111-111111111111', 'meta', 'wamid.A');
"
```

Expected: the first insert succeeds; the duplicate wamid insert fails with
`duplicate key value violates unique constraint "uq_whatsapp_message_charges_tenant_wamid"`.
That failure is the proof settlement cannot double-charge.

Then confirm two NULL wamids coexist (reserved-but-not-yet-sent rows):

```bash
psql "$MIG_URL" -v ON_ERROR_STOP=1 -c "
  INSERT INTO public.whatsapp_message_charges (tenant_id, provider) VALUES
    ('11111111-1111-1111-1111-111111111111', 'meta'),
    ('11111111-1111-1111-1111-111111111111', 'meta');
"
```

Expected: succeeds (partial index excludes NULLs).

- [ ] **Step 4: Commit**

```bash
git add db/migrations/140_whatsapp_message_charges.sql db/migrations/140_whatsapp_message_charges_rollback.sql
git commit -m "feat(db): migration 140 — whatsapp_message_charges wamid/reservation correlation"
```

---

### Task 4: Migration 141 — overdraft-aware reservation RPC

**Files:**
- Create: `db/migrations/141_overdraft_reservation.sql`
- Create: `db/migrations/141_overdraft_reservation_rollback.sql`

**Interfaces:**
- Consumes: `reserve_ai_wallet_spend` / `settle_ai_wallet_spend` from `077_ai_wallets.sql`, and `ai_wallets.grace_overdraft_credits` from Task 2.
- Produces: `reserve_ai_wallet_spend(p_tenant_id UUID, p_amount_credits NUMERIC, p_request_id TEXT, p_provider TEXT, p_model TEXT, p_description TEXT, p_metadata JSONB, p_allow_overdraft_credits NUMERIC, p_meter TEXT)` and `settle_ai_wallet_spend(..., p_meter TEXT)`. Task 7 calls both by name.

- [ ] **Step 1: Write the migration**

`db/migrations/141_overdraft_reservation.sql`:

```sql
-- Migration 141: overdraft-aware wallet reservation with a meter dimension
-- The pre-141 reservation hard-fails on insufficient balance. Message sends
-- need a bounded grace overdraft so an empty wallet degrades loudly instead of
-- going silent mid-conversation.

-- The old signatures must be dropped explicitly. Leaving them in place creates
-- an overload that makes Supabase's named-parameter RPC resolution ambiguous at
-- runtime rather than at deploy time.
DROP FUNCTION IF EXISTS public.reserve_ai_wallet_spend(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.settle_ai_wallet_spend(UUID, UUID, NUMERIC, NUMERIC, BIGINT, TEXT, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.reserve_ai_wallet_spend(
  p_tenant_id UUID,
  p_amount_credits NUMERIC,
  p_request_id TEXT DEFAULT NULL,
  p_provider TEXT DEFAULT NULL,
  p_model TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_allow_overdraft_credits NUMERIC DEFAULT 0,
  p_meter TEXT DEFAULT 'llm'
)
RETURNS TABLE (
  allowed BOOLEAN,
  balance_credits NUMERIC,
  reservation_id UUID,
  reason TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  wallet public.ai_wallets;
  new_ledger_id UUID;
  overdraft NUMERIC;
BEGIN
  PERFORM public.ensure_ai_wallet(p_tenant_id);

  IF p_amount_credits IS NULL OR p_amount_credits <= 0 THEN
    RETURN QUERY SELECT false, NULL::NUMERIC, NULL::UUID, 'invalid_amount';
    RETURN;
  END IF;

  SELECT * INTO wallet
  FROM public.ai_wallets
  WHERE tenant_id = p_tenant_id
  FOR UPDATE;

  overdraft := LEAST(
    COALESCE(p_allow_overdraft_credits, 0),
    COALESCE(wallet.grace_overdraft_credits, 0)
  );

  IF wallet.balance_credits + overdraft < p_amount_credits THEN
    RETURN QUERY SELECT false, wallet.balance_credits, NULL::UUID, 'insufficient_balance';
    RETURN;
  END IF;

  UPDATE public.ai_wallets
  SET
    balance_credits = balance_credits - p_amount_credits,
    updated_at = NOW()
  WHERE tenant_id = p_tenant_id
  RETURNING * INTO wallet;

  INSERT INTO public.ai_wallet_ledger (
    tenant_id, kind, amount_credits, provider, model,
    request_id, description, metadata, meter
  )
  VALUES (
    p_tenant_id, 'reservation', -p_amount_credits, p_provider, p_model,
    p_request_id, COALESCE(p_description, 'AI spend reservation'),
    COALESCE(p_metadata, '{}'::jsonb), COALESCE(p_meter, 'llm')
  )
  RETURNING id INTO new_ledger_id;

  RETURN QUERY SELECT true, wallet.balance_credits, new_ledger_id,
    CASE WHEN wallet.balance_credits < 0 THEN 'reserved_grace' ELSE 'reserved' END;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_ai_wallet_spend(
  p_tenant_id UUID,
  p_reservation_id UUID,
  p_estimated_credits NUMERIC,
  p_actual_credits NUMERIC,
  p_tokens BIGINT DEFAULT NULL,
  p_provider TEXT DEFAULT NULL,
  p_model TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_meter TEXT DEFAULT 'llm'
)
RETURNS TABLE (
  allowed BOOLEAN,
  balance_credits NUMERIC,
  settlement_id UUID,
  refund_credits NUMERIC,
  extra_credits NUMERIC,
  reason TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  wallet public.ai_wallets;
  adjustment NUMERIC;
  new_ledger_id UUID;
BEGIN
  PERFORM public.ensure_ai_wallet(p_tenant_id);

  IF p_estimated_credits IS NULL OR p_actual_credits IS NULL THEN
    RETURN QUERY SELECT false, NULL::NUMERIC, NULL::UUID, 0::NUMERIC, 0::NUMERIC, 'invalid_amount';
    RETURN;
  END IF;

  SELECT * INTO wallet
  FROM public.ai_wallets
  WHERE tenant_id = p_tenant_id
  FOR UPDATE;

  adjustment := p_estimated_credits - p_actual_credits;

  IF adjustment < 0 AND wallet.balance_credits < ABS(adjustment) THEN
    RETURN QUERY SELECT false, wallet.balance_credits, NULL::UUID, 0::NUMERIC, ABS(adjustment), 'insufficient_balance_for_settlement';
    RETURN;
  END IF;

  UPDATE public.ai_wallets
  SET
    balance_credits = balance_credits + adjustment,
    lifetime_spent_credits = lifetime_spent_credits + p_actual_credits,
    updated_at = NOW()
  WHERE tenant_id = p_tenant_id
  RETURNING * INTO wallet;

  INSERT INTO public.ai_wallet_ledger (
    tenant_id, kind, amount_credits, token_count, provider, model,
    request_id, reference, description, metadata, meter
  )
  VALUES (
    p_tenant_id,
    CASE WHEN adjustment >= 0 THEN 'refund' ELSE 'usage' END,
    adjustment, p_tokens, p_provider, p_model, p_request_id,
    p_reservation_id::text, 'AI spend settlement',
    COALESCE(p_metadata, '{}'::jsonb), COALESCE(p_meter, 'llm')
  )
  RETURNING id INTO new_ledger_id;

  RETURN QUERY SELECT true, wallet.balance_credits, new_ledger_id,
    GREATEST(adjustment, 0), GREATEST(-adjustment, 0), 'settled';
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_ai_wallet_spend(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_ai_wallet_spend(UUID, UUID, NUMERIC, NUMERIC, BIGINT, TEXT, TEXT, TEXT, JSONB, TEXT) TO service_role;
```

Both new signatures default `p_allow_overdraft_credits = 0` and `p_meter = 'llm'`, so every existing caller in `src/lib/billing/ai-wallet.ts` keeps its current behaviour without modification.

- [ ] **Step 2: Write the rollback**

`db/migrations/141_overdraft_reservation_rollback.sql` drops the 9- and 10-argument forms and restores the originals verbatim from `077_ai_wallets.sql` (copy the `reserve_ai_wallet_spend` and `settle_ai_wallet_spend` bodies from lines 124-276 of that file, plus their two `GRANT` lines from 280-281).

```sql
-- Rollback for migration 141
DROP FUNCTION IF EXISTS public.reserve_ai_wallet_spend(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.settle_ai_wallet_spend(UUID, UUID, NUMERIC, NUMERIC, BIGINT, TEXT, TEXT, TEXT, JSONB, TEXT);
-- then re-create the 077 originals (verbatim copy of 077_ai_wallets.sql L124-281)
```

- [ ] **Step 3: Validate overdraft behaviour in the container**

```bash
psql "$MIG_URL" -v ON_ERROR_STOP=1 -f db/migrations/141_overdraft_reservation.sql
psql "$MIG_URL" -v ON_ERROR_STOP=1 -c "
  SELECT public.topup_ai_wallet('11111111-1111-1111-1111-111111111111'::uuid, 10);
  UPDATE public.ai_wallets SET grace_overdraft_credits = 50
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111';
"
# refused without overdraft
psql "$MIG_URL" -c "SELECT * FROM public.reserve_ai_wallet_spend(
  '11111111-1111-1111-1111-111111111111'::uuid, 30, NULL, 'meta', NULL, NULL, '{}'::jsonb, 0, 'whatsapp');"
# allowed with overdraft, balance goes negative
psql "$MIG_URL" -c "SELECT * FROM public.reserve_ai_wallet_spend(
  '11111111-1111-1111-1111-111111111111'::uuid, 30, NULL, 'meta', NULL, NULL, '{}'::jsonb, 50, 'whatsapp');"
# overdraft is clamped by the wallet's own grace ceiling
psql "$MIG_URL" -c "SELECT * FROM public.reserve_ai_wallet_spend(
  '11111111-1111-1111-1111-111111111111'::uuid, 9999, NULL, 'meta', NULL, NULL, '{}'::jsonb, 99999, 'whatsapp');"
```

Expected in order: `insufficient_balance`; `reserved` with `balance_credits = -20`; `insufficient_balance` (the caller cannot exceed the wallet's own ceiling by asking for more).

Confirm the ledger row carries the meter:

```bash
psql "$MIG_URL" -c "SELECT kind, amount_credits, meter FROM public.ai_wallet_ledger ORDER BY created_at DESC LIMIT 2;"
```

Expected: a `reservation` row with `meter = 'whatsapp'`.

Then tear down: `docker rm -f booka-mig-test`

- [ ] **Step 4: Commit**

```bash
git add db/migrations/141_overdraft_reservation.sql db/migrations/141_overdraft_reservation_rollback.sql
git commit -m "feat(db): migration 141 — overdraft-aware reservation with meter dimension"
```

---

### Task 5: Rate and mode resolution

**Files:**
- Create: `src/lib/billing/messageRates.ts`
- Test: `src/__tests__/lib/billing/messageRates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type MeteringMode = 'shadow' | 'live';
  export function getMeteringMode(): MeteringMode;
  export function isShadowMode(): boolean;
  export function resolveMessageCostCredits(): number;
  export function getMessageMarkup(): number;
  export function resolveMessageSellCredits(tenantRate?: number | null): number;
  export function getGraceOverdraftDefault(): number;
  export function getReconcileDriftPct(): number;
  ```
  Tasks 7, 8, 9 and 12 consume these.

- [ ] **Step 1: Write the failing test**

`src/__tests__/lib/billing/messageRates.test.ts`:

```ts
import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  getMeteringMode,
  isShadowMode,
  resolveMessageCostCredits,
  getMessageMarkup,
  resolveMessageSellCredits,
  getGraceOverdraftDefault,
  getReconcileDriftPct,
} from '@/lib/billing/messageRates';

describe('messageRates', () => {
  beforeEach(() => {
    delete process.env.BOOKA_MESSAGE_METERING_MODE;
    delete process.env.BOOKA_MESSAGE_RATE_CREDITS;
    delete process.env.BOOKA_MESSAGE_MARKUP;
    delete process.env.BOOKA_MESSAGE_GRACE_CREDITS;
    delete process.env.BOOKA_MESSAGE_RECONCILE_DRIFT_PCT;
  });

  it('defaults to shadow mode', () => {
    expect(getMeteringMode()).toBe('shadow');
    expect(isShadowMode()).toBe(true);
  });

  it('honours live mode', () => {
    process.env.BOOKA_MESSAGE_METERING_MODE = 'live';
    expect(getMeteringMode()).toBe('live');
    expect(isShadowMode()).toBe(false);
  });

  it('falls back to shadow for an unrecognised mode', () => {
    process.env.BOOKA_MESSAGE_METERING_MODE = 'banana';
    expect(getMeteringMode()).toBe('shadow');
  });

  it('uses the provisional cost when unset', () => {
    expect(resolveMessageCostCredits()).toBe(14);
  });

  it('reads the platform cost from env', () => {
    process.env.BOOKA_MESSAGE_RATE_CREDITS = '11.5';
    expect(resolveMessageCostCredits()).toBe(11.5);
  });

  it('ignores a non-numeric or non-positive platform cost', () => {
    process.env.BOOKA_MESSAGE_RATE_CREDITS = 'abc';
    expect(resolveMessageCostCredits()).toBe(14);
    process.env.BOOKA_MESSAGE_RATE_CREDITS = '0';
    expect(resolveMessageCostCredits()).toBe(14);
    process.env.BOOKA_MESSAGE_RATE_CREDITS = '-3';
    expect(resolveMessageCostCredits()).toBe(14);
  });

  it('defaults the markup to 1.6', () => {
    expect(getMessageMarkup()).toBe(1.6);
  });

  it('refuses a markup below 1 (would sell below cost)', () => {
    process.env.BOOKA_MESSAGE_MARKUP = '0.5';
    expect(getMessageMarkup()).toBe(1.6);
  });

  it('sells at cost times markup', () => {
    expect(resolveMessageSellCredits(null)).toBeCloseTo(22.4, 6);
  });

  it('prefers a per-tenant override over the computed sell rate', () => {
    expect(resolveMessageSellCredits(30)).toBe(30);
  });

  it('ignores a non-positive tenant override', () => {
    expect(resolveMessageSellCredits(0)).toBeCloseTo(22.4, 6);
    expect(resolveMessageSellCredits(-5)).toBeCloseTo(22.4, 6);
  });

  it('defaults grace and drift', () => {
    expect(getGraceOverdraftDefault()).toBe(100);
    expect(getReconcileDriftPct()).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/lib/billing/messageRates.test.ts`
Expected: FAIL — cannot resolve `@/lib/billing/messageRates`.

- [ ] **Step 3: Write the implementation**

`src/lib/billing/messageRates.ts`:

```ts
export type MeteringMode = 'shadow' | 'live';

/**
 * Provisional Nigerian service-message cost, in credits (1 credit = NGN 1).
 * Meta publishes confirmed country rates on 2026-09-01; update
 * BOOKA_MESSAGE_RATE_CREDITS then. This constant is the last resort only.
 */
const PROVISIONAL_COST_CREDITS = 14;
const DEFAULT_MARKUP = 1.6;
const DEFAULT_GRACE_CREDITS = 100;
const DEFAULT_DRIFT_PCT = 2;

function positiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getMeteringMode(): MeteringMode {
  return process.env.BOOKA_MESSAGE_METERING_MODE === 'live' ? 'live' : 'shadow';
}

export function isShadowMode(): boolean {
  return getMeteringMode() === 'shadow';
}

/** What Booka pays Meta per delivered message. */
export function resolveMessageCostCredits(): number {
  return positiveNumber(process.env.BOOKA_MESSAGE_RATE_CREDITS, PROVISIONAL_COST_CREDITS);
}

/** Resale multiplier covering FX drift, BSP and tax overhead, and margin. */
export function getMessageMarkup(): number {
  const parsed = Number(process.env.BOOKA_MESSAGE_MARKUP);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_MARKUP;
}

/** What the tenant is charged per delivered message. */
export function resolveMessageSellCredits(tenantRate?: number | null): number {
  if (typeof tenantRate === 'number' && Number.isFinite(tenantRate) && tenantRate > 0) {
    return tenantRate;
  }
  return resolveMessageCostCredits() * getMessageMarkup();
}

export function getGraceOverdraftDefault(): number {
  return positiveNumber(process.env.BOOKA_MESSAGE_GRACE_CREDITS, DEFAULT_GRACE_CREDITS);
}

export function getReconcileDriftPct(): number {
  return positiveNumber(process.env.BOOKA_MESSAGE_RECONCILE_DRIFT_PCT, DEFAULT_DRIFT_PCT);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/lib/billing/messageRates.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/billing/messageRates.ts src/__tests__/lib/billing/messageRates.test.ts
git commit -m "feat(billing): message rate, markup and metering mode resolution"
```

---

### Task 6: Signal cap-check errors instead of failing silently open

`checkCaps` currently swallows any error and returns `allowed: true` (`spendGuard.ts:156-165`). For LLM spend that is defensible. For Meta spend it means unbounded external cost on a transient DB error. Failing closed instead would silence every tenant's bot on the same error, so the resolution is to surface the degradation and let the message path route it into the bounded grace overdraft.

**Files:**
- Modify: `src/lib/billing/spendCaps/spendGuard.ts:4-10` (interface), `:149-165` (both return sites)
- Test: `src/__tests__/lib/billing/spendCaps/spendGuard.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: `CapDecision.degraded: boolean` — `true` only when the check itself errored. Task 7 reads it.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/lib/billing/spendCaps/spendGuard.test.ts`, reusing the existing `pushDb` / `pushErr` / `admin` harness already defined at the top of that file:

```ts
  it('marks the decision degraded when the check throws', async () => {
    pushErr();
    const d = await checkCaps(admin as unknown as Parameters<typeof checkCaps>[0], 't1');
    expect(d.allowed).toBe(true);
    expect(d.degraded).toBe(true);
  });

  it('marks a healthy decision as not degraded', async () => {
    pushDb({ daily_budget_credits: 2000, velocity_credits_override: null });
    pushDb({ timezone: 'UTC' });
    pushDb([{ amount_credits: -10 }]);
    pushDb([{ amount_credits: -50 }]);
    const d = await checkCaps(admin as unknown as Parameters<typeof checkCaps>[0], 't1');
    expect(d.degraded).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/lib/billing/spendCaps/spendGuard.test.ts`
Expected: FAIL — `expected true, received undefined` on `d.degraded`.

- [ ] **Step 3: Write the implementation**

In `src/lib/billing/spendCaps/spendGuard.ts`, add to the interface:

```ts
export interface CapDecision {
  allowed: boolean;
  reason: 'ok' | 'velocity_cap' | 'daily_cap';
  softWarn: boolean;
  spentTodayCredits: number;
  dailyBudgetCredits: number;
  /**
   * True when the cap check itself failed and the result is a fail-open guess.
   * LLM spend ignores this; message spend routes it into the grace overdraft so
   * fail-open stays bounded.
   */
  degraded: boolean;
}
```

Add `degraded: false` to all three `return` objects inside `try` (the velocity block, the daily block, and the success block), and `degraded: true` to the object in the `catch`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/billing/spendCaps/`
Expected: PASS, including all pre-existing cases.

- [ ] **Step 5: Typecheck and commit**

TypeScript will flag every other construction of a `CapDecision` literal. Fix each by adding `degraded: false`.

```bash
npm run typecheck
git add src/lib/billing/spendCaps/spendGuard.ts src/__tests__/lib/billing/spendCaps/spendGuard.test.ts
git commit -m "feat(billing): surface degraded cap checks so fail-open can be bounded"
```

---

### Task 7: The message wallet — reserve, attach, settle, release

The core of the feature.

**Files:**
- Create: `src/lib/billing/messageWallet.ts`
- Test: `src/__tests__/lib/billing/messageWallet.test.ts`

**Interfaces:**
- Consumes: `resolveMessageSellCredits`, `isShadowMode`, `getGraceOverdraftDefault` (Task 5); `checkCaps` and `CapDecision.degraded` (Task 6); RPCs `reserve_ai_wallet_spend` / `settle_ai_wallet_spend` (Task 4); table `whatsapp_message_charges` (Task 3).
- Produces:
  ```ts
  export type ReserveMode = 'paid' | 'grace' | 'free' | 'shadow';
  export type MessageKind = 'freeform' | 'template' | 'interactive' | 'media';

  export interface ReserveOutboundParams {
    admin: SupabaseClient;
    tenantId: string;
    provider: string;
    messageKind: MessageKind;
    attribution?: Record<string, unknown>;
  }
  export type ReserveOutboundResult =
    // chargeId is null when no charge row exists to correlate: the internal-error
    // fallback below. Callers must null-check before calling attachWamid.
    | { allow: true; chargeId: string | null; mode: ReserveMode }
    | { allow: false; reason: 'handoff' };

  export function reserveOutboundMessage(p: ReserveOutboundParams): Promise<ReserveOutboundResult>;
  export function attachWamid(admin: SupabaseClient, chargeId: string, wamid: string): Promise<void>;
  export function abandonCharge(admin: SupabaseClient, chargeId: string): Promise<void>;

  export interface SettleOutboundParams {
    admin: SupabaseClient;
    tenantId: string;
    wamid: string;
    deliveryStatus: 'sent' | 'delivered' | 'read' | 'failed';
    pricing?: {
      billable?: boolean;
      category?: string;
      type?: string;
      pricing_model?: string;
    };
  }
  export function settleOutboundMessage(p: SettleOutboundParams): Promise<void>;
  export function releaseStaleReservations(
    admin: SupabaseClient,
    olderThanMs: number,
  ): Promise<{ released: number }>;
  ```
  Tasks 9, 10 and 11 consume these.

**Behaviour to implement:**

`reserveOutboundMessage`:
1. Provider is not `meta` → insert a charge row with `reserved_credits: 0`, `status: 'reserved'`, no wallet reservation. Return `{ allow: true, mode: 'free' }`. Recorded, not charged — this is what makes Meta-vs-WAHA economics comparable per tenant.
2. Shadow mode → insert a charge row with `mode: 'shadow'`, `reserved_credits: 0`, no wallet reservation. Return `{ allow: true, mode: 'shadow' }`. **Never gates.**
3. Live + Meta → read `ai_wallets.message_rate_credits`; compute `sell = resolveMessageSellCredits(rate)`.
4. `checkCaps`. If `!allowed` → `{ allow: false, reason: 'handoff' }`. If `degraded` → set `allowOverdraft` for the reservation below (fail-open, but bounded).
5. Call `reserve_ai_wallet_spend` with `p_meter: 'whatsapp'`, `p_provider: 'meta'`, `p_allow_overdraft_credits: 0` (or the grace amount when `degraded`).
6. On `insufficient_balance`: if `auto_recharge_enabled`, attempt the Paystack charge, then retry the reserve **once**. If that fails or is disabled, retry with `p_allow_overdraft_credits = grace_overdraft_credits` and return `mode: 'grace'`. If still refused → `{ allow: false, reason: 'handoff' }`.
7. On success insert the charge row with `wallet_reservation_id` and `reserved_credits = sell`, return `{ allow: true, chargeId, mode }`.

`attachWamid` handles a real race: Meta's status webhook can arrive before the post-send `UPDATE` lands. If the `UPDATE ... SET wamid` hits `uq_whatsapp_message_charges_tenant_wamid` (Postgres `23505`), an orphan row created by settlement already holds that wamid. Merge it: copy the orphan's `billable` / `pricing_*` / `delivery_status` onto the reserved row, delete the orphan, and mark the row `settled`.

**The merge must also settle the wallet reservation.** The orphan was created by the no-row branch of `settleOutboundMessage`, which had no reservation id and therefore wrote `settled_credits: 0` without calling the settle RPC. The reserved row *does* carry a `wallet_reservation_id`, and `reserve_ai_wallet_spend` has already debited the balance. So the merge must call `settle_ai_wallet_spend` with `p_estimated_credits = reserved_credits`, `p_actual_credits = orphan.billable ? reserved_credits : 0`, and `p_meter: 'whatsapp'`, then write that actual value to `settled_credits` — **never copy the orphan's hardcoded `0`.** Copying it strands the debit permanently: the row becomes terminal so the sweeper can never rescue it, the tenant is down the reserved amount, and Booka's own books record a charge of zero.

Ordering: the unique index means the orphan must be deleted before the reserved row can take its wamid, so both statements' errors must be checked — a failure between them loses the orphan's pricing data irrecoverably, and Meta will not re-send the status. Do this in a single transaction or a dedicated RPC, not two unguarded client round-trips.

`settleOutboundMessage`:
- `sent` → update `delivery_status` only, no settlement.
- `failed` → settle the reservation at 0, set `status: 'released'`.
- `delivered`, or `read` when `delivered` was missed → settle at `pricing.billable ? reserved_credits : 0`, set `status: 'settled'`, stamp `settled_at` and all `pricing_*` columns.
- Row already `settled` or `released` → no-op (replay safety).
- Row has no `wallet_reservation_id` (free provider or shadow mode) → record
  `delivery_status`, `billable` and the `pricing_*` columns, set `settled_credits: 0` and
  `status: 'settled'`, and **do not call the settle RPC** — there is no reservation to
  release. This is the path that collects shadow-mode data, so it must not be skipped.
- No row found → insert an orphan charge row carrying the pricing data so `attachWamid` can merge it.

`releaseStaleReservations`: select
`status = 'reserved' AND wamid IS NOT NULL AND wallet_reservation_id IS NOT NULL AND sent_at < now - olderThanMs`,
settle each at 0, set `status: 'released'`, return the count.

**The `wallet_reservation_id IS NOT NULL` filter is load-bearing.** Free-provider and
shadow-mode rows are written with `status: 'reserved'` and no wallet reservation. Without
this filter the sweeper would pick them up every 15 minutes forever, call
`settle_ai_wallet_spend` with a null reservation, and report a permanently climbing
`released` count — which is also the signal used to detect a broken webhook, so the
alert would be useless.

- [ ] **Step 1: Write the failing tests**

`src/__tests__/lib/billing/messageWallet.test.ts`. Use the queue-based Supabase mock pattern from `src/__tests__/lib/billing/spendCaps/spendGuard.test.ts` (copy the `Resp` / `pushDb` / `pushErr` / `makeChain` scaffolding), extended with:

- `pushRpc(rows)` — queues the next `admin.rpc()` result, and `rpcCalls: Array<{ name: string; args: Record<string, unknown> }>` recording every RPC call in order.
- `inserts: Array<{ table: string; row: Record<string, unknown> }>` and `updates: Array<{ table: string; row: Record<string, unknown> }>` recording writes.

Assert on those three arrays only. Do not build query-filter introspection into the
harness — assert filtering behaviourally, through what the code does with the rows the
mock returns.

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  reserveOutboundMessage,
  settleOutboundMessage,
  releaseStaleReservations,
} from '@/lib/billing/messageWallet';

jest.mock('@/lib/billing/spendCaps/spendGuard', () => ({
  checkCaps: jest.fn(),
}));
import { checkCaps } from '@/lib/billing/spendCaps/spendGuard';

// ...queue-based mock admin client, see spendGuard.test.ts for the pattern...

describe('reserveOutboundMessage', () => {
  beforeEach(() => {
    process.env.BOOKA_MESSAGE_METERING_MODE = 'live';
    process.env.BOOKA_MESSAGE_RATE_CREDITS = '14';
    process.env.BOOKA_MESSAGE_MARKUP = '1.6';
    jest.clearAllMocks();
  });

  it('records a non-meta send for free without touching the wallet', async () => {
    const r = await reserveOutboundMessage({
      admin, tenantId: 't1', provider: 'waha', messageKind: 'freeform',
    });
    expect(r).toMatchObject({ allow: true, mode: 'free' });
    expect(rpcCalls).toHaveLength(0);
  });

  it('never gates in shadow mode even with an empty wallet', async () => {
    process.env.BOOKA_MESSAGE_METERING_MODE = 'shadow';
    const r = await reserveOutboundMessage({
      admin, tenantId: 't1', provider: 'meta', messageKind: 'freeform',
    });
    expect(r).toMatchObject({ allow: true, mode: 'shadow' });
    expect(rpcCalls).toHaveLength(0);
  });

  it('reserves the sell rate, not the cost rate', async () => {
    (checkCaps as jest.Mock).mockResolvedValue({ allowed: true, degraded: false });
    pushDb({ message_rate_credits: null, grace_overdraft_credits: 100,
             auto_recharge_enabled: false });
    pushRpc([{ allowed: true, balance_credits: 500, reservation_id: 'res-1', reason: 'reserved' }]);
    pushDb({ id: 'charge-1' });
    const r = await reserveOutboundMessage({
      admin, tenantId: 't1', provider: 'meta', messageKind: 'freeform',
    });
    expect(r).toMatchObject({ allow: true, mode: 'paid' });
    expect(rpcCalls[0].args.p_amount_credits).toBeCloseTo(22.4, 6);
    expect(rpcCalls[0].args.p_meter).toBe('whatsapp');
  });

  it('hands off when a spend cap refuses', async () => {
    (checkCaps as jest.Mock).mockResolvedValue({ allowed: false, reason: 'daily_cap', degraded: false });
    const r = await reserveOutboundMessage({
      admin, tenantId: 't1', provider: 'meta', messageKind: 'freeform',
    });
    expect(r).toEqual({ allow: false, reason: 'handoff' });
  });

  it('routes a degraded cap check into the bounded grace overdraft', async () => {
    (checkCaps as jest.Mock).mockResolvedValue({ allowed: true, degraded: true });
    pushDb({ message_rate_credits: null, grace_overdraft_credits: 100,
             auto_recharge_enabled: false });
    pushRpc([{ allowed: true, balance_credits: -10, reservation_id: 'res-1', reason: 'reserved_grace' }]);
    pushDb({ id: 'charge-1' });
    const r = await reserveOutboundMessage({
      admin, tenantId: 't1', provider: 'meta', messageKind: 'freeform',
    });
    expect(r).toMatchObject({ allow: true });
    expect(rpcCalls[0].args.p_allow_overdraft_credits).toBe(100);
  });

  it('falls back to grace when the balance is short and auto-recharge is off', async () => {
    (checkCaps as jest.Mock).mockResolvedValue({ allowed: true, degraded: false });
    pushDb({ message_rate_credits: null, grace_overdraft_credits: 100,
             auto_recharge_enabled: false });
    pushRpc([{ allowed: false, balance_credits: 1, reservation_id: null, reason: 'insufficient_balance' }]);
    pushRpc([{ allowed: true, balance_credits: -21, reservation_id: 'res-2', reason: 'reserved_grace' }]);
    pushDb({ id: 'charge-2' });
    const r = await reserveOutboundMessage({
      admin, tenantId: 't1', provider: 'meta', messageKind: 'freeform',
    });
    expect(r).toMatchObject({ allow: true, mode: 'grace' });
  });

  it('hands off when grace is also exhausted', async () => {
    (checkCaps as jest.Mock).mockResolvedValue({ allowed: true, degraded: false });
    pushDb({ message_rate_credits: null, grace_overdraft_credits: 0,
             auto_recharge_enabled: false });
    pushRpc([{ allowed: false, balance_credits: 0, reservation_id: null, reason: 'insufficient_balance' }]);
    pushRpc([{ allowed: false, balance_credits: 0, reservation_id: null, reason: 'insufficient_balance' }]);
    const r = await reserveOutboundMessage({
      admin, tenantId: 't1', provider: 'meta', messageKind: 'freeform',
    });
    expect(r).toEqual({ allow: false, reason: 'handoff' });
  });
});

describe('settleOutboundMessage', () => {
  it('does not settle on sent', async () => {
    pushDb({ id: 'c1', status: 'reserved', reserved_credits: 22.4,
             wallet_reservation_id: 'res-1' });
    await settleOutboundMessage({
      admin, tenantId: 't1', wamid: 'wamid.A', deliveryStatus: 'sent',
    });
    expect(rpcCalls).toHaveLength(0);
  });

  it('charges the reserved amount when Meta says billable', async () => {
    pushDb({ id: 'c1', status: 'reserved', reserved_credits: 22.4,
             wallet_reservation_id: 'res-1' });
    pushRpc([{ allowed: true, balance_credits: 0, settlement_id: 's1' }]);
    await settleOutboundMessage({
      admin, tenantId: 't1', wamid: 'wamid.A', deliveryStatus: 'delivered',
      pricing: { billable: true, category: 'service', type: 'paid', pricing_model: 'PMP' },
    });
    expect(rpcCalls[0].args.p_actual_credits).toBeCloseTo(22.4, 6);
  });

  it('refunds in full when Meta says not billable', async () => {
    pushDb({ id: 'c1', status: 'reserved', reserved_credits: 22.4,
             wallet_reservation_id: 'res-1' });
    pushRpc([{ allowed: true, balance_credits: 22.4, settlement_id: 's1' }]);
    await settleOutboundMessage({
      admin, tenantId: 't1', wamid: 'wamid.A', deliveryStatus: 'delivered',
      pricing: { billable: false, category: 'service', type: 'free_customer_service' },
    });
    expect(rpcCalls[0].args.p_actual_credits).toBe(0);
  });

  it('refunds in full on failed delivery', async () => {
    pushDb({ id: 'c1', status: 'reserved', reserved_credits: 22.4,
             wallet_reservation_id: 'res-1' });
    pushRpc([{ allowed: true, balance_credits: 22.4, settlement_id: 's1' }]);
    await settleOutboundMessage({
      admin, tenantId: 't1', wamid: 'wamid.A', deliveryStatus: 'failed',
    });
    expect(rpcCalls[0].args.p_actual_credits).toBe(0);
  });

  it('is a no-op on a replayed delivered', async () => {
    pushDb({ id: 'c1', status: 'settled', reserved_credits: 22.4,
             wallet_reservation_id: 'res-1' });
    await settleOutboundMessage({
      admin, tenantId: 't1', wamid: 'wamid.A', deliveryStatus: 'delivered',
      pricing: { billable: true },
    });
    expect(rpcCalls).toHaveLength(0);
  });

  it('records an orphan row when the charge has no wamid yet', async () => {
    pushDb(null);
    pushDb({ id: 'orphan-1' });
    await settleOutboundMessage({
      admin, tenantId: 't1', wamid: 'wamid.RACE', deliveryStatus: 'delivered',
      pricing: { billable: true },
    });
    expect(inserts[0].table).toBe('whatsapp_message_charges');
    expect(inserts[0].row).toMatchObject({ wamid: 'wamid.RACE', billable: true });
  });
});

describe('settleOutboundMessage — unmetered rows', () => {
  it('records pricing for a shadow row without calling the settle RPC', async () => {
    pushDb({ id: 'c1', status: 'reserved', reserved_credits: 0,
             wallet_reservation_id: null });
    pushDb({ id: 'c1' });
    await settleOutboundMessage({
      admin, tenantId: 't1', wamid: 'wamid.S', deliveryStatus: 'delivered',
      pricing: { billable: false, category: 'service', type: 'free_customer_service' },
    });
    expect(rpcCalls).toHaveLength(0);
    expect(updates[0].row).toMatchObject({
      status: 'settled', settled_credits: 0, billable: false, pricing_category: 'service',
    });
  });
});

describe('releaseStaleReservations', () => {
  it('settles nothing when the sweep returns no metered rows', async () => {
    // The query filters wallet_reservation_id IS NOT NULL, so free-provider and
    // shadow rows never reach this code path — the mock returns the empty set the
    // real query would.
    pushDb([]);
    const r = await releaseStaleReservations(admin, 24 * 60 * 60 * 1000);
    expect(r.released).toBe(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it('skips any row that somehow arrives without a reservation id', async () => {
    pushDb([
      { id: 'c1', tenant_id: 't1', reserved_credits: 22.4, wallet_reservation_id: null },
      { id: 'c2', tenant_id: 't1', reserved_credits: 22.4, wallet_reservation_id: 'res-2' },
    ]);
    pushRpc([{ allowed: true, balance_credits: 22.4, settlement_id: 's2' }]);
    const r = await releaseStaleReservations(admin, 24 * 60 * 60 * 1000);
    expect(r.released).toBe(1);
    expect(rpcCalls).toHaveLength(1);
  });

  it('releases each stale reservation at zero cost exactly once', async () => {
    pushDb([
      { id: 'c1', tenant_id: 't1', reserved_credits: 22.4, wallet_reservation_id: 'res-1' },
      { id: 'c2', tenant_id: 't1', reserved_credits: 22.4, wallet_reservation_id: 'res-2' },
    ]);
    pushRpc([{ allowed: true, balance_credits: 22.4, settlement_id: 's1' }]);
    pushRpc([{ allowed: true, balance_credits: 44.8, settlement_id: 's2' }]);
    const r = await releaseStaleReservations(admin, 24 * 60 * 60 * 1000);
    expect(r.released).toBe(2);
    expect(rpcCalls.every((c) => c.args.p_actual_credits === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/billing/messageWallet.test.ts`
Expected: FAIL — cannot resolve `@/lib/billing/messageWallet`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/billing/messageWallet.ts` implementing the exported signatures under **Interfaces** and the behaviour under **Behaviour to implement**. Follow the shape of `withTenantWalletSpend` in `src/lib/billing/ai-wallet.ts` for RPC invocation and error handling — same `admin.rpc(name, args)` style, same defensive `Number(...)` coercion of numeric columns, which arrive from PostgREST as strings.

Key requirements:
- Every wallet RPC call passes `p_meter: 'whatsapp'`.
- `reserveOutboundMessage` must never throw. Wrap the whole body; on an unexpected error, log and return `{ allow: true, chargeId: null, mode: 'grace' }` — an internal metering bug must not take the bot offline. `chargeId: null` is what tells the decorator there is nothing to correlate or settle, so the send proceeds unbilled rather than billed-and-stuck.
- `attachWamid` catches Postgres `23505` and performs the orphan merge described above.
- Do not add `@ts-nocheck`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/billing/messageWallet.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/billing/messageWallet.ts src/__tests__/lib/billing/messageWallet.test.ts
git commit -m "feat(billing): message wallet reserve/settle/release with grace overdraft"
```

---

### Task 8: Wallet-exhausted handoff

The handoff message costs money, and by definition the wallet is empty when it fires. It must bypass the meter against a platform-funded allowance and must fire once per conversation — otherwise every subsequent inbound message triggers another handoff, and the failure mode becomes a loop instead of a wall.

**Files:**
- Create: `src/lib/billing/messageHandoff.ts`
- Test: `src/__tests__/lib/billing/messageHandoff.test.ts`
- Modify: `src/lib/whatsapp/providers/providerSelection.ts:76-82`

**Interfaces:**
- Consumes: `chats.metadata`.
- Produces (in `providerSelection.ts`, extracted here because this task is its first consumer):
  ```ts
  export async function getTenantWhatsAppProviderClientUnmetered(
    tenantId: string,
  ): Promise<WhatsAppProviderClient | null>;
  ```
  Task 9 wraps this to build the metered client.
- Produces:
  ```ts
  export function triggerWalletHandoff(
    admin: SupabaseClient,
    tenantId: string,
    toNumber: string,
  ): Promise<{ sent: boolean; reason: 'sent' | 'already_handed_off' | 'no_provider' }>;
  ```
  Task 9 calls this.

**Behaviour:** look up the `chats` row for `(tenant_id, customer_phone = toNumber)`. If `metadata->>'wallet_handoff_at'` is set, return `already_handed_off` without sending. Otherwise send one message via the **unmetered** client, stamp `metadata.wallet_handoff_at`, and write an urgent owner alert. Clear the stamp on the next successful metered send so a recharged tenant can hand off again later.

**Recursion hazard — read before implementing.** `triggerWalletHandoff` must use the unmetered client. Using the metered client re-enters `reserveOutboundMessage`, which fails again and calls `triggerWalletHandoff` again. Add a code comment saying so.

- [ ] **Step 1: Write the failing test**

`src/__tests__/lib/billing/messageHandoff.test.ts`. Reuse the same queue-based Supabase
mock scaffolding as Task 7 (`Resp` / `pushDb` / `pushErr` / `makeChain` / `admin`, copied
from `src/__tests__/lib/billing/spendCaps/spendGuard.test.ts`) — the snippet below assumes
`admin` and `pushDb` are already in scope:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const sendTextMessage = jest.fn();
jest.mock('@/lib/whatsapp/providers/providerSelection', () => ({
  getTenantWhatsAppProviderClientUnmetered: jest.fn(async () => ({ sendTextMessage })),
}));

import { triggerWalletHandoff } from '@/lib/billing/messageHandoff';

describe('triggerWalletHandoff', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('sends once and stamps the conversation', async () => {
    pushDb({ id: 'chat-1', metadata: {} });
    sendTextMessage.mockResolvedValue({ success: true, messageId: 'wamid.H' });
    pushDb({ id: 'chat-1' });
    const r = await triggerWalletHandoff(admin, 't1', '2348012345678');
    expect(r).toEqual({ sent: true, reason: 'sent' });
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
  });

  it('does not send twice for the same conversation', async () => {
    pushDb({ id: 'chat-1', metadata: { wallet_handoff_at: '2026-10-01T00:00:00Z' } });
    const r = await triggerWalletHandoff(admin, 't1', '2348012345678');
    expect(r).toEqual({ sent: false, reason: 'already_handed_off' });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('reports no_provider rather than throwing', async () => {
    const mod = jest.requireMock('@/lib/whatsapp/providers/providerSelection') as {
      getTenantWhatsAppProviderClientUnmetered: jest.Mock;
    };
    mod.getTenantWhatsAppProviderClientUnmetered.mockResolvedValueOnce(null);
    pushDb({ id: 'chat-1', metadata: {} });
    const r = await triggerWalletHandoff(admin, 't1', '2348012345678');
    expect(r).toEqual({ sent: false, reason: 'no_provider' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/lib/billing/messageHandoff.test.ts`
Expected: FAIL — cannot resolve `@/lib/billing/messageHandoff`.

- [ ] **Step 3: Write the implementation**

First, in `src/lib/whatsapp/providers/providerSelection.ts`, rename the existing
`getTenantWhatsAppProviderClient` body to `getTenantWhatsAppProviderClientUnmetered` and
have `getTenantWhatsAppProviderClient` delegate to it. Pure extraction — no behaviour change
yet; Task 9 adds the wrapping.

```ts
/**
 * Unmetered tenant client. Only two callers are legitimate:
 *   - the wallet-exhausted handoff (metering it would recurse), and
 *   - internal diagnostics.
 * Everything customer-facing must go through getTenantChannelProviderClient.
 */
export async function getTenantWhatsAppProviderClientUnmetered(
  tenantId: string,
): Promise<WhatsAppProviderClient | null> {
  const config = await getTenantWhatsAppConfig(tenantId);
  if (!config) return null;
  if (config.provider === 'waha') return new WahaAdapter(config);
  if (config.provider === 'meta') return new MetaAdapter(config);
  return new EvolutionAdapter(config);
}

export async function getTenantWhatsAppProviderClient(
  tenantId: string,
): Promise<WhatsAppProviderClient | null> {
  return getTenantWhatsAppProviderClientUnmetered(tenantId);
}
```

Then create `src/lib/billing/messageHandoff.ts` per the signature and behaviour above. Message copy:

```ts
const HANDOFF_TEXT =
  'Thanks for your message. Our automated assistant is briefly unavailable, '
  + 'so a member of our team will reply to you here shortly.';
```

Do not mention wallets, credits or billing to the customer — the tenant's payment state is not the customer's business.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/lib/billing/messageHandoff.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/billing/messageHandoff.ts src/lib/whatsapp/providers/providerSelection.ts src/__tests__/lib/billing/messageHandoff.test.ts
git commit -m "feat(billing): once-per-conversation wallet-exhausted handoff"
```

---

### Task 9: The metering decorator and provider wiring

**Files:**
- Create: `src/lib/whatsapp/providers/metered.ts`
- Modify: `src/lib/whatsapp/providers/types.ts:99-104` (add `tenantId?`)
- Modify: `src/lib/whatsapp/providers/providerSelection.ts:76-115`
- Test: `src/__tests__/lib/whatsapp/providers/metered.test.ts`

**Interfaces:**
- Consumes: `reserveOutboundMessage`, `attachWamid`, `abandonCharge` (Task 7); `triggerWalletHandoff` (Task 8); `getTenantWhatsAppProviderClientUnmetered` (Task 8).
- Produces:
  ```ts
  export function withMetering(
    client: WhatsAppProviderClient,
    opts: { tenantId: string; provider: string },
  ): WhatsAppProviderClient;
  ```

**Behaviour per wrapped send:** reserve → if refused, fire the handoff and return `{ success: false }` → call the underlying send → on `success: false` call `abandonCharge` → on `success: true` with a `messageId` call `attachWamid`. Non-send methods (`createInstance`, `getConnectionStatus`, `getQrCode`, `requestPairingCode`, `deleteInstance`) pass straight through.

`withMetering` takes no Supabase client in `opts`. It obtains one itself via
`createSupabaseAdminClient()` from `@/lib/supabase/server`, called lazily inside each
wrapped method rather than at decoration time — `getTenantChannelProviderClient` is called
on request paths where a module-scope client would be constructed needlessly.

**Null-check `chargeId` before `attachWamid` and `abandonCharge`.** A reservation can
succeed with `chargeId: null` (the internal-error fallback in Task 7); calling either
helper with null must be skipped, not passed through.

- [ ] **Step 1: Write the failing test**

`src/__tests__/lib/whatsapp/providers/metered.test.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const reserveOutboundMessage = jest.fn();
const attachWamid = jest.fn();
const abandonCharge = jest.fn();
const triggerWalletHandoff = jest.fn();

jest.mock('@/lib/billing/messageWallet', () => ({
  reserveOutboundMessage, attachWamid, abandonCharge,
}));
jest.mock('@/lib/billing/messageHandoff', () => ({ triggerWalletHandoff }));

import { withMetering } from '@/lib/whatsapp/providers/metered';

function makeInner(result: { success: boolean; messageId?: string }) {
  return {
    sendTextMessage: jest.fn(async () => result),
    sendTemplateMessage: jest.fn(async () => result),
    sendMediaMessage: jest.fn(async () => result),
    sendInteractiveMessage: jest.fn(async () => result),
    createInstance: jest.fn(async () => ({ status: 'configured' })),
    getConnectionStatus: jest.fn(async () => ({ connected: true })),
    getQrCode: jest.fn(async () => null),
    requestPairingCode: jest.fn(async () => null),
    deleteInstance: jest.fn(async () => undefined),
  };
}

describe('withMetering', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('attaches the wamid after a successful send', async () => {
    reserveOutboundMessage.mockResolvedValue({ allow: true, chargeId: 'c1', mode: 'paid' });
    const inner = makeInner({ success: true, messageId: 'wamid.A' });
    const client = withMetering(inner as never, { tenantId: 't1', provider: 'meta' });
    const r = await client.sendTextMessage('2348012345678', 'hi');
    expect(r).toMatchObject({ success: true, messageId: 'wamid.A' });
    expect(attachWamid).toHaveBeenCalledWith(expect.anything(), 'c1', 'wamid.A');
    expect(abandonCharge).not.toHaveBeenCalled();
  });

  it('abandons the charge when the send fails', async () => {
    reserveOutboundMessage.mockResolvedValue({ allow: true, chargeId: 'c1', mode: 'paid' });
    const inner = makeInner({ success: false });
    const client = withMetering(inner as never, { tenantId: 't1', provider: 'meta' });
    const r = await client.sendTextMessage('2348012345678', 'hi');
    expect(r.success).toBe(false);
    expect(abandonCharge).toHaveBeenCalledWith(expect.anything(), 'c1');
    expect(attachWamid).not.toHaveBeenCalled();
  });

  it('hands off and does not send when the reservation is refused', async () => {
    reserveOutboundMessage.mockResolvedValue({ allow: false, reason: 'handoff' });
    const inner = makeInner({ success: true, messageId: 'wamid.A' });
    const client = withMetering(inner as never, { tenantId: 't1', provider: 'meta' });
    const r = await client.sendTextMessage('2348012345678', 'hi');
    expect(r.success).toBe(false);
    expect(inner.sendTextMessage).not.toHaveBeenCalled();
    expect(triggerWalletHandoff).toHaveBeenCalledWith(expect.anything(), 't1', '2348012345678');
  });

  it('meters all four send methods with the right message kind', async () => {
    reserveOutboundMessage.mockResolvedValue({ allow: true, chargeId: 'c1', mode: 'paid' });
    const inner = makeInner({ success: true, messageId: 'wamid.A' });
    const client = withMetering(inner as never, { tenantId: 't1', provider: 'meta' });
    await client.sendTextMessage('234', 'hi');
    await client.sendTemplateMessage('234', 'tpl');
    await client.sendMediaMessage('234', { url: 'u', mimetype: 'image/png' });
    await client.sendInteractiveMessage('234', { type: 'button' } as never);
    expect(reserveOutboundMessage).toHaveBeenCalledTimes(4);
    expect(reserveOutboundMessage.mock.calls.map((c) => (c[0] as { messageKind: string }).messageKind))
      .toEqual(['freeform', 'template', 'media', 'interactive']);
  });

  it('passes non-send methods straight through without metering', async () => {
    const inner = makeInner({ success: true, messageId: 'wamid.A' });
    const client = withMetering(inner as never, { tenantId: 't1', provider: 'meta' });
    await client.getConnectionStatus();
    expect(inner.getConnectionStatus).toHaveBeenCalled();
    expect(reserveOutboundMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/lib/whatsapp/providers/metered.test.ts`
Expected: FAIL — cannot resolve `@/lib/whatsapp/providers/metered`.

- [ ] **Step 3: Write the implementation and wire it up**

Create `src/lib/whatsapp/providers/metered.ts` implementing `withMetering` per the behaviour above.

Add `tenantId?: string;` to `ProviderConfig` in `src/lib/whatsapp/providers/types.ts`.

In `src/lib/whatsapp/providers/providerSelection.ts`, make the delegating
`getTenantWhatsAppProviderClient` from Task 8 apply the decorator:

```ts
export async function getTenantWhatsAppProviderClient(
  tenantId: string,
): Promise<WhatsAppProviderClient | null> {
  const config = await getTenantWhatsAppConfig(tenantId);
  if (!config) return null;
  const client = await getTenantWhatsAppProviderClientUnmetered(tenantId);
  if (!client) return null;
  return withMetering(client, { tenantId, provider: config.provider ?? 'evolution' });
}
```

Apply the same wrapping to the Instagram branch of `getTenantChannelProviderClient`.

Leave `getDefaultWhatsAppProviderClient()` unmetered and add:

```ts
// Platform-level sends have no tenant to bill, so they are deliberately
// unmetered. Do not "fix" this by inventing a tenant id.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/whatsapp/providers/`
Expected: PASS (5 new tests plus any existing provider tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/whatsapp/providers/metered.ts src/lib/whatsapp/providers/types.ts src/lib/whatsapp/providers/providerSelection.ts src/__tests__/lib/whatsapp/providers/metered.test.ts
git commit -m "feat(whatsapp): meter every tenant outbound send via a provider decorator"
```

---

### Task 10: Settlement in the status webhook

**Files:**
- Modify: `src/app/api/webhooks/whatsapp/meta/route.ts:171-179` (statuses loop)
- Test: `src/__tests__/api/webhooks/meta-status-settlement.test.ts`

**Interfaces:**
- Consumes: `settleOutboundMessage` (Task 7), `buildStatusIdempotencyKey` and the widened `statuses` type (Task 1).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

`src/__tests__/api/webhooks/meta-status-settlement.test.ts` asserts a pure extracted helper, so the test does not need to boot the route:

```ts
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const settleOutboundMessage = jest.fn();
jest.mock('@/lib/billing/messageWallet', () => ({ settleOutboundMessage }));

import { settleStatusEvent } from '@/app/api/webhooks/whatsapp/meta/route';

const admin = {} as never;

describe('settleStatusEvent', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('forwards Meta pricing verbatim on delivered', async () => {
    await settleStatusEvent(admin, 't1', {
      id: 'wamid.A',
      status: 'delivered',
      pricing: { billable: true, pricing_model: 'PMP', category: 'service', type: 'paid' },
    });
    expect(settleOutboundMessage).toHaveBeenCalledWith({
      admin, tenantId: 't1', wamid: 'wamid.A', deliveryStatus: 'delivered',
      pricing: { billable: true, pricing_model: 'PMP', category: 'service', type: 'paid' },
    });
  });

  it('forwards failed with no pricing', async () => {
    await settleStatusEvent(admin, 't1', { id: 'wamid.A', status: 'failed' });
    expect(settleOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryStatus: 'failed', pricing: undefined }),
    );
  });

  it('ignores a status with no id', async () => {
    await settleStatusEvent(admin, 't1', { status: 'delivered' });
    expect(settleOutboundMessage).not.toHaveBeenCalled();
  });

  it('ignores an unrecognised status verb', async () => {
    await settleStatusEvent(admin, 't1', { id: 'wamid.A', status: 'deleted' });
    expect(settleOutboundMessage).not.toHaveBeenCalled();
  });

  it('never throws when settlement fails', async () => {
    settleOutboundMessage.mockRejectedValueOnce(new Error('db down'));
    await expect(
      settleStatusEvent(admin, 't1', { id: 'wamid.A', status: 'delivered' }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/api/webhooks/meta-status-settlement.test.ts`
Expected: FAIL — `settleStatusEvent is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `src/app/api/webhooks/whatsapp/meta/route.ts`:

```ts
interface MetaStatusEvent {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  conversation?: { id?: string; origin?: { type?: string } };
  pricing?: {
    billable?: boolean;
    pricing_model?: string;
    category?: string;
    type?: string;
  };
}

const SETTLEABLE_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

export async function settleStatusEvent(
  admin: SupabaseClient,
  tenantId: string,
  status: MetaStatusEvent,
): Promise<void> {
  if (!status.id || !status.status) return;
  if (!SETTLEABLE_STATUSES.has(status.status)) return;
  try {
    await settleOutboundMessage({
      admin,
      tenantId,
      wamid: status.id,
      deliveryStatus: status.status as 'sent' | 'delivered' | 'read' | 'failed',
      pricing: status.pricing,
    });
  } catch (error) {
    defaultLogger.error('[WEBHOOK-META] Settlement failed', { wamid: status.id, error });
  }
}
```

Settlement must never throw out of the webhook. A 500 makes Meta retry the whole payload, which re-runs message ingestion.

Call it from the statuses loop, after the idempotency check, and only when the event is not a duplicate and a tenant is known:

```ts
      for (const status of value.statuses ?? []) {
        if (!status.id) continue;
        const isDuplicateStatus = await handleIdempotency(
          supabase,
          'meta',
          `${metaPhoneNumberId}:status`,
          buildStatusIdempotencyKey(status.id, status.status),
          { type: 'status', status, value }
        );
        if (isDuplicateStatus) continue;
        if (!configuredTenantId) continue;
        await settleStatusEvent(supabase, configuredTenantId, status);
      }
```

`configuredTenantId` is already in scope at that point (assigned just above the loop). Shared-gateway traffic has no `config.tenant_id`, so it is skipped — correct, because such sends were never metered against a tenant.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/api/webhooks/`
Expected: PASS, including the Task 1 idempotency tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/app/api/webhooks/whatsapp/meta/route.ts src/__tests__/api/webhooks/meta-status-settlement.test.ts
git commit -m "feat(webhooks): settle message charges from Meta's own pricing object"
```

---

### Task 11: Sweeper worker

Without this, a broken webhook subscription silently drains every tenant's balance into reservations that never settle. The release rate is also the only early warning that the subscription has broken.

**Files:**
- Create: `src/app/api/worker/message-charges/route.ts`
- Test: `src/__tests__/api/worker/message-charges.test.ts`
- Modify: `docs/operations-guide.md` (add a "Workers" entry; Task 13 later adds a separate metering section to the same file)

**Interfaces:**
- Consumes: `releaseStaleReservations` (Task 7).
- Produces: `GET /api/worker/message-charges` → `{ released: number }`.

- [ ] **Step 1: Write the failing test**

`src/__tests__/api/worker/message-charges.test.ts`:

```ts
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const releaseStaleReservations = jest.fn();
jest.mock('@/lib/billing/messageWallet', () => ({ releaseStaleReservations }));
jest.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => ({}) }));

import { GET } from '@/app/api/worker/message-charges/route';

function req(auth?: string) {
  return new Request('http://localhost/api/worker/message-charges', {
    headers: auth ? { authorization: auth } : {},
  });
}

describe('GET /api/worker/message-charges', () => {
  // NODE_ENV is typed readonly, so assign through the index signature.
  const setNodeEnv = (v: string) => { (process.env as Record<string, string>).NODE_ENV = v; };

  beforeEach(() => {
    jest.clearAllMocks();
    setNodeEnv('test');
    delete process.env.CRON_SECRET;
  });

  it('releases stale reservations', async () => {
    releaseStaleReservations.mockResolvedValue({ released: 3 });
    const res = await GET(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ released: 3 });
  });

  it('rejects unauthorised calls in production', async () => {
    setNodeEnv('production');
    process.env.CRON_SECRET = 'secret';
    const res = await GET(req('Bearer wrong'));
    expect(res.status).toBe(401);
  });

  it('returns 500 rather than throwing when the sweep fails', async () => {
    releaseStaleReservations.mockRejectedValue(new Error('db down'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/api/worker/message-charges.test.ts`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Write the implementation**

`src/app/api/worker/message-charges/route.ts`, following the auth and error shape of `src/app/api/worker/operating-loop/route.ts` exactly:

```ts
import { NextResponse } from 'next/server';
import { releaseStaleReservations } from '@/lib/billing/messageWallet';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export async function GET(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (
    process.env.NODE_ENV === 'production'
    && (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await releaseStaleReservations(createSupabaseAdminClient(), STALE_AFTER_MS);
    if (result.released > 0) {
      console.warn('[worker/message-charges] released stale reservations', result);
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[worker/message-charges] failed', { error: message });
    return NextResponse.json({ error: 'Message charge sweeper failed' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/api/worker/message-charges.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Document the schedule, typecheck, commit**

Add to `docs/operations-guide.md`, next to the existing worker entries: `GET /api/worker/message-charges` runs **every 15 minutes** with `Authorization: Bearer $CRON_SECRET`. A sustained non-zero `released` count means the Meta webhook subscription is broken.

```bash
npm run typecheck
git add src/app/api/worker/message-charges/route.ts src/__tests__/api/worker/message-charges.test.ts docs/operations-guide.md
git commit -m "feat(worker): sweep unsettled message reservations after 24h"
```

---

### Task 12: Monthly reconciliation summary

**Files:**
- Create: `src/lib/billing/messageReconciliation.ts`
- Test: `src/__tests__/lib/billing/messageReconciliation.test.ts`

**Interfaces:**
- Consumes: `whatsapp_message_charges` (Task 3), `getReconcileDriftPct` (Task 5).
- Produces:
  ```ts
  export interface ReconciliationSummary {
    month: string;                 // 'YYYY-MM'
    billableMessages: number;
    settledCredits: number;
    releasedMessages: number;
    freeMessages: number;
    byCategory: Record<string, number>;
  }
  export function buildMonthlyReconciliation(
    admin: SupabaseClient,
    month: string,
  ): Promise<ReconciliationSummary>;
  export function evaluateDrift(
    summary: ReconciliationSummary,
    metaReportedCost: number,
  ): { driftPct: number; withinTolerance: boolean };
  ```

Only `mode = 'live'` rows count. Shadow rows record volume but are not revenue, and mixing them would make every reconciliation look wrong for the first month.

- [ ] **Step 1: Write the failing test**

`src/__tests__/lib/billing/messageReconciliation.test.ts`:

```ts
import { describe, it, expect, beforeEach } from '@jest/globals';
import { buildMonthlyReconciliation, evaluateDrift } from '@/lib/billing/messageReconciliation';

// Reuse the queue-based Supabase mock scaffolding from Task 7 (`pushDb` / `admin`).

// Pin the cost rate: evaluateDrift multiplies by resolveMessageCostCredits(), so an
// unset env would make these assertions depend on the provisional default.
beforeEach(() => {
  process.env.BOOKA_MESSAGE_RATE_CREDITS = '14';
  process.env.BOOKA_MESSAGE_RECONCILE_DRIFT_PCT = '2';
});

const base = {
  month: '2026-10', billableMessages: 1000, settledCredits: 22400,
  releasedMessages: 3, freeMessages: 120, byCategory: { service: 800, utility: 200 },
};

describe('buildMonthlyReconciliation', () => {
  it('counts only live rows and aggregates by category', async () => {
    pushDb([
      { billable: true,  settled_credits: 22.4, status: 'settled',  pricing_category: 'service' },
      { billable: true,  settled_credits: 22.4, status: 'settled',  pricing_category: 'utility' },
      { billable: false, settled_credits: 0,    status: 'settled',  pricing_category: 'service' },
      { billable: null,  settled_credits: null, status: 'released', pricing_category: null },
    ]);
    const r = await buildMonthlyReconciliation(admin, '2026-10');
    expect(r).toMatchObject({
      month: '2026-10',
      billableMessages: 2,
      settledCredits: 44.8,
      freeMessages: 1,
      releasedMessages: 1,
    });
    expect(r.byCategory).toEqual({ service: 1, utility: 1 });
  });

  it('returns a zeroed summary for a month with no rows', async () => {
    pushDb([]);
    const r = await buildMonthlyReconciliation(admin, '2026-09');
    expect(r).toMatchObject({
      month: '2026-09', billableMessages: 0, settledCredits: 0,
      freeMessages: 0, releasedMessages: 0,
    });
    expect(r.byCategory).toEqual({});
  });
});

describe('evaluateDrift', () => {
  it('accepts drift inside tolerance', () => {
    // 1000 billable messages at a 14 cost = 14000 expected
    expect(evaluateDrift(base, 14100)).toMatchObject({ withinTolerance: true });
  });

  it('flags drift beyond tolerance', () => {
    const r = evaluateDrift(base, 16000);
    expect(r.withinTolerance).toBe(false);
    expect(r.driftPct).toBeCloseTo(14.29, 1);
  });

  it('treats a zero Meta cost with zero billable messages as no drift', () => {
    const r = evaluateDrift({ ...base, billableMessages: 0 }, 0);
    expect(r.driftPct).toBe(0);
    expect(r.withinTolerance).toBe(true);
  });

  it('flags a non-zero Meta cost against zero billable messages', () => {
    expect(evaluateDrift({ ...base, billableMessages: 0 }, 500).withinTolerance).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/lib/billing/messageReconciliation.test.ts`
Expected: FAIL — cannot resolve `@/lib/billing/messageReconciliation`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/billing/messageReconciliation.ts`. `buildMonthlyReconciliation` selects `whatsapp_message_charges` rows for the month where `mode = 'live'` and aggregates. `evaluateDrift` compares `metaReportedCost` against `billableMessages * resolveMessageCostCredits()` and returns the percentage difference plus a `withinTolerance` flag from `getReconcileDriftPct()`. Guard the zero-denominator case: zero billable messages and zero reported cost is 0% drift, not `NaN`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/lib/billing/messageReconciliation.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Full suite, typecheck, commit**

```bash
npm test
npm run typecheck
git add src/lib/billing/messageReconciliation.ts src/__tests__/lib/billing/messageReconciliation.test.ts
git commit -m "feat(billing): monthly message cost reconciliation and drift check"
```

---

### Task 13: Environment documentation and shadow-mode rollout notes

**Files:**
- Modify: `.env.example`
- Modify: `deployment/env/.env.staging.example`
- Modify: `deployment/env/.env.production.example`
- Modify: `docs/operations-guide.md`

There is no `deployment/env/.env.staging` in the repo, and there must not be — the
committed files are `.example` templates. Never create or commit a real secrets env file.

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code-facing.

- [ ] **Step 1: Add the variables to all three env templates**

```bash
# WhatsApp message metering (Meta bills service messages from 2026-10-01)
# shadow = record volume, never gate or charge. live = full metering.
BOOKA_MESSAGE_METERING_MODE=shadow
# What Booka pays Meta per delivered message, in credits (1 credit = NGN 1).
# PROVISIONAL. Meta publishes confirmed Nigeria rates on 2026-09-01.
BOOKA_MESSAGE_RATE_CREDITS=14
# Resale multiplier: FX drift, BSP and tax overhead, failed sends, margin.
BOOKA_MESSAGE_MARKUP=1.6
# Default grace overdraft for new wallets, in credits.
BOOKA_MESSAGE_GRACE_CREDITS=100
# Monthly reconciliation alert threshold, percent.
BOOKA_MESSAGE_RECONCILE_DRIFT_PCT=2
```

- [ ] **Step 2: Document the cutover in the operations guide**

Add a "WhatsApp message metering" section stating:
- Migrations 139, 140 and 141 must be applied before deploying this code. **The user runs them on the VPS.**
- Deploy with `BOOKA_MESSAGE_METERING_MODE=shadow`. Verify rows appear in `whatsapp_message_charges` with `mode = 'shadow'` and that no wallet balance moves.
- On 2026-09-01, update `BOOKA_MESSAGE_RATE_CREDITS` to Meta's confirmed Nigeria rate.
- On 2026-10-01, set `BOOKA_MESSAGE_METERING_MODE=live`. This is a config change and a restart, not a deploy.
- Rollback is the same flag back to `shadow`. Migrations do not need reverting.
- The shadow query for sizing tier allowances:
  ```sql
  SELECT tenant_id,
         date_trunc('month', sent_at) AS month,
         count(*) AS messages
  FROM public.whatsapp_message_charges
  WHERE mode = 'shadow' AND provider = 'meta'
  GROUP BY 1, 2
  ORDER BY 3 DESC;
  ```

- [ ] **Step 3: Run the full suite one last time**

```bash
npm test
npm run typecheck
npm run lint
```

Expected: all pass.

- [ ] **Step 4: Commit and open the PR**

```bash
git add .env.example deployment/env/.env.staging.example deployment/env/.env.production.example docs/operations-guide.md
git commit -m "docs(ops): WhatsApp metering env vars and Oct 1 cutover runbook"
git push -u origin feat/whatsapp-message-metering
```

Open the PR against `staging`, not `main`. Body must state that migrations 139-141 need applying before the deploy, and that the feature ships inert in shadow mode.

---

## Self-Review

**Spec coverage.** Every section of the design maps to a task: §3 idempotency → Task 1; §4 migrations 139/140/141 → Tasks 2/3/4; §5 send gate → Tasks 6, 7, 8, 9; §6 settlement, sweeper, reconciliation → Tasks 10, 11, 12; §7 rate policy and modes → Tasks 5 and 13; §8 testing → distributed across every task; §10 rollout → Task 13. Spec §9 (out of scope) has no task, correctly.

**Type consistency.** `ReserveOutboundResult`, `ReserveMode`, `MessageKind`, `SettleOutboundParams` and `CapDecision.degraded` are declared once in Tasks 6-7 and used unchanged in Tasks 8-12. `settleOutboundMessage` takes `pricing.category` / `pricing.type` / `pricing.pricing_model`, matching Meta's payload naming rather than the column names — the mapping to `pricing_category` / `pricing_type` / `pricing_model` happens inside `settleOutboundMessage` only.

**Second review pass (2026-08-28).** Four defects found and fixed:

1. **Type violation.** `reserveOutboundMessage`'s error fallback returned no `chargeId`
   while `ReserveOutboundResult` required one. `chargeId` is now `string | null`, and
   Task 9 null-checks before `attachWamid` / `abandonCharge`.
2. **Sweeper livelock.** Free-provider and shadow rows are written `status: 'reserved'`
   with no wallet reservation, so the sweeper would have re-swept them every 15 minutes
   forever and poisoned the very counter used to detect a broken webhook. The select now
   filters `wallet_reservation_id IS NOT NULL`.
3. **Shadow data loss.** Settlement's "already settled → no-op" guard had no branch for
   rows with no reservation, so shadow rows would never have recorded their pricing —
   defeating the point of shadow mode. Added an explicit no-RPC settlement path.
4. **Missing client.** `withMetering` had no Supabase client in scope. It now creates one
   lazily via `createSupabaseAdminClient()`.

Plus two test-hygiene fixes: Task 8's snippet now says where its mock harness comes from,
and Task 12 pins `BOOKA_MESSAGE_RATE_CREDITS` instead of depending on the default.

**Spec alignment.** The design doc's §5 has been updated to match item 1 — the bounded
error fallback is now spec, not a plan-level deviation.
