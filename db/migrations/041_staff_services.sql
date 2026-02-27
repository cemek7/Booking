-- Migration 041: staff_services linking table
-- Maps which staff members can perform which services (many-to-many)

CREATE TABLE IF NOT EXISTS staff_services (
  tenant_id     TEXT        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_user_id TEXT        NOT NULL,
  service_id    TEXT        NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, staff_user_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_services_tenant ON staff_services(tenant_id);
CREATE INDEX IF NOT EXISTS idx_staff_services_service ON staff_services(service_id);
CREATE INDEX IF NOT EXISTS idx_staff_services_staff   ON staff_services(staff_user_id);

ALTER TABLE staff_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can read staff_services"
  ON staff_services FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tenant_users tu
      WHERE tu.tenant_id = staff_services.tenant_id
        AND tu.user_id = auth.uid()::text
    )
  );

CREATE POLICY "Owners and managers can manage staff_services"
  ON staff_services FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM tenant_users tu
      WHERE tu.tenant_id = staff_services.tenant_id
        AND tu.user_id = auth.uid()::text
        AND tu.role IN ('owner', 'manager')
    )
  );
