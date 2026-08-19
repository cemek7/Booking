-- 118_support_schema_reconcile.sql
--
-- Reconciles the in-repo support schema with the support tables already present
-- in production-like databases. This is additive and idempotent:
-- - creates support_tickets / support_messages / support_assignments if absent
-- - backfills the richer currently-used columns if a partial shape exists
-- - keeps tenant->Booka support separate from customer inbox operations

BEGIN;

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  subject text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz DEFAULT now(),
  priority text DEFAULT 'normal',
  escalated boolean NOT NULL DEFAULT false,
  escalated_at timestamptz,
  escalated_by uuid,
  assignee_id uuid,
  metadata jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS escalated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_by uuid,
  ADD COLUMN IF NOT EXISTS assignee_id uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id uuid,
  author_role text,
  body text NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_messages
  ADD COLUMN IF NOT EXISTS author_id uuid,
  ADD COLUMN IF NOT EXISTS author_role text,
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.support_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL,
  assigned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_assignments
  ADD COLUMN IF NOT EXISTS assigned_to uuid,
  ADD COLUMN IF NOT EXISTS assigned_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_status
  ON public.support_tickets (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket
  ON public.support_messages (ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_support_assignments_ticket
  ON public.support_assignments (ticket_id, created_at DESC);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_tickets_select ON public.support_tickets;
CREATE POLICY support_tickets_select ON public.support_tickets
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_users
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS support_tickets_insert ON public.support_tickets;
CREATE POLICY support_tickets_insert ON public.support_tickets
  FOR INSERT WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_users
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS support_tickets_update ON public.support_tickets;
CREATE POLICY support_tickets_update ON public.support_tickets
  FOR UPDATE USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_users
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS support_tickets_service_role ON public.support_tickets;
CREATE POLICY support_tickets_service_role ON public.support_tickets
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS support_messages_select ON public.support_messages;
CREATE POLICY support_messages_select ON public.support_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.support_tickets st
      JOIN public.tenant_users tu ON tu.tenant_id = st.tenant_id
      WHERE st.id = ticket_id
        AND tu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS support_messages_insert ON public.support_messages;
CREATE POLICY support_messages_insert ON public.support_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.support_tickets st
      JOIN public.tenant_users tu ON tu.tenant_id = st.tenant_id
      WHERE st.id = ticket_id
        AND tu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS support_messages_service_role ON public.support_messages;
CREATE POLICY support_messages_service_role ON public.support_messages
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS support_assignments_select ON public.support_assignments;
CREATE POLICY support_assignments_select ON public.support_assignments
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.support_tickets st
      JOIN public.tenant_users tu ON tu.tenant_id = st.tenant_id
      WHERE st.id = ticket_id
        AND tu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS support_assignments_write ON public.support_assignments;
CREATE POLICY support_assignments_write ON public.support_assignments
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM public.support_tickets st
      JOIN public.tenant_users tu ON tu.tenant_id = st.tenant_id
      WHERE st.id = ticket_id
        AND tu.user_id = auth.uid()
        AND tu.role IN ('owner', 'manager')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.support_tickets st
      JOIN public.tenant_users tu ON tu.tenant_id = st.tenant_id
      WHERE st.id = ticket_id
        AND tu.user_id = auth.uid()
        AND tu.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS support_assignments_service_role ON public.support_assignments;
CREATE POLICY support_assignments_service_role ON public.support_assignments
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
