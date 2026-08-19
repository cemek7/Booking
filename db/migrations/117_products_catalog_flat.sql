-- 117_products_catalog_flat.sql
--
-- Canonical FLAT-model products catalogue, create-from-scratch + idempotent.
--
-- WHY THIS EXISTS: on databases where 114 never actually landed, the products
-- subsystem is missing entirely, and Stage G (116, all `IF EXISTS` guards) then
-- ran as a no-op. This script creates the full subsystem directly in its final
-- FLAT shape (no product_categories table, no products.category_id -- category is
-- a plain text label on products, matching what the app code reads/writes after
-- the Stage G refactor).
--
-- Safe in the normal 114->115->116 sequence (everything is IF NOT EXISTS / OR
-- REPLACE, so it skips when already present) AND as a standalone recovery on an
-- empty database. No BEGIN/COMMIT: each statement commits independently so a
-- failure pinpoints the offending line instead of rolling everything back.
--
-- Run:
--   psql "$DATABASE_URL" -f db/migrations/117_products_catalog_flat.sql
-- or paste into the Supabase SQL editor. The final SELECT returns the 3 tables.

-- ---------------------------------------------------------------------------
-- products  (FLAT category label; NO category_id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name                       text NOT NULL,
  description                text,
  short_description          text,
  category                   text,
  price_cents                integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  cost_price_cents           integer CHECK (cost_price_cents IS NULL OR cost_price_cents >= 0),
  price                      numeric(12,2),
  currency                   text NOT NULL DEFAULT 'NGN',
  sku                        text,
  brand                      text,
  images                     jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active                  boolean NOT NULL DEFAULT true,
  is_featured                boolean NOT NULL DEFAULT false,
  is_digital                 boolean NOT NULL DEFAULT false,
  track_inventory            boolean NOT NULL DEFAULT false,
  stock_quantity             integer NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  low_stock_threshold        integer DEFAULT 0,
  upsell_priority            integer DEFAULT 0,
  weight_grams               integer,
  dimensions                 jsonb,
  frequently_bought_together jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags                       text[] NOT NULL DEFAULT '{}',
  metadata                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
-- If products pre-exists from 114 without the flat column, ensure it.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category text;
CREATE INDEX IF NOT EXISTS idx_products_tenant        ON public.products (tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_tenant_active ON public.products (tenant_id, is_featured DESC, name) WHERE is_active = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_tenant_sku ON public.products (tenant_id, sku) WHERE sku IS NOT NULL;

-- ---------------------------------------------------------------------------
-- product_variants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_variants (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id             uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  variant_name           text,
  variant_type           text,
  description            text,
  sku                    text,
  price_cents            integer CHECK (price_cents IS NULL OR price_cents >= 0),
  price                  numeric(12,2),
  price_adjustment_cents integer DEFAULT 0,
  stock_quantity         integer NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  display_order          integer DEFAULT 0,
  weight_grams           integer,
  volume_ml              integer,
  attributes             jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active              boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON public.product_variants (product_id);

-- ---------------------------------------------------------------------------
-- inventory_movements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id        uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  movement_type     text NOT NULL,
  quantity          integer NOT NULL DEFAULT 0,
  quantity_change   integer,
  previous_quantity integer,
  new_quantity      integer,
  reference_type    text,
  reference_id      text,
  reason            text,
  notes             text,
  performed_by      uuid,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- Backfill columns if inventory_movements pre-exists from 114's narrow set.
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS variant_id        uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reference_type    text,
  ADD COLUMN IF NOT EXISTS previous_quantity integer,
  ADD COLUMN IF NOT EXISTS new_quantity      integer,
  ADD COLUMN IF NOT EXISTS performed_by      uuid;
ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product      ON public.inventory_movements (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant       ON public.inventory_movements (tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_performed_by ON public.inventory_movements (performed_by) WHERE performed_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- get_product_stock(uuid)  — embedded by the products API as stock_info
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_product_stock(product_id uuid)
RETURNS TABLE (stock_quantity integer, reserved integer, available integer)
LANGUAGE sql STABLE AS $func$
  SELECT COALESCE(p.stock_quantity, 0), 0, COALESCE(p.stock_quantity, 0)
  FROM public.products p
  WHERE p.id = get_product_stock.product_id;
$func$;

-- ---------------------------------------------------------------------------
-- update_inventory(...)  — atomic stock adjust + movement log
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_inventory(
  p_tenant_id       uuid,
  p_product_id      uuid,
  p_variant_id      uuid,
  p_quantity_change integer,
  p_movement_type   text,
  p_reference_type  text,
  p_reference_id    text,
  p_reason          text,
  p_performed_by    uuid
)
RETURNS TABLE (movement_id uuid, previous_quantity integer, new_quantity integer)
LANGUAGE plpgsql AS $func$
DECLARE
  v_prev integer;
  v_new  integer;
  v_id   uuid;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    SELECT COALESCE(stock_quantity, 0) INTO v_prev
    FROM public.product_variants WHERE id = p_variant_id FOR UPDATE;
    IF v_prev IS NULL THEN RAISE EXCEPTION 'Variant % not found', p_variant_id; END IF;
    v_new := GREATEST(0, v_prev + p_quantity_change);
    UPDATE public.product_variants SET stock_quantity = v_new, updated_at = now() WHERE id = p_variant_id;
  ELSE
    SELECT COALESCE(stock_quantity, 0) INTO v_prev
    FROM public.products WHERE id = p_product_id AND tenant_id = p_tenant_id FOR UPDATE;
    IF v_prev IS NULL THEN RAISE EXCEPTION 'Product % not found for tenant %', p_product_id, p_tenant_id; END IF;
    v_new := GREATEST(0, v_prev + p_quantity_change);
    UPDATE public.products SET stock_quantity = v_new, updated_at = now() WHERE id = p_product_id AND tenant_id = p_tenant_id;
  END IF;

  INSERT INTO public.inventory_movements (
    tenant_id, product_id, variant_id, movement_type, quantity, quantity_change,
    previous_quantity, new_quantity, reference_type, reference_id, reason, performed_by, created_by
  ) VALUES (
    p_tenant_id, p_product_id, p_variant_id, p_movement_type, ABS(p_quantity_change), p_quantity_change,
    v_prev, v_new, p_reference_type, p_reference_id, p_reason, p_performed_by, p_performed_by
  )
  RETURNING id INTO v_id;

  movement_id := v_id;
  previous_quantity := v_prev;
  new_quantity := v_new;
  RETURN NEXT;
END;
$func$;

-- ---------------------------------------------------------------------------
-- VERIFICATION — expect 3 rows: inventory_movements | product_variants | products
-- ---------------------------------------------------------------------------
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('products','product_variants','inventory_movements')
ORDER BY table_name;
