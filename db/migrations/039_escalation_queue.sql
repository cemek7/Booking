-- Migration 039: Escalation Queue
-- Stores chat sessions that have been flagged for human agent takeover.

BEGIN;

CREATE TABLE IF NOT EXISTS escalation_queue (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_phone        TEXT NOT NULL,
  session_id            TEXT NOT NULL,
  reason                TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'claimed', 'resolved', 'timed_out')),
  assigned_agent_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  conversation_snapshot JSONB NOT NULL DEFAULT '[]',
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escalation_tenant_status
  ON escalation_queue (tenant_id, status, created_at DESC);

ALTER TABLE escalation_queue ENABLE ROW LEVEL SECURITY;

-- Tenant staff/managers can view and claim escalations
CREATE POLICY escalation_tenant_access ON escalation_queue
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager', 'staff')
    )
  );

COMMIT;
