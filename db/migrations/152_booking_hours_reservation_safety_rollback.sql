-- 152_booking_hours_reservation_safety_rollback.sql
-- Backfilled schedules are retained because they may have been edited by owners
-- after rollout. The shared btree_gist extension may be used by other objects.

BEGIN;

ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_no_active_overlap;

COMMIT;
