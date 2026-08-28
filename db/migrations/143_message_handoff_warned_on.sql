-- Migration 143: per-tenant-per-day markers for the wallet-exhausted handoff
-- One wallet exhaustion fans out to every live conversation. Without a
-- per-tenant marker the owner gets one notifications row plus one Telegram
-- ping per active customer, so 50 live chats became a 50-message burst.
--
-- Deliberately NOT ai_wallets.budget_warned_on: that column belongs to the
-- spend-cap alerter (src/lib/billing/spendCaps/spendAlerts.ts), and sharing it
-- would let a spend-cap warning silently suppress a wallet-handoff alert.

ALTER TABLE public.ai_wallets
  ADD COLUMN IF NOT EXISTS message_handoff_warned_on DATE,
  ADD COLUMN IF NOT EXISTS message_handoff_unanchored_on DATE;

COMMENT ON COLUMN public.ai_wallets.message_handoff_warned_on IS
  'Last date an owner alert for a wallet-exhausted message handoff was emitted. Caps the alert at one per tenant per day.';
COMMENT ON COLUMN public.ai_wallets.message_handoff_unanchored_on IS
  'Last date a handoff was sent but its per-conversation chats.metadata stamp could not be written. While set to today, further handoffs for this tenant are suppressed, so a broken stamp costs one platform-funded send per tenant per day instead of one per inbound message.';
