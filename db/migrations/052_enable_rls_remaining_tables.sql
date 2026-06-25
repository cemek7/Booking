-- Migration 052: Enable RLS on tables flagged by Supabase security adviser
--
-- Tables:
--   tenant_tone_profiles  — sensitive AI config, owner/manager only
--   reservation_trends    — analytics aggregates, owner/manager read
--   support_assignments   — no tenant_id, scoped via support_tickets join
--   staff_ratings         — analytics aggregates, tenant members read
--   service_ratings       — analytics aggregates, tenant members read
--   tasks                 — tenant-scoped, members CRUD with ownership rules

-- ─────────────────────────────────────────────────────────────
-- 1. tenant_tone_profiles  (owners/managers only — sensitive AI config)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_tone_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_tone_profiles_owner_manager ON public.tenant_tone_profiles;
CREATE POLICY tenant_tone_profiles_owner_manager ON public.tenant_tone_profiles
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

DROP POLICY IF EXISTS tenant_tone_profiles_service_role ON public.tenant_tone_profiles;
CREATE POLICY tenant_tone_profiles_service_role ON public.tenant_tone_profiles
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 2. reservation_trends  (owners/managers read; service_role writes aggregates)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.reservation_trends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reservation_trends_select ON public.reservation_trends;
CREATE POLICY reservation_trends_select ON public.reservation_trends
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS reservation_trends_service_role ON public.reservation_trends;
CREATE POLICY reservation_trends_service_role ON public.reservation_trends
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 3. support_assignments  (no tenant_id — scoped via support_tickets)
--    assigned_to / assigned_by are auth.users ids
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.support_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_assignments_select ON public.support_assignments;
CREATE POLICY support_assignments_select ON public.support_assignments
  FOR SELECT USING (
    -- user is a member of the tenant that owns the ticket
    EXISTS (
      SELECT 1 FROM support_tickets st
      JOIN tenant_users tu ON tu.tenant_id = st.tenant_id
      WHERE st.id = ticket_id AND tu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS support_assignments_write ON public.support_assignments;
CREATE POLICY support_assignments_write ON public.support_assignments
  FOR ALL USING (
    -- only owners/managers can assign support tickets
    EXISTS (
      SELECT 1 FROM support_tickets st
      JOIN tenant_users tu ON tu.tenant_id = st.tenant_id
      WHERE st.id = ticket_id
        AND tu.user_id = auth.uid()
        AND tu.role IN ('owner', 'manager')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM support_tickets st
      JOIN tenant_users tu ON tu.tenant_id = st.tenant_id
      WHERE st.id = ticket_id
        AND tu.user_id = auth.uid()
        AND tu.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS support_assignments_service_role ON public.support_assignments;
CREATE POLICY support_assignments_service_role ON public.support_assignments
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 4. staff_ratings  (all tenant members read; service_role writes)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.staff_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_ratings_select ON public.staff_ratings;
CREATE POLICY staff_ratings_select ON public.staff_ratings
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS staff_ratings_service_role ON public.staff_ratings;
CREATE POLICY staff_ratings_service_role ON public.staff_ratings
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 5. service_ratings  (all tenant members read; service_role writes)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.service_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_ratings_select ON public.service_ratings;
CREATE POLICY service_ratings_select ON public.service_ratings
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS service_ratings_service_role ON public.service_ratings;
CREATE POLICY service_ratings_service_role ON public.service_ratings
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 6. tasks  (tenant members CRUD; creator can always edit their own)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_select ON public.tasks;
CREATE POLICY tasks_select ON public.tasks
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS tasks_insert ON public.tasks;
CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE USING (
    -- creator can update their own; owners/managers can update any task in tenant
    created_by = auth.uid()
    OR tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS tasks_delete ON public.tasks;
CREATE POLICY tasks_delete ON public.tasks
  FOR DELETE USING (
    -- only owners/managers can delete tasks
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS tasks_service_role ON public.tasks;
CREATE POLICY tasks_service_role ON public.tasks
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
