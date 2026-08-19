-- Migration 051: Enable RLS on tables flagged by Supabase security adviser
--
-- Tables fall into two categories:
--   A) Tenant-scoped  — have tenant_id, scoped to tenant members
--   B) System-only    — no tenant_id, accessible by service_role only

-- ═══════════════════════════════════════════════════════════════
-- A. TENANT-SCOPED TABLES
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- tenant_reminder_settings  (owners/managers manage, staff read)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_reminder_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_reminder_settings_select ON public.tenant_reminder_settings;
CREATE POLICY tenant_reminder_settings_select ON public.tenant_reminder_settings
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS tenant_reminder_settings_write ON public.tenant_reminder_settings;
CREATE POLICY tenant_reminder_settings_write ON public.tenant_reminder_settings
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

DROP POLICY IF EXISTS tenant_reminder_settings_service_role ON public.tenant_reminder_settings;
CREATE POLICY tenant_reminder_settings_service_role ON public.tenant_reminder_settings
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- notifications  (tenant members read their own, service_role writes)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE USING (
    tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS notifications_service_role ON public.notifications;
CREATE POLICY notifications_service_role ON public.notifications
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- whatsapp_configurations  (owners only — contains API keys)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.whatsapp_configurations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_configurations_owner ON public.whatsapp_configurations;
CREATE POLICY whatsapp_configurations_owner ON public.whatsapp_configurations
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  ) WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

DROP POLICY IF EXISTS whatsapp_configurations_service_role ON public.whatsapp_configurations;
CREATE POLICY whatsapp_configurations_service_role ON public.whatsapp_configurations
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- reminders  (service_role manages, tenant members read)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reminders_select ON public.reminders;
CREATE POLICY reminders_select ON public.reminders
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS reminders_service_role ON public.reminders;
CREATE POLICY reminders_service_role ON public.reminders
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- whatsapp_connections  (owners/managers read, service_role writes)
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

DROP POLICY IF EXISTS whatsapp_connections_service_role ON public.whatsapp_connections;
CREATE POLICY whatsapp_connections_service_role ON public.whatsapp_connections
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- llm_calls  (owners/managers read for billing visibility)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.llm_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS llm_calls_select ON public.llm_calls;
CREATE POLICY llm_calls_select ON public.llm_calls
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS llm_calls_service_role ON public.llm_calls;
CREATE POLICY llm_calls_service_role ON public.llm_calls
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- dialog_sessions  (scoped to tenant + owning user)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.dialog_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dialog_sessions_select ON public.dialog_sessions;
CREATE POLICY dialog_sessions_select ON public.dialog_sessions
  FOR SELECT USING (
    user_id = auth.uid()
    OR tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS dialog_sessions_insert ON public.dialog_sessions;
CREATE POLICY dialog_sessions_insert ON public.dialog_sessions
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS dialog_sessions_update ON public.dialog_sessions;
CREATE POLICY dialog_sessions_update ON public.dialog_sessions
  FOR UPDATE USING (
    user_id = auth.uid()
    OR tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS dialog_sessions_service_role ON public.dialog_sessions;
CREATE POLICY dialog_sessions_service_role ON public.dialog_sessions
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- B. SYSTEM-ONLY TABLES (no tenant_id — service_role access only)
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- logs  (platform-wide logs, no user-level access)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS logs_service_role ON public.logs;
CREATE POLICY logs_service_role ON public.logs
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- jobs  (background job queue, no user-level access)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jobs_service_role ON public.jobs;
CREATE POLICY jobs_service_role ON public.jobs
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- platform_settings_kv  (superadmin only via tenant_users)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.platform_settings_kv ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_settings_kv_superadmin ON public.platform_settings_kv;
CREATE POLICY platform_settings_kv_superadmin ON public.platform_settings_kv
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admins
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
      AND status = true
    )
  );

DROP POLICY IF EXISTS platform_settings_kv_service_role ON public.platform_settings_kv;
CREATE POLICY platform_settings_kv_service_role ON public.platform_settings_kv
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
