-- Migration 063: leads table for smart lead capture & follow-up
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text,
  phone text NOT NULL,
  email text,
  source text DEFAULT 'whatsapp',        -- whatsapp | web | manual
  intent text,                            -- booking | inquiry | product_inquiry
  notes text,
  status text DEFAULT 'new',             -- new | contacted | converted | dismissed
  follow_up_at timestamptz,
  followed_up_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_tenant_id_idx ON leads(tenant_id);
CREATE INDEX IF NOT EXISTS leads_status_follow_up_idx ON leads(status, follow_up_at)
  WHERE status = 'new' AND follow_up_at IS NOT NULL;

-- RLS
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Owners and managers can read/write their tenant's leads
CREATE POLICY "leads_tenant_access" ON leads
  FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );

-- Service role (background jobs) has unrestricted access
CREATE POLICY "leads_service_role" ON leads
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
