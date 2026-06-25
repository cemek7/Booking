-- Migration 068: RLS policies, performance indexes, and pg_cron slot-lock cleanup
-- Run AFTER 067 (all new tables must exist)

-- ─── Row Level Security on new tables ────────────────────────────────────────
-- Follow the same pattern as migration 027 (existing RLS setup)

ALTER TABLE customers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE slot_locks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE insights_daily     ENABLE ROW LEVEL SECURITY;

-- Helper: resolve the calling user's tenant_id from tenant_users
-- (same sub-select pattern used throughout existing migrations)

CREATE POLICY "customers_tenant_isolation" ON customers
  USING (tenant_id = (
    SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid() LIMIT 1
  ));

CREATE POLICY "slot_locks_tenant_isolation" ON slot_locks
  USING (tenant_id = (
    SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid() LIMIT 1
  ));

CREATE POLICY "schedule_overrides_tenant_isolation" ON schedule_overrides
  USING (tenant_id = (
    SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid() LIMIT 1
  ));

CREATE POLICY "insights_daily_tenant_isolation" ON insights_daily
  USING (tenant_id = (
    SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid() LIMIT 1
  ));

-- Service-role bypass for server-side operations (webhook worker, cron jobs)
-- These match the pattern used in migration 027 for other tables
CREATE POLICY "customers_service_role"          ON customers          TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "slot_locks_service_role"         ON slot_locks         TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "schedule_overrides_service_role" ON schedule_overrides TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "insights_daily_service_role"     ON insights_daily     TO service_role USING (true) WITH CHECK (true);

-- ─── Performance indexes ──────────────────────────────────────────────────────

-- reservations: v2 queries filter by tenant + date + staff
CREATE INDEX IF NOT EXISTS idx_reservations_tenant_date_staff
  ON reservations(tenant_id, start_at, tenant_staff_id);

CREATE INDEX IF NOT EXISTS idx_reservations_customer
  ON reservations(customer_id)
  WHERE customer_id IS NOT NULL;

-- slot_locks: availability check needs fast lookup by staff+date, cleanup needs expiry scan
CREATE INDEX IF NOT EXISTS idx_slot_locks_staff_date
  ON slot_locks(tenant_staff_id, date);

CREATE INDEX IF NOT EXISTS idx_slot_locks_expiry
  ON slot_locks(expires_at);

-- schedule_overrides: fast per-staff date lookup
CREATE INDEX IF NOT EXISTS idx_schedule_overrides_date
  ON schedule_overrides(tenant_staff_id, date);

-- customers: routing lookup by phone within a tenant
CREATE INDEX IF NOT EXISTS idx_customers_phone
  ON customers(tenant_id, phone);

-- tenant_users: routing code resolution maps phone → staff/owner
CREATE INDEX IF NOT EXISTS idx_tenant_users_phone
  ON tenant_users(phone)
  WHERE phone IS NOT NULL;

-- whatsapp_conversations: pipeline loads conversation by phone + flow state
CREATE INDEX IF NOT EXISTS idx_whatsapp_conv_flow
  ON whatsapp_conversations(tenant_id, phone_number, current_flow);

-- messages: quota tracker queries by tenant + ai_layer + date
CREATE INDEX IF NOT EXISTS idx_messages_ai_layer
  ON messages(tenant_id, ai_layer, created_at)
  WHERE ai_layer != 'none';

-- tenants: routing code lookup (only non-null codes are searched)
CREATE INDEX IF NOT EXISTS idx_tenants_routing_code
  ON tenants(routing_code)
  WHERE routing_code IS NOT NULL;

-- insights_daily: owner analytics lookup by tenant + date range
CREATE INDEX IF NOT EXISTS idx_insights_daily_tenant_date
  ON insights_daily(tenant_id, date);

-- ─── pg_cron: expired slot lock cleanup ──────────────────────────────────────
-- Runs every minute — removes slot_locks where the 3-minute TTL has elapsed.
-- pg_cron is available on Supabase free tier.
-- The job is named so it can be updated/removed without creating duplicates on re-run.
SELECT cron.schedule(
  'cleanup-slot-locks',
  '* * * * *',
  $$DELETE FROM slot_locks WHERE expires_at < NOW()$$
);
