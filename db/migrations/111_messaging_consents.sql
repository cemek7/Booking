-- 111_messaging_consents.sql
-- Explicit opt-in for BUSINESS-INITIATED messaging (templates, reminders,
-- rebooking nudges). Distinct from customer-initiated implied opt-in (which
-- lives in whatsapp_conversations.flow_data.opt_in) and from email opt-OUT
-- (email_unsubscribes, migration 090).
-- Numbered 111 to stay clear of the active 09x sequential range.

CREATE TABLE IF NOT EXISTS messaging_consents (
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recipient    TEXT        NOT NULL,   -- phone (E.164) or email address
  channel      TEXT        NOT NULL    -- delivery channel
                            CHECK (channel IN ('whatsapp', 'sms', 'email')),
  source       TEXT,                   -- where consent was captured, e.g. 'booking_form'
  consented_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, recipient, channel)
);

-- Manual fallback: the CREATE TABLE above is idempotent and safe to run by hand.
