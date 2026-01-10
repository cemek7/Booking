-- Migration 027: Advanced scheduler optimization and security enhancements
-- Date: 2025-11-21

-- Staff working hours and availability
CREATE TABLE IF NOT EXISTS public.staff_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  day_of_week integer NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6), -- 0=Sunday, 6=Saturday
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, user_id, day_of_week)
);

-- Precomputed availability slots for performance optimization
CREATE TABLE IF NOT EXISTS public.availability_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  staff_id uuid,
  slot_date date NOT NULL,
  slot_time time NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 60,
  is_available boolean DEFAULT true,
  reservation_id uuid REFERENCES public.reservations(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, staff_id, slot_date, slot_time, duration_minutes)
);

-- Security audit log for sensitive operations
CREATE TABLE IF NOT EXISTS public.security_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  ip_address inet,
  user_agent text,
  request_id text,
  success boolean NOT NULL,
  failure_reason text,
  sensitive_data_accessed boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- PII data classification and encryption tracking
CREATE TABLE IF NOT EXISTS public.pii_data_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  column_name text NOT NULL,
  data_type text NOT NULL CHECK (data_type IN ('email', 'phone', 'name', 'address', 'financial', 'medical', 'other')),
  encryption_method text,
  retention_days integer,
  last_scan_at timestamptz,
  compliance_level text CHECK (compliance_level IN ('public', 'internal', 'confidential', 'restricted')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (table_name, column_name)
);

-- Automated security rules and violations
CREATE TABLE IF NOT EXISTS public.security_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name text NOT NULL,
  rule_type text NOT NULL CHECK (rule_type IN ('access_control', 'data_classification', 'audit_trail', 'encryption', 'retention')),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  condition_sql text NOT NULL, -- SQL query that defines the rule
  remediation_text text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.security_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.security_rules(id),
  tenant_id uuid REFERENCES public.tenants(id),
  violation_details jsonb NOT NULL,
  severity text NOT NULL,
  status text DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'false_positive')),
  assigned_to uuid,
  resolved_at timestamptz,
  resolution_notes text,
  detected_at timestamptz DEFAULT now()
);

-- Enhanced job management with retry policies and dead letter queue
ALTER TABLE public.jobs 
  ADD COLUMN IF NOT EXISTS job_class text DEFAULT 'generic',
  ADD COLUMN IF NOT EXISTS priority integer DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
  ADD COLUMN IF NOT EXISTS max_retries integer DEFAULT 3,
  ADD COLUMN IF NOT EXISTS retry_delay_seconds integer DEFAULT 60,
  ADD COLUMN IF NOT EXISTS dead_letter_at timestamptz,
  ADD COLUMN IF NOT EXISTS context jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS timeout_seconds integer DEFAULT 300;

-- Enable RLS for new tables
ALTER TABLE IF EXISTS public.staff_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.availability_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.security_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pii_data_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.security_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.security_violations ENABLE ROW LEVEL SECURITY;

-- Tenant scoping policies
DROP POLICY IF EXISTS staff_schedules_tenant ON public.staff_schedules;
CREATE POLICY staff_schedules_tenant ON public.staff_schedules
  FOR ALL
  TO authenticated
  USING (tenant_id::text = current_setting('request.jwt.claims.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('request.jwt.claims.tenant_id', true));

DROP POLICY IF EXISTS availability_slots_tenant ON public.availability_slots;
CREATE POLICY availability_slots_tenant ON public.availability_slots
  FOR ALL
  TO authenticated
  USING (tenant_id::text = current_setting('request.jwt.claims.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('request.jwt.claims.tenant_id', true));

DROP POLICY IF EXISTS security_audit_log_tenant ON public.security_audit_log;
CREATE POLICY security_audit_log_tenant ON public.security_audit_log
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IS NULL OR 
    tenant_id::text = current_setting('request.jwt.claims.tenant_id', true)
  );

-- Service role access for all security tables
DROP POLICY IF EXISTS staff_schedules_service ON public.staff_schedules;
CREATE POLICY staff_schedules_service ON public.staff_schedules
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS availability_slots_service ON public.availability_slots;  
CREATE POLICY availability_slots_service ON public.availability_slots
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS security_audit_log_service ON public.security_audit_log;
CREATE POLICY security_audit_log_service ON public.security_audit_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS pii_data_registry_service ON public.pii_data_registry;
CREATE POLICY pii_data_registry_service ON public.pii_data_registry
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS security_rules_service ON public.security_rules;
CREATE POLICY security_rules_service ON public.security_rules
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS security_violations_service ON public.security_violations;
CREATE POLICY security_violations_service ON public.security_violations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS staff_schedules_tenant_user_idx ON public.staff_schedules (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS availability_slots_tenant_date_idx ON public.availability_slots (tenant_id, slot_date, is_available);
CREATE INDEX IF NOT EXISTS availability_slots_staff_date_idx ON public.availability_slots (staff_id, slot_date, slot_time);
CREATE INDEX IF NOT EXISTS security_audit_log_tenant_action_idx ON public.security_audit_log (tenant_id, action, created_at);
CREATE INDEX IF NOT EXISTS security_violations_status_severity_idx ON public.security_violations (status, severity, detected_at);
CREATE INDEX IF NOT EXISTS jobs_class_priority_idx ON public.jobs (job_class, priority, status, scheduled_at);
CREATE INDEX IF NOT EXISTS jobs_dead_letter_idx ON public.jobs (dead_letter_at) WHERE dead_letter_at IS NOT NULL;

-- Function to generate availability slots for a date range
CREATE OR REPLACE FUNCTION generate_availability_slots(
  p_tenant_id uuid,
  p_staff_id uuid,
  p_start_date date,
  p_end_date date,
  p_slot_duration_minutes integer DEFAULT 60
) RETURNS void AS $$
DECLARE
  current_date date := p_start_date;
  schedule_row record;
  slot_time time;
  end_time time;
BEGIN
  WHILE current_date <= p_end_date LOOP
    -- Get staff schedule for this day of week
    SELECT start_time, end_time INTO schedule_row
    FROM public.staff_schedules 
    WHERE tenant_id = p_tenant_id 
      AND user_id = p_staff_id 
      AND day_of_week = EXTRACT(dow FROM current_date)
      AND is_active = true;
      
    IF FOUND THEN
      slot_time := schedule_row.start_time;
      end_time := schedule_row.end_time;
      
      -- Generate slots for the day
      WHILE slot_time + (p_slot_duration_minutes || ' minutes')::interval <= end_time LOOP
        INSERT INTO public.availability_slots (
          tenant_id, 
          staff_id, 
          slot_date, 
          slot_time, 
          duration_minutes,
          is_available
        ) VALUES (
          p_tenant_id,
          p_staff_id,
          current_date,
          slot_time,
          p_slot_duration_minutes,
          true
        ) ON CONFLICT (tenant_id, staff_id, slot_date, slot_time, duration_minutes) 
        DO UPDATE SET updated_at = now();
        
        slot_time := slot_time + (p_slot_duration_minutes || ' minutes')::interval;
      END LOOP;
    END IF;
    
    current_date := current_date + 1;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to automatically update availability when reservations change
CREATE OR REPLACE FUNCTION update_availability_on_reservation_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Mark slot as unavailable for new/updated reservations
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE public.availability_slots 
    SET is_available = false, 
        reservation_id = NEW.id,
        updated_at = now()
    WHERE tenant_id = NEW.tenant_id
      AND staff_id = NEW.staff_id
      AND slot_date = NEW.start_at::date
      AND slot_time = NEW.start_at::time
      AND duration_minutes = EXTRACT(epoch FROM (NEW.end_at - NEW.start_at))/60;
  END IF;
  
  -- Free up slot for deleted/cancelled reservations
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.status = 'cancelled') THEN
    UPDATE public.availability_slots 
    SET is_available = true, 
        reservation_id = null,
        updated_at = now()
    WHERE tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
      AND staff_id = COALESCE(NEW.staff_id, OLD.staff_id)
      AND reservation_id = COALESCE(NEW.id, OLD.id);
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger for automatic availability updates
DROP TRIGGER IF EXISTS trigger_update_availability ON public.reservations;
CREATE TRIGGER trigger_update_availability
  AFTER INSERT OR UPDATE OR DELETE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION update_availability_on_reservation_change();

-- Add trigger for updated_at on new tables
CREATE TRIGGER update_staff_schedules_updated_at
  BEFORE UPDATE ON public.staff_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_availability_slots_updated_at
  BEFORE UPDATE ON public.availability_slots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_security_rules_updated_at
  BEFORE UPDATE ON public.security_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();