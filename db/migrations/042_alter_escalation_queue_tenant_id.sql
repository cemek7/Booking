-- Migration 042: Alter escalation_queue.tenant_id from UUID to TEXT
-- Forward migration to apply the type change to existing installations
-- (The original 039 create statement was updated, but CREATE TABLE IF NOT EXISTS
--  does not alter the column in databases where the table already exists.)

-- Migration 042: superseded.
-- Originally altered escalation_queue.tenant_id from UUID to TEXT,
-- but that was incorrect (tenants.id is UUID and requires a UUID FK).
-- Migration 039 was corrected to use UUID directly; this migration is now a no-op.
SELECT 'Migration 042: no-op (superseded by fix in 039)' AS status;
