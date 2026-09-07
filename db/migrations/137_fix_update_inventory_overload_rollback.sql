BEGIN;

-- Reverses migration 137 by restoring the 10-argument public.update_inventory
-- overload that 137 dropped. The restored version delegates to the canonical
-- 11-argument version (migration 130) with p_location_id = NULL so no logic is
-- duplicated.
--
-- WARNING: applying this rollback RE-INTRODUCES the ambiguous-overload bug — a
-- 10-argument call will once again match both this and the 11-argument function
-- ("function public.update_inventory(...) is not unique"), breaking retail sales
-- and refunds. Only use it to return to the exact pre-137 schema state.

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
LANGUAGE sql
AS $$
  SELECT *
  FROM public.update_inventory(
    p_tenant_id,
    p_product_id,
    p_variant_id,
    p_quantity_change,
    p_movement_type,
    p_reference_type,
    p_reference_id,
    p_reason,
    p_performed_by,
    p_unit_cost_cents,
    NULL
  );
$$;

COMMIT;
