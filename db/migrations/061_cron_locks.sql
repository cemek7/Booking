-- Migration 061: cron_locks table for distributed cron deduplication
-- Prevents multiple simultaneous invocations of the /api/jobs/process endpoint
-- from double-processing the same job batch.

CREATE TABLE IF NOT EXISTS cron_locks (
  key          text        PRIMARY KEY,
  locked_until timestamptz NOT NULL
);

-- Automatically remove expired locks so the table stays small.
-- A row with locked_until in the past is no longer effective but takes up space.
CREATE INDEX IF NOT EXISTS idx_cron_locks_locked_until ON cron_locks (locked_until);
