+-- Migration 157: atomically record source-backed customer memory facts.

BEGIN;

CREATE OR REPLACE FUNCTION public.record_verified_customer_memory_fact(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_fact_key text,
  p_fact_value jsonb,
  p_source_type text,
  p_source_message_id uuid,
  p_source_record_id uuid,
  p_consent_basis text,
  p_verified_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_new_id uuid := gen_random_uuid();
  v_previous_id uuid;
BEGIN
  IF p_fact_key NOT IN ('preferred_service', 'preferred_staff', 'preferred_time_window', 'consented_contact_name', 'consented_email') THEN
    RAISE EXCEPTION 'unsupported memory fact key';
  END IF;
  IF p_source_type = 'explicit_message' THEN
    IF p_source_message_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.messages m
      JOIN public.conversation_threads ct ON ct.id = m.conversation_thread_id
      WHERE m.id = p_source_message_id AND m.tenant_id = p_tenant_id
        AND ct.tenant_id = p_tenant_id AND ct.customer_id = p_customer_id
        AND m.direction = 'inbound'
    ) THEN
      RAISE EXCEPTION 'memory source message does not belong to tenant/customer';
    END IF;
  ELSIF p_source_type = 'operator' THEN
    IF p_source_record_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.tenant_users tu
      WHERE tu.tenant_id = p_tenant_id AND tu.user_id = p_source_record_id
    ) THEN RAISE EXCEPTION 'operator source does not belong to tenant'; END IF;
  ELSE
    RAISE EXCEPTION 'unsupported memory source type';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':', p_tenant_id, p_customer_id, p_fact_key), 0));

  SELECT id INTO v_previous_id FROM public.customer_memory_facts
  WHERE tenant_id = p_tenant_id AND customer_id = p_customer_id
    AND namespace = 'preference' AND fact_key = p_fact_key AND status = 'active'
  FOR UPDATE;

  UPDATE public.customer_memory_facts
  SET status = 'superseded', updated_at = now()
  WHERE id = v_previous_id;

  INSERT INTO public.customer_memory_facts (
    id, tenant_id, customer_id, namespace, fact_key, fact_value, status,
    source_type, source_message_id, source_record_id, consent_basis, verified_at
  ) VALUES (
    v_new_id, p_tenant_id, p_customer_id, 'preference', p_fact_key, p_fact_value, 'active',
    p_source_type, p_source_message_id, p_source_record_id, p_consent_basis, p_verified_at
  );

  UPDATE public.customer_memory_facts
  SET superseded_by = v_new_id
  WHERE id = v_previous_id;

  RETURN v_new_id;
END
$function$;

REVOKE ALL ON FUNCTION public.record_verified_customer_memory_fact(uuid, uuid, text, jsonb, text, uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_verified_customer_memory_fact(uuid, uuid, text, jsonb, text, uuid, uuid, text, timestamptz) TO service_role;

COMMIT;
