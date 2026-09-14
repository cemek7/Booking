-- Shared-number default Meta templates. Run after 091_deliverability_reputation.sql.
--
-- WHY THIS MATTERS: every business-initiated WhatsApp send goes through
-- sendGovernedInitiated. Inside the customer's 24-hour service window it sends
-- freeform text. OUTSIDE that window it can only send an approved Meta
-- template — and with no row here it holds and sends nothing at all. An
-- appointment reminder is by definition outside the window, so an empty
-- message_templates table means reminders never reach anyone.
--
-- BEFORE RUNNING:
--  1. Create and get each template APPROVED in Meta Business Manager.
--  2. Replace every template_name below with the exact approved name.
--  3. Set param_mapping to the positional variables the approved body uses,
--     e.g. '[{"default":"there"}]'::jsonb for a one-variable template.
--  4. Each tenant must also switch on templateMessagingEnabled and
--     paidTemplateConsent in Settings → WhatsApp; both fail closed.
--
-- Template category matters for cost: reminders and receipts are UTILITY
-- (~$0.0101 in Nigeria). Registering any of these as MARKETING costs ~$0.062,
-- six times more, and settlement will price them from Meta's verdict.

DELETE FROM message_templates
WHERE tenant_id IS NULL
  AND language = 'en_US'
  AND message_type IN (
    'rebooking_followup',
    'rebooking_nudge',
    'waitlist_slot',
    'booking_reminder',
    'reservation_reminder_24h',
    'reservation_reminder_2h',
    'payment_receipt',
    'confirm_booking',
    'collect_deposit',
    'follow_up'
  );

INSERT INTO message_templates
  (tenant_id, message_type, template_name, language, param_mapping, status)
VALUES
  -- Reminders: the highest-volume and highest-value out-of-window sends.
  (NULL, 'reservation_reminder_24h', 'reservation_reminder_24h_v1', 'en_US', '[]'::jsonb, 'approved'),
  (NULL, 'reservation_reminder_2h',  'reservation_reminder_2h_v1',  'en_US', '[]'::jsonb, 'approved'),
  (NULL, 'booking_reminder',         'booking_reminder_v1',         'en_US', '[]'::jsonb, 'approved'),
  -- Payments.
  (NULL, 'payment_receipt',          'payment_receipt_v1',          'en_US', '[]'::jsonb, 'approved'),
  -- Retention and recovery.
  (NULL, 'rebooking_followup',       'rebooking_followup_v1',       'en_US', '[]'::jsonb, 'approved'),
  (NULL, 'rebooking_nudge',          'rebooking_nudge_v1',          'en_US', '[]'::jsonb, 'approved'),
  (NULL, 'waitlist_slot',            'waitlist_slot_v1',            'en_US', '[]'::jsonb, 'approved'),
  -- Operating-loop delivery worker: message_type is the action type verbatim.
  (NULL, 'confirm_booking',          'confirm_booking_v1',          'en_US', '[]'::jsonb, 'approved'),
  (NULL, 'collect_deposit',          'collect_deposit_v1',          'en_US', '[]'::jsonb, 'approved'),
  (NULL, 'follow_up',                'follow_up_v1',                'en_US', '[]'::jsonb, 'approved');
