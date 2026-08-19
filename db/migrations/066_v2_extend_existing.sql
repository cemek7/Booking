-- Migration 066: v2 additive extensions to existing tables
-- SAFE: Only ADD COLUMN / DROP NOT NULL. No renames, drops, or retypes.
-- Existing v1 rows and columns are completely unaffected.

-- ─── tenant_users ────────────────────────────────────────────────────────────
-- WA-native staff (onboarded via chat) have no Supabase auth account.
-- Make user_id nullable so they can be stored with phone only.
-- Existing v1 rows keep their user_id values; NOT NULL constraint is simply lifted.
ALTER TABLE tenant_users ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS services_all BOOLEAN DEFAULT TRUE;
-- services_all = TRUE means this staff can perform any service (common for solo operators)

-- ─── staff_services ──────────────────────────────────────────────────────────
-- Per-stylist / per-staff pricing support (NULL = use service base price)
ALTER TABLE staff_services ADD COLUMN IF NOT EXISTS price_override NUMERIC(10,2);

-- ─── staff_schedules ─────────────────────────────────────────────────────────
-- Break windows within a shift (e.g. lunch 13:00–14:00)
ALTER TABLE staff_schedules ADD COLUMN IF NOT EXISTS break_start TIME;
ALTER TABLE staff_schedules ADD COLUMN IF NOT EXISTS break_end TIME;
-- WA-native staff reference: existing staff_id → auth.users, new column → tenant_users
-- v1 schedules continue using staff_id; v2 WA-native schedules use tenant_user_id
ALTER TABLE staff_schedules ADD COLUMN IF NOT EXISTS tenant_user_id UUID
  REFERENCES tenant_users(id) ON DELETE CASCADE;

-- ─── reservations ────────────────────────────────────────────────────────────
-- staff_id + service_id already added in migration 043b — no touch needed.
-- Parallel staff reference for WA-native staff (v1 uses staff_id → auth.users)
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS tenant_staff_id UUID
  REFERENCES tenant_users(id) ON DELETE SET NULL;
-- Stable customer identity (FK added in migration 067 after customers table created)
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS customer_id UUID;
-- Reminder tracking flags
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS reminder_24h_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS reminder_2h_sent BOOLEAN DEFAULT FALSE;
-- Confirmation timestamp (set when customer replies YES to the confirmation message)
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

-- ─── services ────────────────────────────────────────────────────────────────
-- Fuzzy/alias matching: ["That thread thing", "Eyebrow work"] → "Eyebrow Threading"
ALTER TABLE services ADD COLUMN IF NOT EXISTS aliases TEXT[] DEFAULT '{}';
-- Display ordering in customer-facing service lists
ALTER TABLE services ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;

-- ─── whatsapp_conversations ───────────────────────────────────────────────────
-- v2 typed flow columns (existing current_step + context jsonb left untouched for v1)
ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS role TEXT
  DEFAULT 'customer'
  CHECK (role IN ('owner', 'staff', 'customer', 'unknown'));
ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS current_flow TEXT
  DEFAULT 'idle'
  CHECK (current_flow IN ('idle', 'onboarding', 'booking', 'managing'));
ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS flow_step INT DEFAULT 0;
ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS flow_data JSONB DEFAULT '{}';

-- ─── messages ────────────────────────────────────────────────────────────────
-- Track which AI layer handled each message for quota and analytics purposes
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ai_layer TEXT
  DEFAULT 'none'
  CHECK (ai_layer IN ('none', 'rules', 'lite', 'flash'));
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tokens_used INT DEFAULT 0;

-- ─── tenants ─────────────────────────────────────────────────────────────────
-- 6-char routing code (e.g. GLAM01) — unique per tenant, generated on v2 activation
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS routing_code TEXT UNIQUE;
-- Buffer time between appointments in minutes (default 15, owner can customise)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS buffer_minutes INT DEFAULT 15;
-- IANA timezone string for correct slot calculation (default WAT)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Africa/Lagos';
-- Master switch: all v2 code paths gated behind this flag
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS v2_enabled BOOLEAN DEFAULT FALSE;
-- Note: onboarding_step is stored in tenants.settings JSONB (already exists)
