-- Migration 058: Add missing columns to the `jobs` table
--
-- The original jobs table (supabase/sam/009_create_jobs_table.sql) was created
-- with a minimal schema. EnhancedJobManager.scheduleJob() inserts additional
-- fields and processJobs() queries by `priority` — this migration backfills all
-- missing columns so both paths work without errors.

ALTER TABLE public.jobs
  -- Human-readable job name (same value as `type` when set via scheduleJob)
  ADD COLUMN IF NOT EXISTS name             TEXT,

  -- Handler key — currently same as `type`; kept for future handler aliasing
  ADD COLUMN IF NOT EXISTS handler          TEXT,

  -- Which tenant owns this job (NULL for system-level jobs)
  ADD COLUMN IF NOT EXISTS tenant_id        UUID REFERENCES tenants(id) ON DELETE CASCADE,

  -- Higher number = higher priority. Default 5 (normal).
  ADD COLUMN IF NOT EXISTS priority         INTEGER NOT NULL DEFAULT 5,

  -- Retry configuration (populated by scheduleJob; ignored by plain enqueueJob)
  ADD COLUMN IF NOT EXISTS max_retries      INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS retry_delay_ms   INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS retry_backoff_multiplier NUMERIC(4,2) NOT NULL DEFAULT 2.0,
  ADD COLUMN IF NOT EXISTS retry_count      INTEGER NOT NULL DEFAULT 0,

  -- Per-job execution timeout in milliseconds
  ADD COLUMN IF NOT EXISTS timeout_ms       INTEGER NOT NULL DEFAULT 30000;

-- Index for the hot query in processJobs() — pending jobs ordered by priority then scheduled_at
CREATE INDEX IF NOT EXISTS idx_jobs_priority_scheduled
  ON public.jobs (status, priority DESC, scheduled_at ASC)
  WHERE status IN ('pending', 'failed');

-- RLS
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jobs_service_role ON public.jobs;
CREATE POLICY jobs_service_role ON public.jobs
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Owner/manager can read their own tenant's jobs
DROP POLICY IF EXISTS jobs_tenant_select ON public.jobs;
CREATE POLICY jobs_tenant_select ON public.jobs
  FOR SELECT USING (
    tenant_id IS NULL OR
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );
