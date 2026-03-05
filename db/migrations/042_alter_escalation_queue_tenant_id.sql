-- Migration 042: Alter escalation_queue.tenant_id from UUID to TEXT
-- Forward migration to apply the type change to existing installations
-- (The original 039 create statement was updated, but CREATE TABLE IF NOT EXISTS
--  does not alter the column in databases where the table already exists.)

BEGIN;

ALTER TABLE escalation_queue
  ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;

COMMIT;
