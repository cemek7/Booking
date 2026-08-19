-- 081_tenant_brand_identity.sql
-- SAFE: ADD COLUMN only. No renames, drops, or retypes.
-- Pre-flight: `tenants` and `whatsapp_conversations` both exist (referenced in
-- src/lib/whatsapp/v2/identityResolver.ts and conversationState.ts).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS display_name   TEXT,
  ADD COLUMN IF NOT EXISTS brand_emoji    TEXT,
  ADD COLUMN IF NOT EXISTS previous_names JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS renamed_at     TIMESTAMPTZ;

ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opted_out_at    TIMESTAMPTZ;

-- Backfill last_inbound_at so existing conversations have a baseline (idempotent).
UPDATE whatsapp_conversations
   SET last_inbound_at = updated_at
 WHERE last_inbound_at IS NULL;
