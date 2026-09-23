# Meta message templates to submit

Ten templates, ready to paste into Meta Business Manager. Until each is
approved and seeded, every message of that type sent outside the customer's
24-hour window is held and never delivered.

## Rules that apply to all ten

- **Category: Utility.** Not Marketing. In Nigeria a marketing message costs
  about ₦84 against ₦14 for utility, six times more, and settlement prices from
  Meta's verdict rather than ours. Picking the wrong category is a direct loss
  on every send.
- **Language: `en_US`.** The seed script looks templates up by language, and it
  expects this exact tag.
- **Name must match exactly.** The names below are what
  `scripts/sql/seed_deliverability_templates.sql` writes. A mismatch means the
  send gate finds nothing and holds the message.

## Why none of these contain variables

The send path takes template parameters from the registry row, not from the
message being sent. A template written with `{{1}}` would receive the same
stored value every time, so a reminder would tell every customer the same hour.

These bodies therefore carry no variables and no specifics. They do the one job
a template legally has to do out of window: get the customer to reply. Their
reply reopens the 24-hour window, and everything after that is free-form, where
Booka already sends the real name, time and service.

If you want the time and name inside the first message, that needs a change to
the send gate so each caller can pass its own parameters. Ask and I'll do it;
it touches five senders and needs its own round of tests. Submit these first so
the feature is unblocked either way.

## The templates

| Name                          | Message type             | Body                                                                                                                          |
| ----------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `reservation_reminder_24h_v1` | reservation_reminder_24h | You have an appointment with us tomorrow. Reply YES to confirm, or CHANGE to pick another time.                               |
| `reservation_reminder_2h_v1`  | reservation_reminder_2h  | Your appointment with us is coming up shortly. Reply HERE if you are on the way, or CANCEL to free the slot for someone else. |
| `booking_reminder_v1`         | booking_reminder         | This is a reminder about your upcoming booking with us. Reply DETAILS to see the time, or CHANGE to rebook.                   |
| `payment_receipt_v1`          | payment_receipt          | We have received your payment. Reply RECEIPT and we will send you the full details.                                           |
| `rebooking_followup_v1`       | rebooking_followup       | It has been a few days since your last visit. Reply HI to let us know how it went, or BOOK to arrange the next one.           |
| `rebooking_nudge_v1`          | rebooking_nudge          | You are about due for your next appointment with us. Reply BOOK to see the times we have open.                                |
| `waitlist_slot_v1`            | waitlist_slot            | A slot has opened up on your waitlist. Reply YES to claim it, and we will confirm straight away.                              |
| `confirm_booking_v1`          | confirm_booking          | We need to confirm your upcoming appointment. Reply YES to confirm, or CHANGE to pick another time.                           |
| `collect_deposit_v1`          | collect_deposit          | Your booking needs a deposit to be held. Reply PAY and we will send you the payment link.                                     |
| `follow_up_v1`                | follow_up                | We wanted to follow up on your recent visit. Reply HI and we will pick up where we left off.                                  |

## After approval

1. Open `scripts/sql/seed_deliverability_templates.sql` and replace each
   `template_name` with the exact approved name, if Meta changed any of them.
2. Run the script against the database. It deletes and re-inserts the shared
   rows, so running it twice is safe.
3. Each tenant must then switch on template messaging and paid-template consent
   in Settings, WhatsApp section. Both fail closed, so nothing sends until an
   owner opts in.
4. Confirm the superadmin dashboard alert "No approved template for N message
   types" has cleared.

## Checking it worked

Send a reminder to a number that has not messaged the business in over 24 hours.
Before approval it is held and `sias_campaign_runs` records the outcome as
cancelled with `hold_reason: no_template_outside_window`. After approval the
same send goes out as a template and the row says sent.
