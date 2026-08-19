-- 046: create tasks table for per-tenant task management
BEGIN;

CREATE TABLE IF NOT EXISTS tasks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  title       TEXT        NOT NULL,
  description TEXT,
  priority    VARCHAR(10) NOT NULL DEFAULT 'medium'
                CHECK (priority IN ('low', 'medium', 'high')),
  status      VARCHAR(20) NOT NULL DEFAULT 'todo'
                CHECK (status IN ('todo', 'in_progress', 'done')),
  due_date    DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_tenant_id ON tasks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status ON tasks (tenant_id, status);

COMMIT;
