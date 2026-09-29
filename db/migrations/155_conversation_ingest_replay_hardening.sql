-- Correct replay lookup for migration 153 atomic conversation ingestion.
-- A provider retry receives a new internal UUID, so replay identity must use
-- the stable tenant/channel/provider message tuple.

BEGIN;

CREATE OR REPLACE FUNCTION public.ingest_conversation_message(
  p_webhook_provider text,
  p_webhook_external_id text,
  p_webhook_payload jsonb,
  p_message_id uuid,
  p_tenant_id uuid,
  p_conversation_id uuid,
  p_thread_id uuid,
  p_channel text,
  p_from_number text,
  p_to_number text,
  p_content text,
  p_message_type text,
  p_provider_message_id text,
  p_provider_timestamp timestamptz,
  p_raw jsonb,
  p_media_info jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  queue_id uuid;
  inserted_event_count integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_conversations
    WHERE id = p_conversation_id AND tenant_id = p_tenant_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.conversation_threads
    WHERE id = p_thread_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'conversation/thread tenant mismatch';
  END IF;

  INSERT INTO public.webhook_events (provider, external_id, payload, tenant_id, processed_at, created_at)
  VALUES (p_webhook_provider, p_webhook_external_id, COALESCE(p_webhook_payload, '{}'::jsonb), p_tenant_id, NULL, now())
  ON CONFLICT (provider, external_id) DO NOTHING;
  GET DIAGNOSTICS inserted_event_count = ROW_COUNT;

  IF inserted_event_count = 0 THEN
    SELECT q.id INTO queue_id
    FROM public.whatsapp_message_queue q
    JOIN public.messages m ON m.id::text = q.message_id
    WHERE q.tenant_id = p_tenant_id
      AND q.channel = p_channel
      AND m.tenant_id = p_tenant_id
      AND m.channel = p_channel
      AND m.provider_message_id = p_provider_message_id
    ORDER BY q.created_at
    LIMIT 1;
    IF queue_id IS NULL THEN
      RAISE EXCEPTION 'webhook replay exists without an ingested queue row';
    END IF;
    RETURN queue_id;
  END IF;

  INSERT INTO public.messages (
    id, tenant_id, direction, channel, from_number, to_number, content,
    message_type, provider_message_id, evolution_message_id, timestamp,
    raw, media_info, conversation_thread_id, created_at
  ) VALUES (
    p_message_id, p_tenant_id, 'inbound', p_channel, p_from_number, p_to_number,
    COALESCE(p_content, ''), COALESCE(p_message_type, 'text'), p_provider_message_id,
    p_provider_message_id, COALESCE(p_provider_timestamp, now()),
    COALESCE(p_raw, '{}'::jsonb), p_media_info, p_thread_id, now()
  );

  INSERT INTO public.whatsapp_message_queue (
    tenant_id, message_id, from_number, to_number, content, status, priority,
    channel, conversation_id, conversation_thread_id, provider_timestamp
  ) VALUES (
    p_tenant_id, p_message_id::text, p_from_number, p_to_number, COALESCE(p_content, ''),
    'pending', 'normal', p_channel, p_conversation_id, p_thread_id,
    COALESCE(p_provider_timestamp, now())
  )
  RETURNING id INTO queue_id;

  UPDATE public.webhook_events
  SET processed_at = now()
  WHERE provider = p_webhook_provider AND external_id = p_webhook_external_id;

  RETURN queue_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.ingest_conversation_message(text, text, jsonb, uuid, uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_conversation_message(text, text, jsonb, uuid, uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, jsonb, jsonb) TO service_role;

COMMIT;
