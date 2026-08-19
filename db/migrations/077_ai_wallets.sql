-- Migration 077: Tenant AI wallet and usage ledger
-- Adds per-tenant credit balances so AI spend is isolated and billing/profit
-- can be tracked without sharing a global quota pool.

CREATE TABLE IF NOT EXISTS public.ai_wallets (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  currency TEXT NOT NULL DEFAULT 'credits',
  balance_credits NUMERIC(20,6) NOT NULL DEFAULT 0,
  lifetime_topups_credits NUMERIC(20,6) NOT NULL DEFAULT 0,
  lifetime_spent_credits NUMERIC(20,6) NOT NULL DEFAULT 0,
  low_balance_threshold_credits NUMERIC(20,6) NOT NULL DEFAULT 25,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_wallet_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('topup', 'reservation', 'usage', 'refund', 'adjustment')),
  amount_credits NUMERIC(20,6) NOT NULL,
  token_count BIGINT,
  provider TEXT,
  model TEXT,
  request_id TEXT,
  reference TEXT,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_wallet_ledger_tenant_created_at
  ON public.ai_wallet_ledger (tenant_id, created_at DESC);

ALTER TABLE public.ai_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_wallet_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_wallets_service_role ON public.ai_wallets;
CREATE POLICY ai_wallets_service_role ON public.ai_wallets
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ai_wallet_ledger_service_role ON public.ai_wallet_ledger;
CREATE POLICY ai_wallet_ledger_service_role ON public.ai_wallet_ledger
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.ensure_ai_wallet(p_tenant_id UUID, p_currency TEXT DEFAULT 'credits')
RETURNS public.ai_wallets
LANGUAGE plpgsql
AS $$
DECLARE
  wallet public.ai_wallets;
BEGIN
  INSERT INTO public.ai_wallets (tenant_id, currency)
  VALUES (p_tenant_id, COALESCE(NULLIF(p_currency, ''), 'credits'))
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT * INTO wallet
  FROM public.ai_wallets
  WHERE tenant_id = p_tenant_id;

  RETURN wallet;
END;
$$;

CREATE OR REPLACE FUNCTION public.topup_ai_wallet(
  p_tenant_id UUID,
  p_amount_credits NUMERIC,
  p_reference TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  balance_credits NUMERIC,
  lifetime_topups_credits NUMERIC,
  lifetime_spent_credits NUMERIC,
  ledger_id UUID
)
LANGUAGE plpgsql
AS $$
DECLARE
  wallet public.ai_wallets;
  new_ledger_id UUID;
BEGIN
  PERFORM public.ensure_ai_wallet(p_tenant_id);

  IF p_amount_credits IS NULL OR p_amount_credits <= 0 THEN
    RAISE EXCEPTION 'amount must be greater than zero';
  END IF;

  SELECT * INTO wallet
  FROM public.ai_wallets
  WHERE tenant_id = p_tenant_id
  FOR UPDATE;

  UPDATE public.ai_wallets
  SET
    balance_credits = balance_credits + p_amount_credits,
    lifetime_topups_credits = lifetime_topups_credits + p_amount_credits,
    updated_at = NOW()
  WHERE tenant_id = p_tenant_id
  RETURNING * INTO wallet;

  INSERT INTO public.ai_wallet_ledger (
    tenant_id,
    kind,
    amount_credits,
    reference,
    description,
    metadata
  )
  VALUES (
    p_tenant_id,
    'topup',
    p_amount_credits,
    p_reference,
    COALESCE(p_description, 'Manual top-up'),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO new_ledger_id;

  RETURN QUERY SELECT wallet.balance_credits, wallet.lifetime_topups_credits, wallet.lifetime_spent_credits, new_ledger_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_ai_wallet_spend(
  p_tenant_id UUID,
  p_amount_credits NUMERIC,
  p_request_id TEXT DEFAULT NULL,
  p_provider TEXT DEFAULT NULL,
  p_model TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
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

  IF wallet.balance_credits < p_amount_credits THEN
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
    tenant_id,
    kind,
    amount_credits,
    provider,
    model,
    request_id,
    description,
    metadata
  )
  VALUES (
    p_tenant_id,
    'reservation',
    -p_amount_credits,
    p_provider,
    p_model,
    p_request_id,
    COALESCE(p_description, 'AI spend reservation'),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO new_ledger_id;

  RETURN QUERY SELECT true, wallet.balance_credits, new_ledger_id, 'reserved';
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
  p_metadata JSONB DEFAULT '{}'::jsonb
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
    tenant_id,
    kind,
    amount_credits,
    token_count,
    provider,
    model,
    request_id,
    reference,
    description,
    metadata
  )
  VALUES (
    p_tenant_id,
    CASE WHEN adjustment >= 0 THEN 'refund' ELSE 'usage' END,
    adjustment,
    p_tokens,
    p_provider,
    p_model,
    p_request_id,
    p_reservation_id::text,
    'AI spend settlement',
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO new_ledger_id;

  RETURN QUERY SELECT true, wallet.balance_credits, new_ledger_id, GREATEST(adjustment, 0), GREATEST(-adjustment, 0), 'settled';
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_ai_wallet(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.topup_ai_wallet(UUID, NUMERIC, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_ai_wallet_spend(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_ai_wallet_spend(UUID, UUID, NUMERIC, NUMERIC, BIGINT, TEXT, TEXT, TEXT, JSONB) TO service_role;
