CREATE TABLE IF NOT EXISTS public.business_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  reason text NOT NULL,
  recommended_action text NOT NULL,
  basis jsonb NOT NULL DEFAULT '{}'::jsonb,
  estimated_impact jsonb,
  confidence numeric,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed', 'snoozed', 'expired')),
  snooze_until timestamptz,
  entity_type text,
  entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recommendation_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  recommendation_id uuid NOT NULL REFERENCES public.business_recommendations(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('acted', 'ignored', 'expired')),
  observed_effect jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_recommendations_pending_unique
  ON public.business_recommendations (tenant_id, type, entity_type, entity_id)
  WHERE status = 'pending' AND entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_recommendations_tenant_status
  ON public.business_recommendations (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recommendation_outcomes_recommendation
  ON public.recommendation_outcomes (recommendation_id, created_at DESC);

ALTER TABLE public.business_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendation_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_recommendations_service_role ON public.business_recommendations;
CREATE POLICY business_recommendations_service_role
  ON public.business_recommendations
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS recommendation_outcomes_service_role ON public.recommendation_outcomes;
CREATE POLICY recommendation_outcomes_service_role
  ON public.recommendation_outcomes
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
