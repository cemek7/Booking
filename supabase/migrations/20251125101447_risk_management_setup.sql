-- Risk Management Strategy Database Migration
-- Implements double-booking prevention and payment security features

-- 1. Reservation Locks Table (Double-booking prevention)
CREATE TABLE IF NOT EXISTS public.reservation_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slot_key text NOT NULL, -- unique key for time slot + resource
  session_id text, -- optional session identifier
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  
  -- Unique constraint to prevent double locking
  CONSTRAINT reservation_locks_slot_key_unique UNIQUE (tenant_id, slot_key)
);

-- Index for efficient lock cleanup
CREATE INDEX IF NOT EXISTS reservation_locks_expires_at_idx ON public.reservation_locks (expires_at);
CREATE INDEX IF NOT EXISTS reservation_locks_tenant_slot_idx ON public.reservation_locks (tenant_id, slot_key);

-- 2. Idempotency Keys Table (Payment security)
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  operation text NOT NULL, -- 'payment', 'refund', 'webhook'
  idempotency_key text NOT NULL,
  idempotency_hash text NOT NULL,
  amount numeric(12,2),
  metadata jsonb DEFAULT '{}',
  status text DEFAULT 'processing', -- 'processing', 'completed', 'failed'
  response_data jsonb,
  transaction_id uuid, -- reference to actual transaction
  authorization_url text,
  created_at timestamptz DEFAULT now(),
  
  -- Unique constraint for idempotency
  CONSTRAINT idempotency_keys_hash_unique UNIQUE (tenant_id, idempotency_hash)
);

-- Index for idempotency window queries
CREATE INDEX IF NOT EXISTS idempotency_keys_created_at_idx ON public.idempotency_keys (created_at);
CREATE INDEX IF NOT EXISTS idempotency_keys_tenant_operation_idx ON public.idempotency_keys (tenant_id, operation);

-- 3. Fraud Assessments Table
CREATE TABLE IF NOT EXISTS public.fraud_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  risk_score integer NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_level text NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  flags text[] DEFAULT '{}',
  recommendation text NOT NULL CHECK (recommendation IN ('approve', 'review', 'decline')),
  payment_amount numeric(12,2),
  payment_currency text,
  customer_email text,
  ip_address inet,
  user_agent text,
  country_code text,
  details jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Index for fraud analysis
CREATE INDEX IF NOT EXISTS fraud_assessments_tenant_date_idx ON public.fraud_assessments (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS fraud_assessments_risk_score_idx ON public.fraud_assessments (risk_score);
CREATE INDEX IF NOT EXISTS fraud_assessments_email_idx ON public.fraud_assessments (customer_email);

-- 4. Suspicious Activities Table
CREATE TABLE IF NOT EXISTS public.suspicious_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  activity_type text NOT NULL,
  details jsonb DEFAULT '{}',
  severity text DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  ip_address inet,
  user_agent text,
  resolved boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Index for suspicious activity monitoring
CREATE INDEX IF NOT EXISTS suspicious_activities_tenant_date_idx ON public.suspicious_activities (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS suspicious_activities_type_severity_idx ON public.suspicious_activities (activity_type, severity);

-- 5. Staff Availability Table (For conflict detection)
CREATE TABLE IF NOT EXISTS public.staff_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL,
  day_of_week integer NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6), -- 0 = Sunday
  start_time time NOT NULL,
  end_time time NOT NULL,
  break_start time,
  break_end time,
  is_available boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  -- Unique constraint for staff schedule
  CONSTRAINT staff_availability_staff_day_unique UNIQUE (tenant_id, staff_id, day_of_week)
);

-- Index for availability queries
CREATE INDEX IF NOT EXISTS staff_availability_tenant_staff_idx ON public.staff_availability (tenant_id, staff_id);

-- 6. Add reconciliation columns to existing transactions table
DO $$
BEGIN
  -- Add reconciliation columns if they don't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'reconciliation_status') THEN
    ALTER TABLE public.transactions ADD COLUMN reconciliation_status text DEFAULT 'pending' CHECK (reconciliation_status IN ('pending', 'matched', 'discrepancy'));
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'reconciled_at') THEN
    ALTER TABLE public.transactions ADD COLUMN reconciled_at timestamptz;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'provider_reference') THEN
    ALTER TABLE public.transactions ADD COLUMN provider_reference text;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'retry_count') THEN
    ALTER TABLE public.transactions ADD COLUMN retry_count integer DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'next_retry_at') THEN
    ALTER TABLE public.transactions ADD COLUMN next_retry_at timestamptz;
  END IF;
END$$;

-- Index for reconciliation queries
CREATE INDEX IF NOT EXISTS transactions_reconciliation_status_idx ON public.transactions (reconciliation_status, created_at);
CREATE INDEX IF NOT EXISTS transactions_provider_reference_idx ON public.transactions (provider_reference) WHERE provider_reference IS NOT NULL;

-- 7. Row Level Security Policies

-- Enable RLS for new tables
ALTER TABLE public.reservation_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fraud_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suspicious_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_availability ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (tenant-scoped access)
CREATE POLICY "tenant_access_reservation_locks" ON public.reservation_locks
  FOR ALL USING (tenant_id::text = current_setting('jwt.claims.tenant_id', true));

CREATE POLICY "tenant_access_idempotency_keys" ON public.idempotency_keys
  FOR ALL USING (tenant_id::text = current_setting('jwt.claims.tenant_id', true));

CREATE POLICY "tenant_access_fraud_assessments" ON public.fraud_assessments
  FOR ALL USING (tenant_id::text = current_setting('jwt.claims.tenant_id', true));

CREATE POLICY "tenant_access_suspicious_activities" ON public.suspicious_activities
  FOR ALL USING (tenant_id::text = current_setting('jwt.claims.tenant_id', true));

CREATE POLICY "tenant_access_staff_availability" ON public.staff_availability
  FOR ALL USING (tenant_id::text = current_setting('jwt.claims.tenant_id', true));

-- 8. Functions for automated cleanup

-- Function to cleanup expired reservation locks
CREATE OR REPLACE FUNCTION cleanup_expired_reservation_locks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.reservation_locks 
  WHERE expires_at < now();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Function to cleanup old idempotency keys (older than 48 hours)
CREATE OR REPLACE FUNCTION cleanup_old_idempotency_keys()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.idempotency_keys 
  WHERE created_at < now() - interval '48 hours';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Function to calculate booking conflict rate
CREATE OR REPLACE FUNCTION calculate_booking_conflict_rate(tenant_uuid uuid, days_back integer DEFAULT 7)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_bookings integer;
  conflicts integer;
BEGIN
  -- Get total bookings in the period
  SELECT COUNT(*) INTO total_bookings
  FROM public.reservations
  WHERE tenant_id = tenant_uuid
    AND created_at >= now() - (days_back || ' days')::interval;
  
  -- Count conflicts (simplified - check for overlapping reservations)
  SELECT COUNT(*) INTO conflicts
  FROM public.reservations r1
  INNER JOIN public.reservations r2 ON (
    r1.tenant_id = r2.tenant_id 
    AND r1.id != r2.id
    AND r1.start_at < r2.end_at 
    AND r1.end_at > r2.start_at
    AND r1.staff_id = r2.staff_id
  )
  WHERE r1.tenant_id = tenant_uuid
    AND r1.created_at >= now() - (days_back || ' days')::interval;
  
  -- Return conflict rate as percentage
  IF total_bookings = 0 THEN
    RETURN 0;
  END IF;
  
  RETURN (conflicts::numeric / total_bookings::numeric) * 100;
END;
$$;

-- 9. Triggers for automated updates

-- Trigger to update updated_at on staff_availability
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_staff_availability_updated_at
  BEFORE UPDATE ON public.staff_availability
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 10. Insert default risk management configuration
INSERT INTO public.platform_settings_kv (key, value) 
VALUES (
  'risk_management_config',
  '{
    "max_chargeback_rate": 0.005,
    "max_reconciliation_drift": 0.001,
    "fraud_detection_enabled": true,
    "auto_refund_threshold": 5000,
    "webhook_signature_validation": true,
    "idempotency_window_hours": 24,
    "double_booking_prevention": true,
    "lock_timeout_minutes": 10
  }'::jsonb
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;