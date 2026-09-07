CREATE TABLE IF NOT EXISTS public.media_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('whatsapp', 'dashboard', 'api')),
  kind text NOT NULL CHECK (kind IN ('receipt', 'invoice', 'voice', 'photo', 'pdf', 'stock_sheet', 'screenshot', 'service_note')),
  storage_path text NOT NULL,
  file_hash text NOT NULL,
  mime text NOT NULL,
  size bigint NOT NULL DEFAULT 0 CHECK (size >= 0),
  uploaded_by uuid NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_inputs_tenant_hash_path
  ON public.media_inputs (tenant_id, file_hash, storage_path);

CREATE INDEX IF NOT EXISTS idx_media_inputs_tenant_hash
  ON public.media_inputs (tenant_id, file_hash);

CREATE TABLE IF NOT EXISTS public.extraction_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  media_input_id uuid NOT NULL REFERENCES public.media_inputs(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'review_required', 'confirmed', 'failed')) DEFAULT 'pending',
  model text NULL,
  prompt_version text NULL,
  error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_extraction_jobs_tenant_status
  ON public.extraction_jobs (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.extracted_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.extraction_jobs(id) ON DELETE CASCADE,
  record_type text NOT NULL CHECK (record_type IN ('expense', 'purchase', 'stock_receipt', 'supplier_payment', 'retail_sale', 'service', 'stock_count')),
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  field_confidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  low_confidence_fields text[] NOT NULL DEFAULT '{}'::text[],
  proposed_action jsonb NULL,
  linked_record_type text NULL,
  linked_record_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_extracted_records_tenant_type
  ON public.extracted_records (tenant_id, record_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text NULL,
  email text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_tenant_name
  ON public.suppliers (tenant_id, lower(name));

CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  supplier_id uuid NULL REFERENCES public.suppliers(id) ON DELETE SET NULL,
  media_input_id uuid NULL REFERENCES public.media_inputs(id) ON DELETE SET NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'NGN',
  expense_date date NOT NULL,
  reference text NULL,
  notes text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_tenant_date
  ON public.expenses (tenant_id, expense_date DESC);

CREATE TABLE IF NOT EXISTS public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  supplier_id uuid NULL REFERENCES public.suppliers(id) ON DELETE SET NULL,
  media_input_id uuid NULL REFERENCES public.media_inputs(id) ON DELETE SET NULL,
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  currency text NOT NULL DEFAULT 'NGN',
  purchase_date date NOT NULL,
  reference text NULL,
  status text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'received', 'cancelled')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchases_tenant_date
  ON public.purchases (tenant_id, purchase_date DESC);

CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  supplier_id uuid NULL REFERENCES public.suppliers(id) ON DELETE SET NULL,
  purchase_id uuid NULL REFERENCES public.purchases(id) ON DELETE SET NULL,
  media_input_id uuid NULL REFERENCES public.media_inputs(id) ON DELETE SET NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'NGN',
  payment_date date NOT NULL,
  reference text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_tenant_date
  ON public.supplier_payments (tenant_id, payment_date DESC);

CREATE TABLE IF NOT EXISTS public.stock_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  purchase_id uuid NULL REFERENCES public.purchases(id) ON DELETE SET NULL,
  media_input_id uuid NULL REFERENCES public.media_inputs(id) ON DELETE SET NULL,
  supplier_id uuid NULL REFERENCES public.suppliers(id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  notes text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.media_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extraction_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extracted_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS media_inputs_service_role ON public.media_inputs;
CREATE POLICY media_inputs_service_role ON public.media_inputs
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS extraction_jobs_service_role ON public.extraction_jobs;
CREATE POLICY extraction_jobs_service_role ON public.extraction_jobs
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS extracted_records_service_role ON public.extracted_records;
CREATE POLICY extracted_records_service_role ON public.extracted_records
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS suppliers_service_role ON public.suppliers;
CREATE POLICY suppliers_service_role ON public.suppliers
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS expenses_service_role ON public.expenses;
CREATE POLICY expenses_service_role ON public.expenses
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS purchases_service_role ON public.purchases;
CREATE POLICY purchases_service_role ON public.purchases
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS supplier_payments_service_role ON public.supplier_payments;
CREATE POLICY supplier_payments_service_role ON public.supplier_payments
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS stock_receipts_service_role ON public.stock_receipts;
CREATE POLICY stock_receipts_service_role ON public.stock_receipts
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_inputs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.extraction_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.extracted_records TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchases TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_payments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_receipts TO service_role;
