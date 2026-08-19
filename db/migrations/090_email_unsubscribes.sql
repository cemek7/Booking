-- 090_email_unsubscribes.sql
-- Email unsubscribe / preference store (CAN-SPAM one-click unsubscribe, GDPR).
-- New, independent table — no ordering dependency on other migrations.
-- Numbered 090 deliberately above the active 08x range to avoid same-prefix
-- collisions with concurrent migration work.

CREATE TABLE IF NOT EXISTS email_unsubscribes (
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recipient       TEXT        NOT NULL,           -- email address (or recipient id)
  list            TEXT        NOT NULL,           -- e.g. 'marketing', 'reminders'
  unsubscribed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, recipient, list)
);

CREATE INDEX IF NOT EXISTS idx_email_unsubscribes_recipient
  ON email_unsubscribes (tenant_id, recipient);

-- Manual fallback (run against prod if the migration runner skips this file):
--   the CREATE TABLE / CREATE INDEX above are idempotent and safe to run by hand.
