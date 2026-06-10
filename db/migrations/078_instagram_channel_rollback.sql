-- Rollback for 078_instagram_channel.sql
-- Safe ONLY before any Instagram rows exist (otherwise SET NOT NULL will fail).
BEGIN;
DROP INDEX IF EXISTS uq_wa_conv_channel_external;
DROP INDEX IF EXISTS idx_wa_conv_channel_external;
ALTER TABLE whatsapp_conversations DROP CONSTRAINT IF EXISTS whatsapp_conversations_channel_check;
-- Only re-add NOT NULL if there are no NULL phone_numbers (no IG rows):
ALTER TABLE whatsapp_conversations ALTER COLUMN phone_number SET NOT NULL;
ALTER TABLE whatsapp_conversations DROP COLUMN IF EXISTS external_id;
ALTER TABLE whatsapp_conversations DROP COLUMN IF EXISTS channel;
COMMIT;
