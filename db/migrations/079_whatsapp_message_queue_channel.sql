-- 079_whatsapp_message_queue_channel.sql
-- Add a channel discriminator to the message queue so the worker can route each
-- reply to the correct provider adapter (WhatsApp vs Instagram).
-- Additive + WhatsApp-zero-touch: defaults to 'whatsapp' so existing rows/code are unaffected.

BEGIN;

ALTER TABLE whatsapp_message_queue
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';

ALTER TABLE whatsapp_message_queue
  DROP CONSTRAINT IF EXISTS whatsapp_message_queue_channel_check;
ALTER TABLE whatsapp_message_queue
  ADD CONSTRAINT whatsapp_message_queue_channel_check
  CHECK (channel IN ('whatsapp', 'instagram'));

COMMIT;
