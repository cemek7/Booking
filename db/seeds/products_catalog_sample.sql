-- products_catalog_sample.sql
--
-- Seeds a sample product catalogue (beauty/salon vertical) for ONE tenant so the
-- AI Front Desk sales path (show_catalog / recommend_products / offer_upsell /
-- offer_cross_sell) has data to surface. Requires migrations 114 + 115 applied.
--
-- Run with the target tenant's UUID:
--   psql "$DATABASE_URL" -v tenant_id="'00000000-0000-0000-0000-000000000000'" \
--     -f db/seeds/products_catalog_sample.sql
--
-- Idempotent: categories are guarded by NOT EXISTS; products by the unique
-- (tenant_id, sku) index from migration 114.

BEGIN;

-- 1. Categories (flat name reused as the denormalized products.category label).
INSERT INTO product_categories (tenant_id, name, slug, description, is_active, sort_order)
SELECT :tenant_id, c.name, c.slug, c.description, true, c.sort_order
FROM (VALUES
  ('Hair Care',  'hair-care',  'Shampoos, conditioners, treatments', 1),
  ('Aftercare',  'aftercare',  'Post-service maintenance products',  2),
  ('Accessories','accessories','Tools and add-ons',                  3)
) AS c(name, slug, description, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM product_categories pc
  WHERE pc.tenant_id = :tenant_id AND pc.slug = c.slug
);

-- 2. Products. category (flat text) is what the AI sales read uses; category_id
--    links to the row above for the management API's joined read.
INSERT INTO products (
  tenant_id, name, description, short_description, category, category_id,
  sku, price_cents, currency, is_active, is_featured, track_inventory,
  stock_quantity, low_stock_threshold, upsell_priority
)
SELECT
  :tenant_id, p.name, p.description, p.short_description, p.category,
  (SELECT id FROM product_categories pc
    WHERE pc.tenant_id = :tenant_id AND pc.name = p.category LIMIT 1),
  p.sku, p.price_cents, 'NGN', true, p.is_featured, true,
  p.stock_quantity, 3, p.upsell_priority
FROM (VALUES
  ('Argan Hair Oil',        'Nourishing argan oil for shine and frizz control', 'Shine + frizz control', 'Aftercare',   'AFT-ARG-001',  650000, true,  10, 9),
  ('Sulfate-Free Shampoo',  'Gentle daily shampoo, colour-safe',                'Colour-safe cleanse',   'Hair Care',   'HAIR-SHM-001', 480000, true,  15, 7),
  ('Deep Conditioner',      'Weekly repair mask for dry/damaged hair',          'Weekly repair mask',    'Hair Care',   'HAIR-CND-001', 520000, false, 12, 6),
  ('Heat Protectant Spray', 'Shields hair up to 230°C before styling',          'Pre-styling shield',    'Aftercare',   'AFT-HPS-001',  390000, false, 20, 8),
  ('Edge Control Gel',      'Strong-hold, no-flake edge control',               'Strong-hold edges',     'Accessories', 'ACC-EDG-001',  250000, false, 25, 4),
  ('Silk Hair Bonnet',      'Protects style overnight, reduces breakage',       'Overnight protection',  'Accessories', 'ACC-BNT-001',  300000, true,  18, 5)
) AS p(name, description, short_description, category, sku, price_cents, is_featured, stock_quantity, upsell_priority)
ON CONFLICT (tenant_id, sku) WHERE sku IS NOT NULL DO NOTHING;

COMMIT;
