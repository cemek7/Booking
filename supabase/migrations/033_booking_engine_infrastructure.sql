-- Booking Engine Infrastructure - Production Grade
-- This migration creates comprehensive booking management tables with conflict resolution

-- Create services table for bookable services
CREATE TABLE services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    price_cents INTEGER DEFAULT 0 CHECK (price_cents >= 0),
    currency VARCHAR(3) DEFAULT 'USD',
    requires_payment BOOLEAN DEFAULT FALSE,
    max_advance_booking_days INTEGER DEFAULT 365,
    min_advance_booking_minutes INTEGER DEFAULT 30,
    buffer_time_minutes INTEGER DEFAULT 15, -- Time between bookings
    max_concurrent_bookings INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for services
CREATE INDEX idx_services_tenant ON services (tenant_id);
CREATE INDEX idx_services_active ON services (is_active) WHERE is_active = TRUE;
CREATE INDEX idx_services_category ON services (category);
CREATE INDEX idx_services_price ON services (price_cents);

-- Create providers table for service providers
CREATE TABLE providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(20),
    specialization VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    availability_calendar JSONB DEFAULT '{}', -- Weekly schedule
    timezone VARCHAR(50) DEFAULT 'UTC',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for providers
CREATE INDEX idx_providers_tenant ON providers (tenant_id);
CREATE INDEX idx_providers_user ON providers (user_id);
CREATE INDEX idx_providers_active ON providers (is_active) WHERE is_active = TRUE;
CREATE INDEX idx_providers_email ON providers (email);

-- Create provider_services junction table
CREATE TABLE provider_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT TRUE,
    custom_price_cents INTEGER,
    custom_duration_minutes INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for provider_services
CREATE INDEX idx_provider_services_provider ON provider_services (provider_id);
CREATE INDEX idx_provider_services_service ON provider_services (service_id);
CREATE UNIQUE INDEX idx_provider_services_unique ON provider_services (provider_id, service_id);

-- Update bookings table with enhanced structure
-- (Assuming basic bookings table exists, we'll add new columns)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES providers(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(20);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS special_requests TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS price_cents INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'USD';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_id UUID;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS modification_count INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(100);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancellation_notes TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Add constraints to bookings
ALTER TABLE bookings ADD CONSTRAINT chk_booking_times CHECK (start_time < end_time);
ALTER TABLE bookings ADD CONSTRAINT chk_booking_status CHECK (
    status IN ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')
);
ALTER TABLE bookings ADD CONSTRAINT chk_payment_status CHECK (
    payment_status IN ('pending', 'processing', 'paid', 'failed', 'refunded', 'not_required')
);

-- Create indexes for enhanced bookings
CREATE INDEX idx_bookings_service ON bookings (service_id);
CREATE INDEX idx_bookings_provider ON bookings (provider_id);
CREATE INDEX idx_bookings_customer_email ON bookings (customer_email);
CREATE INDEX idx_bookings_start_time ON bookings (start_time);
CREATE INDEX idx_bookings_end_time ON bookings (end_time);
CREATE INDEX idx_bookings_status ON bookings (status);
CREATE INDEX idx_bookings_payment_status ON bookings (payment_status);
CREATE INDEX idx_bookings_created_at ON bookings (created_at);

-- Create time slot availability index for conflict detection
CREATE INDEX idx_bookings_availability ON bookings (provider_id, start_time, end_time, status) 
WHERE status IN ('confirmed', 'in_progress');

-- Create booking_modifications table for audit trail
CREATE TABLE booking_modifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    modified_by UUID REFERENCES auth.users(id),
    modification_type VARCHAR(50) NOT NULL CHECK (
        modification_type IN ('created', 'time_changed', 'service_changed', 'provider_changed', 'cancelled', 'confirmed', 'completed')
    ),
    previous_data JSONB,
    new_data JSONB,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for booking modifications
CREATE INDEX idx_booking_modifications_booking ON booking_modifications (booking_id);
CREATE INDEX idx_booking_modifications_tenant ON booking_modifications (tenant_id);
CREATE INDEX idx_booking_modifications_type ON booking_modifications (modification_type);
CREATE INDEX idx_booking_modifications_created_at ON booking_modifications (created_at);

-- Create booking_conflicts table for conflict tracking
CREATE TABLE booking_conflicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    conflict_type VARCHAR(50) NOT NULL CHECK (
        conflict_type IN ('time_overlap', 'provider_unavailable', 'service_unavailable', 'capacity_exceeded')
    ),
    conflicting_booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    provider_id UUID REFERENCES providers(id),
    service_id UUID REFERENCES services(id),
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) DEFAULT 'detected' CHECK (status IN ('detected', 'resolved', 'ignored')),
    resolution_method VARCHAR(50),
    resolution_data JSONB,
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for booking conflicts
CREATE INDEX idx_booking_conflicts_tenant ON booking_conflicts (tenant_id);
CREATE INDEX idx_booking_conflicts_booking ON booking_conflicts (booking_id);
CREATE INDEX idx_booking_conflicts_type ON booking_conflicts (conflict_type);
CREATE INDEX idx_booking_conflicts_status ON booking_conflicts (status);
CREATE INDEX idx_booking_conflicts_provider ON booking_conflicts (provider_id);
CREATE INDEX idx_booking_conflicts_time ON booking_conflicts (start_time, end_time);

-- Create provider_schedule table for detailed availability
CREATE TABLE provider_schedule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    break_start_time TIME, -- Optional break period
    break_end_time TIME,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for provider schedule
CREATE INDEX idx_provider_schedule_provider ON provider_schedule (provider_id);
CREATE INDEX idx_provider_schedule_day ON provider_schedule (day_of_week);
CREATE INDEX idx_provider_schedule_active ON provider_schedule (is_active) WHERE is_active = TRUE;
CREATE UNIQUE INDEX idx_provider_schedule_unique ON provider_schedule (provider_id, day_of_week, start_time, end_time);

-- Create provider_availability_exceptions for holidays, sick days, etc.
CREATE TABLE provider_availability_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    exception_date DATE NOT NULL,
    exception_type VARCHAR(50) NOT NULL CHECK (
        exception_type IN ('unavailable', 'custom_hours', 'holiday', 'break')
    ),
    start_time TIME,
    end_time TIME,
    reason VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for availability exceptions
CREATE INDEX idx_availability_exceptions_provider ON provider_availability_exceptions (provider_id);
CREATE INDEX idx_availability_exceptions_date ON provider_availability_exceptions (exception_date);
CREATE INDEX idx_availability_exceptions_type ON provider_availability_exceptions (exception_type);

-- Create booking_reminders table for automated reminders
CREATE TABLE booking_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    reminder_type VARCHAR(50) NOT NULL CHECK (
        reminder_type IN ('confirmation', 'day_before', 'hour_before', 'follow_up')
    ),
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE,
    delivery_method VARCHAR(20) DEFAULT 'email' CHECK (
        delivery_method IN ('email', 'sms', 'whatsapp', 'push')
    ),
    status VARCHAR(20) DEFAULT 'scheduled' CHECK (
        status IN ('scheduled', 'sent', 'failed', 'cancelled')
    ),
    message_template_id UUID,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for booking reminders
CREATE INDEX idx_booking_reminders_booking ON booking_reminders (booking_id);
CREATE INDEX idx_booking_reminders_tenant ON booking_reminders (tenant_id);
CREATE INDEX idx_booking_reminders_scheduled ON booking_reminders (scheduled_for);
CREATE INDEX idx_booking_reminders_status ON booking_reminders (status);
CREATE INDEX idx_booking_reminders_type ON booking_reminders (reminder_type);

-- Enable RLS on all booking tables
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_modifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_availability_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_reminders ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for tenant isolation
CREATE POLICY "services_tenant_isolation" ON services
    FOR ALL USING (
        tenant_id = (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            LIMIT 1
        ) OR auth.role() = 'service_role'
    );

CREATE POLICY "providers_tenant_isolation" ON providers
    FOR ALL USING (
        tenant_id = (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            LIMIT 1
        ) OR auth.role() = 'service_role'
    );

CREATE POLICY "provider_services_tenant_isolation" ON provider_services
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM providers p 
            WHERE p.id = provider_services.provider_id 
            AND p.tenant_id = (
                SELECT tenant_id FROM tenant_users 
                WHERE user_id = auth.uid() 
                LIMIT 1
            )
        ) OR auth.role() = 'service_role'
    );

CREATE POLICY "booking_modifications_tenant_isolation" ON booking_modifications
    FOR ALL USING (
        tenant_id = (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            LIMIT 1
        ) OR auth.role() = 'service_role'
    );

CREATE POLICY "booking_conflicts_tenant_isolation" ON booking_conflicts
    FOR ALL USING (
        tenant_id = (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            LIMIT 1
        ) OR auth.role() = 'service_role'
    );

CREATE POLICY "provider_schedule_tenant_isolation" ON provider_schedule
    FOR ALL USING (
        tenant_id = (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            LIMIT 1
        ) OR auth.role() = 'service_role'
    );

CREATE POLICY "availability_exceptions_tenant_isolation" ON provider_availability_exceptions
    FOR ALL USING (
        tenant_id = (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            LIMIT 1
        ) OR auth.role() = 'service_role'
    );

CREATE POLICY "booking_reminders_tenant_isolation" ON booking_reminders
    FOR ALL USING (
        tenant_id = (
            SELECT tenant_id FROM tenant_users 
            WHERE user_id = auth.uid() 
            LIMIT 1
        ) OR auth.role() = 'service_role'
    );

-- ===============================
-- STORED PROCEDURES
-- ===============================

-- Function to check booking availability
CREATE OR REPLACE FUNCTION check_booking_availability(
    p_tenant_id UUID,
    p_provider_id UUID,
    p_start_time TIMESTAMP WITH TIME ZONE,
    p_end_time TIMESTAMP WITH TIME ZONE,
    p_exclude_booking_id UUID DEFAULT NULL
)
RETURNS TABLE (
    is_available BOOLEAN,
    conflicting_bookings JSONB,
    schedule_conflicts JSONB
) AS $$
DECLARE
    overlapping_bookings JSONB;
    schedule_issues JSONB;
    available BOOLEAN := TRUE;
BEGIN
    -- Check for overlapping bookings
    SELECT jsonb_agg(
        jsonb_build_object(
            'booking_id', b.id,
            'start_time', b.start_time,
            'end_time', b.end_time,
            'customer_name', b.customer_name,
            'status', b.status
        )
    ) INTO overlapping_bookings
    FROM bookings b
    WHERE b.tenant_id = p_tenant_id
    AND b.provider_id = p_provider_id
    AND b.status IN ('confirmed', 'in_progress')
    AND b.start_time < p_end_time
    AND b.end_time > p_start_time
    AND (p_exclude_booking_id IS NULL OR b.id != p_exclude_booking_id);
    
    -- Check provider schedule
    WITH day_check AS (
        SELECT 
            ps.day_of_week,
            ps.start_time as schedule_start,
            ps.end_time as schedule_end,
            ps.break_start_time,
            ps.break_end_time
        FROM provider_schedule ps
        WHERE ps.provider_id = p_provider_id
        AND ps.tenant_id = p_tenant_id
        AND ps.is_active = true
        AND ps.day_of_week = EXTRACT(DOW FROM p_start_time)
    )
    SELECT jsonb_agg(
        jsonb_build_object(
            'issue', 'outside_working_hours',
            'working_hours', jsonb_build_object(
                'start', schedule_start,
                'end', schedule_end
            )
        )
    ) INTO schedule_issues
    FROM day_check
    WHERE p_start_time::TIME < schedule_start 
    OR p_end_time::TIME > schedule_end
    OR (break_start_time IS NOT NULL AND 
        p_start_time::TIME < break_end_time AND 
        p_end_time::TIME > break_start_time);
    
    -- Check availability exceptions
    IF schedule_issues IS NULL THEN
        SELECT jsonb_agg(
            jsonb_build_object(
                'issue', 'provider_unavailable',
                'exception_type', pae.exception_type,
                'reason', pae.reason
            )
        ) INTO schedule_issues
        FROM provider_availability_exceptions pae
        WHERE pae.provider_id = p_provider_id
        AND pae.tenant_id = p_tenant_id
        AND pae.exception_date = p_start_time::DATE
        AND (pae.exception_type = 'unavailable' OR
            (pae.start_time IS NOT NULL AND pae.end_time IS NOT NULL AND
             p_start_time::TIME < pae.end_time AND 
             p_end_time::TIME > pae.start_time));
    END IF;
    
    -- Determine overall availability
    available := (overlapping_bookings IS NULL AND schedule_issues IS NULL);
    
    RETURN QUERY SELECT 
        available,
        COALESCE(overlapping_bookings, '[]'::jsonb),
        COALESCE(schedule_issues, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to suggest alternative booking times
CREATE OR REPLACE FUNCTION suggest_booking_times(
    p_tenant_id UUID,
    p_provider_id UUID,
    p_service_id UUID,
    p_preferred_date DATE,
    p_duration_minutes INTEGER,
    p_max_suggestions INTEGER DEFAULT 5
)
RETURNS TABLE (
    suggested_start_time TIMESTAMP WITH TIME ZONE,
    suggested_end_time TIMESTAMP WITH TIME ZONE,
    availability_score INTEGER
) AS $$
DECLARE
    service_record RECORD;
    schedule_record RECORD;
    suggestion_count INTEGER := 0;
    current_time TIMESTAMP WITH TIME ZONE;
    slot_start TIME;
    slot_end TIME;
BEGIN
    -- Get service details
    SELECT duration_minutes, buffer_time_minutes 
    INTO service_record
    FROM services s
    WHERE s.id = p_service_id AND s.tenant_id = p_tenant_id;
    
    IF service_record IS NULL THEN
        RETURN;
    END IF;
    
    -- Iterate through provider schedule for the day
    FOR schedule_record IN
        SELECT start_time, end_time, break_start_time, break_end_time
        FROM provider_schedule ps
        WHERE ps.provider_id = p_provider_id
        AND ps.tenant_id = p_tenant_id
        AND ps.day_of_week = EXTRACT(DOW FROM p_preferred_date)
        AND ps.is_active = true
        ORDER BY ps.start_time
    LOOP
        -- Generate time slots
        slot_start := schedule_record.start_time;
        
        WHILE slot_start + INTERVAL '1 minute' * p_duration_minutes <= schedule_record.end_time
        AND suggestion_count < p_max_suggestions
        LOOP
            slot_end := slot_start + INTERVAL '1 minute' * p_duration_minutes;
            current_time := p_preferred_date + slot_start;
            
            -- Skip break times
            IF schedule_record.break_start_time IS NOT NULL AND
               slot_start < schedule_record.break_end_time AND
               slot_end > schedule_record.break_start_time THEN
                slot_start := schedule_record.break_end_time;
                CONTINUE;
            END IF;
            
            -- Check if slot is available
            IF (SELECT is_available FROM check_booking_availability(
                p_tenant_id, p_provider_id, current_time, 
                current_time + INTERVAL '1 minute' * p_duration_minutes
            )) THEN
                suggestion_count := suggestion_count + 1;
                
                RETURN QUERY SELECT 
                    current_time,
                    current_time + INTERVAL '1 minute' * p_duration_minutes,
                    100; -- Simple scoring, can be enhanced
            END IF;
            
            -- Move to next slot (service duration + buffer time)
            slot_start := slot_start + INTERVAL '1 minute' * (p_duration_minutes + COALESCE(service_record.buffer_time_minutes, 15));
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get booking statistics
CREATE OR REPLACE FUNCTION get_booking_statistics(
    p_tenant_id UUID,
    p_start_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
    p_end_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'total_bookings', COUNT(*),
        'confirmed_bookings', COUNT(*) FILTER (WHERE status = 'confirmed'),
        'completed_bookings', COUNT(*) FILTER (WHERE status = 'completed'),
        'cancelled_bookings', COUNT(*) FILTER (WHERE status = 'cancelled'),
        'no_show_bookings', COUNT(*) FILTER (WHERE status = 'no_show'),
        'cancellation_rate', ROUND(
            COUNT(*) FILTER (WHERE status = 'cancelled')::DECIMAL / 
            NULLIF(COUNT(*), 0) * 100, 2
        ),
        'no_show_rate', ROUND(
            COUNT(*) FILTER (WHERE status = 'no_show')::DECIMAL / 
            NULLIF(COUNT(*), 0) * 100, 2
        ),
        'average_booking_value', ROUND(AVG(price_cents) / 100.0, 2),
        'total_revenue', ROUND(SUM(
            CASE WHEN status IN ('completed', 'confirmed') AND payment_status = 'paid' 
            THEN price_cents ELSE 0 END
        ) / 100.0, 2),
        'popular_services', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'service_id', s.id,
                    'service_name', s.name,
                    'booking_count', service_counts.booking_count
                )
            )
            FROM (
                SELECT service_id, COUNT(*) as booking_count
                FROM bookings b2
                WHERE b2.tenant_id = p_tenant_id
                AND b2.start_time::DATE BETWEEN p_start_date AND p_end_date
                GROUP BY service_id
                ORDER BY booking_count DESC
                LIMIT 5
            ) service_counts
            JOIN services s ON s.id = service_counts.service_id
        ),
        'peak_hours', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'hour', hour_stats.booking_hour,
                    'booking_count', hour_stats.booking_count
                )
            )
            FROM (
                SELECT 
                    EXTRACT(HOUR FROM start_time) as booking_hour,
                    COUNT(*) as booking_count
                FROM bookings b3
                WHERE b3.tenant_id = p_tenant_id
                AND b3.start_time::DATE BETWEEN p_start_date AND p_end_date
                GROUP BY EXTRACT(HOUR FROM start_time)
                ORDER BY booking_count DESC
                LIMIT 5
            ) hour_stats
        )
    ) INTO result
    FROM bookings b
    WHERE b.tenant_id = p_tenant_id
    AND b.start_time::DATE BETWEEN p_start_date AND p_end_date;
    
    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cleanup old booking data
CREATE OR REPLACE FUNCTION cleanup_booking_data(
    retention_days INTEGER DEFAULT 1095 -- 3 years
)
RETURNS TABLE (
    table_name TEXT,
    deleted_rows BIGINT
) AS $$
DECLARE
    cutoff_date TIMESTAMP WITH TIME ZONE;
    deleted_count BIGINT;
BEGIN
    cutoff_date := NOW() - INTERVAL '1 day' * retention_days;
    
    -- Archive old completed bookings to separate table (implementation depends on archival strategy)
    -- DELETE FROM bookings WHERE status = 'completed' AND end_time < cutoff_date;
    -- GET DIAGNOSTICS deleted_count = ROW_COUNT;
    -- RETURN QUERY SELECT 'bookings'::TEXT, deleted_count;
    
    -- For now, just clean up old booking modifications
    DELETE FROM booking_modifications WHERE created_at < cutoff_date;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN QUERY SELECT 'booking_modifications'::TEXT, deleted_count;
    
    -- Clean up old resolved conflicts
    DELETE FROM booking_conflicts 
    WHERE status = 'resolved' AND resolved_at < cutoff_date;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN QUERY SELECT 'booking_conflicts'::TEXT, deleted_count;
    
    -- Clean up old sent reminders
    DELETE FROM booking_reminders 
    WHERE status = 'sent' AND sent_at < cutoff_date;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN QUERY SELECT 'booking_reminders'::TEXT, deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===============================
-- TRIGGERS
-- ===============================

-- Trigger to update service/provider timestamps
CREATE OR REPLACE FUNCTION update_booking_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    
    -- Set confirmed timestamp
    IF NEW.status = 'confirmed' AND OLD.status != 'confirmed' THEN
        NEW.confirmed_at = NOW();
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_service_timestamp
    BEFORE UPDATE ON services
    FOR EACH ROW
    EXECUTE FUNCTION update_booking_timestamp();

CREATE TRIGGER trigger_update_provider_timestamp
    BEFORE UPDATE ON providers
    FOR EACH ROW
    EXECUTE FUNCTION update_booking_timestamp();

-- Trigger to log booking modifications
CREATE OR REPLACE FUNCTION log_booking_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO booking_modifications (
            booking_id, tenant_id, modification_type, new_data, reason
        ) VALUES (
            NEW.id, NEW.tenant_id, 'created', 
            jsonb_build_object(
                'customer_name', NEW.customer_name,
                'start_time', NEW.start_time,
                'end_time', NEW.end_time,
                'service_id', NEW.service_id,
                'provider_id', NEW.provider_id
            ),
            'Booking created'
        );
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO booking_modifications (
            booking_id, tenant_id, modification_type, previous_data, new_data, reason
        ) VALUES (
            NEW.id, NEW.tenant_id, 
            CASE 
                WHEN NEW.status != OLD.status AND NEW.status = 'cancelled' THEN 'cancelled'
                WHEN NEW.status != OLD.status AND NEW.status = 'confirmed' THEN 'confirmed'
                WHEN NEW.start_time != OLD.start_time OR NEW.end_time != OLD.end_time THEN 'time_changed'
                WHEN NEW.service_id != OLD.service_id THEN 'service_changed'
                WHEN NEW.provider_id != OLD.provider_id THEN 'provider_changed'
                ELSE 'modified'
            END,
            jsonb_build_object(
                'status', OLD.status,
                'start_time', OLD.start_time,
                'end_time', OLD.end_time,
                'service_id', OLD.service_id,
                'provider_id', OLD.provider_id
            ),
            jsonb_build_object(
                'status', NEW.status,
                'start_time', NEW.start_time,
                'end_time', NEW.end_time,
                'service_id', NEW.service_id,
                'provider_id', NEW.provider_id
            ),
            COALESCE(NEW.cancellation_notes, 'Booking modified')
        );
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_log_booking_changes
    AFTER INSERT OR UPDATE ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION log_booking_modification();

-- ===============================
-- COMMENTS
-- ===============================

COMMENT ON TABLE services IS 'Bookable services offered by providers';
COMMENT ON TABLE providers IS 'Service providers who offer bookable services';
COMMENT ON TABLE provider_services IS 'Junction table linking providers to services they offer';
COMMENT ON TABLE booking_modifications IS 'Audit trail of all booking changes';
COMMENT ON TABLE booking_conflicts IS 'Tracking and resolution of booking conflicts';
COMMENT ON TABLE provider_schedule IS 'Regular weekly schedule for providers';
COMMENT ON TABLE provider_availability_exceptions IS 'Exceptions to regular schedule (holidays, sick days)';
COMMENT ON TABLE booking_reminders IS 'Automated reminder system for bookings';

COMMENT ON FUNCTION check_booking_availability IS 'Check if a time slot is available for booking';
COMMENT ON FUNCTION suggest_booking_times IS 'Suggest alternative available time slots';
COMMENT ON FUNCTION get_booking_statistics IS 'Get comprehensive booking statistics and analytics';
COMMENT ON FUNCTION cleanup_booking_data IS 'Clean up old booking data for maintenance';