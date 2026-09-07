-- Migration 139: WhatsApp metering — meter dimension and wallet knobs
-- Extends the existing AI wallet so a single tenant balance funds two meters
-- (LLM tokens and WhatsApp messages) without duplicating reserve/settle logic.

ALTER TABLE public.ai_wallets
  ADD COLUMN IF NOT EXISTS message_rate_credits NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS grace_overdraft_credits NUMERIC(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_recharge_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_recharge_threshold_credits NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS auto_recharge_amount_credits NUMERIC(20,6);

COMMENT ON COLUMN public.ai_wallets.message_rate_credits IS
  'Per-tenant override for the WhatsApp message sell rate. NULL = platform default.';
COMMENT ON COLUMN public.ai_wallets.grace_overdraft_credits IS
  'How far below zero this wallet may go for message sends before handoff.';

ALTER TABLE public.ai_wallet_ledger
  ADD COLUMN IF NOT EXISTS meter TEXT NOT NULL DEFAULT 'llm';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_wallet_ledger_meter_check'
  ) THEN
    ALTER TABLE public.ai_wallet_ledger
      ADD CONSTRAINT ai_wallet_ledger_meter_check
      CHECK (meter IN ('llm', 'whatsapp'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_wallet_ledger_tenant_meter_created_at
  ON public.ai_wallet_ledger (tenant_id, meter, created_at DESC);
