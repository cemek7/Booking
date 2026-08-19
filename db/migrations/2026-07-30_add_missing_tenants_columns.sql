-- Migration: restore missing tenants columns (settings, updated_at, status)
-- Date: 2026-07-30
--
-- WHY: application code references tenants.settings, tenants.updated_at, and
-- tenants.status, but neither the live information_schema dump (2026-07-30) nor
-- the baseline (2026-07-06) contains them — the code drifted from the schema.
-- Affected live paths that currently 500 or hit a fragile fallback:
--   * /api/superadmin/tenants/[tenantId] — writes updated_at+status, selects
--     status,updated_at,settings (the final select 500s every call).
--   * /api/tenants/[tenantId]/settings — settings read/merge (falls back to
--     metadata.ui_settings when the column is absent).
--   * /api/tenants/[tenantId]/whatsapp/connect — writes v2_enabled+updated_at.
--   * owner-settings-service, tenant-currency, apikey, invites — read settings.
--
-- SAFETY: every step is ADD COLUMN IF NOT EXISTS, so this is a NO-OP if the
-- columns already exist (i.e. if both dumps were simply incomplete) and a
-- gap-fill if they are genuinely missing. Non-destructive, no RLS change (adding
-- a column does not alter row-visibility policies). The settings backfill only
-- writes rows where settings is still empty, so re-runs never clobber. Reviewer
-- runs this; validated in a throwaway postgres:16-alpine container.

BEGIN;

-- 1. settings jsonb — declared by 0001_init, read by 8+ routes. Default matches init.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS settings jsonb DEFAULT '{}'::jsonb;

-- 2. updated_at — written by superadmin patch + whatsapp connect + others.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 3. status — set by the superadmin tenant patch (distinct from lifecycle_state,
--    which drives the offboarding state machine). 'active' mirrors the
--    lifecycle_state default so existing tenants read as active.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';

-- 4. Backfill settings from the metadata.ui_settings fallback that the settings
--    route wrote while the column was absent. Only where settings is still empty,
--    so a re-run is a no-op and never overwrites real settings.
UPDATE public.tenants
SET settings = COALESCE(metadata->'ui_settings', '{}'::jsonb)
WHERE (settings IS NULL OR settings = '{}'::jsonb)
  AND metadata ? 'ui_settings'
  AND jsonb_typeof(metadata->'ui_settings') = 'object';

-- 5. Backfill status for any pre-existing rows left NULL by the ADD (rows created
--    before the default applies keep NULL otherwise).
UPDATE public.tenants SET status = 'active' WHERE status IS NULL;
UPDATE public.tenants SET updated_at = COALESCE(updated_at, created_at, now()) WHERE updated_at IS NULL;

COMMIT;

-- Rollback (manual, NOT run automatically):
--   ALTER TABLE public.tenants
--     DROP COLUMN IF EXISTS settings,
--     DROP COLUMN IF EXISTS updated_at,
--     DROP COLUMN IF EXISTS status;
