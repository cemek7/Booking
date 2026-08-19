CREATE TABLE IF NOT EXISTS public.tenant_approval_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('discount', 'refund', 'stock_adjustment')),
  role text NOT NULL,
  max_self_approve numeric NOT NULL,
  requires_permission text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_approval_policies_unique UNIQUE (tenant_id, request_type, role)
);

CREATE TABLE IF NOT EXISTS public.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('discount', 'refund', 'stock_adjustment')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  requested_by uuid,
  subject_type text,
  subject_id uuid,
  amount numeric,
  percent numeric,
  reason text,
  action_payload jsonb NOT NULL,
  required_permission text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.approval_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES public.approval_requests(id) ON DELETE CASCADE,
  actor_id uuid,
  decision text NOT NULL CHECK (decision IN ('approve', 'reject')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_approval_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_approval_policies_service_role ON public.tenant_approval_policies;
CREATE POLICY tenant_approval_policies_service_role
  ON public.tenant_approval_policies
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS approval_requests_service_role ON public.approval_requests;
CREATE POLICY approval_requests_service_role
  ON public.approval_requests
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS approval_actions_service_role ON public.approval_actions;
CREATE POLICY approval_actions_service_role
  ON public.approval_actions
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
