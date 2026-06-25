-- 072_meta_provider_support.sql
-- Adds Meta Cloud API support fields and constraints for multi-tenant mapping.

ALTER TABLE public.whatsapp_configurations
  ADD COLUMN IF NOT EXISTS meta_phone_number_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_waba_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_business_account_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_token_ref TEXT,
  ADD COLUMN IF NOT EXISTS meta_verify_token TEXT;

-- Replace provider constraint to include `meta`.
ALTER TABLE public.whatsapp_configurations
  DROP CONSTRAINT IF EXISTS whatsapp_configurations_provider_check;

ALTER TABLE public.whatsapp_configurations
  ADD CONSTRAINT whatsapp_configurations_provider_check
  CHECK (provider IN ('evolution', 'waha', 'meta'));

-- One active Meta phone_number_id can only belong to one tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_cfg_meta_phone_active
  ON public.whatsapp_configurations (meta_phone_number_id)
  WHERE provider = 'meta' AND active = true AND meta_phone_number_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_cfg_meta_phone
  ON public.whatsapp_configurations (meta_phone_number_id);
