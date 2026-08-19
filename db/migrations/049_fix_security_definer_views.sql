-- Migration 049: Fix SECURITY DEFINER views flagged by Supabase security adviser
--
-- Views with SECURITY DEFINER run with the view creator's privileges and bypass
-- RLS policies for the querying user. Setting security_invoker = on restores
-- correct behaviour — the view runs with the permissions of the calling user,
-- respecting RLS and role-based access controls.

ALTER VIEW public.support                     SET (security_invoker = on);
ALTER VIEW public.vw_reservations_with_customer SET (security_invoker = on);
ALTER VIEW public.security_dashboard          SET (security_invoker = on);
