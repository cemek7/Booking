-- 083_tenant_offboarding.sql
-- SAFE: ADD COLUMN + CREATE TABLE only. No drops/retypes.
-- Pre-flight: `tenants` exists; existing tenants.status (active/suspended/inactive)
-- is a SEPARATE axis and is left untouched — lifecycle is the off-boarding axis.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS lifecycle_state     TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS offboarding_reason  TEXT,
  ADD COLUMN IF NOT EXISTS offboarded_by       UUID,
  ADD COLUMN IF NOT EXISTS offboarded_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_purge_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS financials_purge_at TIMESTAMPTZ;

-- Defensive: constrain lifecycle_state to the known set (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_lifecycle_state_chk'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_lifecycle_state_chk
      CHECK (lifecycle_state IN ('active','scheduled_for_deletion','purging','purged'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_tenants_lifecycle_state ON tenants (lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_tenants_scheduled_purge_at ON tenants (scheduled_purge_at)
  WHERE lifecycle_state = 'scheduled_for_deletion';
CREATE INDEX IF NOT EXISTS idx_tenants_financials_purge_at ON tenants (financials_purge_at)
  WHERE lifecycle_state = 'purged';

CREATE TABLE IF NOT EXISTS offboarding_tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  task_type    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','in_progress','done','failed','skipped')),
  attempts     INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  last_error   TEXT,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- NOTE: tenant_id is intentionally NOT a cascading FK — these rows must outlive
-- the Phase-1 operational purge so teardown still works. Phase 2 deletes them.
CREATE INDEX IF NOT EXISTS idx_offboarding_tasks_tenant ON offboarding_tasks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_offboarding_tasks_status ON offboarding_tasks (status);
