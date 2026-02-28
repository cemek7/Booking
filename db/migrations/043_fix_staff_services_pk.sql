-- Migration 043: Fix staff_services primary key to include tenant_id
-- Forward migration to apply the PK change to existing installations
-- (The original 041 create statement was updated to PRIMARY KEY (tenant_id, staff_user_id, service_id),
--  but CREATE TABLE IF NOT EXISTS does not alter the constraint in databases where
--  the table already exists with the old PRIMARY KEY (staff_user_id, service_id).)

BEGIN;

-- Drop the old two-column primary key constraint and add the correct three-column one.
-- The constraint name defaults to 'staff_services_pkey' in PostgreSQL.
ALTER TABLE staff_services
  DROP CONSTRAINT IF EXISTS staff_services_pkey;

ALTER TABLE staff_services
  ADD PRIMARY KEY (tenant_id, staff_user_id, service_id);

COMMIT;
