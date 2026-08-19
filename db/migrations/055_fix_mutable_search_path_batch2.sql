-- Migration 055: Fix mutable search_path — batch 2
--
-- Pins search_path = public on functions flagged by Supabase security adviser.
-- Uses ALTER FUNCTION to avoid recreating bodies.

-- ─── Trigger functions (no parameters) ──────────────────────────────────────

ALTER FUNCTION public.update_availability_on_schedule_change()
  SET search_path = public;

ALTER FUNCTION public.update_availability_on_reservation_change()
  SET search_path = public;

ALTER FUNCTION public.ts_update_updated_at()
  SET search_path = public;

ALTER FUNCTION public.trigger_set_timestamp()
  SET search_path = public;

ALTER FUNCTION public.jobs_set_timestamp()
  SET search_path = public;

-- ─── Function with parameters ────────────────────────────────────────────────

-- Signature from migration 048: (staff_id, tenant_id, start_date, end_date, slot_duration_minutes)
ALTER FUNCTION public.generate_availability_slots(
  uuid,
  uuid,
  date,
  date,
  integer
) SET search_path = public;
