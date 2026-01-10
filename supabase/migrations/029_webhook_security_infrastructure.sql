-- Webhook Events Storage and Security Tables
-- This migration creates the infrastructure for secure webhook handling

-- Create webhook_events table for storing all incoming webhook events
CREATE TABLE webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    signature VARCHAR(500) NOT NULL,
    payload JSONB NOT NULL,
    metadata JSONB,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMP WITH TIME ZONE,
    processing_error TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create unique index to prevent duplicate event processing
CREATE UNIQUE INDEX idx_webhook_events_unique ON webhook_events (event_id, provider);

-- Create indexes for efficient querying
CREATE INDEX idx_webhook_events_provider ON webhook_events (provider);
CREATE INDEX idx_webhook_events_type ON webhook_events (event_type);
CREATE INDEX idx_webhook_events_received_at ON webhook_events (received_at);
CREATE INDEX idx_webhook_events_processed ON webhook_events (processed);

-- Create webhook_security_log for tracking security events
CREATE TABLE webhook_security_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL,
    event_type VARCHAR(100),
    security_event VARCHAR(100) NOT NULL, -- 'signature_failed', 'replay_attack', 'rate_limit', 'duplicate', etc.
    ip_address INET,
    user_agent TEXT,
    headers JSONB,
    payload_hash VARCHAR(64), -- SHA256 hash of payload for forensics
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    blocked BOOLEAN DEFAULT FALSE,
    metadata JSONB
);

-- Create indexes for security log
CREATE INDEX idx_webhook_security_log_provider ON webhook_security_log (provider);
CREATE INDEX idx_webhook_security_log_event ON webhook_security_log (security_event);
CREATE INDEX idx_webhook_security_log_timestamp ON webhook_security_log (timestamp);
CREATE INDEX idx_webhook_security_log_blocked ON webhook_security_log (blocked);
CREATE INDEX idx_webhook_security_log_ip ON webhook_security_log (ip_address);

-- Create webhook_rate_limits table for tracking rate limiting
CREATE TABLE webhook_rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL,
    ip_address INET,
    window_start TIMESTAMP WITH TIME ZONE NOT NULL,
    window_end TIMESTAMP WITH TIME ZONE NOT NULL,
    request_count INTEGER DEFAULT 1,
    limit_exceeded BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for rate limiting
CREATE INDEX idx_webhook_rate_limits_provider ON webhook_rate_limits (provider);
CREATE INDEX idx_webhook_rate_limits_ip ON webhook_rate_limits (ip_address);
CREATE INDEX idx_webhook_rate_limits_window ON webhook_rate_limits (window_start, window_end);

-- Create webhook_secrets table for secure secret management
CREATE TABLE webhook_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL UNIQUE,
    secret_hash VARCHAR(64) NOT NULL, -- SHA256 hash of the secret
    algorithm VARCHAR(20) NOT NULL DEFAULT 'sha256',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_rotated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    active BOOLEAN DEFAULT TRUE,
    metadata JSONB
);

-- Create webhook_replay_protection table for timestamp-based replay protection
CREATE TABLE webhook_replay_protection (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL,
    timestamp_value BIGINT NOT NULL,
    signature_hash VARCHAR(64) NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Create unique index to prevent replay attacks
CREATE UNIQUE INDEX idx_webhook_replay_unique ON webhook_replay_protection (provider, signature_hash);
CREATE INDEX idx_webhook_replay_expires ON webhook_replay_protection (expires_at);

-- Add RLS (Row Level Security) policies for webhook tables
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_security_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_replay_protection ENABLE ROW LEVEL SECURITY;

-- Create policies for webhook_events (admin and service role access)
CREATE POLICY "webhook_events_admin_access" ON webhook_events
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM tenant_users tu
            JOIN tenants t ON tu.tenant_id = t.id
            WHERE tu.user_id = auth.uid()
            AND tu.role IN ('admin', 'superadmin')
        )
    );

-- Service role has full access to webhook_events
CREATE POLICY "webhook_events_service_access" ON webhook_events
    FOR ALL USING (auth.role() = 'service_role');

-- Similar policies for other webhook tables
CREATE POLICY "webhook_security_log_admin_access" ON webhook_security_log
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM tenant_users tu
            JOIN tenants t ON tu.tenant_id = t.id
            WHERE tu.user_id = auth.uid()
            AND tu.role IN ('admin', 'superadmin')
        )
    );

CREATE POLICY "webhook_security_log_service_access" ON webhook_security_log
    FOR ALL USING (auth.role() = 'service_role');

-- Webhook secrets should only be accessible by service role
CREATE POLICY "webhook_secrets_service_only" ON webhook_secrets
    FOR ALL USING (auth.role() = 'service_role');

-- Create functions for webhook event processing
CREATE OR REPLACE FUNCTION mark_webhook_processed(event_uuid UUID, success BOOLEAN, error_message TEXT DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
    UPDATE webhook_events 
    SET 
        processed = success,
        processed_at = NOW(),
        processing_error = CASE WHEN success THEN NULL ELSE error_message END,
        updated_at = NOW()
    WHERE id = event_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clean up old webhook events
CREATE OR REPLACE FUNCTION cleanup_webhook_events(retention_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM webhook_events 
    WHERE received_at < NOW() - INTERVAL '1 day' * retention_days;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clean up expired replay protection entries
CREATE OR REPLACE FUNCTION cleanup_replay_protection()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM webhook_replay_protection 
    WHERE expires_at < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log security events
CREATE OR REPLACE FUNCTION log_webhook_security_event(
    p_provider VARCHAR(50),
    p_event_type VARCHAR(100),
    p_security_event VARCHAR(100),
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_headers JSONB DEFAULT NULL,
    p_payload_hash VARCHAR(64) DEFAULT NULL,
    p_blocked BOOLEAN DEFAULT FALSE,
    p_metadata JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    event_id UUID;
BEGIN
    INSERT INTO webhook_security_log (
        provider, event_type, security_event, ip_address, user_agent,
        headers, payload_hash, blocked, metadata
    ) VALUES (
        p_provider, p_event_type, p_security_event, p_ip_address, p_user_agent,
        p_headers, p_payload_hash, p_blocked, p_metadata
    ) RETURNING id INTO event_id;
    
    RETURN event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check and update rate limits
CREATE OR REPLACE FUNCTION check_webhook_rate_limit(
    p_provider VARCHAR(50),
    p_ip_address INET,
    p_limit INTEGER DEFAULT 100,
    p_window_minutes INTEGER DEFAULT 1
)
RETURNS BOOLEAN AS $$
DECLARE
    current_count INTEGER;
    window_start TIMESTAMP WITH TIME ZONE;
    window_end TIMESTAMP WITH TIME ZONE;
BEGIN
    window_start := DATE_TRUNC('minute', NOW()) - INTERVAL '1 minute' * (p_window_minutes - 1);
    window_end := DATE_TRUNC('minute', NOW()) + INTERVAL '1 minute';
    
    -- Get current count for this window
    SELECT COALESCE(SUM(request_count), 0) INTO current_count
    FROM webhook_rate_limits
    WHERE provider = p_provider
    AND ip_address = p_ip_address
    AND window_start >= window_start
    AND window_end <= window_end;
    
    -- Check if limit exceeded
    IF current_count >= p_limit THEN
        -- Log rate limit exceeded
        INSERT INTO webhook_rate_limits (
            provider, ip_address, window_start, window_end, 
            request_count, limit_exceeded
        ) VALUES (
            p_provider, p_ip_address, window_start, window_end,
            1, TRUE
        );
        RETURN FALSE;
    END IF;
    
    -- Update or insert rate limit record
    INSERT INTO webhook_rate_limits (
        provider, ip_address, window_start, window_end, request_count
    ) VALUES (
        p_provider, p_ip_address, window_start, window_end, 1
    )
    ON CONFLICT (provider, ip_address, window_start, window_end)
    DO UPDATE SET 
        request_count = webhook_rate_limits.request_count + 1,
        limit_exceeded = CASE 
            WHEN webhook_rate_limits.request_count + 1 >= p_limit THEN TRUE
            ELSE FALSE
        END;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create scheduled job for cleanup (requires pg_cron extension)
-- SELECT cron.schedule('webhook-cleanup', '0 2 * * *', 'SELECT cleanup_webhook_events(30);');
-- SELECT cron.schedule('replay-protection-cleanup', '*/15 * * * *', 'SELECT cleanup_replay_protection();');

-- Add comments for documentation
COMMENT ON TABLE webhook_events IS 'Stores all incoming webhook events with security validation';
COMMENT ON TABLE webhook_security_log IS 'Logs security events and potential threats for webhook endpoints';
COMMENT ON TABLE webhook_rate_limits IS 'Tracks rate limiting for webhook endpoints by provider and IP';
COMMENT ON TABLE webhook_secrets IS 'Securely manages webhook secrets with rotation support';
COMMENT ON TABLE webhook_replay_protection IS 'Prevents replay attacks using timestamp and signature tracking';

COMMENT ON FUNCTION mark_webhook_processed IS 'Marks a webhook event as processed with optional error logging';
COMMENT ON FUNCTION cleanup_webhook_events IS 'Removes old webhook events based on retention policy';
COMMENT ON FUNCTION cleanup_replay_protection IS 'Removes expired replay protection entries';
COMMENT ON FUNCTION log_webhook_security_event IS 'Logs security events for audit and monitoring';
COMMENT ON FUNCTION check_webhook_rate_limit IS 'Checks and enforces rate limits for webhook endpoints';