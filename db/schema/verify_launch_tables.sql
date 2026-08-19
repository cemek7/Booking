-- verify_launch_tables.sql
-- Confirms the launch-critical tables exist after scripts/db-launch-reconcile.sh.
-- Every row should show exists = true. Any false = that migration did not persist.
with expected(t) as (values
  ('products'),('product_variants'),('inventory_movements'),
  ('retail_orders'),('retail_carts'),('retail_cart_items'),('retail_order_items'),
  ('messaging_consents'),('email_unsubscribes'),
  ('social_mentions'),('tenant_listening_config'))
select e.t as table_name,
       (to_regclass('public.' || e.t) is not null) as exists
from expected e
order by e.t;
