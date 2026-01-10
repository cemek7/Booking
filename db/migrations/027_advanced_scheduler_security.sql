-- Migration 027: Advanced Scheduler Optimization & Security Automation
-- Created for Week 4+ implementation

-- ========================================
-- ADVANCED SCHEDULER OPTIMIZATION TABLES
-- ========================================

-- Staff working hours with timezone support
CREATE TABLE IF NOT EXISTS staff_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  timezone VARCHAR(255) DEFAULT 'UTC',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(staff_id, day_of_week)
);

-- Precomputed availability slots for O(1) scheduling
CREATE TABLE IF NOT EXISTS availability_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  slot_type VARCHAR(50) NOT NULL DEFAULT 'regular',
  is_available BOOLEAN NOT NULL DEFAULT true,
  confidence_score DECIMAL(5,4) DEFAULT 1.0000,
  booking_density DECIMAL(5,4) DEFAULT 0.0000,
  priority_boost DECIMAL(5,4) DEFAULT 0.0000,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT availability_slots_time_range_check CHECK (start_time < end_time)
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_availability_slots_staff_time 
ON availability_slots (staff_id, start_time, end_time) 
WHERE is_available = true;

-- ========================================
-- SECURITY AUTOMATION INFRASTRUCTURE
-- ========================================

-- PII data registry for compliance tracking
CREATE TABLE IF NOT EXISTS pii_data_registry (
  table_name VARCHAR(255) NOT NULL,
  column_name VARCHAR(255) NOT NULL,
  data_type VARCHAR(50) NOT NULL,
  encryption_method VARCHAR(100),
  retention_days INTEGER,
  compliance_level VARCHAR(50) NOT NULL,
  last_scan_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (table_name, column_name)
);

-- Security audit logging
CREATE TABLE IF NOT EXISTS security_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES auth.users(id),
  action VARCHAR(255) NOT NULL,
  resource_type VARCHAR(255) NOT NULL,
  resource_id VARCHAR(255),
  ip_address INET,
  user_agent TEXT,
  request_id VARCHAR(255),
  success BOOLEAN NOT NULL,
  failure_reason TEXT,
  sensitive_data_accessed BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for audit log queries
CREATE INDEX IF NOT EXISTS idx_security_audit_tenant_time 
ON security_audit_log (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_security_audit_action 
ON security_audit_log (action, created_at);

-- Dynamic security rules engine
CREATE TABLE IF NOT EXISTS security_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name VARCHAR(255) UNIQUE NOT NULL,
  rule_type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  condition_sql TEXT NOT NULL,
  remediation_text TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Security violation tracking
CREATE TABLE IF NOT EXISTS security_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES security_rules(id),
  tenant_id UUID REFERENCES tenants(id),
  violation_details JSONB NOT NULL,
  severity VARCHAR(20) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'open',
  detected_at TIMESTAMP WITH TIME ZONE NOT NULL,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for violation queries
CREATE INDEX IF NOT EXISTS idx_security_violations_status 
ON security_violations (status, severity, detected_at);

-- ========================================
-- ENHANCED JOB MANAGEMENT
-- ========================================

-- Enhanced jobs table with advanced retry policies
-- Note: Update existing jobs table or create new enhanced_jobs table
DO $$ 
BEGIN 
    -- Add new columns to existing jobs table if they don't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'priority') THEN
        ALTER TABLE jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 5;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'max_retries') THEN
        ALTER TABLE jobs ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 3;
        ALTER TABLE jobs ADD COLUMN retry_delay_ms INTEGER NOT NULL DEFAULT 1000;
        ALTER TABLE jobs ADD COLUMN retry_backoff_multiplier DECIMAL(3,2) NOT NULL DEFAULT 2.0;
        ALTER TABLE jobs ADD COLUMN timeout_ms INTEGER NOT NULL DEFAULT 30000;
        ALTER TABLE jobs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE jobs ADD COLUMN error_message TEXT;
        ALTER TABLE jobs ADD COLUMN name VARCHAR(255);
        ALTER TABLE jobs ADD COLUMN handler VARCHAR(255);
        ALTER TABLE jobs ADD COLUMN tenant_id UUID REFERENCES tenants(id);
    END IF;
    
    -- Update status enum to include dead_letter
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status_enhanced') THEN
        CREATE TYPE job_status_enhanced AS ENUM ('pending', 'running', 'completed', 'failed', 'dead_letter');
        ALTER TABLE jobs ALTER COLUMN status TYPE job_status_enhanced USING status::job_status_enhanced;
    END IF;
END $$;

-- Index for job processing
CREATE INDEX IF NOT EXISTS idx_jobs_processing 
ON jobs (status, priority DESC, scheduled_at ASC) 
WHERE status IN ('pending', 'failed');

-- ========================================
-- AUTOMATED FUNCTIONS AND TRIGGERS
-- ========================================

-- Function to generate availability slots
CREATE OR REPLACE FUNCTION generate_availability_slots(
  p_staff_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_slot_duration_minutes INTEGER DEFAULT 60
) RETURNS INTEGER AS $$
DECLARE
  slot_count INTEGER := 0;
  current_date DATE;
  schedule_record RECORD;
  slot_start TIMESTAMP WITH TIME ZONE;
  slot_end TIMESTAMP WITH TIME ZONE;
  day_end TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Clear existing slots for the date range
  DELETE FROM availability_slots 
  WHERE staff_id = p_staff_id 
    AND start_time::date BETWEEN p_start_date AND p_end_date;
  
  -- Generate slots for each day in range
  current_date := p_start_date;
  WHILE current_date <= p_end_date LOOP
    -- Get schedule for current day of week (Sunday = 0, Monday = 1, etc.)
    SELECT * INTO schedule_record
    FROM staff_schedules 
    WHERE staff_id = p_staff_id 
      AND day_of_week = EXTRACT(DOW FROM current_date)
      AND is_active = true;
    
    IF FOUND THEN
      -- Create slots for this day
      slot_start := current_date + schedule_record.start_time;
      day_end := current_date + schedule_record.end_time;
      
      WHILE slot_start + (p_slot_duration_minutes || ' minutes')::interval <= day_end LOOP
        slot_end := slot_start + (p_slot_duration_minutes || ' minutes')::interval;
        
        -- Insert availability slot
        INSERT INTO availability_slots (
          staff_id,
          start_time,
          end_time,
          slot_type,
          is_available,
          confidence_score
        ) VALUES (
          p_staff_id,
          slot_start,
          slot_end,
          'regular',
          true,
          1.0000
        );
        
        slot_count := slot_count + 1;
        slot_start := slot_end;
      END LOOP;
    END IF;
    
    current_date := current_date + 1;
  END LOOP;
  
  RETURN slot_count;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update availability when staff schedules change
CREATE OR REPLACE FUNCTION update_availability_on_schedule_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Regenerate availability for next 30 days when schedule changes
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    PERFORM generate_availability_slots(
      NEW.staff_id,
      CURRENT_DATE,
      CURRENT_DATE + INTERVAL '30 days',
      60  -- 1-hour slots by default
    );
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_update_availability ON staff_schedules;
CREATE TRIGGER trigger_update_availability
  AFTER INSERT OR UPDATE ON staff_schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_availability_on_schedule_change();

-- ========================================
-- ENABLE ROW LEVEL SECURITY
-- ========================================

-- Enable RLS on new tables
ALTER TABLE staff_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_violations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for staff_schedules
CREATE POLICY staff_schedules_tenant_isolation ON staff_schedules
  FOR ALL USING (
    staff_id IN (
      SELECT id FROM staff WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    )
  );

-- RLS Policies for availability_slots  
CREATE POLICY availability_slots_tenant_isolation ON availability_slots
  FOR ALL USING (
    staff_id IN (
      SELECT id FROM staff WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    )
  );

-- RLS Policies for security tables
CREATE POLICY security_audit_tenant_isolation ON security_audit_log
  FOR ALL USING (
    tenant_id = current_setting('app.current_tenant_id', true)::uuid
    OR current_setting('app.current_tenant_id', true) = ''
  );

CREATE POLICY security_rules_global_read ON security_rules
  FOR SELECT USING (true);

CREATE POLICY security_violations_tenant_isolation ON security_violations
  FOR ALL USING (
    tenant_id = current_setting('app.current_tenant_id', true)::uuid
    OR current_setting('app.current_tenant_id', true) = ''
  );

-- ========================================
-- SAMPLE DATA FOR TESTING
-- ========================================

-- Insert some default security rules
INSERT INTO security_rules (rule_name, rule_type, severity, condition_sql, remediation_text) VALUES
  (
    'Unencrypted PII Data',
    'data_classification',
    'high',
    'SELECT table_name, column_name FROM pii_data_registry WHERE data_type IN (''email'', ''phone'', ''financial'') AND (encryption_method IS NULL OR encryption_method = '''')',
    'Enable encryption for PII columns using column-level encryption'
  ),
  (
    'Excessive Failed Login Attempts',
    'access_control', 
    'medium',
    'SELECT user_id, ip_address, COUNT(*) as failed_attempts FROM security_audit_log WHERE action = ''login_attempt'' AND success = false AND created_at > now() - interval ''15 minutes'' GROUP BY user_id, ip_address HAVING COUNT(*) >= 5',
    'Temporarily block IP address and notify user of suspicious activity'
  ),
  (
    'Privileged Access Without MFA',
    'access_control',
    'critical',
    'SELECT user_id, action FROM security_audit_log WHERE action IN (''admin_login'', ''owner_action'', ''global_admin_access'') AND created_at > now() - interval ''1 hour'' AND user_agent NOT LIKE ''%mfa_verified%''',
    'Require MFA for all privileged operations'
  )
ON CONFLICT (rule_name) DO NOTHING;

-- Insert some default PII data registry entries
INSERT INTO pii_data_registry (table_name, column_name, data_type, compliance_level) VALUES
  ('customers', 'customer_name', 'name', 'confidential'),
  ('customers', 'phone_number', 'phone', 'confidential'),
  ('tenant_users', 'email', 'email', 'confidential'),
  ('tenant_users', 'name', 'name', 'confidential'),
  ('messages', 'from_number', 'phone', 'confidential'),
  ('messages', 'to_number', 'phone', 'confidential')
ON CONFLICT (table_name, column_name) DO NOTHING;

-- Migration completed
SELECT 'Migration 027: Advanced Scheduler Optimization & Security Automation completed' AS status;