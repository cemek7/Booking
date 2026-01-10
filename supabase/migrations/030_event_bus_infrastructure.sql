-- Event Bus Infrastructure - Production Grade
-- This migration creates the complete event sourcing and outbox pattern infrastructure

-- Create events table for event sourcing
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_id VARCHAR(255) NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    event_version INTEGER NOT NULL DEFAULT 1,
    payload JSONB NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    caused_by VARCHAR(255),
    correlation_id VARCHAR(255),
    tenant_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX idx_events_aggregate ON events (aggregate_id, aggregate_type);
CREATE INDEX idx_events_type ON events (event_type);
CREATE INDEX idx_events_timestamp ON events (timestamp);
CREATE INDEX idx_events_correlation ON events (correlation_id);
CREATE INDEX idx_events_tenant ON events (tenant_id);
CREATE INDEX idx_events_version ON events (aggregate_id, event_version);

-- Create event_outbox table for reliable event delivery
CREATE TABLE event_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    destination VARCHAR(100) NOT NULL DEFAULT 'default',
    payload JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for outbox processing
CREATE INDEX idx_event_outbox_status ON event_outbox (status);
CREATE INDEX idx_event_outbox_pending ON event_outbox (status, created_at) WHERE status = 'pending';
CREATE INDEX idx_event_outbox_retry ON event_outbox (status, next_retry_at) WHERE status = 'failed';
CREATE INDEX idx_event_outbox_event ON event_outbox (event_id);
CREATE INDEX idx_event_outbox_destination ON event_outbox (destination);

-- Create event_processing_log for idempotency tracking
CREATE TABLE event_processing_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    handler_type VARCHAR(100) NOT NULL,
    success BOOLEAN NOT NULL DEFAULT FALSE,
    error TEXT,
    processing_time_ms INTEGER,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create unique index to enforce idempotency per handler
CREATE UNIQUE INDEX idx_event_processing_unique ON event_processing_log (event_id, handler_type) WHERE success = true;
CREATE INDEX idx_event_processing_event ON event_processing_log (event_id);
CREATE INDEX idx_event_processing_handler ON event_processing_log (handler_type);
CREATE INDEX idx_event_processing_time ON event_processing_log (processed_at);

-- Create event_snapshots table for aggregate reconstruction optimization
CREATE TABLE event_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_id VARCHAR(255) NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    version INTEGER NOT NULL,
    snapshot_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for snapshots
CREATE UNIQUE INDEX idx_event_snapshots_aggregate ON event_snapshots (aggregate_id, aggregate_type, version);
CREATE INDEX idx_event_snapshots_type ON event_snapshots (aggregate_type);
CREATE INDEX idx_event_snapshots_created ON event_snapshots (created_at);

-- Create event_subscriptions table for dynamic handler registration
CREATE TABLE event_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_name VARCHAR(100) NOT NULL UNIQUE,
    event_types TEXT[] NOT NULL,
    handler_endpoint VARCHAR(500),
    handler_config JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disabled')),
    max_retries INTEGER DEFAULT 3,
    retry_delay_ms INTEGER DEFAULT 1000,
    dead_letter_enabled BOOLEAN DEFAULT true,
    idempotent BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create event_metrics for performance monitoring
CREATE TABLE event_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name VARCHAR(100) NOT NULL,
    metric_value NUMERIC NOT NULL,
    metric_type VARCHAR(50) NOT NULL, -- counter, gauge, histogram
    labels JSONB DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for metrics
CREATE INDEX idx_event_metrics_name ON event_metrics (metric_name);
CREATE INDEX idx_event_metrics_timestamp ON event_metrics (timestamp);
CREATE INDEX idx_event_metrics_type ON event_metrics (metric_type);

-- Enable RLS on all event tables
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_processing_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_metrics ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for tenant isolation
CREATE POLICY "events_tenant_isolation" ON events
    FOR ALL USING (
        tenant_id IS NULL OR 
        tenant_id = (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            LIMIT 1
        ) OR
        auth.role() = 'service_role'
    );

-- Service role has full access to all event tables
CREATE POLICY "events_service_access" ON events
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "event_outbox_service_access" ON event_outbox
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "event_processing_log_service_access" ON event_processing_log
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "event_snapshots_service_access" ON event_snapshots
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "event_subscriptions_admin_access" ON event_subscriptions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM tenant_users tu
            WHERE tu.user_id = auth.uid()
            AND tu.role IN ('admin', 'superadmin')
        ) OR auth.role() = 'service_role'
    );

CREATE POLICY "event_metrics_service_access" ON event_metrics
    FOR ALL USING (auth.role() = 'service_role');

-- ===============================
-- STORED PROCEDURES
-- ===============================

-- Function to publish event with outbox pattern
CREATE OR REPLACE FUNCTION publish_event_with_outbox(
    event_data JSONB,
    destinations TEXT[] DEFAULT ARRAY['default']
)
RETURNS UUID AS $$
DECLARE
    event_id UUID;
    dest TEXT;
BEGIN
    -- Insert event
    INSERT INTO events (
        id, aggregate_id, aggregate_type, event_type, event_version,
        payload, metadata, timestamp, caused_by, correlation_id, tenant_id
    ) VALUES (
        (event_data->>'id')::UUID,
        event_data->>'aggregateId',
        event_data->>'aggregateType', 
        event_data->>'eventType',
        (event_data->>'eventVersion')::INTEGER,
        event_data->'payload',
        event_data->'metadata',
        (event_data->>'timestamp')::TIMESTAMP WITH TIME ZONE,
        event_data->>'causedBy',
        event_data->>'correlationId',
        CASE WHEN event_data->>'tenantId' IS NOT NULL 
             THEN (event_data->>'tenantId')::UUID 
             ELSE NULL END
    ) RETURNING id INTO event_id;
    
    -- Insert outbox entries for each destination
    FOREACH dest IN ARRAY destinations
    LOOP
        INSERT INTO event_outbox (
            event_id, destination, payload, status, attempts, max_attempts
        ) VALUES (
            event_id, dest, event_data->'payload', 'pending', 0, 5
        );
    END LOOP;
    
    RETURN event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get aggregate version
CREATE OR REPLACE FUNCTION get_aggregate_version(
    p_aggregate_id VARCHAR(255),
    p_aggregate_type VARCHAR(100)
)
RETURNS INTEGER AS $$
DECLARE
    current_version INTEGER;
BEGIN
    SELECT COALESCE(MAX(event_version), 0) INTO current_version
    FROM events 
    WHERE aggregate_id = p_aggregate_id 
    AND aggregate_type = p_aggregate_type;
    
    RETURN current_version;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create aggregate snapshot
CREATE OR REPLACE FUNCTION create_aggregate_snapshot(
    p_aggregate_id VARCHAR(255),
    p_aggregate_type VARCHAR(100),
    p_snapshot_data JSONB
)
RETURNS UUID AS $$
DECLARE
    snapshot_id UUID;
    current_version INTEGER;
BEGIN
    -- Get current version
    SELECT get_aggregate_version(p_aggregate_id, p_aggregate_type) INTO current_version;
    
    -- Insert snapshot
    INSERT INTO event_snapshots (
        aggregate_id, aggregate_type, version, snapshot_data
    ) VALUES (
        p_aggregate_id, p_aggregate_type, current_version, p_snapshot_data
    ) RETURNING id INTO snapshot_id;
    
    RETURN snapshot_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get events since snapshot
CREATE OR REPLACE FUNCTION get_events_since_snapshot(
    p_aggregate_id VARCHAR(255),
    p_aggregate_type VARCHAR(100)
)
RETURNS TABLE (
    event_id UUID,
    event_type VARCHAR(100),
    event_version INTEGER,
    payload JSONB,
    metadata JSONB,
    timestamp TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
    snapshot_version INTEGER;
BEGIN
    -- Get latest snapshot version
    SELECT COALESCE(MAX(version), 0) INTO snapshot_version
    FROM event_snapshots 
    WHERE aggregate_id = p_aggregate_id 
    AND aggregate_type = p_aggregate_type;
    
    -- Return events since snapshot
    RETURN QUERY
    SELECT e.id, e.event_type, e.event_version, e.payload, e.metadata, e.timestamp
    FROM events e
    WHERE e.aggregate_id = p_aggregate_id
    AND e.aggregate_type = p_aggregate_type
    AND e.event_version > snapshot_version
    ORDER BY e.event_version ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to mark outbox event as processed
CREATE OR REPLACE FUNCTION mark_outbox_processed(
    outbox_id UUID,
    success BOOLEAN,
    error_message TEXT DEFAULT NULL,
    processing_time_ms INTEGER DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    IF success THEN
        UPDATE event_outbox 
        SET 
            status = 'completed',
            completed_at = NOW(),
            updated_at = NOW(),
            error = NULL
        WHERE id = outbox_id;
    ELSE
        UPDATE event_outbox 
        SET 
            status = 'failed',
            attempts = attempts + 1,
            next_retry_at = NOW() + INTERVAL '1 second' * (POWER(2, attempts + 1) * 1000 / 1000),
            error = error_message,
            updated_at = NOW()
        WHERE id = outbox_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cleanup old events
CREATE OR REPLACE FUNCTION cleanup_old_events(
    retention_days INTEGER DEFAULT 90,
    keep_snapshots BOOLEAN DEFAULT true
)
RETURNS TABLE (
    deleted_events INTEGER,
    deleted_outbox INTEGER,
    deleted_processing_log INTEGER
) AS $$
DECLARE
    cutoff_date TIMESTAMP WITH TIME ZONE;
    events_deleted INTEGER;
    outbox_deleted INTEGER;
    log_deleted INTEGER;
BEGIN
    cutoff_date := NOW() - INTERVAL '1 day' * retention_days;
    
    -- Delete old processing logs
    DELETE FROM event_processing_log 
    WHERE processed_at < cutoff_date;
    GET DIAGNOSTICS log_deleted = ROW_COUNT;
    
    -- Delete old completed outbox entries
    DELETE FROM event_outbox 
    WHERE status = 'completed' AND completed_at < cutoff_date;
    GET DIAGNOSTICS outbox_deleted = ROW_COUNT;
    
    -- Delete old events (if no snapshots to keep)
    IF NOT keep_snapshots THEN
        DELETE FROM events 
        WHERE created_at < cutoff_date;
        GET DIAGNOSTICS events_deleted = ROW_COUNT;
    ELSE
        events_deleted := 0;
    END IF;
    
    RETURN QUERY SELECT events_deleted, outbox_deleted, log_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get event bus metrics
CREATE OR REPLACE FUNCTION get_event_bus_metrics(
    time_range INTERVAL DEFAULT INTERVAL '24 hours'
)
RETURNS JSONB AS $$
DECLARE
    start_time TIMESTAMP WITH TIME ZONE;
    result JSONB;
BEGIN
    start_time := NOW() - time_range;
    
    SELECT jsonb_build_object(
        'events', jsonb_build_object(
            'total', (SELECT COUNT(*) FROM events WHERE created_at >= start_time),
            'by_type', (
                SELECT jsonb_object_agg(event_type, count)
                FROM (
                    SELECT event_type, COUNT(*) as count
                    FROM events 
                    WHERE created_at >= start_time
                    GROUP BY event_type
                ) t
            )
        ),
        'outbox', jsonb_build_object(
            'pending', (SELECT COUNT(*) FROM event_outbox WHERE status = 'pending'),
            'processing', (SELECT COUNT(*) FROM event_outbox WHERE status = 'processing'),
            'completed', (SELECT COUNT(*) FROM event_outbox WHERE status = 'completed' AND updated_at >= start_time),
            'failed', (SELECT COUNT(*) FROM event_outbox WHERE status = 'failed'),
            'dead_letter', (SELECT COUNT(*) FROM event_outbox WHERE status = 'dead_letter')
        ),
        'performance', jsonb_build_object(
            'avg_processing_time', (
                SELECT COALESCE(AVG(processing_time_ms), 0)
                FROM event_processing_log 
                WHERE processed_at >= start_time
            ),
            'success_rate', (
                SELECT CASE 
                    WHEN COUNT(*) = 0 THEN 0
                    ELSE (COUNT(*) FILTER (WHERE success = true))::FLOAT / COUNT(*)
                END
                FROM event_processing_log 
                WHERE processed_at >= start_time
            )
        )
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to record event metric
CREATE OR REPLACE FUNCTION record_event_metric(
    metric_name VARCHAR(100),
    metric_value NUMERIC,
    metric_type VARCHAR(50) DEFAULT 'counter',
    labels JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    metric_id UUID;
BEGIN
    INSERT INTO event_metrics (metric_name, metric_value, metric_type, labels)
    VALUES (metric_name, metric_value, metric_type, labels)
    RETURNING id INTO metric_id;
    
    RETURN metric_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===============================
-- TRIGGERS
-- ===============================

-- Trigger to update outbox updated_at timestamp
CREATE OR REPLACE FUNCTION update_outbox_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_outbox_timestamp
    BEFORE UPDATE ON event_outbox
    FOR EACH ROW
    EXECUTE FUNCTION update_outbox_timestamp();

-- Trigger to automatically record metrics on event creation
CREATE OR REPLACE FUNCTION record_event_creation_metric()
RETURNS TRIGGER AS $$
BEGIN
    -- Record event creation metric
    INSERT INTO event_metrics (metric_name, metric_value, metric_type, labels)
    VALUES (
        'events_created_total', 
        1, 
        'counter', 
        jsonb_build_object(
            'event_type', NEW.event_type,
            'aggregate_type', NEW.aggregate_type
        )
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_record_event_metric
    AFTER INSERT ON events
    FOR EACH ROW
    EXECUTE FUNCTION record_event_creation_metric();

-- ===============================
-- INITIAL DATA
-- ===============================

-- Insert default event subscription for system events
INSERT INTO event_subscriptions (
    subscription_name, event_types, handler_config, status
) VALUES (
    'system_events', 
    ARRAY['system.started', 'system.stopped', 'system.error'],
    '{"handler": "SystemEventHandler", "priority": "high"}',
    'active'
);

-- ===============================
-- COMMENTS
-- ===============================

COMMENT ON TABLE events IS 'Event store for event sourcing and audit trail';
COMMENT ON TABLE event_outbox IS 'Outbox pattern for reliable event delivery';
COMMENT ON TABLE event_processing_log IS 'Log of event processing for idempotency and debugging';
COMMENT ON TABLE event_snapshots IS 'Aggregate snapshots for performance optimization';
COMMENT ON TABLE event_subscriptions IS 'Dynamic event handler subscriptions';
COMMENT ON TABLE event_metrics IS 'Event bus performance and operational metrics';

COMMENT ON FUNCTION publish_event_with_outbox IS 'Atomically publish event and create outbox entries';
COMMENT ON FUNCTION get_aggregate_version IS 'Get current version of an aggregate';
COMMENT ON FUNCTION create_aggregate_snapshot IS 'Create snapshot of aggregate state';
COMMENT ON FUNCTION get_events_since_snapshot IS 'Get events since last snapshot for aggregate reconstruction';
COMMENT ON FUNCTION mark_outbox_processed IS 'Mark outbox event as processed with retry logic';
COMMENT ON FUNCTION cleanup_old_events IS 'Clean up old events and processing logs';
COMMENT ON FUNCTION get_event_bus_metrics IS 'Get comprehensive event bus performance metrics';
COMMENT ON FUNCTION record_event_metric IS 'Record custom metric for event bus monitoring';