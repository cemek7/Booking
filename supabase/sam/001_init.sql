-- Initial schema for Booka (Supabase)
-- Run via supabase migrations or psql against your Supabase DB.

-- Tenants
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  industry text NOT NULL, -- medical | hospitality | beauty
  phone text,
  timezone text,
  tone_config jsonb DEFAULT '{}'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Users (tenant admins)
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  role text DEFAULT 'admin',
  created_at timestamptz DEFAULT now()
);

-- Reservations
CREATE TABLE IF NOT EXISTS reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  customer_name text,
  phone text,
  service text,
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  status text DEFAULT 'pending', -- pending | confirmed | completed | cancelled
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reservations_tenant_date_idx ON reservations (tenant_id, start_at);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  reservation_id uuid REFERENCES reservations(id) ON DELETE SET NULL,
  from_number text,
  to_number text,
  content text,
  direction text, -- inbound | outbound
  raw jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_convo_idx ON messages (tenant_id, from_number);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  amount numeric(12,2),
  currency text DEFAULT 'NGN',
  type text, -- subscription | payment | refund
  status text,
  raw jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_tenant_idx ON transactions (tenant_id, status);

-- Reservation logs
CREATE TABLE IF NOT EXISTS reservation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid REFERENCES reservations(id) ON DELETE CASCADE,
  action text,
  actor text,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Platform settings
CREATE TABLE IF NOT EXISTS platform_settings (
  key text PRIMARY KEY,
  value jsonb DEFAULT '{}'::jsonb
);

-- Row Level Security example (adjust claims according to your JWT setup)
-- Enable RLS for resources that must be tenant-scoped

ALTER TABLE IF EXISTS tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS transactions ENABLE ROW LEVEL SECURITY;

-- Example policy: allow users to SELECT/INSERT/UPDATE rows for their tenant_id when
-- the JWT contains `tenant_id` in its claims. Adjust according to your JWT key path.

-- NOTE: The exact claim access depends on your auth token structure. Supabase exposes JWT claims via current_setting('request.jwt.claims', true).

-- Example helper: function to read jwt claim (may vary per Supabase setup)

-- SELECT current_setting('request.jwt.claims', true);

-- Basic tenant-scoped SELECT policy for reservations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p
    WHERE p.polname = 'reservations_tenant_is_owner'
      AND p.tableoid::regclass::text = 'public.reservations'
  ) THEN
    EXECUTE 'CREATE POLICY "reservations_tenant_is_owner" ON reservations FOR ALL USING ((tenant_id IS NULL) OR (tenant_id::text = current_setting(''request.jwt.claims.tenant_id'', true)))';
  END IF;
END $$;

-- Caution: The above policy is a template. Replace `request.jwt.claims.tenant_id` with the exact claim path your auth system uses (e.g. 'jwt.claims.tenant_id').

-- Further policies should be created for each table (INSERT/UPDATE restrictions). See Supabase docs for RLS examples.

-- End of migration
