-- 014_add_jobs_metadata.sql
-- Add observability columns for jobs: last_run_at and run_count

ALTER TABLE IF EXISTS public.jobs
  ADD COLUMN IF NOT EXISTS last_run_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS run_count integer NOT NULL DEFAULT 0;

-- Create an index on run_count for quick queries if needed
CREATE INDEX IF NOT EXISTS idx_jobs_run_count ON public.jobs (run_count);
