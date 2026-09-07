ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS base_uom text
    CHECK (base_uom IS NULL OR base_uom IN ('piece', 'pack', 'ml', 'l', 'g', 'kg')),
  ADD COLUMN IF NOT EXISTS pack_size numeric
    CHECK (pack_size IS NULL OR pack_size > 0);

CREATE TABLE IF NOT EXISTS public.service_material_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_material_recipes_unique_service UNIQUE (tenant_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_service_material_recipes_tenant_service
  ON public.service_material_recipes (tenant_id, service_id);

CREATE TABLE IF NOT EXISTS public.service_material_recipe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  recipe_id uuid NOT NULL REFERENCES public.service_material_recipes(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  default_quantity numeric NOT NULL CHECK (default_quantity > 0),
  uom text NOT NULL CHECK (uom IN ('piece', 'pack', 'ml', 'l', 'g', 'kg')),
  is_optional boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_material_recipe_items_recipe
  ON public.service_material_recipe_items (recipe_id);

CREATE INDEX IF NOT EXISTS idx_service_material_recipe_items_product
  ON public.service_material_recipe_items (tenant_id, product_id);

CREATE TABLE IF NOT EXISTS public.service_consumption_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  planned_quantity numeric NOT NULL CHECK (planned_quantity > 0),
  actual_quantity numeric,
  uom text NOT NULL CHECK (uom IN ('piece', 'pack', 'ml', 'l', 'g', 'kg')),
  staff_id uuid REFERENCES public.tenant_users(id) ON DELETE SET NULL,
  movement_id uuid REFERENCES public.inventory_movements(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_consumption_records_reservation
  ON public.service_consumption_records (tenant_id, reservation_id);

CREATE INDEX IF NOT EXISTS idx_service_consumption_records_service
  ON public.service_consumption_records (tenant_id, service_id, created_at DESC);

ALTER TABLE public.service_material_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_material_recipe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_consumption_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_material_recipes_service_role ON public.service_material_recipes;
CREATE POLICY service_material_recipes_service_role
  ON public.service_material_recipes
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS service_material_recipe_items_service_role ON public.service_material_recipe_items;
CREATE POLICY service_material_recipe_items_service_role
  ON public.service_material_recipe_items
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS service_consumption_records_service_role ON public.service_consumption_records;
CREATE POLICY service_consumption_records_service_role
  ON public.service_consumption_records
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
