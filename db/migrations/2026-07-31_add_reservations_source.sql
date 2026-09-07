-- Migration: add reservations.source (text)
-- Date: 2026-07-31
--
-- WHY: the public booking path (createPublicBooking) records where a booking
-- came from with `.insert({ ..., source: 'public_booking' })`, but `reservations`
-- has no `source` column on live — the insert errored, so public-page bookings
-- silently failed. Rather than route the origin through metadata only, add the
-- column (useful for booking-origin analytics, parallel to customers.source).
--
-- SAFETY: idempotent (ADD COLUMN IF NOT EXISTS), non-destructive, no RLS change.
-- Backfills existing rows from metadata.booking_source when present. Reviewer
-- runs this; validated in a throwaway postgres:16-alpine container.

BEGIN;

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS source text;

-- Backfill origin for rows that captured it in metadata while the column was
-- absent. Only where source is still NULL, so re-runs never overwrite.
UPDATE public.reservations
SET source = metadata->>'booking_source'
WHERE source IS NULL
  AND metadata ? 'booking_source'
  AND jsonb_typeof(metadata->'booking_source') = 'string';

COMMIT;

-- Rollback (manual, NOT run automatically):
--   ALTER TABLE public.reservations DROP COLUMN IF EXISTS source;
