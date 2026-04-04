-- Migration 069: Add rebooking_interval_days to services
--
-- Enables the nightly rebooking engine (cron/nightly/route.ts) to:
--   1. Send a 3-day follow-up message after a completed appointment
--   2. Send a cycle-nudge once the rebooking window arrives (e.g. braids every 21 days)
--
-- NULL means "no rebooking nudge for this service" (opt-in per service).

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS rebooking_interval_days INTEGER DEFAULT NULL;

COMMENT ON COLUMN services.rebooking_interval_days IS
  'Days after a completed appointment before sending a rebooking nudge via WhatsApp. NULL = disabled.';
