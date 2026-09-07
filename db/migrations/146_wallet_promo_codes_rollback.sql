-- Rollback for migration 146
DROP FUNCTION IF EXISTS public.redeem_wallet_promo(UUID, TEXT, UUID);
DROP TABLE IF EXISTS public.wallet_promo_redemptions;
DROP TABLE IF EXISTS public.wallet_promo_codes;
