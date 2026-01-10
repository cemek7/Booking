/**
 * Database Migration: Create Audit Logs Table
 * 
 * This migration creates the audit_logs table with proper indexes and constraints
 * for efficient logging and querying of audit events.
 */

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    event_type TEXT NOT NULL,
    user_id UUID,
    user_role TEXT,
    tenant_id UUID,
    session_id TEXT,
    ip_address INET,
    user_agent TEXT,
    resource TEXT NOT NULL,
    action TEXT NOT NULL,
    permission TEXT NOT NULL,
    context JSONB DEFAULT '{}'::jsonb,
    result JSONB NOT NULL,
    security_level TEXT NOT NULL DEFAULT 'medium',
    compliance_flags TEXT[] DEFAULT ARRAY[]::TEXT[],
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT audit_logs_event_type_check 
        CHECK (event_type IN (
            'permission_check',
            'role_change', 
            'access_granted',
            'access_denied',
            'security_violation',
            'privilege_escalation',
            'cross_tenant_access',
            'admin_action',
            'system_modification',
            'data_access',
            'authentication_event'
        )),
        
    CONSTRAINT audit_logs_security_level_check
        CHECK (security_level IN ('low', 'medium', 'high', 'critical')),
        
    CONSTRAINT audit_logs_user_role_check
        CHECK (user_role IN ('staff', 'manager', 'owner', 'superadmin', 'unknown'))
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp 
    ON audit_logs(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id 
    ON audit_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id 
    ON audit_logs(tenant_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type 
    ON audit_logs(event_type);

CREATE INDEX IF NOT EXISTS idx_audit_logs_security_level 
    ON audit_logs(security_level);

CREATE INDEX IF NOT EXISTS idx_audit_logs_compliance_flags 
    ON audit_logs USING GIN(compliance_flags);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_tenant 
    ON audit_logs(user_id, tenant_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp_event 
    ON audit_logs(timestamp DESC, event_type);

-- Create partial indexes for common security queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_violations 
    ON audit_logs(timestamp DESC) 
    WHERE event_type = 'security_violation';

CREATE INDEX IF NOT EXISTS idx_audit_logs_critical 
    ON audit_logs(timestamp DESC) 
    WHERE security_level = 'critical';

CREATE INDEX IF NOT EXISTS idx_audit_logs_failed_access 
    ON audit_logs(timestamp DESC, user_id, ip_address) 
    WHERE (result->>'status') = 'failure';

-- Create composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_compliance_period 
    ON audit_logs(compliance_flags, timestamp DESC) 
    WHERE array_length(compliance_flags, 1) > 0;

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_period 
    ON audit_logs(tenant_id, timestamp DESC);

-- Create JSONB indexes for efficient context and result queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_context_gin 
    ON audit_logs USING GIN(context);

CREATE INDEX IF NOT EXISTS idx_audit_logs_result_gin 
    ON audit_logs USING GIN(result);

-- Add comments for documentation
COMMENT ON TABLE audit_logs IS 'Comprehensive audit logging for all permission checks and security events';
COMMENT ON COLUMN audit_logs.event_type IS 'Type of audit event being logged';
COMMENT ON COLUMN audit_logs.user_id IS 'ID of the user performing the action';
COMMENT ON COLUMN audit_logs.user_role IS 'Role of the user at the time of the action';
COMMENT ON COLUMN audit_logs.tenant_id IS 'Tenant context for the action';
COMMENT ON COLUMN audit_logs.context IS 'Additional context information for the event';
COMMENT ON COLUMN audit_logs.result IS 'Result of the permission check or action';
COMMENT ON COLUMN audit_logs.security_level IS 'Security classification of the event';
COMMENT ON COLUMN audit_logs.compliance_flags IS 'Compliance standards that apply to this event';

-- Enable Row Level Security (RLS)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for audit logs
-- Superadmins can see all audit logs
CREATE POLICY "Superadmins can view all audit logs" ON audit_logs
    FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM admins 
            WHERE user_id = auth.uid() 
            AND is_active = true
        )
    );

-- Tenant owners can see their tenant's audit logs
CREATE POLICY "Tenant owners can view tenant audit logs" ON audit_logs
    FOR SELECT 
    USING (
        tenant_id IN (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            AND role = 'owner'
        )
    );

-- Users can see their own audit events (limited fields)
CREATE POLICY "Users can view own audit events" ON audit_logs
    FOR SELECT 
    USING (user_id = auth.uid());

-- Only system can insert audit logs
CREATE POLICY "System can insert audit logs" ON audit_logs
    FOR INSERT 
    WITH CHECK (true);

-- No updates or deletes allowed (audit log immutability)
CREATE POLICY "No updates allowed" ON audit_logs
    FOR UPDATE 
    USING (false);

CREATE POLICY "No deletes allowed" ON audit_logs
    FOR DELETE 
    USING (false);

-- Create view for security dashboard
CREATE OR REPLACE VIEW security_dashboard AS
SELECT 
    DATE_TRUNC('day', timestamp) as date,
    tenant_id,
    COUNT(*) as total_events,
    COUNT(CASE WHEN event_type = 'security_violation' THEN 1 END) as violations,
    COUNT(CASE WHEN security_level = 'critical' THEN 1 END) as critical_events,
    COUNT(CASE WHEN (result->>'status') = 'failure' THEN 1 END) as failed_access,
    COUNT(DISTINCT user_id) as unique_users,
    COUNT(DISTINCT ip_address) as unique_ips,
    AVG((result->>'securityScore')::numeric) as avg_security_score
FROM audit_logs
WHERE timestamp >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', timestamp), tenant_id
ORDER BY date DESC;

-- Grant access to the view
GRANT SELECT ON security_dashboard TO authenticated;

-- Create function for audit log cleanup (for data retention)
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs(retention_days INTEGER DEFAULT 2555) -- 7 years default
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM audit_logs 
    WHERE timestamp < NOW() - (retention_days || ' days')::INTERVAL
    AND security_level != 'critical'; -- Never delete critical security events
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to system
GRANT EXECUTE ON FUNCTION cleanup_old_audit_logs TO service_role;

-- Create function for generating compliance reports
CREATE OR REPLACE FUNCTION get_compliance_summary(
    p_tenant_id UUID,
    p_compliance_flag TEXT,
    p_start_date TIMESTAMP WITH TIME ZONE,
    p_end_date TIMESTAMP WITH TIME ZONE
) RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'period', json_build_object(
            'start', p_start_date,
            'end', p_end_date
        ),
        'standard', p_compliance_flag,
        'totalEvents', COUNT(*),
        'securityViolations', COUNT(CASE WHEN event_type = 'security_violation' THEN 1 END),
        'highRiskEvents', COUNT(CASE WHEN (result->>'riskLevel') IN ('high', 'critical') THEN 1 END),
        'failedAccessAttempts', COUNT(CASE WHEN (result->>'status') = 'failure' THEN 1 END),
        'privilegeEscalations', COUNT(CASE WHEN event_type = 'privilege_escalation' THEN 1 END),
        'complianceScore', CASE 
            WHEN COUNT(*) = 0 THEN 100
            ELSE GREATEST(0, 100 - (COUNT(CASE WHEN event_type = 'security_violation' OR security_level = 'critical' THEN 1 END) * 100.0 / COUNT(*))::INTEGER)
        END
    )
    INTO result
    FROM audit_logs
    WHERE tenant_id = p_tenant_id
    AND timestamp BETWEEN p_start_date AND p_end_date
    AND (p_compliance_flag = ANY(compliance_flags) OR p_compliance_flag IS NULL);
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_compliance_summary TO authenticated;

-- Create notification function for critical security events
CREATE OR REPLACE FUNCTION notify_critical_security_event()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.security_level = 'critical' OR NEW.event_type = 'security_violation' THEN
        PERFORM pg_notify(
            'critical_security_event',
            json_build_object(
                'audit_log_id', NEW.id,
                'event_type', NEW.event_type,
                'user_id', NEW.user_id,
                'tenant_id', NEW.tenant_id,
                'timestamp', NEW.timestamp,
                'security_level', NEW.security_level
            )::TEXT
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for critical event notifications
CREATE TRIGGER trigger_notify_critical_security_event
    AFTER INSERT ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION notify_critical_security_event();

-- Create materialized view for performance analytics
CREATE MATERIALIZED VIEW audit_analytics AS
SELECT 
    tenant_id,
    DATE_TRUNC('hour', timestamp) as hour,
    event_type,
    security_level,
    COUNT(*) as event_count,
    COUNT(DISTINCT user_id) as unique_users,
    COUNT(DISTINCT ip_address) as unique_ips,
    AVG((result->>'securityScore')::numeric) as avg_security_score,
    COUNT(CASE WHEN (result->>'status') = 'failure' THEN 1 END) as failed_events,
    COUNT(CASE WHEN (result->>'requiresReview')::boolean = true THEN 1 END) as review_required
FROM audit_logs
WHERE timestamp >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY tenant_id, DATE_TRUNC('hour', timestamp), event_type, security_level;

-- Create unique index on materialized view
CREATE UNIQUE INDEX idx_audit_analytics_unique 
    ON audit_analytics(tenant_id, hour, event_type, security_level);

-- Grant access to materialized view
GRANT SELECT ON audit_analytics TO authenticated;

-- Create function to refresh analytics
CREATE OR REPLACE FUNCTION refresh_audit_analytics()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY audit_analytics;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION refresh_audit_analytics TO service_role;