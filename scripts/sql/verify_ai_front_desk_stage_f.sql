\echo '== structural checks =='
select to_regclass('public.product_categories') as product_categories;
select to_regclass('public.products') as products;
select to_regclass('public.product_variants') as product_variants;
select to_regclass('public.inventory_movements') as inventory_movements;
select proname
from pg_proc
where proname in ('get_product_stock', 'update_inventory')
order by proname;

\echo '== products columns =='
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'products'
order by ordinal_position;

\echo '== inventory_movements reconcile columns =='
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'inventory_movements'
  and column_name in (
    'variant_id',
    'reference_type',
    'previous_quantity',
    'new_quantity',
    'performed_by'
  )
order by ordinal_position;

\echo '== category / product counts =='
select
  count(*) as category_count,
  count(*) filter (where is_active) as active_category_count
from product_categories
where nullif(:'tenant_id', '') is null
   or tenant_id = nullif(:'tenant_id', '')::uuid;

select
  count(*) as product_count,
  count(*) filter (where is_active) as active_product_count,
  count(*) filter (where is_featured) as featured_product_count,
  count(*) filter (where track_inventory) as tracked_inventory_count
from products
where nullif(:'tenant_id', '') is null
   or tenant_id = nullif(:'tenant_id', '')::uuid;

\echo '== sample products =='
select tenant_id, id, name, price_cents, currency, is_active, is_featured, stock_quantity, track_inventory
from products
where nullif(:'tenant_id', '') is null
   or tenant_id = nullif(:'tenant_id', '')::uuid
order by created_at desc
limit 20;

\echo '== low / out-of-stock tracked products =='
select tenant_id, id, name, stock_quantity, low_stock_threshold
from products
where track_inventory = true
  and (
    stock_quantity <= 0
    or stock_quantity <= coalesce(low_stock_threshold, 0)
  )
  and (
    nullif(:'tenant_id', '') is null
    or tenant_id = nullif(:'tenant_id', '')::uuid
  )
order by stock_quantity asc, created_at desc
limit 20;
