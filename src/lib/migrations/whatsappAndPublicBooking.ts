/**
 * Database Migrations for Public Booking & WhatsApp Integration
 * 
 * Run these migrations in order:
 * 1. Add tenant slug
 * 2. Create WhatsApp connection tracking
 * 3. Create message queue table
 * 4. Create dialog sessions table
 * 5. Create business hours table
 */

// Migration 1: Add tenant slug
export const migration1_add_tenant_slug = `
-- Add slug column to tenants
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;

-- Generate slugs for existing tenants
UPDATE tenants
SET slug = LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || SUBSTRING(id::text, 1, 4)
WHERE slug IS NULL;

-- Add index for fast lookup
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

-- Make slug NOT NULL after populating
ALTER TABLE tenants 
ALTER COLUMN slug SET NOT NULL;

-- Add unique constraint
ALTER TABLE tenants
ADD CONSTRAINT unique_tenant_slug UNIQUE(slug);
`;

// Migration 2: WhatsApp connections
export const migration2_whatsapp_connections = `
CREATE TABLE IF NOT EXISTS whatsapp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  display_name TEXT,
  is_active BOOLEAN DEFAULT true,
  connection_metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_phone_number ON whatsapp_connections(phone_number);
CREATE INDEX IF NOT EXISTS idx_whatsapp_tenant_id ON whatsapp_connections(tenant_id);

-- Enable RLS
ALTER TABLE whatsapp_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_connections_tenant_isolation ON whatsapp_connections
  USING (tenant_id = auth.uid()::uuid);
`;

// Migration 3: WhatsApp message queue
export const migration3_whatsapp_message_queue = `
CREATE TABLE IF NOT EXISTS whatsapp_message_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL UNIQUE,
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  content TEXT NOT NULL,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'retry')),
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  scheduled_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_queue_status ON whatsapp_message_queue(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_queue_tenant ON whatsapp_message_queue(tenant_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_queue_priority ON whatsapp_message_queue(priority DESC, created_at ASC);
`;

// Migration 4: Dialog sessions
export const migration4_dialog_sessions = `
CREATE TABLE IF NOT EXISTS dialog_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  current_step TEXT DEFAULT 'greeting',
  booking_context JSONB DEFAULT '{}',
  conversation_history JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dialog_tenant ON dialog_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dialog_customer ON dialog_sessions(customer_id);
CREATE INDEX IF NOT EXISTS idx_dialog_updated ON dialog_sessions(updated_at DESC);

-- Enable RLS
ALTER TABLE dialog_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY dialog_sessions_tenant_isolation ON dialog_sessions
  USING (tenant_id = auth.uid()::uuid);
`;

// Migration 5: Business hours
export const migration5_business_hours = `
CREATE TABLE IF NOT EXISTS business_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_open BOOLEAN DEFAULT true,
  break_start TIME,
  break_end TIME,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_business_hours_tenant ON business_hours(tenant_id);

-- Enable RLS
ALTER TABLE business_hours ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_hours_tenant_isolation ON business_hours
  USING (tenant_id = auth.uid()::uuid);

-- Insert default business hours (Mon-Fri 9AM-6PM, Sat 10AM-4PM, Sun closed)
INSERT INTO business_hours (tenant_id, day_of_week, start_time, end_time, is_open)
SELECT id, day, '09:00'::TIME, '18:00'::TIME, true
FROM tenants, (SELECT 1 as day UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5) days
ON CONFLICT DO NOTHING;

INSERT INTO business_hours (tenant_id, day_of_week, start_time, end_time, is_open)
SELECT id, 6, '10:00'::TIME, '16:00'::TIME, true
FROM tenants
ON CONFLICT DO NOTHING;

INSERT INTO business_hours (tenant_id, day_of_week, start_time, end_time, is_open)
SELECT id, 0, '10:00'::TIME, '16:00'::TIME, false
FROM tenants
ON CONFLICT DO NOTHING;
`;

// Migration 6: Add WhatsApp message log for delivery tracking
export const migration6_whatsapp_message_log = `
CREATE TABLE IF NOT EXISTS whatsapp_message_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL UNIQUE,
  to_number TEXT NOT NULL,
  content TEXT,
  direction TEXT CHECK (direction IN ('inbound', 'outbound')),
  delivery_status TEXT DEFAULT 'sent',
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_log_tenant ON whatsapp_message_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_log_status ON whatsapp_message_log(delivery_status);
`;

// Helper function to run all migrations
export async function runAllMigrations(supabase: any) {
  const migrations = [
    migration1_add_tenant_slug,
    migration2_whatsapp_connections,
    migration3_whatsapp_message_queue,
    migration4_dialog_sessions,
    migration5_business_hours,
    migration6_whatsapp_message_log,
  ];

  for (let i = 0; i < migrations.length; i++) {
    try {
      console.log(`Running migration ${i + 1}...`);
      const { error } = await supabase.rpc('exec_sql', { sql: migrations[i] });
      if (error) {
        console.error(`Migration ${i + 1} failed:`, error);
      } else {
        console.log(`✅ Migration ${i + 1} completed`);
      }
    } catch (error) {
      console.error(`Migration ${i + 1} error:`, error);
    }
  }
}
