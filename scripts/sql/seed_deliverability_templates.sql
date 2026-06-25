-- Seed shared-number default Meta templates after 091_deliverability_reputation.sql is applied.
-- Replace template_name values with the exact approved names from Meta before running.

DELETE FROM message_templates
WHERE tenant_id IS NULL
  AND language = 'en_US'
  AND message_type IN ('rebooking_followup', 'rebooking_nudge', 'waitlist_slot');

INSERT INTO message_templates
  (tenant_id, message_type, template_name, language, param_mapping, status)
VALUES
  (NULL, 'rebooking_followup', 'rebooking_followup_v1', 'en_US', '[]'::jsonb, 'approved'),
  (NULL, 'rebooking_nudge', 'rebooking_nudge_v1', 'en_US', '[]'::jsonb, 'approved'),
  (NULL, 'waitlist_slot', 'waitlist_slot_v1', 'en_US', '[]'::jsonb, 'approved');
