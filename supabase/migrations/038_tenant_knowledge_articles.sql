-- Migration 038: Tenant Knowledge Articles
-- Stores FAQ / policy documents per tenant used for RAG retrieval
-- in the AI chat agent.

BEGIN;

CREATE TABLE IF NOT EXISTS tenant_knowledge_articles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'general',
  tags         TEXT[] NOT NULL DEFAULT '{}',
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_tenant
  ON tenant_knowledge_articles (tenant_id, is_active);

ALTER TABLE tenant_knowledge_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_articles_tenant_read ON tenant_knowledge_articles
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
    )
  );

CREATE POLICY knowledge_articles_owner_write ON tenant_knowledge_articles
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

COMMIT;
