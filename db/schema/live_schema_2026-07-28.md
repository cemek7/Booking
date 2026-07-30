# Live schema — authoritative column reference (2026-07-28)

Regenerated from the live database's `information_schema`. **This supersedes
`baseline_2026-07-06.sql`, which is stale/incomplete.** Reviews (and the
`.claude/agents/booka-self-review.md` agent) must ground column claims here plus
write-path evidence in code — never on the old `.sql` baseline.

> Scope note: this file lists the **bug-prone / hot tables** that cause
> ghost-column defects. For the complete dump of all ~150 tables + RLS, run
> `pg_dump --schema-only` (or the information_schema export) and commit it
> alongside this file. Where a column is written by working code but missing
> here, trust the code (this reference may lag a migration).

## reservations  (canonical appointments; `/api/bookings*` is a facade over it)
id, tenant_id, date, time, notes, created_at, customer_id, booking_id, status,
duration, calendar_sent, reminder_sent, **customer_number**, start_at, end_at,
**metadata** (jsonb), staff_id, service_id, tenant_staff_id, reminder_24h_sent,
reminder_2h_sent, confirmed_at, price_cents_snapshot, discount_cents,
discount_reason, completed_at.
**NOT columns:** `phone`, `customer_name`, `customer_email`, `customer_phone`,
`service`, `source`. (Number = `customer_number`; name/email live in `metadata`;
service = `service_id`, join `services` for the name.)
`updated_at` is written by working code (engine/lifecycle) — treat as present.

## transactions
id, tenant_id, amount (numeric), currency, type, status, **raw** (jsonb),
created_at, **original_transaction_id**, refund_amount, refund_reason,
retry_count, last_retry_at, next_retry_at, **provider_reference** (unique),
reconciliation_status, reconciled_at, updated_at, **subject_type**, **subject_id**.
**NOT columns:** `metadata`, `staff_id`, `user_id`, `booking_id`, `provider`,
`provider_transaction_id`, `payment_method`, `parent_transaction_id`.
(booking → `subject_id`+`subject_type='reservation'`; provider ref →
`provider_reference`; refund parent → `original_transaction_id`;
provider/method/misc → inside `raw`.) Revenue = `amount` where status in
(`completed`,`paid`).

## customers
id, tenant_id, customer_name, phone_number, notes, created_at, no_show_count,
risk_score, **name**, **phone**, **email**, source, tags, normalized_phone,
merged_into. (Both `name`/`customer_name` and `phone`/`phone_number` exist.)

## messages  (keyed by reservation_id)
id, tenant_id, **reservation_id**, from_number, to_number, **content**,
**direction**, raw, created_at, chat_id, provider_message_sid, message_type,
evolution_message_id, media_info, media_url, timestamp, read_at, user_id,
ai_layer, tokens_used.
**NOT columns:** `booking_id`, `text`, `channel`. (id → reservation_id;
text → content.)

## chats
id, tenant_id, customer_id, **customer_phone**, reservation_id, session_id,
metadata, last_message_id, last_message_at, created_at, unread_count, last_read_at.

## tenants
id, name, whatsapp_number, plan, created_at, whatsapp_number_id, email,
business_type, tone_config, timezone, **metadata** (jsonb), preferred_llm_model,
llm_token_rate, industry, slug, routing_code, buffer_minutes, v2_enabled,
lifecycle_state, offboarding_reason, offboarded_by, offboarded_at,
scheduled_purge_at, financials_purge_at, display_name, brand_emoji,
previous_names, renamed_at, close_report_enabled, close_report_time,
**settings** (jsonb), updated_at, status.
(`settings` jsonb DOES exist — created in `0001_init.sql`, confirmed by
migration 066 and read by many routes: owner-settings-service, tenant-currency,
apikey, invites, whatsapp/connect, superadmin. The 2026-07-28 live dump omitted
it, but write-path evidence is authoritative. UI settings live in `settings`;
`metadata.ui_settings` is only a legacy fallback.)

## services
id, tenant_id, name, description, duration, price (numeric), category,
created_at, is_active, aliases, sort_order, rebooking_interval_days,
**price_cents**, duration_minutes.

## customer_feedback
id, tenant_id, reservation_id, **staff_user_id** (TEXT), customer_name, score,
comment, created_at.

## leads
id, tenant_id, name, phone, email, source, intent, notes, status, follow_up_at,
followed_up_at, created_at, stage, qualified_at, last_contacted_at.

## reviews
id, tenant_id, reservation_id (unique), customer_id, staff_id, service_id,
overall_rating (numeric), staff_rating, service_rating, facility_rating,
review_title, review_text, response_text, response_by, response_at, status,
is_verified, helpful_count, created_at, updated_at, customer_name,
customer_email, rating (int), comment, is_published, hidden.

## calendar_integrations
id, tenant_id, staff_id, provider, calendar_id, email, access_token,
refresh_token, sync_enabled, sync_direction, events_synced, last_synced,
created_at, updated_at.

## reservation_services  (composite PK: reservation_id + service_id)
reservation_id, service_id, quantity, tenant_id, customer_id.

## bookings  (VESTIGIAL — being retired)
id, tenant_id, start_date, end_date, title, description, capacity, status.
Only `booking_notifications.booking_id` and `scheduled_notifications.booking_id`
FK to it (a wrong FK — those ids correlate to reservations). See
`db/migrations/2026-07-27_drop_vestigial_bookings_table.sql`.

## retail_orders / products (money units)
retail_orders money is `total_cents`; products use `price_cents`.

---
_Derived from the live information_schema dump provided 2026-07-28. Replace with
a full `pg_dump --schema-only` when convenient for 100% coverage._
