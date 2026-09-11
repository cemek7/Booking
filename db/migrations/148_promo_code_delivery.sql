-- Migration 148: record where a promo code was sent.
--
-- 146 stores only a hash, so a code cannot be shown twice. That makes the
-- moment of delivery the whole story: if nobody can say where a code went,
-- there is no way to answer "did the tenant ever get it?" months later.
--
-- These columns hold the delivery record, never the code.

ALTER TABLE public.wallet_promo_codes
  ADD COLUMN IF NOT EXISTS issued_to JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ;

COMMENT ON COLUMN public.wallet_promo_codes.issued_to IS
  'Email addresses the code was sent to at creation. The code itself is never stored.';
COMMENT ON COLUMN public.wallet_promo_codes.issued_at IS
  'When the code was emailed. NULL means it was only shown on screen.';
