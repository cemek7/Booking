BEGIN;

CREATE TABLE IF NOT EXISTS public.business_anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rule_key text NOT NULL,
  domain text NOT NULL CHECK (domain IN ('service', 'retail', 'inventory')),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'dismissed', 'false_positive')),
  entity_type text,
  entity_id uuid,
  expected_value_cents bigint,
  actual_value_cents bigint,
  difference_cents bigint,
  detection_source text NOT NULL CHECK (detection_source IN ('reconciliation', 'realtime_event')),
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  dedup_key text NOT NULL,
  assigned_to uuid,
  assigned_at timestamptz,
  resolution_note text,
  resolved_by uuid,
  resolved_at timestamptz,
  run_id uuid REFERENCES public.reconciliation_runs(id) ON DELETE SET NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_anomalies_open
  ON public.business_anomalies (tenant_id, dedup_key)
  WHERE status IN ('open', 'investigating');

CREATE INDEX IF NOT EXISTS idx_business_anomalies_status
  ON public.business_anomalies (tenant_id, status, severity);

ALTER TABLE public.reconciliation_items
  ADD COLUMN IF NOT EXISTS anomaly_id uuid REFERENCES public.business_anomalies(id) ON DELETE SET NULL;

ALTER TABLE public.business_anomalies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_anomalies_service_role ON public.business_anomalies;
CREATE POLICY business_anomalies_service_role ON public.business_anomalies
  AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
