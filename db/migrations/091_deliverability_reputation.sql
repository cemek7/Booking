-- 091_deliverability_reputation.sql
-- Shared-number deliverability guardrails for initiated WhatsApp sends.
-- Safe to re-run: CREATE TABLE/INDEX IF NOT EXISTS only.

CREATE TABLE IF NOT EXISTS message_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID,
  message_type  TEXT NOT NULL,
  template_name TEXT NOT NULL,
  language      TEXT NOT NULL DEFAULT 'en_US',
  param_mapping JSONB NOT NULL DEFAULT '[]'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_templates_key
  ON message_templates (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), message_type, language);

CREATE TABLE IF NOT EXISTS tenant_messaging_stats (
  tenant_id                UUID PRIMARY KEY,
  window_start             TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_24h                 INT NOT NULL DEFAULT 0,
  initiated_24h            INT NOT NULL DEFAULT 0,
  initiated_recipients_24h INT NOT NULL DEFAULT 0,
  recipients_seen          JSONB NOT NULL DEFAULT '[]'::jsonb,
  cold_outbound_24h        INT NOT NULL DEFAULT 0,
  opt_outs_24h             INT NOT NULL DEFAULT 0,
  failures_24h             INT NOT NULL DEFAULT 0,
  risk_score               NUMERIC NOT NULL DEFAULT 0,
  quarantined_until        TIMESTAMPTZ,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS whatsapp_number_quality (
  phone_number_id TEXT PRIMARY KEY,
  quality_rating  TEXT NOT NULL DEFAULT 'UNKNOWN',
  messaging_tier  TEXT,
  limit_per_24h   INT NOT NULL DEFAULT 1000,
  account_status  TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
