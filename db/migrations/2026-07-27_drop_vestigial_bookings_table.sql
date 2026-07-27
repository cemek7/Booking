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

  -- Empty and unused — safe to remove.
  EXECUTE 'DROP TABLE public.bookings';
  RAISE NOTICE 'Dropped empty public.bookings table.';
END $$;
