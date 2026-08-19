-- Migration 047: WhatsApp Integration Tables
-- Creates all tables required for Evolution API / WhatsApp integration.
-- Covers: configurations, connections, messages, conversations,
--         connection logs, connection metrics, and message queue.

-- ─────────────────────────────────────────────────────────────
-- 1. Extend the existing messages table with WhatsApp columns
-- ─────────────────────────────────────────────────────────────
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS from_number         TEXT,
  ADD COLUMN IF NOT EXISTS to_number           TEXT,
  ADD COLUMN IF NOT EXISTS content             TEXT,
  ADD COLUMN IF NOT EXISTS message_type        TEXT DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS evolution_message_id TEXT,
  ADD COLUMN IF NOT EXISTS media_info          JSONB,
  ADD COLUMN IF NOT EXISTS media_url           TEXT,
  ADD COLUMN IF NOT EXISTS media_thumbnail     TEXT,
  ADD COLUMN IF NOT EXISTS media_metadata      JSONB,
  ADD COLUMN IF NOT EXISTS timestamp           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw                 JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_messages_from_number   ON messages (tenant_id, from_number);
CREATE INDEX IF NOT EXISTS idx_messages_evolution_id  ON messages (evolution_message_id)
  WHERE evolution_message_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 2. whatsapp_configurations
--    One row per tenant — holds Evolution API credentials
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_configurations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_name       TEXT NOT NULL,
  evolution_base_url  TEXT NOT NULL,
  evolution_api_key   TEXT NOT NULL,
  webhook_url         TEXT,
  active              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id),
  UNIQUE (instance_name)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_cfg_tenant   ON whatsapp_configurations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_cfg_instance ON whatsapp_configurations (instance_name);

-- ─────────────────────────────────────────────────────────────
-- 3. whatsapp_connections
--    Live connection state per instance (upserted by connectionManager)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_connections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_name    TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'disconnected'
                     CHECK (status IN ('connected','disconnected','connecting','error','reconnecting')),
  phone_number     TEXT,
  battery_level    INTEGER,
  signal_strength  INTEGER,
  is_business      BOOLEAN NOT NULL DEFAULT false,
  profile_name     TEXT,
  profile_picture  TEXT,
  qr_code          TEXT,
  webhook_url      TEXT,
  error_message    TEXT,
  connection_time  TIMESTAMPTZ,
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, instance_name)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conn_tenant ON whatsapp_connections (tenant_id);

-- ─────────────────────────────────────────────────────────────
-- 4. whatsapp_conversations
--    One row per phone-number/tenant pair
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number  TEXT NOT NULL,
  customer_name TEXT,
  session_id    TEXT,
  current_step  TEXT DEFAULT 'greeting',
  context       JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_activity TIMESTAMPTZ NOT NULL DEFAULT now(),
  unread_count  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conv_tenant        ON whatsapp_conversations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conv_last_activity ON whatsapp_conversations (tenant_id, last_activity DESC);

-- ─────────────────────────────────────────────────────────────
-- 5. whatsapp_connection_logs
--    Append-only log for connection events / errors
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_connection_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  level         TEXT NOT NULL DEFAULT 'info'
                  CHECK (level IN ('debug','info','warn','error')),
  message       TEXT NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_tenant   ON whatsapp_connection_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_instance ON whatsapp_connection_logs (instance_name, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 6. whatsapp_connection_metrics
--    Rolling metrics per instance (upserted periodically)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_connection_metrics (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_name            TEXT NOT NULL,
  messages_sent_today      INTEGER NOT NULL DEFAULT 0,
  messages_received_today  INTEGER NOT NULL DEFAULT 0,
  uptime_percentage        NUMERIC(5,2) NOT NULL DEFAULT 100,
  average_response_time    NUMERIC(10,2),
  error_count_24h          INTEGER NOT NULL DEFAULT 0,
  total_conversations      INTEGER NOT NULL DEFAULT 0,
  active_conversations     INTEGER NOT NULL DEFAULT 0,
  last_message_timestamp   TIMESTAMPTZ,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, instance_name)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_metrics_tenant ON whatsapp_connection_metrics (tenant_id);

-- ─────────────────────────────────────────────────────────────
-- 7. whatsapp_message_queue
--    Async processing queue (populated by webhook, drained by processor)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_message_queue (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id   TEXT NOT NULL,
  from_number  TEXT NOT NULL,
  to_number    TEXT NOT NULL,
  content      TEXT NOT NULL DEFAULT '',
  priority     TEXT NOT NULL DEFAULT 'normal'
                 CHECK (priority IN ('low','normal','high','urgent')),
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','processing','completed','failed','retry')),
  retry_count  INTEGER NOT NULL DEFAULT 0,
  max_retries  INTEGER NOT NULL DEFAULT 3,
  scheduled_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_queue_pending ON whatsapp_message_queue (tenant_id, status, created_at)
  WHERE status IN ('pending','retry');
