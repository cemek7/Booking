-- Migration 057: Fill schema gaps required by the Evolution API integration
--
-- webhook_events already exists (migration 023) with a minimal schema — we
-- extend it with the columns our webhook handler needs rather than recreating it.
-- whatsapp_media and whatsapp_sessions are new tables.
-- messages and whatsapp_conversations get missing columns.

-- ─────────────────────────────────────────────────────────────
-- 1. webhook_events — extend existing table
--    Migration 023 created: id, provider, external_id, event_type,
--      payload, processed_at, tenant_id
--    The Evolution webhook handler also writes: signature, created_at
--    UNIQUE(provider, external_id) already exists — no changes needed there.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS signature   TEXT,
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- TTL-friendly index (only create after ensuring the column exists)
CREATE INDEX IF NOT EXISTS idx_webhook_events_created
  ON public.webhook_events (created_at DESC);

-- service_role policy — 023 adds one but under a different name; add ours idempotently
DROP POLICY IF EXISTS webhook_events_service_role ON public.webhook_events;
CREATE POLICY webhook_events_service_role ON public.webhook_events
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 2. whatsapp_media  (new table)
--    Stores metadata for every media file received/sent via WhatsApp.
--    Referenced by: src/lib/whatsapp/mediaHandler.ts
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_media (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number  TEXT        NOT NULL,
  message_id    TEXT        NOT NULL,
  file_type     TEXT        NOT NULL
                              CHECK (file_type IN ('image','document','audio','video','sticker')),
  mime_type     TEXT        NOT NULL,
  file_name     TEXT        NOT NULL DEFAULT '',
  file_size     BIGINT      NOT NULL DEFAULT 0,
  file_url      TEXT        NOT NULL,
  thumbnail_url TEXT,
  caption       TEXT,
  duration      INTEGER,
  metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  processed     BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_media_tenant
  ON public.whatsapp_media (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_media_message
  ON public.whatsapp_media (message_id);

ALTER TABLE public.whatsapp_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_media_select ON public.whatsapp_media;
CREATE POLICY whatsapp_media_select ON public.whatsapp_media
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS whatsapp_media_service_role ON public.whatsapp_media;
CREATE POLICY whatsapp_media_service_role ON public.whatsapp_media
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 3. whatsapp_sessions  (new table)
--    Ephemeral sessions for the review-collection flow.
--    Referenced by: src/lib/whatsapp/messageProcessor.ts
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number TEXT        NOT NULL,
  session_type TEXT        NOT NULL DEFAULT 'review_collection'
                             CHECK (session_type IN ('review_collection', 'booking', 'general')),
  metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone_number, session_type)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_tenant_phone
  ON public.whatsapp_sessions (tenant_id, phone_number);

ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_sessions_service_role ON public.whatsapp_sessions;
CREATE POLICY whatsapp_sessions_service_role ON public.whatsapp_sessions
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 4. messages — add missing `direction` column
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'inbound'
    CHECK (direction IN ('inbound', 'outbound'));

-- ─────────────────────────────────────────────────────────────
-- 5. whatsapp_conversations — add missing columns
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS active               BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS conversation_history JSONB   NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_whatsapp_conv_active
  ON public.whatsapp_conversations (tenant_id, active)
  WHERE active = true;
