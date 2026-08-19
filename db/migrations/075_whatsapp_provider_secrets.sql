-- Migration 075: Move provider API keys to service-role-only table
-- Keeps whatsapp_configurations tenant-readable while isolating credentials.

CREATE TABLE IF NOT EXISTS public.whatsapp_provider_secrets (
  tenant_id  UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider   TEXT        NOT NULL CHECK (provider IN ('evolution', 'waha', 'meta')),
  api_key    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, provider)
);

ALTER TABLE public.whatsapp_provider_secrets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_provider_secrets_service_role ON public.whatsapp_provider_secrets;
CREATE POLICY whatsapp_provider_secrets_service_role ON public.whatsapp_provider_secrets
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.whatsapp_provider_secrets (tenant_id, provider, api_key, created_at, updated_at)
SELECT
  wc.tenant_id,
  CASE
    WHEN wc.provider IN ('evolution', 'waha', 'meta') THEN wc.provider
    ELSE 'evolution'
  END AS provider,
  COALESCE(NULLIF(wc.provider_api_key, ''), NULLIF(wc.evolution_api_key, '')) AS api_key,
  NOW(),
  NOW()
FROM public.whatsapp_configurations wc
WHERE COALESCE(NULLIF(wc.provider_api_key, ''), NULLIF(wc.evolution_api_key, '')) IS NOT NULL
ON CONFLICT (tenant_id, provider) DO UPDATE
SET
  api_key = EXCLUDED.api_key,
  updated_at = NOW();

-- Remove plaintext secrets from tenant-readable config rows.
UPDATE public.whatsapp_configurations
SET provider_api_key = NULL
WHERE provider_api_key IS NOT NULL AND provider_api_key <> '';

UPDATE public.whatsapp_configurations
SET evolution_api_key = ''
WHERE evolution_api_key <> '';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_provider_secrets TO service_role;
