-- Migration 079: Tenant finance ledgers
-- Separates recognized revenue from actual provider cost so Booka can report
-- realized and withdrawable profit without mixing it with wallet balances.

CREATE TABLE IF NOT EXISTS public.tenant_revenue_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  revenue_type TEXT NOT NULL CHECK (revenue_type IN ('wallet_topup', 'usage_charge', 'subscription_charge', 'overage_charge', 'refund', 'manual_adjustment', 'bonus_credit')),
  amount_credits NUMERIC(20,6) NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  reference TEXT,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tenant_cost_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cost_type TEXT NOT NULL CHECK (cost_type IN ('llm', 'whatsapp', 'server', 'payment', 'manual_adjustment')),
  actual_cost_credits NUMERIC(20,6) NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  reference TEXT,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_revenue_ledger_tenant_created_at
  ON public.tenant_revenue_ledger (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_cost_ledger_tenant_created_at
  ON public.tenant_cost_ledger (tenant_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_revenue_ledger_unique_ref
  ON public.tenant_revenue_ledger (tenant_id, revenue_type, reference)
  WHERE reference IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_cost_ledger_unique_ref
  ON public.tenant_cost_ledger (tenant_id, cost_type, reference)
  WHERE reference IS NOT NULL;

ALTER TABLE public.tenant_revenue_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_cost_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_revenue_ledger_service_role ON public.tenant_revenue_ledger;
CREATE POLICY tenant_revenue_ledger_service_role ON public.tenant_revenue_ledger
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS tenant_cost_ledger_service_role ON public.tenant_cost_ledger;
CREATE POLICY tenant_cost_ledger_service_role ON public.tenant_cost_ledger
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
