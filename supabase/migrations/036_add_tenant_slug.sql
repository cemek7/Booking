-- Migration: Add tenant slug for public booking URLs
-- Enables book.booka.io/[slug] format for public storefront

-- Add slug column to tenants table
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS slug TEXT;

-- Generate slugs for existing tenants (sanitize name + first 4 chars of UUID)
UPDATE tenants
SET slug = LOWER(
  REGEXP_REPLACE(
    REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g'),
    '^-|-$', '', 'g'
  )
) || '-' || SUBSTRING(id::text, 1, 4)
WHERE slug IS NULL;

-- Add unique constraint
ALTER TABLE tenants ADD CONSTRAINT tenants_slug_unique UNIQUE (slug);

-- Add index for fast slug lookups (public API uses this)
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

-- Make slug NOT NULL after populating existing records
ALTER TABLE tenants ALTER COLUMN slug SET NOT NULL;

-- Add public booking settings to tenant settings JSONB
COMMENT ON COLUMN tenants.slug IS 'URL-friendly identifier for public booking page (e.g., book.booka.io/[slug])';

-- Function to generate unique slug on tenant creation
CREATE OR REPLACE FUNCTION generate_tenant_slug()
RETURNS TRIGGER AS $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  counter INTEGER := 0;
BEGIN
  -- Generate base slug from name
  base_slug := LOWER(
    REGEXP_REPLACE(
      REGEXP_REPLACE(NEW.name, '[^a-zA-Z0-9]+', '-', 'g'),
      '^-|-$', '', 'g'
    )
  );

  -- Start with base slug + UUID prefix
  final_slug := base_slug || '-' || SUBSTRING(NEW.id::text, 1, 4);

  -- If slug already exists (unlikely), append counter
  WHILE EXISTS (SELECT 1 FROM tenants WHERE slug = final_slug AND id != NEW.id) LOOP
    counter := counter + 1;
    final_slug := base_slug || '-' || SUBSTRING(NEW.id::text, 1, 4) || '-' || counter;
  END LOOP;

  NEW.slug := final_slug;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate slug on insert if not provided
DROP TRIGGER IF EXISTS trigger_generate_tenant_slug ON tenants;
CREATE TRIGGER trigger_generate_tenant_slug
  BEFORE INSERT ON tenants
  FOR EACH ROW
  WHEN (NEW.slug IS NULL)
  EXECUTE FUNCTION generate_tenant_slug();
