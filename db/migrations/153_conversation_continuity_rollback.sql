-- 153_conversation_continuity_rollback.sql
-- Destructive rollback. Refuses to discard continuity data unless the operator
-- explicitly opts in for a verified empty/non-production rollback.

BEGIN;

DO $rollback_guard$
DECLARE
  row_total bigint;
BEGIN
  SELECT
    (SELECT count(*) FROM public.shared_channel_route_sessions) +
    (SELECT count(*) FROM public.customer_channel_identities) +
    (SELECT count(*) FROM public.conversation_threads) +
    (SELECT count(*) FROM public.customer_memory_facts) +
    (SELECT count(*) FROM public.conversation_effects)
  INTO row_total;

  IF row_total > 0
     AND current_setting('booka.allow_continuity_data_loss', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Migration 153 contains % continuity rows; set booka.allow_continuity_data_loss=on only after an approved backup', row_total;
  END IF;
END
$rollback_guard$;

DROP FUNCTION IF EXISTS public.claim_whatsapp_conversation_batch(uuid, timestamptz, integer);
DROP FUNCTION IF EXISTS public.ingest_conversation_message(text, text, jsonb, uuid, uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.update_conversation_thread_state(uuid, uuid, bigint, jsonb);
DROP FUNCTION IF EXISTS public.update_conversation_thread_summary(uuid, uuid, timestamptz, text, timestamptz);
DROP FUNCTION IF EXISTS public.merge_customers_tx(uuid, uuid, uuid);

DO $restore_merge$
BEGIN
  IF to_regprocedure('public.merge_customers_core_tx(uuid,uuid,uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.merge_customers_core_tx(uuid, uuid, uuid)
      RENAME TO merge_customers_tx;
  END IF;
END
$restore_merge$;

ALTER TABLE public.whatsapp_message_queue
  DROP COLUMN IF EXISTS batch_id,
  DROP COLUMN IF EXISTS lease_expires_at,
  DROP COLUMN IF EXISTS lease_owner,
  DROP COLUMN IF EXISTS provider_timestamp,
  DROP COLUMN IF EXISTS conversation_thread_id,
  DROP COLUMN IF EXISTS conversation_id;

ALTER TABLE public.messages
  DROP COLUMN IF EXISTS idempotency_key,
  DROP COLUMN IF EXISTS delivery_status,
  DROP COLUMN IF EXISTS provider_message_id,
  DROP COLUMN IF EXISTS conversation_thread_id;

ALTER TABLE public.whatsapp_conversations
  DROP COLUMN IF EXISTS active_thread_id,
  DROP COLUMN IF EXISTS customer_id,
  DROP COLUMN IF EXISTS state_version;

DROP TABLE IF EXISTS public.conversation_effects;
DROP TABLE IF EXISTS public.customer_memory_facts;
DROP TABLE IF EXISTS public.conversation_threads;
DROP TABLE IF EXISTS public.customer_channel_identities;
DROP TABLE IF EXISTS public.shared_channel_route_sessions;

COMMIT;
