-- Migration: 010_create_dialog_sessions.sql
-- Adds a dialog_sessions table for dialog manager session persistence
-- Run with supabase migrations or psql in the project's DB

CREATE TABLE IF NOT EXISTS public.dialog_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  user_id uuid NULL,
  slots jsonb DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'collecting',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dialog_sessions_tenant_id ON public.dialog_sessions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_dialog_sessions_updated_at ON public.dialog_sessions (updated_at);

-- Trigger to update updated_at on modification
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dialog_sessions_touch ON public.dialog_sessions;
CREATE TRIGGER trg_dialog_sessions_touch
BEFORE UPDATE ON public.dialog_sessions
FOR EACH ROW
EXECUTE PROCEDURE public.touch_updated_at();
