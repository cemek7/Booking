-- Migration 097: per-tenant wallet cost caps
-- SAFE: additive columns only.

ALTER TABLE public.ai_wallets
  ADD COLUMN IF NOT EXISTS daily_budget_credits NUMERIC,
  ADD COLUMN IF NOT EXISTS velocity_credits_override NUMERIC,
  ADD COLUMN IF NOT EXISTS budget_warned_on DATE;
