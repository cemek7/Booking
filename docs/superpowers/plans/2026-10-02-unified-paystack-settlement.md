# Unified Paystack Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every Booka customer payment through one fail-closed Paystack settlement boundary that charges in minor units, splits to the tenant subaccount with a capped Booka platform fee, and confirms payment only from verified provider data.

**Architecture:** A new migration adds a fee-policy table, a tenant payment-account table, and settlement-snapshot columns. A pure fee module, a thin Paystack client extension, and one server-only module (`tenantSettlement.ts`) replace every direct initializer. One Paystack webhook processor (admin client, mandatory verify, snapshot comparison) serves both webhook URLs. Collection stays off until `BOOKA_TENANT_PAYMENTS=live`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase/PostgreSQL, Jest (`@jest/globals`), Paystack REST API.

**Spec:** `docs/superpowers/specs/2026-10-02-unified-paystack-settlement-design.md` (approved; owner decisions in Section 13). Read it before starting any task.

## Global Constraints

- Baseline: branch `feat/retail-fulfillment-handoff`, commit `175933806de79598205df0a8dd7ff9005d9df0f5`. Work in this worktree only. Never `git checkout`/`switch`/`reset`/`stash`/`rebase`.
- Preserve the untracked file `docs/runbooks/staging-owner-smoke-handoff-2026-09-15.md`. Never `git add -A` or `git add .`; add explicit paths only.
- Never run migrations against any real database. Validate SQL only in a throwaway `postgres:16-alpine` container. The owner runs migrations.
- Never touch staging, production, the VPS, Paystack dashboards, or Supabase projects. Never print env values.
- Money enters the new boundary only as integer minor units (`amountMinor`). Currency is `NGN` only.
- Pilot policy: code `pilot_ngn_v1`, version `1`, `100` basis points, cap `200000` minor units, bearer `subaccount`, subaccount `percentage_charge` `0`.
- Fee math: `floor(amountMinor * bps / 10000)`, then `min(fee, cap)`; integer (BigInt) arithmetic.
- Legacy `transactions.amount` written by new code = `amount_minor / 100` (major units).
- `tenant_revenue_ledger.amount_credits` = minor / 100 (1 credit = NGN 1).
- Collection gate: env `BOOKA_TENANT_PAYMENTS` must equal `live`; anything else fails closed with `SETTLEMENT_DISABLED`.
- No runtime reads of `tenants.metadata.paystack_subaccount_code`.
- Wallet top-up (`src/lib/billing/walletTopup.ts`) and `chargeAuthorization` behavior must not change.
- Owner decisions: full refunds return Booka's fee (negative `refund` ledger entry), partial refunds keep it; open payment handoffs are exempt from auto-cancel; daily close reports gross with fee lines; WhatsApp email fallback is `getCustomerEmail`, never a shared placeholder.
- Run tests with `npx jest <paths> --runInBand`. Type-check once at the end with `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Tiny or boundary amounts** (e.g. 99 kobo, exactly 200,000,000 kobo) — fee must floor to 0 or hit the cap exactly, never produce a negative tenant gross. Pinned in Task 2.
2. **Webhook arrives before the initialization row is marked initialized** (provider fast-path) — processor must find the row by reference and still settle. Pinned in Task 9.
3. **Replay-marker insert fails for a non-duplicate reason** (DB hiccup) — must return 500 so Paystack retries, never process unguarded. Pinned in Task 9.
4. **Tenant plan/policy changes between checkout creation and payment** — ledger and reconciliation must use the stored snapshot, not the current policy. Pinned in Task 9.
5. **Same reservation deposit requested twice with a different amount** — must not reuse the old checkout. Pinned in Task 4.

---

## File Map

| File | Responsibility | Task |
|---|---|---|
| `db/migrations/160_unified_paystack_settlement.sql` | Policies, accounts, snapshot columns, ledger + escalation CHECK swaps, pilot seed | 1 |
| `db/migrations/160_unified_paystack_settlement_verify.sql` | Read-only schema verifier | 1 |
| `db/migrations/160_unified_paystack_settlement_manual_fallback.md` | Manual SQL fallback | 1 |
| `src/lib/payments/settlementPolicy.ts` | Pure fee math + amount validation | 2 |
| `src/lib/paystack.ts` | Add `initializeSplitTransaction`, `verifyTransaction` | 3 |
| `src/lib/payments/tenantSettlement.ts` | The only tenant-payment initializer | 4 |
| `src/lib/payments/paymentHandoff.ts` | Open reservation payment handoff + escalation | 5 |
| `src/app/api/jobs/auto-cancel-unconfirmed/route.ts` | Skip open handoffs | 5 |
| `src/lib/whatsapp/v2/flows/customerBooking.ts` | Use settlement module / handoff | 6 |
| `src/lib/dialogBookingBridge.ts` | Use settlement module / deposit policy / handoff | 6 |
| `src/lib/publicBookingService.ts` + `src/app/book/[slug]/components/BookingContainer.tsx` | Use settlement module / unavailable state | 7 |
| `src/app/api/payments/deposits/route.ts` | `amountMinor` + settlement module | 8 |
| `src/app/api/payments/links/route.ts` + `src/app/dashboard/payment-links/page.tsx` | Settlement module | 8 |
| `src/lib/commerce/retail-orders.ts` | Settlement module after fulfilment gate | 8 |
| `src/lib/payments/paystackWebhookProcessor.ts` | One verified webhook processor + `settleVerifiedCharge` | 9 |
| `src/app/api/payments/webhook/route.ts`, `src/app/api/payments/paystack/route.ts` | Delegate Paystack events | 9 |
| `src/lib/paymentService.ts`, `src/app/api/payments/refund/route.ts`, `src/lib/payments/tenantRefunds.ts` | Retry via verifier; minor-unit refunds; fee reversal | 10 |
| `src/lib/paymentsAdapter.ts`, `src/lib/payments/lifecycle.ts` | Remove legacy Paystack initializers | 11 |
| `src/__tests__/lib/payments/initializeAllowList.test.ts` | Static guard | 11 |
| `src/app/api/payments/subaccounts/route.ts`, `src/app/api/tenants/[tenantId]/payments/setup/route.ts`, `src/lib/offboarding/teardownTasks.ts`, `src/components/settings/PaymentSettingsSection.tsx` | Setup, acceptance, deprecation, offboarding, disclosure | 12 |
| Docs (runbook, launch-hardening, daily-close, ops guide, spec) | Align docs | 13 |

---

### Task 1: Schema migration, verifier, and fallback

**Files:**
- Create: `db/migrations/160_unified_paystack_settlement.sql`
- Create: `db/migrations/160_unified_paystack_settlement_verify.sql`
- Create: `db/migrations/160_unified_paystack_settlement_manual_fallback.md`

**Interfaces:**
- Produces tables `public.payment_fee_policies`, `public.tenant_payment_accounts`; columns on `public.transactions` listed below; `tenant_revenue_ledger.revenue_type` accepts `platform_transaction_fee`; `escalation_queue.reason_code` accepts `payment_settlement`.

- [ ] **Step 1: Confirm the migration number is free**

Run: `ls db/migrations | grep -E '^160_' ; git fetch origin && git ls-tree -r --name-only origin/staging db/migrations | grep -E '/160_'`
Expected: no output. If `160_` exists anywhere, use the next free number and rename every file and reference in this plan.

- [ ] **Step 2: Write the migration**

```sql
-- Migration 160: unified Paystack settlement (spec 2026-10-02).
-- Additive expand migration. Customer collection stays disabled until
-- BOOKA_TENANT_PAYMENTS=live in the matching application release.

BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_fee_policies (
  code text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  currency text NOT NULL CHECK (currency = 'NGN'),
  platform_fee_basis_points integer NOT NULL CHECK (platform_fee_basis_points BETWEEN 0 AND 10000),
  platform_fee_cap_minor bigint CHECK (platform_fee_cap_minor IS NULL OR platform_fee_cap_minor >= 0),
  fee_bearer text NOT NULL CHECK (fee_bearer = 'subaccount'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (code, version)
);

CREATE TABLE IF NOT EXISTS public.tenant_payment_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider = 'paystack'),
  currency text NOT NULL CHECK (currency = 'NGN'),
  subaccount_code text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'invalid')),
  bank_code text,
  account_last4 text CHECK (account_last4 IS NULL OR account_last4 ~ '^[0-9]{4}$'),
  account_name text,
  policy_code text NOT NULL,
  policy_version integer NOT NULL,
  accepted_by uuid,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_payment_accounts_policy_fkey
    FOREIGN KEY (policy_code, policy_version)
    REFERENCES public.payment_fee_policies (code, version) ON DELETE RESTRICT,
  CONSTRAINT tenant_payment_accounts_tenant_provider_currency_key
    UNIQUE (tenant_id, provider, currency),
  CONSTRAINT tenant_payment_accounts_active_requires_acceptance
    CHECK (status <> 'active' OR (subaccount_code IS NOT NULL AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL))
);

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS amount_minor bigint,
  ADD COLUMN IF NOT EXISTS platform_fee_minor bigint,
  ADD COLUMN IF NOT EXISTS tenant_gross_minor bigint,
  ADD COLUMN IF NOT EXISTS settlement_subaccount_code text,
  ADD COLUMN IF NOT EXISTS settlement_fee_bearer text,
  ADD COLUMN IF NOT EXISTS settlement_policy_code text,
  ADD COLUMN IF NOT EXISTS settlement_policy_version integer,
  ADD COLUMN IF NOT EXISTS settlement_idempotency_key text,
  ADD COLUMN IF NOT EXISTS provider_amount_minor bigint,
  ADD COLUMN IF NOT EXISTS provider_currency text,
  ADD COLUMN IF NOT EXISTS provider_fee_minor bigint,
  ADD COLUMN IF NOT EXISTS provider_subaccount_code text,
  ADD COLUMN IF NOT EXISTS settlement_verification_status text;

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conrelid = 'public.transactions'::regclass
                   AND conname = 'transactions_settlement_amounts_check') THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_settlement_amounts_check CHECK (
        (amount_minor IS NULL OR amount_minor > 0)
        AND (platform_fee_minor IS NULL OR platform_fee_minor >= 0)
        AND (tenant_gross_minor IS NULL OR tenant_gross_minor >= 0)
        AND (amount_minor IS NULL OR platform_fee_minor IS NULL OR tenant_gross_minor IS NULL
             OR platform_fee_minor + tenant_gross_minor = amount_minor)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conrelid = 'public.transactions'::regclass
                   AND conname = 'transactions_settlement_verification_status_check') THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_settlement_verification_status_check CHECK (
        settlement_verification_status IS NULL
        OR settlement_verification_status IN ('pending', 'verified', 'mismatch', 'not_applicable')
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conrelid = 'public.transactions'::regclass
                   AND conname = 'transactions_settlement_fee_bearer_check') THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_settlement_fee_bearer_check CHECK (
        settlement_fee_bearer IS NULL OR settlement_fee_bearer = 'subaccount'
      );
  END IF;
END
$constraints$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_settlement_idempotency
  ON public.transactions (tenant_id, settlement_idempotency_key)
  WHERE settlement_idempotency_key IS NOT NULL;

-- Replace (not append to) the revenue_type CHECK. The constraint name is
-- generated by Postgres in migration 079, so find it by definition.
DO $revenue$
DECLARE
  existing_name text;
BEGIN
  SELECT conname INTO existing_name
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.tenant_revenue_ledger'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%revenue_type%';
  IF existing_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.tenant_revenue_ledger DROP CONSTRAINT %I', existing_name);
  END IF;
  ALTER TABLE public.tenant_revenue_ledger
    ADD CONSTRAINT tenant_revenue_ledger_revenue_type_check CHECK (revenue_type IN (
      'wallet_topup', 'usage_charge', 'subscription_charge', 'overage_charge',
      'refund', 'manual_adjustment', 'bonus_credit', 'platform_transaction_fee'
    ));
END
$revenue$;

-- Replace the escalation reason_code CHECK from migration 159.
ALTER TABLE public.escalation_queue DROP CONSTRAINT IF EXISTS escalation_queue_reason_code_check;
ALTER TABLE public.escalation_queue
  ADD CONSTRAINT escalation_queue_reason_code_check
  CHECK (reason_code IS NULL OR reason_code IN ('retail_fulfillment', 'payment_settlement'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_escalation_payment_settlement
  ON public.escalation_queue (tenant_id, session_id, reason_code)
  WHERE reason_code = 'payment_settlement';

INSERT INTO public.payment_fee_policies
  (code, version, currency, platform_fee_basis_points, platform_fee_cap_minor, fee_bearer)
VALUES ('pilot_ngn_v1', 1, 'NGN', 100, 200000, 'subaccount')
ON CONFLICT (code, version) DO NOTHING;

ALTER TABLE public.payment_fee_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_payment_accounts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.payment_fee_policies FROM anon, authenticated;
REVOKE ALL ON public.tenant_payment_accounts FROM anon, authenticated;
GRANT SELECT ON public.payment_fee_policies TO authenticated;
GRANT SELECT ON public.tenant_payment_accounts TO authenticated;
GRANT ALL ON public.payment_fee_policies TO service_role;
GRANT ALL ON public.tenant_payment_accounts TO service_role;

DROP POLICY IF EXISTS payment_fee_policies_service_role ON public.payment_fee_policies;
CREATE POLICY payment_fee_policies_service_role ON public.payment_fee_policies
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS payment_fee_policies_read ON public.payment_fee_policies;
CREATE POLICY payment_fee_policies_read ON public.payment_fee_policies
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS tenant_payment_accounts_service_role ON public.tenant_payment_accounts;
CREATE POLICY tenant_payment_accounts_service_role ON public.tenant_payment_accounts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS tenant_payment_accounts_owner_read ON public.tenant_payment_accounts;
CREATE POLICY tenant_payment_accounts_owner_read ON public.tenant_payment_accounts
  FOR SELECT TO authenticated USING (
    tenant_id IN (
      SELECT tu.tenant_id FROM public.tenant_users tu
      WHERE tu.user_id = auth.uid() AND tu.role = 'owner'
    )
  );

COMMIT;
```

- [ ] **Step 3: Write the read-only verifier**

```sql
-- Verifier for migration 160. Read-only. Every row must report ok = true.
SELECT 'payment_fee_policies exists' AS check_name,
       to_regclass('public.payment_fee_policies') IS NOT NULL AS ok
UNION ALL SELECT 'tenant_payment_accounts exists', to_regclass('public.tenant_payment_accounts') IS NOT NULL
UNION ALL SELECT 'pilot policy seeded', EXISTS (
  SELECT 1 FROM public.payment_fee_policies
  WHERE code = 'pilot_ngn_v1' AND version = 1 AND platform_fee_basis_points = 100
    AND platform_fee_cap_minor = 200000 AND fee_bearer = 'subaccount')
UNION ALL SELECT 'transactions snapshot columns', (
  SELECT count(*) = 13 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'transactions'
    AND column_name IN ('amount_minor','platform_fee_minor','tenant_gross_minor',
      'settlement_subaccount_code','settlement_fee_bearer','settlement_policy_code',
      'settlement_policy_version','settlement_idempotency_key','provider_amount_minor',
      'provider_currency','provider_fee_minor','provider_subaccount_code',
      'settlement_verification_status'))
UNION ALL SELECT 'RLS on accounts', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tenant_payment_accounts'::regclass)
UNION ALL SELECT 'RLS on policies', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.payment_fee_policies'::regclass)
UNION ALL SELECT 'no anon grants on accounts', NOT has_table_privilege('anon', 'public.tenant_payment_accounts', 'SELECT')
UNION ALL SELECT 'authenticated cannot write accounts', NOT has_table_privilege('authenticated', 'public.tenant_payment_accounts', 'INSERT,UPDATE,DELETE')
UNION ALL SELECT 'revenue type accepts platform fee', EXISTS (
  SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tenant_revenue_ledger'::regclass
    AND pg_get_constraintdef(oid) LIKE '%platform_transaction_fee%')
UNION ALL SELECT 'escalation accepts payment_settlement', EXISTS (
  SELECT 1 FROM pg_constraint WHERE conname = 'escalation_queue_reason_code_check'
    AND pg_get_constraintdef(oid) LIKE '%payment_settlement%')
UNION ALL SELECT 'zero tenant subaccounts in metadata', NOT EXISTS (
  SELECT 1 FROM public.tenants WHERE metadata ? 'paystack_subaccount_code');
```

- [ ] **Step 4: Write the manual fallback doc**

Create `db/migrations/160_unified_paystack_settlement_manual_fallback.md` with these sections, each containing the exact SQL from Step 2 split into independently runnable blocks: (1) create `payment_fee_policies` + seed; (2) create `tenant_payment_accounts`; (3) `ALTER TABLE transactions` + constraints + index; (4) revenue CHECK swap; (5) escalation CHECK swap + index; (6) RLS/grants. Add a header: "Run blocks in order in the Supabase SQL editor only if the migration file fails. Each block is idempotent. Then run `160_unified_paystack_settlement_verify.sql`." Add a rollback section:

```sql
-- Rollback (only before any tenant payment exists):
BEGIN;
DROP TABLE IF EXISTS public.tenant_payment_accounts;
DROP TABLE IF EXISTS public.payment_fee_policies;
DROP INDEX IF EXISTS public.uq_transactions_settlement_idempotency;
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_settlement_amounts_check,
  DROP CONSTRAINT IF EXISTS transactions_settlement_verification_status_check,
  DROP CONSTRAINT IF EXISTS transactions_settlement_fee_bearer_check;
-- Snapshot columns are left in place (additive, nullable, harmless).
COMMIT;
```

- [ ] **Step 5: Validate in a throwaway container**

Run:
```bash
docker run -d --rm --name settle160 -e POSTGRES_PASSWORD=pw postgres:16-alpine
sleep 5
docker exec -i settle160 psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
CREATE TABLE public.tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), metadata jsonb DEFAULT '{}');
CREATE TABLE public.tenant_users (tenant_id uuid, user_id uuid, role text);
CREATE TABLE public.transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, amount numeric, provider_reference text UNIQUE);
CREATE TABLE public.tenant_revenue_ledger (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, revenue_type text NOT NULL CHECK (revenue_type IN ('wallet_topup','usage_charge','subscription_charge','overage_charge','refund','manual_adjustment','bonus_credit')), amount_credits numeric(20,6), reference text);
CREATE TABLE public.escalation_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, session_id text, reason_code text);
ALTER TABLE public.escalation_queue ADD CONSTRAINT escalation_queue_reason_code_check CHECK (reason_code IS NULL OR reason_code IN ('retail_fulfillment'));
SQL
docker exec -i settle160 psql -U postgres -v ON_ERROR_STOP=1 < db/migrations/160_unified_paystack_settlement.sql
docker exec -i settle160 psql -U postgres -v ON_ERROR_STOP=1 < db/migrations/160_unified_paystack_settlement.sql
docker exec -i settle160 psql -U postgres -At < db/migrations/160_unified_paystack_settlement_verify.sql
docker stop settle160
```
Expected: both migration runs succeed (second proves idempotency); every verifier row ends in `|t`.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/160_unified_paystack_settlement.sql db/migrations/160_unified_paystack_settlement_verify.sql db/migrations/160_unified_paystack_settlement_manual_fallback.md
git commit -m "feat(db): add unified paystack settlement schema

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure fee policy module

**Files:**
- Create: `src/lib/payments/settlementPolicy.ts`
- Test: `src/__tests__/lib/payments/settlementPolicy.test.ts`

**Interfaces:**
- Produces:
  - `type FeePolicy = { code: string; version: number; basisPoints: number; capMinor: number | null; feeBearer: 'subaccount' }`
  - `type SettlementAmounts = { amountMinor: number; platformFeeMinor: number; tenantGrossMinor: number }`
  - `function isValidAmountMinor(value: unknown): value is number`
  - `function calculateSettlement(amountMinor: number, policy: FeePolicy): SettlementAmounts` (throws `RangeError` on invalid input)
  - `const MAX_AMOUNT_MINOR = 100_000_000_000` (NGN 1bn)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from '@jest/globals';
import { calculateSettlement, isValidAmountMinor, MAX_AMOUNT_MINOR, type FeePolicy } from '@/lib/payments/settlementPolicy';

const pilot: FeePolicy = { code: 'pilot_ngn_v1', version: 1, basisPoints: 100, capMinor: 200000, feeBearer: 'subaccount' };

describe('isValidAmountMinor', () => {
  it.each([1, 500000, MAX_AMOUNT_MINOR])('accepts %p', (v) => expect(isValidAmountMinor(v)).toBe(true));
  it.each([0, -1, 1.5, NaN, Infinity, '500000', null, undefined, MAX_AMOUNT_MINOR + 1])('rejects %p', (v) =>
    expect(isValidAmountMinor(v)).toBe(false));
});

describe('calculateSettlement', () => {
  it('charges 1% of a NGN 5,000 deposit', () => {
    expect(calculateSettlement(500000, pilot)).toEqual({ amountMinor: 500000, platformFeeMinor: 5000, tenantGrossMinor: 495000 });
  });
  it('floors fractional fees (99 kobo -> 0 fee)', () => {
    expect(calculateSettlement(99, pilot)).toEqual({ amountMinor: 99, platformFeeMinor: 0, tenantGrossMinor: 99 });
  });
  it('floors 150 kobo to 1 kobo fee', () => {
    expect(calculateSettlement(150, pilot).platformFeeMinor).toBe(1);
  });
  it('hits the cap exactly at NGN 200,000', () => {
    expect(calculateSettlement(20_000_000, pilot).platformFeeMinor).toBe(200000);
  });
  it('caps above NGN 200,000', () => {
    expect(calculateSettlement(200_000_000, pilot)).toEqual({ amountMinor: 200_000_000, platformFeeMinor: 200000, tenantGrossMinor: 199_800_000 });
  });
  it('applies no cap when capMinor is null', () => {
    expect(calculateSettlement(200_000_000, { ...pilot, capMinor: null }).platformFeeMinor).toBe(2_000_000);
  });
  it('is exact at the maximum amount', () => {
    const r = calculateSettlement(MAX_AMOUNT_MINOR, { ...pilot, capMinor: null });
    expect(r.platformFeeMinor + r.tenantGrossMinor).toBe(MAX_AMOUNT_MINOR);
  });
  it('rejects invalid amounts', () => {
    expect(() => calculateSettlement(1.5, pilot)).toThrow(RangeError);
  });
  it('rejects invalid basis points', () => {
    expect(() => calculateSettlement(100, { ...pilot, basisPoints: 10001 })).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/lib/payments/settlementPolicy.test.ts --runInBand`
Expected: FAIL — cannot find module `@/lib/payments/settlementPolicy`.

- [ ] **Step 3: Implement**

```ts
/**
 * Booka platform-fee arithmetic for tenant customer payments.
 * Integer minor units only; BigInt avoids overflow in amount * basisPoints.
 * Rounding is floor, so rounding always favors the tenant.
 */
export const MAX_AMOUNT_MINOR = 100_000_000_000; // NGN 1bn

export type FeePolicy = {
  code: string;
  version: number;
  basisPoints: number;
  capMinor: number | null;
  feeBearer: 'subaccount';
};

export type SettlementAmounts = {
  amountMinor: number;
  platformFeeMinor: number;
  tenantGrossMinor: number;
};

export function isValidAmountMinor(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_AMOUNT_MINOR;
}

export function calculateSettlement(amountMinor: number, policy: FeePolicy): SettlementAmounts {
  if (!isValidAmountMinor(amountMinor)) throw new RangeError('amountMinor must be a positive safe integer');
  if (!Number.isInteger(policy.basisPoints) || policy.basisPoints < 0 || policy.basisPoints > 10_000) {
    throw new RangeError('basisPoints must be an integer between 0 and 10000');
  }
  if (policy.capMinor !== null && (!Number.isSafeInteger(policy.capMinor) || policy.capMinor < 0)) {
    throw new RangeError('capMinor must be a non-negative safe integer or null');
  }
  const uncapped = Number((BigInt(amountMinor) * BigInt(policy.basisPoints)) / BigInt(10_000));
  const platformFeeMinor = policy.capMinor === null ? uncapped : Math.min(uncapped, policy.capMinor);
  return { amountMinor, platformFeeMinor, tenantGrossMinor: amountMinor - platformFeeMinor };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/lib/payments/settlementPolicy.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/settlementPolicy.ts src/__tests__/lib/payments/settlementPolicy.test.ts
git commit -m "feat(payments): add capped platform fee calculation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Paystack split-initialize and verify client

**Files:**
- Modify: `src/lib/paystack.ts` (add two exports after `initializeTransaction`, ~line 573)
- Test: `src/__tests__/lib/paystack.split.test.ts`

**Interfaces:**
- Produces:
  - `initializeSplitTransaction(params: { email: string; amountMinor: number; reference: string; currency: 'NGN'; subaccountCode: string; transactionChargeMinor: number; callbackUrl?: string; metadata?: Record<string, unknown> }): Promise<{ success: boolean; authorizationUrl?: string; error?: string }>`
  - `type VerifiedPaystackTransaction = { status: string; reference: string; amountMinor: number; currency: string; feesMinor: number | null; subaccountCode: string | null }`
  - `verifyTransaction(reference: string): Promise<{ success: true; data: VerifiedPaystackTransaction } | { success: false; error: string }>`

- [ ] **Step 1: Write the failing contract test**

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockFetch = jest.fn();
jest.mock('@/lib/fetchWithTimeout', () => ({ fetchWithTimeout: (...a: unknown[]) => mockFetch(...a) }));

import { initializeSplitTransaction, verifyTransaction } from '@/lib/paystack';

const ok = (body: unknown) => ({ json: async () => body });

describe('initializeSplitTransaction', () => {
  beforeEach(() => { mockFetch.mockReset(); process.env.PAYSTACK_SECRET_KEY = 'sk_test_x'; });

  it('sends the exact split contract in minor units', async () => {
    mockFetch.mockResolvedValue(ok({ status: true, data: { authorization_url: 'https://checkout/x' } }));
    const r = await initializeSplitTransaction({
      email: 'a@b.co', amountMinor: 500000, reference: 'bk_ref1', currency: 'NGN',
      subaccountCode: 'ACCT_1', transactionChargeMinor: 5000, callbackUrl: 'https://cb', metadata: { k: 1 },
    });
    expect(r).toEqual({ success: true, authorizationUrl: 'https://checkout/x' });
    const [url, init] = mockFetch.mock.calls[0] as [string, { body: string; method: string }];
    expect(url).toBe('https://api.paystack.co/transaction/initialize');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      email: 'a@b.co', amount: 500000, reference: 'bk_ref1', currency: 'NGN',
      callback_url: 'https://cb', metadata: { k: 1 },
      subaccount: 'ACCT_1', transaction_charge: 5000, bearer: 'subaccount',
    });
  });

  it('returns the provider message on failure', async () => {
    mockFetch.mockResolvedValue(ok({ status: false, message: 'Invalid subaccount' }));
    const r = await initializeSplitTransaction({
      email: 'a@b.co', amountMinor: 100, reference: 'bk_ref2', currency: 'NGN', subaccountCode: 'ACCT_1', transactionChargeMinor: 1,
    });
    expect(r).toEqual({ success: false, error: 'Invalid subaccount' });
  });
});

describe('verifyTransaction', () => {
  beforeEach(() => mockFetch.mockReset());

  it('maps verified fields', async () => {
    mockFetch.mockResolvedValue(ok({ status: true, data: {
      status: 'success', reference: 'bk_ref1', amount: 500000, currency: 'NGN', fees: 7500,
      subaccount: { subaccount_code: 'ACCT_1' },
    } }));
    expect(await verifyTransaction('bk_ref1')).toEqual({ success: true, data: {
      status: 'success', reference: 'bk_ref1', amountMinor: 500000, currency: 'NGN', feesMinor: 7500, subaccountCode: 'ACCT_1',
    } });
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.paystack.co/transaction/verify/bk_ref1');
  });

  it('returns null subaccount when Paystack sends an empty object', async () => {
    mockFetch.mockResolvedValue(ok({ status: true, data: { status: 'success', reference: 'r', amount: 1, currency: 'NGN', fees: null, subaccount: {} } }));
    const r = await verifyTransaction('r');
    expect(r.success && r.data.subaccountCode).toBeNull();
  });

  it('fails when the provider says no', async () => {
    mockFetch.mockResolvedValue(ok({ status: false, message: 'Transaction reference not found' }));
    expect(await verifyTransaction('missing')).toEqual({ success: false, error: 'Transaction reference not found' });
  });

  it('url-encodes the reference', async () => {
    mockFetch.mockResolvedValue(ok({ status: false, message: 'x' }));
    await verifyTransaction('a/b');
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.paystack.co/transaction/verify/a%2Fb');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/lib/paystack.split.test.ts --runInBand`
Expected: FAIL — `initializeSplitTransaction is not a function`.

- [ ] **Step 3: Implement** (append after `initializeTransaction` in `src/lib/paystack.ts`)

```ts
/**
 * Tenant customer checkout with a Paystack split. Only
 * `src/lib/payments/tenantSettlement.ts` may call this (guarded by
 * src/__tests__/lib/payments/initializeAllowList.test.ts).
 *
 * `transaction_charge` is Booka's flat fee in minor units; per Paystack's
 * OpenAPI spec it overrides the subaccount's stored percentage split.
 */
export async function initializeSplitTransaction(params: {
  email: string;
  amountMinor: number;
  reference: string;
  currency: 'NGN';
  subaccountCode: string;
  transactionChargeMinor: number;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ success: boolean; authorizationUrl?: string; error?: string }> {
  const data = await paystackFetch<PaystackInitData>('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: params.email,
      amount: params.amountMinor,
      reference: params.reference,
      currency: params.currency,
      callback_url: params.callbackUrl,
      metadata: params.metadata ?? {},
      subaccount: params.subaccountCode,
      transaction_charge: params.transactionChargeMinor,
      bearer: 'subaccount',
    }),
  });
  if (!data.status) return { success: false, error: data.message };
  return { success: true, authorizationUrl: data.data?.authorization_url };
}

export interface VerifiedPaystackTransaction {
  status: string;
  reference: string;
  amountMinor: number;
  currency: string;
  feesMinor: number | null;
  subaccountCode: string | null;
}

interface PaystackVerifyData {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  fees?: number | null;
  subaccount?: { subaccount_code?: string } | null;
}

/** Server-side source of truth for a charge. Amounts are minor units. */
export async function verifyTransaction(
  reference: string,
): Promise<{ success: true; data: VerifiedPaystackTransaction } | { success: false; error: string }> {
  const res = await paystackFetch<PaystackVerifyData>(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
  if (!res.status || !res.data) return { success: false, error: res.message || 'Verification failed' };
  const d = res.data;
  return {
    success: true,
    data: {
      status: d.status,
      reference: d.reference,
      amountMinor: d.amount,
      currency: d.currency,
      feesMinor: typeof d.fees === 'number' ? d.fees : null,
      subaccountCode: typeof d.subaccount?.subaccount_code === 'string' ? d.subaccount.subaccount_code : null,
    },
  };
}
```

If `PaystackResponse<T>` does not expose `message`, read its definition near the top of `paystack.ts` and use the existing field name; do not change its shape.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/lib/paystack.split.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/paystack.ts src/__tests__/lib/paystack.split.test.ts
git commit -m "feat(payments): add paystack split initialize and verify

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The tenant settlement boundary

**Files:**
- Create: `src/lib/payments/tenantSettlement.ts`
- Test: `src/__tests__/lib/payments/tenantSettlement.test.ts`

**Interfaces:**
- Consumes: `calculateSettlement`, `isValidAmountMinor`, `FeePolicy` (Task 2); `initializeSplitTransaction` (Task 3).
- Produces:
  - `type TenantPaymentSubject = { type: 'reservation' | 'retail_order' | 'payment_link'; id: string }`
  - `type SettlementFailureCode = 'SETTLEMENT_DISABLED' | 'INVALID_AMOUNT_MINOR' | 'CURRENCY_NOT_SUPPORTED' | 'CUSTOMER_EMAIL_REQUIRED' | 'SETTLEMENT_NOT_CONFIGURED' | 'POLICY_NOT_ACCEPTED' | 'IDEMPOTENCY_CONFLICT' | 'TRANSACTION_INSERT_FAILED' | 'PROVIDER_INITIALIZATION_FAILED'`
  - `type InitializeTenantPaymentResult = { ok: true; transactionId: string; reference: string; authorizationUrl: string; snapshot: SettlementSnapshot; reused: boolean } | { ok: false; code: SettlementFailureCode; message: string }`
  - `initializeTenantPayment(input: InitializeTenantPaymentInput, store?: SettlementStore): Promise<InitializeTenantPaymentResult>`
  - `isTenantPaymentsEnabled(): boolean`
  - `const SETTLEMENT_CUSTOMER_MESSAGE` (safe text for callers)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockInit = jest.fn();
jest.mock('@/lib/paystack', () => ({ initializeSplitTransaction: (...a: unknown[]) => mockInit(...a) }));
jest.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: jest.fn() }));

import { initializeTenantPayment, type SettlementStore } from '@/lib/payments/tenantSettlement';

const account = { subaccountCode: 'ACCT_1', status: 'active' as const, accepted: true, policyCode: 'pilot_ngn_v1', policyVersion: 1 };
const policy = { code: 'pilot_ngn_v1', version: 1, basisPoints: 100, capMinor: 200000, feeBearer: 'subaccount' as const };

function makeStore(over: Partial<SettlementStore> = {}): SettlementStore & { inserted: unknown[]; failed: string[]; initialized: string[] } {
  const s = {
    inserted: [] as unknown[], failed: [] as string[], initialized: [] as string[],
    loadAccount: jest.fn(async () => account),
    loadPolicy: jest.fn(async () => policy),
    findByIdempotencyKey: jest.fn(async () => null),
    insertPending: jest.fn(async (row: unknown) => { s.inserted.push(row); return { id: 'tx_1' }; }),
    markInitialized: jest.fn(async (id: string) => { s.initialized.push(id); }),
    markFailed: jest.fn(async (id: string) => { s.failed.push(id); }),
    ...over,
  };
  return s as never;
}

const input = {
  tenantId: 't1', amountMinor: 500000, currency: 'NGN' as const, customerEmail: 'c@x.co',
  subject: { type: 'reservation' as const, id: 'r1' }, idempotencyKey: 'deposit:r1',
};

describe('initializeTenantPayment', () => {
  beforeEach(() => { mockInit.mockReset(); process.env.BOOKA_TENANT_PAYMENTS = 'live'; });

  it('fails closed when collection is disabled, with no DB or provider call', async () => {
    process.env.BOOKA_TENANT_PAYMENTS = 'off';
    const store = makeStore();
    const r = await initializeTenantPayment(input, store);
    expect(r).toMatchObject({ ok: false, code: 'SETTLEMENT_DISABLED' });
    expect(store.loadAccount).not.toHaveBeenCalled();
    expect(mockInit).not.toHaveBeenCalled();
  });

  it.each([0, 1.5, -5, Number.NaN])('rejects amount %p before any insert', async (amountMinor) => {
    const store = makeStore();
    expect(await initializeTenantPayment({ ...input, amountMinor }, store)).toMatchObject({ ok: false, code: 'INVALID_AMOUNT_MINOR' });
    expect(store.inserted).toHaveLength(0);
  });

  it('rejects non-NGN currency', async () => {
    expect(await initializeTenantPayment({ ...input, currency: 'USD' as never }, makeStore())).toMatchObject({ ok: false, code: 'CURRENCY_NOT_SUPPORTED' });
  });

  it('rejects empty or placeholder email', async () => {
    expect(await initializeTenantPayment({ ...input, customerEmail: '' }, makeStore())).toMatchObject({ code: 'CUSTOMER_EMAIL_REQUIRED' });
    expect(await initializeTenantPayment({ ...input, customerEmail: 'noemail@example.com' }, makeStore())).toMatchObject({ code: 'CUSTOMER_EMAIL_REQUIRED' });
  });

  it('fails closed with no account, making zero provider calls', async () => {
    const store = makeStore({ loadAccount: jest.fn(async () => null) });
    expect(await initializeTenantPayment(input, store)).toMatchObject({ ok: false, code: 'SETTLEMENT_NOT_CONFIGURED' });
    expect(mockInit).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...account, status: 'pending' as const }],
    [{ ...account, status: 'suspended' as const }],
  ])('fails closed for non-active account %#', async (acct) => {
    expect(await initializeTenantPayment(input, makeStore({ loadAccount: jest.fn(async () => acct) }))).toMatchObject({ code: 'SETTLEMENT_NOT_CONFIGURED' });
  });

  it('fails closed when the policy is not accepted', async () => {
    const store = makeStore({ loadAccount: jest.fn(async () => ({ ...account, accepted: false })) });
    expect(await initializeTenantPayment(input, store)).toMatchObject({ code: 'POLICY_NOT_ACCEPTED' });
  });

  it('inserts the snapshot before calling Paystack, then sends the split', async () => {
    const order: string[] = [];
    const store = makeStore({
      insertPending: jest.fn(async () => { order.push('insert'); return { id: 'tx_1' }; }),
    });
    mockInit.mockImplementation(async () => { order.push('provider'); return { success: true, authorizationUrl: 'https://co' }; });
    const r = await initializeTenantPayment(input, store);
    expect(order).toEqual(['insert', 'provider']);
    expect(r).toMatchObject({ ok: true, transactionId: 'tx_1', authorizationUrl: 'https://co', reused: false,
      snapshot: { amountMinor: 500000, platformFeeMinor: 5000, tenantGrossMinor: 495000, subaccountCode: 'ACCT_1', feeBearer: 'subaccount', policyCode: 'pilot_ngn_v1', policyVersion: 1 } });
    const row = (store.insertPending as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({ tenant_id: 't1', amount: 5000, amount_minor: 500000, platform_fee_minor: 5000,
      tenant_gross_minor: 495000, settlement_subaccount_code: 'ACCT_1', settlement_fee_bearer: 'subaccount',
      settlement_policy_code: 'pilot_ngn_v1', settlement_policy_version: 1, settlement_idempotency_key: 'deposit:r1',
      settlement_verification_status: 'pending', status: 'pending', type: 'deposit', subject_type: 'reservation', subject_id: 'r1', currency: 'NGN' });
    expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 500000, subaccountCode: 'ACCT_1', transactionChargeMinor: 5000, currency: 'NGN' }));
    expect(store.initialized).toEqual(['tx_1']);
  });

  it('sends 500000 for NGN 5,000, never 50000000', async () => {
    mockInit.mockResolvedValue({ success: true, authorizationUrl: 'u' });
    await initializeTenantPayment(input, makeStore());
    expect((mockInit.mock.calls[0][0] as { amountMinor: number }).amountMinor).toBe(500000);
  });

  it('does not call Paystack when the insert fails', async () => {
    const store = makeStore({ insertPending: jest.fn(async () => { throw new Error('db down'); }) });
    expect(await initializeTenantPayment(input, store)).toMatchObject({ code: 'TRANSACTION_INSERT_FAILED' });
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('marks the row failed when Paystack rejects', async () => {
    mockInit.mockResolvedValue({ success: false, error: 'Invalid subaccount' });
    const store = makeStore();
    expect(await initializeTenantPayment(input, store)).toMatchObject({ code: 'PROVIDER_INITIALIZATION_FAILED' });
    expect(store.failed).toEqual(['tx_1']);
  });

  it('reuses an existing pending checkout with an identical snapshot', async () => {
    const store = makeStore({ findByIdempotencyKey: jest.fn(async () => ({
      id: 'tx_old', status: 'pending', providerReference: 'bk_old', authorizationUrl: 'https://old',
      subjectType: 'reservation', subjectId: 'r1', amountMinor: 500000, platformFeeMinor: 5000,
      subaccountCode: 'ACCT_1', policyCode: 'pilot_ngn_v1', policyVersion: 1,
    })) });
    expect(await initializeTenantPayment(input, store)).toMatchObject({ ok: true, transactionId: 'tx_old', reused: true });
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('refuses to reuse when the amount changed', async () => {
    const store = makeStore({ findByIdempotencyKey: jest.fn(async () => ({
      id: 'tx_old', status: 'pending', providerReference: 'bk_old', authorizationUrl: 'https://old',
      subjectType: 'reservation', subjectId: 'r1', amountMinor: 400000, platformFeeMinor: 4000,
      subaccountCode: 'ACCT_1', policyCode: 'pilot_ngn_v1', policyVersion: 1,
    })) });
    expect(await initializeTenantPayment(input, store)).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('uses a reference Paystack accepts and never the wallet prefix', async () => {
    mockInit.mockResolvedValue({ success: true, authorizationUrl: 'u' });
    await initializeTenantPayment(input, makeStore());
    const ref = (mockInit.mock.calls[0][0] as { reference: string }).reference;
    expect(ref).toMatch(/^bk_[a-z0-9]{32}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/lib/payments/tenantSettlement.test.ts --runInBand`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import 'server-only';
import { randomUUID } from 'crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { initializeSplitTransaction } from '@/lib/paystack';
import { defaultLogger } from '@/lib/logger';
import { calculateSettlement, isValidAmountMinor, type FeePolicy } from './settlementPolicy';

/**
 * The only initializer for tenant customer payments (spec 2026-10-02 §5).
 * Fails closed: no account, no accepted policy, or collection disabled
 * means no Paystack request and no money collected.
 */

export type TenantPaymentSubject = { type: 'reservation' | 'retail_order' | 'payment_link'; id: string };

export type InitializeTenantPaymentInput = {
  tenantId: string;
  amountMinor: number;
  currency: 'NGN';
  customerEmail: string;
  subject: TenantPaymentSubject;
  idempotencyKey: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
};

export type SettlementSnapshot = {
  amountMinor: number;
  platformFeeMinor: number;
  tenantGrossMinor: number;
  subaccountCode: string;
  feeBearer: 'subaccount';
  policyCode: string;
  policyVersion: number;
};

export type SettlementFailureCode =
  | 'SETTLEMENT_DISABLED'
  | 'INVALID_AMOUNT_MINOR'
  | 'CURRENCY_NOT_SUPPORTED'
  | 'CUSTOMER_EMAIL_REQUIRED'
  | 'SETTLEMENT_NOT_CONFIGURED'
  | 'POLICY_NOT_ACCEPTED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'TRANSACTION_INSERT_FAILED'
  | 'PROVIDER_INITIALIZATION_FAILED';

export type InitializeTenantPaymentResult =
  | { ok: true; transactionId: string; reference: string; authorizationUrl: string; snapshot: SettlementSnapshot; reused: boolean }
  | { ok: false; code: SettlementFailureCode; message: string };

/** Safe for customers and owners; never reveals configuration detail. */
export const SETTLEMENT_CUSTOMER_MESSAGE = 'Online payment is not available for this business right now.';

export type StoredAccount = {
  subaccountCode: string | null;
  status: 'pending' | 'active' | 'suspended' | 'invalid';
  accepted: boolean;
  policyCode: string;
  policyVersion: number;
};

export type ExistingSettlement = {
  id: string;
  status: string;
  providerReference: string | null;
  authorizationUrl: string | null;
  subjectType: string | null;
  subjectId: string | null;
  amountMinor: number | null;
  platformFeeMinor: number | null;
  subaccountCode: string | null;
  policyCode: string | null;
  policyVersion: number | null;
};

export interface SettlementStore {
  loadAccount(tenantId: string, currency: 'NGN'): Promise<StoredAccount | null>;
  loadPolicy(code: string, version: number): Promise<FeePolicy | null>;
  findByIdempotencyKey(tenantId: string, key: string): Promise<ExistingSettlement | null>;
  insertPending(row: Record<string, unknown>): Promise<{ id: string }>;
  markInitialized(id: string, authorizationUrl: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}

const TRANSACTION_TYPE: Record<TenantPaymentSubject['type'], string> = {
  reservation: 'deposit',
  retail_order: 'retail_order',
  payment_link: 'payment_link',
};

const PLACEHOLDER_EMAILS = new Set(['noemail@example.com']);

export function isTenantPaymentsEnabled(): boolean {
  return process.env.BOOKA_TENANT_PAYMENTS === 'live';
}

function fail(code: SettlementFailureCode, message: string): InitializeTenantPaymentResult {
  return { ok: false, code, message };
}

export async function initializeTenantPayment(
  input: InitializeTenantPaymentInput,
  store: SettlementStore = defaultStore(),
): Promise<InitializeTenantPaymentResult> {
  if (!isTenantPaymentsEnabled()) return fail('SETTLEMENT_DISABLED', SETTLEMENT_CUSTOMER_MESSAGE);
  if (!isValidAmountMinor(input.amountMinor)) return fail('INVALID_AMOUNT_MINOR', 'Amount must be a positive whole number of kobo');
  if (input.currency !== 'NGN') return fail('CURRENCY_NOT_SUPPORTED', 'Only NGN payments are supported');
  const email = input.customerEmail?.trim().toLowerCase() ?? '';
  if (!email || PLACEHOLDER_EMAILS.has(email)) return fail('CUSTOMER_EMAIL_REQUIRED', 'A customer email is required');

  const account = await store.loadAccount(input.tenantId, 'NGN');
  if (!account || account.status !== 'active' || !account.subaccountCode) {
    return fail('SETTLEMENT_NOT_CONFIGURED', SETTLEMENT_CUSTOMER_MESSAGE);
  }
  if (!account.accepted) return fail('POLICY_NOT_ACCEPTED', SETTLEMENT_CUSTOMER_MESSAGE);
  const policy = await store.loadPolicy(account.policyCode, account.policyVersion);
  if (!policy) return fail('SETTLEMENT_NOT_CONFIGURED', SETTLEMENT_CUSTOMER_MESSAGE);

  const amounts = calculateSettlement(input.amountMinor, policy);
  const snapshot: SettlementSnapshot = {
    ...amounts,
    subaccountCode: account.subaccountCode,
    feeBearer: 'subaccount',
    policyCode: policy.code,
    policyVersion: policy.version,
  };

  const existing = await store.findByIdempotencyKey(input.tenantId, input.idempotencyKey);
  if (existing) {
    const matches = existing.status === 'pending'
      && existing.subjectType === input.subject.type
      && existing.subjectId === input.subject.id
      && existing.amountMinor === snapshot.amountMinor
      && existing.platformFeeMinor === snapshot.platformFeeMinor
      && existing.subaccountCode === snapshot.subaccountCode
      && existing.policyCode === snapshot.policyCode
      && existing.policyVersion === snapshot.policyVersion
      && Boolean(existing.providerReference && existing.authorizationUrl);
    if (!matches) return fail('IDEMPOTENCY_CONFLICT', 'A different payment already exists for this request');
    return { ok: true, transactionId: existing.id, reference: existing.providerReference!, authorizationUrl: existing.authorizationUrl!, snapshot, reused: true };
  }

  const reference = `bk_${randomUUID().replace(/-/g, '')}`;
  let inserted: { id: string };
  try {
    inserted = await store.insertPending({
      tenant_id: input.tenantId,
      amount: snapshot.amountMinor / 100, // legacy major-unit column (spec §4.2)
      currency: 'NGN',
      type: TRANSACTION_TYPE[input.subject.type],
      status: 'pending',
      provider_reference: reference,
      subject_type: input.subject.type,
      subject_id: input.subject.id,
      amount_minor: snapshot.amountMinor,
      platform_fee_minor: snapshot.platformFeeMinor,
      tenant_gross_minor: snapshot.tenantGrossMinor,
      settlement_subaccount_code: snapshot.subaccountCode,
      settlement_fee_bearer: snapshot.feeBearer,
      settlement_policy_code: snapshot.policyCode,
      settlement_policy_version: snapshot.policyVersion,
      settlement_idempotency_key: input.idempotencyKey,
      settlement_verification_status: 'pending',
      raw: { provider: 'paystack', ref: reference, email, subject: input.subject },
    });
  } catch (error) {
    defaultLogger.error('[tenantSettlement] pending insert failed', { tenantId: input.tenantId, error: (error as Error).message });
    return fail('TRANSACTION_INSERT_FAILED', 'Could not start the payment. Please try again.');
  }

  const init = await initializeSplitTransaction({
    email,
    amountMinor: snapshot.amountMinor,
    reference,
    currency: 'NGN',
    subaccountCode: snapshot.subaccountCode,
    transactionChargeMinor: snapshot.platformFeeMinor,
    callbackUrl: input.callbackUrl,
    metadata: { ...input.metadata, booka_subject_type: input.subject.type },
  }).catch((error: Error) => ({ success: false as const, error: error.message, authorizationUrl: undefined }));

  if (!init.success || !init.authorizationUrl) {
    await store.markFailed(inserted.id, init.error ?? 'no_authorization_url');
    return fail('PROVIDER_INITIALIZATION_FAILED', 'Could not start the payment. Please try again.');
  }

  await store.markInitialized(inserted.id, init.authorizationUrl);
  return { ok: true, transactionId: inserted.id, reference, authorizationUrl: init.authorizationUrl, snapshot, reused: false };
}

function defaultStore(): SettlementStore {
  const admin = createSupabaseAdminClient();
  return {
    async loadAccount(tenantId, currency) {
      const { data, error } = await admin
        .from('tenant_payment_accounts')
        .select('subaccount_code, status, accepted_at, accepted_by, policy_code, policy_version')
        .eq('tenant_id', tenantId).eq('provider', 'paystack').eq('currency', currency)
        .maybeSingle();
      if (error) throw new Error(`payment account lookup failed: ${error.message}`);
      if (!data) return null;
      return {
        subaccountCode: data.subaccount_code,
        status: data.status,
        accepted: Boolean(data.accepted_at && data.accepted_by),
        policyCode: data.policy_code,
        policyVersion: data.policy_version,
      };
    },
    async loadPolicy(code, version) {
      const { data, error } = await admin
        .from('payment_fee_policies')
        .select('code, version, platform_fee_basis_points, platform_fee_cap_minor, fee_bearer, active')
        .eq('code', code).eq('version', version).maybeSingle();
      if (error) throw new Error(`fee policy lookup failed: ${error.message}`);
      if (!data || !data.active) return null;
      return {
        code: data.code,
        version: data.version,
        basisPoints: data.platform_fee_basis_points,
        capMinor: data.platform_fee_cap_minor === null ? null : Number(data.platform_fee_cap_minor),
        feeBearer: 'subaccount',
      };
    },
    async findByIdempotencyKey(tenantId, key) {
      const { data, error } = await admin
        .from('transactions')
        .select('id, status, provider_reference, raw, subject_type, subject_id, amount_minor, platform_fee_minor, settlement_subaccount_code, settlement_policy_code, settlement_policy_version')
        .eq('tenant_id', tenantId).eq('settlement_idempotency_key', key).maybeSingle();
      if (error) throw new Error(`idempotency lookup failed: ${error.message}`);
      if (!data) return null;
      const raw = (data.raw ?? {}) as { authorization_url?: string };
      return {
        id: data.id,
        status: data.status,
        providerReference: data.provider_reference,
        authorizationUrl: raw.authorization_url ?? null,
        subjectType: data.subject_type,
        subjectId: data.subject_id,
        amountMinor: data.amount_minor === null ? null : Number(data.amount_minor),
        platformFeeMinor: data.platform_fee_minor === null ? null : Number(data.platform_fee_minor),
        subaccountCode: data.settlement_subaccount_code,
        policyCode: data.settlement_policy_code,
        policyVersion: data.settlement_policy_version,
      };
    },
    async insertPending(row) {
      const { data, error } = await admin.from('transactions').insert(row).select('id').single();
      if (error || !data) throw new Error(error?.message ?? 'insert returned no row');
      return { id: data.id };
    },
    async markInitialized(id, authorizationUrl) {
      const { data } = await admin.from('transactions').select('raw').eq('id', id).maybeSingle();
      const raw = (data?.raw ?? {}) as Record<string, unknown>;
      const { error } = await admin.from('transactions').update({ raw: { ...raw, authorization_url: authorizationUrl } }).eq('id', id);
      if (error) defaultLogger.warn('[tenantSettlement] could not store checkout url', { id, error: error.message });
    },
    async markFailed(id, message) {
      const { error } = await admin.from('transactions')
        .update({ status: 'failed', settlement_verification_status: 'not_applicable', updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) defaultLogger.error('[tenantSettlement] could not mark failed', { id, error: error.message, cause: message });
    },
  };
}
```

If `server-only` is not installed (`ls node_modules/server-only`), remove that import line; do not add a dependency.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/lib/payments/tenantSettlement.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/tenantSettlement.ts src/__tests__/lib/payments/tenantSettlement.test.ts
git commit -m "feat(payments): add fail-closed tenant settlement boundary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Reservation payment handoff and auto-cancel exemption

**Files:**
- Create: `src/lib/payments/paymentHandoff.ts`
- Modify: `src/app/api/jobs/auto-cancel-unconfirmed/route.ts:76-80` (inside the `for (const booking ...)` loop)
- Test: `src/__tests__/lib/payments/paymentHandoff.test.ts`, extend `src/__tests__/app/api/jobs/auto-cancel.test.ts`

**Interfaces:**
- Consumes: `SettlementFailureCode` (Task 4).
- Produces:
  - `openReservationPaymentHandoff(input: { tenantId: string; reservationId: string; reason: SettlementFailureCode; customerPhone: string | null; threadId?: string | null }, store?: PaymentHandoffStore): Promise<void>`
  - `isPaymentHandoffOpen(metadata: unknown): boolean`
  - `PAYMENT_HANDOFF_CUSTOMER_MESSAGE: string`

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/lib/payments/paymentHandoff.test.ts
import { describe, it, expect, jest } from '@jest/globals';
jest.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: jest.fn() }));
import { isPaymentHandoffOpen, openReservationPaymentHandoff, type PaymentHandoffStore } from '@/lib/payments/paymentHandoff';

describe('isPaymentHandoffOpen', () => {
  it('is true only for an open handoff object', () => {
    expect(isPaymentHandoffOpen({ payment_handoff: { status: 'open' } })).toBe(true);
    expect(isPaymentHandoffOpen({ payment_handoff: { status: 'resolved' } })).toBe(false);
    expect(isPaymentHandoffOpen(null)).toBe(false);
    expect(isPaymentHandoffOpen({ payment_handoff: 'open' })).toBe(false);
  });
});

describe('openReservationPaymentHandoff', () => {
  const makeStore = () => ({
    loadMetadata: jest.fn(async () => ({ customer_name: 'Ada' })),
    saveMetadata: jest.fn(async () => undefined),
    insertEscalation: jest.fn(async () => undefined),
  }) satisfies PaymentHandoffStore;

  it('marks the reservation open (keeping existing metadata) and escalates once', async () => {
    const store = makeStore();
    await openReservationPaymentHandoff({ tenantId: 't1', reservationId: 'r1', reason: 'SETTLEMENT_NOT_CONFIGURED', customerPhone: '+234', threadId: 'th1' }, store);
    const saved = store.saveMetadata.mock.calls[0][2] as Record<string, unknown>;
    expect(saved.customer_name).toBe('Ada');
    expect(saved.payment_handoff).toMatchObject({ status: 'open', reason: 'SETTLEMENT_NOT_CONFIGURED' });
    expect(store.insertEscalation).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 't1', session_id: 'reservation:r1', reason_code: 'payment_settlement', status: 'pending',
      customer_phone: '+234', conversation_thread_id: 'th1',
    }));
  });

  it('treats a duplicate escalation as success (idempotent)', async () => {
    const store = makeStore();
    store.insertEscalation.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(openReservationPaymentHandoff({ tenantId: 't1', reservationId: 'r1', reason: 'SETTLEMENT_DISABLED', customerPhone: null }, store)).resolves.toBeUndefined();
  });
});
```

Add to `src/__tests__/app/api/jobs/auto-cancel.test.ts` (follow that file's existing mock setup for a tenant with two pending bookings): one booking with `metadata: { payment_handoff: { status: 'open' } }` and one without. Assert only the second receives the `status: 'cancelled'` update and `results.processed` counts both.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/payments/paymentHandoff.test.ts src/__tests__/app/api/jobs/auto-cancel.test.ts --runInBand`
Expected: FAIL — module not found, and the open-handoff booking gets cancelled.

- [ ] **Step 3: Implement `paymentHandoff.ts`**

```ts
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import type { SettlementFailureCode } from './tenantSettlement';

/**
 * When a deposit cannot be collected (settlement not configured / disabled /
 * provider failure), the reservation stays `pending`, a teammate is asked to
 * arrange payment, and auto-cancel leaves it alone (owner decision 2026-10-02).
 * Staff resolve it by confirming or cancelling the reservation.
 */
export const PAYMENT_HANDOFF_CUSTOMER_MESSAGE =
  "Your booking request is saved. We couldn't create a payment link right now, so a team member will message you here to arrange your deposit.";

export interface PaymentHandoffStore {
  loadMetadata(tenantId: string, reservationId: string): Promise<Record<string, unknown> | null>;
  saveMetadata(tenantId: string, reservationId: string, metadata: Record<string, unknown>): Promise<void>;
  insertEscalation(row: Record<string, unknown>): Promise<void>;
}

export function isPaymentHandoffOpen(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const handoff = (metadata as Record<string, unknown>).payment_handoff;
  return Boolean(handoff && typeof handoff === 'object' && (handoff as Record<string, unknown>).status === 'open');
}

export async function openReservationPaymentHandoff(
  input: { tenantId: string; reservationId: string; reason: SettlementFailureCode; customerPhone: string | null; threadId?: string | null },
  store: PaymentHandoffStore = defaultStore(),
): Promise<void> {
  const metadata = (await store.loadMetadata(input.tenantId, input.reservationId)) ?? {};
  await store.saveMetadata(input.tenantId, input.reservationId, {
    ...metadata,
    payment_handoff: { status: 'open', reason: input.reason, opened_at: new Date().toISOString() },
  });
  try {
    await store.insertEscalation({
      tenant_id: input.tenantId,
      customer_phone: input.customerPhone ?? `reservation:${input.reservationId}`,
      session_id: `reservation:${input.reservationId}`,
      conversation_thread_id: input.threadId ?? null,
      reason: 'Deposit link could not be created; a teammate must arrange payment',
      reason_code: 'payment_settlement',
      status: 'pending',
    });
  } catch (error) {
    if ((error as { code?: string }).code !== '23505') throw error;
  }
}

function defaultStore(): PaymentHandoffStore {
  const admin = createSupabaseAdminClient();
  return {
    async loadMetadata(tenantId, reservationId) {
      const { data, error } = await admin.from('reservations').select('metadata').eq('tenant_id', tenantId).eq('id', reservationId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.metadata as Record<string, unknown> | null) ?? null;
    },
    async saveMetadata(tenantId, reservationId, metadata) {
      const { error } = await admin.from('reservations').update({ metadata }).eq('tenant_id', tenantId).eq('id', reservationId);
      if (error) throw new Error(error.message);
    },
    async insertEscalation(row) {
      const { error } = await admin.from('escalation_queue').insert(row);
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
    },
  };
}
```

Before relying on these columns, confirm `escalation_queue` has `customer_phone`, `session_id`, `conversation_thread_id`, `reason`, `status` by reading `src/lib/commerce/retail-fulfillment-escalation.ts:160-170` (it inserts the same columns).

- [ ] **Step 4: Exempt open handoffs in auto-cancel**

In `src/app/api/jobs/auto-cancel-unconfirmed/route.ts`, add the import and, as the first statements inside `for (const booking of (bookings || []) as UnconfirmedBooking[]) {` right after `results.processed++;`:

```ts
import { isPaymentHandoffOpen } from '@/lib/payments/paymentHandoff';
// ...
          // Owner decision 2026-10-02: a booking waiting on a payment handoff
          // is resolved by staff, never by the sweep.
          if (isPaymentHandoffOpen(booking.metadata)) continue;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/payments/paymentHandoff.test.ts src/__tests__/app/api/jobs/auto-cancel.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/payments/paymentHandoff.ts src/app/api/jobs/auto-cancel-unconfirmed/route.ts src/__tests__/lib/payments/paymentHandoff.test.ts src/__tests__/app/api/jobs/auto-cancel.test.ts
git commit -m "feat(payments): hand off uncollectable deposits to staff

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Conversational deposits (WhatsApp/Instagram v2 and legacy dialog)

**Files:**
- Modify: `src/lib/whatsapp/v2/flows/customerBooking.ts:672-704` (deposit block) and remove the `PaymentService` import (line 16)
- Modify: `src/lib/dialogBookingBridge.ts:574-618`
- Test: `src/__tests__/lib/whatsapp/v2/customerBooking.deposit.test.ts`, `src/__tests__/lib/dialogBookingBridge.deposit.test.ts`

**Interfaces:**
- Consumes: `initializeTenantPayment`, `InitializeTenantPaymentResult` (Task 4); `openReservationPaymentHandoff`, `PAYMENT_HANDOFF_CUSTOMER_MESSAGE` (Task 5).

- [ ] **Step 1: Write the failing WhatsApp v2 test**

Mock `@/lib/payments/tenantSettlement` and `@/lib/payments/paymentHandoff`. Reuse the module mocks already used by `src/__tests__/lib/whatsapp/v2/actionValidator.test.ts` for Supabase and conversation helpers, and drive the confirm path the same way existing customerBooking tests do (search `grep -rl "customerBooking" src/__tests__` and copy the closest fixture). Assertions:

```ts
it('initializes the deposit through the settlement boundary in kobo', async () => {
  mockInitializeTenantPayment.mockResolvedValue({ ok: true, transactionId: 'tx', reference: 'bk_x', authorizationUrl: 'https://co', snapshot: {} as never, reused: false });
  const reply = await runConfirmWithDeposit({ depositAmountCents: 500000 });
  expect(mockInitializeTenantPayment).toHaveBeenCalledWith(expect.objectContaining({
    tenantId: 't1', amountMinor: 500000, currency: 'NGN', subject: { type: 'reservation', id: 'res_1' },
    idempotencyKey: 'deposit:res_1',
  }));
  expect(reply).toContain('https://co');
});

it('keeps the reservation pending and hands off when settlement fails', async () => {
  mockInitializeTenantPayment.mockResolvedValue({ ok: false, code: 'SETTLEMENT_NOT_CONFIGURED', message: 'x' });
  const reply = await runConfirmWithDeposit({ depositAmountCents: 500000 });
  expect(mockOpenHandoff).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', reservationId: 'res_1', reason: 'SETTLEMENT_NOT_CONFIGURED' }));
  expect(updatedReservationStatuses()).not.toContain('cancelled');
  expect(mockTransitionThread).toHaveBeenCalledWith(expect.objectContaining({ to: 'handed_off' }));
  expect(reply).toBe(PAYMENT_HANDOFF_CUSTOMER_MESSAGE);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/__tests__/lib/whatsapp/v2/customerBooking.deposit.test.ts --runInBand`
Expected: FAIL — `PaymentService.initializePayment` is still called and the reservation is cancelled.

- [ ] **Step 3: Replace the v2 deposit block**

Replace lines 672–704 (from `const paymentService = new PaymentService(supabaseAdmin);` through the failure `return 'Sorry, we could not create your deposit link right now. Please try again.';` block) with:

```ts
    const customerEmail = getCustomerEmail(customer?.email ?? null, phone);
    const paymentResult = await runIdempotentEffect({
      tenantId,
      threadId: executionContext.threadId,
      idempotencyKey: `${executionContext.correlationKey}:initialize_deposit:${effectDigest}`,
      effectType: 'initialize_deposit',
      execute: () => initializeTenantPayment({
        tenantId,
        amountMinor: depositAmountCents,
        currency: 'NGN',
        customerEmail,
        subject: { type: 'reservation', id: reservation.id },
        idempotencyKey: `deposit:${reservation.id}`,
        metadata: { type: 'deposit', booking_noun: 'appointment' },
      }),
      resultRef: (value) => (value.ok ? value.transactionId : null),
    });

    if (!paymentResult.ok) {
      defaultLogger.warn('[customerBooking] deposit not collectable; handing off', {
        tenantId, reservationId: reservation.id, code: paymentResult.code,
      });
      await openReservationPaymentHandoff({
        tenantId,
        reservationId: reservation.id,
        reason: paymentResult.code,
        customerPhone: phone,
        threadId: executionContext.threadId,
      });
      await transitionThread({
        tenantId,
        threadId: executionContext.threadId,
        from: ['active'],
        to: 'handed_off',
      });
      return PAYMENT_HANDOFF_CUSTOMER_MESSAGE;
    }
```

Then rename later uses in the same block: `paymentResult.authorizationUrl` stays valid on the `ok: true` branch; replace any `paymentResult.transactionId` reads accordingly. Keep the slot lock: the reservation is held pending, so do **not** call `releaseLock` on this path. Add imports:

```ts
import { initializeTenantPayment } from '@/lib/payments/tenantSettlement';
import { openReservationPaymentHandoff, PAYMENT_HANDOFF_CUSTOMER_MESSAGE } from '@/lib/payments/paymentHandoff';
```

Remove `import PaymentService from '@/lib/paymentService';` if no other use remains (`grep -n PaymentService src/lib/whatsapp/v2/flows/customerBooking.ts`). Check `transitionThread`'s `from` type in `src/lib/whatsapp/v2/conversationThread.ts:266` and use the existing literal union.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/__tests__/lib/whatsapp/v2/customerBooking.deposit.test.ts src/__tests__/lib/whatsapp/v2 --runInBand`
Expected: PASS, and no previously-passing v2 test regresses.

- [ ] **Step 5: Write the failing legacy dialog test**

Construct the bridge with a Supabase fake where `services` returns `{ price: 10000, currency: 'NGN' }` and `tenants` returns `settings: { requireDeposit: true, depositPercent: 20 }`. Assert:

```ts
expect(mockInitializeTenantPayment).toHaveBeenCalledWith(expect.objectContaining({
  amountMinor: 200000, // 20% of NGN 10,000 — not the full price
  subject: { type: 'reservation', id: 'res_1' }, idempotencyKey: 'deposit:res_1',
}));
```

A second test: when `initializeTenantPayment` returns `{ ok: false, code: 'SETTLEMENT_DISABLED' }`, the reply equals `PAYMENT_HANDOFF_CUSTOMER_MESSAGE`, `openReservationPaymentHandoff` is called, and `sendBookingConfirmedResponse` is **not** called. A third: when the tenant does not require a deposit, no initializer is called and the confirmed response is sent.

- [ ] **Step 6: Run to verify it fails**

Run: `npx jest src/__tests__/lib/dialogBookingBridge.deposit.test.ts --runInBand`
Expected: FAIL.

- [ ] **Step 7: Extract the shared deposit rule and replace the dialog block**

In `src/lib/publicBookingService.ts`, extract the existing deposit computation (lines ~52–76) into an exported pure helper so both channels use one rule:

```ts
/** Tenant deposit rule shared by public booking and the legacy dialog bridge. */
export function computeDepositMinor(input: {
  tenantSettings: Record<string, unknown>;
  tenantMetadata: Record<string, unknown>;
  servicePriceCents: number;
}): number {
  const ui = (input.tenantMetadata.ui_settings && typeof input.tenantMetadata.ui_settings === 'object'
    ? input.tenantMetadata.ui_settings : {}) as Record<string, unknown>;
  const requireDeposit = (input.tenantSettings.requireDeposit ?? ui.requireDeposit) === true;
  const depositPercent = Number(input.tenantSettings.depositPercent ?? ui.depositPercent ?? 0);
  if (!requireDeposit || !(depositPercent > 0)) return 0;
  return Math.round((input.servicePriceCents * depositPercent) / 100);
}
```

Add unit tests for it in `src/__tests__/lib/publicBooking.deposit.test.ts` (no deposit flag → 0; 20% of 1,000,000 → 200,000; percent in `metadata.ui_settings` honored).

In `dialogBookingBridge.ts`, replace lines 574–618 (service price fetch through the `catch (payErr)` block) with:

```ts
      const { data: service } = await this.supabase
        .from('services').select('price, price_cents').eq('id', state.serviceId!).maybeSingle();
      const { data: tenantRow } = await this.supabase
        .from('tenants').select('settings, metadata').eq('id', tenantId).maybeSingle();
      const servicePriceCents = typeof service?.price_cents === 'number'
        ? service.price_cents
        : Math.round(Number(service?.price ?? 0) * 100);
      const depositMinor = computeDepositMinor({
        tenantSettings: (tenantRow?.settings ?? {}) as Record<string, unknown>,
        tenantMetadata: (tenantRow?.metadata ?? {}) as Record<string, unknown>,
        servicePriceCents,
      });

      let paymentUrl: string | null = null;
      if (depositMinor > 0) {
        const result = await initializeTenantPayment({
          tenantId,
          amountMinor: depositMinor,
          currency: 'NGN',
          // Owner decision 4: same deterministic phone-derived fallback as v2.
          customerEmail: getCustomerEmail(state.customerEmail ?? null, state.customerPhone ?? ''),
          subject: { type: 'reservation', id: reservation.id },
          idempotencyKey: `deposit:${reservation.id}`,
          metadata: { session_id: sessionId, source: 'whatsapp_conversation' },
        });
        if (!result.ok) {
          await openReservationPaymentHandoff({
            tenantId, reservationId: reservation.id, reason: result.code, customerPhone: state.customerPhone ?? null,
          });
          state.step = 'payment_pending';
          await this.updateSessionState(sessionId, state, tenantId);
          return { response: PAYMENT_HANDOFF_CUSTOMER_MESSAGE, completed: false, nextStep: 'payment_pending' };
        }
        paymentUrl = result.authorizationUrl;
      }
```

Export the existing helper in `customerBooking.ts:1304` (`function getCustomerEmail` → `export function getCustomerEmail`) and import it into the bridge. It returns `noemail+<digits>@example.com`, which is per-customer, not the shared placeholder the boundary rejects. Keep the existing `if (paymentUrl) { ... }` block and the no-deposit confirmation unchanged. Confirm `services.price_cents` exists in `db/schema/live_schema_2026-07-30.md`; if it does not, select only `price`. Add the three imports.

- [ ] **Step 8: Run tests**

Run: `npx jest src/__tests__/lib/dialogBookingBridge.deposit.test.ts src/__tests__/lib/publicBooking.deposit.test.ts src/__tests__/lib/dialog-business-hours.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/whatsapp/v2/flows/customerBooking.ts src/lib/dialogBookingBridge.ts src/lib/publicBookingService.ts src/__tests__/lib/whatsapp/v2/customerBooking.deposit.test.ts src/__tests__/lib/dialogBookingBridge.deposit.test.ts src/__tests__/lib/publicBooking.deposit.test.ts
git commit -m "feat(payments): settle conversational deposits through one boundary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Public booking deposit

**Files:**
- Modify: `src/lib/publicBookingService.ts:28-104` (`BookingDepositInfo`, `maybeCreateBookingDeposit`)
- Modify: `src/app/book/[slug]/components/BookingContainer.tsx:121-131`
- Test: `src/__tests__/lib/publicBooking.deposit.test.ts` (extend), `src/__tests__/app/book/BookingContainer.deposit.test.tsx`

**Interfaces:**
- Consumes: `computeDepositMinor` (Task 6), `initializeTenantPayment` (Task 4), `openReservationPaymentHandoff` (Task 5).
- Produces: `BookingDepositInfo` gains `paymentUnavailable?: boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
it('returns paymentUnavailable and opens a handoff when settlement fails', async () => {
  mockInitializeTenantPayment.mockResolvedValue({ ok: false, code: 'SETTLEMENT_NOT_CONFIGURED', message: 'x' });
  const info = await maybeCreateBookingDeposit({ tenantId: 't1', reservationId: 'r1', serviceId: 's1', email: 'c@x.co' });
  expect(info).toEqual({ depositRequired: true, paymentUnavailable: true, depositAmountCents: 200000, currency: 'NGN' });
  expect(mockOpenHandoff).toHaveBeenCalledWith(expect.objectContaining({ reservationId: 'r1', reason: 'SETTLEMENT_NOT_CONFIGURED' }));
});

it('passes kobo unchanged to the boundary', async () => {
  mockInitializeTenantPayment.mockResolvedValue({ ok: true, transactionId: 'tx', reference: 'bk', authorizationUrl: 'https://co', snapshot: {} as never, reused: false });
  const info = await maybeCreateBookingDeposit({ tenantId: 't1', reservationId: 'r1', serviceId: 's1', email: 'c@x.co' });
  expect(mockInitializeTenantPayment).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 200000, idempotencyKey: 'deposit:r1' }));
  expect(info).toMatchObject({ depositRequired: true, paymentUrl: 'https://co' });
});
```

Export `maybeCreateBookingDeposit` for testing (add `export`). For the UI test: render `BookingContainer` with the booking API mocked to resolve `{ depositRequired: true, paymentUnavailable: true }` and assert the toast says the business will contact the customer, no redirect happens, and the "Booking Confirmed" toast is **not** shown.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/__tests__/lib/publicBooking.deposit.test.ts src/__tests__/app/book/BookingContainer.deposit.test.tsx --runInBand`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add `paymentUnavailable?: boolean;` to `BookingDepositInfo`. Rewrite the body of `maybeCreateBookingDeposit` after the tenant/service loads:

```ts
    const depositMinor = computeDepositMinor({ tenantSettings: settings, tenantMetadata: metadata, servicePriceCents: priceCents });
    if (!(depositMinor > 0)) return { depositRequired: false };

    const result = await initializeTenantPayment({
      tenantId: input.tenantId,
      amountMinor: depositMinor,
      currency: 'NGN',
      customerEmail: input.email,
      subject: { type: 'reservation', id: input.reservationId },
      idempotencyKey: `deposit:${input.reservationId}`,
      callbackUrl: input.callbackUrl ?? undefined,
      metadata: { type: 'deposit' },
    });
    if (result.ok) {
      return { depositRequired: true, paymentUrl: result.authorizationUrl, depositAmountCents: depositMinor, currency: 'NGN' };
    }
    await openReservationPaymentHandoff({ tenantId: input.tenantId, reservationId: input.reservationId, reason: result.code, customerPhone: null });
    return { depositRequired: true, paymentUnavailable: true, depositAmountCents: depositMinor, currency: 'NGN' };
```

Delete the `subaccountCode` metadata read and the `PaymentService` import. Change the outer `catch` to return `{ depositRequired: true, paymentUnavailable: true }` (fail closed, never "no deposit"). Keep the early `return { depositRequired: false }` only for "no service/email" and "tenant does not require a deposit".

In `BookingContainer.tsx`, before the existing `if (result.depositRequired && result.paymentUrl)` block:

```tsx
      if (result.depositRequired && result.paymentUnavailable) {
        toast({
          title: 'Booking request received',
          description: "Online payment isn't available right now. The business will contact you to arrange your deposit.",
          type: 'info',
        });
        return;
      }
```

Use whichever toast `type` values the component already uses (`grep -n "type: '" src/app/book/[slug]/components/BookingContainer.tsx`).

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest src/__tests__/lib/publicBooking.deposit.test.ts src/__tests__/app/book/BookingContainer.deposit.test.tsx src/__tests__/lib/public-booking-tenant-info.test.ts src/__tests__/lib/public-booking-hours.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/publicBookingService.ts "src/app/book/[slug]/components/BookingContainer.tsx" src/__tests__/lib/publicBooking.deposit.test.ts src/__tests__/app/book/BookingContainer.deposit.test.tsx
git commit -m "feat(payments): fail public booking deposits closed with handoff

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Dashboard deposits, payment links, and retail

**Files:**
- Modify: `src/app/api/payments/deposits/route.ts` (whole POST body)
- Modify: `src/app/api/payments/links/route.ts:43-101`
- Modify: `src/app/dashboard/payment-links/page.tsx` (request body field)
- Modify: `src/lib/commerce/retail-orders.ts:528-640`
- Test: `src/__tests__/app/api/payments/deposits.test.ts` (update), `src/__tests__/app/api/payments/links.test.ts` (create), `src/__tests__/lib/commerce/retail-orders.inventory.test.ts` (update mock), `src/__tests__/lib/commerce/retail-orders.settlement.test.ts` (create)

**Interfaces:**
- Consumes: `initializeTenantPayment`, `SETTLEMENT_CUSTOMER_MESSAGE` (Task 4).
- Produces: `POST /api/payments/deposits` body `{ amountMinor: number; email: string; reservationId: string }`; `POST /api/payments/links` body keeps `amount` in naira (UI field) and converts once server-side.

- [ ] **Step 1: Update the deposits route test first**

In `deposits.test.ts`, replace the `@/lib/paymentService` mock with:

```ts
const mockInitializeTenantPayment = jest.fn();
jest.mock('@/lib/payments/tenantSettlement', () => ({
  initializeTenantPayment: (...a: unknown[]) => mockInitializeTenantPayment(...a),
  SETTLEMENT_CUSTOMER_MESSAGE: 'Online payment is not available for this business right now.',
}));
```

Assertions to add:
- body `{ amountMinor: 500000, email, reservationId }` → `mockInitializeTenantPayment` called with `amountMinor: 500000`, `subject: { type: 'reservation', id }`, `idempotencyKey: 'deposit:<id>'`, tenant from the verified context.
- body with `amount` instead of `amountMinor` → 400.
- `amountMinor: 1.5` → 400.
- settlement result `{ ok: false, code: 'SETTLEMENT_NOT_CONFIGURED' }` → 409 with `code: 'SETTLEMENT_NOT_CONFIGURED'` and a message mentioning Settings → Payments.
- result `{ ok: false, code: 'IDEMPOTENCY_CONFLICT' }` → 409.

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/__tests__/app/api/payments/deposits.test.ts --runInBand`
Expected: FAIL.

- [ ] **Step 3: Rewrite the deposits POST**

```ts
export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { createHttpHandler, getVerifiedTenantId, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { initializeTenantPayment } from '@/lib/payments/tenantSettlement';
import { recordFrontDeskEvent } from '@/lib/ai/front-desk-events';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

const DepositSchema = z.object({
  amountMinor: z.number().int().positive(),
  email: z.string().trim().email(),
  reservationId: z.string().uuid(),
}).strict();

export const POST = createHttpHandler(
  async (ctx) => {
    const parsed = DepositSchema.safeParse(await parseJsonBody<unknown>(ctx.request));
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.') || '_', i.message])));
    }
    const { amountMinor, email, reservationId } = parsed.data;
    const tenantId = getVerifiedTenantId(ctx);

    const { data: reservation } = await ctx.supabase
      .from('reservations').select('id, status').eq('id', reservationId).eq('tenant_id', tenantId).maybeSingle();
    if (!reservation) throw ApiErrorFactory.notFound('Reservation');
    if (reservation.status === 'cancelled') {
      throw ApiErrorFactory.validationError({ reservation: 'Cannot create deposit for cancelled reservation' });
    }

    const result = await initializeTenantPayment({
      tenantId,
      amountMinor,
      currency: 'NGN',
      customerEmail: email,
      subject: { type: 'reservation', id: reservationId },
      idempotencyKey: `deposit:${reservationId}`,
      metadata: { type: 'deposit', source: 'dashboard' },
    });

    if (!result.ok) {
      const configuration = ['SETTLEMENT_DISABLED', 'SETTLEMENT_NOT_CONFIGURED', 'POLICY_NOT_ACCEPTED'].includes(result.code);
      return NextResponse.json({
        success: false,
        code: result.code,
        error: configuration ? 'Payments are not set up yet. Finish setup in Settings → Payments.' : result.message,
      }, { status: configuration || result.code === 'IDEMPOTENCY_CONFLICT' ? 409 : 502 });
    }

    await recordFrontDeskEvent({
      tenantId,
      eventType: 'payment_requested',
      eventCategory: 'payment',
      channel: 'dashboard',
      actorRole: 'owner',
      actorId: ctx.user!.id,
      reservationId,
      correlationId: result.transactionId,
      amount: amountMinor / 100,
      currency: 'NGN',
      statusTo: 'initiated',
      metadata: { provider: 'paystack', payment_type: 'deposit', authorization_url: result.authorizationUrl },
    });

    return {
      success: true,
      transactionId: result.transactionId,
      authorizationUrl: result.authorizationUrl,
      duplicate: result.reused,
    };
  },
  'POST',
  // Keep the exact options object from the current file (roles/permissions).
);
```

Copy the current file's third argument to `createHttpHandler` verbatim (lines after `'POST',` at the bottom of the current route). If `parseJsonBody` is not exported from `route-handler.ts` (it is used by `links/route.ts:4`), use the same import as that file.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/__tests__/app/api/payments/deposits.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Write the failing payment-links route test**

Create `src/__tests__/app/api/payments/links.test.ts` following the deposits test harness. Assertions:
- body `{ amount: 2500.5, description: 'x' }` → `initializeTenantPayment` called with `amountMinor: 250050`, `subject.type: 'payment_link'`, `customerEmail` from the body.
- missing `customer_email` → 400 (a real email is now required).
- settlement failure → 400 with the Settings → Payments message (this route already uses `badRequest` for "not configured").
- **no** direct `transactions` insert from the route (the boundary writes the row): assert the admin client's `from('transactions').insert` was not called.

- [ ] **Step 6: Run to verify it fails, then implement**

Run: `npx jest src/__tests__/app/api/payments/links.test.ts --runInBand` → FAIL.

In `links/route.ts`: make `customer_email` required (`z.string().trim().email()`); remove the currency lookup, metadata subaccount read, `PaymentsAdapter`, and the post-provider `transactions` insert. Replace with:

```ts
    const amountMinor = Math.round(body.amount * 100);
    const linkId = randomUUID();
    const result = await initializeTenantPayment({
      tenantId,
      amountMinor,
      currency: 'NGN',
      customerEmail: body.customer_email,
      subject: { type: 'payment_link', id: linkId },
      idempotencyKey: `payment_link:${linkId}`,
      metadata: { type: 'payment_link', description: body.description, created_by: ctx.user!.id, customer_phone: body.customer_phone ?? null },
    });
    if (!result.ok) {
      const configuration = ['SETTLEMENT_DISABLED', 'SETTLEMENT_NOT_CONFIGURED', 'POLICY_NOT_ACCEPTED'].includes(result.code);
      throw ApiErrorFactory.badRequest(configuration
        ? 'Payments are not set up yet. Finish setup in Settings → Payments.'
        : result.message);
    }
    return { success: true, paymentUrl: result.authorizationUrl, reference: result.reference, amount: amountMinor / 100, currency: 'NGN' };
```

Update `GET` to also select `amount_minor` and the UI page to make the email input `required`. Run the test → PASS.

- [ ] **Step 7: Write the failing retail settlement test**

Create `src/__tests__/lib/commerce/retail-orders.settlement.test.ts` by copying the mock setup of `retail-orders.inventory.test.ts` (lines 1–101) and replacing the `@/lib/paymentsAdapter` mock with a `@/lib/payments/tenantSettlement` mock. Assertions:
- a ready order with `total_cents: 750000` → `initializeTenantPayment` called with `amountMinor: 750000`, `subject: { type: 'retail_order', id: order.id }`, `idempotencyKey: 'retail_order:<id>:750000'`, and the customer email.
- an unresolved fulfilment order → `initializeTenantPayment` **not** called (fulfilment gate still first).
- settlement failure → `createRetailOrderPaymentLink` throws `Error('Online payment is not available for this business right now.')` and the order stays unchanged (no `retail_orders` update with `pending_payment`).
- an order with no customer email → throws and no provider call.
- same total but the boundary returns `IDEMPOTENCY_CONFLICT` (e.g. the tenant's policy changed since the first link) → throws the "create a replacement" error and creates no link.
- a changed total (delivery fee added) uses a new idempotency key (`retail_order:<id>:<newTotal>`) and creates a new checkout.

Update `retail-orders.inventory.test.ts` to mock `@/lib/payments/tenantSettlement` (returning `{ ok: true, transactionId: 'tx', reference: 'bk_x', authorizationUrl: 'https://pay', snapshot: {}, reused: false }`) instead of `@/lib/paymentsAdapter`, keeping its assertions.

- [ ] **Step 8: Run to verify it fails, then implement**

Run: `npx jest src/__tests__/lib/commerce/retail-orders.settlement.test.ts --runInBand` → FAIL.

In `createRetailOrderPaymentLink`, keep everything up to and including the fulfilment gate and `effectiveTotalCents` check. Replace from `const subaccountCode = ...` through the `transactions` upsert (lines ~551–631) with:

```ts
  const customerEmail = order.customer?.email ?? '';
  const settlement = await initializeTenantPayment({
    tenantId: order.tenant_id,
    amountMinor: effectiveTotalCents,
    currency: 'NGN',
    customerEmail,
    subject: { type: 'retail_order', id: order.id },
    // Amount is part of the key: a changed total (e.g. delivery fee) is a new checkout.
    idempotencyKey: `retail_order:${order.id}:${effectiveTotalCents}`,
    callbackUrl: input.callbackUrl ?? undefined,
    metadata: {
      retail_order_id: order.id,
      source_chat_id: order.source_chat_id,
      external_customer_ref: order.external_customer_ref,
      channel: input.channel ?? null,
    },
  });
  if (!settlement.ok) {
    if (settlement.code === 'CUSTOMER_EMAIL_REQUIRED') throw new Error('Add the customer email before creating a payment link');
    if (settlement.code === 'IDEMPOTENCY_CONFLICT') throw new Error('The existing payment link amount is stale; create a replacement after confirming delivery');
    throw new Error(SETTLEMENT_CUSTOMER_MESSAGE);
  }

  const nextMetadata = {
    ...workingMetadata,
    payment: {
      provider: 'paystack',
      reference: settlement.reference,
      transactionId: settlement.transactionId,
      url: settlement.authorizationUrl,
      channel: input.channel ?? null,
      amountCents: effectiveTotalCents,
      createdAt: new Date().toISOString(),
      createdBy: input.actorUserId,
    },
  };
```

Keep the existing `retail_orders` update (now using `nextMetadata`), `updateChatJourneyForOrder`, and the return value, with `reference: settlement.reference` and `paymentUrl: settlement.authorizationUrl`. Remove the `PaymentsAdapter` import if unused and the `tenantRow` metadata read if only used for the subaccount. Leave the existing-link early return (`existingReference && existingUrl`) in place; it still guards with the amount check.

Run: `npx jest src/__tests__/lib/commerce src/__tests__/lib/publicStorefrontFulfillment.test.ts src/__tests__/lib/payments/lifecycle.retail.test.ts --runInBand` → PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/api/payments/deposits/route.ts src/app/api/payments/links/route.ts src/app/dashboard/payment-links/page.tsx src/lib/commerce/retail-orders.ts src/__tests__/app/api/payments/deposits.test.ts src/__tests__/app/api/payments/links.test.ts src/__tests__/lib/commerce/retail-orders.inventory.test.ts src/__tests__/lib/commerce/retail-orders.settlement.test.ts
git commit -m "feat(payments): settle dashboard, link, and retail payments

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: One verified Paystack webhook processor

**Files:**
- Create: `src/lib/payments/paystackWebhookProcessor.ts`
- Modify: `src/lib/payments/lifecycle.ts:1869-1906` (`handlePaymentSuccess` subject resolution)
- Modify: `src/app/api/payments/webhook/route.ts` (delegate when `x-paystack-signature` is present)
- Modify: `src/app/api/payments/paystack/route.ts` (delegate entirely)
- Test: `src/__tests__/lib/payments/paystackWebhookProcessor.test.ts` (create), `src/__tests__/app/api/payments/paystack-webhook.test.ts` (update)

**Interfaces:**
- Consumes: `verifyTransaction`, `VerifiedPaystackTransaction` (Task 3); `creditVerifiedTopup` (existing).
- Produces:
  - `processPaystackWebhook(input: { rawBody: string; signature: string | null }, deps?: WebhookDeps): Promise<{ status: number; body: Record<string, unknown> }>`
  - `settleVerifiedCharge(reference: string, deps?: WebhookDeps): Promise<SettleOutcome>` where `type SettleOutcome = 'verified' | 'already_verified' | 'mismatch' | 'not_found' | 'legacy_review' | 'not_successful'`
  - `type WebhookDeps = { admin: SupabaseClient; verify: typeof verifyTransaction; onSuccess: typeof handlePaymentSuccess; onFailure: typeof handlePaymentFailure; creditTopup: typeof creditVerifiedTopup; secret: string }`
  - `handlePaymentSuccess` input gains `subjectType?: 'reservation' | 'retail_order' | 'payment_link' | null`.

- [ ] **Step 1: Write the failing processor tests**

Build a small in-memory admin fake in the test (`from(table)` returning chainable `insert/select/update/eq/neq/maybeSingle/single` over arrays). Seed one transaction:

```ts
const tx = {
  id: 'tx1', tenant_id: 't1', status: 'pending', provider_reference: 'bk_1', currency: 'NGN',
  subject_type: 'reservation', subject_id: 'r1', amount_minor: 500000, platform_fee_minor: 5000,
  tenant_gross_minor: 495000, settlement_subaccount_code: 'ACCT_1', settlement_policy_code: 'pilot_ngn_v1',
  settlement_policy_version: 1, settlement_verification_status: 'pending',
};
const verified = { status: 'success', reference: 'bk_1', amountMinor: 500000, currency: 'NGN', feesMinor: 7600, subaccountCode: 'ACCT_1' };
const event = (data: object, ev = 'charge.success') => JSON.stringify({ event: ev, data });
```

Tests (each calls `processPaystackWebhook({ rawBody, signature: sign(rawBody) }, deps)`):

1. bad signature → `status 401`, no DB access.
2. verified match → tx updated to `status: 'success'`, `settlement_verification_status: 'verified'`, `provider_amount_minor: 500000`, `provider_fee_minor: 7600`, `provider_subaccount_code: 'ACCT_1'`; one `tenant_revenue_ledger` row `{ revenue_type: 'platform_transaction_fee', amount_credits: 50, reference: 'bk_1' }`; `onSuccess` called once with `{ tenantId: 't1', reference: 'bk_1', reservationId: 'r1', subjectType: 'reservation', amountMinor: 500000, currency: 'NGN' }`.
3. payload `metadata.reservation_id: 'EVIL'` → `onSuccess` still receives `reservationId: 'r1'`.
4. replay (same body twice) → second returns `{ replay: true }`; ledger rows still 1; `onSuccess` called once.
5. replay-marker insert fails with code `'XX000'` → `status 500`; `verify` not called.
6. `verify` returns `{ success: false }` → `status 500`; tx unchanged; marker released (deleted).
7. amount mismatch (`amountMinor: 50000000`) → tx `settlement_verification_status: 'mismatch'`, status not `success`; no ledger row; `onSuccess` not called; `status 200`.
8. currency mismatch (`'USD'`) → same as 7.
9. subaccount mismatch (`'ACCT_OTHER'`) → same as 7.
10. tx already `verified` → `already_verified`, no second ledger row, no `onSuccess`.
11. tx row with `amount_minor: null` (legacy) → `legacy_review`; not confirmed; logged.
12. `bokawallet_` reference → `creditTopup` called with `{ reference, amountMinor: 500000 }`; no `transactions` read.
13. policy changed after checkout (seed `payment_fee_policies` pilot v2 with 200 bps) → ledger still uses the stored `platform_fee_minor` 5000 (credits 50).
14. `charge.failed` → `onFailure` called with tenant and `reservationId` from the row.
15. webhook arrives before `markInitialized` stored the checkout URL (tx `raw` has no `authorization_url`) → still `verified`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/__tests__/lib/payments/paystackWebhookProcessor.test.ts --runInBand`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the processor**

```ts
import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyTransaction } from '@/lib/paystack';
import { creditVerifiedTopup } from '@/lib/billing/walletTopup';
import { handlePaymentFailure, handlePaymentSuccess } from '@/lib/payments/lifecycle';
import { defaultLogger } from '@/lib/logger';

/**
 * The only Paystack webhook processor (spec 2026-10-02 §8). Both
 * /api/payments/webhook and /api/payments/paystack delegate here.
 * Tenant and subject always come from the transactions row, never the payload.
 */

export type WebhookDeps = {
  admin: SupabaseClient;
  verify: typeof verifyTransaction;
  onSuccess: typeof handlePaymentSuccess;
  onFailure: typeof handlePaymentFailure;
  creditTopup: typeof creditVerifiedTopup;
  secret: string;
};

export type SettleOutcome = 'verified' | 'already_verified' | 'mismatch' | 'not_found' | 'legacy_review' | 'not_successful';

type Result = { status: number; body: Record<string, unknown> };

function defaultDeps(): WebhookDeps {
  return {
    admin: createSupabaseAdminClient(),
    verify: verifyTransaction,
    onSuccess: handlePaymentSuccess,
    onFailure: handlePaymentFailure,
    creditTopup: creditVerifiedTopup,
    secret: process.env.PAYSTACK_SECRET_KEY || '',
  };
}

function signatureValid(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const computed = Buffer.from(crypto.createHmac('sha512', secret).update(rawBody).digest('hex'), 'hex');
  const given = Buffer.from(signature, 'hex');
  return computed.length === given.length && crypto.timingSafeEqual(computed, given);
}

export async function processPaystackWebhook(
  input: { rawBody: string; signature: string | null },
  deps: WebhookDeps = defaultDeps(),
): Promise<Result> {
  if (!signatureValid(input.rawBody, input.signature, deps.secret)) {
    return { status: 401, body: { error: 'Invalid signature', code: 'INVALID_SIGNATURE' } };
  }

  let payload: { event?: string; data?: Record<string, any> };
  try { payload = JSON.parse(input.rawBody); } catch { return { status: 400, body: { error: 'Invalid JSON' } }; }
  const event = String(payload.event ?? '');
  const data = payload.data ?? {};
  const reference = typeof data.reference === 'string' ? data.reference : null;
  if (!reference) return { status: 200, body: { ok: true, ignored: 'no_reference' } };

  const externalId = `${reference}:${event}`;
  const marker = await deps.admin.from('webhook_events')
    .insert({ provider: 'paystack', external_id: externalId, event_type: event, payload })
    .select('id');
  if (marker.error) {
    if (marker.error.code === '23505') return { status: 200, body: { ok: true, replay: true } };
    defaultLogger.error('[paystackWebhook] replay marker claim failed', { reference, code: marker.error.code });
    return { status: 500, body: { error: 'replay_marker_unavailable' } };
  }

  const release = async () => {
    await deps.admin.from('webhook_events').delete().eq('provider', 'paystack').eq('external_id', externalId);
  };

  try {
    if (event === 'charge.success' && /^bokawallet_/.test(reference)) {
      const chargedMinor = Number(data.amount ?? 0);
      if (!Number.isFinite(chargedMinor) || chargedMinor <= 0) return { status: 200, body: { ok: true, wallet_topup: false, reason: 'no_amount' } };
      const credit = await deps.creditTopup({
        admin: deps.admin, reference, amountMinor: chargedMinor,
        customerEmail: data.customer?.email ?? null, authorization: data.authorization ?? null,
      });
      return { status: 200, body: { ok: true, wallet_topup: credit.credited } };
    }

    if (event === 'charge.success') {
      const outcome = await settleVerifiedCharge(reference, deps);
      return { status: 200, body: { ok: true, outcome } };
    }

    if (event === 'charge.failed') {
      const row = await loadRow(deps.admin, reference);
      if (row) {
        await deps.admin.from('transactions').update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('id', row.id).neq('settlement_verification_status', 'verified');
        await deps.onFailure({
          tenantId: row.tenant_id, reference, provider: 'paystack',
          reservationId: row.subject_type === 'reservation' ? row.subject_id : null,
          amountMinor: row.amount_minor ?? undefined, currency: row.currency ?? undefined,
          reason: String(data.gateway_response ?? data.status ?? 'charge.failed'),
        });
      }
      return { status: 200, body: { ok: true } };
    }

    return { status: 200, body: { ok: true, ignored: event } };
  } catch (error) {
    await release();
    throw error;
  }
}

type Row = {
  id: string; tenant_id: string; status: string; currency: string | null;
  subject_type: 'reservation' | 'retail_order' | 'payment_link' | null; subject_id: string | null;
  amount_minor: number | null; platform_fee_minor: number | null;
  settlement_subaccount_code: string | null; settlement_policy_code: string | null;
  settlement_policy_version: number | null; settlement_verification_status: string | null;
};

async function loadRow(admin: SupabaseClient, reference: string): Promise<Row | null> {
  const { data, error } = await admin.from('transactions')
    .select('id, tenant_id, status, currency, subject_type, subject_id, amount_minor, platform_fee_minor, settlement_subaccount_code, settlement_policy_code, settlement_policy_version, settlement_verification_status')
    .eq('provider_reference', reference).maybeSingle();
  if (error) throw new Error(`transaction lookup failed: ${error.message}`);
  if (!data) return null;
  return { ...data, amount_minor: data.amount_minor === null ? null : Number(data.amount_minor),
    platform_fee_minor: data.platform_fee_minor === null ? null : Number(data.platform_fee_minor) } as Row;
}

/** Verify with Paystack and settle exactly once. Throws on provider/DB errors so callers retry. */
export async function settleVerifiedCharge(reference: string, deps: WebhookDeps = defaultDeps()): Promise<SettleOutcome> {
  const row = await loadRow(deps.admin, reference);
  if (!row) { defaultLogger.warn('[paystackWebhook] no transaction for reference', { reference }); return 'not_found'; }
  if (row.settlement_verification_status === 'verified') return 'already_verified';
  if (row.amount_minor === null || !row.settlement_subaccount_code) {
    defaultLogger.error('[paystackWebhook] legacy transaction needs manual review', { reference, tenantId: row.tenant_id });
    return 'legacy_review';
  }

  const verified = await deps.verify(reference);
  if (!verified.success) throw new Error(`paystack verify failed: ${verified.error}`);
  const v = verified.data;
  if (v.status !== 'success') return 'not_successful';

  const providerColumns = {
    provider_amount_minor: v.amountMinor,
    provider_currency: v.currency,
    provider_fee_minor: v.feesMinor,
    provider_subaccount_code: v.subaccountCode,
    updated_at: new Date().toISOString(),
  };
  const matches = v.reference === reference
    && v.amountMinor === row.amount_minor
    && v.currency === row.currency
    && v.subaccountCode === row.settlement_subaccount_code;

  if (!matches) {
    const { error } = await deps.admin.from('transactions')
      .update({ ...providerColumns, settlement_verification_status: 'mismatch', reconciliation_status: 'discrepancy' })
      .eq('id', row.id);
    if (error) throw new Error(error.message);
    defaultLogger.error('[paystackWebhook] SETTLEMENT MISMATCH — manual review', {
      reference, tenantId: row.tenant_id,
      expected: { amount: row.amount_minor, currency: row.currency, subaccount: row.settlement_subaccount_code },
      observed: { amount: v.amountMinor, currency: v.currency, subaccount: v.subaccountCode },
    });
    return 'mismatch';
  }

  const { data: claimed, error: claimError } = await deps.admin.from('transactions')
    .update({ ...providerColumns, status: 'success', settlement_verification_status: 'verified', reconciliation_status: 'pending' })
    .eq('id', row.id).neq('settlement_verification_status', 'verified')
    .select('id');
  if (claimError) throw new Error(claimError.message);
  if (!claimed || claimed.length === 0) return 'already_verified';

  const fee = row.platform_fee_minor ?? 0;
  if (fee > 0) {
    const { error } = await deps.admin.from('tenant_revenue_ledger').insert({
      tenant_id: row.tenant_id,
      revenue_type: 'platform_transaction_fee',
      amount_credits: fee / 100,
      source: 'paystack',
      reference,
      description: 'Booka platform fee on customer payment',
      metadata: { platform_fee_minor: fee, amount_minor: row.amount_minor, policy_code: row.settlement_policy_code, policy_version: row.settlement_policy_version },
    });
    if (error && error.code !== '23505') throw new Error(error.message);
  }

  await deps.onSuccess({
    tenantId: row.tenant_id,
    reference,
    provider: 'paystack',
    reservationId: row.subject_type === 'reservation' ? row.subject_id : null,
    subjectType: row.subject_type,
    amountMinor: row.amount_minor,
    currency: row.currency ?? 'NGN',
  });
  return 'verified';
}
```

Note the claim-then-effects order: if `onSuccess` throws after the claim, the processor releases the replay marker and returns 500; Paystack's retry then sees `already_verified` and does not re-confirm. To keep confirmation reachable, `onSuccess` failures must be idempotent-retryable by staff; log them with `defaultLogger.error` including the reference. (Matches the existing retail spec's "retryable error without reverting payment".)

- [ ] **Step 4: Make `handlePaymentSuccess` trust the transaction subject**

In `lifecycle.ts`, add `subjectType?: 'reservation' | 'retail_order' | 'payment_link' | null;` to `PaymentSuccessInput`. At the top of `handlePaymentSuccess`, change the retail branch condition from `if (!reservationId)` to `if (subjectType === 'retail_order' || (!reservationId && subjectType !== 'payment_link'))`, and add right after it:

```ts
    if (subjectType === 'payment_link') return; // a link has no subject to confirm
```

Keep the existing `raw.reservation_id` fallback for callers that pass no `subjectType` (Stripe route).

- [ ] **Step 5: Run processor tests**

Run: `npx jest src/__tests__/lib/payments/paystackWebhookProcessor.test.ts src/__tests__/lib/payments/lifecycle.retail.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 6: Delegate both routes**

`src/app/api/payments/paystack/route.ts` becomes:

```ts
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { processPaystackWebhook } from '@/lib/payments/paystackWebhookProcessor';

/** Legacy Paystack webhook URL. Identical behavior to /api/payments/webhook. */
export const POST = createHttpHandler(
  async (ctx) => {
    const rawBody = await ctx.request.text();
    const result = await processPaystackWebhook({ rawBody, signature: ctx.request.headers.get('x-paystack-signature') });
    return NextResponse.json(result.body, { status: result.status });
  },
  'POST',
  { auth: false },
);
```

In `src/app/api/payments/webhook/route.ts`, immediately after `rawText` is read (before JSON parsing), add:

```ts
    const paystackSignature = ctx.request.headers.get('x-paystack-signature');
    if (paystackSignature) {
      const result = await processPaystackWebhook({ rawBody: rawText, signature: paystackSignature });
      return NextResponse.json(result.body, { status: result.status });
    }
```

Then delete the now-unreachable Paystack-specific parts: the `paystackSigHeader` block and the `bokawallet_` wallet branch (both handled by the processor). Leave the Stripe and Flutterwave paths unchanged. Add the `NextResponse` and processor imports; remove `creditVerifiedTopup` and `createSupabaseAdminClient` imports only if no longer used.

- [ ] **Step 7: Update the route test**

In `paystack-webhook.test.ts`, mock `@/lib/payments/paystackWebhookProcessor` and assert: a request with `x-paystack-signature` is passed to `processPaystackWebhook` with the exact raw body and its `{ status, body }` is returned unchanged, for **both** `/api/payments/webhook` and `/api/payments/paystack`. Keep the existing "no signature header → rejected" test. Move the old wallet-branch assertions into the processor test (case 12) rather than deleting them.

- [ ] **Step 8: Run tests**

Run: `npx jest src/__tests__/app/api/payments src/__tests__/lib/payments --runInBand`
Expected: PASS except `stripe.test.ts`, a known baseline failure (it passes a fake ctx the wrapper ignores). Before Task 1, run `npx jest src/__tests__/app/api/payments --runInBand` once and save the result to the scratchpad as the baseline; no file failing now may be passing at baseline.

- [ ] **Step 9: Commit**

```bash
git add src/lib/payments/paystackWebhookProcessor.ts src/lib/payments/lifecycle.ts src/app/api/payments/webhook/route.ts src/app/api/payments/paystack/route.ts src/__tests__/lib/payments/paystackWebhookProcessor.test.ts src/__tests__/app/api/payments/paystack-webhook.test.ts
git commit -m "feat(payments): verify and settle paystack webhooks once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Retry through the verifier; minor-unit refunds with fee reversal

**Files:**
- Modify: `src/lib/paymentService.ts:856-930` (`retryFailedTransaction`)
- Create: `src/lib/payments/tenantRefunds.ts`
- Modify: `src/app/api/payments/refund/route.ts`
- Test: `src/__tests__/lib/payments/tenantRefunds.test.ts`, `src/__tests__/lib/paymentService.retry.test.ts`

**Interfaces:**
- Consumes: `settleVerifiedCharge` (Task 9).
- Produces: `refundTenantPayment(input: { tenantId: string; transactionId: string; amountMinor?: number; reason?: string }, deps?: RefundDeps): Promise<{ ok: true; refundedMinor: number; full: boolean } | { ok: false; error: string }>`

- [ ] **Step 1: Write the failing retry test**

Mock `@/lib/payments/paystackWebhookProcessor`. Seed a transaction with `amount_minor: 500000`, `provider_reference: 'bk_1'`, `retry_count: 0`. Assert `retryFailedTransaction('tx1')` calls `settleVerifiedCharge('bk_1')` and returns `{ success: true }` when it resolves `'verified'` or `'already_verified'`, `{ success: false }` for `'mismatch'`, and never calls the legacy provider status path. A legacy row (`amount_minor: null`) still uses the old path.

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `npx jest src/__tests__/lib/paymentService.retry.test.ts --runInBand` → FAIL.

At the start of `retryFailedTransaction`, after the `transaction` load and the `retry_count` guard:

```ts
      if (transaction.amount_minor !== null && transaction.amount_minor !== undefined) {
        const { settleVerifiedCharge } = await import('@/lib/payments/paystackWebhookProcessor');
        const outcome = await settleVerifiedCharge(transaction.provider_reference);
        await this.supabase.from('transactions')
          .update({ retry_count: transaction.retry_count + 1, last_retry_at: new Date().toISOString() })
          .eq('id', transactionId);
        return { success: outcome === 'verified' || outcome === 'already_verified' };
      }
```

Run → PASS.

- [ ] **Step 3: Write the failing refund test**

```ts
const settled = { id: 'tx1', tenant_id: 't1', provider_reference: 'bk_1', amount_minor: 500000, platform_fee_minor: 5000,
  settlement_verification_status: 'verified', refund_amount: 0 };

it('refunds in minor units unchanged', async () => {
  await refundTenantPayment({ tenantId: 't1', transactionId: 'tx1', amountMinor: 200000 }, deps);
  expect(deps.refund).toHaveBeenCalledWith({ transaction: 'bk_1', amount: 200000 });
});
it('full refund reverses the Booka fee once', async () => {
  const r = await refundTenantPayment({ tenantId: 't1', transactionId: 'tx1' }, deps);
  expect(r).toEqual({ ok: true, refundedMinor: 500000, full: true });
  expect(ledgerRows()).toEqual([expect.objectContaining({ revenue_type: 'refund', amount_credits: -50, reference: 'bk_1:fee_refund' })]);
});
it('partial refund keeps the fee', async () => {
  await refundTenantPayment({ tenantId: 't1', transactionId: 'tx1', amountMinor: 100000 }, deps);
  expect(ledgerRows()).toHaveLength(0);
});
it('refuses unverified, foreign-tenant, or over-refunds', async () => { /* three expectations returning ok:false */ });
it('rejects non-integer amounts', async () => {
  expect(await refundTenantPayment({ tenantId: 't1', transactionId: 'tx1', amountMinor: 1.5 }, deps)).toMatchObject({ ok: false });
});
```

- [ ] **Step 4: Run to verify it fails, then implement `tenantRefunds.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { isValidAmountMinor } from './settlementPolicy';

/**
 * Refunds for settled tenant payments. Amounts are minor units end to end.
 * Owner decision 2026-10-02: a FULL refund reverses Booka's platform fee;
 * a partial refund keeps it.
 */
export type RefundDeps = {
  admin: SupabaseClient;
  refund: (body: { transaction: string; amount: number }) => Promise<{ status: boolean; message?: string }>;
};

async function paystackRefund(body: { transaction: string; amount: number }) {
  const { fetchWithTimeout } = await import('@/lib/fetchWithTimeout');
  const res = await fetchWithTimeout('https://api.paystack.co/refund', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: 15_000,
  });
  return res.json() as Promise<{ status: boolean; message?: string }>;
}

export async function refundTenantPayment(
  input: { tenantId: string; transactionId: string; amountMinor?: number; reason?: string },
  deps: RefundDeps = { admin: createSupabaseAdminClient(), refund: paystackRefund },
): Promise<{ ok: true; refundedMinor: number; full: boolean } | { ok: false; error: string }> {
  const { data: tx, error } = await deps.admin.from('transactions')
    .select('id, tenant_id, provider_reference, amount_minor, platform_fee_minor, settlement_verification_status, refund_amount')
    .eq('id', input.transactionId).eq('tenant_id', input.tenantId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!tx || tx.settlement_verification_status !== 'verified' || tx.amount_minor === null) {
    return { ok: false, error: 'Only verified payments can be refunded' };
  }
  const total = Number(tx.amount_minor);
  const alreadyMinor = Math.round(Number(tx.refund_amount ?? 0) * 100);
  const requested = input.amountMinor ?? total - alreadyMinor;
  if (!isValidAmountMinor(requested)) return { ok: false, error: 'Refund amount must be a positive whole number of kobo' };
  if (alreadyMinor + requested > total) return { ok: false, error: 'Refund exceeds the amount paid' };

  const res = await deps.refund({ transaction: tx.provider_reference, amount: requested });
  if (!res.status) return { ok: false, error: res.message || 'Refund failed' };

  const refundedTotal = alreadyMinor + requested;
  const full = refundedTotal === total;
  await deps.admin.from('transactions').update({
    refund_amount: refundedTotal / 100, // legacy major-unit column
    refund_reason: input.reason ?? null,
    status: full ? 'refunded' : 'partially_refunded',
    updated_at: new Date().toISOString(),
  }).eq('id', tx.id);

  const fee = Number(tx.platform_fee_minor ?? 0);
  if (full && fee > 0) {
    const { error: ledgerError } = await deps.admin.from('tenant_revenue_ledger').insert({
      tenant_id: tx.tenant_id,
      revenue_type: 'refund',
      amount_credits: -(fee / 100),
      source: 'paystack',
      reference: `${tx.provider_reference}:fee_refund`,
      description: 'Booka platform fee returned on full refund',
      metadata: { platform_fee_minor: fee, amount_minor: total },
    });
    if (ledgerError && ledgerError.code !== '23505') return { ok: false, error: ledgerError.message };
  }
  return { ok: true, refundedMinor: requested, full };
}
```

Before relying on `status: 'partially_refunded'`, check the `transactions.status` constraint (`grep -rn "transactions_status\|status IN" db/migrations supabase/migrations | grep -i transactions`). If a CHECK exists without it, use `'refunded'` for full and keep the current status for partial.

Run → PASS.

- [ ] **Step 5: Route the refund endpoint**

In `refund/route.ts`, change the schema field to `amountMinor: z.number().int().positive().optional()`. Before calling `PaymentService.processRefund`, load the transaction's `amount_minor`; if non-null, call `refundTenantPayment({ tenantId, transactionId, amountMinor, reason })` and return its result (400 on `ok: false`). Otherwise keep the legacy path. Add a route test asserting both branches.

- [ ] **Step 6: Run and commit**

Run: `npx jest src/__tests__/lib/payments src/__tests__/lib/paymentService.retry.test.ts src/__tests__/lib/paymentService.test.ts src/__tests__/app/api/payments --runInBand`
Expected: PASS (except baseline-failing `stripe.test.ts`).

```bash
git add src/lib/paymentService.ts src/lib/payments/tenantRefunds.ts src/app/api/payments/refund/route.ts src/__tests__/lib/payments/tenantRefunds.test.ts src/__tests__/lib/paymentService.retry.test.ts src/__tests__/app/api/payments/refund.test.ts
git commit -m "feat(payments): verify retries and refund settled payments in kobo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Remove legacy initializers and add the allow-list guard

**Files:**
- Modify: `src/lib/paymentsAdapter.ts` (remove Paystack initializers and deposit helpers)
- Modify: `src/lib/payments/lifecycle.ts:845-880` (remove `createPaystackPayment` and its `case 'paystack'`)
- Modify: `src/lib/paymentService.ts:83-135` (`PaystackProvider.initializePayment` returns a fixed error)
- Create: `src/__tests__/lib/payments/initializeAllowList.test.ts`

**Interfaces:**
- Produces: a guard that fails CI if any non-allow-listed file initializes a Paystack transaction.

- [ ] **Step 1: Write the failing guard test**

```ts
import { describe, it, expect } from '@jest/globals';
import { execSync } from 'child_process';

const grep = (pattern: string) =>
  execSync(`git grep -l -E "${pattern}" -- 'src/**/*.ts' 'src/**/*.tsx' ':!src/__tests__/**' ':!**/*.test.ts' ':!**/*.test.tsx' || true`, { encoding: 'utf8' })
    .split('\n').filter(Boolean).sort();

describe('Paystack initialize allow-list (spec 2026-10-02 §5)', () => {
  it('only paystack.ts names the initialize endpoint', () => {
    expect(grep('transaction/initialize')).toEqual(['src/lib/paystack.ts']);
  });
  it('only the wallet top-up calls initializeTransaction', () => {
    expect(grep('initializeTransaction\\(')).toEqual(['src/lib/billing/walletTopup.ts', 'src/lib/paystack.ts']);
  });
  it('only tenantSettlement calls initializeSplitTransaction', () => {
    expect(grep('initializeSplitTransaction\\(')).toEqual(['src/lib/payments/tenantSettlement.ts', 'src/lib/paystack.ts']);
  });
  it('only wallet billing calls chargeAuthorization', () => {
    expect(grep('chargeAuthorization\\(').every((f) => f === 'src/lib/paystack.ts' || f.startsWith('src/lib/billing/'))).toBe(true);
  });
  it('nothing reads the tenant-writable metadata subaccount at runtime', () => {
    expect(grep('paystack_subaccount_code')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/__tests__/lib/payments/initializeAllowList.test.ts --runInBand`
Expected: FAIL listing `paymentService.ts`, `paymentsAdapter.ts`, `lifecycle.ts`, and the metadata readers (subaccounts route, setup route, teardown, onboarding).

- [ ] **Step 3: Remove the legacy initializers**

- `paymentsAdapter.ts`: delete `PaystackProvider` (the class), `createPaystackStandalonePaymentLink`, `recordDepositTransaction`, `initiateDepositForReservation`, and remove them from the default-export object. In `PaymentsAdapter`, stop registering `paystack`; in `createStandalonePaymentLink`, delete the `provider.name === 'paystack'` branch. Run `git grep -n "paymentsAdapter\|PaymentsAdapter" -- src` and fix any remaining importer (after Tasks 6–8 there should be none outside Stripe use).
- `lifecycle.ts`: delete `createPaystackPayment` and change its `case 'paystack':` to `throw new Error('Paystack customer payments must use initializeTenantPayment');`.
- `paymentService.ts` `PaystackProvider.initializePayment`: replace the body with

```ts
  async initializePayment(params: InitializePaymentParams): Promise<PaymentResponse> {
    return { success: false, reference: params.reference, error: 'Paystack customer payments must use initializeTenantPayment' };
  }
```

The remaining metadata readers are removed in Task 12; the last guard case stays red until then — run only the first four cases now:

Run: `npx jest src/__tests__/lib/payments/initializeAllowList.test.ts -t "initialize|charge" --runInBand`
Expected: PASS for the four initializer cases.

- [ ] **Step 4: Run the payment suites**

Run: `npx jest src/__tests__/lib/paymentService.test.ts src/__tests__/lib/payments src/__tests__/lib/commerce src/__tests__/app/api/payments --runInBand`
Expected: PASS (except baseline-failing `stripe.test.ts`). Update any `paymentService.test.ts` case that asserted the old Paystack initialize body to assert the new fixed error instead.

- [ ] **Step 5: Commit**

```bash
git add src/lib/paymentsAdapter.ts src/lib/payments/lifecycle.ts src/lib/paymentService.ts src/__tests__/lib/payments/initializeAllowList.test.ts src/__tests__/lib/paymentService.test.ts
git commit -m "refactor(payments): remove legacy paystack initializers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Subaccount setup, acceptance, deprecation, offboarding, and disclosure

**Files:**
- Modify: `src/app/api/payments/subaccounts/route.ts` (rewrite)
- Modify: `src/app/api/tenants/[tenantId]/payments/setup/route.ts` (deprecation)
- Modify: `src/app/api/onboarding/tenant/route.ts:102-120` (drop the metadata pending flag)
- Modify: `src/lib/offboarding/teardownTasks.ts:54-61`
- Modify: `src/components/settings/PaymentSettingsSection.tsx`
- Test: `src/__tests__/app/api/payments/subaccounts.test.ts`, `src/__tests__/app/api/tenants/payments-setup.test.ts`, `src/__tests__/lib/offboarding/closePaystackSubaccount.test.ts`, `src/__tests__/components/settings/PaymentSettingsSection.test.tsx`

**Interfaces:**
- Consumes: `resolveBankAccount`, `createSubaccount`, `fetchSubaccount`, `updateSubaccount` (existing `paystack.ts`); `calculateSettlement` (Task 2).
- Produces:
  - `GET /api/payments/subaccounts` → `{ configured: boolean; status: string | null; account: { bankCode, accountLast4, accountName } | null; policy: { code, version, basisPoints, capMinor } ; example: { amountMinor: 1000000; platformFeeMinor: number; tenantGrossMinor: number } }`
  - `POST /api/payments/subaccounts` body `{ businessName, settlementBank, accountNumber, primaryContactEmail, acceptPolicy: { code: string; version: number } }`
  - `PUT /api/payments/subaccounts` body `{ settlementBank, accountNumber, primaryContactEmail, acceptPolicy }`

- [ ] **Step 1: Write the failing route tests**

Use the route test harness (owner role via the default admin mock). Mock `@/lib/paystack`. Cases:
1. `GET` with no account row → `{ configured: false }` plus the pilot policy and an example for NGN 10,000 (`platformFeeMinor: 10000`, `tenantGrossMinor: 990000`).
2. `POST` without `acceptPolicy` → 400; `createSubaccount` not called.
3. `POST` with `acceptPolicy` for a different version than the tenant's assigned policy → 409.
4. `POST` happy path: `resolveBankAccount` called first; `createSubaccount` called with `percentageCharge: 0`; `fetchSubaccount` called and compared; upsert to `tenant_payment_accounts` with `status: 'active'`, `subaccount_code`, `account_last4` (last 4 only), `account_name`, `accepted_by: user.id`, `accepted_at`; the full account number is **not** in any DB write (assert by serializing all writes and searching for it).
5. `POST` where `fetchSubaccount` returns `percentage_charge: 5` → row saved with `status: 'invalid'`, response 502, no `active`.
6. `POST` when an active account already exists → 409 (use `PUT`).
7. `PUT` sets `status: 'pending'` before calling `updateSubaccount`, then `active` only after fetch-back matches.
8. Non-owner (manager) → 403.
9. Response bodies never include the full account number.

Setup route test: `POST /api/tenants/<id>/payments/setup` → 410 with `{ code: 'ENDPOINT_DEPRECATED', use: '/api/payments/subaccounts' }` and no Paystack call.

Teardown test: with an account row, task sets `status: 'suspended'` and returns `{ status: 'done', payload: { suspended_subaccount: 'ACCT_1' } }`; with none → `skipped`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/__tests__/app/api/payments/subaccounts.test.ts src/__tests__/app/api/tenants/payments-setup.test.ts src/__tests__/lib/offboarding/closePaystackSubaccount.test.ts --runInBand`
Expected: FAIL.

- [ ] **Step 3: Rewrite `subaccounts/route.ts`**

```ts
export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { createHttpHandler, getVerifiedTenantId, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { createSubaccount, fetchSubaccount, resolveBankAccount, updateSubaccount } from '@/lib/paystack';
import { calculateSettlement } from '@/lib/payments/settlementPolicy';

/** Plan → policy assignment for this release: every tenant is on the pilot policy. */
const ASSIGNED_POLICY = { code: 'pilot_ngn_v1', version: 1 } as const;
const EXAMPLE_AMOUNT_MINOR = 1_000_000; // NGN 10,000

const SetupSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  settlementBank: z.string().trim().min(2).max(10),
  accountNumber: z.string().regex(/^\d{10}$/, 'Account number must be 10 digits'),
  primaryContactEmail: z.string().trim().email(),
  acceptPolicy: z.object({ code: z.string(), version: z.number().int() }),
});
const UpdateSchema = SetupSchema.omit({ businessName: true });

async function loadPolicy(admin: ReturnType<typeof createSupabaseAdminClient>) {
  const { data, error } = await admin.from('payment_fee_policies')
    .select('code, version, platform_fee_basis_points, platform_fee_cap_minor')
    .eq('code', ASSIGNED_POLICY.code).eq('version', ASSIGNED_POLICY.version).maybeSingle();
  if (error || !data) throw ApiErrorFactory.internalServerError(new Error('Fee policy missing'));
  return { code: data.code, version: data.version, basisPoints: data.platform_fee_basis_points,
    capMinor: data.platform_fee_cap_minor === null ? null : Number(data.platform_fee_cap_minor), feeBearer: 'subaccount' as const };
}

function validationError(error: z.ZodError) {
  return ApiErrorFactory.validationError(Object.fromEntries(error.issues.map((i) => [i.path.join('.') || '_', i.message])));
}

/** Create or re-point a subaccount, then prove Paystack stored what we sent. */
async function provision(args: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  tenantId: string; userId: string; existingCode: string | null;
  businessName: string; settlementBank: string; accountNumber: string; primaryContactEmail: string;
}) {
  const bank = await resolveBankAccount(args.accountNumber, args.settlementBank);
  if (!bank.success || !bank.account) throw ApiErrorFactory.validationError({ accountNumber: 'Could not verify this bank account' });

  const created = args.existingCode
    ? await updateSubaccount(args.existingCode, { settlementBank: args.settlementBank, accountNumber: args.accountNumber, primaryContactEmail: args.primaryContactEmail, percentageCharge: 0 })
    : await createSubaccount({ businessName: args.businessName, settlementBank: args.settlementBank, accountNumber: args.accountNumber, primaryContactEmail: args.primaryContactEmail, percentageCharge: 0 });
  if (!created.success || !created.subaccount) throw ApiErrorFactory.externalServiceError(created.error ?? 'Paystack setup failed');

  const code = created.subaccount.subaccountCode;
  const check = await fetchSubaccount(code);
  const sub = check.success ? check.subaccount : undefined;
  const ok = Boolean(sub && Number(sub.percentageCharge) === 0 && sub.settlementBank === args.settlementBank
    && String(sub.accountNumber).slice(-4) === args.accountNumber.slice(-4));

  const row = {
    tenant_id: args.tenantId, provider: 'paystack', currency: 'NGN', subaccount_code: code,
    status: ok ? 'active' : 'invalid', bank_code: args.settlementBank, account_last4: args.accountNumber.slice(-4),
    account_name: bank.account.accountName, policy_code: ASSIGNED_POLICY.code, policy_version: ASSIGNED_POLICY.version,
    accepted_by: args.userId, accepted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const { error } = await args.admin.from('tenant_payment_accounts').upsert(row, { onConflict: 'tenant_id,provider,currency' });
  if (error) throw ApiErrorFactory.databaseError(error);
  if (!ok) return NextResponse.json({ success: false, code: 'SUBACCOUNT_MISMATCH', error: 'Paystack did not confirm the settlement details. Contact Booka support.' }, { status: 502 });
  return { success: true, status: 'active', account: { bankCode: row.bank_code, accountLast4: row.account_last4, accountName: row.account_name } };
}

export const GET = createHttpHandler(async (ctx) => {
  const tenantId = getVerifiedTenantId(ctx);
  const admin = createSupabaseAdminClient();
  const policy = await loadPolicy(admin);
  const { data } = await admin.from('tenant_payment_accounts')
    .select('status, bank_code, account_last4, account_name')
    .eq('tenant_id', tenantId).eq('provider', 'paystack').eq('currency', 'NGN').maybeSingle();
  return {
    configured: data?.status === 'active',
    status: data?.status ?? null,
    account: data ? { bankCode: data.bank_code, accountLast4: data.account_last4, accountName: data.account_name } : null,
    policy: { code: policy.code, version: policy.version, basisPoints: policy.basisPoints, capMinor: policy.capMinor },
    example: calculateSettlement(EXAMPLE_AMOUNT_MINOR, policy),
  };
}, 'GET', { auth: true, roles: ['owner'] });

export const POST = createHttpHandler(async (ctx) => {
  const parsed = SetupSchema.safeParse(await parseJsonBody<unknown>(ctx.request));
  if (!parsed.success) throw validationError(parsed.error);
  const body = parsed.data;
  if (body.acceptPolicy.code !== ASSIGNED_POLICY.code || body.acceptPolicy.version !== ASSIGNED_POLICY.version) {
    return NextResponse.json({ success: false, code: 'POLICY_CHANGED', error: 'The fee policy changed. Review and accept it again.' }, { status: 409 });
  }
  const tenantId = getVerifiedTenantId(ctx);
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin.from('tenant_payment_accounts').select('status')
    .eq('tenant_id', tenantId).eq('provider', 'paystack').eq('currency', 'NGN').maybeSingle();
  if (existing?.status === 'active') {
    return NextResponse.json({ success: false, code: 'ALREADY_CONFIGURED', error: 'Payments are already set up. Use update instead.' }, { status: 409 });
  }
  return provision({ admin, tenantId, userId: ctx.user!.id, existingCode: null, ...body });
}, 'POST', { auth: true, roles: ['owner'] });

export const PUT = createHttpHandler(async (ctx) => {
  const parsed = UpdateSchema.safeParse(await parseJsonBody<unknown>(ctx.request));
  if (!parsed.success) throw validationError(parsed.error);
  const body = parsed.data;
  if (body.acceptPolicy.code !== ASSIGNED_POLICY.code || body.acceptPolicy.version !== ASSIGNED_POLICY.version) {
    return NextResponse.json({ success: false, code: 'POLICY_CHANGED', error: 'The fee policy changed. Review and accept it again.' }, { status: 409 });
  }
  const tenantId = getVerifiedTenantId(ctx);
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin.from('tenant_payment_accounts').select('subaccount_code')
    .eq('tenant_id', tenantId).eq('provider', 'paystack').eq('currency', 'NGN').maybeSingle();
  if (!existing?.subaccount_code) throw ApiErrorFactory.badRequest('No payment account to update');
  // Collection stops while the bank change is being verified.
  await admin.from('tenant_payment_accounts').update({ status: 'pending', updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('provider', 'paystack').eq('currency', 'NGN');
  const { data: tenant } = await admin.from('tenants').select('name').eq('id', tenantId).maybeSingle();
  return provision({ admin, tenantId, userId: ctx.user!.id, existingCode: existing.subaccount_code, businessName: tenant?.name ?? 'Business', ...body });
}, 'PUT', { auth: true, roles: ['owner'] });
```

Before writing this, read `src/lib/paystack.ts:98-117` (`resolveBankAccount` return shape) and `:337-396` (`updateSubaccount`/`fetchSubaccount` params and `Subaccount` fields). If `updateSubaccount` does not accept `percentageCharge`, add that optional field there (one line in its body: `percentage_charge: params.percentageCharge`) and cover it in `paystack.split.test.ts`. If `resolveBankAccount` returns a different shape, adapt only the two lines that read it.

- [ ] **Step 4: Deprecate the legacy setup route, clean onboarding, update teardown**

Setup route body becomes:

```ts
export const POST = createHttpHandler(
  async () => NextResponse.json({
    success: false,
    code: 'ENDPOINT_DEPRECATED',
    error: 'Payment setup moved. Use Settings → Payments.',
    use: '/api/payments/subaccounts',
  }, { status: 410 }),
  'POST',
  { auth: true, roles: ['owner', 'superadmin'] }
);
```

In `onboarding/tenant/route.ts:102-120`, delete the block that writes `paystack_subaccount_pending` (the account table's absence already means "not set up").

`teardownTasks.ts` `closePaystackSubaccount`:

```ts
async function closePaystackSubaccount(admin: SupabaseClient, tenantId: string): Promise<TaskResult> {
  // Settlement lives in tenant_payment_accounts (spec 2026-10-02). Suspending
  // stops collection immediately; the Paystack subaccount itself is
  // deactivated by Booka ops in the Paystack dashboard.
  const { data } = await admin.from('tenant_payment_accounts')
    .update({ status: 'suspended', updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).neq('status', 'suspended')
    .select('subaccount_code');
  const code = data?.[0]?.subaccount_code;
  if (!code) return { status: 'skipped' };
  return { status: 'done', payload: { suspended_subaccount: code, manual_paystack_deactivation_required: true } };
}
```

- [ ] **Step 5: Update the settings UI**

In `PaymentSettingsSection.tsx`, use the new `GET` shape. Required content, each with a `data-testid`:
- `settlement-status`: "Active", "Pending verification", "Setup needed", or "Needs attention" (`invalid`/`suspended`).
- `booka-fee`: "Booka fee: 1% per payment, capped at ₦2,000" — computed from `policy.basisPoints / 100` and `policy.capMinor / 100`, formatted with `Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 })`.
- `paystack-fee-note`: "Paystack's processing fee is deducted from your payout."
- `settlement-example`: "On a ₦10,000 payment: Booka fee ₦100, you receive ₦9,900 before Paystack's fee." (from `example`).
- `collection-disabled-warning` when status ≠ `active`: "You can't collect customer payments until setup is active."
- An acceptance checkbox (`accept-policy`) that must be ticked before Save is enabled; Save sends `acceptPolicy: policy`.
- Masked account `****1234` from `account.accountLast4`. Remove the `100 - percentageCharge` share and any full account-number state.

UI test asserts each test id's text for the pilot policy, Save disabled until the checkbox is ticked, and the request body includes `acceptPolicy: { code: 'pilot_ngn_v1', version: 1 }`.

- [ ] **Step 6: Run tests including the full guard**

Run: `npx jest src/__tests__/app/api/payments/subaccounts.test.ts src/__tests__/app/api/tenants/payments-setup.test.ts src/__tests__/lib/offboarding src/__tests__/components/settings/PaymentSettingsSection.test.tsx src/__tests__/lib/payments/initializeAllowList.test.ts --runInBand`
Expected: PASS, including the `paystack_subaccount_code` guard case. If the guard still lists a file, remove that read (or, for `src/lib/offboarding/types.ts`, rename the payload key only if it is a type literal unrelated to runtime reads).

- [ ] **Step 7: Commit**

```bash
git add src/app/api/payments/subaccounts/route.ts "src/app/api/tenants/[tenantId]/payments/setup/route.ts" src/app/api/onboarding/tenant/route.ts src/lib/offboarding/teardownTasks.ts src/components/settings/PaymentSettingsSection.tsx src/lib/paystack.ts src/__tests__/app/api/payments/subaccounts.test.ts src/__tests__/app/api/tenants/payments-setup.test.ts src/__tests__/lib/offboarding/closePaystackSubaccount.test.ts src/__tests__/components/settings/PaymentSettingsSection.test.tsx
git commit -m "feat(payments): verified subaccount setup with fee acceptance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Documentation, environment, and full verification

**Files:**
- Modify: `docs/runbooks/concierge-onboarding-test-salon.md` §3 (line 33)
- Modify: `docs/superpowers/specs/2026-06-16-30-day-launch-hardening-design.md` (lines 73, 108)
- Modify: `docs/superpowers/specs/2026-07-15-booka-business-ledger-daily-close-design.md` §7 (line 206)
- Modify: `docs/operations-guide.md` (new "Customer payment settlement" section)
- Modify: `.env.example` (or the repo's env example file — `ls -a | grep -i env`)
- Modify: `docs/superpowers/specs/2026-10-02-unified-paystack-settlement-design.md` (§4.2 add `settlement_idempotency_key`; status line)

- [ ] **Step 1: Update docs**

- Concierge runbook line 33 → "- [ ] Owner completes Settings → Payments: verifies the bank account, accepts the Booka fee (1%, capped at ₦2,000), and sees status **Active**. Never edit `tenants.metadata` for settlement." Add: "- [ ] Confirm `BOOKA_TENANT_PAYMENTS=live` is set only after the Section 10.2 gates in the settlement spec pass."
- Launch-hardening lines 73 and 108 → "A declined/abandoned deposit leaves the reservation `pending` (swept by auto-cancel). A deposit that **cannot be created** opens a payment handoff; those reservations are exempt from auto-cancel until staff confirm or cancel them (settlement spec 2026-10-02 §6)."
- Daily-close line 206 → append: "Use `transactions.amount_minor` where present (legacy `amount` is mixed-unit). Report tenant payments **gross**, with the Booka platform fee (`platform_fee_minor`) and Paystack fee (`provider_fee_minor`) as separate lines (owner decision 2026-10-02)."
- Operations guide: add "Customer payment settlement" covering `tenant_payment_accounts` statuses, the `BOOKA_TENANT_PAYMENTS` gate, how to find mismatches (`SELECT id, tenant_id, provider_reference FROM transactions WHERE settlement_verification_status IN ('mismatch') OR (settlement_verification_status = 'pending' AND created_at < now() - interval '1 day');`), how to find open handoffs (`SELECT id, tenant_id FROM reservations WHERE metadata->'payment_handoff'->>'status' = 'open';`), the `platform_transaction_fee` and fee-reversal `refund` ledger rows, and "legacy_review" handling.
- Env example: add `BOOKA_TENANT_PAYMENTS=off` with comment `# Set to "live" only after settlement release gates pass`; remove `PAYSTACK_PLATFORM_FEE_PERCENT` if present.
- Settlement spec: set the status line to "Implemented on `feat/retail-fulfillment-handoff` — not deployed".

- [ ] **Step 2: Full verification**

Run, in order, and record outputs in the commit body:
```bash
npx jest src/__tests__/lib/payments src/__tests__/app/api/payments src/__tests__/lib/commerce src/__tests__/lib/whatsapp/v2 src/__tests__/app/api/jobs src/__tests__/lib/offboarding src/__tests__/components/settings --runInBand
NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit
npm run lint -- --quiet
npm test -- --runInBand 2>&1 | tail -5
```
Expected: targeted suites pass; `tsc` reports no errors in any file this plan changed (`git diff --name-only 175933806de7..HEAD`); full-suite failures are a subset of the baseline (107 pre-existing per `boka-build-status`) — list any new failure and fix it before committing.

- [ ] **Step 3: Self-review with the repo agent**

Run the `booka-self-review` agent over the branch diff. Resolve every confirmed finding (ghost columns, tenant scope, RLS, currency hardcoding, internal-ID leaks).

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/concierge-onboarding-test-salon.md docs/superpowers/specs/2026-06-16-30-day-launch-hardening-design.md docs/superpowers/specs/2026-07-15-booka-business-ledger-daily-close-design.md docs/operations-guide.md docs/superpowers/specs/2026-10-02-unified-paystack-settlement-design.md .env.example
git commit -m "docs(payments): align runbooks and specs with unified settlement

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Deployment gate (not part of this plan's execution):** do not run migration 160 or set `BOOKA_TENANT_PAYMENTS=live`. Hand the owner: the migration, verifier, fallback, and the spec's Section 10.2 staged-release checklist.
