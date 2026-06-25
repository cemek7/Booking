-- Migration 064: Ensure chats table shape, add chat_id to messages, agent_enabled to whatsapp_configurations
-- Also ensures tenant-scoped RLS on chats and service_role bypass for webhook admin client.

-- ─────────────────────────────────────────────────────────────
-- 1. Ensure chats table exists with required shape
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chats (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_phone  TEXT,
  session_id      TEXT,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  last_message_at TIMESTAMPTZ DEFAULT now(),
  unread_count    INTEGER     NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, customer_phone)
);

CREATE INDEX IF NOT EXISTS idx_chats_tenant_last_msg
  ON public.chats (tenant_id, last_message_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 2. Add chat_id FK to messages (links each message to its chat thread)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS chat_id UUID REFERENCES public.chats(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_chat_id
  ON public.messages (chat_id) WHERE chat_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 3. Tenant-scoped RLS on chats (idempotent — recreates policies from 050)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chats_tenant_read   ON public.chats;
CREATE POLICY chats_tenant_read ON public.chats
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS chats_tenant_insert ON public.chats;
CREATE POLICY chats_tenant_insert ON public.chats
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS chats_tenant_update ON public.chats;
CREATE POLICY chats_tenant_update ON public.chats
  FOR UPDATE USING (
    tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
  );

-- Service role bypasses all RLS (required by webhook admin client)
DROP POLICY IF EXISTS chats_service_role  ON public.chats;
CREATE POLICY chats_service_role ON public.chats
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 4. Add agent_enabled flag to whatsapp_configurations
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.whatsapp_configurations
  ADD COLUMN IF NOT EXISTS agent_enabled BOOLEAN NOT NULL DEFAULT false;
