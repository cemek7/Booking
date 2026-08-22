\set ON_ERROR_STOP on

-- This test intentionally targets a dedicated disposable database. The runner
-- rejects non-test database names before this file can modify the public schema.
DROP TABLE IF EXISTS public.operating_actions CASCADE;
DROP TABLE IF EXISTS public.operating_loop_state CASCADE;
DROP TABLE IF EXISTS public.automation_policies CASCADE;
DROP TABLE IF EXISTS public.operating_objectives CASCADE;
DROP TABLE IF EXISTS public.onboarding_evidence CASCADE;
DROP TABLE IF EXISTS public.tenant_users CASCADE;
DROP TABLE IF EXISTS public.tenants CASCADE;
DROP SCHEMA IF EXISTS private CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;

DO $$
BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE ROLE service_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
GRANT anon, authenticated, service_role TO CURRENT_USER;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT NOT NULL);
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TABLE public.tenants (id UUID PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE public.tenant_users (
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  PRIMARY KEY (tenant_id, user_id)
);
ALTER TABLE public.tenant_users ENABLE ROW LEVEL SECURITY;
-- Mirrors the repository's recursive hierarchy policy. The migration's helpers
-- must work despite this protected membership relation.
CREATE POLICY tenant_users_hierarchy_select ON public.tenant_users
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR tenant_id IN (
      SELECT membership.tenant_id
      FROM public.tenant_users membership
      WHERE membership.user_id = auth.uid()
        AND membership.role IN ('owner', 'manager', 'staff')
    )
  );

\ir ../../migrations/042_operating_loop.sql

CREATE OR REPLACE FUNCTION public.assert_true(value BOOLEAN, message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN
    RAISE EXCEPTION '%', message;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.assert_equals(actual BIGINT, expected BIGINT, message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '% (expected %, got %)', message, expected, actual;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.assert_sqlstate(statement TEXT, expected_state TEXT, message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  actual_state TEXT;
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'statement succeeded unexpectedly: %', message;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE;
  IF actual_state <> expected_state THEN
    RAISE EXCEPTION '% (expected SQLSTATE %, got %)', message, expected_state, actual_state;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.assert_true(BOOLEAN, TEXT),
  public.assert_equals(BIGINT, BIGINT, TEXT),
  public.assert_sqlstate(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email) VALUES
  ('10000000-0000-0000-0000-000000000001', 'owner-a@example.test'),
  ('10000000-0000-0000-0000-000000000002', 'member-a@example.test'),
  ('10000000-0000-0000-0000-000000000003', 'owner-b@example.test'),
  ('10000000-0000-0000-0000-000000000004', 'outsider@example.test');
INSERT INTO public.tenants (id, name) VALUES
  ('20000000-0000-0000-0000-000000000001', 'Tenant A'),
  ('20000000-0000-0000-0000-000000000002', 'Tenant B');
INSERT INTO public.tenant_users (tenant_id, user_id, role) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'owner'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'staff'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 'owner');

INSERT INTO public.operating_objectives (id, tenant_id, objective_type, dedupe_key, title, explanation) VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'reply_to_lead', 'lead-a', 'Reply to lead', 'Tenant A needs a reply.'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'confirm_booking', 'booking-b', 'Confirm booking', 'Tenant B needs confirmation.');
INSERT INTO public.operating_loop_state (tenant_id, operating_date, state, primary_objective_id) VALUES
  ('20000000-0000-0000-0000-000000000001', current_date, 'active', '30000000-0000-0000-0000-000000000001');
INSERT INTO public.automation_policies (id, tenant_id, name, action_type, status) VALUES
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'A follow-up', 'follow_up', 'active'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'B follow-up', 'follow_up', 'active');

SET ROLE anon;
SELECT public.assert_sqlstate('SELECT count(*) FROM public.operating_objectives', '42501', 'anon cannot read operating objectives');
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', false);
SELECT public.assert_equals((SELECT count(*) FROM public.operating_objectives), 0, 'non-member cannot read tenant objectives');
SELECT public.assert_sqlstate(
  $$INSERT INTO public.operating_actions (tenant_id, objective_id, action_type, actor_id)
    VALUES ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'dismiss', '10000000-0000-0000-0000-000000000004')$$,
  '42501', 'non-member cannot write actions'
);

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', false);
SELECT public.assert_equals((SELECT count(*) FROM public.operating_objectives), 1, 'member reads only one tenant without policy recursion');
SELECT public.assert_sqlstate(
  $$INSERT INTO public.operating_actions (tenant_id, objective_id, action_type, actor_id)
    VALUES ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'dismiss', '10000000-0000-0000-0000-000000000002')$$,
  '42501', 'non-owner cannot write actions'
);

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
SELECT public.assert_equals((SELECT count(*) FROM public.operating_objectives), 1, 'owner reads only one tenant without policy recursion');
SELECT public.assert_sqlstate(
  $$INSERT INTO public.operating_actions (tenant_id, objective_id, action_type, actor_id)
    VALUES ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'dismiss', '10000000-0000-0000-0000-000000000001')$$,
  '23503', 'owner cannot attach a tenant A action to a tenant B objective'
);
SELECT public.assert_sqlstate(
  $$INSERT INTO public.operating_actions (tenant_id, objective_id, policy_id, action_type, actor_id)
    VALUES ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', 'dismiss', '10000000-0000-0000-0000-000000000001')$$,
  '23503', 'owner cannot attach a tenant A action to a tenant B policy'
);
INSERT INTO public.operating_actions (tenant_id, objective_id, policy_id, action_type, actor_id)
VALUES ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'dismiss', '10000000-0000-0000-0000-000000000001');
RESET ROLE;

SET ROLE service_role;
SELECT public.assert_sqlstate(
  $$INSERT INTO public.operating_loop_state (tenant_id, operating_date, state, primary_objective_id)
    VALUES ('20000000-0000-0000-0000-000000000001', current_date + 1, 'active', '30000000-0000-0000-0000-000000000002')$$,
  '23503', 'worker cannot attach tenant A loop state to a tenant B objective'
);
SELECT public.assert_sqlstate(
  $$INSERT INTO public.operating_objectives (tenant_id, objective_type, dedupe_key, title, explanation)
    VALUES ('20000000-0000-0000-0000-000000000001', 'reply_to_lead', 'lead-a', 'Duplicate', 'Duplicate active objective')$$,
  '23505', 'active objective dedupe is enforced'
);
INSERT INTO public.operating_objectives (tenant_id, objective_type, dedupe_key, title, explanation, status)
VALUES ('20000000-0000-0000-0000-000000000001', 'reply_to_lead', 'lead-a', 'Historical', 'Completed objective may reuse its key.', 'completed');
SELECT public.assert_sqlstate(
  $$DELETE FROM public.operating_objectives WHERE id = '30000000-0000-0000-0000-000000000001'$$,
  '23503', 'objective deletion cannot erase its action audit'
);
SELECT public.assert_equals(
  (SELECT count(*) FROM public.operating_actions WHERE objective_id = '30000000-0000-0000-0000-000000000001'),
  1,
  'objective audit record remains after rejected delete'
);
RESET ROLE;

\echo '042 operating-loop migration schema/RLS test passed'
