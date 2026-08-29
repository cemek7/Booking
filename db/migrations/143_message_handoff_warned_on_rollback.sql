-- Rollback for migration 143
ALTER TABLE public.ai_wallets
  DROP COLUMN IF EXISTS message_handoff_warned_on,
  DROP COLUMN IF EXISTS message_handoff_unanchored_on;
