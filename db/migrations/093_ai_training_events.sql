-- AI Front Desk Training Events
-- Stage B follow-up: durable interaction capture for evaluation and future tuning

CREATE TABLE IF NOT EXISTS ai_training_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id text,
  channel text,
  user_role text,
  message text NOT NULL,
  intent text,
  grounded_context jsonb,
  llm_response jsonb,
  backend_action text,
  success boolean,
  correction text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_training_events_tenant_created_idx
  ON ai_training_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_training_events_tenant_intent_idx
  ON ai_training_events (tenant_id, intent, created_at DESC);
