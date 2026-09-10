-- Migration 149: let WhatsApp-native staff have working hours
--
-- staff_schedules.staff_id REFERENCES auth.users(id) and is NOT NULL. Migration
-- 066 added tenant_user_id so v2 could schedule staff who have no auth account,
-- but never relaxed the older column — so for a WhatsApp-native tenant the
-- constraint is unsatisfiable: those tenant_users rows are created with
-- user_id NULL by design (ownerOnboarding.ts), and there is no auth.users id to
-- put in staff_id.
--
-- The effect was total and silent. Every v2 onboarding tried to write working
-- hours, Postgres rejected the insert, the code did not check the error, and
-- the slot engine then returned no availability for anyone —
-- `if (!scheduleRows || scheduleRows.length === 0) return []`. A tenant could
-- complete onboarding and be structurally unable to take a single booking.
--
-- Dropping NOT NULL, not the column or the FK: dashboard-created staff still
-- have an auth user and still populate staff_id, and the reference still
-- guarantees the value points at a real account when present.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'staff_schedules'
      AND column_name = 'staff_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.staff_schedules ALTER COLUMN staff_id DROP NOT NULL;
  END IF;
END $$;

-- A schedule row is useless without SOMEONE to attach it to, and now that both
-- identity columns are nullable nothing else enforces that. v1 rows carry
-- staff_id, v2 rows carry tenant_user_id; a row with neither is orphaned.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_schedules_has_an_owner'
      AND conrelid = 'public.staff_schedules'::regclass
  ) THEN
    ALTER TABLE public.staff_schedules
      ADD CONSTRAINT staff_schedules_has_an_owner
      CHECK (staff_id IS NOT NULL OR tenant_user_id IS NOT NULL) NOT VALID;
  END IF;
END $$;

-- NOT VALID above so the migration cannot fail on pre-existing rows; validate
-- separately so a legacy orphan surfaces as a clear error here rather than as
-- an insert failure later.
DO $$
BEGIN
  ALTER TABLE public.staff_schedules VALIDATE CONSTRAINT staff_schedules_has_an_owner;
EXCEPTION WHEN check_violation THEN
  RAISE WARNING 'staff_schedules has rows with neither staff_id nor tenant_user_id; constraint left unvalidated';
END $$;
