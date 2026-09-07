-- Rollback for migration 141
-- Restores the pre-141 reserve_ai_wallet_spend / settle_ai_wallet_spend signatures
-- verbatim from db/migrations/077_ai_wallets.sql (lines 124-276 for the two
-- function bodies, 280-281 for their GRANTs).
DROP FUNCTION IF EXISTS public.reserve_ai_wallet_spend(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.settle_ai_wallet_spend(UUID, UUID, NUMERIC, NUMERIC, BIGINT, TEXT, TEXT, TEXT, JSONB, TEXT);

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
SET search_path = public, pg_temp
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
SET search_path = public, pg_temp
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

REVOKE ALL ON FUNCTION public.reserve_ai_wallet_spend(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_ai_wallet_spend(UUID, UUID, NUMERIC, NUMERIC, BIGINT, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_ai_wallet_spend(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_ai_wallet_spend(UUID, UUID, NUMERIC, NUMERIC, BIGINT, TEXT, TEXT, TEXT, JSONB) TO service_role;
