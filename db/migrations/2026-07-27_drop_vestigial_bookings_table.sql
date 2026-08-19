-- ============================================================================
-- 2026-07-27  Retire the vestigial `public.bookings` table
--
-- Context: `reservations` is the canonical appointments table (49 code refs,
-- every core flow). `public.bookings` is a separate minimal "events with
-- capacity" table (title/description/capacity) that:
--   * nothing writes to (zero inserts/updates/deletes in the codebase),
--   * had only 3 readers, all AI lib code that queried columns it doesn't
--     have (total_amount/created_at/service_id/scheduled_at) — now repointed
--     to reservations/transactions in code,
--   * was rendered only by a dead BookingsList component (now removed).
--
-- FK dependents: booking_notifications.booking_id and
-- scheduled_notifications.booking_id have FKs to bookings. Those two tables are
-- LIVE (bookingNotifications.ts writes them), but their FK to the vestigial
-- bookings table is itself wrong — the id they carry correlates to
-- reservations, not bookings. So we DROP THE FK CONSTRAINTS (leaving booking_id
-- as a plain uuid the app still uses) and then drop bookings. We do NOT drop or
-- cascade those tables.
--
-- SAFETY: this script REFUSES to drop the table if it contains any rows, so
-- you can run it without fear of losing data. If it errors with "bookings is
-- not empty", stop and tell me — we'll investigate the rows first.
--
-- Review it, then run it in the Supabase SQL editor (or psql). Re-runnable.
-- ============================================================================

DO $$
DECLARE
  row_count bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'bookings'
  ) THEN
    RAISE NOTICE 'public.bookings does not exist — nothing to drop.';
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM public.bookings' INTO row_count;

  IF row_count > 0 THEN
    RAISE EXCEPTION 'Refusing to drop public.bookings: it has % row(s). Investigate before dropping.', row_count;
  END IF;

  -- Remove the FK constraints that (incorrectly) tied live notification tables
  -- to the vestigial bookings table. booking_id stays as a plain uuid column.
  ALTER TABLE IF EXISTS public.booking_notifications
    DROP CONSTRAINT IF EXISTS booking_notifications_booking_id_fkey;
  ALTER TABLE IF EXISTS public.scheduled_notifications
    DROP CONSTRAINT IF EXISTS scheduled_notifications_booking_id_fkey;

  -- Empty and unused — safe to remove.
  EXECUTE 'DROP TABLE public.bookings';
  RAISE NOTICE 'Dropped empty public.bookings table (and its two dependent FK constraints).';
END $$;
