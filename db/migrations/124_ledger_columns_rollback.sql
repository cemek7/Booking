ALTER TABLE public.transactions
  DROP COLUMN IF EXISTS subject_type,
  DROP COLUMN IF EXISTS subject_id;

ALTER TABLE public.reservations
  DROP COLUMN IF EXISTS price_cents_snapshot,
  DROP COLUMN IF EXISTS discount_cents,
  DROP COLUMN IF EXISTS discount_reason,
  DROP COLUMN IF EXISTS completed_at;

ALTER TABLE public.retail_orders
  DROP COLUMN IF EXISTS discount_cents,
  DROP COLUMN IF EXISTS delivery_fee_cents,
  DROP COLUMN IF EXISTS amount_paid_cents;

ALTER TABLE public.tenants
  DROP COLUMN IF EXISTS close_report_enabled,
  DROP COLUMN IF EXISTS close_report_time;
