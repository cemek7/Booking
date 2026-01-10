-- Observability Infrastructure - Production Grade
-- This migration creates comprehensive observability and monitoring tables

-- Create metrics storage table
CREATE TABLE metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name VARCHAR(255) NOT NULL,
    metric_value DECIMAL(20,6) NOT NULL,
    metric_type VARCHAR(50) NOT NULL CHECK (metric_type IN ('counter', 'gauge', 'histogram', 'summary')),
    labels JSONB DEFAULT '{}',
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    service_name VARCHAR(100),
    host_name VARCHAR(255),
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '90 days')
);

-- Create indexes for efficient metric querying
CREATE INDEX idx_metrics_name ON metrics (metric_name);
CREATE INDEX idx_metrics_recorded_at ON metrics (recorded_at);
CREATE INDEX idx_metrics_service ON metrics (service_name);
CREATE INDEX idx_metrics_tenant ON metrics (tenant_id);
CREATE INDEX idx_metrics_name_time ON metrics (metric_name, recorded_at);
CREATE INDEX idx_metrics_labels_gin ON metrics USING GIN (labels);
CREATE INDEX idx_metrics_expires ON metrics (expires_at) WHERE expires_at IS NOT NULL;

-- Create partitioned table for high-volume metrics
CREATE TABLE metrics_hourly (
    LIKE metrics INCLUDING ALL
) PARTITION BY RANGE (recorded_at);

-- Create business metrics table for KPIs
CREATE TABLE business_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name VARCHAR(255) NOT NULL,
    metric_value DECIMAL(20,6) NOT NULL,
    labels JSONB DEFAULT '{}',
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for business metrics
CREATE INDEX idx_business_metrics_name ON business_metrics (metric_name);
CREATE INDEX idx_business_metrics_recorded_at ON business_metrics (recorded_at);
CREATE INDEX idx_business_metrics_tenant ON business_metrics (tenant_id);
CREATE INDEX idx_business_metrics_name_time ON business_metrics (metric_name, recorded_at);

-- Create system metrics table for infrastructure monitoring
CREATE TABLE system_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name VARCHAR(255) NOT NULL,
    metric_value JSONB NOT NULL, -- Stores complex system metrics as JSON
    labels JSONB DEFAULT '{}',
    host_name VARCHAR(255) NOT NULL,
    service_name VARCHAR(100),
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '30 days')
);

-- Create indexes for system metrics
CREATE INDEX idx_system_metrics_host ON system_metrics (host_name);
CREATE INDEX idx_system_metrics_service ON system_metrics (service_name);
CREATE INDEX idx_system_metrics_recorded_at ON system_metrics (recorded_at);
CREATE INDEX idx_system_metrics_expires ON system_metrics (expires_at) WHERE expires_at IS NOT NULL;

-- Create traces table for distributed tracing
CREATE TABLE traces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id VARCHAR(255) NOT NULL,
    span_id VARCHAR(255) NOT NULL,
    parent_span_id VARCHAR(255),
    operation_name VARCHAR(255) NOT NULL,
    service_name VARCHAR(100),
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE,
    duration_ms INTEGER,
    status VARCHAR(20) CHECK (status IN ('success', 'error', 'timeout', 'cancelled')),
    tags JSONB DEFAULT '{}',
    logs JSONB DEFAULT '[]',
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days')
);

-- Create indexes for trace querying
CREATE INDEX idx_traces_trace_id ON traces (trace_id);
CREATE INDEX idx_traces_span_id ON traces (span_id);
CREATE INDEX idx_traces_parent_span ON traces (parent_span_id);
CREATE INDEX idx_traces_operation ON traces (operation_name);
CREATE INDEX idx_traces_service ON traces (service_name);
CREATE INDEX idx_traces_start_time ON traces (start_time);
CREATE INDEX idx_traces_duration ON traces (duration_ms) WHERE duration_ms IS NOT NULL;
CREATE INDEX idx_traces_status ON traces (status);
CREATE INDEX idx_traces_tenant ON traces (tenant_id);
CREATE INDEX idx_traces_expires ON traces (expires_at) WHERE expires_at IS NOT NULL;

-- Create unique constraint for spans
CREATE UNIQUE INDEX idx_traces_span_unique ON traces (trace_id, span_id);

-- Create alert_rules table for monitoring alerts
CREATE TABLE alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    metric VARCHAR(255) NOT NULL,
    threshold DECIMAL(20,6) NOT NULL,
    operator VARCHAR(10) NOT NULL CHECK (operator IN ('gt', 'lt', 'eq', 'gte', 'lte', 'ne')),
    duration INTEGER NOT NULL DEFAULT 300, -- Duration in seconds before alerting
    severity VARCHAR(20) NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical', 'emergency')),
    enabled BOOLEAN DEFAULT TRUE,
    channels TEXT[] DEFAULT '{}', -- Alert channels (email, slack, webhook, etc.)
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for alert rules
CREATE INDEX idx_alert_rules_metric ON alert_rules (metric);
CREATE INDEX idx_alert_rules_enabled ON alert_rules (enabled) WHERE enabled = TRUE;
CREATE INDEX idx_alert_rules_tenant ON alert_rules (tenant_id);
CREATE INDEX idx_alert_rules_severity ON alert_rules (severity);

-- Create alert_events table for fired alerts
CREATE TABLE alert_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    metric_name VARCHAR(255) NOT NULL,
    current_value DECIMAL(20,6) NOT NULL,
    threshold DECIMAL(20,6) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'firing' CHECK (status IN ('firing', 'resolved', 'acknowledged', 'suppressed')),
    severity VARCHAR(20) NOT NULL,
    message TEXT,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    acknowledged_by UUID REFERENCES auth.users(id),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for alert events
CREATE INDEX idx_alert_events_rule ON alert_events (rule_id);
CREATE INDEX idx_alert_events_status ON alert_events (status);
CREATE INDEX idx_alert_events_severity ON alert_events (severity);
CREATE INDEX idx_alert_events_started_at ON alert_events (started_at);
CREATE INDEX idx_alert_events_tenant ON alert_events (tenant_id);

-- Create performance_metrics table for application performance monitoring
CREATE TABLE performance_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    status_code INTEGER NOT NULL,
    response_time_ms INTEGER NOT NULL,
    request_size_bytes INTEGER,
    response_size_bytes INTEGER,
    user_id UUID REFERENCES auth.users(id),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_agent TEXT,
    ip_address INET,
    referer TEXT,
    session_id VARCHAR(255),
    trace_id VARCHAR(255),
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '30 days')
);

-- Create indexes for performance metrics
CREATE INDEX idx_performance_endpoint ON performance_metrics (endpoint);
CREATE INDEX idx_performance_method ON performance_metrics (method);
CREATE INDEX idx_performance_status ON performance_metrics (status_code);
CREATE INDEX idx_performance_response_time ON performance_metrics (response_time_ms);
CREATE INDEX idx_performance_recorded_at ON performance_metrics (recorded_at);
CREATE INDEX idx_performance_tenant ON performance_metrics (tenant_id);
CREATE INDEX idx_performance_trace ON performance_metrics (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX idx_performance_expires ON performance_metrics (expires_at) WHERE expires_at IS NOT NULL;

-- Create error_logs table for centralized error logging
CREATE TABLE error_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level VARCHAR(20) NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error', 'fatal')),
    message TEXT NOT NULL,
    error_code VARCHAR(50),
    stack_trace TEXT,
    context JSONB DEFAULT '{}',
    user_id UUID REFERENCES auth.users(id),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    service_name VARCHAR(100),
    host_name VARCHAR(255),
    request_id VARCHAR(255),
    trace_id VARCHAR(255),
    session_id VARCHAR(255),
    user_agent TEXT,
    ip_address INET,
    url TEXT,
    method VARCHAR(10),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '90 days')
);

-- Create indexes for error logs
CREATE INDEX idx_error_logs_level ON error_logs (level);
CREATE INDEX idx_error_logs_created_at ON error_logs (created_at);
CREATE INDEX idx_error_logs_service ON error_logs (service_name);
CREATE INDEX idx_error_logs_tenant ON error_logs (tenant_id);
CREATE INDEX idx_error_logs_user ON error_logs (user_id);
CREATE INDEX idx_error_logs_trace ON error_logs (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX idx_error_logs_request ON error_logs (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX idx_error_logs_expires ON error_logs (expires_at) WHERE expires_at IS NOT NULL;

-- Create health_check table for service health monitoring
CREATE TABLE health_check (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('healthy', 'degraded', 'unhealthy', 'unknown')),
    check_name VARCHAR(100) NOT NULL,
    check_result JSONB NOT NULL,
    response_time_ms INTEGER,
    host_name VARCHAR(255),
    version VARCHAR(50),
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '24 hours')
);

-- Create indexes for health check
CREATE INDEX idx_health_check_service ON health_check (service_name);
CREATE INDEX idx_health_check_status ON health_check (status);
CREATE INDEX idx_health_check_checked_at ON health_check (checked_at);
CREATE INDEX idx_health_check_expires ON health_check (expires_at) WHERE expires_at IS NOT NULL;
CREATE UNIQUE INDEX idx_health_check_unique ON health_check (service_name, check_name, host_name, checked_at);

-- Create uptime_metrics table for service availability tracking
CREATE TABLE uptime_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_name VARCHAR(100) NOT NULL,
    endpoint VARCHAR(255),
    status_code INTEGER,
    response_time_ms INTEGER,
    is_available BOOLEAN NOT NULL DEFAULT FALSE,
    error_message TEXT,
    host_name VARCHAR(255),
    region VARCHAR(50),
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '30 days')
);

-- Create indexes for uptime metrics
CREATE INDEX idx_uptime_service ON uptime_metrics (service_name);
CREATE INDEX idx_uptime_endpoint ON uptime_metrics (endpoint);
CREATE INDEX idx_uptime_available ON uptime_metrics (is_available);
CREATE INDEX idx_uptime_checked_at ON uptime_metrics (checked_at);
CREATE INDEX idx_uptime_response_time ON uptime_metrics (response_time_ms);
CREATE INDEX idx_uptime_expires ON uptime_metrics (expires_at) WHERE expires_at IS NOT NULL;

-- Enable RLS on observability tables
ALTER TABLE metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptime_metrics ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for tenant isolation and service access
CREATE POLICY "metrics_tenant_isolation" ON metrics
    FOR ALL USING (
        tenant_id = (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            LIMIT 1
        ) OR tenant_id IS NULL OR auth.role() = 'service_role'
    );

CREATE POLICY "business_metrics_tenant_isolation" ON business_metrics
    FOR ALL USING (
        tenant_id = (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            LIMIT 1
        ) OR auth.role() = 'service_role'
    );

CREATE POLICY "traces_tenant_isolation" ON traces
    FOR ALL USING (
        tenant_id = (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            LIMIT 1
        ) OR tenant_id IS NULL OR auth.role() = 'service_role'
    );

CREATE POLICY "alert_rules_tenant_isolation" ON alert_rules
    FOR ALL USING (
        tenant_id = (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            LIMIT 1
        ) OR auth.role() = 'service_role'
    );

CREATE POLICY "alert_events_tenant_isolation" ON alert_events
    FOR ALL USING (
        tenant_id = (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            LIMIT 1
        ) OR auth.role() = 'service_role'
    );

CREATE POLICY "performance_metrics_tenant_isolation" ON performance_metrics
    FOR ALL USING (
        tenant_id = (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            LIMIT 1
        ) OR tenant_id IS NULL OR auth.role() = 'service_role'
    );

CREATE POLICY "error_logs_tenant_isolation" ON error_logs
    FOR ALL USING (
        tenant_id = (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            LIMIT 1
        ) OR tenant_id IS NULL OR auth.role() = 'service_role'
    );

-- Service role and admin access
CREATE POLICY "system_metrics_service_access" ON system_metrics
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "health_check_service_access" ON health_check
    FOR ALL USING (auth.role() = 'service_role' OR 
        EXISTS (
            SELECT 1 FROM tenant_users tu
            WHERE tu.user_id = auth.uid()
            AND tu.role IN ('admin', 'superadmin')
        )
    );

CREATE POLICY "uptime_metrics_service_access" ON uptime_metrics
    FOR ALL USING (auth.role() = 'service_role' OR 
        EXISTS (
            SELECT 1 FROM tenant_users tu
            WHERE tu.user_id = auth.uid()
            AND tu.role IN ('admin', 'superadmin')
        )
    );

-- ===============================
-- STORED PROCEDURES
-- ===============================

-- Function to aggregate metrics over time periods
CREATE OR REPLACE FUNCTION aggregate_metrics(
    p_metric_name VARCHAR(255),
    p_time_window INTERVAL DEFAULT INTERVAL '1 hour',
    p_aggregation_type VARCHAR(20) DEFAULT 'avg'
)
RETURNS TABLE (
    time_bucket TIMESTAMP WITH TIME ZONE,
    metric_value DECIMAL(20,6),
    sample_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    EXECUTE format('
        SELECT 
            date_trunc(''hour'', recorded_at) as time_bucket,
            %s(metric_value) as metric_value,
            COUNT(*) as sample_count
        FROM metrics 
        WHERE metric_name = %L
        AND recorded_at >= NOW() - %L
        GROUP BY date_trunc(''hour'', recorded_at)
        ORDER BY time_bucket DESC',
        p_aggregation_type, p_metric_name, p_time_window
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get service health summary
CREATE OR REPLACE FUNCTION get_service_health_summary(
    p_service_name VARCHAR(100) DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'services', jsonb_agg(
            jsonb_build_object(
                'service_name', service_name,
                'overall_status', overall_status,
                'checks', checks,
                'last_check', last_check,
                'uptime_percent', uptime_percent
            )
        )
    ) INTO result
    FROM (
        SELECT 
            hc.service_name,
            CASE 
                WHEN COUNT(*) FILTER (WHERE hc.status = 'unhealthy') > 0 THEN 'unhealthy'
                WHEN COUNT(*) FILTER (WHERE hc.status = 'degraded') > 0 THEN 'degraded'
                ELSE 'healthy'
            END as overall_status,
            jsonb_agg(
                jsonb_build_object(
                    'check_name', hc.check_name,
                    'status', hc.status,
                    'response_time_ms', hc.response_time_ms,
                    'checked_at', hc.checked_at
                )
            ) as checks,
            MAX(hc.checked_at) as last_check,
            (
                SELECT COALESCE(
                    AVG(CASE WHEN um.is_available THEN 100.0 ELSE 0.0 END), 0
                ) 
                FROM uptime_metrics um 
                WHERE um.service_name = hc.service_name
                AND um.checked_at >= NOW() - INTERVAL '24 hours'
            ) as uptime_percent
        FROM health_check hc
        WHERE (p_service_name IS NULL OR hc.service_name = p_service_name)
        AND hc.checked_at >= NOW() - INTERVAL '1 hour'
        GROUP BY hc.service_name
    ) health_summary;
    
    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get performance insights
CREATE OR REPLACE FUNCTION get_performance_insights(
    p_time_window INTERVAL DEFAULT INTERVAL '1 hour',
    p_tenant_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'request_metrics', jsonb_build_object(
            'total_requests', COUNT(*),
            'avg_response_time', AVG(response_time_ms),
            'p95_response_time', PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms),
            'p99_response_time', PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms),
            'error_rate', AVG(CASE WHEN status_code >= 400 THEN 1.0 ELSE 0.0 END),
            'slowest_endpoints', (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'endpoint', endpoint,
                        'avg_response_time', avg_response_time,
                        'request_count', request_count
                    )
                )
                FROM (
                    SELECT 
                        endpoint,
                        AVG(response_time_ms) as avg_response_time,
                        COUNT(*) as request_count
                    FROM performance_metrics pm2
                    WHERE pm2.recorded_at >= NOW() - p_time_window
                    AND (p_tenant_id IS NULL OR pm2.tenant_id = p_tenant_id)
                    GROUP BY endpoint
                    ORDER BY avg_response_time DESC
                    LIMIT 10
                ) slow_endpoints
            )
        ),
        'error_analysis', jsonb_build_object(
            'total_errors', (
                SELECT COUNT(*) 
                FROM error_logs el 
                WHERE el.created_at >= NOW() - p_time_window
                AND (p_tenant_id IS NULL OR el.tenant_id = p_tenant_id)
            ),
            'error_distribution', (
                SELECT jsonb_object_agg(level, error_count)
                FROM (
                    SELECT level, COUNT(*) as error_count
                    FROM error_logs el2
                    WHERE el2.created_at >= NOW() - p_time_window
                    AND (p_tenant_id IS NULL OR el2.tenant_id = p_tenant_id)
                    GROUP BY level
                ) error_dist
            ),
            'top_errors', (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'message', message,
                        'count', error_count,
                        'last_seen', last_seen
                    )
                )
                FROM (
                    SELECT 
                        message,
                        COUNT(*) as error_count,
                        MAX(created_at) as last_seen
                    FROM error_logs el3
                    WHERE el3.created_at >= NOW() - p_time_window
                    AND (p_tenant_id IS NULL OR el3.tenant_id = p_tenant_id)
                    GROUP BY message
                    ORDER BY error_count DESC
                    LIMIT 10
                ) top_errors
            )
        )
    ) INTO result
    FROM performance_metrics pm
    WHERE pm.recorded_at >= NOW() - p_time_window
    AND (p_tenant_id IS NULL OR pm.tenant_id = p_tenant_id);
    
    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cleanup expired observability data
CREATE OR REPLACE FUNCTION cleanup_observability_data()
RETURNS TABLE (
    table_name TEXT,
    deleted_rows BIGINT
) AS $$
DECLARE
    deleted_count BIGINT;
    table_record RECORD;
BEGIN
    -- Tables with expiry columns
    FOR table_record IN 
        SELECT t.table_name 
        FROM information_schema.tables t
        JOIN information_schema.columns c ON t.table_name = c.table_name
        WHERE t.table_schema = 'public'
        AND c.column_name = 'expires_at'
        AND t.table_name IN ('metrics', 'system_metrics', 'traces', 'performance_metrics', 'error_logs', 'health_check', 'uptime_metrics')
    LOOP
        EXECUTE format('DELETE FROM %I WHERE expires_at IS NOT NULL AND expires_at < NOW()', table_record.table_name);
        GET DIAGNOSTICS deleted_count = ROW_COUNT;
        
        RETURN QUERY SELECT table_record.table_name::TEXT, deleted_count;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to calculate SLA metrics
CREATE OR REPLACE FUNCTION calculate_sla_metrics(
    p_service_name VARCHAR(100),
    p_time_window INTERVAL DEFAULT INTERVAL '24 hours'
)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'service_name', p_service_name,
        'time_window', p_time_window,
        'availability_percent', COALESCE(
            AVG(CASE WHEN is_available THEN 100.0 ELSE 0.0 END), 0
        ),
        'avg_response_time_ms', AVG(response_time_ms),
        'total_checks', COUNT(*),
        'successful_checks', COUNT(*) FILTER (WHERE is_available = true),
        'failed_checks', COUNT(*) FILTER (WHERE is_available = false),
        'incidents', (
            SELECT COUNT(DISTINCT date_trunc('hour', checked_at))
            FROM uptime_metrics um2
            WHERE um2.service_name = p_service_name
            AND um2.checked_at >= NOW() - p_time_window
            AND um2.is_available = false
        )
    ) INTO result
    FROM uptime_metrics um
    WHERE um.service_name = p_service_name
    AND um.checked_at >= NOW() - p_time_window;
    
    RETURN COALESCE(result, jsonb_build_object('service_name', p_service_name, 'availability_percent', 0));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===============================
-- TRIGGERS
-- ===============================

-- Trigger to update alert rule timestamp
CREATE OR REPLACE FUNCTION update_alert_rule_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_alert_rule_timestamp
    BEFORE UPDATE ON alert_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_alert_rule_timestamp();

-- ===============================
-- INDEXES FOR PERFORMANCE
-- ===============================

-- Create additional specialized indexes for time-series queries
CREATE INDEX idx_metrics_name_time_value ON metrics (metric_name, recorded_at DESC, metric_value);
CREATE INDEX idx_traces_operation_duration ON traces (operation_name, duration_ms DESC) WHERE duration_ms IS NOT NULL;
CREATE INDEX idx_performance_endpoint_time ON performance_metrics (endpoint, recorded_at DESC);
CREATE INDEX idx_error_logs_level_time ON error_logs (level, created_at DESC);

-- ===============================
-- COMMENTS
-- ===============================

COMMENT ON TABLE metrics IS 'General metrics storage for application and infrastructure monitoring';
COMMENT ON TABLE business_metrics IS 'Business KPIs and domain-specific metrics';
COMMENT ON TABLE system_metrics IS 'System-level infrastructure metrics';
COMMENT ON TABLE traces IS 'Distributed tracing data for request flow analysis';
COMMENT ON TABLE alert_rules IS 'Alert rules configuration for monitoring thresholds';
COMMENT ON TABLE alert_events IS 'Fired alert events and their lifecycle';
COMMENT ON TABLE performance_metrics IS 'Application performance monitoring data';
COMMENT ON TABLE error_logs IS 'Centralized error logging across all services';
COMMENT ON TABLE health_check IS 'Service health check results';
COMMENT ON TABLE uptime_metrics IS 'Service availability and uptime tracking';

COMMENT ON FUNCTION aggregate_metrics IS 'Aggregate metrics over configurable time windows';
COMMENT ON FUNCTION get_service_health_summary IS 'Get comprehensive health summary for services';
COMMENT ON FUNCTION get_performance_insights IS 'Get performance insights and analysis';
COMMENT ON FUNCTION cleanup_observability_data IS 'Clean up expired observability data';
COMMENT ON FUNCTION calculate_sla_metrics IS 'Calculate SLA metrics for service availability';