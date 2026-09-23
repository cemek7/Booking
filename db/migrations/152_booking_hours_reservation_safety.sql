-- 152_booking_hours_reservation_safety.sql
-- Canonicalize tenant schedules and make PostgreSQL the final authority against
-- concurrent active bookings for the same tenant/staff resource.

BEGIN;

-- Existing canonical owner settings are never overwritten. For tenants still
-- missing them, metadata -> 'business_hours' takes precedence over legacy_hours.
WITH legacy_hours AS (
  SELECT
    tenant_id,
    jsonb_object_agg(
      CASE day_of_week
        WHEN 0 THEN 'sun' WHEN 1 THEN 'mon' WHEN 2 THEN 'tue'
        WHEN 3 THEN 'wed' WHEN 4 THEN 'thu' WHEN 5 THEN 'fri'
        WHEN 6 THEN 'sat'
      END,
      CASE
        WHEN start_time IS NULL OR end_time IS NULL OR start_time >= end_time
          THEN jsonb_build_object('open', NULL, 'close', NULL, 'closed', true)
        ELSE jsonb_build_object(
          'open', to_char(start_time, 'HH24:MI'),
          'close', to_char(end_time, 'HH24:MI'),
          'closed', false
        )
      END
    ) FILTER (WHERE day_of_week BETWEEN 0 AND 6) AS schedule
  FROM public.business_hours
  GROUP BY tenant_id
), schedule_sources AS (
  SELECT
    t.id,
    COALESCE(t.settings, '{}'::jsonb) AS settings,
    CASE
      WHEN jsonb_typeof(t.metadata -> 'business_hours') = 'object'
        AND t.metadata -> 'business_hours' <> '{}'::jsonb
        THEN t.metadata -> 'business_hours'
      WHEN lh.schedule IS NOT NULL AND lh.schedule <> '{}'::jsonb
        THEN jsonb_build_object(
          'mon', jsonb_build_object('open', '09:00', 'close', '17:00', 'closed', false),
          'tue', jsonb_build_object('open', '09:00', 'close', '17:00', 'closed', false),
          'wed', jsonb_build_object('open', '09:00', 'close', '17:00', 'closed', false),
          'thu', jsonb_build_object('open', '09:00', 'close', '17:00', 'closed', false),
          'fri', jsonb_build_object('open', '09:00', 'close', '17:00', 'closed', false),
          'sat', jsonb_build_object('open', NULL, 'close', NULL, 'closed', true),
          'sun', jsonb_build_object('open', NULL, 'close', NULL, 'closed', true)
        ) || lh.schedule
      ELSE jsonb_build_object(
        'mon', jsonb_build_object('open', '09:00', 'close', '17:00', 'closed', false),
        'tue', jsonb_build_object('open', '09:00', 'close', '17:00', 'closed', false),
        'wed', jsonb_build_object('open', '09:00', 'close', '17:00', 'closed', false),
        'thu', jsonb_build_object('open', '09:00', 'close', '17:00', 'closed', false),
        'fri', jsonb_build_object('open', '09:00', 'close', '17:00', 'closed', false),
        'sat', jsonb_build_object('open', NULL, 'close', NULL, 'closed', true),
        'sun', jsonb_build_object('open', NULL, 'close', NULL, 'closed', true)
      )
    END AS business_hours
  FROM public.tenants t
  LEFT JOIN legacy_hours lh ON lh.tenant_id = t.id
  WHERE NOT (COALESCE(t.settings, '{}'::jsonb) ? 'business_hours')
)
UPDATE public.tenants t
SET settings = s.settings || jsonb_build_object('business_hours', s.business_hours)
FROM schedule_sources s
WHERE t.id = s.id;

-- The exclusion constraint cannot be added NOT VALID. Abort without changing or
-- deleting any reservation if historical active rows already overlap.
DO $overlap_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.reservations a
    JOIN public.reservations b
      ON a.tenant_id = b.tenant_id
     AND COALESCE(a.staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(b.staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND a.id < b.id
     AND tstzrange(a.start_at, a.end_at, '[)') && tstzrange(b.start_at, b.end_at, '[)')
    WHERE a.status IN ('pending', 'confirmed')
      AND b.status IN ('pending', 'confirmed')
      AND a.tenant_id IS NOT NULL
      AND a.start_at IS NOT NULL AND a.end_at IS NOT NULL AND a.start_at < a.end_at
      AND b.start_at IS NOT NULL AND b.end_at IS NOT NULL AND b.start_at < b.end_at
  ) THEN
    RAISE EXCEPTION 'Active reservation overlap detected; resolve conflicts before applying migration 152';
  END IF;
END
$overlap_preflight$;

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $constraint_install$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.reservations'::regclass
      AND conname = 'reservations_no_active_overlap'
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_no_active_overlap
      EXCLUDE USING gist (
        tenant_id WITH =,
        (COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
        tstzrange(start_at, end_at, '[)') WITH &&
      )
      WHERE (
        status IN ('pending', 'confirmed')
        AND tenant_id IS NOT NULL
        AND start_at IS NOT NULL
        AND end_at IS NOT NULL
        AND start_at < end_at
      );
  END IF;
END
$constraint_install$;

COMMIT;
