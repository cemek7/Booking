-- Migration 029: Fix RLS Policies and Add Tenant Isolation
-- Date: 2025-11-25
-- Priority: Critical Security Fix

-- First, let's add the superadmin audit table
CREATE TABLE IF NOT EXISTS public.superadmin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  target_tenant_id UUID REFERENCES public.tenants(id),
  target_user_id UUID REFERENCES auth.users(id),
  target_resource TEXT,
  request_details JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS for audit table
ALTER TABLE public.superadmin_audit_log ENABLE ROW LEVEL SECURITY;

-- Only superadmins can access audit logs
CREATE POLICY superadmin_audit_log_access ON public.superadmin_audit_log
  FOR ALL TO authenticated
  USING (auth.uid()::text IN (SELECT user_id::text FROM public.admins))
  WITH CHECK (auth.uid()::text IN (SELECT user_id::text FROM public.admins));

-- Service role access for system operations
CREATE POLICY superadmin_audit_log_service ON public.superadmin_audit_log
  FOR ALL TO service_role 
  USING (true) 
  WITH CHECK (true);

-- Now fix existing RLS policies with proper tenant isolation

-- Fix tenant_users table RLS
DROP POLICY IF EXISTS tenant_users_select ON public.tenant_users;
DROP POLICY IF EXISTS tenant_users_modify ON public.tenant_users;
DROP POLICY IF EXISTS tenant_users_update ON public.tenant_users;
DROP POLICY IF EXISTS tenant_users_delete ON public.tenant_users;

-- Proper tenant_users policies
CREATE POLICY tenant_users_tenant_select ON public.tenant_users
  FOR SELECT TO authenticated
  USING (
    -- Users can see their own memberships across tenants
    user_id = auth.uid() OR
    -- Users can see other members in their tenant
    tenant_id::text IN (
      SELECT t.tenant_id::text 
      FROM public.tenant_users t 
      WHERE t.user_id = auth.uid()
    ) OR
    -- Superadmins can see all
    auth.uid()::text IN (SELECT user_id::text FROM public.admins)
  );

CREATE POLICY tenant_users_insert ON public.tenant_users
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Only owners can add users to their tenant
    tenant_id::text IN (
      SELECT t.tenant_id::text 
      FROM public.tenant_users t 
      WHERE t.user_id = auth.uid() 
      AND t.role IN ('owner')
    ) OR
    -- Superadmins can add users to any tenant
    auth.uid()::text IN (SELECT user_id::text FROM public.admins)
  );

CREATE POLICY tenant_users_update ON public.tenant_users
  FOR UPDATE TO authenticated
  USING (
    -- Only owners can update roles in their tenant (except their own)
    (tenant_id::text IN (
      SELECT t.tenant_id::text 
      FROM public.tenant_users t 
      WHERE t.user_id = auth.uid() 
      AND t.role IN ('owner')
    ) AND user_id != auth.uid()) OR
    -- Users can update their own non-role fields
    user_id = auth.uid() OR
    -- Superadmins can update any
    auth.uid()::text IN (SELECT user_id::text FROM public.admins)
  )
  WITH CHECK (
    -- Same conditions for updates
    (tenant_id::text IN (
      SELECT t.tenant_id::text 
      FROM public.tenant_users t 
      WHERE t.user_id = auth.uid() 
      AND t.role IN ('owner')
    ) AND user_id != auth.uid()) OR
    user_id = auth.uid() OR
    auth.uid()::text IN (SELECT user_id::text FROM public.admins)
  );

CREATE POLICY tenant_users_delete ON public.tenant_users
  FOR DELETE TO authenticated
  USING (
    -- Only owners can remove users from their tenant (except themselves)
    (tenant_id::text IN (
      SELECT t.tenant_id::text 
      FROM public.tenant_users t 
      WHERE t.user_id = auth.uid() 
      AND t.role IN ('owner')
    ) AND user_id != auth.uid()) OR
    -- Users can remove themselves
    user_id = auth.uid() OR
    -- Superadmins can remove any
    auth.uid()::text IN (SELECT user_id::text FROM public.admins)
  );

-- Fix reservations table RLS
DROP POLICY IF EXISTS reservations_select ON public.reservations;

CREATE POLICY reservations_tenant_select ON public.reservations
  FOR SELECT TO authenticated
  USING (
    -- Users can see reservations in their tenant
    tenant_id::text IN (
      SELECT t.tenant_id::text 
      FROM public.tenant_users t 
      WHERE t.user_id = auth.uid()
    ) OR
    -- Superadmins can see all
    auth.uid()::text IN (SELECT user_id::text FROM public.admins)
  );

CREATE POLICY reservations_insert ON public.reservations
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Users can create reservations in their tenant
    tenant_id::text IN (
      SELECT t.tenant_id::text 
      FROM public.tenant_users t 
      WHERE t.user_id = auth.uid()
      AND t.role IN ('owner', 'manager', 'staff')
    ) OR
    -- Superadmins can create in any tenant
    auth.uid()::text IN (SELECT user_id::text FROM public.admins)
  );

CREATE POLICY reservations_update ON public.reservations
  FOR UPDATE TO authenticated
  USING (
    -- Users can update reservations in their tenant
    tenant_id::text IN (
      SELECT t.tenant_id::text 
      FROM public.tenant_users t 
      WHERE t.user_id = auth.uid()
      AND t.role IN ('owner', 'manager', 'staff')
    ) OR
    -- Superadmins can update any
    auth.uid()::text IN (SELECT user_id::text FROM public.admins)
  )
  WITH CHECK (
    -- Same conditions for updates
    tenant_id::text IN (
      SELECT t.tenant_id::text 
      FROM public.tenant_users t 
      WHERE t.user_id = auth.uid()
      AND t.role IN ('owner', 'manager', 'staff')
    ) OR
    auth.uid()::text IN (SELECT user_id::text FROM public.admins)
  );

-- Fix other critical tables
-- Skills table
DROP POLICY IF EXISTS skills_select ON public.skills;

CREATE POLICY skills_tenant_access ON public.skills
  FOR ALL TO authenticated
  USING (
    tenant_id::text IN (
      SELECT t.tenant_id::text 
      FROM public.tenant_users t 
      WHERE t.user_id = auth.uid()
    ) OR
    auth.uid()::text IN (SELECT user_id::text FROM public.admins)
  )
  WITH CHECK (
    tenant_id::text IN (
      SELECT t.tenant_id::text 
      FROM public.tenant_users t 
      WHERE t.user_id = auth.uid()
    ) OR
    auth.uid()::text IN (SELECT user_id::text FROM public.admins)
  );

-- Staff skills table
DROP POLICY IF EXISTS staff_skills_select ON public.staff_skills;

CREATE POLICY staff_skills_tenant_access ON public.staff_skills
  FOR ALL TO authenticated
  USING (
    tenant_id::text IN (
      SELECT t.tenant_id::text 
      FROM public.tenant_users t 
      WHERE t.user_id = auth.uid()
    ) OR
    auth.uid()::text IN (SELECT user_id::text FROM public.admins)
  )
  WITH CHECK (
    tenant_id::text IN (
      SELECT t.tenant_id::text 
      FROM public.tenant_users t 
      WHERE t.user_id = auth.uid()
    ) OR
    auth.uid()::text IN (SELECT user_id::text FROM public.admins)
  );

-- Tenants table - users can only see/modify their own tenants
DROP POLICY IF EXISTS tenants_select ON public.tenants;

CREATE POLICY tenants_access ON public.tenants
  FOR SELECT TO authenticated
  USING (
    -- Users can see tenants they're members of
    id::text IN (
      SELECT t.tenant_id::text 
      FROM public.tenant_users t 
      WHERE t.user_id = auth.uid()
    ) OR
    -- Superadmins can see all
    auth.uid()::text IN (SELECT user_id::text FROM public.admins)
  );

CREATE POLICY tenants_update ON public.tenants
  FOR UPDATE TO authenticated
  USING (
    -- Only owners can update tenant settings
    id::text IN (
      SELECT t.tenant_id::text 
      FROM public.tenant_users t 
      WHERE t.user_id = auth.uid()
      AND t.role = 'owner'
    ) OR
    -- Superadmins can update any
    auth.uid()::text IN (SELECT user_id::text FROM public.admins)
  )
  WITH CHECK (
    id::text IN (
      SELECT t.tenant_id::text 
      FROM public.tenant_users t 
      WHERE t.user_id = auth.uid()
      AND t.role = 'owner'
    ) OR
    auth.uid()::text IN (SELECT user_id::text FROM public.admins)
  );

-- Service role access for all tables
CREATE POLICY tenant_users_service ON public.tenant_users
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY reservations_service ON public.reservations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY skills_service ON public.skills
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY staff_skills_service ON public.staff_skills
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY tenants_service ON public.tenants
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS tenant_users_tenant_role_idx ON public.tenant_users (tenant_id, role);
CREATE INDEX IF NOT EXISTS reservations_tenant_date_idx ON public.reservations (tenant_id, start_time);
CREATE INDEX IF NOT EXISTS superadmin_audit_log_admin_action_idx ON public.superadmin_audit_log (admin_user_id, action, created_at);

-- Add a function to get user's tenant memberships (useful for RLS)
CREATE OR REPLACE FUNCTION public.get_user_tenant_ids(user_uuid UUID)
RETURNS TABLE(tenant_id UUID) AS $$
BEGIN
  RETURN QUERY
  SELECT t.tenant_id
  FROM public.tenant_users t
  WHERE t.user_id = user_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_user_tenant_ids TO authenticated;