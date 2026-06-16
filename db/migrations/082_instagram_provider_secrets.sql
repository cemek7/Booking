-- 082_instagram_provider_secrets.sql
-- Extend whatsapp_provider_secrets to hold Instagram credentials.
-- ADDITIVE + WhatsApp-zero-touch: existing rows are untouched. Adds 'instagram' to the
-- provider CHECK and the columns getTenantInstagramConfig already reads (base_url,
-- instance_name), plus token_expires_at for the 60-day long-lived IG token refresh cycle.
--
-- For Instagram rows:
--   api_key       = long-lived Instagram User access token
--   base_url      = 'https://graph.instagram.com/v25.0'
--   instance_name = Instagram-scoped business account id (the webhook recipient.id)
--   token_expires_at = when the long-lived token expires (refresh before this)

BEGIN;

-- 1. Allow the 'instagram' provider value.
ALTER TABLE public.whatsapp_provider_secrets
  DROP CONSTRAINT IF EXISTS whatsapp_provider_secrets_provider_check;
ALTER TABLE public.whatsapp_provider_secrets
  ADD CONSTRAINT whatsapp_provider_secrets_provider_check
  CHECK (provider IN ('evolution', 'waha', 'meta', 'instagram'));

-- 2. Columns the Instagram config + adapter need (nullable; WhatsApp rows leave them NULL).
ALTER TABLE public.whatsapp_provider_secrets
  ADD COLUMN IF NOT EXISTS base_url         TEXT,
  ADD COLUMN IF NOT EXISTS instance_name    TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;

-- 3. Webhook recipient (IG business account id) -> tenant lookup.
CREATE INDEX IF NOT EXISTS idx_wa_provider_secrets_provider_instance
  ON public.whatsapp_provider_secrets (provider, instance_name)
  WHERE instance_name IS NOT NULL;

COMMIT;
