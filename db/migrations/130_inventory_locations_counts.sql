CREATE TABLE IF NOT EXISTS public.inventory_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.inventory_locations(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.stock_count_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.inventory_locations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','counting','review','approved','cancelled')),
  started_by uuid,
  snapshot_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  shrinkage_value_cents bigint NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_session
  ON public.stock_count_sessions (tenant_id, location_id)
  WHERE status IN ('draft', 'counting', 'review');

CREATE TABLE IF NOT EXISTS public.stock_count_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.stock_count_sessions(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  location_id uuid REFERENCES public.inventory_locations(id) ON DELETE SET NULL,
  expected_quantity integer NOT NULL,
  counted_quantity integer,
  variance integer,
  unit_cost_cents integer,
  variance_value_cents bigint,
  flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_locations_service_role ON public.inventory_locations;
CREATE POLICY inventory_locations_service_role
  ON public.inventory_locations
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS stock_count_sessions_service_role ON public.stock_count_sessions;
CREATE POLICY stock_count_sessions_service_role
  ON public.stock_count_sessions
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS stock_count_items_service_role ON public.stock_count_items;
CREATE POLICY stock_count_items_service_role
  ON public.stock_count_items
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

INSERT INTO public.inventory_locations (tenant_id, name, is_default)
SELECT t.id, 'Main', true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1
  FROM public.inventory_locations l
  WHERE l.tenant_id = t.id
    AND l.is_default = true
);
