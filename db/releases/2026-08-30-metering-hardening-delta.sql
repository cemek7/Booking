-- Booka — metering function hardening, standalone delta
--
-- Use this ONLY if migrations 139-143 were already applied from an earlier copy
-- of this branch, which would make the fresh-only bundle's guard refuse to run.
-- It applies just the two hardening changes that landed afterwards:
--
--   1. REVOKE the default PUBLIC EXECUTE that Postgres grants every new
--      function and that migration 077 never removed. These are SECURITY
--      INVOKER functions and RLS already blocks anon at the table level, so
--      this is defence in depth, not an open door.
--   2. Re-pin search_path, which CREATE OR REPLACE silently resets, reverting
--      the pin set by 2026-07-26_security_hardening.sql.
--
-- Idempotent and safe to re-run. Safe to run even if the fresh bundle was used
-- (it is then a no-op).

REVOKE ALL ON FUNCTION public.reserve_ai_wallet_spend(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_ai_wallet_spend(UUID, UUID, NUMERIC, NUMERIC, BIGINT, TEXT, TEXT, TEXT, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.topup_ai_wallet(UUID, NUMERIC, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_ai_wallet(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_ai_wallet_spend(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_ai_wallet_spend(UUID, UUID, NUMERIC, NUMERIC, BIGINT, TEXT, TEXT, TEXT, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.topup_ai_wallet(UUID, NUMERIC, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_ai_wallet(UUID, TEXT) TO service_role;

ALTER FUNCTION public.reserve_ai_wallet_spend(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.settle_ai_wallet_spend(UUID, UUID, NUMERIC, NUMERIC, BIGINT, TEXT, TEXT, TEXT, JSONB, TEXT)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.topup_ai_wallet(UUID, NUMERIC, TEXT, TEXT, JSONB)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.ensure_ai_wallet(UUID, TEXT)
  SET search_path = public, pg_temp;

-- Verify: all four must be anon=f, authenticated=f, service_role=t, with a pinned search_path.
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_role,
       p.proconfig                                               AS search_path
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname LIKE '%ai_wallet%'
ORDER BY 1;
