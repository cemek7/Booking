-- 114_products_catalog.sql
--
-- Creates the product-catalogue subsystem that the products API
-- (src/app/api/products/**) and the AI Front Desk's product grounding
-- (src/lib/ai/grounding-service.ts -> from('products')) depend on, but which no
-- migration ever created:
--   product_categories, products, product_variants, inventory_movements,
--   + get_product_stock(uuid)
--
-- Column set is taken from the canonical types in src/types/product-catalogue.ts
-- (Product, ProductVariant, ProductCategory, InventoryMovement) and the grounding
-- select ('id, name, description, short_description, price_cents, currency,
-- is_featured, stock_quantity, track_inventory', filtered is_active, ordered
-- is_featured/name).
--
-- Conventions follow migration 067 (UUID PK gen_random_uuid(), tenant_id UUID
-- REFERENCES tenants(id) ON DELETE CASCADE) -- the current-generation schema style.
--
-- Manual fallback: every statement is idempotent (CREATE TABLE IF NOT EXISTS /
-- CREATE OR REPLACE FUNCTION) and safe to run by hand.

BEGIN;

-- ---------------------------------------------------------------------------
-- product_categories
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_categories (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  slug          TEXT,
  parent_id     UUID        REFERENCES product_categories(id) ON DELETE SET NULL,
  description   TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order    INTEGER     DEFAULT 0,
  display_order INTEGER     DEFAULT 0,
  metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_categories_tenant
  ON product_categories (tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_parent
  ON product_categories (parent_id) WHERE parent_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                        TEXT        NOT NULL,
  description                 TEXT,
  short_description           TEXT,
  price_cents                 INTEGER     NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  cost_price_cents            INTEGER     CHECK (cost_price_cents IS NULL OR cost_price_cents >= 0),
  price                       NUMERIC(12,2),               -- legacy/major-unit mirror (optional)
  currency                    TEXT        NOT NULL DEFAULT 'NGN',
  sku                         TEXT,
  brand                       TEXT,
  category_id                 UUID        REFERENCES product_categories(id) ON DELETE SET NULL,
  images                      JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- string[] of URLs
  is_active                   BOOLEAN     NOT NULL DEFAULT TRUE,
  is_featured                 BOOLEAN     NOT NULL DEFAULT FALSE,
  is_digital                  BOOLEAN     NOT NULL DEFAULT FALSE,
  track_inventory             BOOLEAN     NOT NULL DEFAULT FALSE,
  stock_quantity              INTEGER     NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  low_stock_threshold         INTEGER     DEFAULT 0,
  upsell_priority             INTEGER     DEFAULT 0,
  weight_grams                INTEGER,
  dimensions                  JSONB,
  frequently_bought_together  JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- product id[]
  tags                        TEXT[]      NOT NULL DEFAULT '{}',
  metadata                    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_tenant       ON products (tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_category     ON products (category_id) WHERE category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_tenant_active
  ON products (tenant_id, is_featured DESC, name) WHERE is_active = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_tenant_sku
  ON products (tenant_id, sku) WHERE sku IS NOT NULL;

-- ---------------------------------------------------------------------------
-- product_variants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_variants (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id             UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name                   TEXT        NOT NULL,
  variant_name           TEXT,
  variant_type           TEXT,
  description            TEXT,
  sku                    TEXT,
  price_cents            INTEGER     CHECK (price_cents IS NULL OR price_cents >= 0),
  price                  NUMERIC(12,2),
  price_adjustment_cents INTEGER     DEFAULT 0,
  stock_quantity         INTEGER     NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  display_order          INTEGER     DEFAULT 0,
  weight_grams           INTEGER,
  volume_ml              INTEGER,
  attributes             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  metadata               JSONB       NOT NULL DEFAULT '{}'::jsonb,
  is_active              BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product
  ON product_variants (product_id);

-- ---------------------------------------------------------------------------
-- inventory_movements  (audit trail of stock changes)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_movements (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id      UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  movement_type   TEXT        NOT NULL CHECK (movement_type IN ('in','out','adjustment','transfer')),
  quantity        INTEGER     NOT NULL DEFAULT 0,
  quantity_change INTEGER,
  reason          TEXT,
  notes           TEXT,
  reference_id    TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_product
  ON inventory_movements (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant
  ON inventory_movements (tenant_id);

-- ---------------------------------------------------------------------------
-- get_product_stock(uuid)
--   The products API embeds this as `stock_info:get_product_stock(product_id)`.
--   Returns the on-hand / reserved / available counts for a single product.
--   v1: `reserved` is 0 (no reservation ledger for products yet); `available`
--   therefore equals stock_quantity. Refine once a product-reservation source exists.
--   NOTE: PostgREST function-embedding semantics for the `stock_info:` alias should
--   be confirmed against the live PostgREST config; the API path is opt-in
--   (include_stock_info=false by default) so this does not block product reads.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_product_stock(product_id UUID)
RETURNS TABLE (stock_quantity INTEGER, reserved INTEGER, available INTEGER)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(p.stock_quantity, 0)        AS stock_quantity,
    0                                    AS reserved,
    COALESCE(p.stock_quantity, 0)        AS available
  FROM products p
  WHERE p.id = get_product_stock.product_id;
$$;

COMMIT;
