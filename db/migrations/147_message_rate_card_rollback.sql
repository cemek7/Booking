-- Rollback for migration 147. Pricing falls back to the env vars
-- (BOOKA_MESSAGE_RATE_CREDITS / BOOKA_MESSAGE_MARKETING_RATE_CREDITS) and the
-- provisional constants in messageRates.ts, which is the pre-146 behaviour.
DROP TABLE IF EXISTS public.message_rate_card;
DROP TABLE IF EXISTS public.platform_fx_rates;
