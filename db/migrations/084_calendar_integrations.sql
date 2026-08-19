-- 084_calendar_integrations.sql
-- Creates the calendar_integrations table that the Google Calendar feature
-- (src/lib/integrations/googleCalendar.ts, /api/calendar/callback) reads/writes
-- and that the off-boarding teardown (revoke_calendar) deletes — but which had
-- NO migration. Columns derived from the code's usage (upsert onConflict
-- 'tenant_id, staff_id, provider'; token refresh by calendar_id).
-- SAFE: CREATE TABLE IF NOT EXISTS only. Review against the calendar feature
-- before running if that feature later defines additional columns.

CREATE TABLE IF NOT EXISTS calendar_integrations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id       UUID,                              -- nullable: tenant-level or per-staff
  provider       TEXT NOT NULL DEFAULT 'google',
  calendar_id    TEXT NOT NULL,
  email          TEXT,
  access_token   TEXT,
  refresh_token  TEXT,
  sync_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  sync_direction TEXT,                              -- e.g. 'two_way' | 'push' | 'pull'
  events_synced  INTEGER NOT NULL DEFAULT 0,
  last_synced    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upsert conflict target used by googleCalendar.ts.
CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_integrations_tenant_staff_provider
  ON calendar_integrations (tenant_id, staff_id, provider);
CREATE INDEX IF NOT EXISTS idx_calendar_integrations_tenant ON calendar_integrations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_calendar_integrations_calendar_id ON calendar_integrations (calendar_id);
