-- Create booking_notifications table for tracking notification events
CREATE TABLE IF NOT EXISTS booking_notifications (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT NOW() NOT NULL,
    updated_at timestamptz DEFAULT NOW() NOT NULL,
    
    -- Booking reference
    booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
    tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Notification details
    type varchar(50) NOT NULL, -- 'confirmation', 'reminder', 'cancellation', 'update', 'custom'
    channel varchar(20) NOT NULL DEFAULT 'whatsapp', -- 'whatsapp', 'sms', 'email'
    recipient_phone varchar(20),
    recipient_email varchar(255),
    
    -- Content
    message_content text NOT NULL,
    template_name varchar(100),
    template_variables jsonb DEFAULT '{}',
    
    -- Scheduling
    scheduled_for timestamptz,
    sent_at timestamptz,
    
    -- Status
    status varchar(20) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
    error_message text,
    retry_count integer DEFAULT 0,
    max_retries integer DEFAULT 3,
    
    -- Audit
    created_by uuid REFERENCES auth.users(id),
    metadata jsonb DEFAULT '{}'
);

-- Create scheduled_notifications table for recurring/future notifications
CREATE TABLE IF NOT EXISTS scheduled_notifications (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT NOW() NOT NULL,
    updated_at timestamptz DEFAULT NOW() NOT NULL,
    
    -- Reference
    booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
    tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
    notification_id uuid REFERENCES booking_notifications(id) ON DELETE CASCADE,
    
    -- Scheduling
    trigger_type varchar(50) NOT NULL, -- 'booking_created', 'reminder_24h', 'reminder_1h', 'reminder_15m'
    scheduled_for timestamptz NOT NULL,
    executed_at timestamptz,
    
    -- Status
    status varchar(20) DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'cancelled')),
    
    -- Configuration
    config jsonb DEFAULT '{}',
    
    UNIQUE(booking_id, trigger_type)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_booking_notifications_booking_id ON booking_notifications(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_notifications_tenant_id ON booking_notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_booking_notifications_status ON booking_notifications(status);
CREATE INDEX IF NOT EXISTS idx_booking_notifications_scheduled_for ON booking_notifications(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_booking_notifications_type ON booking_notifications(type);

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_booking_id ON scheduled_notifications(booking_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_tenant_id ON scheduled_notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_scheduled_for ON scheduled_notifications(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_status ON scheduled_notifications(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_trigger_type ON scheduled_notifications(trigger_type);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_booking_notifications_updated_at 
    BEFORE UPDATE ON booking_notifications 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scheduled_notifications_updated_at 
    BEFORE UPDATE ON scheduled_notifications 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies
ALTER TABLE booking_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_notifications ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policies
CREATE POLICY tenant_isolation_booking_notifications ON booking_notifications
    USING (tenant_id = (SELECT tenant_id FROM auth.users WHERE id = auth.uid()));

CREATE POLICY tenant_isolation_scheduled_notifications ON scheduled_notifications
    USING (tenant_id = (SELECT tenant_id FROM auth.users WHERE id = auth.uid()));

-- Service role bypass
CREATE POLICY service_role_booking_notifications ON booking_notifications
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY service_role_scheduled_notifications ON scheduled_notifications
    TO service_role
    USING (true)
    WITH CHECK (true);