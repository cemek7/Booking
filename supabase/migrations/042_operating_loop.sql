-- Migration 042: tenant-scoped records for the owner daily operating loop.
-- These tables hold derived work and immutable audit history; they do not send
-- customer messages or activate automation by themselves.

BEGIN;

CREATE TABLE IF NOT EXISTS public.operating_loop_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  operating_date DATE NOT NULL DEFAULT current_date,
  state TEXT NOT NULL DEFAULT 'setup'
    CONSTRAINT operating_loop_state_state_check CHECK (state IN ('setup', 'active', 'clear')),
  completion_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (completion_mode IN ('manual', 'automated', 'mixed')),
  primary_objective_id UUID,
  supporting_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  automation_paused BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT operating_loop_state_tenant_day_key UNIQUE (tenant_id, operating_date)
);

CREATE TABLE IF NOT EXISTS public.operating_objectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  objective_type TEXT NOT NULL CHECK (objective_type IN (
    'reply_to_lead', 'qualify_lead', 'recover_lead', 'collect_deposit',
    'confirm_booking', 'recover_booking', 'follow_up'
  )),
  dedupe_key TEXT NOT NULL,
  title TEXT NOT NULL,
  explanation TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  affected_record_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  priority_score NUMERIC(12, 4) NOT NULL DEFAULT 0,
  amount_at_risk NUMERIC(12, 2),
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active'
    CONSTRAINT operating_objectives_status_check CHECK (status IN (
      'active', 'deferred', 'completed', 'dismissed', 'expired', 'failed'
    )),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.operating_loop_state
  ADD CONSTRAINT operating_loop_state_primary_objective_fkey
  FOREIGN KEY (primary_objective_id) REFERENCES public.operating_objectives(id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.automation_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('confirm_booking', 'collect_deposit', 'follow_up')),
  status TEXT NOT NULL DEFAULT 'draft'
    CONSTRAINT automation_policies_status_check CHECK (status IN ('draft', 'active', 'paused', 'revoked')),
  eligibility_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  quiet_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.operating_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  objective_id UUID NOT NULL REFERENCES public.operating_objectives(id) ON DELETE CASCADE,
  policy_id UUID REFERENCES public.automation_policies(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('propose', 'execute', 'defer', 'dismiss', 'fail', 'complete')),
  status TEXT NOT NULL DEFAULT 'proposed'
    CONSTRAINT operating_actions_status_check CHECK (status IN (
      'proposed', 'queued', 'sent', 'succeeded', 'failed', 'deferred', 'dismissed'
    )),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  proposed_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivery_reference TEXT,
  scheduled_for TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.onboarding_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'website', 'instagram', 'google_listing', 'whatsapp_export', 'price_list', 'owner_answer', 'other'
  )),
  source_reference TEXT,
  extracted_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  owner_edits JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(4, 3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  approval_status TEXT NOT NULL DEFAULT 'draft'
    CONSTRAINT onboarding_evidence_approval_status_check CHECK (approval_status IN ('draft', 'approved', 'rejected')),
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS operating_objectives_active_dedupe_idx
  ON public.operating_objectives (tenant_id, dedupe_key)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS operating_loop_state_tenant_day_idx
  ON public.operating_loop_state (tenant_id, operating_date DESC);
CREATE INDEX IF NOT EXISTS operating_objectives_tenant_status_idx
  ON public.operating_objectives (tenant_id, status, expires_at);
CREATE INDEX IF NOT EXISTS operating_actions_tenant_created_idx
  ON public.operating_actions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS automation_policies_tenant_status_idx
  ON public.automation_policies (tenant_id, status);
CREATE INDEX IF NOT EXISTS onboarding_evidence_tenant_status_idx
  ON public.onboarding_evidence (tenant_id, approval_status);

ALTER TABLE public.operating_loop_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operating_objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operating_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_evidence ENABLE ROW LEVEL SECURITY;

-- New tables can inherit broad API-role grants in existing Supabase projects.
-- Regrant only the operations that the policies below are meant to authorize.
REVOKE ALL ON TABLE public.operating_loop_state, public.operating_objectives,
  public.operating_actions, public.automation_policies, public.onboarding_evidence FROM anon, authenticated;
GRANT SELECT ON TABLE public.operating_loop_state, public.operating_objectives,
  public.operating_actions, public.automation_policies, public.onboarding_evidence TO authenticated;
GRANT INSERT ON TABLE public.operating_actions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.automation_policies, public.onboarding_evidence TO authenticated;
REVOKE UPDATE, DELETE ON TABLE public.operating_actions FROM authenticated;
GRANT ALL ON TABLE public.operating_loop_state, public.operating_objectives,
  public.operating_actions, public.automation_policies, public.onboarding_evidence TO service_role;

CREATE POLICY operating_loop_state_tenant_read ON public.operating_loop_state
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tenant_users membership
    WHERE membership.tenant_id = operating_loop_state.tenant_id
      AND membership.user_id = auth.uid()
  ));

CREATE POLICY operating_objectives_tenant_read ON public.operating_objectives
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tenant_users membership
    WHERE membership.tenant_id = operating_objectives.tenant_id
      AND membership.user_id = auth.uid()
  ));

CREATE POLICY operating_actions_tenant_read ON public.operating_actions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tenant_users membership
    WHERE membership.tenant_id = operating_actions.tenant_id
      AND membership.user_id = auth.uid()
  ));

CREATE POLICY automation_policies_tenant_read ON public.automation_policies
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tenant_users membership
    WHERE membership.tenant_id = automation_policies.tenant_id
      AND membership.user_id = auth.uid()
  ));

CREATE POLICY onboarding_evidence_tenant_read ON public.onboarding_evidence
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tenant_users membership
    WHERE membership.tenant_id = onboarding_evidence.tenant_id
      AND membership.user_id = auth.uid()
  ));

CREATE POLICY operating_actions_owner_insert ON public.operating_actions
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tenant_users membership
      WHERE membership.tenant_id = operating_actions.tenant_id
        AND membership.user_id = auth.uid()
        AND membership.role = 'owner'
    )
  );

CREATE POLICY automation_policies_owner_manage ON public.automation_policies
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tenant_users membership
    WHERE membership.tenant_id = automation_policies.tenant_id
      AND membership.user_id = auth.uid()
      AND membership.role = 'owner'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tenant_users membership
    WHERE membership.tenant_id = automation_policies.tenant_id
      AND membership.user_id = auth.uid()
      AND membership.role = 'owner'
  ));

CREATE POLICY onboarding_evidence_owner_manage ON public.onboarding_evidence
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tenant_users membership
    WHERE membership.tenant_id = onboarding_evidence.tenant_id
      AND membership.user_id = auth.uid()
      AND membership.role = 'owner'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tenant_users membership
    WHERE membership.tenant_id = onboarding_evidence.tenant_id
      AND membership.user_id = auth.uid()
      AND membership.role = 'owner'
  ));

CREATE POLICY operating_loop_state_service_access ON public.operating_loop_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY operating_objectives_service_access ON public.operating_objectives
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY operating_actions_service_access ON public.operating_actions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY automation_policies_service_access ON public.automation_policies
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY onboarding_evidence_service_access ON public.onboarding_evidence
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
