-- Migration 043: Fix staff_services primary key to include tenant_id
-- Forward migration to apply the PK change to existing installations
-- (The original 041 create statement was updated to PRIMARY KEY (tenant_id, staff_user_id, service_id),
--  but CREATE TABLE IF NOT EXISTS does not alter the constraint in databases where
--  the table already exists with the old PRIMARY KEY (staff_user_id, service_id).)

BEGIN;

-- Drop the old primary key constraint (any name) and replace with the correct three-column one.
DO $$
DECLARE
  existing_pk TEXT;
BEGIN
  -- Find the current PK constraint name (if any)
  SELECT conname INTO existing_pk
  FROM pg_constraint
  WHERE conrelid = 'staff_services'::regclass AND contype = 'p';

  IF existing_pk IS NOT NULL THEN
    EXECUTE format('ALTER TABLE staff_services DROP CONSTRAINT %I', existing_pk);
  END IF;

  -- Add the correct three-column primary key
  ALTER TABLE staff_services ADD PRIMARY KEY (tenant_id, staff_user_id, service_id);
END $$;

COMMIT;
