-- 121_v2_columns_catchup.sql
-- Idempotent ADD COLUMN catch-up for the v2 launch path on databases that were behind
-- on migrations 079/081/095/112/118. Applied to the mercury dev DB 2026-07-07.
-- SAFE: every statement is ADD COLUMN IF NOT EXISTS (no-op if the column already exists).

-- 079: message queue channel discriminator
ALTER TABLE whatsapp_message_queue
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';

-- 081: brand identity + conversation window/opt-out (required by v2 conversationState)
ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opted_out_at    TIMESTAMPTZ;
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS display_name   TEXT,
  ADD COLUMN IF NOT EXISTS brand_emoji    TEXT,
  ADD COLUMN IF NOT EXISTS previous_names JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS renamed_at     TIMESTAMPTZ;

-- 095: AI front desk stage-B hardening
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS price_cents integer,
  ADD COLUMN IF NOT EXISTS duration_minutes integer,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE customer_profile_summary
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE availability_snapshot
  ADD COLUMN IF NOT EXISTS service_id uuid;

-- 112: sales-ops lead lifecycle
ALTER TABLE IF EXISTS leads
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS qualified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_contacted_at timestamptz;

-- 118: support schema reconcile
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS escalated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_by uuid,
  ADD COLUMN IF NOT EXISTS assignee_id uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
