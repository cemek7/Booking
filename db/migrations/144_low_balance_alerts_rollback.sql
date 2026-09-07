-- Rollback for migration 144
ALTER TABLE public.ai_wallets
  DROP COLUMN IF EXISTS low_balance_warned_on;
