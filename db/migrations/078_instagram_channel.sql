-- 078_instagram_channel.sql
-- Generalize whatsapp_conversations to support multiple channels (WhatsApp + Instagram).
-- ADDITIVE + WhatsApp-zero-touch: the existing UNIQUE(tenant_id, phone_number) and the
-- ensureConversation onConflict('phone_number,tenant_id') both stay valid.

BEGIN;

-- 1. Channel discriminator. Existing rows are WhatsApp.
ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';

-- 2. Per-channel external customer id (phone for WA, IGSID for IG).
ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS external_id TEXT;

-- 3. Backfill existing WhatsApp rows.
UPDATE whatsapp_conversations
  SET external_id = phone_number
  WHERE external_id IS NULL AND phone_number IS NOT NULL;

-- 4. phone_number is no longer required (Instagram rows have none).
ALTER TABLE whatsapp_conversations
  ALTER COLUMN phone_number DROP NOT NULL;

-- 5. Constrain channel to known values.
ALTER TABLE whatsapp_conversations
  DROP CONSTRAINT IF EXISTS whatsapp_conversations_channel_check;
ALTER TABLE whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_channel_check
  CHECK (channel IN ('whatsapp', 'instagram'));

-- 6. Enforce uniqueness on the general channel key (covers both WA and IG).
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_conv_channel_external
  ON whatsapp_conversations (tenant_id, channel, external_id)
  WHERE external_id IS NOT NULL;

-- 7. Lookup index for channel-keyed reads.
CREATE INDEX IF NOT EXISTS idx_wa_conv_channel_external
  ON whatsapp_conversations (tenant_id, channel, external_id);

COMMIT;
