-- Migration 040: Add missing columns to tenants table
-- industry/vertical for AI context, timezone for scheduling,
-- slug for public booking URLs, business_type for classification.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS industry     TEXT,
  ADD COLUMN IF NOT EXISTS timezone     TEXT DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS business_type TEXT,
  ADD COLUMN IF NOT EXISTS slug         TEXT;

-- Generate slugs for any existing rows that don't have one
UPDATE tenants
SET slug = TRIM(BOTH '-' FROM
               LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g')))
           || '-' || SUBSTRING(id, 1, 6)
WHERE slug IS NULL AND name IS NOT NULL;

-- Index for fast public-booking slug lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug ON tenants (slug)
  WHERE slug IS NOT NULL;
