-- Migration 030: Add Role Constraints and Data Validation
-- Date: 2025-11-25
-- Priority: Critical Security Fix

-- Create role enum type for consistency
DO $$ BEGIN
    CREATE TYPE public.user_role AS ENUM ('staff', 'manager', 'owner', 'superadmin');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add check constraint for role validation
ALTER TABLE public.tenant_users 
DROP CONSTRAINT IF EXISTS tenant_users_role_check;

ALTER TABLE public.tenant_users 
ADD CONSTRAINT tenant_users_role_check 
CHECK (role IN ('staff', 'manager', 'owner', 'superadmin'));

-- Create function to normalize legacy roles
CREATE OR REPLACE FUNCTION public.normalize_role(input_role TEXT)
RETURNS TEXT AS $$
BEGIN
  CASE input_role
    WHEN 'admin' THEN RETURN 'superadmin';
    WHEN 'tenant_admin' THEN RETURN 'owner';
    WHEN 'receptionist' THEN RETURN 'staff';
    ELSE 
      IF input_role IN ('staff', 'manager', 'owner', 'superadmin') THEN
        RETURN input_role;
      ELSE
        RAISE EXCEPTION 'Invalid role: %', input_role;
      END IF;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Migrate existing data with invalid roles
UPDATE public.tenant_users 
SET role = public.normalize_role(role)
WHERE role NOT IN ('staff', 'manager', 'owner', 'superadmin');

-- Create trigger to auto-normalize roles on insert/update
CREATE OR REPLACE FUNCTION public.trigger_normalize_role()
RETURNS TRIGGER AS $$
BEGIN
  NEW.role = public.normalize_role(NEW.role);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS normalize_role_trigger ON public.tenant_users;
CREATE TRIGGER normalize_role_trigger
  BEFORE INSERT OR UPDATE OF role ON public.tenant_users
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_normalize_role();

-- Add unique constraint to prevent duplicate tenant memberships
ALTER TABLE public.tenant_users 
DROP CONSTRAINT IF EXISTS tenant_users_unique_membership;

ALTER TABLE public.tenant_users 
ADD CONSTRAINT tenant_users_unique_membership 
UNIQUE (tenant_id, user_id);

-- Add constraint to ensure at least one owner per tenant
CREATE OR REPLACE FUNCTION public.ensure_tenant_owner()
RETURNS TRIGGER AS $$
BEGIN
  -- On DELETE, check if we're removing the last owner
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.tenant_users 
        WHERE tenant_id = OLD.tenant_id 
        AND role = 'owner' 
        AND user_id != OLD.user_id
      ) THEN
        RAISE EXCEPTION 'Cannot remove the last owner from tenant';
      END IF;
    END IF;
    RETURN OLD;
  END IF;
  
  -- On UPDATE, check if we're changing the last owner's role
  IF TG_OP = 'UPDATE' THEN
    IF OLD.role = 'owner' AND NEW.role != 'owner' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.tenant_users 
        WHERE tenant_id = OLD.tenant_id 
        AND role = 'owner' 
        AND user_id != OLD.user_id
      ) THEN
        RAISE EXCEPTION 'Cannot change role of the last owner in tenant';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ensure_tenant_owner_trigger ON public.tenant_users;
CREATE TRIGGER ensure_tenant_owner_trigger
  BEFORE UPDATE OR DELETE ON public.tenant_users
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_tenant_owner();

-- Add constraint for tenant_id format validation
ALTER TABLE public.tenant_users
DROP CONSTRAINT IF EXISTS tenant_users_tenant_id_format;

ALTER TABLE public.tenant_users
ADD CONSTRAINT tenant_users_tenant_id_format
CHECK (tenant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- Add constraint for user_id format validation  
ALTER TABLE public.tenant_users
DROP CONSTRAINT IF EXISTS tenant_users_user_id_format;

ALTER TABLE public.tenant_users
ADD CONSTRAINT tenant_users_user_id_format
CHECK (user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- Ensure admins table exists with proper constraints
CREATE TABLE IF NOT EXISTS public.admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  is_active BOOLEAN DEFAULT TRUE
);

-- Enable RLS on admins table
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

-- Only superadmins can manage other superadmins
CREATE POLICY admins_access ON public.admins
  FOR ALL TO authenticated
  USING (auth.uid()::text IN (SELECT user_id::text FROM public.admins))
  WITH CHECK (auth.uid()::text IN (SELECT user_id::text FROM public.admins));

-- Service role access
CREATE POLICY admins_service ON public.admins
  FOR ALL TO service_role 
  USING (true) 
  WITH CHECK (true);

-- Add index for performance
CREATE INDEX IF NOT EXISTS admins_user_id_idx ON public.admins (user_id);
CREATE INDEX IF NOT EXISTS admins_email_idx ON public.admins (email);

-- Create view for safe role checking
CREATE OR REPLACE VIEW public.user_roles_view AS
SELECT 
  tu.user_id,
  tu.tenant_id,
  tu.role,
  t.name as tenant_name,
  CASE 
    WHEN a.user_id IS NOT NULL THEN true 
    ELSE false 
  END as is_superadmin
FROM public.tenant_users tu
JOIN public.tenants t ON tu.tenant_id = t.id
LEFT JOIN public.admins a ON tu.user_id = a.user_id AND a.is_active = true;

-- Grant access to the view
GRANT SELECT ON public.user_roles_view TO authenticated;

-- Add RLS to the view
ALTER VIEW public.user_roles_view SET (security_invoker = true);

-- Create function to safely check user permissions
CREATE OR REPLACE FUNCTION public.check_user_permission(
  check_user_id UUID,
  check_tenant_id UUID,
  required_role TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  user_role TEXT;
  is_admin BOOLEAN;
BEGIN
  -- Check if user is superadmin
  SELECT EXISTS(
    SELECT 1 FROM public.admins 
    WHERE user_id = check_user_id AND is_active = true
  ) INTO is_admin;
  
  IF is_admin THEN
    RETURN true;
  END IF;
  
  -- Check tenant membership and role
  SELECT role INTO user_role
  FROM public.tenant_users
  WHERE user_id = check_user_id 
  AND tenant_id = check_tenant_id;
  
  IF user_role IS NULL THEN
    RETURN false; -- User not in tenant
  END IF;
  
  -- If no specific role required, just check membership
  IF required_role IS NULL THEN
    RETURN true;
  END IF;
  
  -- Check role hierarchy
  CASE required_role
    WHEN 'staff' THEN
      RETURN user_role IN ('staff', 'manager', 'owner');
    WHEN 'manager' THEN
      RETURN user_role IN ('manager', 'owner');
    WHEN 'owner' THEN
      RETURN user_role = 'owner';
    ELSE
      RETURN user_role = required_role;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.check_user_permission TO authenticated;

-- Add data validation for existing records
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  -- Count invalid tenant_id formats
  SELECT COUNT(*) INTO invalid_count
  FROM public.tenant_users
  WHERE tenant_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  
  IF invalid_count > 0 THEN
    RAISE WARNING 'Found % records with invalid tenant_id format', invalid_count;
  END IF;
  
  -- Count invalid user_id formats
  SELECT COUNT(*) INTO invalid_count
  FROM public.tenant_users
  WHERE user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  
  IF invalid_count > 0 THEN
    RAISE WARNING 'Found % records with invalid user_id format', invalid_count;
  END IF;
END $$;