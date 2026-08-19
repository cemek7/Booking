-- Migration 073: Add concurrency-safe queue claim RPC for v2 WhatsApp worker
-- Claims due rows from whatsapp_message_queue using FOR UPDATE SKIP LOCKED.

CREATE OR REPLACE FUNCTION public.claim_whatsapp_queue_messages(p_limit integer DEFAULT 20)
RETURNS SETOF public.whatsapp_message_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := GREATEST(COALESCE(p_limit, 20), 1);
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT q.id
    FROM public.whatsapp_message_queue q
    WHERE q.status IN ('pending', 'retry')
      AND (q.scheduled_at IS NULL OR q.scheduled_at <= NOW())
    ORDER BY
      CASE q.priority
        WHEN 'urgent' THEN 4
        WHEN 'high' THEN 3
        WHEN 'normal' THEN 2
        ELSE 1
      END DESC,
      q.created_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.whatsapp_message_queue q
  SET status = 'processing'
  FROM claimed
  WHERE q.id = claimed.id
  RETURNING q.*;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_whatsapp_queue_messages(integer) TO service_role;
