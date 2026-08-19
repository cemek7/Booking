-- Migration 050: Enable RLS on tables flagged by Supabase security adviser
-- Tables exposed via API without RLS containing sensitive columns (session_id, etc.)

-- ─────────────────────────────────────────────────────────────
-- 1. analytics_events
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

-- Tenant members can read their own analytics
DROP POLICY IF EXISTS analytics_events_tenant_select ON public.analytics_events;
CREATE POLICY analytics_events_tenant_select ON public.analytics_events
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
    )
  );

-- Authenticated users can insert events (e.g. tracking from app)
DROP POLICY IF EXISTS analytics_events_insert ON public.analytics_events;
CREATE POLICY analytics_events_insert ON public.analytics_events
  FOR INSERT WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
    )
  );

-- Only owners/managers can delete analytics events
DROP POLICY IF EXISTS analytics_events_delete ON public.analytics_events;
CREATE POLICY analytics_events_delete ON public.analytics_events
  FOR DELETE USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'manager')
    )
  );

-- Service role bypasses RLS (for background jobs and webhooks)
DROP POLICY IF EXISTS analytics_events_service_role ON public.analytics_events;
CREATE POLICY analytics_events_service_role ON public.analytics_events
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 2. chats
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

-- Tenant members can read their own chats
DROP POLICY IF EXISTS chats_tenant_select ON public.chats;
CREATE POLICY chats_tenant_select ON public.chats
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
    )
  );

-- Tenant members can insert chats
DROP POLICY IF EXISTS chats_tenant_insert ON public.chats;
CREATE POLICY chats_tenant_insert ON public.chats
  FOR INSERT WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
    )
  );

-- Tenant members can update their own chats
DROP POLICY IF EXISTS chats_tenant_update ON public.chats;
CREATE POLICY chats_tenant_update ON public.chats
  FOR UPDATE USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
    )
  );

-- Only owners/managers can delete chats
DROP POLICY IF EXISTS chats_tenant_delete ON public.chats;
CREATE POLICY chats_tenant_delete ON public.chats
  FOR DELETE USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'manager')
    )
  );

-- Service role bypasses RLS
DROP POLICY IF EXISTS chats_service_role ON public.chats;
CREATE POLICY chats_service_role ON public.chats
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 3. whatsapp_conversations
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;

-- Tenant members can read their own conversations
DROP POLICY IF EXISTS whatsapp_conversations_tenant_select ON public.whatsapp_conversations;
CREATE POLICY whatsapp_conversations_tenant_select ON public.whatsapp_conversations
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
    )
  );

-- Tenant members can insert conversations
DROP POLICY IF EXISTS whatsapp_conversations_tenant_insert ON public.whatsapp_conversations;
CREATE POLICY whatsapp_conversations_tenant_insert ON public.whatsapp_conversations
  FOR INSERT WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
    )
  );

-- Tenant members can update conversations
DROP POLICY IF EXISTS whatsapp_conversations_tenant_update ON public.whatsapp_conversations;
CREATE POLICY whatsapp_conversations_tenant_update ON public.whatsapp_conversations
  FOR UPDATE USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
    )
  );

-- Only owners/managers can delete conversations
DROP POLICY IF EXISTS whatsapp_conversations_tenant_delete ON public.whatsapp_conversations;
CREATE POLICY whatsapp_conversations_tenant_delete ON public.whatsapp_conversations
  FOR DELETE USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'manager')
    )
  );

-- Service role bypasses RLS (for Evolution API webhook processing)
DROP POLICY IF EXISTS whatsapp_conversations_service_role ON public.whatsapp_conversations;
CREATE POLICY whatsapp_conversations_service_role ON public.whatsapp_conversations
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
