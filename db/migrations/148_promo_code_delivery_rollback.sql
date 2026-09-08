-- Rollback for migration 148
ALTER TABLE public.wallet_promo_codes
  DROP COLUMN IF EXISTS issued_to,
  DROP COLUMN IF EXISTS issued_at;
