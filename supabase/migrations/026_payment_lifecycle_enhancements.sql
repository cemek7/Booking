-- Migration 026: Enhance transactions table for refunds, retries, and ledger reconciliation
-- Date: 2025-11-20

-- Add new columns to transactions table for refund tracking and retry logic
ALTER TABLE public.transactions 
  ADD COLUMN IF NOT EXISTS original_transaction_id uuid REFERENCES public.transactions(id),
  ADD COLUMN IF NOT EXISTS refund_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS refund_reason text,
  ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_reference text, -- external transaction ID from provider
  ADD COLUMN IF NOT EXISTS reconciliation_status text DEFAULT 'pending' CHECK (reconciliation_status IN ('pending', 'matched', 'discrepancy', 'manual_review')),
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Create ledger table for financial reconciliation
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES public.transactions(id),
  entry_type text NOT NULL CHECK (entry_type IN ('deposit', 'refund', 'fee', 'adjustment')),
  amount numeric(12,2) NOT NULL,
  currency text DEFAULT 'NGN',
  description text,
  reference_id text, -- external reference
  posted_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

-- Create transaction_retries table for retry logic tracking
CREATE TABLE IF NOT EXISTS public.transaction_retries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.transactions(id),
  attempt_number integer NOT NULL,
  attempted_at timestamptz DEFAULT now(),
  error_code text,
  error_message text,
  response_data jsonb,
  status text CHECK (status IN ('pending', 'success', 'failed')),
  next_attempt_at timestamptz
);

-- Enable RLS for new tables
ALTER TABLE IF EXISTS public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.transaction_retries ENABLE ROW LEVEL SECURITY;

-- Tenant scoping policies for ledger_entries
DROP POLICY IF EXISTS ledger_entries_select ON public.ledger_entries;
CREATE POLICY ledger_entries_select ON public.ledger_entries
  FOR SELECT
  TO authenticated
  USING (
    tenant_id::text = current_setting('request.jwt.claims.tenant_id', true)
  );

DROP POLICY IF EXISTS ledger_entries_service ON public.ledger_entries;
CREATE POLICY ledger_entries_service ON public.ledger_entries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Tenant scoping policies for transaction_retries  
DROP POLICY IF EXISTS transaction_retries_select ON public.transaction_retries;
CREATE POLICY transaction_retries_select ON public.transaction_retries
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.transactions t 
      WHERE t.id = transaction_retries.transaction_id 
      AND t.tenant_id::text = current_setting('request.jwt.claims.tenant_id', true)
    )
  );

DROP POLICY IF EXISTS transaction_retries_service ON public.transaction_retries;
CREATE POLICY transaction_retries_service ON public.transaction_retries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS transactions_provider_ref_idx ON public.transactions (provider_reference) WHERE provider_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS transactions_retry_next_idx ON public.transactions (next_retry_at) WHERE next_retry_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS transactions_reconciliation_idx ON public.transactions (reconciliation_status, tenant_id);
CREATE INDEX IF NOT EXISTS ledger_entries_tenant_type_idx ON public.ledger_entries (tenant_id, entry_type, posted_at);
CREATE INDEX IF NOT EXISTS transaction_retries_next_attempt_idx ON public.transaction_retries (next_attempt_at) WHERE next_attempt_at IS NOT NULL;

-- Update function to automatically set updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add trigger for transactions updated_at
DROP TRIGGER IF EXISTS update_transactions_updated_at ON public.transactions;
CREATE TRIGGER update_transactions_updated_at
    BEFORE UPDATE ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();