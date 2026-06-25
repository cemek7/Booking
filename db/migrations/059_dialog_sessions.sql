-- Migration 059: dialog_sessions table
--
-- Used by src/lib/dialogManager.ts as the Postgres persistence layer for
-- multi-turn WhatsApp booking conversations. Redis is preferred when available;
-- this table is the fallback that keeps session state across server restarts.
--
-- Schema matches what dialogManager.writeSessionToStore() upserts:
--   id, tenant_id, user_id, slots, state, created_at, updated_at

CREATE TABLE IF NOT EXISTS public.dialog_sessions (
  id         TEXT        PRIMARY KEY,
  tenant_id  UUID        REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID,
  slots      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  state      TEXT        NOT NULL DEFAULT 'collecting',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dialog_sessions_tenant
  ON public.dialog_sessions (tenant_id);

CREATE INDEX IF NOT EXISTS idx_dialog_sessions_updated
  ON public.dialog_sessions (updated_at DESC);

-- Auto-update updated_at on every write
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dialog_sessions_touch ON public.dialog_sessions;
CREATE TRIGGER trg_dialog_sessions_touch
  BEFORE UPDATE ON public.dialog_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS: service_role only — sessions are written/read by background job workers,
-- never directly by authenticated browser clients.
ALTER TABLE public.dialog_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dialog_sessions_service_role ON public.dialog_sessions;
CREATE POLICY dialog_sessions_service_role ON public.dialog_sessions
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
