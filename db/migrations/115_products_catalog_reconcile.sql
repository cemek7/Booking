-- 115_products_catalog_reconcile.sql
--
-- Reconciles the products catalogue created in 114 with what the application code
-- actually reads/writes (verified against src/lib/booking/action-validator.ts,
-- src/lib/ai/grounding-service.ts, src/app/api/products/**, src/app/api/inventory/**,
-- src/lib/services/inventory-service.ts). Without these, the AI catalog/upsell read
-- errors out (silently empty), product creation with stock tracking fails, and the
-- /api/inventory route's update_inventory RPC does not exist.
--
-- Manual fallback: every statement is idempotent and safe to run by hand.

BEGIN;

-- 1. products.category (flat text label)
--    action-validator.loadActiveProducts selects a scalar `category` (same pattern as
--    services.category). 114 created products with category_id; this adds the flat label.
--    NOTE: migration 116 (Stage G) later finalizes the FLAT model -- it backfills this
--    column and DROPS category_id + the product_categories table. So category is the
--    single source of truth; category_id no longer exists after 116.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category TEXT;

-- 2. inventory_movements: columns the products POST + update_inventory RPC write,
--    and the movement-type values the code actually uses.
ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS variant_id        UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reference_type    TEXT,
  ADD COLUMN IF NOT EXISTS previous_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS new_quantity      INTEGER,
  ADD COLUMN IF NOT EXISTS performed_by      UUID;

-- The code uses movement_type values 'sale','return','adjustment','initial','restock',
-- 'damage','theft' -- wider than 114's CHECK. Drop the constraint (leave as free TEXT,
-- consistent with other status-like columns in this schema).
ALTER TABLE inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;

CREATE INDEX IF NOT EXISTS idx_inventory_movements_performed_by
  ON inventory_movements (performed_by) WHERE performed_by IS NOT NULL;

-- 3. update_inventory(...) -- atomic stock adjustment + movement log.
--    Called by /api/inventory and InventoryService with these exact named params.
--    Adjusts product OR variant stock, records previous/new, inserts the movement row,
--    and returns the new quantity. Negative results are clamped to 0.
CREATE OR REPLACE FUNCTION update_inventory(
  p_tenant_id      UUID,
  p_product_id     UUID,
  p_variant_id     UUID,
  p_quantity_change INTEGER,
  p_movement_type  TEXT,
  p_reference_type TEXT,
  p_reference_id   TEXT,
  p_reason         TEXT,
  p_performed_by   UUID
)
RETURNS TABLE (movement_id UUID, previous_quantity INTEGER, new_quantity INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev INTEGER;
  v_new  INTEGER;
  v_movement_id UUID;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    -- Variant-level stock
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
    -- Product-level stock (tenant-scoped)
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
    tenant_id, product_id, variant_id, movement_type,
    quantity, quantity_change, previous_quantity, new_quantity,
    reference_type, reference_id, reason, performed_by, created_by
  ) VALUES (
    p_tenant_id, p_product_id, p_variant_id, p_movement_type,
    ABS(p_quantity_change), p_quantity_change, v_prev, v_new,
    p_reference_type, p_reference_id, p_reason, p_performed_by, p_performed_by
  )
  RETURNING id INTO v_movement_id;

  movement_id := v_movement_id;
  previous_quantity := v_prev;
  new_quantity := v_new;
  RETURN NEXT;
END;
$$;

COMMIT;
