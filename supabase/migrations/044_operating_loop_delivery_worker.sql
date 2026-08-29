-- Migration 044: atomically claim and reconcile Daily Operating Loop delivery.
-- This outbox is intentionally separate from the inbound WhatsApp pipeline.
BEGIN;

CREATE FUNCTION public.claim_operating_deliveries(p_limit INTEGER)
RETURNS TABLE(
  id UUID,
  tenant_id UUID,
  action_id UUID,
  objective_id UUID,
  recipient TEXT,
  payload JSONB,
  idempotency_key TEXT,
  attempt_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'operating delivery batch limit must be between 1 and 50' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH claimed AS (
    SELECT outbox.id
    FROM public.operating_delivery_outbox outbox
    WHERE outbox.status IN ('pending', 'retry')
      AND outbox.available_at <= now()
    ORDER BY outbox.available_at, outbox.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.operating_delivery_outbox outbox
  SET status = 'processing',
      attempt_count = outbox.attempt_count + 1,
      updated_at = now()
  FROM claimed
  WHERE outbox.id = claimed.id
  RETURNING outbox.id, outbox.tenant_id, outbox.action_id, outbox.objective_id,
    outbox.recipient, outbox.payload, outbox.idempotency_key, outbox.attempt_count;
END;
$$;

CREATE FUNCTION public.complete_operating_delivery(
  p_outbox_id UUID,
  p_status TEXT,
  p_provider_message_id TEXT,
  p_error TEXT,
  p_available_at TIMESTAMPTZ
)
RETURNS TABLE(outbox_id UUID, status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_outbox public.operating_delivery_outbox%ROWTYPE;
BEGIN
  IF p_status NOT IN ('sent', 'held', 'retry', 'dead_letter') THEN
    RAISE EXCEPTION 'operating delivery completion status is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'sent' AND nullif(btrim(p_provider_message_id), '') IS NULL THEN
    RAISE EXCEPTION 'sent delivery requires a provider message reference' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'retry' AND (p_available_at IS NULL OR p_available_at <= now()) THEN
    RAISE EXCEPTION 'retry must specify a future available_at' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_outbox
  FROM public.operating_delivery_outbox
  WHERE id = p_outbox_id
  FOR UPDATE;
  IF NOT FOUND OR v_outbox.status <> 'processing' THEN
    RAISE EXCEPTION 'operating delivery is not claimed' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.operating_delivery_outbox AS outbox
  SET status = p_status,
      provider_message_id = coalesce(nullif(btrim(p_provider_message_id), ''), outbox.provider_message_id),
      last_error = nullif(btrim(p_error), ''),
      available_at = CASE WHEN p_status = 'retry' THEN p_available_at ELSE outbox.available_at END,
      updated_at = now()
  WHERE outbox.id = v_outbox.id;

  IF p_status = 'sent' THEN
    UPDATE public.operating_objectives AS objective
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE objective.tenant_id = v_outbox.tenant_id AND objective.id = v_outbox.objective_id AND objective.status = 'queued';

    UPDATE public.operating_actions AS action
    SET status = 'sent',
        delivery_reference = coalesce(nullif(btrim(p_provider_message_id), ''), action.delivery_reference),
        result_payload = jsonb_build_object('delivery_status', 'sent')
    WHERE action.tenant_id = v_outbox.tenant_id AND action.id = v_outbox.action_id;
  ELSIF p_status IN ('held', 'dead_letter') THEN
    UPDATE public.operating_actions AS action
    SET status = CASE WHEN p_status = 'dead_letter' THEN 'failed' ELSE action.status END,
        result_payload = jsonb_build_object('delivery_status', p_status, 'reason', nullif(btrim(p_error), ''))
    WHERE action.tenant_id = v_outbox.tenant_id AND action.id = v_outbox.action_id;
  END IF;

  RETURN QUERY SELECT v_outbox.id, p_status;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_operating_deliveries(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_operating_delivery(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_operating_deliveries(INTEGER),
  public.complete_operating_delivery(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
COMMIT;
