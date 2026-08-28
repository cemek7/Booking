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
