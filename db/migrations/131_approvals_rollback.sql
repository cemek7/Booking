DROP POLICY IF EXISTS approval_actions_service_role ON public.approval_actions;
DROP POLICY IF EXISTS approval_requests_service_role ON public.approval_requests;
DROP POLICY IF EXISTS tenant_approval_policies_service_role ON public.tenant_approval_policies;

DROP TABLE IF EXISTS public.approval_actions CASCADE;
DROP TABLE IF EXISTS public.approval_requests CASCADE;
DROP TABLE IF EXISTS public.tenant_approval_policies CASCADE;
