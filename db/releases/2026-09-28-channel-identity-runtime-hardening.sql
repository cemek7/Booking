-- Supabase SQL Editor release: channel identity runtime hardening.

BEGIN;

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
    FROM information_schema.columns AS column_info
    WHERE column_info.table_schema = 'public'
      AND column_info.table_name = 'customers'
      AND column_info.column_name = 'phone'
      AND column_info.is_nullable <> 'YES'
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

COMMIT;

SELECT 'channel_identity_runtime_ready' AS status;
