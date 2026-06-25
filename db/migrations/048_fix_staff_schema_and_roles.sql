-- Migration 048: Fix staff schema and expand tenant_users roles
-- 1. Add 'manager' to tenant_users role constraint
-- 2. Rename staff_schedules.user_id -> staff_id (staff_id = auth.users id of a tenant_users row with role='staff')
-- 3. Ensure availability_slots has staff_id and tenant_id columns
-- 4. Update generate_availability_slots function to match corrected schema

-- ─────────────────────────────────────────────────────────────
-- 1. tenant_users: add 'manager' to role CHECK constraint
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  SELECT conname INTO v_constraint
  FROM pg_constraint
  WHERE conrelid = 'tenant_users'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%role%';

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE tenant_users DROP CONSTRAINT %I', v_constraint);
  END IF;

  ALTER TABLE tenant_users
    ADD CONSTRAINT tenant_users_role_check
    CHECK (role = ANY (ARRAY['owner', 'staff', 'manager']));
END $$;

-- ─────────────────────────────────────────────────────────────
-- 2. staff_schedules: rename user_id -> staff_id if needed
--    and ensure tenant_id exists
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Rename user_id to staff_id if user_id exists and staff_id does not
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff_schedules' AND column_name = 'user_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff_schedules' AND column_name = 'staff_id'
  ) THEN
    ALTER TABLE staff_schedules RENAME COLUMN user_id TO staff_id;
  END IF;
END $$;

ALTER TABLE staff_schedules
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS staff_id  UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- ─────────────────────────────────────────────────────────────
-- 3. availability_slots: ensure staff_id and tenant_id exist
-- ─────────────────────────────────────────────────────────────
ALTER TABLE availability_slots
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS staff_id  UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- 4. Update generate_availability_slots to use staff_id + tenant_id
-- ─────────────────────────────────────────────────────────────

-- Drop all existing signatures before recreating
DROP FUNCTION IF EXISTS generate_availability_slots(UUID, DATE, DATE, INTEGER);
DROP FUNCTION IF EXISTS generate_availability_slots(UUID, UUID, DATE, DATE, INTEGER);

CREATE OR REPLACE FUNCTION generate_availability_slots(
  p_staff_id UUID,
  p_tenant_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_slot_duration_minutes INTEGER DEFAULT 60
) RETURNS INTEGER AS $$
DECLARE
  slot_count   INTEGER := 0;
  loop_date    DATE;
  schedule_rec RECORD;
  slot_start   TIMESTAMP WITH TIME ZONE;
  slot_end     TIMESTAMP WITH TIME ZONE;
  day_end      TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Clear existing slots for this staff member and date range
  DELETE FROM availability_slots
  WHERE staff_id = p_staff_id
    AND tenant_id = p_tenant_id
    AND start_time::date BETWEEN p_start_date AND p_end_date;

  loop_date := p_start_date;
  WHILE loop_date <= p_end_date LOOP
    SELECT * INTO schedule_rec
    FROM staff_schedules
    WHERE staff_id  = p_staff_id
      AND tenant_id = p_tenant_id
      AND day_of_week = EXTRACT(DOW FROM loop_date)
      AND is_active = true;

    IF FOUND THEN
      slot_start := loop_date + schedule_rec.start_time;
      day_end    := loop_date + schedule_rec.end_time;

      WHILE slot_start + (p_slot_duration_minutes || ' minutes')::interval <= day_end LOOP
        slot_end := slot_start + (p_slot_duration_minutes || ' minutes')::interval;

        INSERT INTO availability_slots (
          staff_id, tenant_id, start_time, end_time,
          slot_type, is_available, confidence_score
        ) VALUES (
          p_staff_id, p_tenant_id, slot_start, slot_end,
          'regular', true, 1.0000
        );

        slot_count := slot_count + 1;
        slot_start := slot_end;
      END LOOP;
    END IF;

    loop_date := loop_date + 1;
  END LOOP;

  RETURN slot_count;
END;
$$ LANGUAGE plpgsql;

-- Update trigger function to pass tenant_id
CREATE OR REPLACE FUNCTION update_availability_on_schedule_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    PERFORM generate_availability_slots(
      NEW.staff_id,
      NEW.tenant_id,
      CURRENT_DATE,
      CURRENT_DATE + INTERVAL '30 days',
      60
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
