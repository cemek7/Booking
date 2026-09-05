-- Migration 145: paid wallet top-up and stored card authorization
--
-- Until now `topup_ai_wallet` was the only way credits entered a wallet, and
-- nothing verified that anyone had paid. This adds the two pieces a paid flow
-- needs: an intent row that correlates a Paystack reference with the tenant and
-- amount BEFORE the customer pays, and somewhere to keep the reusable card
-- authorization that auto-recharge later charges.
--
-- The intent row is what makes the webhook trustworthy. Without it the webhook
-- would have to believe the tenant_id and amount in the payload, which is
-- attacker-controlled. With it, both are read from a row this server wrote.

CREATE TABLE IF NOT EXISTS public.wallet_topup_intents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- The Paystack transaction reference. Unique so a replayed webhook cannot
  -- create a second intent, and so credit_wallet_topup can claim by reference.
  reference       TEXT NOT NULL UNIQUE,
  amount_credits  NUMERIC(20,6) NOT NULL CHECK (amount_credits > 0),
  -- Minor units actually asked of Paystack (kobo for NGN). Kept so the webhook
  -- can refuse a charge whose amount does not match what we asked for.
  amount_minor    BIGINT NOT NULL CHECK (amount_minor > 0),
  currency        TEXT NOT NULL DEFAULT 'NGN',
  email           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'paid', 'failed', 'abandoned')),
  origin          TEXT NOT NULL DEFAULT 'manual'
                    CHECK (origin IN ('manual', 'auto_recharge')),
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_topup_intents_tenant
  ON public.wallet_topup_intents (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_topup_intents_pending
  ON public.wallet_topup_intents (status, created_at)
  WHERE status = 'pending';

COMMENT ON TABLE public.wallet_topup_intents IS
  'One row per attempted wallet top-up, written before the customer pays. The '
  'webhook reads tenant_id and amount_credits from here, never from the payload.';

-- ── Stored card authorization ────────────────────────────────────────────────
-- Paystack only allows recurring charges against an authorization whose
-- `reusable` flag is true, and only with the email that created it — so both
-- are stored, not just the code.
ALTER TABLE public.ai_wallets
  ADD COLUMN IF NOT EXISTS paystack_authorization_code TEXT,
  ADD COLUMN IF NOT EXISTS paystack_authorization_email TEXT,
  ADD COLUMN IF NOT EXISTS paystack_card_last4 TEXT,
  ADD COLUMN IF NOT EXISTS paystack_card_brand TEXT,
  ADD COLUMN IF NOT EXISTS paystack_authorization_saved_at TIMESTAMPTZ,
  -- Set when a charge is declined so a dead card is not retried every cycle.
  ADD COLUMN IF NOT EXISTS auto_recharge_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_recharge_failure_reason TEXT;

COMMENT ON COLUMN public.ai_wallets.paystack_authorization_code IS
  'Reusable Paystack authorization for auto-recharge. Only ever written from a '
  'verified charge.success webhook whose authorization.reusable was true.';
COMMENT ON COLUMN public.ai_wallets.paystack_authorization_email IS
  'The email the authorization was created with. Paystack rejects a charge sent '
  'with any other email, so it cannot be re-derived from the tenant later.';
COMMENT ON COLUMN public.ai_wallets.auto_recharge_failed_at IS
  'Last decline. auto-recharge backs off after this rather than retrying a dead '
  'card on every send.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Intents carry a payment reference and an email. Only the service role writes
-- them; owners read their own tenant's rows to see top-up history.
ALTER TABLE public.wallet_topup_intents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'wallet_topup_intents'
      AND policyname = 'wallet_topup_intents_tenant_read'
  ) THEN
    CREATE POLICY wallet_topup_intents_tenant_read
      ON public.wallet_topup_intents
      FOR SELECT
      TO authenticated
      USING (
        tenant_id IN (
          SELECT tu.tenant_id FROM public.tenant_users tu
          WHERE tu.user_id = auth.uid() AND tu.role = 'owner'
        )
      );
  END IF;
END $$;

-- No INSERT/UPDATE/DELETE policy: writes are service_role only, which bypasses
-- RLS. An owner must not be able to forge an intent — that is the whole point
-- of the table.

-- ── Credit a verified top-up ─────────────────────────────────────────────────
-- Wrapped in a function so claiming the intent and crediting the wallet happen
-- in ONE transaction. Paystack retries webhooks, so this MUST be idempotent:
-- the UPDATE ... WHERE status = 'pending' is the claim, and a second delivery
-- finds zero rows and credits nothing.
CREATE OR REPLACE FUNCTION public.credit_wallet_topup(
  p_reference TEXT,
  p_amount_minor BIGINT
)
RETURNS TABLE (
  credited BOOLEAN,
  tenant_id UUID,
  amount_credits NUMERIC,
  reason TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
-- RETURNS TABLE declares OUT params that collide with the column names below;
-- without this the planner resolves `tenant_id` to the OUT param, not the row.
#variable_conflict use_column
DECLARE
  intent public.wallet_topup_intents;
BEGIN
  UPDATE public.wallet_topup_intents
     SET status = 'paid', paid_at = now()
   WHERE reference = p_reference
     AND status = 'pending'
  RETURNING * INTO intent;

  IF intent.id IS NULL THEN
    RETURN QUERY SELECT false, NULL::UUID, 0::NUMERIC, 'no_pending_intent';
    RETURN;
  END IF;

  -- Refuse a charge that does not match what we asked Paystack for. A short
  -- payment must not buy a full top-up.
  IF p_amount_minor < intent.amount_minor THEN
    UPDATE public.wallet_topup_intents
       SET status = 'failed', paid_at = NULL
     WHERE id = intent.id;
    RETURN QUERY SELECT false, intent.tenant_id, 0::NUMERIC, 'amount_mismatch';
    RETURN;
  END IF;

  PERFORM public.topup_ai_wallet(
    intent.tenant_id,
    intent.amount_credits,
    'Wallet top-up (' || intent.origin || ')',
    intent.reference,
    jsonb_build_object('origin', intent.origin, 'reference', intent.reference)
  );

  RETURN QUERY SELECT true, intent.tenant_id, intent.amount_credits, NULL::TEXT;
END $$;

-- Postgres grants EXECUTE to PUBLIC on every new function. This one moves money.
REVOKE ALL ON FUNCTION public.credit_wallet_topup(TEXT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.credit_wallet_topup(TEXT, BIGINT) FROM anon;
REVOKE ALL ON FUNCTION public.credit_wallet_topup(TEXT, BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.credit_wallet_topup(TEXT, BIGINT) TO service_role;

-- CREATE OR REPLACE resets a search_path pin, so re-apply it here.
ALTER FUNCTION public.credit_wallet_topup(TEXT, BIGINT) SET search_path = public, pg_temp;
