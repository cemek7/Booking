-- Migration 076: Add alert_rules table for observability service
-- Removes runtime noise from node-observability.ts by creating the table it expects.

CREATE TABLE IF NOT EXISTS public.alert_rules (
  id         UUID        PRIMARY KEY,
  metric     TEXT        NOT NULL,
  threshold  DOUBLE PRECISION NOT NULL,
  operator   TEXT        NOT NULL CHECK (operator IN ('gt', 'lt', 'eq', 'gte', 'lte')),
  duration   INTEGER     NOT NULL DEFAULT 0,
  enabled    BOOLEAN     NOT NULL DEFAULT true,
  channels   TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  metadata   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled
  ON public.alert_rules (enabled);

ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alert_rules_service_role ON public.alert_rules;
CREATE POLICY alert_rules_service_role ON public.alert_rules
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
