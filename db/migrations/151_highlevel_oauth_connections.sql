-- Migration 151: GoHighLevel Marketplace OAuth, staging sandbox only
--
-- Two tables, both service-role only.
--
-- highlevel_oauth_states exists so the `state` we send to HighLevel is
-- single-use as well as signed and expiring. A signature alone proves we minted
-- the value; it does not stop the same redirect being replayed. The row is
-- claimed by the callback and cannot be claimed twice.
--
-- highlevel_oauth_connections holds the installation. Tokens are never stored
-- in plaintext: they are encrypted with AES-256-GCM under the server-only
-- ENCRYPTION_KEY, the same scheme whatsapp_provider_secrets uses, so there is
-- one key-management pattern on the platform rather than two.

CREATE TABLE IF NOT EXISTS public.highlevel_oauth_states (
  nonce        TEXT PRIMARY KEY,
  tenant_id    UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Who started the flow, for an audit trail. Not used for authorization.
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  -- Set the moment the callback claims it. A second attempt finds it set.
  consumed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_highlevel_oauth_states_expiry
  ON public.highlevel_oauth_states (expires_at)
  WHERE consumed_at IS NULL;

COMMENT ON TABLE public.highlevel_oauth_states IS
  'Single-use nonces for the GoHighLevel OAuth redirect. Rows are short-lived; '
  'expired rows can be deleted at any time.';

CREATE TABLE IF NOT EXISTS public.highlevel_oauth_connections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- HighLevel's own identifiers for the installation.
  location_id           TEXT,
  company_id            TEXT,
  user_type             TEXT,
  ghl_user_id           TEXT,
  scope                 TEXT,

  -- AES-256-GCM, key held only in the runtime environment. Columns mirror
  -- whatsapp_provider_secrets so the same helpers read and write both.
  encrypted_access_token   TEXT NOT NULL,
  access_token_iv          TEXT NOT NULL,
  encrypted_refresh_token  TEXT,
  refresh_token_iv         TEXT,
  encryption_key_version   TEXT NOT NULL,

  token_expires_at      TIMESTAMPTZ,
  installed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at            TIMESTAMPTZ
);

-- One live connection per HighLevel location. Re-installing updates in place.
CREATE UNIQUE INDEX IF NOT EXISTS uq_highlevel_oauth_connections_location
  ON public.highlevel_oauth_connections (location_id)
  WHERE location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_highlevel_oauth_connections_tenant
  ON public.highlevel_oauth_connections (tenant_id);

COMMENT ON TABLE public.highlevel_oauth_connections IS
  'GoHighLevel Marketplace installations. Access and refresh tokens are stored '
  'encrypted; nothing here is readable without the runtime ENCRYPTION_KEY.';
COMMENT ON COLUMN public.highlevel_oauth_connections.encrypted_access_token IS
  'AES-256-GCM ciphertext plus auth tag, base64. Never a plaintext token.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- These rows are credentials. RLS with no policy denies everything to anon and
-- authenticated; service_role bypasses RLS. Only server-side code reaches them.
ALTER TABLE public.highlevel_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.highlevel_oauth_connections ENABLE ROW LEVEL SECURITY;
