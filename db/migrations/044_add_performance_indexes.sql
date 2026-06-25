-- Performance indexes for multi-tenant queries
-- These indexes cover the most common query patterns across the application

-- Reservations: most queries filter by tenant_id + status, with optional staff_id and time range
CREATE INDEX IF NOT EXISTS idx_reservations_tenant_staff_start_status
  ON reservations (tenant_id, staff_id, start_at, status);

CREATE INDEX IF NOT EXISTS idx_reservations_tenant_status
  ON reservations (tenant_id, status);

-- Customers: always queried by tenant_id
CREATE INDEX IF NOT EXISTS idx_customers_tenant_id
  ON customers (tenant_id);

-- Messages: always queried by tenant_id
CREATE INDEX IF NOT EXISTS idx_messages_tenant_id
  ON messages (tenant_id);

-- Tenant users: queried by user_id (for role lookup) and by tenant_id (for member listing)
CREATE INDEX IF NOT EXISTS idx_tenant_users_user_tenant
  ON tenant_users (user_id, tenant_id);

-- Transactions: queried by tenant_id for reconciliation and dashboards
CREATE INDEX IF NOT EXISTS idx_transactions_tenant_id
  ON transactions (tenant_id);

-- Unique constraint to prevent exact duplicate reservations (Fix 3: race condition defense)
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_no_exact_duplicates
  ON reservations (tenant_id, staff_id, start_at, end_at, status)
  WHERE status IN ('pending', 'confirmed');
