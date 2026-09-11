-- Rollback for migration 145.
-- Drops the paid top-up scaffolding. Wallet balances already credited are NOT
-- reversed — the ledger rows written by topup_ai_wallet stay, because undoing
-- real money movements is a business decision, not a schema one.

DROP FUNCTION IF EXISTS public.credit_wallet_topup(TEXT, BIGINT);

DROP TABLE IF EXISTS public.wallet_topup_intents;

ALTER TABLE public.ai_wallets
  DROP COLUMN IF EXISTS paystack_authorization_code,
  DROP COLUMN IF EXISTS paystack_authorization_email,
  DROP COLUMN IF EXISTS paystack_card_last4,
  DROP COLUMN IF EXISTS paystack_card_brand,
  DROP COLUMN IF EXISTS paystack_authorization_saved_at,
  DROP COLUMN IF EXISTS auto_recharge_failed_at,
  DROP COLUMN IF EXISTS auto_recharge_failure_reason;
