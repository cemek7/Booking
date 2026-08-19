-- Migration 054: Fix mutable search_path on functions flagged by Supabase security adviser
--
-- A mutable search_path allows a malicious user to hijack function execution by
-- prepending a schema they control. Setting search_path = public pins the function
-- to the expected schema so object references cannot be shadowed.
--
-- Using ALTER FUNCTION rather than recreating full bodies to minimise risk of
-- accidentally changing function behaviour.

-- ─── Trigger functions (no parameters) ──────────────────────────────────────

ALTER FUNCTION public.touch_updated_at()
  SET search_path = public;

ALTER FUNCTION public.increment_chat_unread()
  SET search_path = public;

ALTER FUNCTION public.update_customer_analytics_on_booking()
  SET search_path = public;

ALTER FUNCTION public.update_reviews_updated_at()
  SET search_path = public;

ALTER FUNCTION public.notify_critical_security_event()
  SET search_path = public;

ALTER FUNCTION public.update_updated_at_column()
  SET search_path = public;

-- check_reservation_service_tenant is a trigger function (no parameters)
ALTER FUNCTION public.check_reservation_service_tenant()
  SET search_path = public;

-- ─── Functions with no parameters ───────────────────────────────────────────

ALTER FUNCTION public.cleanup_expired_analytics()
  SET search_path = public;

ALTER FUNCTION public.refresh_audit_analytics()
  SET search_path = public;

-- ─── Functions with parameters ──────────────────────────────────────────────

ALTER FUNCTION public.cleanup_old_audit_logs(integer)
  SET search_path = public;

ALTER FUNCTION public.get_compliance_summary(
  uuid,
  text,
  timestamp with time zone,
  timestamp with time zone
) SET search_path = public;

ALTER FUNCTION public.aggregate_staff_ratings(
  uuid,
  uuid,
  date,
  date,
  character varying
) SET search_path = public;
