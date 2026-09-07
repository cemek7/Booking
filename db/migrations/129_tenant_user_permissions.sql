CREATE TABLE IF NOT EXISTS public.tenant_user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tenant_user_id uuid NOT NULL REFERENCES public.tenant_users(id) ON DELETE CASCADE,
  permission text NOT NULL,
  effect text NOT NULL CHECK (effect IN ('grant', 'revoke')),
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_user_permissions_unique UNIQUE (tenant_id, tenant_user_id, permission)
);

ALTER TABLE public.tenant_user_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_user_permissions_service_role ON public.tenant_user_permissions;
CREATE POLICY tenant_user_permissions_service_role
  ON public.tenant_user_permissions
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
