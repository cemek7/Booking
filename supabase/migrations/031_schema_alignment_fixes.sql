-- Migration 031: Database Schema Alignment for Role Hierarchy
-- Date: 2025-11-30
-- Priority: Critical Schema Alignment

-- ========================================
-- 1. Fix Role Hierarchy Index Optimization
-- ========================================

-- Drop old indexes that don't align with role hierarchy
DROP INDEX IF EXISTS public.tenant_users_tenant_role_idx;

-- Create optimized indexes for role-based queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_users_hierarchy
  ON public.tenant_users (tenant_id, role, user_id)
  WHERE role IN ('staff', 'manager', 'owner', 'superadmin');

-- Create partial indexes for common role queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_users_owners
  ON public.tenant_users (tenant_id, user_id)
  WHERE role = 'owner';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_users_managers
  ON public.tenant_users (tenant_id, user_id)
  WHERE role IN ('manager', 'owner');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_users_active_staff
  ON public.tenant_users (tenant_id, user_id, role)
  WHERE status = 'active';

-- ========================================
-- 2. Enhance Role Constraint Validation
-- ========================================

-- Add role level constraint for proper hierarchy ordering
ALTER TABLE public.tenant_users
DROP CONSTRAINT IF EXISTS tenant_users_role_hierarchy;

ALTER TABLE public.tenant_users
ADD CONSTRAINT tenant_users_role_hierarchy
CHECK (
  role IN ('staff', 'manager', 'owner', 'superadmin') AND
  CASE role
    WHEN 'superadmin' THEN true  -- Level 0: Platform admin
    WHEN 'owner' THEN true       -- Level 1: Tenant admin
    WHEN 'manager' THEN true     -- Level 2: Operations lead
    WHEN 'staff' THEN true       -- Level 3: Base worker
    ELSE false
  END
);

-- ========================================
-- 3. Add Role Inheritance Support Functions
-- ========================================

-- Function to get role hierarchy level (0=highest, 3=lowest)
CREATE OR REPLACE FUNCTION public.get_role_level(role_name TEXT)
RETURNS INTEGER AS $$
BEGIN
  CASE role_name
    WHEN 'superadmin' THEN RETURN 0;
    WHEN 'owner' THEN RETURN 1;
    WHEN 'manager' THEN RETURN 2;
    WHEN 'staff' THEN RETURN 3;
    ELSE RETURN 999; -- Invalid role
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to check if user can inherit permissions from target role
CREATE OR REPLACE FUNCTION public.can_inherit_role(user_role TEXT, target_role TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  -- Higher roles (lower numbers) can inherit from lower roles (higher numbers)
  RETURN public.get_role_level(user_role) <= public.get_role_level(target_role);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ========================================
-- 4. Optimize Foreign Key Relationships
-- ========================================

-- Ensure all tenant_users foreign keys have proper cascade behavior
ALTER TABLE public.tenant_users
DROP CONSTRAINT IF EXISTS tenants_users_tenant_id_fkey;

ALTER TABLE public.tenant_users
ADD CONSTRAINT tenant_users_tenant_id_fkey
FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
ON DELETE CASCADE ON UPDATE CASCADE;

-- Ensure user_id foreign key exists and is properly configured
ALTER TABLE public.tenant_users
DROP CONSTRAINT IF EXISTS tenants_users_user_id_fkey;

ALTER TABLE public.tenant_users
ADD CONSTRAINT tenant_users_user_id_fkey
FOREIGN KEY (user_id) REFERENCES auth.users(id)
ON DELETE CASCADE ON UPDATE CASCADE;

-- ========================================
-- 5. Add Tenant Ownership Validation
-- ========================================

-- Ensure every tenant has at least one owner
CREATE OR REPLACE FUNCTION public.validate_tenant_ownership()
RETURNS TRIGGER AS $$
BEGIN
  -- On DELETE or role change from owner, ensure another owner exists
  IF (TG_OP = 'DELETE' AND OLD.role = 'owner') OR 
     (TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.role != 'owner') THEN
    
    IF NOT EXISTS (
      SELECT 1 FROM public.tenant_users
      WHERE tenant_id = OLD.tenant_id
        AND role = 'owner'
        AND user_id != OLD.user_id
        AND (TG_OP = 'DELETE' OR user_id != NEW.user_id)
    ) THEN
      RAISE EXCEPTION 'Cannot remove the last owner from tenant %', OLD.tenant_id;
    END IF;
  END IF;
  
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the ownership validation trigger
DROP TRIGGER IF EXISTS validate_tenant_ownership_trigger ON public.tenant_users;
CREATE TRIGGER validate_tenant_ownership_trigger
  BEFORE UPDATE OR DELETE ON public.tenant_users
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_tenant_ownership();

-- ========================================
-- 6. Add Role-Based Access Optimization
-- ========================================

-- Function for efficient role-based access checks
CREATE OR REPLACE FUNCTION public.check_role_access(
  user_id UUID,
  tenant_id UUID,
  required_role TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  user_role TEXT;
BEGIN
  -- Check if user is superadmin first
  IF EXISTS (
    SELECT 1 FROM public.admins 
    WHERE admins.user_id = check_role_access.user_id 
    AND is_active = true
  ) THEN
    RETURN true;
  END IF;
  
  -- Get user's role for the tenant
  SELECT role INTO user_role
  FROM public.tenant_users tu
  WHERE tu.user_id = check_role_access.user_id
    AND tu.tenant_id = check_role_access.tenant_id
  LIMIT 1;
  
  -- Return false if no membership found
  IF user_role IS NULL THEN
    RETURN false;
  END IF;
  
  -- Use role inheritance (higher roles can access lower role endpoints)
  RETURN public.can_inherit_role(user_role, required_role);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_role_level TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_inherit_role TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_role_access TO authenticated;

-- ========================================
-- 7. Update RLS Policies for Role Hierarchy
-- ========================================

-- Drop existing tenant_users policies
DROP POLICY IF EXISTS tenant_users_tenant_select ON public.tenant_users;
DROP POLICY IF EXISTS tenant_users_tenant_modify ON public.tenant_users;

-- Create hierarchy-aware RLS policies
CREATE POLICY tenant_users_hierarchy_select ON public.tenant_users
  FOR SELECT TO authenticated
  USING (
    -- Users can see their own memberships
    user_id = auth.uid() OR
    -- Users can see others in their tenant based on role hierarchy
    tenant_id IN (
      SELECT t.tenant_id 
      FROM public.tenant_users t
      WHERE t.user_id = auth.uid()
      AND public.can_inherit_role(t.role, 'staff') -- Must be staff+ to see others
    )
  );

-- Modify policy - only managers+ can modify user roles
CREATE POLICY tenant_users_hierarchy_modify ON public.tenant_users
  FOR ALL TO authenticated
  USING (
    -- Superadmins can modify anyone
    auth.uid()::text IN (SELECT user_id::text FROM public.admins WHERE is_active = true) OR
    -- Owners can modify users in their tenant
    EXISTS (
      SELECT 1 FROM public.tenant_users tu
      WHERE tu.user_id = auth.uid()
      AND tu.tenant_id = tenant_users.tenant_id
      AND tu.role IN ('owner')
    ) OR
    -- Managers can modify staff (but not other managers/owners)
    EXISTS (
      SELECT 1 FROM public.tenant_users tu
      WHERE tu.user_id = auth.uid()
      AND tu.tenant_id = tenant_users.tenant_id
      AND tu.role = 'manager'
      AND tenant_users.role = 'staff'
    )
  )
  WITH CHECK (
    -- Same hierarchy rules for inserts/updates
    auth.uid()::text IN (SELECT user_id::text FROM public.admins WHERE is_active = true) OR
    EXISTS (
      SELECT 1 FROM public.tenant_users tu
      WHERE tu.user_id = auth.uid()
      AND tu.tenant_id = tenant_users.tenant_id
      AND public.get_role_level(tu.role) < public.get_role_level(tenant_users.role)
    )
  );

-- ========================================
-- 8. Add Performance Monitoring
-- ========================================

-- Create materialized view for role hierarchy statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS public.role_hierarchy_stats AS
SELECT 
  tenant_id,
  COUNT(*) FILTER (WHERE role = 'superadmin') as superadmin_count,
  COUNT(*) FILTER (WHERE role = 'owner') as owner_count,
  COUNT(*) FILTER (WHERE role = 'manager') as manager_count,
  COUNT(*) FILTER (WHERE role = 'staff') as staff_count,
  COUNT(*) as total_users,
  MAX(created_at) as last_user_added
FROM public.tenant_users
WHERE status = 'active'
GROUP BY tenant_id;

-- Create unique index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS role_hierarchy_stats_tenant_idx 
  ON public.role_hierarchy_stats (tenant_id);

-- Function to refresh role hierarchy stats
CREATE OR REPLACE FUNCTION public.refresh_role_hierarchy_stats()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.role_hierarchy_stats;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- 9. Data Migration and Cleanup
-- ========================================

-- Update any remaining legacy role references
UPDATE public.tenant_users 
SET role = 'superadmin' 
WHERE role IN ('admin', 'platform_admin');

UPDATE public.tenant_users 
SET role = 'owner' 
WHERE role IN ('tenant_admin', 'administrator');

UPDATE public.tenant_users 
SET role = 'staff' 
WHERE role IN ('employee', 'receptionist', 'worker');

-- Ensure all tenants have at least one owner
INSERT INTO public.tenant_users (tenant_id, user_id, role, email)
SELECT DISTINCT 
  t.id as tenant_id,
  t.created_by as user_id,
  'owner' as role,
  u.email
FROM public.tenants t
LEFT JOIN auth.users u ON t.created_by = u.id
WHERE NOT EXISTS (
  SELECT 1 FROM public.tenant_users tu 
  WHERE tu.tenant_id = t.id 
  AND tu.role = 'owner'
)
AND t.created_by IS NOT NULL
ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'owner';

-- ========================================
-- 10. Add Schema Validation
-- ========================================

-- Function to validate schema alignment
CREATE OR REPLACE FUNCTION public.validate_schema_alignment()
RETURNS TABLE (
  table_name TEXT,
  issue_type TEXT,
  issue_description TEXT,
  severity TEXT
) AS $$
BEGIN
  -- Check for missing indexes
  RETURN QUERY
  SELECT 
    'tenant_users'::TEXT,
    'missing_index'::TEXT,
    'No index found for: ' || column_names,
    'medium'::TEXT
  FROM (
    VALUES 
      ('tenant_id, role'),
      ('user_id, tenant_id'),
      ('role, status')
  ) AS expected_indexes(column_names)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'tenant_users'
    AND indexdef LIKE '%' || column_names || '%'
  );
  
  -- Check for role constraint violations
  RETURN QUERY
  SELECT 
    'tenant_users'::TEXT,
    'invalid_role'::TEXT,
    'Found ' || COUNT(*)::TEXT || ' records with invalid roles',
    'high'::TEXT
  FROM public.tenant_users
  WHERE role NOT IN ('staff', 'manager', 'owner', 'superadmin')
  HAVING COUNT(*) > 0;
  
  -- Check for orphaned tenants without owners
  RETURN QUERY
  SELECT 
    'tenants'::TEXT,
    'orphaned_tenant'::TEXT,
    'Tenant ' || t.id::TEXT || ' has no owners',
    'critical'::TEXT
  FROM public.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tenant_users tu
    WHERE tu.tenant_id = t.id
    AND tu.role = 'owner'
  );
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.validate_schema_alignment TO authenticated;

-- ========================================
-- 11. Final Validation and Refresh
-- ========================================

-- Refresh the role hierarchy stats
SELECT public.refresh_role_hierarchy_stats();

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Schema alignment migration 031 completed successfully';
  RAISE NOTICE 'Role hierarchy properly aligned with 4-level system';
  RAISE NOTICE 'Inheritance functions and RLS policies updated';
  RAISE NOTICE 'Performance indexes optimized for role-based queries';
END $$;