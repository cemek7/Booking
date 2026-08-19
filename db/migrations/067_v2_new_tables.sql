-- Migration 067: v2 new tables (only those with no existing equivalent)
-- Run AFTER 066 (tenant_users must already have the extended schema)

-- ─── customers ───────────────────────────────────────────────────────────────
-- Phone-based customer identity for WhatsApp interactions.
-- Previously reservations stored customer_name + phone as free-text fields with no
-- stable ID. This table provides a stable UUID per (tenant, phone) pair.
-- Note: customer_analytics table already has a FK reference to this table
-- (created earlier) — this CREATE satisfies that reference.
CREATE TABLE IF NOT EXISTS customers (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone        TEXT        NOT NULL,
  name         TEXT,
  first_seen   TIMESTAMPTZ DEFAULT NOW(),
  last_visit   TIMESTAMPTZ,
  total_bookings INT       DEFAULT 0,
  no_show_count  INT       DEFAULT 0,
  UNIQUE (tenant_id, phone)
);

-- Now that customers exists, wire up the FK on reservations.customer_id
-- (the column was added in migration 066 without a FK to avoid ordering issues)
ALTER TABLE reservations
  ADD CONSTRAINT fk_reservations_customer
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

-- ─── slot_locks ──────────────────────────────────────────────────────────────
-- 3-minute TTL holds that prevent double-booking during the confirmation window.
-- A slot is locked when the system presents the confirmation message to a customer
-- and released when they confirm (→ reservation created) or the TTL expires.
-- pg_cron cleans expired rows every minute (added in migration 068).
CREATE TABLE IF NOT EXISTS slot_locks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_staff_id UUID        NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
  date            DATE        NOT NULL,
  start_time      TIME        NOT NULL,
  end_time        TIME        NOT NULL,
  customer_phone  TEXT        NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '3 minutes')
);

-- ─── schedule_overrides ───────────────────────────────────────────────────────
-- Date-specific exceptions on top of the recurring weekly staff_schedules.
-- staff_schedules holds recurring patterns (Mon 9am–5pm every week).
-- This table handles: sick days, holidays, extended hours, custom one-off availability.
-- is_blocked = TRUE means full day off; custom_start/end override hours for that day.
CREATE TABLE IF NOT EXISTS schedule_overrides (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_staff_id UUID    NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
  date            DATE    NOT NULL,
  is_blocked      BOOLEAN DEFAULT FALSE,
  custom_start    TIME,
  custom_end      TIME,
  reason          TEXT,
  UNIQUE (tenant_staff_id, date)
);

-- ─── insights_daily ──────────────────────────────────────────────────────────
-- Pre-computed daily metrics so owner queries like "how was today?" return instantly
-- without running aggregate queries over the reservations table on demand.
-- Populated nightly by src/app/api/cron/nightly/route.ts (Vercel cron #2).
CREATE TABLE IF NOT EXISTS insights_daily (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date           DATE         NOT NULL,
  total_bookings INT          DEFAULT 0,
  completed      INT          DEFAULT 0,
  cancelled      INT          DEFAULT 0,
  no_shows       INT          DEFAULT 0,
  revenue        NUMERIC(12,2) DEFAULT 0,
  busiest_hour   INT,
  top_service_id UUID         REFERENCES services(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, date)
);
