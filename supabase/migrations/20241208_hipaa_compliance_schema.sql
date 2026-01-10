-- HIPAA Compliance Database Schema
-- Tables for managing PHI access logs, patient consents, and encrypted medical data

-- PHI Access Logs for audit trail
CREATE TABLE phi_access_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    patient_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL CHECK (action IN ('view', 'create', 'update', 'delete', 'print', 'export')),
    data_type VARCHAR(50) NOT NULL CHECK (data_type IN ('appointment', 'medical_record', 'prescription', 'image', 'document')),
    accessed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ip_address INET NOT NULL,
    user_agent TEXT NOT NULL,
    justification TEXT,
    session_id UUID NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    INDEX idx_phi_logs_patient (patient_id),
    INDEX idx_phi_logs_user (user_id),
    INDEX idx_phi_logs_accessed (accessed_at),
    INDEX idx_phi_logs_tenant (tenant_id),
    INDEX idx_phi_logs_action (action),
    INDEX idx_phi_logs_data_type (data_type)
);

-- Row Level Security for PHI Access Logs
ALTER TABLE phi_access_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "phi_access_logs_tenant_isolation" ON phi_access_logs
    FOR ALL USING (tenant_id IN (
        SELECT tenant_id FROM user_tenant_roles 
        WHERE user_id = auth.uid()
    ));

-- Patient Consents
CREATE TABLE patient_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL,
    consent_type VARCHAR(50) NOT NULL CHECK (consent_type IN ('treatment', 'data_sharing', 'research', 'marketing')),
    granted BOOLEAN NOT NULL,
    granted_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    document_url TEXT,
    witness_signature TEXT,
    patient_signature TEXT NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    INDEX idx_patient_consents_patient (patient_id),
    INDEX idx_patient_consents_tenant (tenant_id),
    INDEX idx_patient_consents_type (consent_type),
    INDEX idx_patient_consents_granted (granted),
    
    CONSTRAINT valid_granted_revoked CHECK (
        (granted = true AND granted_at IS NOT NULL) OR
        (granted = false AND granted_at IS NULL)
    )
);

-- Row Level Security for Patient Consents
ALTER TABLE patient_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patient_consents_tenant_isolation" ON patient_consents
    FOR ALL USING (tenant_id IN (
        SELECT tenant_id FROM user_tenant_roles 
        WHERE user_id = auth.uid()
    ));

-- Encrypted Medical Data Storage
CREATE TABLE encrypted_medical_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL,
    data_type VARCHAR(100) NOT NULL,
    encrypted_data TEXT NOT NULL,
    encryption_key_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    accessed_count INTEGER NOT NULL DEFAULT 0,
    last_accessed TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    retention_period_days INTEGER NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE GENERATED ALWAYS AS (created_at + INTERVAL '1 day' * retention_period_days) STORED,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    INDEX idx_encrypted_data_patient (patient_id),
    INDEX idx_encrypted_data_tenant (tenant_id),
    INDEX idx_encrypted_data_type (data_type),
    INDEX idx_encrypted_data_expires (expires_at),
    INDEX idx_encrypted_data_last_accessed (last_accessed)
);

-- Row Level Security for Encrypted Medical Data
ALTER TABLE encrypted_medical_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "encrypted_medical_data_tenant_isolation" ON encrypted_medical_data
    FOR ALL USING (tenant_id IN (
        SELECT tenant_id FROM user_tenant_roles 
        WHERE user_id = auth.uid()
    ));

-- Security Incidents Tracking
CREATE TABLE security_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    description TEXT NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    affected_users INTEGER DEFAULT 0,
    affected_records INTEGER DEFAULT 0,
    ip_address INET,
    user_agent TEXT,
    user_id UUID REFERENCES auth.users(id),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    INDEX idx_security_incidents_occurred (occurred_at),
    INDEX idx_security_incidents_severity (severity),
    INDEX idx_security_incidents_tenant (tenant_id),
    INDEX idx_security_incidents_type (incident_type),
    INDEX idx_security_incidents_resolved (resolved_at)
);

-- Row Level Security for Security Incidents
ALTER TABLE security_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "security_incidents_tenant_isolation" ON security_incidents
    FOR ALL USING (tenant_id IN (
        SELECT tenant_id FROM user_tenant_roles 
        WHERE user_id = auth.uid()
    ));

-- Audit Trail for Data Changes
CREATE TABLE data_audit_trail (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(100) NOT NULL,
    record_id UUID NOT NULL,
    operation VARCHAR(20) NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    old_values JSONB,
    new_values JSONB,
    changed_by UUID NOT NULL REFERENCES auth.users(id),
    changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT,
    session_id UUID,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    
    INDEX idx_audit_trail_table (table_name),
    INDEX idx_audit_trail_record (record_id),
    INDEX idx_audit_trail_changed (changed_at),
    INDEX idx_audit_trail_user (changed_by),
    INDEX idx_audit_trail_tenant (tenant_id)
);

-- Row Level Security for Audit Trail
ALTER TABLE data_audit_trail ENABLE ROW LEVEL SECURITY;

CREATE POLICY "data_audit_trail_tenant_isolation" ON data_audit_trail
    FOR ALL USING (tenant_id IN (
        SELECT tenant_id FROM user_tenant_roles 
        WHERE user_id = auth.uid()
    ));

-- Data Retention Policies
CREATE TABLE data_retention_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_type VARCHAR(100) NOT NULL,
    retention_period_days INTEGER NOT NULL,
    auto_delete BOOLEAN DEFAULT FALSE,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(data_type, tenant_id),
    INDEX idx_retention_policies_tenant (tenant_id),
    INDEX idx_retention_policies_type (data_type)
);

-- Row Level Security for Data Retention Policies
ALTER TABLE data_retention_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "data_retention_policies_tenant_isolation" ON data_retention_policies
    FOR ALL USING (tenant_id IN (
        SELECT tenant_id FROM user_tenant_roles 
        WHERE user_id = auth.uid()
    ));

-- Compliance Reports
CREATE TABLE compliance_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_type VARCHAR(100) NOT NULL,
    period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    generated_by UUID NOT NULL REFERENCES auth.users(id),
    report_data JSONB NOT NULL,
    report_url TEXT,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    
    INDEX idx_compliance_reports_type (report_type),
    INDEX idx_compliance_reports_period (period_start, period_end),
    INDEX idx_compliance_reports_tenant (tenant_id),
    INDEX idx_compliance_reports_generated (generated_at)
);

-- Row Level Security for Compliance Reports
ALTER TABLE compliance_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compliance_reports_tenant_isolation" ON compliance_reports
    FOR ALL USING (tenant_id IN (
        SELECT tenant_id FROM user_tenant_roles 
        WHERE user_id = auth.uid()
    ));

-- Functions and Triggers for Audit Trail

-- Function to capture audit trail
CREATE OR REPLACE FUNCTION capture_audit_trail()
RETURNS TRIGGER AS $$
DECLARE
    tenant_uuid UUID;
    user_uuid UUID;
BEGIN
    -- Get current user and tenant
    user_uuid := auth.uid();
    
    -- Get tenant_id from the record if available
    IF TG_OP = 'DELETE' THEN
        tenant_uuid := OLD.tenant_id;
    ELSE
        tenant_uuid := NEW.tenant_id;
    END IF;
    
    -- Only audit if we have a valid user and tenant
    IF user_uuid IS NOT NULL AND tenant_uuid IS NOT NULL THEN
        INSERT INTO data_audit_trail (
            table_name,
            record_id,
            operation,
            old_values,
            new_values,
            changed_by,
            tenant_id
        ) VALUES (
            TG_TABLE_NAME,
            CASE 
                WHEN TG_OP = 'DELETE' THEN OLD.id
                ELSE NEW.id
            END,
            TG_OP,
            CASE WHEN TG_OP != 'INSERT' THEN row_to_json(OLD) END,
            CASE WHEN TG_OP != 'DELETE' THEN row_to_json(NEW) END,
            user_uuid,
            tenant_uuid
        );
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply audit trail triggers to key tables
CREATE TRIGGER audit_trigger_bookings
    AFTER INSERT OR UPDATE OR DELETE ON bookings
    FOR EACH ROW EXECUTE FUNCTION capture_audit_trail();

CREATE TRIGGER audit_trigger_patients
    AFTER INSERT OR UPDATE OR DELETE ON patients
    FOR EACH ROW EXECUTE FUNCTION capture_audit_trail();

CREATE TRIGGER audit_trigger_encrypted_medical_data
    AFTER INSERT OR UPDATE OR DELETE ON encrypted_medical_data
    FOR EACH ROW EXECUTE FUNCTION capture_audit_trail();

CREATE TRIGGER audit_trigger_patient_consents
    AFTER INSERT OR UPDATE OR DELETE ON patient_consents
    FOR EACH ROW EXECUTE FUNCTION capture_audit_trail();

-- Function to automatically delete expired data
CREATE OR REPLACE FUNCTION cleanup_expired_data()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER := 0;
BEGIN
    -- Delete expired encrypted medical data where auto_delete is enabled
    DELETE FROM encrypted_medical_data 
    WHERE expires_at < NOW()
      AND tenant_id IN (
          SELECT p.tenant_id 
          FROM data_retention_policies p 
          WHERE p.data_type = encrypted_medical_data.data_type 
            AND p.auto_delete = true
      );
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to generate compliance alerts
CREATE OR REPLACE FUNCTION check_compliance_violations()
RETURNS TABLE(
    violation_type VARCHAR,
    severity VARCHAR,
    description TEXT,
    tenant_id UUID
) AS $$
BEGIN
    -- Check for data approaching retention limits
    RETURN QUERY
    SELECT 
        'DATA_RETENTION_WARNING' as violation_type,
        'medium' as severity,
        'Data approaching retention limit: ' || emd.data_type as description,
        emd.tenant_id
    FROM encrypted_medical_data emd
    WHERE emd.expires_at BETWEEN NOW() AND NOW() + INTERVAL '30 days';
    
    -- Check for excessive PHI access
    RETURN QUERY
    SELECT 
        'EXCESSIVE_PHI_ACCESS' as violation_type,
        'high' as severity,
        'User ' || pal.user_id || ' has accessed PHI ' || COUNT(*) || ' times today' as description,
        pal.tenant_id
    FROM phi_access_logs pal
    WHERE pal.accessed_at >= CURRENT_DATE
    GROUP BY pal.user_id, pal.tenant_id
    HAVING COUNT(*) > 50;
    
    -- Check for missing recent consents
    RETURN QUERY
    SELECT 
        'MISSING_CONSENT' as violation_type,
        'high' as severity,
        'Patient missing required consent: ' || pc.patient_id as description,
        pc.tenant_id
    FROM patient_consents pc
    WHERE pc.consent_type = 'treatment'
      AND pc.granted = false
      AND pc.created_at > NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Schedule cleanup job (requires pg_cron extension)
-- SELECT cron.schedule('cleanup-expired-data', '0 2 * * *', 'SELECT cleanup_expired_data();');

-- Create indexes for performance optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_phi_access_logs_composite 
    ON phi_access_logs (tenant_id, accessed_at DESC, user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_encrypted_medical_data_composite 
    ON encrypted_medical_data (tenant_id, patient_id, expires_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_trail_composite 
    ON data_audit_trail (tenant_id, changed_at DESC, table_name);

-- Grant necessary permissions
GRANT SELECT, INSERT ON phi_access_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON patient_consents TO authenticated;
GRANT SELECT, INSERT, UPDATE ON encrypted_medical_data TO authenticated;
GRANT SELECT, INSERT ON security_incidents TO authenticated;
GRANT SELECT ON data_audit_trail TO authenticated;
GRANT SELECT, INSERT, UPDATE ON data_retention_policies TO authenticated;
GRANT SELECT, INSERT ON compliance_reports TO authenticated;