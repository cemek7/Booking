-- 116_flat_product_categories.sql
--
-- Finalizes the flat product category model:
--   - keeps products.category as the single source of truth
--   - backfills products.category from product_categories/category_id when needed
--   - drops products.category_id
--   - drops product_categories
--
-- Safe to rerun: every step checks object existence before mutating.

BEGIN;

-- Ensure the flat column exists before any backfill.
ALTER TABLE IF EXISTS products
  ADD COLUMN IF NOT EXISTS category TEXT;

-- Backfill from the normalized relationship only when both sides still exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'product_categories'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'category_id'
  ) THEN
    UPDATE products p
       SET category = pc.name
      FROM product_categories pc
     WHERE p.category_id = pc.id
       AND (p.category IS NULL OR btrim(p.category) = '');
  END IF;
END $$;

-- Remove legacy index before dropping the column.
DROP INDEX IF EXISTS idx_products_category;

-- Drop foreign-key category reference if it still exists.
ALTER TABLE IF EXISTS products
  DROP COLUMN IF EXISTS category_id;

-- Drop the old category table once nothing references it.
DROP TABLE IF EXISTS product_categories;

COMMIT;
