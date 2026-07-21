CREATE TABLE IF NOT EXISTS public.analytics_query_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_id uuid NULL,
  question text NOT NULL,
  metric_key text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  latency_ms integer NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_query_log_tenant_created
  ON public.analytics_query_log (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.briefing_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  briefing_type text NOT NULL CHECK (briefing_type IN ('morning', 'weekly')),
  schedule_time time NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, briefing_type)
);

CREATE TABLE IF NOT EXISTS public.briefing_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  briefing_type text NOT NULL CHECK (briefing_type IN ('morning', 'weekly')),
  status text NOT NULL CHECK (status IN ('sent', 'skipped', 'failed')) DEFAULT 'sent',
  body text NOT NULL DEFAULT '',
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_briefing_runs_tenant_created
  ON public.briefing_runs (tenant_id, created_at DESC);

ALTER TABLE public.analytics_query_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.briefing_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.briefing_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS analytics_query_log_service_role ON public.analytics_query_log;
CREATE POLICY analytics_query_log_service_role ON public.analytics_query_log
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS briefing_schedules_service_role ON public.briefing_schedules;
CREATE POLICY briefing_schedules_service_role ON public.briefing_schedules
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS briefing_runs_service_role ON public.briefing_runs;
CREATE POLICY briefing_runs_service_role ON public.briefing_runs
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.analytics_query_log TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.briefing_schedules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.briefing_runs TO service_role;

