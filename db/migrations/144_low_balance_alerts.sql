-- Migration 144: low-balance warning marker for the message wallet
--
-- ai_wallets.low_balance_threshold_credits has existed since migration 077
-- (DEFAULT 25) and nothing on the message path has ever read it. Alerting only
-- at exhaustion means alerting after the damage: the bot is already silent and
-- customers are already being handed off. This column caps the pre-emptive
-- warning at one per tenant per day.
--
-- Deliberately NOT ai_wallets.message_handoff_warned_on (migration 143): that
-- marks "we told the owner the wallet is EMPTY". These are different facts, and
-- sharing one column would make either alert silently suppress the other.

ALTER TABLE public.ai_wallets
  ADD COLUMN IF NOT EXISTS low_balance_warned_on DATE;

COMMENT ON COLUMN public.ai_wallets.low_balance_warned_on IS
  'Last date a low-balance warning was emitted for this tenant. Caps the warning at one per tenant per day; a top-up re-arms it naturally by lifting the balance back above low_balance_threshold_credits.';
