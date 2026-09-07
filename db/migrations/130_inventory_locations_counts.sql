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

CREATE OR REPLACE FUNCTION public.update_inventory(
  p_tenant_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_quantity_change integer,
  p_movement_type text,
  p_reference_type text,
  p_reference_id text,
  p_reason text,
  p_performed_by uuid,
  p_unit_cost_cents integer DEFAULT NULL,
  p_location_id uuid DEFAULT NULL
)
RETURNS TABLE (movement_id uuid, previous_quantity integer, new_quantity integer)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_prev integer;
  v_new integer;
  v_movement_id uuid;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    SELECT COALESCE(stock_quantity, 0) INTO v_prev
    FROM product_variants
    WHERE id = p_variant_id
    FOR UPDATE;

    IF v_prev IS NULL THEN
      RAISE EXCEPTION 'Variant % not found', p_variant_id;
    END IF;

    v_new := GREATEST(0, v_prev + p_quantity_change);

    UPDATE product_variants
      SET stock_quantity = v_new,
          updated_at = now()
    WHERE id = p_variant_id;
  ELSE
    SELECT COALESCE(stock_quantity, 0) INTO v_prev
    FROM products
    WHERE id = p_product_id
      AND tenant_id = p_tenant_id
    FOR UPDATE;

    IF v_prev IS NULL THEN
      RAISE EXCEPTION 'Product % not found for tenant %', p_product_id, p_tenant_id;
    END IF;

    v_new := GREATEST(0, v_prev + p_quantity_change);

    UPDATE products
      SET stock_quantity = v_new,
          updated_at = now()
    WHERE id = p_product_id
      AND tenant_id = p_tenant_id;
  END IF;

  INSERT INTO inventory_movements (
    tenant_id,
    product_id,
    variant_id,
    movement_type,
    quantity,
    quantity_change,
    previous_quantity,
    new_quantity,
    reference_type,
    reference_id,
    reason,
    performed_by,
    created_by,
    unit_cost_cents,
    location_id
  ) VALUES (
    p_tenant_id,
    p_product_id,
    p_variant_id,
    p_movement_type,
    ABS(p_quantity_change),
    p_quantity_change,
    v_prev,
    v_new,
    p_reference_type,
    p_reference_id,
    p_reason,
    p_performed_by,
    p_performed_by,
    p_unit_cost_cents,
    p_location_id
  )
  RETURNING id INTO v_movement_id;

  movement_id := v_movement_id;
  previous_quantity := v_prev;
  new_quantity := v_new;
  RETURN NEXT;
END;
$function$;

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
