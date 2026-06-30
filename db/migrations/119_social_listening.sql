-- 119_social_listening.sql
--
-- Social listening: per-tenant config + deduped mentions. Additive, idempotent.
-- Provider remains stubbed until the platform spike selects a real aggregator.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tenant_listening_config (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  business_name text NOT NULL,
  handles text[] NOT NULL DEFAULT '{}',
  keywords text[] NOT NULL DEFAULT '{}',
  platforms text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT false,
  last_polled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_id text NOT NULL,
  platform text NOT NULL,
  author text,
  url text,
  content text,
  matched_term text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'engaged', 'dismissed', 'converted')),
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, external_id)
);

ALTER TABLE public.social_mentions
  ADD COLUMN IF NOT EXISTS raw jsonb,
  ADD COLUMN IF NOT EXISTS ingested_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_social_mentions_tenant_status
  ON public.social_mentions (tenant_id, status, created_at DESC);

COMMIT;
