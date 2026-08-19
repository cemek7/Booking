-- 070_whatsapp_provider.sql
-- Adds provider selection columns to whatsapp_configurations.
-- Existing rows default to 'evolution' — zero impact on live tenants.
-- provider_base_url / provider_api_key are read-priority fields:
--   code uses provider_base_url ?? evolution_base_url (and same for api_key)
--   so legacy columns keep working until a tenant explicitly switches.

ALTER TABLE public.whatsapp_configurations
  ADD COLUMN IF NOT EXISTS provider          TEXT NOT NULL DEFAULT 'evolution'
    CHECK (provider IN ('evolution', 'waha')),
  ADD COLUMN IF NOT EXISTS provider_base_url TEXT,
  ADD COLUMN IF NOT EXISTS provider_api_key  TEXT;
