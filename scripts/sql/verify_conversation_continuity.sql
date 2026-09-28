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
