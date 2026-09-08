-- Migration 146: promotional wallet credits.
--
-- 145 made paid credits the only way a tenant can add value to a wallet. That
-- is correct, but it also removed any route for a trial grant, a marketing
-- campaign or a goodwill gesture that is not a superadmin manually typing an
-- amount. This adds one: a redeemable code with its own audit trail.
--
-- The code itself is never stored. We keep a SHA-256 hash, so a leak of this
-- table does not hand anyone a working code, and lookup stays a single indexed
-- equality check.
--
-- Promotional credits deliberately do NOT touch tenant_revenue_ledger. They
-- are not revenue; booking them as such would overstate realized profit.
-- They also do not increment lifetime_topups_credits, which tracks money
-- actually paid.

CREATE TABLE IF NOT EXISTS public.wallet_promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash TEXT NOT NULL UNIQUE,
  campaign TEXT NOT NULL,
  amount_credits NUMERIC(20,6) NOT NULL CHECK (amount_credits > 0),
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  -- NULL means uncapped overall; per-tenant always has a cap.
  max_redemptions INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  max_redemptions_per_tenant INTEGER NOT NULL DEFAULT 1 CHECK (max_redemptions_per_tenant > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR starts_at IS NULL OR expires_at > starts_at)
);

CREATE TABLE IF NOT EXISTS public.wallet_promo_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: a redeemed code is an accounting record. Deleting the campaign
  -- must not silently erase the grants it made.
  promo_code_id UUID NOT NULL REFERENCES public.wallet_promo_codes(id) ON DELETE RESTRICT,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  redeemer_user_id UUID,
  amount_credits NUMERIC(20,6) NOT NULL CHECK (amount_credits > 0),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_promo_redemptions_code_tenant
  ON public.wallet_promo_redemptions (promo_code_id, tenant_id);

ALTER TABLE public.wallet_promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_promo_redemptions ENABLE ROW LEVEL SECURITY;

-- No policies are defined on purpose. Codes and redemptions are service-role
-- only; a tenant seeing other campaigns' codes would defeat the point. The
-- owner's view of a granted credit is the existing wallet ledger entry.

-- ── Redeem a promotional code ────────────────────────────────────────────────
-- One transaction: validate, claim, credit, record. The row lock on the code
-- serializes concurrent redemptions, so two simultaneous attempts cannot both
-- pass a cap check.
CREATE OR REPLACE FUNCTION public.redeem_wallet_promo(
  p_tenant_id UUID,
  p_code_hash TEXT,
  p_redeemer_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  redeemed BOOLEAN,
  balance_credits NUMERIC,
  amount_credits NUMERIC,
  reason TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
-- RETURNS TABLE OUT params collide with the column names below.
#variable_conflict use_column
DECLARE
  promo public.wallet_promo_codes;
  wallet public.ai_wallets;
  total_redemptions INTEGER;
  tenant_redemptions INTEGER;
BEGIN
  SELECT * INTO promo
  FROM public.wallet_promo_codes
  WHERE code_hash = p_code_hash
  FOR UPDATE;

  -- One shared reason for every "this code will not work" case. Distinguishing
  -- expired from exhausted from nonexistent would let someone probe for valid
  -- codes.
  IF promo.id IS NULL
     OR NOT promo.active
     OR (promo.starts_at IS NOT NULL AND promo.starts_at > now())
     OR (promo.expires_at IS NOT NULL AND promo.expires_at <= now())
  THEN
    RETURN QUERY SELECT false, 0::NUMERIC, 0::NUMERIC, 'invalid_promo';
    RETURN;
  END IF;

  SELECT count(*) INTO total_redemptions
  FROM public.wallet_promo_redemptions
  WHERE promo_code_id = promo.id;

  SELECT count(*) INTO tenant_redemptions
  FROM public.wallet_promo_redemptions
  WHERE promo_code_id = promo.id AND tenant_id = p_tenant_id;

  IF (promo.max_redemptions IS NOT NULL AND total_redemptions >= promo.max_redemptions)
     OR tenant_redemptions >= promo.max_redemptions_per_tenant
  THEN
    RETURN QUERY SELECT false, 0::NUMERIC, 0::NUMERIC, 'invalid_promo';
    RETURN;
  END IF;

  PERFORM public.ensure_ai_wallet(p_tenant_id);

  -- balance only: lifetime_topups_credits means money paid, and this was free.
  UPDATE public.ai_wallets
     SET balance_credits = balance_credits + promo.amount_credits,
         updated_at = now()
   WHERE tenant_id = p_tenant_id
  RETURNING * INTO wallet;

  INSERT INTO public.wallet_promo_redemptions
    (promo_code_id, tenant_id, redeemer_user_id, amount_credits)
  VALUES (promo.id, p_tenant_id, p_redeemer_user_id, promo.amount_credits);

  INSERT INTO public.ai_wallet_ledger
    (tenant_id, kind, amount_credits, reference, description, metadata)
  VALUES (
    p_tenant_id,
    'adjustment',
    promo.amount_credits,
    promo.id::text,
    'Promotional credit (' || promo.campaign || ')',
    jsonb_build_object('campaign', promo.campaign, 'promo_code_id', promo.id)
  );

  RETURN QUERY SELECT true, wallet.balance_credits, promo.amount_credits, NULL::TEXT;
END $$;

-- Postgres grants EXECUTE to PUBLIC on every new function. This one moves value.
REVOKE ALL ON FUNCTION public.redeem_wallet_promo(UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_wallet_promo(UUID, TEXT, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.redeem_wallet_promo(UUID, TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_wallet_promo(UUID, TEXT, UUID) TO service_role;

-- CREATE OR REPLACE resets a search_path pin, so re-apply it here.
ALTER FUNCTION public.redeem_wallet_promo(UUID, TEXT, UUID) SET search_path = public, pg_temp;
