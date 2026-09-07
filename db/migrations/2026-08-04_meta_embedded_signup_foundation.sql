-- Meta WhatsApp Embedded Signup foundation
--
-- This migration is additive. It prepares Booka for tenant-owned WABAs and
-- phone numbers connected either through the current operator-assisted Direct
-- Cloud API path or the future Meta Embedded Signup path.
--
-- IMPORTANT:
-- - Do not put raw Meta access tokens in whatsapp_configurations.
-- - New Meta tokens should be stored encrypted in whatsapp_provider_secrets.
-- - Existing api_key values are deliberately not transformed here: encryption
--   must happen in application code using the server-only ENCRYPTION_KEY.

BEGIN;

-- 1. Tenant connection lifecycle. These columns contain identifiers and state,
-- never a Meta access token or payment-card information.
ALTER TABLE public.whatsapp_configurations
  ADD COLUMN IF NOT EXISTS meta_connection_source TEXT,
  ADD COLUMN IF NOT EXISTS meta_connection_status TEXT,
  ADD COLUMN IF NOT EXISTS meta_billing_owner TEXT,
  ADD COLUMN IF NOT EXISTS meta_connected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meta_disconnected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meta_webhook_subscribed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meta_last_validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meta_last_error TEXT;

ALTER TABLE public.whatsapp_configurations
  DROP CONSTRAINT IF EXISTS whatsapp_configurations_meta_connection_source_check,
  ADD CONSTRAINT whatsapp_configurations_meta_connection_source_check
    CHECK (meta_connection_source IS NULL OR meta_connection_source IN ('direct', 'embedded_signup')),
  DROP CONSTRAINT IF EXISTS whatsapp_configurations_meta_connection_status_check,
  ADD CONSTRAINT whatsapp_configurations_meta_connection_status_check
    CHECK (meta_connection_status IS NULL OR meta_connection_status IN (
      'pending', 'connected', 'action_required', 'disconnected', 'revoked', 'failed'
    )),
  DROP CONSTRAINT IF EXISTS whatsapp_configurations_meta_billing_owner_check,
  ADD CONSTRAINT whatsapp_configurations_meta_billing_owner_check
    CHECK (meta_billing_owner IS NULL OR meta_billing_owner IN ('client', 'booka'));

-- Existing active Meta mappings are known operator-assisted connections.
UPDATE public.whatsapp_configurations
SET
  meta_connection_source = COALESCE(meta_connection_source, 'direct'),
  meta_connection_status = COALESCE(meta_connection_status, 'connected'),
  meta_billing_owner = COALESCE(meta_billing_owner, 'client'),
  meta_connected_at = COALESCE(meta_connected_at, updated_at, created_at, NOW())
WHERE provider = 'meta'
  AND active = true
  AND meta_phone_number_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_configurations_meta_connection_status
  ON public.whatsapp_configurations (meta_connection_status)
  WHERE provider = 'meta';

-- 2. Encrypted Meta credential envelope. `api_key` remains nullable only for
-- encrypted rows and legacy rows; application code must prefer encrypted_api_key.
ALTER TABLE public.whatsapp_provider_secrets
  ALTER COLUMN api_key DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS encrypted_api_key TEXT,
  ADD COLUMN IF NOT EXISTS encryption_iv TEXT,
  ADD COLUMN IF NOT EXISTS encryption_key_version TEXT,
  ADD COLUMN IF NOT EXISTS token_scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

ALTER TABLE public.whatsapp_provider_secrets
  DROP CONSTRAINT IF EXISTS whatsapp_provider_secrets_encrypted_key_check,
  ADD CONSTRAINT whatsapp_provider_secrets_encrypted_key_check
    CHECK (
      (encrypted_api_key IS NULL AND encryption_iv IS NULL AND encryption_key_version IS NULL)
      OR
      (encrypted_api_key IS NOT NULL AND encryption_iv IS NOT NULL AND encryption_key_version IS NOT NULL)
    );

-- 3. Append-only, token-free audit trail for provisioning and disconnection.
CREATE TABLE IF NOT EXISTS public.tenant_meta_connection_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'connection_started', 'connection_connected', 'connection_failed',
    'webhook_subscribed', 'credential_rotated', 'connection_disconnected',
    'connection_revoked', 'validation_failed'
  )),
  connection_source TEXT CHECK (connection_source IN ('direct', 'embedded_signup')),
  actor_user_id UUID,
  meta_waba_id TEXT,
  meta_phone_number_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenant_meta_connection_events_no_credentials
    CHECK (NOT (metadata ? 'access_token') AND NOT (metadata ? 'api_key'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_meta_connection_events_tenant_created
  ON public.tenant_meta_connection_events (tenant_id, created_at DESC);

ALTER TABLE public.tenant_meta_connection_events ENABLE ROW LEVEL SECURITY;

-- This is a server-only audit table. Tenant owners receive a redacted status
-- through Booka API routes; they must never read credentials or raw Meta events.
REVOKE ALL ON TABLE public.tenant_meta_connection_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenant_meta_connection_events TO service_role;

COMMIT;
