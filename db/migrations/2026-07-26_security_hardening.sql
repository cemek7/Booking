-- ============================================================================
-- 2026-07-26 SECURITY HARDENING
-- Fixes the criticals from the Supabase security linter + RLS policy review.
-- Safe to re-run (DROP IF EXISTS / idempotent statements throughout).
-- The app does all server-side writes via service_role, which BYPASSES RLS —
-- so none of these changes affect server code paths. They only close direct
-- API access holes for anon/authenticated JWTs.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CRITICAL: remove leftover development policies (full cross-tenant access)
-- ----------------------------------------------------------------------------
-- tenants: "Allow all for development" → any logged-in user could read/write
-- EVERY tenant row. Proper policies (tenant_members_read_tenants,
-- tenant_owners_update_tenants) already exist and remain.
DROP POLICY IF EXISTS "Allow all for development" ON public.tenants;

-- tenant_users: same problem — full read/write of every membership row.
-- Proper policies (read own memberships, owners manage staff) remain.
DROP POLICY IF EXISTS "Allow all for development on tenant_users" ON public.tenant_users;

-- ----------------------------------------------------------------------------
-- 2. CRITICAL: drop always-true policies (auth.uid() = auth.uid() is a no-op
--    check → grants access to EVERY authenticated user, cross-tenant)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Tenant can access their reservations" ON public.reservations;
DROP POLICY IF EXISTS "Tenant sees own tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "tenant_tickets_policy" ON public.support_tickets;
DROP POLICY IF EXISTS "tenant_logs_policy" ON public.reservation_logs;
DROP POLICY IF EXISTS "Platform settings admin only" ON public.platform_settings;
-- support_tickets keeps its correct tenant_users-based policies
-- (support_tickets_select/insert/update + service_role).

-- ----------------------------------------------------------------------------
-- 3. Broken-by-construction policies (compare auth.uid() to tenant_id — a
--    user id is never a tenant id, so these never match; dead weight that
--    hides the real intent). Replace with correct tenant-membership checks.
-- ----------------------------------------------------------------------------
-- bookings
DROP POLICY IF EXISTS "Tenant can access their bookings" ON public.bookings;
DROP POLICY IF EXISTS "tenant_bookings_policy" ON public.bookings;
DROP POLICY IF EXISTS "bookings_tenant_isolation" ON public.bookings;
CREATE POLICY bookings_tenant_isolation ON public.bookings
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()));

-- reservations (the jwt.claims-based reservations_tenant_is_owner stays; it
-- simply never matches for Supabase JWTs, which is a deny — harmless)
DROP POLICY IF EXISTS "tenant_reservations_policy" ON public.reservations;
DROP POLICY IF EXISTS "reservations_tenant_select" ON public.reservations;
CREATE POLICY reservations_tenant_select ON public.reservations
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()));

-- reservation_logs: tenant members may read; writes stay service-role only
DROP POLICY IF EXISTS "reservation_logs_tenant_select" ON public.reservation_logs;
CREATE POLICY reservation_logs_tenant_select ON public.reservation_logs
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()));

-- tenants: drop the no-op profile policy (auth.uid() = tenants.id never true)
DROP POLICY IF EXISTS "tenant_profile_policy" ON public.tenants;

-- booking_notifications / scheduled_notifications: broken correlated
-- subqueries against auth.users → replace with the standard membership check
DROP POLICY IF EXISTS "tenant_isolation_booking_notifications" ON public.booking_notifications;
CREATE POLICY tenant_isolation_booking_notifications ON public.booking_notifications
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "tenant_isolation_scheduled_notifications" ON public.scheduled_notifications;
CREATE POLICY tenant_isolation_scheduled_notifications ON public.scheduled_notifications
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()));

-- audit_logs: "System can insert audit logs" WITH CHECK (true) lets any user
-- forge audit entries. The app writes audit logs via service_role (bypasses
-- RLS), so the open INSERT policy is not needed.
DROP POLICY IF EXISTS "System can insert audit logs" ON public.audit_logs;

-- ----------------------------------------------------------------------------
-- 4. Linter ERROR: tables exposed to PostgREST with RLS disabled.
--    Enable RLS with no policy → service-role-only (matches how they're used:
--    cron/locking/rollup internals).
-- ----------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.idempotency_keys   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cron_locks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.slot_locks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.schedule_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.insights_daily     ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 5. Linter ERROR: SECURITY DEFINER views run with the creator's permissions,
--    ignoring the querying user's RLS. Switch to security_invoker (PG15+).
--    Server code reads these via service_role, which is unaffected.
-- ----------------------------------------------------------------------------
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'customer_service_history_view',
    'staff_customer_history_view',
    'followup_candidates_view',
    'tenant_revenue_view',
    'ai_training_event_daily_summary_view',
    'ai_training_capture_health_view',
    'ai_training_failure_review_view',
    'security_dashboard',
    'ai_front_desk_offer_performance_view',
    'ai_front_desk_funnel_daily_view',
    'ai_front_desk_followup_pipeline_view',
    'ai_front_desk_revenue_attribution_view'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = v) THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', v);
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 6. Linter WARN: SECURITY DEFINER functions callable by anon/authenticated
--    via /rest/v1/rpc/*. These are internal (cron locks, retail money moves,
--    wallet operations, maintenance). Revoke public access; service_role
--    keeps EXECUTE. auth_user_tenant_ids is EXCLUDED — RLS policies call it
--    as the authenticated user, so it must stay executable by authenticated
--    (anon is still revoked).
-- ----------------------------------------------------------------------------
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname IN (
        'acquire_cron_lock', 'release_cron_lock',
        'claim_whatsapp_queue_messages',
        'record_retail_sale_tx', 'refund_retail_sale_tx',
        'ensure_ai_wallet', 'topup_ai_wallet',
        'reserve_ai_wallet_spend', 'settle_ai_wallet_spend',
        'update_inventory', 'merge_customers_tx',
        'cleanup_old_audit_logs', 'cleanup_expired_analytics',
        'refresh_audit_analytics', 'rls_auto_enable',
        'detect_booking_anomalies', 'get_compliance_summary',
        'calculate_customer_ltv'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated, public', fn.sig);
  END LOOP;

  -- auth_user_tenant_ids: RLS helpers need authenticated; block anon only.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'auth_user_tenant_ids'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.auth_user_tenant_ids() FROM anon;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7. Linter WARN: mutable search_path on functions (search-path hijack risk
--    for SECURITY DEFINER). Pin search_path on every flagged function.
-- ----------------------------------------------------------------------------
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'cleanup_old_audit_logs', 'get_compliance_summary',
        'notify_critical_security_event', 'refresh_audit_analytics',
        'touch_updated_at', 'sync_customer_compat_columns',
        'get_product_stock', 'calculate_customer_ltv',
        'detect_booking_anomalies', 'record_retail_sale_tx',
        'refund_retail_sale_tx', 'ensure_ai_wallet', 'topup_ai_wallet',
        'reserve_ai_wallet_spend', 'settle_ai_wallet_spend',
        'update_inventory', 'normalize_customer_phone',
        'sync_customer_normalized_phone', 'merge_customers_tx'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', fn.sig);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 8. Linter WARN: materialized view audit_analytics readable by anon/
--    authenticated over the Data API. Internal analytics — service-role only.
-- ----------------------------------------------------------------------------
REVOKE SELECT ON public.audit_analytics FROM anon, authenticated;

-- ============================================================================
-- NOT COVERED HERE (Supabase dashboard settings, not SQL):
--   * Enable leaked-password protection: Auth → Providers → Password security
--   * Postgres upgrade (15.8.1.100 has patches pending): Settings → Infrastructure
--   * pg_trgm in public schema: cosmetic; moving extensions can break indexes —
--     leave unless Supabase support advises otherwise.
-- ============================================================================
