BEGIN;

DROP POLICY IF EXISTS customer_merge_candidates_service_role ON public.customer_merge_candidates;
DROP TABLE IF EXISTS public.customer_merge_candidates;
DROP FUNCTION IF EXISTS public.merge_customers_tx(uuid, uuid, uuid);

DROP INDEX IF EXISTS idx_customers_norm_phone;

DROP TRIGGER IF EXISTS trg_sync_customer_normalized_phone ON public.customers;
DROP FUNCTION IF EXISTS public.sync_customer_normalized_phone();
DROP FUNCTION IF EXISTS public.normalize_customer_phone(text);

ALTER TABLE public.customer_profile_summary
  DROP COLUMN IF EXISTS lifetime_value_cents,
  DROP COLUMN IF EXISTS avg_spend_cents,
  DROP COLUMN IF EXISTS outstanding_balance_cents,
  DROP COLUMN IF EXISTS repeat_interval_days,
  DROP COLUMN IF EXISTS preferred_staff_id,
  DROP COLUMN IF EXISTS no_show_count,
  DROP COLUMN IF EXISTS cancellation_count,
  DROP COLUMN IF EXISTS last_computed_at;

ALTER TABLE public.customers
  DROP COLUMN IF EXISTS normalized_phone,
  DROP COLUMN IF EXISTS merged_into;

COMMIT;
