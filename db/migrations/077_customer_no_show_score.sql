-- Migration 077: customer no-show reputation scoring
-- Additive only: no table creation, no destructive changes.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS no_show_count INT NOT NULL DEFAULT 0;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS risk_score TEXT NOT NULL DEFAULT 'low'
    CHECK (risk_score IN ('low', 'medium', 'high'));
