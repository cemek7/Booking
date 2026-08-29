-- Migration 141: overdraft-aware wallet reservation with a meter dimension
-- The pre-141 reservation hard-fails on insufficient balance. Message sends
-- need a bounded grace overdraft so an empty wallet degrades loudly instead of
-- going silent mid-conversation.

-- The old signatures must be dropped explicitly. Leaving them in place creates
-- an overload that makes Supabase's named-parameter RPC resolution ambiguous at
-- runtime rather than at deploy time.

-- `#variable_conflict use_column` is required in both bodies below: RETURNS
-- TABLE(..., balance_credits, ...) declares an implicit OUT variable named
-- balance_credits that collides with ai_wallets.balance_credits. Without this
-- pragma, `UPDATE ai_wallets SET balance_credits = balance_credits - x` throws
-- "column reference \"balance_credits\" is ambiguous" under Postgres's default
-- variable_conflict=error — this is a real bug already present (unfixed) in
-- reserve_ai_wallet_spend/settle_ai_wallet_spend as shipped in 077_ai_wallets.sql,
-- confirmed by executing them against a fresh postgres:16-alpine container.
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
#variable_conflict use_column
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
#variable_conflict use_column
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

REVOKE ALL ON FUNCTION public.reserve_ai_wallet_spend(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_ai_wallet_spend(UUID, UUID, NUMERIC, NUMERIC, BIGINT, TEXT, TEXT, TEXT, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_ai_wallet_spend(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_ai_wallet_spend(UUID, UUID, NUMERIC, NUMERIC, BIGINT, TEXT, TEXT, TEXT, JSONB, TEXT) TO service_role;
