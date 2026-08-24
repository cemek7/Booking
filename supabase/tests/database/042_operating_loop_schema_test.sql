\set ON_ERROR_STOP on

-- This test intentionally targets a dedicated disposable database. The runner
-- rejects non-test database names before this file can modify the public schema.
DROP FUNCTION IF EXISTS public.queue_operating_delivery(UUID, UUID, UUID, UUID, JSONB, TEXT);
DROP FUNCTION IF EXISTS public.apply_operating_suppression(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT);
DROP FUNCTION IF EXISTS public.replace_operating_policies(UUID, UUID, BOOLEAN, JSONB);
DROP FUNCTION IF EXISTS public.persist_operating_objective_draft(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, NUMERIC, NUMERIC, TIMESTAMPTZ, TEXT);
DROP TABLE IF EXISTS public.operating_actions CASCADE;
DROP TABLE IF EXISTS public.operating_delivery_outbox CASCADE;
DROP TABLE IF EXISTS public.operating_objective_suppressions CASCADE;
DROP TABLE IF EXISTS public.operating_loop_settings CASCADE;
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
\ir ../../migrations/043_operating_loop_delivery_safety.sql

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

INSERT INTO public.operating_objectives (id, tenant_id, objective_type, dedupe_key, source_fingerprint, title, explanation) VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'confirm_booking', 'lead-a', 'fixture:lead-a:v1', 'Confirm booking', 'Tenant A needs confirmation.'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'confirm_booking', 'booking-b', 'fixture:booking-b:v1', 'Confirm booking', 'Tenant B needs confirmation.');
INSERT INTO public.operating_loop_state (tenant_id, operating_date, state, primary_objective_id) VALUES
  ('20000000-0000-0000-0000-000000000001', current_date, 'active', '30000000-0000-0000-0000-000000000001');
INSERT INTO public.automation_policies (id, tenant_id, name, action_type, status) VALUES
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'A confirmation', 'confirm_booking', 'active'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'B follow-up', 'follow_up', 'active');
UPDATE public.operating_objectives SET expires_at = now() + interval '1 hour', source_fingerprint = 'v1:objective-a'
  WHERE id = '30000000-0000-0000-0000-000000000001';
UPDATE public.automation_policies SET approved_by = '10000000-0000-0000-0000-000000000001', approved_at = now(),
  eligibility_rules = '{"maxAmountAtRisk": 100000}'::jsonb
  WHERE id = '40000000-0000-0000-0000-000000000001';

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
  $$INSERT INTO public.operating_objectives (tenant_id, objective_type, dedupe_key, source_fingerprint, title, explanation)
    VALUES ('20000000-0000-0000-0000-000000000001', 'reply_to_lead', 'lead-a', 'fixture:lead-a:v1', 'Duplicate', 'Duplicate active objective')$$,
  '23505', 'active objective dedupe is enforced'
);
INSERT INTO public.operating_objectives (tenant_id, objective_type, dedupe_key, source_fingerprint, title, explanation, status)
VALUES ('20000000-0000-0000-0000-000000000001', 'reply_to_lead', 'lead-a', 'fixture:lead-a:v2', 'Historical', 'Completed objective may reuse its key.', 'completed');
SELECT public.assert_sqlstate(
  $$DELETE FROM public.operating_objectives WHERE id = '30000000-0000-0000-0000-000000000001'$$,
  '23503', 'objective deletion cannot erase its action audit'
);
SELECT public.assert_equals(
  (SELECT count(*) FROM public.operating_actions WHERE objective_id = '30000000-0000-0000-0000-000000000001'),
  1,
  'objective audit record remains after rejected delete'
);

SELECT * FROM public.queue_operating_delivery(
  '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
  '{"recipient":"2348111111111","content":"Please confirm","actionType":"confirm_booking"}'::jsonb,
  'operating:test:objective-a'
);
SELECT public.assert_equals((SELECT count(*) FROM public.operating_delivery_outbox), 1,
  'approved action writes exactly one dedicated operating delivery outbox row');
SELECT public.assert_true((SELECT status = 'queued' FROM public.operating_objectives WHERE id = '30000000-0000-0000-0000-000000000001'),
  'queueing does not falsely complete the objective');
SELECT public.assert_sqlstate(
  $$SELECT * FROM public.queue_operating_delivery('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','{"recipient":"2348111111111","content":"Again","actionType":"confirm_booking"}'::jsonb,'operating:test:objective-a')$$,
  'P0001', 'a queued objective cannot be executed twice'
);
SELECT public.assert_sqlstate(
  $$SELECT * FROM public.queue_operating_delivery('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','{"recipient":"2348111111111","content":"Cross tenant","actionType":"confirm_booking"}'::jsonb,'operating:test:cross')$$,
  '42501', 'queue RPC rejects cross-tenant owner authority'
);
INSERT INTO public.operating_objectives (id, tenant_id, objective_type, dedupe_key, source_fingerprint, title, explanation, expires_at)
  VALUES ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', 'confirm_booking', 'booking-quiet', 'v1:quiet', 'Quiet booking', 'Must wait for quiet hours to end.', now() + interval '1 hour');
UPDATE public.automation_policies
  SET quiet_hours = '{"start":"00:00","end":"23:59","timezone":"UTC"}'::jsonb
  WHERE id = '40000000-0000-0000-0000-000000000001';
SELECT public.assert_sqlstate(
  $$SELECT * FROM public.queue_operating_delivery('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001','{"recipient":"2348111111111","content":"Quiet","actionType":"confirm_booking"}'::jsonb,'operating:test:quiet')$$,
  '42501', 'queue RPC atomically rejects an active policy quiet-hours window'
);
INSERT INTO public.operating_objectives (id, tenant_id, objective_type, dedupe_key, source_fingerprint, title, explanation, expires_at)
  VALUES ('30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','confirm_booking','booking-quiet-2','v1:quiet','Quiet booking','Must wait for quiet hours',now() + interval '1 hour');
INSERT INTO public.automation_policies (id, tenant_id, name, action_type, status, eligibility_rules, quiet_hours, approved_by, approved_at)
  VALUES (
    '40000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','Quiet policy','confirm_booking','active','{}'::jsonb,
    jsonb_build_object('start', to_char((now() - interval '1 minute')::time, 'HH24:MI'), 'end', to_char((now() + interval '1 minute')::time, 'HH24:MI'), 'timezone', 'UTC'),
    '10000000-0000-0000-0000-000000000001', now()
  );
SELECT public.assert_sqlstate(
  $$SELECT * FROM public.queue_operating_delivery('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000003','{"recipient":"2348111111111","content":"Quiet hours","actionType":"confirm_booking"}'::jsonb,'operating:test:quiet')$$,
  '42501', 'queue RPC atomically rejects delivery within configured quiet hours'
);
INSERT INTO public.operating_objectives (id, tenant_id, objective_type, dedupe_key, source_fingerprint, title, explanation, expires_at)
  VALUES ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','confirm_booking','booking-defer','v1:defer','Defer booking','Needs later follow-up',now() + interval '1 hour');
SELECT * FROM public.apply_operating_suppression(
  '20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003',
  'defer',now() + interval '30 minutes',NULL
);
SELECT public.assert_equals((SELECT count(*) FROM public.operating_objective_suppressions WHERE dedupe_key = 'booking-defer'), 1,
  'defer stores a durable source-fingerprint suppression');

-- The evaluator must never reopen a deferred/dismissed source version. The
-- persistence RPC owns the suppression check and insert under one advisory
-- transaction lock; a changed source fingerprint can intentionally reopen it.
INSERT INTO public.operating_objectives (id, tenant_id, objective_type, dedupe_key, source_fingerprint, title, explanation, expires_at)
  VALUES ('30000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000001','confirm_booking','draft-suppressed','v1:draft','Suppressed draft','Owner deferred this source version',now() + interval '1 hour');
SELECT * FROM public.apply_operating_suppression(
  '20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000006',
  'dismiss',NULL,NULL
);
SELECT public.assert_true((
  SELECT outcome = 'suppressed' AND objective IS NULL
  FROM public.persist_operating_objective_draft(
    '20000000-0000-0000-0000-000000000001','confirm_booking','draft-suppressed','v1:draft','Suppressed draft','Should not reopen',
    '{"bookingId":"draft-suppressed"}'::jsonb,'["draft-suppressed"]'::jsonb,1,100,now() + interval '1 hour','active'
  )
), 'exactly suppressed source fingerprint creates no replacement objective');
SELECT public.assert_equals((
  SELECT count(*) FROM public.operating_objectives
  WHERE tenant_id = '20000000-0000-0000-0000-000000000001' AND dedupe_key = 'draft-suppressed'
), 1, 'suppressed fingerprint leaves the original dismissed objective as the only record');
SELECT public.assert_true((
  SELECT outcome = 'inserted' AND objective->>'source_fingerprint' = 'v2:draft'
  FROM public.persist_operating_objective_draft(
    '20000000-0000-0000-0000-000000000001','confirm_booking','draft-suppressed','v2:draft','Changed draft','New facts permit reopening',
    '{"bookingId":"draft-suppressed","version":"v2"}'::jsonb,'["draft-suppressed"]'::jsonb,2,200,now() + interval '1 hour','active'
  )
), 'changed source fingerprint creates a new objective');

-- Delivery authorization is enforced inside the queue transaction, rather
-- than trusting any application-layer pre-checks.
INSERT INTO public.operating_objectives (id, tenant_id, objective_type, dedupe_key, source_fingerprint, title, explanation, amount_at_risk, expires_at)
  VALUES ('30000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000001','confirm_booking','delivery-guard','v1:guard','Delivery guard','Proves policy checks',500,now() + interval '1 hour');
UPDATE public.automation_policies
  SET status = 'active', quiet_hours = '{}'::jsonb, eligibility_rules = '{"maxAmountAtRisk":1000}'::jsonb,
      approved_by = '10000000-0000-0000-0000-000000000001', approved_at = now()
  WHERE id = '40000000-0000-0000-0000-000000000001';
SELECT public.assert_sqlstate(
  $$SELECT * FROM public.queue_operating_delivery('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000007','40000000-0000-0000-0000-000000000001','{"recipient":"2348111111111","content":"No authority","actionType":"confirm_booking"}'::jsonb,'operating:test:impersonation')$$,
  '42501', 'queue RPC rejects an impersonated non-owner actor'
);
INSERT INTO public.operating_loop_settings (tenant_id, automation_paused) VALUES ('20000000-0000-0000-0000-000000000001',true)
  ON CONFLICT (tenant_id) DO UPDATE SET automation_paused = EXCLUDED.automation_paused;
SELECT public.assert_sqlstate(
  $$SELECT * FROM public.queue_operating_delivery('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000007','40000000-0000-0000-0000-000000000001','{"recipient":"2348111111111","content":"Paused","actionType":"confirm_booking"}'::jsonb,'operating:test:paused')$$,
  '42501', 'queue RPC rejects a durable tenant automation pause'
);
UPDATE public.operating_loop_settings SET automation_paused = false WHERE tenant_id = '20000000-0000-0000-0000-000000000001';
UPDATE public.automation_policies SET status = 'revoked' WHERE id = '40000000-0000-0000-0000-000000000001';
SELECT public.assert_sqlstate(
  $$SELECT * FROM public.queue_operating_delivery('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000007','40000000-0000-0000-0000-000000000001','{"recipient":"2348111111111","content":"Revoked","actionType":"confirm_booking"}'::jsonb,'operating:test:revoked')$$,
  '42501', 'queue RPC rejects a revoked policy'
);
UPDATE public.automation_policies SET status = 'active', eligibility_rules = '{"unknown":true}'::jsonb WHERE id = '40000000-0000-0000-0000-000000000001';
SELECT public.assert_sqlstate(
  $$SELECT * FROM public.queue_operating_delivery('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000007','40000000-0000-0000-0000-000000000001','{"recipient":"2348111111111","content":"Invalid policy","actionType":"confirm_booking"}'::jsonb,'operating:test:invalid-policy')$$,
  '22023', 'queue RPC rejects invalid stored policy JSON'
);
UPDATE public.automation_policies SET eligibility_rules = '{"maxAmountAtRisk":100}'::jsonb WHERE id = '40000000-0000-0000-0000-000000000001';
SELECT public.assert_sqlstate(
  $$SELECT * FROM public.queue_operating_delivery('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000007','40000000-0000-0000-0000-000000000001','{"recipient":"2348111111111","content":"Cap","actionType":"confirm_booking"}'::jsonb,'operating:test:cap')$$,
  '42501', 'queue RPC rejects an objective above its policy amount cap'
);
RESET ROLE;

\echo '042/043 operating-loop migration schema/RLS test passed'
