# Migration 160 manual fallback

Run blocks in order in the Supabase SQL editor only if the migration file fails. Each block is idempotent. Then run `160_unified_paystack_settlement_verify.sql`.

## 1. Create payment_fee_policies and seed the pilot policy

```sql
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

INSERT INTO public.payment_fee_policies
  (code, version, currency, platform_fee_basis_points, platform_fee_cap_minor, fee_bearer)
VALUES ('pilot_ngn_v1', 1, 'NGN', 100, 200000, 'subaccount')
ON CONFLICT (code, version) DO NOTHING;
COMMIT;
```

## 2. Create tenant_payment_accounts

```sql
BEGIN;
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
COMMIT;
```

## 3. Alter transactions: snapshot columns, constraints, index

```sql
BEGIN;
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
COMMIT;
```

## 4. Replace the revenue_type CHECK

```sql
BEGIN;
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
COMMIT;
```

## 5. Replace the escalation reason_code CHECK and add index

```sql
BEGIN;
-- Replace the escalation reason_code CHECK from migration 159.
ALTER TABLE public.escalation_queue DROP CONSTRAINT IF EXISTS escalation_queue_reason_code_check;
ALTER TABLE public.escalation_queue
  ADD CONSTRAINT escalation_queue_reason_code_check
  CHECK (reason_code IS NULL OR reason_code IN ('retail_fulfillment', 'payment_settlement'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_escalation_payment_settlement
  ON public.escalation_queue (tenant_id, session_id, reason_code)
  WHERE reason_code = 'payment_settlement';
COMMIT;
```

## 6. RLS, grants and policies

```sql
BEGIN;
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

## Rollback

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
