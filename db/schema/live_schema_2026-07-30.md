# Live schema — authoritative reference (2026-07-30)

Full `information_schema` dump of the live DB. **This is the source of truth**,
superseding `live_schema_2026-07-28.md` and the stale `baseline_2026-07-06.sql`.
Reviews + `.claude/agents/booka-self-review.md` ground column claims here.

> Ghost columns only 500 inside PostgREST ops (`.select/.eq/.insert/.update/
> .order/.filter`), never a plain JS property read of a missing key.

## Code↔schema divergences (verified this dump) — fixed 2026-07-30
1. **`tenants` is missing `settings`, `updated_at`, and `status`** on live (also
   absent from the 2026-07-06 baseline) — yet code writes/reads all three
   (superadmin tenant patch, settings route, whatsapp connect, owner-settings,
   tenant-currency…). The superadmin patch 500s every call on the final select.
   Being **restored** by `db/migrations/2026-07-30_add_missing_tenants_columns.sql`
   (idempotent ADD IF NOT EXISTS; backfills settings from `metadata.ui_settings`,
   status→'active', updated_at→created_at). No-op if the columns already exist.
2. **`reservations` has NO `updated_at`** — the one stray writer
   (`send-calendar/route.ts`, which broke `calendar_sent` persistence) was fixed
   to drop the column instead of adding an unused one. Any future
   `.update({updated_at})` on reservations is a ghost write.

Note: this dump is INCOMPLETE — it omits whole subsystems that exist per
migrations (products, product_variants, retail_orders/carts/items,
inventory_movements, staff-related, observability: alert_events/business_metrics/
error_logs/system_metrics/traces in `supabase/migrations/032`). Use
`db/migrations/` + `supabase/migrations/` as the completeness source, this dump
for column-level truth on the tables it does list. `.from('staff')` in
`analyticsService.ts` is a dead comment, not a live call.

## Hot tables — columns + gotchas

**tenants**: id, name, whatsapp_number, whatsapp_api_provider, plan,
notify_via_sms, created_at, whatsapp_number_id, waba_api_key, whatsapp_status,
whatsapp_connected_at, email, business_type, tone_config, timezone, metadata,
preferred_llm_model, llm_token_rate, industry, slug, routing_code,
buffer_minutes, v2_enabled, lifecycle_state, offboarding_reason, offboarded_by,
offboarded_at, scheduled_purge_at, financials_purge_at, display_name,
brand_emoji, previous_names, renamed_at, close_report_enabled, close_report_time.
**NO `settings` (pending migration), NO `updated_at`, NO `status`.**

**reservations**: id, tenant_id, date, time, notes, created_at, customer_id,
booking_id, status, duration, calendar_sent, reminder_sent, customer_number,
start_at, end_at, metadata, staff_id, service_id, tenant_staff_id,
reminder_24h_sent, reminder_2h_sent, confirmed_at, price_cents_snapshot,
discount_cents, discount_reason, completed_at.
**NO `updated_at`, `phone`, `customer_name`, `customer_email`, `service`.**
Phone=`customer_number`; name/email in `metadata`; service=`service_id`.

**transactions**: id, tenant_id, amount, currency, type, status, raw, created_at,
original_transaction_id, refund_amount, refund_reason, retry_count, last_retry_at,
next_retry_at, provider_reference(unique), reconciliation_status, reconciled_at,
updated_at, subject_type, subject_id.
**NO `metadata`/`provider`/`provider_transaction_id`/`payment_method`/`booking_id`/
`parent_transaction_id`.** booking→subject_id+subject_type; provider→provider_reference;
refund parent→original_transaction_id; provider/method→raw.

**messages**: id, tenant_id, reservation_id, from_number, to_number, content,
direction, raw, created_at, chat_id, provider_message_sid, message_type,
evolution_message_id, media_info, media_url, media_thumbnail, media_metadata,
timestamp, read_at, user_id, ai_layer, tokens_used. **NO `booking_id`/`text`.**

**chats**: id, tenant_id, customer_id, customer_phone, reservation_id, session_id,
metadata, last_message_id, last_message_at, created_at, unread_count, last_read_at.

**customers**: id, tenant_id, customer_name, phone_number, notes, created_at,
no_show_count, risk_score, name, phone, email, source, tags, normalized_phone,
merged_into. (both name/customer_name and phone/phone_number exist)

**services**: id, tenant_id, name, description, duration, price, category,
created_at, is_active, aliases, sort_order, rebooking_interval_days, price_cents,
duration_minutes.

**leads**: id, tenant_id, name, phone, email, source, intent, notes, status,
follow_up_at, followed_up_at, created_at, stage, qualified_at, last_contacted_at.

**reviews**: id, tenant_id, reservation_id(unique), customer_id, staff_id,
service_id, overall_rating, staff_rating, service_rating, facility_rating,
review_title, review_text, response_text, response_by, response_at, status,
is_verified, helpful_count, created_at, updated_at, customer_name,
customer_email, rating, comment, is_published, hidden.

**customer_feedback**: id, tenant_id, reservation_id, staff_user_id(TEXT),
customer_name, score, comment, created_at.

**tenant_users**: id, tenant_id, user_id, role, created_at, email, name, phone,
services_all. **staff_services**/**staff_skills** key staff by `staff_user_id`(TEXT)/`user_id`.

## Other tables (name → columns)

- **reservation_logs**: id, tenant_id, action, created_at, reservation_id, actor, notes
- **reservation_services**(PK reservation_id+service_id): quantity, tenant_id, customer_id
- **support_tickets**: id, tenant_id, subject, description, status, created_at, priority, escalated, escalated_at, escalated_by, assignee_id, metadata, updated_at
- **support_messages**: id, ticket_id, author_id, author_role, body, is_internal, created_at
- **support_assignments**: id, ticket_id, assigned_to, assigned_by, created_at
- **invites**(PK token): tenant_id, email, role, created_at
- **admins**: created_at, email, status, last_sign_in, invited_by, invited_at, id
- **audit_logs**: id, tenant_id, user_id, action, target_user_id, details, created_at, timestamp, event_type, user_role, session_id, ip_address, user_agent, resource, permission, context, result, security_level, compliance_flags, metadata
- **security_audit_log**: id, tenant_id, user_id, action, resource_type, resource_id, ip_address, user_agent, request_id, success, failure_reason, sensitive_data_accessed, created_at
- **logs**: id, source, type, data, created_at, updated_at
- **notifications**: id, tenant_id, title, message, meta, read, created_at, updated_at
- **tenant_reminder_settings**: id, tenant_id, enabled, reminder_offset_minutes, template, created_at, updated_at
- **tenant_tone_profiles**: id, tenant_id, tone, style_guidelines, voice_parameters, sample_phrases, created_at, updated_at
- **faqs**: id, tenant_id, question, answer, created_at, updated_at, category, is_active, sort_order
- **reservation_trends**: id, tenant_id, date, count, created_at, updated_at
- **transactions/ledger_entries**: id, tenant_id, transaction_id, entry_type, amount, currency, description, reference_id, posted_at, created_at, metadata
- **transaction_retries**: id, transaction_id, attempt_number, attempted_at, error_code, error_message, response_data, status, next_attempt_at
- **reminders**: id, tenant_id, reservation_id, remind_at, method, status, attempts, raw, created_at
- **jobs**: id, type, payload, attempts, status, scheduled_at, last_error, created_at, updated_at, last_run_at, run_count, job_class, priority, max_retries, retry_delay_seconds, dead_letter_at, context, timeout_seconds, name, handler, tenant_id, retry_delay_ms, retry_backoff_multiplier, retry_count, timeout_ms
- **dialog_sessions**: id, tenant_id, user_id, slots, state, created_at, updated_at
- **skills**: id, tenant_id, name, category, active, created_at
- **staff_skills**(PK tenant_id+user_id+skill_id): skill_name, proficiency, created_at
- **staff_services**(PK tenant_id+staff_user_id+service_id): created_at, price_override
- **webhook_events**: id, provider, external_id, event_type, payload, processed_at, tenant_id, signature, created_at
- **event_outbox**: id, type, tenant_id, location_id, payload, hash(unique), delivered_at, created_at
- **events**: id, event, version, tenant_id, location_id, payload, created_at
- **staff_schedules**: id, tenant_id, staff_id, day_of_week, start_time, end_time, is_active, created_at, updated_at, break_start, break_end, tenant_user_id
- **availability_slots**: id, tenant_id, staff_id, slot_date, slot_time, duration_minutes, is_available, reservation_id, created_at, updated_at
- **slot_locks**: id, tenant_id, tenant_staff_id, date, start_time, end_time, customer_phone, expires_at
- **schedule_overrides**: id, tenant_id, tenant_staff_id, date, is_blocked, custom_start, custom_end, reason
- **booking_notifications**: id, created_at, updated_at, booking_id, tenant_id, type, channel, recipient_phone, recipient_email, message_content, template_name, template_variables, scheduled_for, sent_at, status, error_message, retry_count, max_retries, created_by, metadata
- **scheduled_notifications**: id, created_at, updated_at, booking_id, tenant_id, notification_id, trigger_type, scheduled_for, executed_at, status, config
- **staff_ratings**: id, tenant_id, staff_id, average_rating, total_reviews, five/four/three/two/one_star_count, total_bookings, completed_bookings, completion_rate, period_start, period_end, period_type, created_at, updated_at
- **service_ratings**: id, tenant_id, service_id, average_rating, total_reviews, total_bookings, total_revenue, average_duration_minutes, popularity_score, period_start, period_end, period_type, created_at, updated_at
- **review_flags**: id, tenant_id, review_id, reporter, reason, status, created_at
- **analytics_events**: id, tenant_id, event_type, event_category, user_id, customer_id, session_id, reservation_id, service_id, staff_id, metadata, source, utm_source, utm_medium, utm_campaign, created_at
- **analytics_metrics_cache**: id, tenant_id, metric_type, metric_key, value, metadata, period_type, period_start, period_end, calculated_at, expires_at
- **insights_daily**: id, tenant_id, date, total_bookings, completed, cancelled, no_shows, revenue, busiest_hour, top_service_id
- **tenant_daily_summary**(PK tenant_id+date): bookings_count, completed_count, cancelled_count, no_show_count, estimated_revenue, top_service, top_staff, generated_at
- **customer_profile_summary**(PK tenant_id+customer_id): lifetime_bookings, last_visit, favorite_service, favorite_staff, days_since_visit, risk_score, generated_at, customer_name, customer_phone, lifetime_value_cents, avg_spend_cents, outstanding_balance_cents, repeat_interval_days, preferred_staff_id, no_show_count, cancellation_count, last_computed_at
- **service_performance_summary**(PK tenant_id+service_id): bookings, revenue, cancellations, completion_rate, generated_at
- **staff_performance_summary**(PK tenant_id+staff_id): bookings, completion_rate, estimated_revenue, generated_at
- **availability_snapshot**(PK tenant_id+staff_id+service_id+date): available_slots, generated_at
- **customer_analytics**: id, tenant_id, customer_id, lifetime_value, predicted_ltv, churn_probability, next_booking_likelihood, next_booking_predicted_date, loyalty_score, personalization_profile, last_calculated, expires_at
- **ml_models / ml_predictions / anomaly_detections / revenue_optimizations / module_feature_usage / bi_dashboards / performance_metrics**: analytics/ML tables, all tenant_id-scoped
- **customer_feedback / tenant_knowledge_articles / escalation_queue / tasks**: tenant_id-scoped (escalation_queue keys by customer_phone+session_id)
- **whatsapp_configurations**: id, tenant_id(unique), instance_name, evolution_base_url, evolution_api_key, webhook_url, active, created_at, updated_at, agent_enabled, provider, provider_base_url, provider_api_key, meta_phone_number_id, meta_waba_id, meta_business_account_id, meta_token_ref, meta_verify_token
- **whatsapp_connections / whatsapp_conversations / whatsapp_connection_logs / whatsapp_connection_metrics / whatsapp_message_queue / whatsapp_media / whatsapp_sessions / whatsapp_provider_secrets / whatsapp_showcase_packs / whatsapp_showcase_pack_items / whatsapp_number_quality**: WhatsApp infra, tenant_id-scoped (provider_secrets PK tenant_id+provider; number_quality PK phone_number_id)
- **message_templates**: id, tenant_id, message_type, template_name, language, param_mapping, status, created_at, updated_at
- **tenant_messaging_stats**(PK tenant_id): window_start, sent_24h, initiated_24h, initiated_recipients_24h, recipients_seen, cold_outbound_24h, opt_outs_24h, failures_24h, risk_score, quarantined_until, updated_at
- **messaging_consents**(PK tenant_id+recipient+channel): source, consented_at
- **idempotency_keys**: id, tenant_id, operation, idempotency_key, idempotency_hash, amount, metadata, status, created_at
- **cron_locks**(PK key): locked_until
- **ai_wallets**(PK tenant_id): currency, balance_credits, lifetime_topups_credits, lifetime_spent_credits, low_balance_threshold_credits, created_at, updated_at, daily_budget_credits, velocity_credits_override, budget_warned_on
- **ai_wallet_ledger**: id, tenant_id, kind, amount_credits, token_count, provider, model, request_id, reference, description, metadata, created_at
- **tenant_revenue_ledger / tenant_cost_ledger**: id, tenant_id, revenue_type|cost_type, amount_credits|actual_cost_credits, source, reference, description, metadata, created_at
- **llm_calls**: id, tenant_id, action, model, usage, raw, created_at, total_tokens, estimated_cost
- **llm_usage / llm_quotas / llm_usage_alerts / llm_alert_notifications**: tenant_id-scoped (RLS via tenant_users)
- **sias_campaign_runs / sias_outcome_attributions / sias_operational_memory**: SIAS campaign engine, tenant_id-scoped
- **offboarding_tasks**: id, tenant_id, task_type, status, attempts, max_attempts, last_error, payload, created_at, updated_at
- **calendar_integrations**: id, tenant_id, staff_id, provider, calendar_id, email, access_token, refresh_token, sync_enabled, sync_direction, events_synced, last_synced, created_at, updated_at
- **ai_training_events**: id, tenant_id, message_id, channel, user_role, message, intent, grounded_context, llm_response, backend_action, success, correction, created_at
- **alert_rules**: id, metric, threshold, operator, duration, enabled, channels, metadata, created_at, updated_at
- **platform_settings**(PK id int): stripe_key. **platform_settings_kv**(PK key): value
- **tenant_modules**: id, tenant_id, registry_data, created_at, updated_at
- Service-role-only (RLS enabled, service policy only — NOT bugs): reconciliation_runs, reconciliation_items, business_events, business_anomalies, ai_action_log, tenant_user_permissions, inventory_locations, stock_count_sessions, stock_count_items, tenant_approval_policies, approval_requests, approval_actions, service_material_recipes, service_material_recipe_items, service_consumption_records, customer_merge_candidates, media_inputs, extraction_jobs, extracted_records, suppliers, expenses, purchases, supplier_payments, stock_receipts, analytics_query_log, briefing_schedules, briefing_runs, business_recommendations, recommendation_outcomes
- Also present (tenant_isolation via app.current_tenant or tenant_users): staff_availability, provider_schedule, provider_services, staff_schedule_overrides, staff_locations, business_hours, reservation_locks, whatsapp_messages, in_app_notifications, tenant_settings, user_preferences, usage_daily, fraud_assessments, suspicious_activities, flagged_devices, booking_analytics, customer_profiles, service_products, service_pricing_history, booking_items, calendar_blocks, tenant_webhooks, automation_rules, items, ai_front_desk_events

## RLS patterns (all intentional; never flag "RLS on + service-only" as a bug)
- **service_role** policy `USING true` on nearly every table = the app's
  service-role client bypass. Expected.
- **tenant_users-based**: `tenant_id IN (SELECT tenant_id FROM tenant_users
  WHERE user_id = auth.uid())` — standard tenant isolation, sometimes gated to
  role IN (owner,manager[,staff]).
- **JWT-claim-based**: `(tenant_id)::text = current_setting('request.jwt.claims.tenant_id')`
  or `jwt.claims.tenant_id` — used by reservations, messages, transactions,
  staff_schedules, availability_slots, ledger_entries, skills, etc.
- **app.current_tenant-based**: `tenant_id = current_setting('app.current_tenant')::uuid`
  — the analytics/ML cluster (ml_models, customer_analytics, bi_dashboards…).
- `reservations`/`messages`/`transactions` use `jwt.claims.tenant_id` (note:
  NOT `request.jwt.claims.tenant_id`) — a subtle inconsistency, but app writes
  go through service-role so it doesn't gate normal operation.
