-- 122_business_events.sql — append-only merchant activity timeline
CREATE TABLE IF NOT EXISTS public.business_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'staff', 'customer', 'ai', 'system')),
  actor_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  source text NOT NULL DEFAULT 'system' CHECK (source IN ('whatsapp', 'dashboard', 'api', 'system')),
  before jsonb,
  after jsonb,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_events_tenant_created
  ON public.business_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_events_entity
  ON public.business_events (tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_business_events_action
  ON public.business_events (tenant_id, action, created_at DESC);

ALTER TABLE public.business_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_events_service_role ON public.business_events;
CREATE POLICY business_events_service_role ON public.business_events
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
