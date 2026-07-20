DROP POLICY IF EXISTS stock_count_items_service_role ON public.stock_count_items;
DROP POLICY IF EXISTS stock_count_sessions_service_role ON public.stock_count_sessions;
DROP POLICY IF EXISTS inventory_locations_service_role ON public.inventory_locations;

DROP TABLE IF EXISTS public.stock_count_items CASCADE;
DROP TABLE IF EXISTS public.stock_count_sessions CASCADE;

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
  p_unit_cost_cents integer DEFAULT NULL
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
    unit_cost_cents
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
    p_unit_cost_cents
  )
  RETURNING id INTO v_movement_id;

  movement_id := v_movement_id;
  previous_quantity := v_prev;
  new_quantity := v_new;
  RETURN NEXT;
END;
$function$;

ALTER TABLE public.inventory_movements
  DROP COLUMN IF EXISTS location_id;

DROP TABLE IF EXISTS public.inventory_locations CASCADE;
