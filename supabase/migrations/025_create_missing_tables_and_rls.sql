-- Migration: Create missing tables and add RLS/policies for uncovered tables
-- Date: 2025-11-20

-- Create skills table if missing
CREATE TABLE IF NOT EXISTS public.skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- Create staff_skills table if missing
CREATE TABLE IF NOT EXISTS public.staff_skills (
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid,
  skill_id uuid REFERENCES public.skills(id) ON DELETE CASCADE,
  skill_name text NOT NULL,
  proficiency smallint DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, skill_id)
);

-- (Assumes public.tenant_users already exists in your schema)

-- Enable RLS for all relevant tables
ALTER TABLE IF EXISTS public.skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.staff_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tenant_users ENABLE ROW LEVEL SECURITY;

-- Add basic SELECT policies for tenant scoping
DROP POLICY IF EXISTS skills_select ON public.skills;
CREATE POLICY skills_select ON public.skills
  FOR SELECT
  TO authenticated
  USING (
    tenant_id::text = current_setting('request.jwt.claims.tenant_id', true)
  );

DROP POLICY IF EXISTS staff_skills_select ON public.staff_skills;
CREATE POLICY staff_skills_select ON public.staff_skills
  FOR SELECT
  TO authenticated
  USING (
    tenant_id::text = current_setting('request.jwt.claims.tenant_id', true)
  );

DROP POLICY IF EXISTS tenant_users_select ON public.tenant_users;
CREATE POLICY tenant_users_select ON public.tenant_users
  FOR SELECT
  TO authenticated
  USING (
    tenant_id::text = current_setting('request.jwt.claims.tenant_id', true)
  );

-- Example: restrict INSERT/UPDATE/DELETE to owners/admins (adjust as needed)
-- Note: separate policies per operation. Use WITH CHECK for INSERT/UPDATE if you want to validate inserted/updated rows.
DROP POLICY IF EXISTS tenant_users_modify ON public.tenant_users;
CREATE POLICY tenant_users_modify ON public.tenant_users
  FOR INSERT
  TO authenticated
  WITH CHECK (
    role = 'owner'
  );

DROP POLICY IF EXISTS tenant_users_update ON public.tenant_users;
CREATE POLICY tenant_users_update ON public.tenant_users
  FOR UPDATE
  TO authenticated
  USING (
    role = 'owner'
  )
  WITH CHECK (
    role = 'owner'
  );

DROP POLICY IF EXISTS tenant_users_delete ON public.tenant_users;
CREATE POLICY tenant_users_delete ON public.tenant_users
  FOR DELETE
  TO authenticated
  USING (
    role = 'owner'
  );

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS skills_tenant_idx ON public.skills (tenant_id, active);
CREATE INDEX IF NOT EXISTS staff_skills_skill_idx ON public.staff_skills (tenant_id, skill_name);
CREATE INDEX IF NOT EXISTS staff_skills_user_idx ON public.staff_skills (tenant_id, user_id);