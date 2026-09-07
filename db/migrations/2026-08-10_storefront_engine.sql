-- Public Storefront Engine: queryable campaigns + privacy-minimised funnel events.
CREATE TABLE IF NOT EXISTS public.storefront_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','active','paused','expired','superseded')),
  title text NOT NULL, copy text, cta_label text, target_type text, target_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  start_at timestamptz NOT NULL DEFAULT now(), end_at timestamptz, source text NOT NULL DEFAULT 'owner', approval_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK (end_at IS NULL OR end_at > start_at)
);
CREATE INDEX IF NOT EXISTS idx_storefront_campaigns_active ON public.storefront_campaigns (tenant_id, status, start_at DESC);
CREATE TABLE IF NOT EXISTS public.storefront_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('storefront_view','service_view','product_view','cta_click','ask_booka_opened','booking_started','booking_completed','product_added','checkout_started','purchase_completed','campaign_view','campaign_conversion')),
  page_type text NOT NULL CHECK (page_type IN ('storefront','service','product','campaign')), session_id uuid, service_id uuid REFERENCES public.services(id) ON DELETE SET NULL, product_id uuid REFERENCES public.products(id) ON DELETE SET NULL, campaign_id uuid REFERENCES public.storefront_campaigns(id) ON DELETE SET NULL,
  referrer text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_storefront_events_funnel ON public.storefront_events (tenant_id, event_type, created_at DESC);
ALTER TABLE public.storefront_campaigns ENABLE ROW LEVEL SECURITY; ALTER TABLE public.storefront_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS storefront_campaigns_tenant_access ON public.storefront_campaigns; CREATE POLICY storefront_campaigns_tenant_access ON public.storefront_campaigns FOR ALL USING (tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS storefront_events_tenant_access ON public.storefront_events; CREATE POLICY storefront_events_tenant_access ON public.storefront_events FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()));
