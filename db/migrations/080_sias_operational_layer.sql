-- Migration 080: SIAS operational layer
-- Adds campaign audit, outcome attribution, and operational memory tables.

BEGIN;

CREATE TABLE IF NOT EXISTS sias_campaign_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_type     TEXT NOT NULL,
  action            TEXT NOT NULL,
  target_phone      TEXT,
  target_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  target_booking_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  source_event      TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'sent', 'completed', 'retry_scheduled', 'failed', 'cancelled')),
  attempts          INT NOT NULL DEFAULT 0,
  max_attempts      INT NOT NULL DEFAULT 5,
  scheduled_for     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_retry_at     TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  error             TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  attribution       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sias_campaign_runs_tenant_status
  ON sias_campaign_runs (tenant_id, status, scheduled_for DESC);

CREATE INDEX IF NOT EXISTS idx_sias_campaign_runs_retry
  ON sias_campaign_runs (tenant_id, next_retry_at DESC)
  WHERE next_retry_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS sias_outcome_attributions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reservation_id    UUID REFERENCES reservations(id) ON DELETE SET NULL,
  customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_phone    TEXT,
  signal            TEXT NOT NULL,
  source_event      TEXT NOT NULL,
  attributed_to     TEXT,
  value             NUMERIC(12,2) NOT NULL DEFAULT 1,
  window_hours      INT,
  campaign_run_id   UUID REFERENCES sias_campaign_runs(id) ON DELETE SET NULL,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sias_outcome_attributions_tenant_signal
  ON sias_outcome_attributions (tenant_id, signal, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sias_outcome_attributions_reservation
  ON sias_outcome_attributions (reservation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sias_operational_memory (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  memory_key        TEXT NOT NULL,
  memory_value      JSONB NOT NULL DEFAULT '{}'::jsonb,
  source            TEXT,
  confidence        NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  hit_count         INT NOT NULL DEFAULT 1,
  last_seen_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, memory_key)
);

CREATE INDEX IF NOT EXISTS idx_sias_operational_memory_tenant_last_seen
  ON sias_operational_memory (tenant_id, last_seen_at DESC);

ALTER TABLE sias_campaign_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sias_outcome_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sias_operational_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sias_campaign_runs_tenant_access ON sias_campaign_runs;
CREATE POLICY sias_campaign_runs_tenant_access ON sias_campaign_runs
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager', 'staff')
    )
  );

DROP POLICY IF EXISTS sias_outcome_attributions_tenant_access ON sias_outcome_attributions;
CREATE POLICY sias_outcome_attributions_tenant_access ON sias_outcome_attributions
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager', 'staff')
    )
  );

DROP POLICY IF EXISTS sias_operational_memory_tenant_access ON sias_operational_memory;
CREATE POLICY sias_operational_memory_tenant_access ON sias_operational_memory
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager', 'staff')
    )
  );

COMMIT;
