-- Rollback for migration 149.
--
-- Restoring NOT NULL will FAIL if any WhatsApp-native schedule rows exist, which
-- is correct: those rows cannot satisfy it, and silently deleting a tenant's
-- working hours to make a rollback succeed would take every one of their staff
-- offline. Remove or backfill them deliberately first.
ALTER TABLE public.staff_schedules DROP CONSTRAINT IF EXISTS staff_schedules_has_an_owner;
ALTER TABLE public.staff_schedules ALTER COLUMN staff_id SET NOT NULL;
