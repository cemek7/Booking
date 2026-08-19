-- Migration 043b: Add staff_id and service_id to reservations table
-- Properly links reservations to the staff member assigned and the service booked.
-- Runs before 044 so the performance indexes on these columns succeed.

BEGIN;

-- staff_id references auth.users since staff are tenant_users with role='staff'
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS staff_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id)   ON DELETE SET NULL;

-- Index for fast staff schedule lookups
CREATE INDEX IF NOT EXISTS idx_reservations_staff_id
  ON reservations (staff_id)
  WHERE staff_id IS NOT NULL;

-- Index for fast service-level reporting
CREATE INDEX IF NOT EXISTS idx_reservations_service_id
  ON reservations (service_id)
  WHERE service_id IS NOT NULL;

COMMIT;
