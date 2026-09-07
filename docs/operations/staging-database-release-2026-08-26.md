# Staging database release gate — 2026-08-26

This is the database gate for the release branch currently based on
`fix/compact-brand-marks`. It must be run against the **staging** Supabase
database with its direct `DATABASE_URL`; it must never be pointed at production.

## Preconditions

1. Make the exact release commit available on the staging host before applying
   anything. The migration files are not yet present on `staging` until that
   commit has been pushed or otherwise transferred.
2. Stop if `DATABASE_URL` is not confirmed to be staging.
3. Take a restorable backup before making a schema change:

   ```bash
   export RELEASE_SHA='<approved release SHA>'
   export DATABASE_URL='<staging direct Postgres URL on port 5432>'
   mkdir -p /var/backups/booka
   pg_dump --format=custom --file="/var/backups/booka/staging-before-${RELEASE_SHA}.dump" "$DATABASE_URL"
   ```

4. Check the target and the required existing foundation:

   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "select current_database(), current_user, inet_server_addr();"
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
     select to_regclass('public.retail_orders') as retail_orders,
            to_regclass('public.inventory_movements') as inventory_movements,
            to_regclass('public.products') as products,
            to_regclass('public.product_variants') as product_variants,
            to_regclass('public.transactions') as transactions,
            to_regclass('public.customer_profile_summary') as customer_profile_summary,
            to_regclass('public.whatsapp_configurations') as whatsapp_configurations,
            to_regclass('public.whatsapp_provider_secrets') as whatsapp_provider_secrets;"
   ```

   Every value must be non-null. If one is null, stop: the staging database is
   missing an earlier foundation migration and must be reconciled before this
   release.

## Daily Operating Loop guard

`supabase/migrations/042_operating_loop.sql` is intentionally one-shot. Check
for it before applying the operating-loop chain:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
  select to_regclass('public.operating_loop_state') as loop_state,
         to_regclass('public.operating_objectives') as objectives,
         to_regclass('public.operating_delivery_outbox') as outbox,
         to_regprocedure('public.claim_operating_deliveries(integer)') as claim_function;"
```

- If every value is null, apply `042`, `043`, and `044` below in that order.
- If every value is present, do **not** replay `042–044`; inspect the deployed
  migration history/schema drift first.
- If the result is mixed, stop. It indicates a partial operating-loop migration
  and needs a targeted recovery plan.

## Apply the forward migrations

Run only forward migrations—never the matching `_rollback.sql` files. From a
checkout of the approved release commit:

```bash
set -Eeuo pipefail

release_migrations=(
  db/migrations/122_business_events.sql
  db/migrations/123_reconciliation.sql
  db/migrations/124_ledger_columns.sql
  db/migrations/125_ai_action_log.sql
  db/migrations/126_inventory_movements_commerce.sql
  db/migrations/127_record_retail_sale_fn.sql
  db/migrations/128_business_anomalies.sql
  db/migrations/129_tenant_user_permissions.sql
  db/migrations/130_inventory_locations_counts.sql
  db/migrations/131_approvals.sql
  db/migrations/132_recipes_uom.sql
  db/migrations/133_customer_memory.sql
  db/migrations/134_multimodal_capture.sql
  db/migrations/135_analytics_briefings.sql
  db/migrations/136_recommendations.sql
  db/migrations/137_fix_update_inventory_overload.sql
  db/migrations/138_harden_retail_sale_functions.sql
  db/migrations/2026-07-31_add_reservations_source.sql
  db/migrations/2026-08-04_meta_embedded_signup_foundation.sql
  db/migrations/2026-08-10_storefront_engine.sql
)

for migration in "${release_migrations[@]}"; do
  printf '\n==> %s\n' "$migration"
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$migration"
done

# Run this block only when the Daily Operating Loop guard found no loop tables.
for migration in \
  supabase/migrations/042_operating_loop.sql \
  supabase/migrations/043_operating_loop_delivery_safety.sql \
  supabase/migrations/044_operating_loop_delivery_worker.sql; do
  printf '\n==> %s\n' "$migration"
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$migration"
done
```

## Verification before merging to `staging`

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
  select to_regclass('public.business_events') as business_events,
         to_regclass('public.business_recommendations') as recommendations,
         to_regclass('public.storefront_campaigns') as storefront_campaigns,
         to_regclass('public.operating_loop_state') as loop_state,
         to_regclass('public.operating_delivery_outbox') as operating_outbox,
         to_regprocedure('public.claim_operating_deliveries(integer)') as claim_delivery,
         to_regprocedure('public.complete_operating_delivery(uuid,text,text,text,timestamp with time zone)') as complete_delivery;"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
  select p.proname, p.proconfig,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
         has_function_privilege('service_role', p.oid, 'EXECUTE') as service_can_execute
  from pg_proc p
  where p.oid in (
    'public.record_retail_sale_tx(uuid,uuid,jsonb,uuid,text,uuid,text,text,text,jsonb)'::regprocedure,
    'public.refund_retail_sale_tx(uuid,uuid,uuid,text,text)'::regprocedure
  )
  order by p.proname;"
```

The final query must show `anon_can_execute = false`,
`service_can_execute = true`, and `search_path=pg_catalog, public` for both
functions. Only after these checks pass should the release be merged into
`staging` and allowed to deploy.
