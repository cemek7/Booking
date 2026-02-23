-- Migration 037: Customer Feedback Table
-- Stores post-service ratings submitted by customers, linked to the
-- reservation, the staff member who served them, and the tenant.

BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_feedback (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reservation_id TEXT       REFERENCES public.reservations(id) ON DELETE SET NULL,
  -- Logical FK to tenant_users.user_id (TEXT PK pattern); no explicit constraint
  -- because tenant_users.user_id is not declared UNIQUE/PRIMARY KEY in the base schema.
  staff_user_id TEXT        NOT NULL,
  customer_name TEXT,                   -- denormalised for display without joining reservations
  score         SMALLINT    NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Efficient lookup: ratings per staff member within a tenant window
CREATE INDEX IF NOT EXISTS idx_feedback_tenant_staff
  ON public.customer_feedback (tenant_id, staff_user_id, created_at DESC);

-- Efficient lookup: one rating per reservation
CREATE INDEX IF NOT EXISTS idx_feedback_reservation
  ON public.customer_feedback (reservation_id)
  WHERE reservation_id IS NOT NULL;

-- Prevent duplicate feedback for the same reservation
CREATE UNIQUE INDEX IF NOT EXISTS uniq_feedback_reservation
  ON public.customer_feedback (reservation_id)
  WHERE reservation_id IS NOT NULL;

-- Row-Level Security: tenants only see their own feedback
ALTER TABLE public.customer_feedback ENABLE ROW LEVEL SECURITY;

-- Staff/managers/owners of the same tenant can SELECT
CREATE POLICY feedback_tenant_select
  ON public.customer_feedback
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()::text
    )
  );

-- Any authenticated user in the same tenant can INSERT (customer submits via booking link)
CREATE POLICY feedback_tenant_insert
  ON public.customer_feedback
  FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()::text
    )
  );

COMMIT;
