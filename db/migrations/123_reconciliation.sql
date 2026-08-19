-- 123_reconciliation.sql — daily close runs + review items
CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'computed', 'delivered', 'failed')),
  currency text NOT NULL DEFAULT 'NGN',
  expected_revenue_cents bigint NOT NULL DEFAULT 0,
  adjusted_expected_cents bigint NOT NULL DEFAULT 0,
  recorded_payments_cents bigint NOT NULL DEFAULT 0,
  approved_outstanding_cents bigint NOT NULL DEFAULT 0,
  revenue_gap_cents bigint NOT NULL DEFAULT 0,
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_runs_unique_day UNIQUE (tenant_id, business_date)
);

CREATE TABLE IF NOT EXISTS public.reconciliation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.reconciliation_runs(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('unpaid_completed_service', 'delivered_unpaid_order', 'discount_without_reason')),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  entity_type text,
  entity_id uuid,
  expected_cents bigint,
  actual_cents bigint,
  difference_cents bigint,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_items_run
  ON public.reconciliation_items (run_id);

ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reconciliation_runs_service_role ON public.reconciliation_runs;
CREATE POLICY reconciliation_runs_service_role ON public.reconciliation_runs
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS reconciliation_items_service_role ON public.reconciliation_items;
CREATE POLICY reconciliation_items_service_role ON public.reconciliation_items
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
