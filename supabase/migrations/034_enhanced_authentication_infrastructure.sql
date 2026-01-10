-- Enhanced Authentication Infrastructure - Production Grade
-- This migration extends authentication with MFA, session management, and security features

-- Create user_authentication_logs table for audit trail
CREATE TABLE user_authentication_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    event_type VARCHAR(50) NOT NULL CHECK (
        event_type IN ('login', 'logout', 'login_failed', 'password_change', 'mfa_setup', 'mfa_verify', 'mfa_failed', 'session_timeout', 'forced_logout', 'password_reset')
    ),
    ip_address INET,
    user_agent TEXT,
    location JSONB, -- Geographic location data
    device_fingerprint VARCHAR(255),
    session_id VARCHAR(255),
    success BOOLEAN DEFAULT TRUE,
    failure_reason VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for authentication logs
CREATE INDEX idx_auth_logs_user ON user_authentication_logs (user_id);
CREATE INDEX idx_auth_logs_tenant ON user_authentication_logs (tenant_id);
CREATE INDEX idx_auth_logs_event_type ON user_authentication_logs (event_type);
CREATE INDEX idx_auth_logs_created_at ON user_authentication_logs (created_at);
CREATE INDEX idx_auth_logs_ip_address ON user_authentication_logs (ip_address);
CREATE INDEX idx_auth_logs_success ON user_authentication_logs (success);

-- Create user_sessions table for enhanced session management
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_token VARCHAR(255) NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    ip_address INET,
    user_agent TEXT,
    device_fingerprint VARCHAR(255),
    location JSONB,
    is_active BOOLEAN DEFAULT TRUE,
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    force_logout BOOLEAN DEFAULT FALSE,
    logout_reason VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for user sessions
CREATE INDEX idx_user_sessions_token ON user_sessions (session_token);
CREATE INDEX idx_user_sessions_user ON user_sessions (user_id);
CREATE INDEX idx_user_sessions_tenant ON user_sessions (tenant_id);
CREATE INDEX idx_user_sessions_active ON user_sessions (is_active) WHERE is_active = TRUE;
CREATE INDEX idx_user_sessions_expires ON user_sessions (expires_at);
CREATE INDEX idx_user_sessions_activity ON user_sessions (last_activity);

-- Create multi_factor_auth table for MFA management
CREATE TABLE multi_factor_auth (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    method VARCHAR(20) NOT NULL CHECK (method IN ('totp', 'sms', 'email', 'backup_codes')),
    is_primary BOOLEAN DEFAULT FALSE,
    is_enabled BOOLEAN DEFAULT TRUE,
    secret_encrypted TEXT, -- Encrypted TOTP secret or phone number
    backup_codes_encrypted TEXT, -- Encrypted backup codes
    verified_at TIMESTAMP WITH TIME ZONE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    failure_count INTEGER DEFAULT 0,
    blocked_until TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for MFA
CREATE INDEX idx_mfa_user ON multi_factor_auth (user_id);
CREATE INDEX idx_mfa_method ON multi_factor_auth (method);
CREATE INDEX idx_mfa_enabled ON multi_factor_auth (is_enabled) WHERE is_enabled = TRUE;
CREATE INDEX idx_mfa_primary ON multi_factor_auth (is_primary) WHERE is_primary = TRUE;
CREATE UNIQUE INDEX idx_mfa_user_method ON multi_factor_auth (user_id, method);

-- Create mfa_verification_attempts table for tracking verification attempts
CREATE TABLE mfa_verification_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    mfa_id UUID NOT NULL REFERENCES multi_factor_auth(id) ON DELETE CASCADE,
    method VARCHAR(20) NOT NULL,
    code_provided VARCHAR(20),
    success BOOLEAN DEFAULT FALSE,
    ip_address INET,
    user_agent TEXT,
    session_id VARCHAR(255),
    failure_reason VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for MFA verification attempts
CREATE INDEX idx_mfa_attempts_user ON mfa_verification_attempts (user_id);
CREATE INDEX idx_mfa_attempts_mfa ON mfa_verification_attempts (mfa_id);
CREATE INDEX idx_mfa_attempts_success ON mfa_verification_attempts (success);
CREATE INDEX idx_mfa_attempts_created_at ON mfa_verification_attempts (created_at);

-- Create password_history table for password policy enforcement
CREATE TABLE password_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for password history
CREATE INDEX idx_password_history_user ON password_history (user_id);
CREATE INDEX idx_password_history_created_at ON password_history (created_at);

-- Create security_settings table for user-specific security configurations
CREATE TABLE security_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    mfa_required BOOLEAN DEFAULT FALSE,
    session_timeout_minutes INTEGER DEFAULT 480, -- 8 hours default
    max_concurrent_sessions INTEGER DEFAULT 3,
    password_expiry_days INTEGER DEFAULT 90,
    require_password_change_on_login BOOLEAN DEFAULT FALSE,
    allowed_ip_ranges TEXT[], -- CIDR ranges
    blocked_ip_ranges TEXT[], -- CIDR ranges
    security_questions JSONB DEFAULT '[]',
    notification_preferences JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for security settings
CREATE INDEX idx_security_settings_user ON security_settings (user_id);
CREATE UNIQUE INDEX idx_security_settings_user_unique ON security_settings (user_id);

-- Create account_lockout table for tracking account lockouts
CREATE TABLE account_lockout (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    lockout_reason VARCHAR(100) NOT NULL CHECK (
        lockout_reason IN ('failed_login_attempts', 'suspicious_activity', 'admin_action', 'password_expired', 'mfa_failures', 'security_policy')
    ),
    locked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    locked_by UUID REFERENCES auth.users(id), -- Admin who locked the account
    unlock_at TIMESTAMP WITH TIME ZONE,
    unlocked_at TIMESTAMP WITH TIME ZONE,
    unlocked_by UUID REFERENCES auth.users(id),
    is_active BOOLEAN DEFAULT TRUE,
    attempts_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for account lockout
CREATE INDEX idx_account_lockout_user ON account_lockout (user_id);
CREATE INDEX idx_account_lockout_active ON account_lockout (is_active) WHERE is_active = TRUE;
CREATE INDEX idx_account_lockout_reason ON account_lockout (lockout_reason);
CREATE INDEX idx_account_lockout_locked_at ON account_lockout (locked_at);

-- Create api_keys table for API authentication
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_id VARCHAR(50) NOT NULL UNIQUE, -- Public key identifier
    key_hash VARCHAR(255) NOT NULL, -- Hashed API key
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    scopes TEXT[] DEFAULT '{}', -- Permissions/scopes for this key
    rate_limit_per_hour INTEGER DEFAULT 1000,
    allowed_ip_ranges TEXT[], -- CIDR ranges
    is_active BOOLEAN DEFAULT TRUE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for API keys
CREATE INDEX idx_api_keys_key_id ON api_keys (key_id);
CREATE INDEX idx_api_keys_user ON api_keys (user_id);
CREATE INDEX idx_api_keys_tenant ON api_keys (tenant_id);
CREATE INDEX idx_api_keys_active ON api_keys (is_active) WHERE is_active = TRUE;
CREATE INDEX idx_api_keys_expires ON api_keys (expires_at);

-- Create api_key_usage table for API usage tracking
CREATE TABLE api_key_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    endpoint VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    request_size_bytes INTEGER,
    response_status INTEGER,
    response_time_ms INTEGER,
    used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for API key usage
CREATE INDEX idx_api_key_usage_key ON api_key_usage (api_key_id);
CREATE INDEX idx_api_key_usage_used_at ON api_key_usage (used_at);
CREATE INDEX idx_api_key_usage_endpoint ON api_key_usage (endpoint);
CREATE INDEX idx_api_key_usage_status ON api_key_usage (response_status);

-- Enable RLS on all authentication tables
ALTER TABLE user_authentication_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE multi_factor_auth ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_verification_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_lockout ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_key_usage ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for user data isolation
CREATE POLICY "user_auth_logs_self_access" ON user_authentication_logs
    FOR ALL USING (
        user_id = auth.uid() OR 
        auth.role() = 'service_role' OR
        EXISTS (
            SELECT 1 FROM tenant_users tu
            WHERE tu.user_id = auth.uid()
            AND tu.role IN ('admin', 'superadmin')
            AND tu.tenant_id = user_authentication_logs.tenant_id
        )
    );

CREATE POLICY "user_sessions_self_access" ON user_sessions
    FOR ALL USING (
        user_id = auth.uid() OR 
        auth.role() = 'service_role' OR
        EXISTS (
            SELECT 1 FROM tenant_users tu
            WHERE tu.user_id = auth.uid()
            AND tu.role IN ('admin', 'superadmin')
            AND tu.tenant_id = user_sessions.tenant_id
        )
    );

CREATE POLICY "mfa_self_access" ON multi_factor_auth
    FOR ALL USING (user_id = auth.uid() OR auth.role() = 'service_role');

CREATE POLICY "mfa_attempts_self_access" ON mfa_verification_attempts
    FOR ALL USING (user_id = auth.uid() OR auth.role() = 'service_role');

CREATE POLICY "password_history_self_access" ON password_history
    FOR ALL USING (user_id = auth.uid() OR auth.role() = 'service_role');

CREATE POLICY "security_settings_self_access" ON security_settings
    FOR ALL USING (user_id = auth.uid() OR auth.role() = 'service_role');

CREATE POLICY "account_lockout_tenant_admin" ON account_lockout
    FOR ALL USING (
        user_id = auth.uid() OR 
        auth.role() = 'service_role' OR
        EXISTS (
            SELECT 1 FROM tenant_users tu
            JOIN tenant_users target_user ON target_user.user_id = account_lockout.user_id
            WHERE tu.user_id = auth.uid()
            AND tu.tenant_id = target_user.tenant_id
            AND tu.role IN ('admin', 'superadmin')
        )
    );

CREATE POLICY "api_keys_tenant_isolation" ON api_keys
    FOR ALL USING (
        user_id = auth.uid() OR 
        auth.role() = 'service_role' OR
        tenant_id = (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            LIMIT 1
        )
    );

CREATE POLICY "api_key_usage_tenant_isolation" ON api_key_usage
    FOR ALL USING (
        auth.role() = 'service_role' OR
        EXISTS (
            SELECT 1 FROM api_keys ak
            WHERE ak.id = api_key_usage.api_key_id
            AND (ak.user_id = auth.uid() OR ak.tenant_id = (
                SELECT tenant_id FROM tenant_users 
                WHERE user_id = auth.uid() 
                LIMIT 1
            ))
        )
    );

-- ===============================
-- STORED PROCEDURES
-- ===============================

-- Function to log authentication events
CREATE OR REPLACE FUNCTION log_authentication_event(
    p_user_id UUID,
    p_event_type VARCHAR(50),
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_success BOOLEAN DEFAULT TRUE,
    p_failure_reason VARCHAR(255) DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
    log_id UUID;
    tenant_id_var UUID;
BEGIN
    -- Get user's tenant_id
    SELECT tu.tenant_id INTO tenant_id_var
    FROM tenant_users tu
    WHERE tu.user_id = p_user_id
    LIMIT 1;
    
    -- Insert authentication log
    INSERT INTO user_authentication_logs (
        user_id, tenant_id, event_type, ip_address, user_agent,
        success, failure_reason, metadata
    ) VALUES (
        p_user_id, tenant_id_var, p_event_type, p_ip_address, p_user_agent,
        p_success, p_failure_reason, p_metadata
    ) RETURNING id INTO log_id;
    
    RETURN log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check account lockout status
CREATE OR REPLACE FUNCTION check_account_lockout(
    p_user_id UUID
)
RETURNS TABLE (
    is_locked BOOLEAN,
    lockout_reason VARCHAR(100),
    locked_at TIMESTAMP WITH TIME ZONE,
    unlock_at TIMESTAMP WITH TIME ZONE,
    attempts_remaining INTEGER
) AS $$
DECLARE
    lockout_record RECORD;
    failed_attempts INTEGER;
    max_attempts INTEGER := 5;
    lockout_duration INTERVAL := INTERVAL '15 minutes';
BEGIN
    -- Check for active lockouts
    SELECT al.lockout_reason, al.locked_at, al.unlock_at, al.attempts_count
    INTO lockout_record
    FROM account_lockout al
    WHERE al.user_id = p_user_id
    AND al.is_active = TRUE
    AND (al.unlock_at IS NULL OR al.unlock_at > NOW())
    ORDER BY al.locked_at DESC
    LIMIT 1;
    
    IF lockout_record IS NOT NULL THEN
        RETURN QUERY SELECT 
            TRUE,
            lockout_record.lockout_reason,
            lockout_record.locked_at,
            lockout_record.unlock_at,
            0;
        RETURN;
    END IF;
    
    -- Check recent failed login attempts
    SELECT COUNT(*)
    INTO failed_attempts
    FROM user_authentication_logs ual
    WHERE ual.user_id = p_user_id
    AND ual.event_type = 'login_failed'
    AND ual.success = FALSE
    AND ual.created_at > NOW() - lockout_duration;
    
    RETURN QUERY SELECT 
        FALSE,
        NULL::VARCHAR(100),
        NULL::TIMESTAMP WITH TIME ZONE,
        NULL::TIMESTAMP WITH TIME ZONE,
        max_attempts - failed_attempts;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to lock user account
CREATE OR REPLACE FUNCTION lock_user_account(
    p_user_id UUID,
    p_reason VARCHAR(100),
    p_duration_minutes INTEGER DEFAULT 15,
    p_locked_by UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    lockout_id UUID;
BEGIN
    INSERT INTO account_lockout (
        user_id, lockout_reason, locked_by, unlock_at, attempts_count
    ) VALUES (
        p_user_id, p_reason, p_locked_by, 
        NOW() + INTERVAL '1 minute' * p_duration_minutes,
        1
    ) RETURNING id INTO lockout_id;
    
    -- Log the lockout event
    PERFORM log_authentication_event(
        p_user_id, 'forced_logout', NULL, NULL, FALSE, p_reason,
        jsonb_build_object('lockout_id', lockout_id, 'duration_minutes', p_duration_minutes)
    );
    
    RETURN lockout_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user security metrics
CREATE OR REPLACE FUNCTION get_user_security_metrics(
    p_user_id UUID,
    p_days_back INTEGER DEFAULT 30
)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'login_count', COUNT(*) FILTER (WHERE event_type = 'login' AND success = TRUE),
        'failed_login_count', COUNT(*) FILTER (WHERE event_type = 'login_failed'),
        'unique_ips', COUNT(DISTINCT ip_address),
        'unique_devices', COUNT(DISTINCT device_fingerprint),
        'mfa_verifications', COUNT(*) FILTER (WHERE event_type = 'mfa_verify' AND success = TRUE),
        'password_changes', COUNT(*) FILTER (WHERE event_type = 'password_change'),
        'lockout_events', COUNT(*) FILTER (WHERE event_type = 'forced_logout'),
        'last_login', MAX(created_at) FILTER (WHERE event_type = 'login' AND success = TRUE),
        'suspicious_activity_score', CASE
            WHEN COUNT(DISTINCT ip_address) > 10 THEN 'high'
            WHEN COUNT(DISTINCT ip_address) > 5 THEN 'medium'
            ELSE 'low'
        END
    ) INTO result
    FROM user_authentication_logs ual
    WHERE ual.user_id = p_user_id
    AND ual.created_at >= NOW() - INTERVAL '1 day' * p_days_back;
    
    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cleanup expired sessions and authentication data
CREATE OR REPLACE FUNCTION cleanup_authentication_data()
RETURNS TABLE (
    table_name TEXT,
    deleted_rows BIGINT
) AS $$
DECLARE
    deleted_count BIGINT;
BEGIN
    -- Clean up expired sessions
    DELETE FROM user_sessions 
    WHERE expires_at < NOW() OR 
    (last_activity < NOW() - INTERVAL '7 days' AND is_active = FALSE);
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN QUERY SELECT 'user_sessions'::TEXT, deleted_count;
    
    -- Clean up old authentication logs (keep for 1 year)
    DELETE FROM user_authentication_logs 
    WHERE created_at < NOW() - INTERVAL '365 days';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN QUERY SELECT 'user_authentication_logs'::TEXT, deleted_count;
    
    -- Clean up old MFA verification attempts (keep for 90 days)
    DELETE FROM mfa_verification_attempts 
    WHERE created_at < NOW() - INTERVAL '90 days';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN QUERY SELECT 'mfa_verification_attempts'::TEXT, deleted_count;
    
    -- Clean up old password history (keep last 5 passwords per user)
    WITH ranked_passwords AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
        FROM password_history
    )
    DELETE FROM password_history 
    WHERE id IN (SELECT id FROM ranked_passwords WHERE rn > 5);
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN QUERY SELECT 'password_history'::TEXT, deleted_count;
    
    -- Clean up old API key usage (keep for 90 days)
    DELETE FROM api_key_usage 
    WHERE used_at < NOW() - INTERVAL '90 days';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN QUERY SELECT 'api_key_usage'::TEXT, deleted_count;
    
    -- Clean up resolved account lockouts (keep for 1 year)
    DELETE FROM account_lockout 
    WHERE is_active = FALSE 
    AND unlocked_at < NOW() - INTERVAL '365 days';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN QUERY SELECT 'account_lockout'::TEXT, deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===============================
-- TRIGGERS
-- ===============================

-- Trigger to update session activity
CREATE OR REPLACE FUNCTION update_session_activity()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    
    -- Update last activity if session is being used
    IF NEW.is_active = TRUE AND OLD.is_active = TRUE THEN
        NEW.last_activity = NOW();
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_session_activity
    BEFORE UPDATE ON user_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_session_activity();

-- Trigger to update security settings timestamp
CREATE OR REPLACE FUNCTION update_security_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_security_settings_timestamp
    BEFORE UPDATE ON security_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_security_settings_timestamp();

-- Trigger to update MFA timestamp
CREATE OR REPLACE FUNCTION update_mfa_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    
    -- Update last used timestamp if being verified
    IF NEW.last_used_at IS NOT NULL AND OLD.last_used_at != NEW.last_used_at THEN
        NEW.last_used_at = NOW();
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_mfa_timestamp
    BEFORE UPDATE ON multi_factor_auth
    FOR EACH ROW
    EXECUTE FUNCTION update_mfa_timestamp();

-- ===============================
-- COMMENTS
-- ===============================

COMMENT ON TABLE user_authentication_logs IS 'Comprehensive audit trail of all authentication events';
COMMENT ON TABLE user_sessions IS 'Enhanced session management with device tracking and security features';
COMMENT ON TABLE multi_factor_auth IS 'Multi-factor authentication configuration per user';
COMMENT ON TABLE mfa_verification_attempts IS 'Tracking of MFA verification attempts for security monitoring';
COMMENT ON TABLE password_history IS 'Password history for policy enforcement';
COMMENT ON TABLE security_settings IS 'Per-user security configuration and preferences';
COMMENT ON TABLE account_lockout IS 'Account lockout management with automated and manual triggers';
COMMENT ON TABLE api_keys IS 'API key management for programmatic access';
COMMENT ON TABLE api_key_usage IS 'API key usage tracking for monitoring and rate limiting';

COMMENT ON FUNCTION log_authentication_event IS 'Log authentication events for audit and security monitoring';
COMMENT ON FUNCTION check_account_lockout IS 'Check if user account is currently locked';
COMMENT ON FUNCTION lock_user_account IS 'Lock user account with specified reason and duration';
COMMENT ON FUNCTION get_user_security_metrics IS 'Get comprehensive security metrics for a user';
COMMENT ON FUNCTION cleanup_authentication_data IS 'Clean up old authentication data for maintenance';