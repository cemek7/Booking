-- Rollback for 082_instagram_provider_secrets.sql
-- Safe ONLY before any Instagram secrets exist (otherwise restoring the old CHECK fails).
BEGIN;
DROP INDEX IF EXISTS idx_wa_provider_secrets_provider_instance;
ALTER TABLE public.whatsapp_provider_secrets
  DROP CONSTRAINT IF EXISTS whatsapp_provider_secrets_provider_check;
ALTER TABLE public.whatsapp_provider_secrets
  ADD CONSTRAINT whatsapp_provider_secrets_provider_check
  CHECK (provider IN ('evolution', 'waha', 'meta'));
ALTER TABLE public.whatsapp_provider_secrets
  DROP COLUMN IF EXISTS token_expires_at,
  DROP COLUMN IF EXISTS instance_name,
  DROP COLUMN IF EXISTS base_url;
COMMIT;
