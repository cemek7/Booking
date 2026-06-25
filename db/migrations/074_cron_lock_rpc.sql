-- Migration 074: Add expiry-aware distributed cron lock helpers
-- Prevent stale lock deadlocks by allowing takeover only when lock is expired.

CREATE OR REPLACE FUNCTION public.acquire_cron_lock(
  p_key text,
  p_ttl_seconds integer DEFAULT 90
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := NOW();
  v_until timestamptz := v_now + make_interval(secs => GREATEST(COALESCE(p_ttl_seconds, 90), 1));
  v_acquired boolean := false;
BEGIN
  INSERT INTO public.cron_locks (key, locked_until)
  VALUES (p_key, v_until)
  ON CONFLICT (key) DO UPDATE
    SET locked_until = EXCLUDED.locked_until
    WHERE public.cron_locks.locked_until < v_now
  RETURNING true INTO v_acquired;

  RETURN COALESCE(v_acquired, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_cron_lock(p_key text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.cron_locks WHERE key = p_key;
$$;

GRANT EXECUTE ON FUNCTION public.acquire_cron_lock(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_cron_lock(text) TO service_role;
