-- Rollback for migration 142: restores the original buggy topup_ai_wallet from 077_ai_wallets.sql
-- A rollback reproduces prior state; it deliberately restores the broken version.

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

GRANT EXECUTE ON FUNCTION public.topup_ai_wallet(UUID, NUMERIC, TEXT, TEXT, JSONB) TO service_role;

-- The execution boundary is held on BOTH sides. Rolling back restores the
-- previous (broken) function body, which is what a rollback is for — but it
-- must never restore PUBLIC/anon EXECUTE on functions that create or move
-- wallet credit. Postgres grants EXECUTE to PUBLIC on every new function and
-- 077 never revoked it, so re-issuing these here is what keeps a rollback from
-- reinstating a vulnerability in the name of symmetry. Matches migration 141.
REVOKE ALL ON FUNCTION public.topup_ai_wallet(UUID, NUMERIC, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_ai_wallet(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.topup_ai_wallet(UUID, NUMERIC, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_ai_wallet(UUID, TEXT) TO service_role;
