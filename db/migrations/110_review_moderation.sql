-- 110_review_moderation.sql
-- UGC moderation: review flags (reports) + a hidden flag for takedown.
-- Numbered 110 to stay clear of the active 09x sequential migration range.

-- Takedown state on reviews (additive, safe).
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;

-- Reports against reviews (moderation queue source).
CREATE TABLE IF NOT EXISTS review_flags (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  review_id  UUID        NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  reporter   TEXT,                       -- optional reporter identifier
  reason     TEXT        NOT NULL,
  status     TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_flags_tenant_status
  ON review_flags (tenant_id, status, created_at DESC);

-- Manual fallback: the ALTER/CREATE statements above are idempotent and safe to run by hand.
