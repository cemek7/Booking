-- Migration 056: RLS for whatsapp_configurations, whatsapp_connections, whatsapp_conversations
--
-- These tables were created in 047 but were not covered by 053.
-- The two deduplication tables (whatsapp_message_deduplication, whatsapp_message_sequences)
-- that appeared in the original 056 draft have been removed — they backed dead code
-- (messageDeduplicator.ts, never imported). Deduplication is handled by the
-- UNIQUE(provider, external_id) constraint on webhook_events.

-- ─────────────────────────────────────────────────────────────
-- 1. whatsapp_configurations  (owner/manager CRUD; service_role all)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.whatsapp_configurations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_configurations_select ON public.whatsapp_configurations;
CREATE POLICY whatsapp_configurations_select ON public.whatsapp_configurations
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS whatsapp_configurations_write ON public.whatsapp_configurations;
CREATE POLICY whatsapp_configurations_write ON public.whatsapp_configurations
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  ) WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS whatsapp_configurations_service_role ON public.whatsapp_configurations;
CREATE POLICY whatsapp_configurations_service_role ON public.whatsapp_configurations
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 2. whatsapp_connections  (owner/manager read; service_role all)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_connections_select ON public.whatsapp_connections;
CREATE POLICY whatsapp_connections_select ON public.whatsapp_connections
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS whatsapp_connections_write ON public.whatsapp_connections;
CREATE POLICY whatsapp_connections_write ON public.whatsapp_connections
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  ) WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS whatsapp_connections_service_role ON public.whatsapp_connections;
CREATE POLICY whatsapp_connections_service_role ON public.whatsapp_connections
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 3. whatsapp_conversations  (owner/manager read; service_role all)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_conversations_select ON public.whatsapp_conversations;
CREATE POLICY whatsapp_conversations_select ON public.whatsapp_conversations
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS whatsapp_conversations_write ON public.whatsapp_conversations;
CREATE POLICY whatsapp_conversations_write ON public.whatsapp_conversations
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  ) WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS whatsapp_conversations_service_role ON public.whatsapp_conversations;
CREATE POLICY whatsapp_conversations_service_role ON public.whatsapp_conversations
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
