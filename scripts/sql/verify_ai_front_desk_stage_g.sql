\echo '== flat category checks =='
select to_regclass('public.products') as products;
select to_regclass('public.product_categories') as product_categories;

\echo '== products.category present / category_id removed =='
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'products'
  and column_name in ('category', 'category_id')
order by column_name;

\echo '== sample category distribution =='
select
  coalesce(nullif(btrim(category), ''), 'Uncategorized') as category_label,
  count(*) as product_count
from products
where nullif(:'tenant_id', '') is null
   or tenant_id = nullif(:'tenant_id', '')::uuid
group by 1
order by 2 desc, 1 asc
limit 25;
