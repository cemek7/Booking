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

COMMIT;
