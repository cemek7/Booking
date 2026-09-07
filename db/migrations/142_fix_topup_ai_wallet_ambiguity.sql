-- Migration 142: fix the pre-existing ambiguous-column bug in topup_ai_wallet
-- RETURNS TABLE(..., balance_credits, ...) declares an implicit OUT variable named
-- balance_credits that collides with ai_wallets.balance_credits. Without the
-- #variable_conflict pragma, `UPDATE ai_wallets SET balance_credits = balance_credits + x`
-- throws "column reference \"balance_credits\" is ambiguous" under Postgres's default
-- variable_conflict=error. This is a real bug already present in topup_ai_wallet as
-- shipped in 077_ai_wallets.sql, confirmed by executing it against a fresh
-- postgres:16-alpine container. topup_ai_wallet has failed on every call since 077
-- shipped, meaning no wallet could ever be credited.

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
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
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

-- SECURITY: Postgres grants EXECUTE to PUBLIC on every new function, and 077
-- never revoked it. Verified in a container: after 077, `anon` and
-- `authenticated` can execute all four wallet functions. That was survivable
-- only because topup_ai_wallet was broken and always raised — this migration
-- fixes it, so without these REVOKEs it would become an anonymously callable
-- RPC that creates wallet credit out of nothing. Migration 141 did the same for
-- reserve/settle; this closes the remaining two.
REVOKE ALL ON FUNCTION public.topup_ai_wallet(UUID, NUMERIC, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_ai_wallet(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.topup_ai_wallet(UUID, NUMERIC, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_ai_wallet(UUID, TEXT) TO service_role;
