-- Migration 037: Customer Feedback Table
-- Stores post-service ratings submitted by customers, linked to the
-- reservation, the staff member who served them, and the tenant.

BEGIN;

CREATE TABLE IF NOT EXISTS customer_feedback (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reservation_id TEXT       REFERENCES reservations(id) ON DELETE SET NULL,
  -- Logical FK to tenant_users.user_id (TEXT PK pattern); no explicit constraint
  -- because tenant_users.user_id is not declared UNIQUE/PRIMARY KEY in the base schema.
  staff_user_id TEXT        NOT NULL,
  customer_name TEXT,
  score         SMALLINT    NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_tenant_staff
  ON customer_feedback (tenant_id, staff_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_reservation
  ON customer_feedback (reservation_id)
  WHERE reservation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_feedback_reservation
  ON customer_feedback (reservation_id)
  WHERE reservation_id IS NOT NULL;

ALTER TABLE customer_feedback ENABLE ROW LEVEL SECURITY;

-- Tenant members (owner/manager) can read all feedback for their tenant
CREATE POLICY policy_feedback_tenant_select ON customer_feedback
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid()::text
    )
  );

-- Feedback can be inserted for the caller's tenant
CREATE POLICY policy_feedback_tenant_insert ON customer_feedback
  FOR INSERT WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid()::text
    )
  );

-- Staff members can update/delete only their own feedback rows
CREATE POLICY policy_feedback_staff_modify ON customer_feedback
  FOR ALL USING (
    staff_user_id = auth.uid()::text
    AND tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid()::text
    )
  );

COMMIT;
