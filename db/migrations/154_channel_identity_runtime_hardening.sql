-- Runtime privileges and nullable phone support for channel-backed customers.
-- This is additive/idempotent and safe to apply after migration 153.

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

COMMIT;
