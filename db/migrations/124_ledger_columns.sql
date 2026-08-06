-- 124_ledger_columns.sql — additive merchant reconciliation fields + tenant close settings
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS subject_type text CHECK (subject_type IN ('reservation', 'retail_order')),
  ADD COLUMN IF NOT EXISTS subject_id uuid;

CREATE INDEX IF NOT EXISTS idx_transactions_subject
  ON public.transactions (tenant_id, subject_type, subject_id);

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS price_cents_snapshot bigint,
  ADD COLUMN IF NOT EXISTS discount_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_reason text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE public.retail_orders
  ADD COLUMN IF NOT EXISTS discount_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_fee_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_paid_cents bigint NOT NULL DEFAULT 0;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS close_report_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS close_report_time time NOT NULL DEFAULT '20:00';
