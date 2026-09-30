-- GENERATED FILE. DO NOT EDIT DIRECTLY.
-- Regenerate with: npm run db:bundle:conversation-continuity
-- Run first in staging Supabase SQL Editor after confirming backup/PITR.

BEGIN;

-- source: db/releases/2026-09-28-conversation-continuity.sql
-- 153_conversation_continuity.sql
-- Expand-only foundation for tenant-safe shared-channel routing, durable
-- conversation threads, verified memory, atomic ingestion, and leased batching.


CREATE TABLE IF NOT EXISTS public.shared_channel_route_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'instagram')),
  gateway_scope text NOT NULL,
  external_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('routing_code', 'dedicated_number', 'instagram_recipient', 'operator')),
  expires_at timestamptz NOT NULL,
  last_routed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, gateway_scope, external_id)
);

CREATE TABLE IF NOT EXISTS public.customer_channel_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'instagram')),
  external_id text NOT NULL,
  verification_state text NOT NULL DEFAULT 'channel_verified'
    CHECK (verification_state IN ('unverified', 'channel_verified', 'cross_channel_verified')),
  verified_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel, external_id)
);

CREATE TABLE IF NOT EXISTS public.conversation_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  channel_identity_id uuid REFERENCES public.customer_channel_identities(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'instagram')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'abandoned', 'handed_off', 'closed')),
  structured_state jsonb NOT NULL DEFAULT '{"confirmed":{},"proposed":{},"missing":[]}'::jsonb,
  rolling_summary text,
  summary_through_message_at timestamptz,
  state_version bigint NOT NULL DEFAULT 0,
  human_handling_until timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_memory_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  namespace text NOT NULL DEFAULT 'preference',
  fact_key text NOT NULL,
  fact_value jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded', 'revoked', 'expired')),
  source_type text NOT NULL CHECK (source_type IN ('explicit_message', 'operator')),
  source_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  source_record_id uuid,
  confidence numeric(4,3) NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  consent_basis text,
  verified_at timestamptz,
  expires_at timestamptz,
  superseded_by uuid REFERENCES public.customer_memory_facts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.conversation_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.conversation_threads(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  effect_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('started', 'succeeded', 'failed', 'delivery_unknown')),
  result_ref text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS active_thread_id uuid REFERENCES public.conversation_threads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS state_version bigint NOT NULL DEFAULT 0;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS conversation_thread_id uuid REFERENCES public.conversation_threads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS delivery_status text,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE public.whatsapp_message_queue
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS conversation_thread_id uuid REFERENCES public.conversation_threads(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS provider_timestamp timestamptz,
  ADD COLUMN IF NOT EXISTS lease_owner uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS batch_id uuid;

CREATE INDEX IF NOT EXISTS idx_route_sessions_expiry
  ON public.shared_channel_route_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_channel_identities_customer
  ON public.customer_channel_identities (tenant_id, customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_threads_active_identity
  ON public.conversation_threads (tenant_id, channel_identity_id)
  WHERE status IN ('active', 'handed_off');
CREATE INDEX IF NOT EXISTS idx_conversation_threads_customer
  ON public.conversation_threads (tenant_id, customer_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_memory_active_fact
  ON public.customer_memory_facts (tenant_id, customer_id, namespace, fact_key)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_customer_memory_active
  ON public.customer_memory_facts (tenant_id, customer_id, updated_at DESC)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_messages_thread_order
  ON public.messages (tenant_id, conversation_thread_id, COALESCE(timestamp, created_at), created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_provider_identity
  ON public.messages (tenant_id, channel, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_queue_due_lease
  ON public.whatsapp_message_queue (status, scheduled_at, lease_expires_at, created_at);

DO $queue_duplicate_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.whatsapp_message_queue
    GROUP BY tenant_id, channel, message_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate WhatsApp queue deliveries exist; reconcile before migration 153';
  END IF;
END
$queue_duplicate_preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_queue_delivery
  ON public.whatsapp_message_queue (tenant_id, channel, message_id);

ALTER TABLE public.shared_channel_route_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_channel_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_memory_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_effects ENABLE ROW LEVEL SECURITY;

DO $policies$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'shared_channel_route_sessions',
    'customer_channel_identities',
    'conversation_threads',
    'customer_memory_facts',
    'conversation_effects'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_member_select', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.tenant_users tu WHERE tu.tenant_id = %I.tenant_id AND tu.user_id = auth.uid() AND tu.role IN (''owner'', ''manager'')))',
      table_name || '_member_select', table_name, table_name
    );
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_service_role', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      table_name || '_service_role', table_name
    );
  END LOOP;
END
$policies$;

CREATE OR REPLACE FUNCTION public.claim_whatsapp_conversation_batch(
  p_worker_id uuid,
  p_settle_before timestamptz,
  p_lease_seconds integer DEFAULT 120
)
RETURNS SETOF public.whatsapp_message_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  candidate public.whatsapp_message_queue%ROWTYPE;
  claimed_batch_id uuid := gen_random_uuid();
  lock_key text;
BEGIN
  IF p_worker_id IS NULL OR p_settle_before IS NULL THEN
    RAISE EXCEPTION 'worker id and settle cutoff are required';
  END IF;

  UPDATE public.whatsapp_message_queue
  SET status = 'retry', lease_owner = NULL, lease_expires_at = NULL, batch_id = NULL
  WHERE status = 'processing'
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at <= now();

  SELECT q.* INTO candidate
  FROM public.whatsapp_message_queue q
  WHERE q.status IN ('pending', 'retry')
    AND (q.scheduled_at IS NULL OR q.scheduled_at <= now())
    AND COALESCE(q.provider_timestamp, q.created_at) <= p_settle_before
    AND q.conversation_id IS NOT NULL
    AND q.conversation_thread_id IS NOT NULL
  ORDER BY
    CASE q.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC,
    COALESCE(q.provider_timestamp, q.created_at), q.created_at, q.id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  lock_key := concat_ws(':', candidate.tenant_id, candidate.channel, candidate.from_number, candidate.conversation_thread_id);
  IF NOT pg_try_advisory_xact_lock(hashtextextended(lock_key, 153)) THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.whatsapp_message_queue q
  SET status = 'processing',
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => GREATEST(COALESCE(p_lease_seconds, 120), 30)),
      batch_id = claimed_batch_id
  WHERE q.tenant_id = candidate.tenant_id
    AND q.channel = candidate.channel
    AND q.from_number = candidate.from_number
    AND q.conversation_thread_id = candidate.conversation_thread_id
    AND q.status IN ('pending', 'retry')
    AND (q.scheduled_at IS NULL OR q.scheduled_at <= now())
    AND COALESCE(q.provider_timestamp, q.created_at) <= p_settle_before
  RETURNING q.*;
END;
$function$;

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

CREATE OR REPLACE FUNCTION public.update_conversation_thread_state(
  p_tenant_id uuid,
  p_thread_id uuid,
  p_expected_version bigint,
  p_structured_state jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  next_version bigint;
BEGIN
  UPDATE public.conversation_threads
  SET structured_state = COALESCE(p_structured_state, '{}'::jsonb),
      state_version = state_version + 1,
      updated_at = now()
  WHERE id = p_thread_id
    AND tenant_id = p_tenant_id
    AND state_version = p_expected_version
  RETURNING state_version INTO next_version;

  IF next_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'conversation state version conflict';
  END IF;
  RETURN next_version;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_conversation_thread_summary(
  p_tenant_id uuid,
  p_thread_id uuid,
  p_expected_updated_at timestamptz,
  p_summary text,
  p_summary_through timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  changed integer;
BEGIN
  UPDATE public.conversation_threads
  SET rolling_summary = p_summary,
      summary_through_message_at = p_summary_through,
      updated_at = now()
  WHERE id = p_thread_id
    AND tenant_id = p_tenant_id
    AND updated_at = p_expected_updated_at
    AND (summary_through_message_at IS NULL OR summary_through_message_at < p_summary_through);
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$function$;

-- Preserve migration 133's full merge behavior and wrap it with continuity
-- ownership moves. The wrapper remains transactional: any continuity conflict
-- rolls the core merge back as well.
DO $rename_merge$
BEGIN
  IF to_regprocedure('public.merge_customers_core_tx(uuid,uuid,uuid)') IS NULL THEN
    IF to_regprocedure('public.merge_customers_tx(uuid,uuid,uuid)') IS NULL THEN
      RAISE EXCEPTION 'merge_customers_tx is missing; apply migration 133 first';
    END IF;
    ALTER FUNCTION public.merge_customers_tx(uuid, uuid, uuid)
      RENAME TO merge_customers_core_tx;
  END IF;
END
$rename_merge$;

CREATE OR REPLACE FUNCTION public.merge_customers_tx(
  p_tenant_id uuid,
  p_survivor_id uuid,
  p_loser_id uuid
)
RETURNS TABLE (survivor_id uuid, loser_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public.merge_customers_core_tx(p_tenant_id, p_survivor_id, p_loser_id);

  UPDATE public.customer_channel_identities
  SET customer_id = p_survivor_id, updated_at = now()
  WHERE tenant_id = p_tenant_id AND customer_id = p_loser_id;

  UPDATE public.conversation_threads
  SET customer_id = p_survivor_id, updated_at = now()
  WHERE tenant_id = p_tenant_id AND customer_id = p_loser_id;

  UPDATE public.customer_memory_facts loser_fact
  SET status = 'superseded', superseded_by = survivor_fact.id, updated_at = now()
  FROM public.customer_memory_facts survivor_fact
  WHERE loser_fact.tenant_id = p_tenant_id
    AND loser_fact.customer_id = p_loser_id
    AND loser_fact.status = 'active'
    AND survivor_fact.tenant_id = p_tenant_id
    AND survivor_fact.customer_id = p_survivor_id
    AND survivor_fact.namespace = loser_fact.namespace
    AND survivor_fact.fact_key = loser_fact.fact_key
    AND survivor_fact.status = 'active';

  UPDATE public.customer_memory_facts
  SET customer_id = p_survivor_id, updated_at = now()
  WHERE tenant_id = p_tenant_id AND customer_id = p_loser_id;

  RETURN QUERY SELECT p_survivor_id, p_loser_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_whatsapp_conversation_batch(uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ingest_conversation_message(text, text, jsonb, uuid, uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_conversation_thread_state(uuid, uuid, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_conversation_thread_summary(uuid, uuid, timestamptz, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_customers_tx(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_customers_core_tx(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_whatsapp_conversation_batch(uuid, timestamptz, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ingest_conversation_message(text, text, jsonb, uuid, uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_conversation_thread_state(uuid, uuid, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_conversation_thread_summary(uuid, uuid, timestamptz, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_customers_tx(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_customers_core_tx(uuid, uuid, uuid) TO service_role;

ALTER FUNCTION public.merge_customers_core_tx(uuid, uuid, uuid) SET search_path = public, pg_temp;


-- Verification: keep this inside the SQL-editor artifact so a partial or
-- insecure apply fails visibly in the same operator session.
DO $verify_release$
DECLARE
  missing text[] := ARRAY[]::text[];
  relation_name text;
  function_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'shared_channel_route_sessions',
    'customer_channel_identities',
    'conversation_threads',
    'customer_memory_facts',
    'conversation_effects'
  ] LOOP
    IF to_regclass('public.' || relation_name) IS NULL THEN
      missing := array_append(missing, 'table:' || relation_name);
    ELSIF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = relation_name AND c.relrowsecurity
    ) THEN
      missing := array_append(missing, 'rls:' || relation_name);
    END IF;
  END LOOP;

  FOREACH function_name IN ARRAY ARRAY[
    'claim_whatsapp_conversation_batch',
    'ingest_conversation_message',
    'update_conversation_thread_state',
    'update_conversation_thread_summary',
    'merge_customers_tx'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = function_name
        AND p.prosecdef
        AND p.proconfig @> ARRAY['search_path=public, pg_temp']
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')
    ) THEN
      missing := array_append(missing, 'function_security:' || function_name);
    END IF;
  END LOOP;

  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'conversation continuity verification failed: %', array_to_string(missing, ', ');
  END IF;
END
$verify_release$;

SELECT 'conversation_continuity_schema_ready' AS status;

-- source: db/releases/2026-09-28-channel-identity-runtime-hardening.sql
-- Supabase SQL Editor release: channel identity runtime hardening.


ALTER TABLE public.customers
  ALTER COLUMN phone DROP NOT NULL;

REVOKE ALL ON TABLE public.shared_channel_route_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.customer_channel_identities FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.conversation_threads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.customer_memory_facts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.conversation_effects FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.shared_channel_route_sessions TO service_role;
GRANT ALL ON TABLE public.customer_channel_identities TO service_role;
GRANT ALL ON TABLE public.conversation_threads TO service_role;
GRANT ALL ON TABLE public.customer_memory_facts TO service_role;
GRANT ALL ON TABLE public.conversation_effects TO service_role;

GRANT SELECT ON TABLE public.customer_channel_identities TO authenticated;
GRANT SELECT ON TABLE public.conversation_threads TO authenticated;
GRANT SELECT ON TABLE public.customer_memory_facts TO authenticated;
GRANT SELECT ON TABLE public.conversation_effects TO authenticated;

DO $verify$
DECLARE
  table_name text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customers'
      AND column_name = 'phone'
      AND is_nullable <> 'YES'
  ) THEN
    RAISE EXCEPTION 'customers.phone must be nullable for non-phone channel identities';
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'shared_channel_route_sessions',
    'customer_channel_identities',
    'conversation_threads',
    'customer_memory_facts',
    'conversation_effects'
  ]
  LOOP
    IF NOT has_table_privilege('service_role', format('public.%I', table_name), 'SELECT')
       OR NOT has_table_privilege('service_role', format('public.%I', table_name), 'INSERT')
       OR NOT has_table_privilege('service_role', format('public.%I', table_name), 'UPDATE')
       OR NOT has_table_privilege('service_role', format('public.%I', table_name), 'DELETE') THEN
      RAISE EXCEPTION 'service_role privileges incomplete for %', table_name;
    END IF;
  END LOOP;

  IF has_table_privilege('authenticated', 'public.shared_channel_route_sessions', 'SELECT')
     OR has_table_privilege('anon', 'public.shared_channel_route_sessions', 'SELECT') THEN
    RAISE EXCEPTION 'shared channel route sessions must remain server-only';
  END IF;
END
$verify$;


SELECT 'channel_identity_runtime_ready' AS status;

-- source: db/releases/2026-09-28-conversation-ingest-replay-hardening.sql
-- Supabase SQL Editor release: run after migration/release 153.


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

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'ingest_conversation_message'
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=public, pg_temp']
  ) THEN
    RAISE EXCEPTION 'ingest_conversation_message is missing or unsafe';
  END IF;
END
$verify$;


SELECT 'conversation_ingest_replay_ready' AS status;

-- source: db/releases/2026-09-29-conversation-effect-delivery-hardening.sql
-- Migration 156: make outbound message dispatch idempotent per tenant.
-- The application persists a pending intent before calling Meta. This index is
-- the concurrency boundary that prevents two workers dispatching the same reply.


DO $duplicate_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.messages
    WHERE idempotency_key IS NOT NULL
    GROUP BY tenant_id, idempotency_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate outbound message idempotency keys exist; reconcile before migration 156';
  END IF;
END
$duplicate_preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_tenant_idempotency
  ON public.messages (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DO $verify$
BEGIN
  IF to_regclass('public.uq_messages_tenant_idempotency') IS NULL THEN
    RAISE EXCEPTION 'Missing outbound message idempotency index';
  END IF;
END
$verify$;

-- source: db/releases/2026-09-29-verified-customer-memory.sql
-- Migration 157: atomically record source-backed customer memory facts.


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

-- source: db/releases/2026-09-29-handoff-thread-continuity.sql
-- Release delta: canonical thread identity for escalation and takeover.

ALTER TABLE public.escalation_queue
  ADD COLUMN IF NOT EXISTS conversation_thread_id uuid
    REFERENCES public.conversation_threads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_escalation_queue_thread_open
  ON public.escalation_queue (tenant_id, conversation_thread_id, created_at DESC)
  WHERE status IN ('pending', 'claimed');

-- final verifier: scripts/sql/verify_conversation_continuity.sql
-- Read-only production/staging verification for migration 153.
DO $verify$
DECLARE
  missing text[] := ARRAY[]::text[];
  relation_name text;
  function_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'shared_channel_route_sessions',
    'customer_channel_identities',
    'conversation_threads',
    'customer_memory_facts',
    'conversation_effects'
  ] LOOP
    IF to_regclass('public.' || relation_name) IS NULL THEN
      missing := array_append(missing, 'table:' || relation_name);
    ELSIF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = relation_name AND c.relrowsecurity
    ) THEN
      missing := array_append(missing, 'rls:' || relation_name);
    END IF;
  END LOOP;

  FOREACH function_name IN ARRAY ARRAY[
    'claim_whatsapp_conversation_batch',
    'ingest_conversation_message',
    'update_conversation_thread_state',
    'update_conversation_thread_summary',
    'merge_customers_tx'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = function_name
        AND p.prosecdef
        AND p.proconfig @> ARRAY['search_path=public, pg_temp']
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')
    ) THEN
      missing := array_append(missing, 'function_security:' || function_name);
    END IF;
  END LOOP;

  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'conversation continuity verification failed: %', array_to_string(missing, ', ');
  END IF;
END
$verify$;

SELECT 'conversation_continuity_schema_ready' AS status;

COMMIT;
