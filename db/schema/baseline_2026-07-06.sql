-- Boka public-schema BASELINE — captured 2026-07-06 from live Supabase via
-- db/schema/generate-baseline.sql (system-catalog reconstruction, no pg_dump/CLI).
-- Resolves launch-readiness audit C2: db/migrations/ is NOT the schema source of truth
-- (~45 live tables + several views have no migration). This file is that source of truth.
--
-- PROVENANCE: string_agg single-cell output of the generator, run in the Supabase SQL editor.
-- ORDER: extensions -> tables -> functions -> materialized views -> constraints -> indexes
--        -> views -> triggers.
--
-- NOT directly runnable on bare Postgres: FKs reference auth.users and extensions target the
-- vault/extensions schemas (all Supabase-provided). To provision a NON-Supabase env, stub those
-- schemas first. To REGENERATE against current live schema: re-run db/schema/generate-baseline.sql.
-- Policy: every schema change ships as a migration AND this baseline is regenerated before any
-- fresh-environment provision. See docs/runbooks/migration-collision-resolution.md.

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;

CREATE TABLE public.analytics_metrics_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  metric_type character varying(100) NOT NULL,
  metric_key character varying(100) NOT NULL,
  value numeric(15,2) NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  period_type character varying(20) NOT NULL,
  period_start timestamp with time zone NOT NULL,
  period_end timestamp with time zone NOT NULL,
  calculated_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone DEFAULT (now() + '01:00:00'::interval)
);

CREATE TABLE public.skills (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  name text NOT NULL,
  category text,
  active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.platform_settings (
  id integer NOT NULL DEFAULT 1,
  stripe_key text NOT NULL
);

CREATE TABLE public.anomaly_detections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  anomaly_type character varying(100) NOT NULL,
  severity character varying(20) NOT NULL,
  score numeric(5,4) NOT NULL,
  description text NOT NULL,
  data_points jsonb NOT NULL,
  suggested_actions jsonb DEFAULT '[]'::jsonb,
  status character varying(50) DEFAULT 'active'::character varying,
  resolved_at timestamp with time zone,
  resolved_by uuid,
  auto_resolved boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.sias_outcome_attributions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  reservation_id uuid,
  customer_id uuid,
  customer_phone text,
  signal text NOT NULL,
  source_event text NOT NULL,
  attributed_to text,
  value numeric(12,2) NOT NULL DEFAULT 1,
  window_hours integer,
  campaign_run_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid,
  action text NOT NULL,
  target_user_id uuid,
  details jsonb,
  created_at timestamp with time zone DEFAULT now(),
  "timestamp" timestamp with time zone NOT NULL DEFAULT now(),
  event_type text NOT NULL DEFAULT 'permission_check'::text,
  user_role text,
  session_id text,
  ip_address inet,
  user_agent text,
  resource text NOT NULL DEFAULT ''::text,
  permission text NOT NULL DEFAULT ''::text,
  context jsonb DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  security_level text NOT NULL DEFAULT 'medium'::text,
  compliance_flags text[] DEFAULT ARRAY[]::text[],
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE public.pii_data_registry (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  column_name text NOT NULL,
  data_type text NOT NULL,
  encryption_method text,
  retention_days integer,
  last_scan_at timestamp with time zone,
  compliance_level text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.whatsapp_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  instance_name text NOT NULL,
  status text NOT NULL DEFAULT 'disconnected'::text,
  phone_number text,
  battery_level integer,
  signal_strength integer,
  is_business boolean NOT NULL DEFAULT false,
  profile_name text,
  profile_picture text,
  qr_code text,
  webhook_url text,
  error_message text,
  connection_time timestamp with time zone,
  last_seen timestamp with time zone NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.sias_operational_memory (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  memory_key text NOT NULL,
  memory_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text,
  confidence numeric(4,3) NOT NULL DEFAULT 0.5,
  hit_count integer NOT NULL DEFAULT 1,
  last_seen_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.availability_slots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  staff_id uuid,
  slot_date date NOT NULL,
  slot_time time without time zone NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 60,
  is_available boolean DEFAULT true,
  reservation_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.whatsapp_configurations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  instance_name text NOT NULL,
  evolution_base_url text NOT NULL,
  evolution_api_key text NOT NULL,
  webhook_url text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  agent_enabled boolean NOT NULL DEFAULT false,
  provider text NOT NULL DEFAULT 'evolution'::text,
  provider_base_url text,
  provider_api_key text,
  meta_phone_number_id text,
  meta_waba_id text,
  meta_business_account_id text,
  meta_token_ref text,
  meta_verify_token text
);

CREATE TABLE public.performance_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  metric_name character varying(100) NOT NULL,
  metric_value numeric(15,4) NOT NULL,
  unit character varying(50),
  tags jsonb DEFAULT '{}'::jsonb,
  recorded_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.availability_snapshot (
  tenant_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  service_id uuid NOT NULL,
  date date NOT NULL,
  available_slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.offboarding_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  task_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.sias_campaign_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  campaign_type text NOT NULL,
  action text NOT NULL,
  target_phone text,
  target_customer_id uuid,
  target_booking_id uuid,
  source_event text,
  status text NOT NULL DEFAULT 'pending'::text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  scheduled_for timestamp with time zone NOT NULL DEFAULT now(),
  next_retry_at timestamp with time zone,
  sent_at timestamp with time zone,
  completed_at timestamp with time zone,
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.support_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL,
  author_id uuid,
  author_role text,
  body text NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  title text,
  message text,
  meta jsonb,
  read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_connection_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  instance_name text NOT NULL,
  level text NOT NULL DEFAULT 'info'::text,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.module_feature_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  module_id character varying(100) NOT NULL,
  feature_id character varying(100) NOT NULL,
  usage_count integer DEFAULT 0,
  last_used timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.ml_predictions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  model_id uuid NOT NULL,
  prediction_type character varying(100) NOT NULL,
  input_data jsonb NOT NULL,
  prediction_data jsonb NOT NULL,
  confidence_score numeric(5,4),
  created_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval)
);

CREATE TABLE public.bi_dashboards (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  dashboard_name character varying(255) NOT NULL,
  dashboard_config jsonb NOT NULL,
  widgets jsonb DEFAULT '[]'::jsonb,
  permissions jsonb DEFAULT '{}'::jsonb,
  is_public boolean DEFAULT false,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.tenant_cost_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  cost_type text NOT NULL,
  actual_cost_credits numeric(20,6) NOT NULL,
  source text NOT NULL DEFAULT 'manual'::text,
  reference text,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.ml_models (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  model_type character varying(100) NOT NULL,
  model_name character varying(255) NOT NULL,
  version character varying(50) NOT NULL,
  status character varying(50) NOT NULL DEFAULT 'training'::character varying,
  accuracy numeric(5,4),
  parameters jsonb DEFAULT '{}'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  training_data_hash character varying(64),
  last_trained timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.leads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text,
  phone text NOT NULL,
  email text,
  source text DEFAULT 'whatsapp'::text,
  intent text,
  notes text,
  status text DEFAULT 'new'::text,
  follow_up_at timestamp with time zone,
  followed_up_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  stage text,
  qualified_at timestamp with time zone,
  last_contacted_at timestamp with time zone
);

CREATE TABLE public.messaging_consents (
  tenant_id uuid NOT NULL,
  recipient text NOT NULL,
  channel text NOT NULL,
  source text,
  consented_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  phone_number text,
  customer_name text,
  session_id text,
  current_step text DEFAULT 'greeting'::text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_activity timestamp with time zone NOT NULL DEFAULT now(),
  unread_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  conversation_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  role text DEFAULT 'customer'::text,
  current_flow text DEFAULT 'idle'::text,
  flow_step integer DEFAULT 0,
  flow_data jsonb DEFAULT '{}'::jsonb,
  channel text NOT NULL DEFAULT 'whatsapp'::text,
  external_id text
);

CREATE TABLE public.booking_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  booking_id uuid,
  tenant_id uuid,
  type character varying(50) NOT NULL,
  channel character varying(20) NOT NULL DEFAULT 'whatsapp'::character varying,
  recipient_phone character varying(20),
  recipient_email character varying(255),
  message_content text NOT NULL,
  template_name character varying(100),
  template_variables jsonb DEFAULT '{}'::jsonb,
  scheduled_for timestamp with time zone,
  sent_at timestamp with time zone,
  status character varying(20) DEFAULT 'pending'::character varying,
  error_message text,
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 3,
  created_by uuid,
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE public.whatsapp_media (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  phone_number text NOT NULL,
  message_id text NOT NULL,
  file_type text NOT NULL,
  mime_type text NOT NULL,
  file_name text NOT NULL DEFAULT ''::text,
  file_size bigint NOT NULL DEFAULT 0,
  file_url text NOT NULL,
  thumbnail_url text,
  caption text,
  duration integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_message_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  message_id text NOT NULL,
  from_number text NOT NULL,
  to_number text NOT NULL,
  content text NOT NULL DEFAULT ''::text,
  priority text NOT NULL DEFAULT 'normal'::text,
  status text NOT NULL DEFAULT 'pending'::text,
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  scheduled_at timestamp with time zone,
  processed_at timestamp with time zone,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  type text NOT NULL,
  payload jsonb,
  attempts integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'::text,
  scheduled_at timestamp with time zone NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  last_run_at timestamp with time zone,
  run_count integer NOT NULL DEFAULT 0,
  job_class text DEFAULT 'generic'::text,
  priority integer DEFAULT 5,
  max_retries integer DEFAULT 3,
  retry_delay_seconds integer DEFAULT 60,
  dead_letter_at timestamp with time zone,
  context jsonb DEFAULT '{}'::jsonb,
  timeout_seconds integer DEFAULT 300,
  name text,
  handler text,
  tenant_id uuid,
  retry_delay_ms integer NOT NULL DEFAULT 1000,
  retry_backoff_multiplier numeric(4,2) NOT NULL DEFAULT 2.0,
  retry_count integer NOT NULL DEFAULT 0,
  timeout_ms integer NOT NULL DEFAULT 30000
);

CREATE TABLE public.bookings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  start_date timestamp without time zone,
  end_date timestamp without time zone,
  title text,
  description text,
  capacity integer,
  status text
);

CREATE TABLE public.invites (
  token uuid NOT NULL,
  tenant_id uuid,
  email text,
  role text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.security_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  user_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  ip_address inet,
  user_agent text,
  request_id text,
  success boolean NOT NULL,
  failure_reason text,
  sensitive_data_accessed boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.calendar_integrations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  staff_id uuid,
  provider text NOT NULL DEFAULT 'google'::text,
  calendar_id text NOT NULL,
  email text,
  access_token text,
  refresh_token text,
  sync_enabled boolean NOT NULL DEFAULT true,
  sync_direction text,
  events_synced integer NOT NULL DEFAULT 0,
  last_synced timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.chats (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  customer_id uuid,
  customer_phone text,
  reservation_id uuid,
  session_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  last_message_id uuid,
  last_message_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  unread_count integer DEFAULT 0,
  last_read_at timestamp with time zone
);

CREATE TABLE public.services (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  name text,
  description text,
  duration integer,
  price numeric,
  category text,
  created_at timestamp with time zone DEFAULT now(),
  is_active boolean,
  aliases text[] DEFAULT '{}'::text[],
  sort_order integer DEFAULT 0,
  rebooking_interval_days integer,
  price_cents integer,
  duration_minutes integer
);

CREATE TABLE public.scheduled_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  booking_id uuid,
  tenant_id uuid,
  notification_id uuid,
  trigger_type character varying(50) NOT NULL,
  scheduled_for timestamp with time zone NOT NULL,
  executed_at timestamp with time zone,
  status character varying(20) DEFAULT 'pending'::character varying,
  config jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE public.inventory_movements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  movement_type text NOT NULL,
  quantity integer NOT NULL DEFAULT 0,
  quantity_change integer,
  reason text,
  notes text,
  reference_id text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  variant_id uuid,
  reference_type text,
  previous_quantity integer,
  new_quantity integer,
  performed_by uuid
);

CREATE TABLE public.cron_locks (
  key text NOT NULL,
  locked_until timestamp with time zone NOT NULL
);

CREATE TABLE public.insights_daily (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  date date NOT NULL,
  total_bookings integer DEFAULT 0,
  completed integer DEFAULT 0,
  cancelled integer DEFAULT 0,
  no_shows integer DEFAULT 0,
  revenue numeric(12,2) DEFAULT 0,
  busiest_hour integer,
  top_service_id uuid
);

CREATE TABLE public.support_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL,
  assigned_to uuid NOT NULL,
  assigned_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.customer_analytics (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  lifetime_value numeric(10,2),
  predicted_ltv numeric(10,2),
  churn_probability numeric(5,4),
  next_booking_likelihood numeric(5,4),
  next_booking_predicted_date date,
  loyalty_score integer DEFAULT 0,
  personalization_profile jsonb DEFAULT '{}'::jsonb,
  last_calculated timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval)
);

CREATE TABLE public.schedule_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  tenant_staff_id uuid NOT NULL,
  date date NOT NULL,
  is_blocked boolean DEFAULT false,
  custom_start time without time zone,
  custom_end time without time zone,
  reason text
);

CREATE TABLE public.customer_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  reservation_id uuid,
  staff_user_id text NOT NULL,
  customer_name text,
  score smallint NOT NULL,
  comment text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_number_quality (
  phone_number_id text NOT NULL,
  quality_rating text NOT NULL DEFAULT 'UNKNOWN'::text,
  messaging_tier text,
  limit_per_24h integer NOT NULL DEFAULT 1000,
  account_status text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.customer_profile_summary (
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  lifetime_bookings integer NOT NULL DEFAULT 0,
  last_visit timestamp with time zone,
  favorite_service text,
  favorite_staff text,
  days_since_visit integer,
  risk_score text NOT NULL DEFAULT 'low'::text,
  generated_at timestamp with time zone NOT NULL DEFAULT now(),
  customer_name text,
  customer_phone text
);

CREATE TABLE public.customers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  customer_name text,
  phone_number text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  no_show_count integer NOT NULL DEFAULT 0,
  risk_score text NOT NULL DEFAULT 'low'::text,
  name text,
  phone text,
  email text,
  source text
);

CREATE TABLE public.reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  staff_id uuid,
  service_id uuid,
  overall_rating numeric(2,1) NOT NULL,
  staff_rating numeric(2,1),
  service_rating numeric(2,1),
  facility_rating numeric(2,1),
  review_title character varying(200),
  review_text text,
  response_text text,
  response_by uuid,
  response_at timestamp with time zone,
  status character varying(20) DEFAULT 'published'::character varying,
  is_verified boolean DEFAULT false,
  helpful_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  customer_name text,
  customer_email text,
  rating integer,
  comment text,
  is_published boolean DEFAULT true,
  hidden boolean NOT NULL DEFAULT false
);

CREATE TABLE public.idempotency_keys (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  idempotency_hash text NOT NULL,
  amount numeric,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'processing'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.dialog_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  user_id uuid,
  slots jsonb DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'collecting'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.support_tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  subject text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open'::text,
  created_at timestamp with time zone DEFAULT now(),
  priority text DEFAULT 'normal'::text,
  escalated boolean NOT NULL DEFAULT false,
  escalated_at timestamp with time zone,
  escalated_by uuid,
  assignee_id uuid,
  metadata jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.escalation_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  customer_phone text NOT NULL,
  session_id text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  assigned_agent_id uuid,
  conversation_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.event_outbox (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  type text NOT NULL,
  tenant_id uuid,
  location_id uuid,
  payload jsonb,
  hash text NOT NULL,
  delivered_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event text NOT NULL,
  version text DEFAULT '1.0.0'::text,
  tenant_id uuid,
  location_id uuid,
  payload jsonb,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.faqs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  category text,
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0
);

CREATE TABLE public.whatsapp_provider_secrets (
  tenant_id uuid NOT NULL,
  provider text NOT NULL,
  api_key text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  base_url text,
  instance_name text,
  token_expires_at timestamp with time zone
);

CREATE TABLE public.tenant_messaging_stats (
  tenant_id uuid NOT NULL,
  window_start timestamp with time zone NOT NULL DEFAULT now(),
  sent_24h integer NOT NULL DEFAULT 0,
  initiated_24h integer NOT NULL DEFAULT 0,
  initiated_recipients_24h integer NOT NULL DEFAULT 0,
  recipients_seen jsonb NOT NULL DEFAULT '[]'::jsonb,
  cold_outbound_24h integer NOT NULL DEFAULT 0,
  opt_outs_24h integer NOT NULL DEFAULT 0,
  failures_24h integer NOT NULL DEFAULT 0,
  risk_score numeric NOT NULL DEFAULT 0,
  quarantined_until timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  phone_number text NOT NULL,
  session_type text NOT NULL DEFAULT 'review_collection'::text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.staff_skills (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  skill_id uuid NOT NULL,
  skill_name text NOT NULL,
  proficiency smallint DEFAULT 1,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.review_flags (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  review_id uuid NOT NULL,
  reporter text,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_showcase_pack_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  pack_id uuid NOT NULL,
  item_type text NOT NULL,
  title text NOT NULL,
  caption text,
  media_url text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/octet-stream'::text,
  file_name text,
  file_size bigint NOT NULL DEFAULT 0,
  cta_label text,
  cta_url text,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.tenant_modules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  registry_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.revenue_optimizations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  optimization_type character varying(100) NOT NULL,
  target_id uuid NOT NULL,
  target_type character varying(50) NOT NULL,
  current_value numeric(10,2),
  optimized_value numeric(10,2),
  expected_impact numeric(5,2),
  confidence numeric(5,4),
  factors jsonb DEFAULT '{}'::jsonb,
  status character varying(50) DEFAULT 'pending'::character varying,
  applied_at timestamp with time zone,
  expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval),
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.whatsapp_showcase_packs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  slug text NOT NULL DEFAULT ''::text,
  template_kind text NOT NULL DEFAULT 'custom'::text,
  description text,
  intro_message text,
  trigger_phrases text[] NOT NULL DEFAULT ARRAY['portfolio'::text, 'show me your work'::text, 'gallery'::text],
  fallback_cta text NOT NULL DEFAULT 'Reply BOOK to get started.'::text,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.tenant_reminder_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  reminder_offset_minutes integer NOT NULL DEFAULT 60,
  template text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.tenant_revenue_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  revenue_type text NOT NULL,
  amount_credits numeric(20,6) NOT NULL,
  source text NOT NULL DEFAULT 'manual'::text,
  reference text,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.service_ratings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  service_id uuid NOT NULL,
  average_rating numeric(3,2) DEFAULT 0,
  total_reviews integer DEFAULT 0,
  total_bookings integer DEFAULT 0,
  total_revenue numeric(10,2) DEFAULT 0,
  average_duration_minutes integer DEFAULT 0,
  popularity_score numeric(5,2) DEFAULT 0,
  period_start date NOT NULL,
  period_end date NOT NULL,
  period_type character varying(20) DEFAULT 'month'::character varying,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.staff_services (
  tenant_id uuid NOT NULL,
  staff_user_id text NOT NULL,
  service_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  price_override numeric(10,2)
);

CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  reservation_id uuid,
  from_number text,
  to_number text,
  content text,
  direction text,
  raw jsonb,
  created_at timestamp with time zone DEFAULT now(),
  chat_id uuid,
  provider_message_sid text,
  message_type text DEFAULT 'text'::text,
  evolution_message_id text,
  media_info jsonb,
  media_url text,
  media_thumbnail text,
  media_metadata jsonb,
  "timestamp" timestamp with time zone,
  read_at timestamp with time zone,
  user_id uuid,
  ai_layer text DEFAULT 'none'::text,
  tokens_used integer DEFAULT 0
);

CREATE TABLE public.reservations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  date date,
  "time" text,
  notes text,
  created_at timestamp without time zone DEFAULT now(),
  customer_id uuid,
  booking_id uuid,
  status text,
  duration smallint,
  calendar_sent boolean DEFAULT false,
  reminder_sent boolean DEFAULT false,
  customer_number text,
  start_at timestamp with time zone,
  end_at timestamp with time zone,
  metadata jsonb DEFAULT '{}'::jsonb,
  staff_id uuid,
  service_id uuid,
  tenant_staff_id uuid,
  reminder_24h_sent boolean DEFAULT false,
  reminder_2h_sent boolean DEFAULT false,
  confirmed_at timestamp with time zone
);

CREATE TABLE public.tenant_daily_summary (
  tenant_id uuid NOT NULL,
  date date NOT NULL,
  bookings_count integer NOT NULL DEFAULT 0,
  completed_count integer NOT NULL DEFAULT 0,
  cancelled_count integer NOT NULL DEFAULT 0,
  no_show_count integer NOT NULL DEFAULT 0,
  estimated_revenue numeric(12,2) NOT NULL DEFAULT 0,
  top_service text,
  top_staff text,
  generated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.reservation_trends (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  date date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.message_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  message_type text NOT NULL,
  template_name text NOT NULL,
  language text NOT NULL DEFAULT 'en_US'::text,
  param_mapping jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_connection_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  instance_name text NOT NULL,
  messages_sent_today integer NOT NULL DEFAULT 0,
  messages_received_today integer NOT NULL DEFAULT 0,
  uptime_percentage numeric(5,2) NOT NULL DEFAULT 100,
  average_response_time numeric(10,2),
  error_count_24h integer NOT NULL DEFAULT 0,
  total_conversations integer NOT NULL DEFAULT 0,
  active_conversations integer NOT NULL DEFAULT 0,
  last_message_timestamp timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.tenant_tone_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  tone text,
  style_guidelines text,
  voice_parameters jsonb,
  sample_phrases jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.reservation_services (
  reservation_id uuid NOT NULL,
  service_id uuid NOT NULL,
  quantity integer DEFAULT 1,
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL
);

CREATE TABLE public.staff_schedules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  day_of_week integer NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  break_start time without time zone,
  break_end time without time zone,
  tenant_user_id uuid
);

CREATE TABLE public.logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source text,
  type text,
  data jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.tenant_users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  user_id uuid,
  role text NOT NULL DEFAULT 'staff'::text,
  created_at timestamp with time zone DEFAULT now(),
  email text,
  name text,
  phone text,
  services_all boolean DEFAULT true
);

CREATE TABLE public.admins (
  created_at timestamp with time zone DEFAULT now(),
  email text NOT NULL,
  status boolean,
  last_sign_in time without time zone,
  invited_by text,
  invited_at time without time zone,
  id smallint NOT NULL
);

CREATE TABLE public.staff_ratings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  average_rating numeric(3,2) DEFAULT 0,
  total_reviews integer DEFAULT 0,
  five_star_count integer DEFAULT 0,
  four_star_count integer DEFAULT 0,
  three_star_count integer DEFAULT 0,
  two_star_count integer DEFAULT 0,
  one_star_count integer DEFAULT 0,
  total_bookings integer DEFAULT 0,
  completed_bookings integer DEFAULT 0,
  completion_rate numeric(5,2) DEFAULT 0,
  period_start date NOT NULL,
  period_end date NOT NULL,
  period_type character varying(20) DEFAULT 'month'::character varying,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.service_performance_summary (
  tenant_id uuid NOT NULL,
  service_id uuid NOT NULL,
  bookings integer NOT NULL DEFAULT 0,
  revenue numeric(12,2) NOT NULL DEFAULT 0,
  cancellations integer NOT NULL DEFAULT 0,
  completion_rate numeric(6,4) NOT NULL DEFAULT 0,
  generated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.reservation_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  action text,
  created_at timestamp without time zone DEFAULT now(),
  reservation_id uuid,
  actor text,
  notes text
);

CREATE TABLE public.tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  created_by uuid,
  title text NOT NULL,
  description text,
  priority character varying(10) NOT NULL DEFAULT 'medium'::character varying,
  status character varying(20) NOT NULL DEFAULT 'todo'::character varying,
  due_date date,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.ai_front_desk_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  event_type text NOT NULL,
  event_category text NOT NULL,
  channel text,
  actor_role text,
  actor_id text,
  customer_id uuid,
  reservation_id uuid,
  service_id uuid,
  staff_id uuid,
  campaign_run_id uuid,
  message_id text,
  correlation_id text,
  amount numeric(12,2),
  currency text,
  status_from text,
  status_to text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.tenants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  whatsapp_number text,
  whatsapp_api_provider text,
  plan text DEFAULT 'starter'::text,
  notify_via_sms boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  whatsapp_number_id text,
  waba_api_key text,
  whatsapp_status text DEFAULT 'disconnected'::text,
  whatsapp_connected_at timestamp with time zone,
  email text,
  business_type text,
  tone_config jsonb DEFAULT '{}'::jsonb,
  timezone text,
  metadata jsonb DEFAULT '{}'::jsonb,
  preferred_llm_model text,
  llm_token_rate numeric,
  industry text,
  slug text,
  routing_code text,
  buffer_minutes integer DEFAULT 15,
  v2_enabled boolean DEFAULT false,
  lifecycle_state text NOT NULL DEFAULT 'active'::text,
  offboarding_reason text,
  offboarded_by uuid,
  offboarded_at timestamp with time zone,
  scheduled_purge_at timestamp with time zone,
  financials_purge_at timestamp with time zone
);

CREATE TABLE public.tenant_listening_config (
  tenant_id uuid NOT NULL,
  business_name text NOT NULL,
  handles text[] NOT NULL DEFAULT '{}'::text[],
  keywords text[] NOT NULL DEFAULT '{}'::text[],
  platforms text[] NOT NULL DEFAULT '{}'::text[],
  enabled boolean NOT NULL DEFAULT false,
  last_polled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.staff_performance_summary (
  tenant_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  bookings integer NOT NULL DEFAULT 0,
  completion_rate numeric(6,4) NOT NULL DEFAULT 0,
  estimated_revenue numeric(12,2) NOT NULL DEFAULT 0,
  generated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.reminders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  reservation_id uuid,
  remind_at timestamp with time zone NOT NULL,
  method text NOT NULL DEFAULT 'whatsapp'::text,
  status text NOT NULL DEFAULT 'pending'::text,
  attempts integer NOT NULL DEFAULT 0,
  raw jsonb,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.ai_training_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  message_id text,
  channel text,
  user_role text,
  message text NOT NULL,
  intent text,
  grounded_context jsonb,
  llm_response jsonb,
  backend_action text,
  success boolean,
  correction text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  short_description text,
  price_cents integer NOT NULL DEFAULT 0,
  cost_price_cents integer,
  price numeric(12,2),
  currency text NOT NULL DEFAULT 'NGN'::text,
  sku text,
  brand text,
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  is_featured boolean NOT NULL DEFAULT false,
  is_digital boolean NOT NULL DEFAULT false,
  track_inventory boolean NOT NULL DEFAULT false,
  stock_quantity integer NOT NULL DEFAULT 0,
  low_stock_threshold integer DEFAULT 0,
  upsell_priority integer DEFAULT 0,
  weight_grams integer,
  dimensions jsonb,
  frequently_bought_together jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  category text
);

CREATE TABLE public.transaction_retries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  attempted_at timestamp with time zone DEFAULT now(),
  error_code text,
  error_message text,
  response_data jsonb,
  status text,
  next_attempt_at timestamp with time zone
);

CREATE TABLE public.ai_wallet_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  kind text NOT NULL,
  amount_credits numeric(20,6) NOT NULL,
  token_count bigint,
  provider text,
  model text,
  request_id text,
  reference text,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.llm_calls (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  action text,
  model text,
  usage jsonb,
  raw jsonb,
  created_at timestamp with time zone DEFAULT now(),
  total_tokens integer,
  estimated_cost numeric
);

CREATE TABLE public.security_violations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL,
  tenant_id uuid,
  violation_details jsonb NOT NULL,
  severity text NOT NULL,
  status text DEFAULT 'open'::text,
  assigned_to uuid,
  resolved_at timestamp with time zone,
  resolution_notes text,
  detected_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  amount numeric(12,2),
  currency text DEFAULT 'NGN'::text,
  type text,
  status text,
  raw jsonb,
  created_at timestamp with time zone DEFAULT now(),
  original_transaction_id uuid,
  refund_amount numeric(12,2),
  refund_reason text,
  retry_count integer DEFAULT 0,
  last_retry_at timestamp with time zone,
  next_retry_at timestamp with time zone,
  provider_reference text,
  reconciliation_status text DEFAULT 'pending'::text,
  reconciled_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.ai_wallets (
  tenant_id uuid NOT NULL,
  currency text NOT NULL DEFAULT 'credits'::text,
  balance_credits numeric(20,6) NOT NULL DEFAULT 0,
  lifetime_topups_credits numeric(20,6) NOT NULL DEFAULT 0,
  lifetime_spent_credits numeric(20,6) NOT NULL DEFAULT 0,
  low_balance_threshold_credits numeric(20,6) NOT NULL DEFAULT 25,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  daily_budget_credits numeric,
  velocity_credits_override numeric,
  budget_warned_on date
);

CREATE TABLE public.security_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  rule_name text NOT NULL,
  rule_type text NOT NULL,
  severity text NOT NULL,
  condition_sql text NOT NULL,
  remediation_text text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.ledger_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  transaction_id uuid,
  entry_type text NOT NULL,
  amount numeric(12,2) NOT NULL,
  currency text DEFAULT 'NGN'::text,
  description text,
  reference_id text,
  posted_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE public.alert_rules (
  id uuid NOT NULL,
  metric text NOT NULL,
  threshold double precision NOT NULL,
  operator text NOT NULL,
  duration integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  channels text[] NOT NULL DEFAULT ARRAY[]::text[],
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.social_mentions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  provider text NOT NULL,
  external_id text NOT NULL,
  platform text NOT NULL,
  author text,
  url text,
  content text,
  matched_term text,
  status text NOT NULL DEFAULT 'new'::text,
  raw jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  ingested_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.product_variants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  name text NOT NULL,
  variant_name text,
  variant_type text,
  description text,
  sku text,
  price_cents integer,
  price numeric(12,2),
  price_adjustment_cents integer DEFAULT 0,
  stock_quantity integer NOT NULL DEFAULT 0,
  display_order integer DEFAULT 0,
  weight_grams integer,
  volume_ml integer,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.analytics_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  event_type character varying(50) NOT NULL,
  event_category character varying(50),
  user_id uuid,
  customer_id uuid,
  session_id character varying(100),
  reservation_id uuid,
  service_id uuid,
  staff_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  source character varying(20),
  utm_source character varying(100),
  utm_medium character varying(100),
  utm_campaign character varying(100),
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.slot_locks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  tenant_staff_id uuid NOT NULL,
  date date NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  customer_phone text NOT NULL,
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + '00:03:00'::interval)
);

CREATE TABLE public.platform_settings_kv (
  key text NOT NULL,
  value jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE public.tenant_knowledge_articles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  category text NOT NULL DEFAULT 'general'::text,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.webhook_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  external_id text NOT NULL,
  event_type text,
  payload jsonb,
  processed_at timestamp with time zone DEFAULT now(),
  tenant_id uuid,
  signature text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.update_reviews_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_old_audit_logs(retention_days integer DEFAULT 2555)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM audit_logs 
    WHERE timestamp < NOW() - (retention_days || ' days')::INTERVAL
    AND security_level != 'critical'; -- Never delete critical security events
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_compliance_summary(p_tenant_id uuid, p_compliance_flag text, p_start_date timestamp with time zone, p_end_date timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'period', json_build_object(
            'start', p_start_date,
            'end', p_end_date
        ),
        'standard', p_compliance_flag,
        'totalEvents', COUNT(*),
        'securityViolations', COUNT(CASE WHEN event_type = 'security_violation' THEN 1 END),
        'highRiskEvents', COUNT(CASE WHEN (result->>'riskLevel') IN ('high', 'critical') THEN 1 END),
        'failedAccessAttempts', COUNT(CASE WHEN (result->>'status') = 'failure' THEN 1 END),
        'privilegeEscalations', COUNT(CASE WHEN event_type = 'privilege_escalation' THEN 1 END),
        'complianceScore', CASE 
            WHEN COUNT(*) = 0 THEN 100
            ELSE GREATEST(0, 100 - (COUNT(CASE WHEN event_type = 'security_violation' OR security_level = 'critical' THEN 1 END) * 100.0 / COUNT(*))::INTEGER)
        END
    )
    INTO result
    FROM audit_logs
    WHERE tenant_id = p_tenant_id
    AND timestamp BETWEEN p_start_date AND p_end_date
    AND (p_compliance_flag = ANY(compliance_flags) OR p_compliance_flag IS NULL);
    
    RETURN result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.check_reservation_service_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.services s 
    WHERE s.id = NEW.service_id 
    AND s.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Service % does not belong to tenant %', NEW.service_id, NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_critical_security_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.security_level = 'critical' OR NEW.event_type = 'security_violation' THEN
        PERFORM pg_notify(
            'critical_security_event',
            json_build_object(
                'audit_log_id', NEW.id,
                'event_type', NEW.event_type,
                'user_id', NEW.user_id,
                'tenant_id', NEW.tenant_id,
                'timestamp', NEW.timestamp,
                'security_level', NEW.security_level
            )::TEXT
        );
    END IF;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_audit_analytics()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY audit_analytics;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_limit(real)
 RETURNS real
 LANGUAGE c
 STRICT
AS '$libdir/pg_trgm', $function$set_limit$function$
;

CREATE OR REPLACE FUNCTION public.show_limit()
 RETURNS real
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$show_limit$function$
;

CREATE OR REPLACE FUNCTION public.show_trgm(text)
 RETURNS text[]
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$show_trgm$function$
;

CREATE OR REPLACE FUNCTION public.similarity(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$similarity$function$
;

CREATE OR REPLACE FUNCTION public.similarity_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$similarity_op$function$
;

CREATE OR REPLACE FUNCTION public.word_similarity(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity$function$
;

CREATE OR REPLACE FUNCTION public.word_similarity_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_op$function$
;

CREATE OR REPLACE FUNCTION public.word_similarity_commutator_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_commutator_op$function$
;

CREATE OR REPLACE FUNCTION public.similarity_dist(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$similarity_dist$function$
;

CREATE OR REPLACE FUNCTION public.word_similarity_dist_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_dist_op$function$
;

CREATE OR REPLACE FUNCTION public.word_similarity_dist_commutator_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_dist_commutator_op$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_in(cstring)
 RETURNS gtrgm
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_in$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_out(gtrgm)
 RETURNS cstring
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_out$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_consistent(internal, text, smallint, oid, internal)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_consistent$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_distance(internal, text, smallint, oid, internal)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_distance$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_compress(internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_compress$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_decompress(internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_decompress$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_penalty(internal, internal, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_penalty$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_picksplit(internal, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_picksplit$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_union(internal, internal)
 RETURNS gtrgm
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_union$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_same(gtrgm, gtrgm, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_same$function$
;

CREATE OR REPLACE FUNCTION public.gin_extract_value_trgm(text, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_extract_value_trgm$function$
;

CREATE OR REPLACE FUNCTION public.gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_extract_query_trgm$function$
;

CREATE OR REPLACE FUNCTION public.gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_trgm_consistent$function$
;

CREATE OR REPLACE FUNCTION public.gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal)
 RETURNS "char"
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_trgm_triconsistent$function$
;

CREATE OR REPLACE FUNCTION public.strict_word_similarity(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity$function$
;

CREATE OR REPLACE FUNCTION public.strict_word_similarity_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_op$function$
;

CREATE OR REPLACE FUNCTION public.strict_word_similarity_commutator_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_commutator_op$function$
;

CREATE OR REPLACE FUNCTION public.strict_word_similarity_dist_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_dist_op$function$
;

CREATE OR REPLACE FUNCTION public.strict_word_similarity_dist_commutator_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_dist_commutator_op$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_options(internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/pg_trgm', $function$gtrgm_options$function$
;

CREATE OR REPLACE FUNCTION public.update_availability_on_schedule_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    PERFORM generate_availability_slots(
      NEW.staff_id,
      NEW.tenant_id,
      CURRENT_DATE,
      CURRENT_DATE + INTERVAL '30 days',
      60
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_availability_slots(p_staff_id uuid, p_tenant_id uuid, p_start_date date, p_end_date date, p_slot_duration_minutes integer DEFAULT 60)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  slot_count   INTEGER := 0;
  loop_date    DATE;
  schedule_rec RECORD;
  slot_start   TIMESTAMP WITH TIME ZONE;
  slot_end     TIMESTAMP WITH TIME ZONE;
  day_end      TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Clear existing slots for this staff member and date range
  DELETE FROM availability_slots
  WHERE staff_id = p_staff_id
    AND tenant_id = p_tenant_id
    AND start_time::date BETWEEN p_start_date AND p_end_date;

  loop_date := p_start_date;
  WHILE loop_date <= p_end_date LOOP
    SELECT * INTO schedule_rec
    FROM staff_schedules
    WHERE staff_id  = p_staff_id
      AND tenant_id = p_tenant_id
      AND day_of_week = EXTRACT(DOW FROM loop_date)
      AND is_active = true;

    IF FOUND THEN
      slot_start := loop_date + schedule_rec.start_time;
      day_end    := loop_date + schedule_rec.end_time;

      WHILE slot_start + (p_slot_duration_minutes || ' minutes')::interval <= day_end LOOP
        slot_end := slot_start + (p_slot_duration_minutes || ' minutes')::interval;

        INSERT INTO availability_slots (
          staff_id, tenant_id, start_time, end_time,
          slot_type, is_available, confidence_score
        ) VALUES (
          p_staff_id, p_tenant_id, slot_start, slot_end,
          'regular', true, 1.0000
        );

        slot_count := slot_count + 1;
        slot_start := slot_end;
      END LOOP;
    END IF;

    loop_date := loop_date + 1;
  END LOOP;

  RETURN slot_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.increment_chat_unread()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  -- Only increment for inbound messages with a valid chat_id
  if (new.direction = 'inbound' and new.chat_id is not null) then
    update public.chats set unread_count = coalesce(unread_count,0) + 1 where id = new.chat_id;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_customer_analytics_on_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Invalidate customer analytics cache when new booking is created
  DELETE FROM customer_analytics 
  WHERE tenant_id = NEW.tenant_id AND customer_id = NEW.customer_id;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_expired_analytics()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  deleted_count INTEGER := 0;
BEGIN
  -- Clean expired analytics cache
  DELETE FROM analytics_metrics_cache WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Clean expired ML predictions
  DELETE FROM ml_predictions WHERE expires_at < NOW();
  
  -- Clean expired customer analytics
  DELETE FROM customer_analytics WHERE expires_at < NOW();
  
  -- Clean expired revenue optimizations
  UPDATE revenue_optimizations 
  SET status = 'expired' 
  WHERE expires_at < NOW() AND status = 'pending';
  
  RETURN deleted_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.aggregate_staff_ratings(p_tenant_id uuid, p_staff_id uuid, p_period_start date, p_period_end date, p_period_type character varying)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_avg_rating DECIMAL(3,2);
  v_total_reviews INTEGER;
  v_star_counts INTEGER[];
  v_total_bookings INTEGER;
  v_completed_bookings INTEGER;
BEGIN
  -- Calculate review statistics
  SELECT 
    COALESCE(AVG(staff_rating), 0),
    COUNT(*),
    ARRAY[
      COUNT(*) FILTER (WHERE staff_rating >= 4.5),
      COUNT(*) FILTER (WHERE staff_rating >= 3.5 AND staff_rating < 4.5),
      COUNT(*) FILTER (WHERE staff_rating >= 2.5 AND staff_rating < 3.5),
      COUNT(*) FILTER (WHERE staff_rating >= 1.5 AND staff_rating < 2.5),
      COUNT(*) FILTER (WHERE staff_rating < 1.5)
    ]
  INTO v_avg_rating, v_total_reviews, v_star_counts
  FROM reviews
  WHERE tenant_id = p_tenant_id
    AND staff_id = p_staff_id
    AND created_at >= p_period_start
    AND created_at <= p_period_end
    AND staff_rating IS NOT NULL;

  -- Calculate booking statistics
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'completed')
  INTO v_total_bookings, v_completed_bookings
  FROM reservations
  WHERE tenant_id = p_tenant_id
    AND staff_id = p_staff_id
    AND start_at >= p_period_start
    AND start_at <= p_period_end;

  -- Insert or update staff ratings
  INSERT INTO staff_ratings (
    tenant_id, staff_id, average_rating, total_reviews,
    five_star_count, four_star_count, three_star_count, two_star_count, one_star_count,
    total_bookings, completed_bookings, completion_rate,
    period_start, period_end, period_type
  )
  VALUES (
    p_tenant_id, p_staff_id, v_avg_rating, v_total_reviews,
    v_star_counts[1], v_star_counts[2], v_star_counts[3], v_star_counts[4], v_star_counts[5],
    v_total_bookings, v_completed_bookings,
    CASE WHEN v_total_bookings > 0 THEN (v_completed_bookings::DECIMAL / v_total_bookings * 100) ELSE 0 END,
    p_period_start, p_period_end, p_period_type
  )
  ON CONFLICT (staff_id, period_start, period_end, period_type)
  DO UPDATE SET
    average_rating = EXCLUDED.average_rating,
    total_reviews = EXCLUDED.total_reviews,
    five_star_count = EXCLUDED.five_star_count,
    four_star_count = EXCLUDED.four_star_count,
    three_star_count = EXCLUDED.three_star_count,
    two_star_count = EXCLUDED.two_star_count,
    one_star_count = EXCLUDED.one_star_count,
    total_bookings = EXCLUDED.total_bookings,
    completed_bookings = EXCLUDED.completed_bookings,
    completion_rate = EXCLUDED.completion_rate,
    updated_at = NOW();
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_customer_compat_columns()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.name := coalesce(new.name, new.customer_name);
  new.customer_name := coalesce(new.customer_name, new.name);
  new.phone := coalesce(new.phone, new.phone_number);
  new.phone_number := coalesce(new.phone_number, new.phone);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_product_stock(product_id uuid)
 RETURNS TABLE(stock_quantity integer, reserved integer, available integer)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT COALESCE(p.stock_quantity, 0), 0, COALESCE(p.stock_quantity, 0)
  FROM public.products p
  WHERE p.id = get_product_stock.product_id;
$function$
;

CREATE OR REPLACE FUNCTION public.auth_user_tenant_ids()
 RETURNS TABLE(tenant_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid();
  $function$
;

CREATE OR REPLACE FUNCTION public.update_availability_on_reservation_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Mark slot as unavailable for new/updated reservations
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE public.availability_slots 
    SET is_available = false, 
        reservation_id = NEW.id,
        updated_at = now()
    WHERE tenant_id = NEW.tenant_id
      AND staff_id = NEW.staff_id
      AND slot_date = NEW.start_at::date
      AND slot_time = NEW.start_at::time
      AND duration_minutes = (EXTRACT(epoch FROM (NEW.end_at - NEW.start_at))/60)::integer;
  END IF;
  
  -- Free up slot for deleted/cancelled reservations
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.status = 'cancelled') THEN
    UPDATE public.availability_slots 
    SET is_available = true, 
        reservation_id = null,
        updated_at = now()
    WHERE tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
      AND staff_id = COALESCE(NEW.staff_id, OLD.staff_id)
      AND reservation_id = COALESCE(NEW.id, OLD.id);
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.ts_update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_set_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.jobs_set_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_customer_ltv(p_tenant_id uuid, p_customer_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  total_spent DECIMAL;
  avg_booking_frequency DECIMAL;
  avg_booking_value DECIMAL;
  predicted_lifespan_months INTEGER := 24; -- 2 years default
BEGIN
  -- Get historical spending
  SELECT COALESCE(SUM(amount), 0)
  INTO total_spent
  FROM transactions 
  WHERE tenant_id = p_tenant_id 
    AND metadata->>'customer_id' = p_customer_id::TEXT
    AND status = 'completed';
  
  -- Get booking frequency (bookings per month)
  SELECT COUNT(*)::DECIMAL / GREATEST(
    EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) / (30 * 24 * 60 * 60), 1
  )
  INTO avg_booking_frequency
  FROM reservations 
  WHERE tenant_id = p_tenant_id 
    AND customer_id = p_customer_id
    AND status != 'cancelled';
  
  -- Get average booking value
  SELECT COALESCE(AVG(amount), 0)
  INTO avg_booking_value
  FROM transactions 
  WHERE tenant_id = p_tenant_id 
    AND metadata->>'customer_id' = p_customer_id::TEXT
    AND status = 'completed';
  
  -- Calculate predicted LTV
  RETURN (avg_booking_frequency * avg_booking_value * predicted_lifespan_months);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.detect_booking_anomalies(p_tenant_id uuid, p_lookback_days integer DEFAULT 7)
 RETURNS TABLE(anomaly_type character varying, severity character varying, description text, score numeric, data_points jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  avg_bookings_per_day DECIMAL;
  recent_bookings_per_day DECIMAL;
  threshold_multiplier DECIMAL := 2.0; -- 2x normal is anomaly
BEGIN
  -- Calculate average bookings per day (last 30 days excluding recent period)
  SELECT COUNT(*)::DECIMAL / 30
  INTO avg_bookings_per_day
  FROM reservations
  WHERE tenant_id = p_tenant_id
    AND created_at >= NOW() - INTERVAL '30 days'
    AND created_at <= NOW() - INTERVAL '7 days';
  
  -- Calculate recent bookings per day
  SELECT COUNT(*)::DECIMAL / p_lookback_days
  INTO recent_bookings_per_day
  FROM reservations
  WHERE tenant_id = p_tenant_id
    AND created_at >= NOW() - (p_lookback_days || ' days')::INTERVAL;
  
  -- Check for anomalies
  IF recent_bookings_per_day > (avg_bookings_per_day * threshold_multiplier) THEN
    RETURN QUERY SELECT
      'booking_spike'::VARCHAR,
      CASE 
        WHEN recent_bookings_per_day > (avg_bookings_per_day * 3) THEN 'high'::VARCHAR
        WHEN recent_bookings_per_day > (avg_bookings_per_day * 2) THEN 'medium'::VARCHAR
        ELSE 'low'::VARCHAR
      END,
      'Unusual spike in booking volume detected'::TEXT,
      (recent_bookings_per_day / avg_bookings_per_day - 1)::DECIMAL,
      jsonb_build_object(
        'avg_bookings_per_day', avg_bookings_per_day,
        'recent_bookings_per_day', recent_bookings_per_day,
        'multiplier', recent_bookings_per_day / NULLIF(avg_bookings_per_day, 0)
      );
  END IF;
  
  IF recent_bookings_per_day < (avg_bookings_per_day / threshold_multiplier) AND avg_bookings_per_day > 0 THEN
    RETURN QUERY SELECT
      'booking_drop'::VARCHAR,
      CASE 
        WHEN recent_bookings_per_day < (avg_bookings_per_day / 3) THEN 'high'::VARCHAR
        WHEN recent_bookings_per_day < (avg_bookings_per_day / 2) THEN 'medium'::VARCHAR
        ELSE 'low'::VARCHAR
      END,
      'Significant drop in booking volume detected'::TEXT,
      (1 - recent_bookings_per_day / avg_bookings_per_day)::DECIMAL,
      jsonb_build_object(
        'avg_bookings_per_day', avg_bookings_per_day,
        'recent_bookings_per_day', recent_bookings_per_day,
        'drop_percentage', (1 - recent_bookings_per_day / avg_bookings_per_day) * 100
      );
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_whatsapp_queue_messages(p_limit integer DEFAULT 20)
 RETURNS SETOF whatsapp_message_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit integer := GREATEST(COALESCE(p_limit, 20), 1);
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT q.id
    FROM public.whatsapp_message_queue q
    WHERE q.status IN ('pending', 'retry')
      AND (q.scheduled_at IS NULL OR q.scheduled_at <= NOW())
    ORDER BY
      CASE q.priority
        WHEN 'urgent' THEN 4
        WHEN 'high' THEN 3
        WHEN 'normal' THEN 2
        ELSE 1
      END DESC,
      q.created_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.whatsapp_message_queue q
  SET status = 'processing'
  FROM claimed
  WHERE q.id = claimed.id
  RETURNING q.*;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.acquire_cron_lock(p_key text, p_ttl_seconds integer DEFAULT 90)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := NOW();
  v_until timestamptz := v_now + make_interval(secs => GREATEST(COALESCE(p_ttl_seconds, 90), 1));
  v_acquired boolean := false;
BEGIN
  INSERT INTO public.cron_locks (key, locked_until)
  VALUES (p_key, v_until)
  ON CONFLICT (key) DO UPDATE
    SET locked_until = EXCLUDED.locked_until
    WHERE public.cron_locks.locked_until < v_now
  RETURNING true INTO v_acquired;

  RETURN COALESCE(v_acquired, false);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.release_cron_lock(p_key text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  DELETE FROM public.cron_locks WHERE key = p_key;
$function$
;

CREATE OR REPLACE FUNCTION public.ensure_ai_wallet(p_tenant_id uuid, p_currency text DEFAULT 'credits'::text)
 RETURNS ai_wallets
 LANGUAGE plpgsql
AS $function$
DECLARE
  wallet public.ai_wallets;
BEGIN
  INSERT INTO public.ai_wallets (tenant_id, currency)
  VALUES (p_tenant_id, COALESCE(NULLIF(p_currency, ''), 'credits'))
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT * INTO wallet
  FROM public.ai_wallets
  WHERE tenant_id = p_tenant_id;

  RETURN wallet;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.topup_ai_wallet(p_tenant_id uuid, p_amount_credits numeric, p_reference text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(balance_credits numeric, lifetime_topups_credits numeric, lifetime_spent_credits numeric, ledger_id uuid)
 LANGUAGE plpgsql
AS $function$
DECLARE
  wallet public.ai_wallets;
  new_ledger_id UUID;
BEGIN
  PERFORM public.ensure_ai_wallet(p_tenant_id);

  IF p_amount_credits IS NULL OR p_amount_credits <= 0 THEN
    RAISE EXCEPTION 'amount must be greater than zero';
  END IF;

  SELECT * INTO wallet
  FROM public.ai_wallets
  WHERE tenant_id = p_tenant_id
  FOR UPDATE;

  UPDATE public.ai_wallets
  SET
    balance_credits = balance_credits + p_amount_credits,
    lifetime_topups_credits = lifetime_topups_credits + p_amount_credits,
    updated_at = NOW()
  WHERE tenant_id = p_tenant_id
  RETURNING * INTO wallet;

  INSERT INTO public.ai_wallet_ledger (
    tenant_id,
    kind,
    amount_credits,
    reference,
    description,
    metadata
  )
  VALUES (
    p_tenant_id,
    'topup',
    p_amount_credits,
    p_reference,
    COALESCE(p_description, 'Manual top-up'),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO new_ledger_id;

  RETURN QUERY SELECT wallet.balance_credits, wallet.lifetime_topups_credits, wallet.lifetime_spent_credits, new_ledger_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reserve_ai_wallet_spend(p_tenant_id uuid, p_amount_credits numeric, p_request_id text DEFAULT NULL::text, p_provider text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(allowed boolean, balance_credits numeric, reservation_id uuid, reason text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  wallet public.ai_wallets;
  new_ledger_id UUID;
BEGIN
  PERFORM public.ensure_ai_wallet(p_tenant_id);

  IF p_amount_credits IS NULL OR p_amount_credits <= 0 THEN
    RETURN QUERY SELECT false, NULL::NUMERIC, NULL::UUID, 'invalid_amount';
    RETURN;
  END IF;

  SELECT * INTO wallet
  FROM public.ai_wallets
  WHERE tenant_id = p_tenant_id
  FOR UPDATE;

  IF wallet.balance_credits < p_amount_credits THEN
    RETURN QUERY SELECT false, wallet.balance_credits, NULL::UUID, 'insufficient_balance';
    RETURN;
  END IF;

  UPDATE public.ai_wallets
  SET
    balance_credits = balance_credits - p_amount_credits,
    updated_at = NOW()
  WHERE tenant_id = p_tenant_id
  RETURNING * INTO wallet;

  INSERT INTO public.ai_wallet_ledger (
    tenant_id,
    kind,
    amount_credits,
    provider,
    model,
    request_id,
    description,
    metadata
  )
  VALUES (
    p_tenant_id,
    'reservation',
    -p_amount_credits,
    p_provider,
    p_model,
    p_request_id,
    COALESCE(p_description, 'AI spend reservation'),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO new_ledger_id;

  RETURN QUERY SELECT true, wallet.balance_credits, new_ledger_id, 'reserved';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_ai_wallet_spend(p_tenant_id uuid, p_reservation_id uuid, p_estimated_credits numeric, p_actual_credits numeric, p_tokens bigint DEFAULT NULL::bigint, p_provider text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(allowed boolean, balance_credits numeric, settlement_id uuid, refund_credits numeric, extra_credits numeric, reason text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  wallet public.ai_wallets;
  adjustment NUMERIC;
  new_ledger_id UUID;
BEGIN
  PERFORM public.ensure_ai_wallet(p_tenant_id);

  IF p_estimated_credits IS NULL OR p_actual_credits IS NULL THEN
    RETURN QUERY SELECT false, NULL::NUMERIC, NULL::UUID, 0::NUMERIC, 0::NUMERIC, 'invalid_amount';
    RETURN;
  END IF;

  SELECT * INTO wallet
  FROM public.ai_wallets
  WHERE tenant_id = p_tenant_id
  FOR UPDATE;

  adjustment := p_estimated_credits - p_actual_credits;

  IF adjustment < 0 AND wallet.balance_credits < ABS(adjustment) THEN
    RETURN QUERY SELECT false, wallet.balance_credits, NULL::UUID, 0::NUMERIC, ABS(adjustment), 'insufficient_balance_for_settlement';
    RETURN;
  END IF;

  UPDATE public.ai_wallets
  SET
    balance_credits = balance_credits + adjustment,
    lifetime_spent_credits = lifetime_spent_credits + p_actual_credits,
    updated_at = NOW()
  WHERE tenant_id = p_tenant_id
  RETURNING * INTO wallet;

  INSERT INTO public.ai_wallet_ledger (
    tenant_id,
    kind,
    amount_credits,
    token_count,
    provider,
    model,
    request_id,
    reference,
    description,
    metadata
  )
  VALUES (
    p_tenant_id,
    CASE WHEN adjustment >= 0 THEN 'refund' ELSE 'usage' END,
    adjustment,
    p_tokens,
    p_provider,
    p_model,
    p_request_id,
    p_reservation_id::text,
    'AI spend settlement',
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO new_ledger_id;

  RETURN QUERY SELECT true, wallet.balance_credits, new_ledger_id, GREATEST(adjustment, 0), GREATEST(-adjustment, 0), 'settled';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_inventory(p_tenant_id uuid, p_product_id uuid, p_variant_id uuid, p_quantity_change integer, p_movement_type text, p_reference_type text, p_reference_id text, p_reason text, p_performed_by uuid)
 RETURNS TABLE(movement_id uuid, previous_quantity integer, new_quantity integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_prev INTEGER;
  v_new  INTEGER;
  v_movement_id UUID;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    -- Variant-level stock
    SELECT COALESCE(stock_quantity, 0) INTO v_prev
    FROM product_variants
    WHERE id = p_variant_id
    FOR UPDATE;

    IF v_prev IS NULL THEN
      RAISE EXCEPTION 'Variant % not found', p_variant_id;
    END IF;

    v_new := GREATEST(0, v_prev + p_quantity_change);

    UPDATE product_variants
       SET stock_quantity = v_new,
           updated_at = now()
     WHERE id = p_variant_id;
  ELSE
    -- Product-level stock (tenant-scoped)
    SELECT COALESCE(stock_quantity, 0) INTO v_prev
    FROM products
    WHERE id = p_product_id
      AND tenant_id = p_tenant_id
    FOR UPDATE;

    IF v_prev IS NULL THEN
      RAISE EXCEPTION 'Product % not found for tenant %', p_product_id, p_tenant_id;
    END IF;

    v_new := GREATEST(0, v_prev + p_quantity_change);

    UPDATE products
       SET stock_quantity = v_new,
           updated_at = now()
     WHERE id = p_product_id
       AND tenant_id = p_tenant_id;
  END IF;

  INSERT INTO inventory_movements (
    tenant_id, product_id, variant_id, movement_type,
    quantity, quantity_change, previous_quantity, new_quantity,
    reference_type, reference_id, reason, performed_by, created_by
  ) VALUES (
    p_tenant_id, p_product_id, p_variant_id, p_movement_type,
    ABS(p_quantity_change), p_quantity_change, v_prev, v_new,
    p_reference_type, p_reference_id, p_reason, p_performed_by, p_performed_by
  )
  RETURNING id INTO v_movement_id;

  movement_id := v_movement_id;
  previous_quantity := v_prev;
  new_quantity := v_new;
  RETURN NEXT;
END;
$function$
;

CREATE MATERIALIZED VIEW public.audit_analytics AS  SELECT audit_logs.tenant_id,
    date_trunc('hour'::text, audit_logs."timestamp") AS hour,
    audit_logs.event_type,
    audit_logs.security_level,
    count(*) AS event_count,
    count(DISTINCT audit_logs.user_id) AS unique_users,
    count(DISTINCT audit_logs.ip_address) AS unique_ips,
    avg((audit_logs.result ->> 'securityScore'::text)::numeric) AS avg_security_score,
    count(
        CASE
            WHEN (audit_logs.result ->> 'status'::text) = 'failure'::text THEN 1
            ELSE NULL::integer
        END) AS failed_events,
    count(
        CASE
            WHEN ((audit_logs.result ->> 'requiresReview'::text)::boolean) = true THEN 1
            ELSE NULL::integer
        END) AS review_required
   FROM audit_logs
  WHERE audit_logs."timestamp" >= (CURRENT_DATE - '7 days'::interval)
  GROUP BY audit_logs.tenant_id, (date_trunc('hour'::text, audit_logs."timestamp")), audit_logs.event_type, audit_logs.security_level;;

ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);

ALTER TABLE public.webhook_events ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);

ALTER TABLE public.support_messages ADD CONSTRAINT support_messages_pkey PRIMARY KEY (id);

ALTER TABLE public.ml_models ADD CONSTRAINT ml_models_pkey PRIMARY KEY (id);

ALTER TABLE public.performance_metrics ADD CONSTRAINT performance_metrics_pkey PRIMARY KEY (id);

ALTER TABLE public.faqs ADD CONSTRAINT faqs_pkey PRIMARY KEY (id);

ALTER TABLE public.analytics_events ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);

ALTER TABLE public.staff_ratings ADD CONSTRAINT staff_ratings_pkey PRIMARY KEY (id);

ALTER TABLE public.service_ratings ADD CONSTRAINT service_ratings_pkey PRIMARY KEY (id);

ALTER TABLE public.reviews ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);

ALTER TABLE public.tasks ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);

ALTER TABLE public.jobs ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);

ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

ALTER TABLE public.whatsapp_conversations ADD CONSTRAINT whatsapp_conversations_pkey PRIMARY KEY (id);

ALTER TABLE public.tenant_daily_summary ADD CONSTRAINT tenant_daily_summary_pkey PRIMARY KEY (tenant_id, date);

ALTER TABLE public.leads ADD CONSTRAINT leads_pkey PRIMARY KEY (id);

ALTER TABLE public.idempotency_keys ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (id);

ALTER TABLE public.cron_locks ADD CONSTRAINT cron_locks_pkey PRIMARY KEY (key);

ALTER TABLE public.messages ADD CONSTRAINT messages_pkey PRIMARY KEY (id);

ALTER TABLE public.slot_locks ADD CONSTRAINT slot_locks_pkey PRIMARY KEY (id);

ALTER TABLE public.schedule_overrides ADD CONSTRAINT schedule_overrides_pkey PRIMARY KEY (id);

ALTER TABLE public.insights_daily ADD CONSTRAINT insights_daily_pkey PRIMARY KEY (id);

ALTER TABLE public.whatsapp_provider_secrets ADD CONSTRAINT whatsapp_provider_secrets_pkey PRIMARY KEY (tenant_id, provider);

ALTER TABLE public.service_performance_summary ADD CONSTRAINT service_performance_summary_pkey PRIMARY KEY (tenant_id, service_id);

ALTER TABLE public.staff_performance_summary ADD CONSTRAINT staff_performance_summary_pkey PRIMARY KEY (tenant_id, staff_id);

ALTER TABLE public.availability_snapshot ADD CONSTRAINT availability_snapshot_pkey PRIMARY KEY (tenant_id, staff_id, service_id, date);

ALTER TABLE public.messaging_consents ADD CONSTRAINT messaging_consents_pkey PRIMARY KEY (tenant_id, recipient, channel);

ALTER TABLE public.support_assignments ADD CONSTRAINT support_assignments_pkey PRIMARY KEY (id);

ALTER TABLE public.whatsapp_configurations ADD CONSTRAINT whatsapp_configurations_pkey PRIMARY KEY (id);

ALTER TABLE public.ai_training_events ADD CONSTRAINT ai_training_events_pkey PRIMARY KEY (id);

ALTER TABLE public.ai_front_desk_events ADD CONSTRAINT ai_front_desk_events_pkey PRIMARY KEY (id);

ALTER TABLE public.tenant_listening_config ADD CONSTRAINT tenant_listening_config_pkey PRIMARY KEY (tenant_id);

ALTER TABLE public.ai_wallet_ledger ADD CONSTRAINT ai_wallet_ledger_pkey PRIMARY KEY (id);

ALTER TABLE public.alert_rules ADD CONSTRAINT alert_rules_pkey PRIMARY KEY (id);

ALTER TABLE public.customer_profile_summary ADD CONSTRAINT customer_profile_summary_pkey PRIMARY KEY (tenant_id, customer_id);

ALTER TABLE public.whatsapp_showcase_packs ADD CONSTRAINT whatsapp_showcase_packs_pkey PRIMARY KEY (id);

ALTER TABLE public.ai_wallets ADD CONSTRAINT ai_wallets_pkey PRIMARY KEY (tenant_id);

ALTER TABLE public.whatsapp_showcase_pack_items ADD CONSTRAINT whatsapp_showcase_pack_items_pkey PRIMARY KEY (id);

ALTER TABLE public.tenant_revenue_ledger ADD CONSTRAINT tenant_revenue_ledger_pkey PRIMARY KEY (id);

ALTER TABLE public.tenant_cost_ledger ADD CONSTRAINT tenant_cost_ledger_pkey PRIMARY KEY (id);

ALTER TABLE public.products ADD CONSTRAINT products_pkey PRIMARY KEY (id);

ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);

ALTER TABLE public.invites ADD CONSTRAINT invites_pkey PRIMARY KEY (token);

ALTER TABLE public.customer_feedback ADD CONSTRAINT customer_feedback_pkey PRIMARY KEY (id);

ALTER TABLE public.staff_schedules ADD CONSTRAINT staff_schedules_pkey PRIMARY KEY (id);

ALTER TABLE public.services ADD CONSTRAINT services_pkey PRIMARY KEY (id);

ALTER TABLE public.availability_slots ADD CONSTRAINT availability_slots_pkey PRIMARY KEY (id);

ALTER TABLE public.security_audit_log ADD CONSTRAINT security_audit_log_pkey PRIMARY KEY (id);

ALTER TABLE public.sias_campaign_runs ADD CONSTRAINT sias_campaign_runs_pkey PRIMARY KEY (id);

ALTER TABLE public.sias_outcome_attributions ADD CONSTRAINT sias_outcome_attributions_pkey PRIMARY KEY (id);

ALTER TABLE public.sias_operational_memory ADD CONSTRAINT sias_operational_memory_pkey PRIMARY KEY (id);

ALTER TABLE public.tenant_knowledge_articles ADD CONSTRAINT tenant_knowledge_articles_pkey PRIMARY KEY (id);

ALTER TABLE public.logs ADD CONSTRAINT logs_pkey PRIMARY KEY (id);

ALTER TABLE public.bookings ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);

ALTER TABLE public.tenant_users ADD CONSTRAINT tenants_users_pkey PRIMARY KEY (id);

ALTER TABLE public.customers ADD CONSTRAINT customers_pkey PRIMARY KEY (id);

ALTER TABLE public.tenant_reminder_settings ADD CONSTRAINT tenant_reminder_settings_pkey PRIMARY KEY (id);

ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

ALTER TABLE public.reservation_logs ADD CONSTRAINT reservation_logs_pkey PRIMARY KEY (id);

ALTER TABLE public.escalation_queue ADD CONSTRAINT escalation_queue_pkey PRIMARY KEY (id);

ALTER TABLE public.reminders ADD CONSTRAINT reminders_pkey PRIMARY KEY (id);

ALTER TABLE public.reservations ADD CONSTRAINT reservations_pkey PRIMARY KEY (id);

ALTER TABLE public.transactions ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);

ALTER TABLE public.whatsapp_connections ADD CONSTRAINT whatsapp_connections_pkey PRIMARY KEY (id);

ALTER TABLE public.llm_calls ADD CONSTRAINT llm_calls_pkey PRIMARY KEY (id);

ALTER TABLE public.whatsapp_connection_logs ADD CONSTRAINT whatsapp_connection_logs_pkey PRIMARY KEY (id);

ALTER TABLE public.social_mentions ADD CONSTRAINT social_mentions_pkey PRIMARY KEY (id);

ALTER TABLE public.review_flags ADD CONSTRAINT review_flags_pkey PRIMARY KEY (id);

ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_pkey PRIMARY KEY (id);

ALTER TABLE public.staff_services ADD CONSTRAINT staff_services_pkey PRIMARY KEY (tenant_id, staff_user_id, service_id);

ALTER TABLE public.whatsapp_connection_metrics ADD CONSTRAINT whatsapp_connection_metrics_pkey PRIMARY KEY (id);

ALTER TABLE public.message_templates ADD CONSTRAINT message_templates_pkey PRIMARY KEY (id);

ALTER TABLE public.tenant_messaging_stats ADD CONSTRAINT tenant_messaging_stats_pkey PRIMARY KEY (tenant_id);

ALTER TABLE public.whatsapp_number_quality ADD CONSTRAINT whatsapp_number_quality_pkey PRIMARY KEY (phone_number_id);

ALTER TABLE public.platform_settings_kv ADD CONSTRAINT platform_settings_kv_pkey PRIMARY KEY (key);

ALTER TABLE public.whatsapp_message_queue ADD CONSTRAINT whatsapp_message_queue_pkey PRIMARY KEY (id);

ALTER TABLE public.tenants ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);

ALTER TABLE public.offboarding_tasks ADD CONSTRAINT offboarding_tasks_pkey PRIMARY KEY (id);

ALTER TABLE public.calendar_integrations ADD CONSTRAINT calendar_integrations_pkey PRIMARY KEY (id);

ALTER TABLE public.whatsapp_media ADD CONSTRAINT whatsapp_media_pkey PRIMARY KEY (id);

ALTER TABLE public.whatsapp_sessions ADD CONSTRAINT whatsapp_sessions_pkey PRIMARY KEY (id);

ALTER TABLE public.dialog_sessions ADD CONSTRAINT dialog_sessions_pkey PRIMARY KEY (id);

ALTER TABLE public.booking_notifications ADD CONSTRAINT booking_notifications_pkey PRIMARY KEY (id);

ALTER TABLE public.anomaly_detections ADD CONSTRAINT anomaly_detections_pkey PRIMARY KEY (id);

ALTER TABLE public.scheduled_notifications ADD CONSTRAINT scheduled_notifications_pkey PRIMARY KEY (id);

ALTER TABLE public.ml_predictions ADD CONSTRAINT ml_predictions_pkey PRIMARY KEY (id);

ALTER TABLE public.customer_analytics ADD CONSTRAINT customer_analytics_pkey PRIMARY KEY (id);

ALTER TABLE public.revenue_optimizations ADD CONSTRAINT revenue_optimizations_pkey PRIMARY KEY (id);

ALTER TABLE public.module_feature_usage ADD CONSTRAINT module_feature_usage_pkey PRIMARY KEY (id);

ALTER TABLE public.bi_dashboards ADD CONSTRAINT bi_dashboards_pkey PRIMARY KEY (id);

ALTER TABLE public.pii_data_registry ADD CONSTRAINT pii_data_registry_pkey PRIMARY KEY (id);

ALTER TABLE public.security_rules ADD CONSTRAINT security_rules_pkey PRIMARY KEY (id);

ALTER TABLE public.security_violations ADD CONSTRAINT security_violations_pkey PRIMARY KEY (id);

ALTER TABLE public.reservation_services ADD CONSTRAINT reservation_services_pkey PRIMARY KEY (reservation_id, service_id);

ALTER TABLE public.platform_settings ADD CONSTRAINT platform_settings_pkey PRIMARY KEY (id);

ALTER TABLE public.chats ADD CONSTRAINT chats_pkey PRIMARY KEY (id);

ALTER TABLE public.skills ADD CONSTRAINT skills_pkey PRIMARY KEY (id);

ALTER TABLE public.staff_skills ADD CONSTRAINT staff_skills_pkey PRIMARY KEY (tenant_id, user_id, skill_id);

ALTER TABLE public.event_outbox ADD CONSTRAINT event_outbox_pkey PRIMARY KEY (id);

ALTER TABLE public.events ADD CONSTRAINT events_pkey PRIMARY KEY (id);

ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_pkey PRIMARY KEY (id);

ALTER TABLE public.transaction_retries ADD CONSTRAINT transaction_retries_pkey PRIMARY KEY (id);

ALTER TABLE public.tenant_modules ADD CONSTRAINT tenant_modules_pkey PRIMARY KEY (id);

ALTER TABLE public.analytics_metrics_cache ADD CONSTRAINT analytics_metrics_cache_pkey PRIMARY KEY (id);

ALTER TABLE public.reservation_trends ADD CONSTRAINT reservation_trends_pkey PRIMARY KEY (id);

ALTER TABLE public.tenant_tone_profiles ADD CONSTRAINT tenant_tone_profiles_pkey PRIMARY KEY (id);

ALTER TABLE public.event_outbox ADD CONSTRAINT event_outbox_hash_key UNIQUE (hash);

ALTER TABLE public.availability_slots ADD CONSTRAINT availability_slots_tenant_id_staff_id_slot_date_slot_time_d_key UNIQUE (tenant_id, staff_id, slot_date, slot_time, duration_minutes);

ALTER TABLE public.pii_data_registry ADD CONSTRAINT pii_data_registry_table_name_column_name_key UNIQUE (table_name, column_name);

ALTER TABLE public.insights_daily ADD CONSTRAINT insights_daily_tenant_id_date_key UNIQUE (tenant_id, date);

ALTER TABLE public.staff_schedules ADD CONSTRAINT staff_schedules_tenant_id_user_id_day_of_week_key UNIQUE (tenant_id, staff_id, day_of_week);

ALTER TABLE public.social_mentions ADD CONSTRAINT social_mentions_tenant_id_provider_external_id_key UNIQUE (tenant_id, provider, external_id);

ALTER TABLE public.module_feature_usage ADD CONSTRAINT module_feature_usage_tenant_id_module_id_feature_id_key UNIQUE (tenant_id, module_id, feature_id);

ALTER TABLE public.scheduled_notifications ADD CONSTRAINT scheduled_notifications_booking_id_trigger_type_key UNIQUE (booking_id, trigger_type);

ALTER TABLE public.webhook_events ADD CONSTRAINT webhook_events_provider_external_id_key UNIQUE (provider, external_id);

ALTER TABLE public.schedule_overrides ADD CONSTRAINT schedule_overrides_tenant_staff_id_date_key UNIQUE (tenant_staff_id, date);

ALTER TABLE public.customers ADD CONSTRAINT customers_tenant_id_phone_key UNIQUE (tenant_id, phone_number);

ALTER TABLE public.skills ADD CONSTRAINT skills_tenant_id_name_key UNIQUE (tenant_id, name);

ALTER TABLE public.tenants ADD CONSTRAINT tenants_routing_code_key UNIQUE (routing_code);

ALTER TABLE public.whatsapp_sessions ADD CONSTRAINT whatsapp_sessions_tenant_id_phone_number_session_type_key UNIQUE (tenant_id, phone_number, session_type);

ALTER TABLE public.idempotency_keys ADD CONSTRAINT idempotency_keys_tenant_hash_unique UNIQUE (tenant_id, idempotency_hash);

ALTER TABLE public.admins ADD CONSTRAINT admin_email_unique UNIQUE (email);

ALTER TABLE public.transactions ADD CONSTRAINT transactions_provider_reference_unique UNIQUE (provider_reference);

ALTER TABLE public.whatsapp_conversations ADD CONSTRAINT whatsapp_conversations_tenant_id_phone_number_key UNIQUE (tenant_id, phone_number);

ALTER TABLE public.chats ADD CONSTRAINT chats_tenant_phone_unique UNIQUE (tenant_id, customer_phone);

ALTER TABLE public.whatsapp_connection_metrics ADD CONSTRAINT whatsapp_connection_metrics_tenant_id_instance_name_key UNIQUE (tenant_id, instance_name);

ALTER TABLE public.tenants ADD CONSTRAINT tenants_whatsapp_number_id_key UNIQUE (whatsapp_number_id);

ALTER TABLE public.sias_operational_memory ADD CONSTRAINT sias_operational_memory_tenant_id_memory_key_key UNIQUE (tenant_id, memory_key);

ALTER TABLE public.whatsapp_connections ADD CONSTRAINT whatsapp_connections_tenant_id_instance_name_key UNIQUE (tenant_id, instance_name);

ALTER TABLE public.reviews ADD CONSTRAINT unique_review_per_reservation UNIQUE (reservation_id);

ALTER TABLE public.whatsapp_configurations ADD CONSTRAINT whatsapp_configurations_tenant_id_key UNIQUE (tenant_id);

ALTER TABLE public.service_ratings ADD CONSTRAINT unique_service_period UNIQUE (service_id, period_start, period_end, period_type);

ALTER TABLE public.staff_ratings ADD CONSTRAINT unique_staff_period UNIQUE (staff_id, period_start, period_end, period_type);

ALTER TABLE public.tenants ADD CONSTRAINT tenants_email_unique UNIQUE (email);

ALTER TABLE public.jobs ADD CONSTRAINT jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])));

ALTER TABLE public.jobs ADD CONSTRAINT jobs_priority_check CHECK (((priority >= 1) AND (priority <= 10)));

ALTER TABLE public.escalation_queue ADD CONSTRAINT escalation_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'claimed'::text, 'resolved'::text, 'timed_out'::text])));

ALTER TABLE public.reservations ADD CONSTRAINT reservations_status_text_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'completed'::text, 'cancelled'::text])));

ALTER TABLE public.customers ADD CONSTRAINT customers_risk_score_check CHECK ((risk_score = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])));

ALTER TABLE public.tenant_users ADD CONSTRAINT tenant_users_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'staff'::text, 'manager'::text])));

ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_text_check CHECK ((status = ANY (ARRAY['open'::text, 'full'::text, 'cancelled'::text])));

ALTER TABLE public.jobs ADD CONSTRAINT jobs_attempts_nonnegative CHECK ((attempts >= 0));

ALTER TABLE public.transactions ADD CONSTRAINT transactions_reconciliation_status_check CHECK ((reconciliation_status = ANY (ARRAY['pending'::text, 'matched'::text, 'discrepancy'::text, 'manual_review'::text])));

ALTER TABLE public.pii_data_registry ADD CONSTRAINT pii_data_registry_compliance_level_check CHECK ((compliance_level = ANY (ARRAY['public'::text, 'internal'::text, 'confidential'::text, 'restricted'::text])));

ALTER TABLE public.whatsapp_connections ADD CONSTRAINT whatsapp_connections_status_check CHECK ((status = ANY (ARRAY['connected'::text, 'disconnected'::text, 'connecting'::text, 'error'::text, 'reconnecting'::text])));

ALTER TABLE public.pii_data_registry ADD CONSTRAINT pii_data_registry_data_type_check CHECK ((data_type = ANY (ARRAY['email'::text, 'phone'::text, 'name'::text, 'address'::text, 'financial'::text, 'medical'::text, 'other'::text])));

ALTER TABLE public.sias_campaign_runs ADD CONSTRAINT sias_campaign_runs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'completed'::text, 'retry_scheduled'::text, 'failed'::text, 'cancelled'::text])));

ALTER TABLE public.whatsapp_connection_logs ADD CONSTRAINT whatsapp_connection_logs_level_check CHECK ((level = ANY (ARRAY['debug'::text, 'info'::text, 'warn'::text, 'error'::text])));

ALTER TABLE public.analytics_events ADD CONSTRAINT analytics_events_source_check CHECK (((source)::text = ANY ((ARRAY['web'::character varying, 'mobile'::character varying, 'api'::character varying, 'whatsapp'::character varying, 'sms'::character varying])::text[])));

ALTER TABLE public.social_mentions ADD CONSTRAINT social_mentions_status_check CHECK ((status = ANY (ARRAY['new'::text, 'engaged'::text, 'dismissed'::text, 'converted'::text])));

ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check CHECK ((entry_type = ANY (ARRAY['deposit'::text, 'refund'::text, 'fee'::text, 'adjustment'::text])));

ALTER TABLE public.staff_schedules ADD CONSTRAINT staff_schedules_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)));

ALTER TABLE public.review_flags ADD CONSTRAINT review_flags_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'resolved'::text, 'dismissed'::text])));

ALTER TABLE public.customer_feedback ADD CONSTRAINT customer_feedback_score_check CHECK (((score >= 1) AND (score <= 5)));

ALTER TABLE public.security_rules ADD CONSTRAINT security_rules_rule_type_check CHECK ((rule_type = ANY (ARRAY['access_control'::text, 'data_classification'::text, 'audit_trail'::text, 'encryption'::text, 'retention'::text])));

ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_stock_quantity_check CHECK ((stock_quantity >= 0));

ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_price_cents_check CHECK (((price_cents IS NULL) OR (price_cents >= 0)));

ALTER TABLE public.products ADD CONSTRAINT products_stock_quantity_check CHECK ((stock_quantity >= 0));

ALTER TABLE public.security_rules ADD CONSTRAINT security_rules_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])));

ALTER TABLE public.products ADD CONSTRAINT products_price_cents_check CHECK ((price_cents >= 0));

ALTER TABLE public.products ADD CONSTRAINT products_cost_price_cents_check CHECK (((cost_price_cents IS NULL) OR (cost_price_cents >= 0)));

ALTER TABLE public.analytics_events ADD CONSTRAINT analytics_events_event_category_check CHECK (((event_category)::text = ANY ((ARRAY['navigation'::character varying, 'engagement'::character varying, 'conversion'::character varying, 'retention'::character varying])::text[])));

ALTER TABLE public.tenant_cost_ledger ADD CONSTRAINT tenant_cost_ledger_cost_type_check CHECK ((cost_type = ANY (ARRAY['llm'::text, 'whatsapp'::text, 'server'::text, 'payment'::text, 'manual_adjustment'::text])));

ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check CHECK (((status)::text = ANY ((ARRAY['todo'::character varying, 'in_progress'::character varying, 'done'::character varying])::text[])));

ALTER TABLE public.security_violations ADD CONSTRAINT security_violations_status_check CHECK ((status = ANY (ARRAY['open'::text, 'investigating'::text, 'resolved'::text, 'false_positive'::text])));

ALTER TABLE public.tasks ADD CONSTRAINT tasks_priority_check CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying])::text[])));

ALTER TABLE public.service_ratings ADD CONSTRAINT service_ratings_period_type_check CHECK (((period_type)::text = ANY ((ARRAY['week'::character varying, 'month'::character varying, 'quarter'::character varying, 'year'::character varying])::text[])));

ALTER TABLE public.whatsapp_message_queue ADD CONSTRAINT whatsapp_message_queue_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])));

ALTER TABLE public.whatsapp_message_queue ADD CONSTRAINT whatsapp_message_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'retry'::text])));

ALTER TABLE public.tenant_revenue_ledger ADD CONSTRAINT tenant_revenue_ledger_revenue_type_check CHECK ((revenue_type = ANY (ARRAY['wallet_topup'::text, 'usage_charge'::text, 'subscription_charge'::text, 'overage_charge'::text, 'refund'::text, 'manual_adjustment'::text, 'bonus_credit'::text])));

ALTER TABLE public.tenants ADD CONSTRAINT tenants_lifecycle_state_chk CHECK ((lifecycle_state = ANY (ARRAY['active'::text, 'scheduled_for_deletion'::text, 'purging'::text, 'purged'::text])));

ALTER TABLE public.reviews ADD CONSTRAINT reviews_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'published'::character varying, 'hidden'::character varying, 'flagged'::character varying])::text[])));

ALTER TABLE public.tenants ADD CONSTRAINT tenants_whatsapp_status_check CHECK ((whatsapp_status = ANY (ARRAY['connected'::text, 'disconnected'::text, 'pending'::text])));

ALTER TABLE public.reviews ADD CONSTRAINT reviews_staff_rating_check CHECK (((staff_rating >= (1)::numeric) AND (staff_rating <= (5)::numeric)));

ALTER TABLE public.offboarding_tasks ADD CONSTRAINT offboarding_tasks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'done'::text, 'failed'::text, 'skipped'::text])));

ALTER TABLE public.reviews ADD CONSTRAINT reviews_service_rating_check CHECK (((service_rating >= (1)::numeric) AND (service_rating <= (5)::numeric)));

ALTER TABLE public.whatsapp_showcase_pack_items ADD CONSTRAINT whatsapp_showcase_pack_items_item_type_check CHECK ((item_type = ANY (ARRAY['image'::text, 'document'::text, 'video'::text])));

ALTER TABLE public.whatsapp_media ADD CONSTRAINT whatsapp_media_file_type_check CHECK ((file_type = ANY (ARRAY['image'::text, 'document'::text, 'audio'::text, 'video'::text, 'sticker'::text])));

ALTER TABLE public.whatsapp_showcase_packs ADD CONSTRAINT whatsapp_showcase_packs_template_kind_check CHECK ((template_kind = ANY (ARRAY['custom'::text, 'portfolio'::text, 'price_list'::text, 'catalog'::text, 'before_after'::text])));

ALTER TABLE public.analytics_events ADD CONSTRAINT analytics_events_event_type_check CHECK (((event_type)::text = ANY ((ARRAY['page_view'::character varying, 'website_visit'::character varying, 'chat_started'::character varying, 'service_selected'::character varying, 'booking_initiated'::character varying, 'booking_completed'::character varying, 'payment_made'::character varying, 'booking_cancelled'::character varying, 'booking_rescheduled'::character varying, 'review_submitted'::character varying])::text[])));

ALTER TABLE public.whatsapp_sessions ADD CONSTRAINT whatsapp_sessions_session_type_check CHECK ((session_type = ANY (ARRAY['review_collection'::text, 'booking'::text, 'general'::text])));

ALTER TABLE public.alert_rules ADD CONSTRAINT alert_rules_operator_check CHECK ((operator = ANY (ARRAY['gt'::text, 'lt'::text, 'eq'::text, 'gte'::text, 'lte'::text])));

ALTER TABLE public.ai_wallet_ledger ADD CONSTRAINT ai_wallet_ledger_kind_check CHECK ((kind = ANY (ARRAY['topup'::text, 'reservation'::text, 'usage'::text, 'refund'::text, 'adjustment'::text])));

ALTER TABLE public.transaction_retries ADD CONSTRAINT transaction_retries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'success'::text, 'failed'::text])));

ALTER TABLE public.booking_notifications ADD CONSTRAINT booking_notifications_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'sent'::character varying, 'failed'::character varying, 'cancelled'::character varying])::text[])));

ALTER TABLE public.whatsapp_configurations ADD CONSTRAINT whatsapp_configurations_provider_check CHECK ((provider = ANY (ARRAY['evolution'::text, 'waha'::text, 'meta'::text])));

ALTER TABLE public.reviews ADD CONSTRAINT reviews_overall_rating_check CHECK (((overall_rating >= (1)::numeric) AND (overall_rating <= (5)::numeric)));

ALTER TABLE public.messaging_consents ADD CONSTRAINT messaging_consents_channel_check CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'sms'::text, 'email'::text])));

ALTER TABLE public.anomaly_detections ADD CONSTRAINT anomaly_detections_severity_check CHECK (((severity)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying])::text[])));

ALTER TABLE public.whatsapp_provider_secrets ADD CONSTRAINT whatsapp_provider_secrets_provider_check CHECK ((provider = ANY (ARRAY['evolution'::text, 'waha'::text, 'meta'::text, 'instagram'::text])));

ALTER TABLE public.scheduled_notifications ADD CONSTRAINT scheduled_notifications_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'executed'::character varying, 'cancelled'::character varying])::text[])));

ALTER TABLE public.messages ADD CONSTRAINT messages_ai_layer_check CHECK ((ai_layer = ANY (ARRAY['none'::text, 'rules'::text, 'lite'::text, 'flash'::text])));

ALTER TABLE public.staff_ratings ADD CONSTRAINT staff_ratings_period_type_check CHECK (((period_type)::text = ANY ((ARRAY['week'::character varying, 'month'::character varying, 'quarter'::character varying, 'year'::character varying])::text[])));

ALTER TABLE public.whatsapp_conversations ADD CONSTRAINT whatsapp_conversations_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'staff'::text, 'customer'::text, 'unknown'::text])));

ALTER TABLE public.reviews ADD CONSTRAINT reviews_facility_rating_check CHECK (((facility_rating >= (1)::numeric) AND (facility_rating <= (5)::numeric)));

ALTER TABLE public.whatsapp_conversations ADD CONSTRAINT whatsapp_conversations_current_flow_check CHECK ((current_flow = ANY (ARRAY['idle'::text, 'onboarding'::text, 'booking'::text, 'managing'::text])));

ALTER TABLE public.whatsapp_conversations ADD CONSTRAINT whatsapp_conversations_channel_check CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'instagram'::text])));

ALTER TABLE public.ai_wallet_ledger ADD CONSTRAINT ai_wallet_ledger_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.invites ADD CONSTRAINT invites_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE public.customer_feedback ADD CONSTRAINT customer_feedback_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE SET NULL;

ALTER TABLE public.customer_feedback ADD CONSTRAINT customer_feedback_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.staff_schedules ADD CONSTRAINT staff_schedules_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.staff_schedules ADD CONSTRAINT staff_schedules_tenant_user_id_fkey FOREIGN KEY (tenant_user_id) REFERENCES tenant_users(id) ON DELETE CASCADE;

ALTER TABLE public.services ADD CONSTRAINT services_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE public.availability_slots ADD CONSTRAINT availability_slots_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE SET NULL;

ALTER TABLE public.availability_slots ADD CONSTRAINT availability_slots_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.security_audit_log ADD CONSTRAINT security_audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.sias_campaign_runs ADD CONSTRAINT sias_campaign_runs_target_booking_id_fkey FOREIGN KEY (target_booking_id) REFERENCES reservations(id) ON DELETE SET NULL;

ALTER TABLE public.sias_campaign_runs ADD CONSTRAINT sias_campaign_runs_target_customer_id_fkey FOREIGN KEY (target_customer_id) REFERENCES customers(id) ON DELETE SET NULL;

ALTER TABLE public.sias_campaign_runs ADD CONSTRAINT sias_campaign_runs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.sias_outcome_attributions ADD CONSTRAINT sias_outcome_attributions_campaign_run_id_fkey FOREIGN KEY (campaign_run_id) REFERENCES sias_campaign_runs(id) ON DELETE SET NULL;

ALTER TABLE public.sias_outcome_attributions ADD CONSTRAINT sias_outcome_attributions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

ALTER TABLE public.sias_outcome_attributions ADD CONSTRAINT sias_outcome_attributions_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE SET NULL;

ALTER TABLE public.sias_outcome_attributions ADD CONSTRAINT sias_outcome_attributions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.sias_operational_memory ADD CONSTRAINT sias_operational_memory_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.tenant_knowledge_articles ADD CONSTRAINT tenant_knowledge_articles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.bookings ADD CONSTRAINT bookings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE public.tenant_users ADD CONSTRAINT tenants_users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.tenant_users ADD CONSTRAINT tenants_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.customers ADD CONSTRAINT customers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE public.tenant_reminder_settings ADD CONSTRAINT tenant_reminder_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.notifications ADD CONSTRAINT notifications_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.reservation_logs ADD CONSTRAINT reservation_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE public.escalation_queue ADD CONSTRAINT escalation_queue_assigned_agent_id_fkey FOREIGN KEY (assigned_agent_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.escalation_queue ADD CONSTRAINT escalation_queue_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.reminders ADD CONSTRAINT reminders_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE;

ALTER TABLE public.reminders ADD CONSTRAINT reminders_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;

ALTER TABLE public.reservations ADD CONSTRAINT fk_reservations_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

ALTER TABLE public.reservations ADD CONSTRAINT reservations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);

ALTER TABLE public.reservations ADD CONSTRAINT reservations_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL;

ALTER TABLE public.reservations ADD CONSTRAINT reservations_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.reservations ADD CONSTRAINT reservations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE public.reservations ADD CONSTRAINT reservations_tenant_staff_id_fkey FOREIGN KEY (tenant_staff_id) REFERENCES tenant_users(id) ON DELETE SET NULL;

ALTER TABLE public.transactions ADD CONSTRAINT transactions_original_transaction_id_fkey FOREIGN KEY (original_transaction_id) REFERENCES transactions(id);

ALTER TABLE public.whatsapp_connections ADD CONSTRAINT whatsapp_connections_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.llm_calls ADD CONSTRAINT llm_calls_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;

ALTER TABLE public.whatsapp_connection_logs ADD CONSTRAINT whatsapp_connection_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.social_mentions ADD CONSTRAINT social_mentions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.review_flags ADD CONSTRAINT review_flags_review_id_fkey FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE;

ALTER TABLE public.review_flags ADD CONSTRAINT review_flags_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL;

ALTER TABLE public.staff_services ADD CONSTRAINT staff_services_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE;

ALTER TABLE public.staff_services ADD CONSTRAINT staff_services_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.whatsapp_connection_metrics ADD CONSTRAINT whatsapp_connection_metrics_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.whatsapp_message_queue ADD CONSTRAINT whatsapp_message_queue_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.calendar_integrations ADD CONSTRAINT calendar_integrations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.whatsapp_media ADD CONSTRAINT whatsapp_media_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.whatsapp_sessions ADD CONSTRAINT whatsapp_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.booking_notifications ADD CONSTRAINT booking_notifications_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;

ALTER TABLE public.booking_notifications ADD CONSTRAINT booking_notifications_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.booking_notifications ADD CONSTRAINT booking_notifications_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.anomaly_detections ADD CONSTRAINT anomaly_detections_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id);

ALTER TABLE public.anomaly_detections ADD CONSTRAINT anomaly_detections_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.scheduled_notifications ADD CONSTRAINT scheduled_notifications_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;

ALTER TABLE public.scheduled_notifications ADD CONSTRAINT scheduled_notifications_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES booking_notifications(id) ON DELETE CASCADE;

ALTER TABLE public.scheduled_notifications ADD CONSTRAINT scheduled_notifications_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.ml_predictions ADD CONSTRAINT ml_predictions_model_id_fkey FOREIGN KEY (model_id) REFERENCES ml_models(id) ON DELETE CASCADE;

ALTER TABLE public.ml_predictions ADD CONSTRAINT ml_predictions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.customer_analytics ADD CONSTRAINT customer_analytics_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

ALTER TABLE public.customer_analytics ADD CONSTRAINT customer_analytics_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.revenue_optimizations ADD CONSTRAINT revenue_optimizations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.module_feature_usage ADD CONSTRAINT module_feature_usage_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.bi_dashboards ADD CONSTRAINT bi_dashboards_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.bi_dashboards ADD CONSTRAINT bi_dashboards_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.security_violations ADD CONSTRAINT security_violations_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES security_rules(id);

ALTER TABLE public.security_violations ADD CONSTRAINT security_violations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE public.reservation_services ADD CONSTRAINT reservation_services_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);

ALTER TABLE public.reservation_services ADD CONSTRAINT reservation_services_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES reservations(id);

ALTER TABLE public.reservation_services ADD CONSTRAINT reservation_services_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id);

ALTER TABLE public.reservation_services ADD CONSTRAINT reservation_services_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE public.skills ADD CONSTRAINT skills_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.staff_skills ADD CONSTRAINT staff_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE;

ALTER TABLE public.staff_skills ADD CONSTRAINT staff_skills_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id);

ALTER TABLE public.transaction_retries ADD CONSTRAINT transaction_retries_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id);

ALTER TABLE public.tenant_modules ADD CONSTRAINT tenant_modules_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.analytics_metrics_cache ADD CONSTRAINT analytics_metrics_cache_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.reservation_trends ADD CONSTRAINT reservation_trends_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.tenant_tone_profiles ADD CONSTRAINT tenant_tone_profiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.support_messages ADD CONSTRAINT support_messages_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE;

ALTER TABLE public.ml_models ADD CONSTRAINT ml_models_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.performance_metrics ADD CONSTRAINT performance_metrics_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.faqs ADD CONSTRAINT faqs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.analytics_events ADD CONSTRAINT analytics_events_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE SET NULL;

ALTER TABLE public.analytics_events ADD CONSTRAINT analytics_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.analytics_events ADD CONSTRAINT fk_tenant_events FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE public.staff_ratings ADD CONSTRAINT fk_tenant_staff_ratings FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE public.staff_ratings ADD CONSTRAINT staff_ratings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.service_ratings ADD CONSTRAINT fk_tenant_service_ratings FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE public.service_ratings ADD CONSTRAINT service_ratings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.reviews ADD CONSTRAINT fk_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id);

ALTER TABLE public.reviews ADD CONSTRAINT fk_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE public.reviews ADD CONSTRAINT reviews_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE;

ALTER TABLE public.reviews ADD CONSTRAINT reviews_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.tasks ADD CONSTRAINT tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.tasks ADD CONSTRAINT tasks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.jobs ADD CONSTRAINT jobs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES auth.users(id);

ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE public.whatsapp_conversations ADD CONSTRAINT whatsapp_conversations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.tenant_daily_summary ADD CONSTRAINT tenant_daily_summary_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.leads ADD CONSTRAINT leads_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.idempotency_keys ADD CONSTRAINT idempotency_keys_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.messages ADD CONSTRAINT messages_chat_fkey FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE SET NULL;

ALTER TABLE public.messages ADD CONSTRAINT messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.slot_locks ADD CONSTRAINT slot_locks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.slot_locks ADD CONSTRAINT slot_locks_tenant_staff_id_fkey FOREIGN KEY (tenant_staff_id) REFERENCES tenant_users(id) ON DELETE CASCADE;

ALTER TABLE public.schedule_overrides ADD CONSTRAINT schedule_overrides_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.schedule_overrides ADD CONSTRAINT schedule_overrides_tenant_staff_id_fkey FOREIGN KEY (tenant_staff_id) REFERENCES tenant_users(id) ON DELETE CASCADE;

ALTER TABLE public.insights_daily ADD CONSTRAINT insights_daily_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.insights_daily ADD CONSTRAINT insights_daily_top_service_id_fkey FOREIGN KEY (top_service_id) REFERENCES services(id) ON DELETE SET NULL;

ALTER TABLE public.whatsapp_provider_secrets ADD CONSTRAINT whatsapp_provider_secrets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.service_performance_summary ADD CONSTRAINT service_performance_summary_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.staff_performance_summary ADD CONSTRAINT staff_performance_summary_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.availability_snapshot ADD CONSTRAINT availability_snapshot_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.messaging_consents ADD CONSTRAINT messaging_consents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.support_assignments ADD CONSTRAINT support_assignments_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE;

ALTER TABLE public.whatsapp_configurations ADD CONSTRAINT whatsapp_configurations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.ai_training_events ADD CONSTRAINT ai_training_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.ai_front_desk_events ADD CONSTRAINT ai_front_desk_events_campaign_run_id_fkey FOREIGN KEY (campaign_run_id) REFERENCES sias_campaign_runs(id) ON DELETE SET NULL;

ALTER TABLE public.ai_front_desk_events ADD CONSTRAINT ai_front_desk_events_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

ALTER TABLE public.ai_front_desk_events ADD CONSTRAINT ai_front_desk_events_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE SET NULL;

ALTER TABLE public.ai_front_desk_events ADD CONSTRAINT ai_front_desk_events_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL;

ALTER TABLE public.ai_front_desk_events ADD CONSTRAINT ai_front_desk_events_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES tenant_users(id) ON DELETE SET NULL;

ALTER TABLE public.ai_front_desk_events ADD CONSTRAINT ai_front_desk_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.tenant_listening_config ADD CONSTRAINT tenant_listening_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.customer_profile_summary ADD CONSTRAINT customer_profile_summary_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.whatsapp_showcase_packs ADD CONSTRAINT whatsapp_showcase_packs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.ai_wallets ADD CONSTRAINT ai_wallets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.whatsapp_showcase_pack_items ADD CONSTRAINT whatsapp_showcase_pack_items_pack_id_fkey FOREIGN KEY (pack_id) REFERENCES whatsapp_showcase_packs(id) ON DELETE CASCADE;

ALTER TABLE public.whatsapp_showcase_pack_items ADD CONSTRAINT whatsapp_showcase_pack_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.tenant_revenue_ledger ADD CONSTRAINT tenant_revenue_ledger_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.tenant_cost_ledger ADD CONSTRAINT tenant_cost_ledger_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.products ADD CONSTRAINT products_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

CREATE INDEX reservations_tenant_date_idx ON public.reservations USING btree (tenant_id, start_at);

CREATE INDEX bookings_tenant_id_idx ON public.bookings USING btree (tenant_id);

CREATE INDEX messages_convo_idx ON public.messages USING btree (tenant_id, from_number);

CREATE INDEX idx_sias_campaign_runs_tenant_status ON public.sias_campaign_runs USING btree (tenant_id, status, scheduled_for DESC);

CREATE INDEX idx_tenant_modules_tenant_id ON public.tenant_modules USING btree (tenant_id);

CREATE INDEX idx_sias_campaign_runs_retry ON public.sias_campaign_runs USING btree (tenant_id, next_retry_at DESC) WHERE (next_retry_at IS NOT NULL);

CREATE INDEX reservation_logs_tenant_id_idx ON public.reservation_logs USING btree (tenant_id);

CREATE INDEX transactions_tenant_idx ON public.transactions USING btree (tenant_id, status);

CREATE INDEX idx_sias_outcome_attributions_tenant_signal ON public.sias_outcome_attributions USING btree (tenant_id, signal, created_at DESC);

CREATE INDEX idx_sias_outcome_attributions_reservation ON public.sias_outcome_attributions USING btree (reservation_id, created_at DESC);

CREATE INDEX idx_feedback_tenant_staff ON public.customer_feedback USING btree (tenant_id, staff_user_id, created_at DESC);

CREATE INDEX reservations_tenant_id_idx ON public.reservations USING btree (tenant_id);

CREATE INDEX idx_feedback_reservation ON public.customer_feedback USING btree (reservation_id) WHERE (reservation_id IS NOT NULL);

CREATE UNIQUE INDEX uniq_feedback_reservation ON public.customer_feedback USING btree (reservation_id) WHERE (reservation_id IS NOT NULL);

CREATE INDEX idx_sias_operational_memory_tenant_last_seen ON public.sias_operational_memory USING btree (tenant_id, last_seen_at DESC);

CREATE INDEX idx_customers_tenant_id ON public.customers USING btree (tenant_id);

CREATE INDEX idx_services_tenant_id ON public.services USING btree (tenant_id);

CREATE INDEX idx_reservations_tenant_id ON public.reservations USING btree (tenant_id);

CREATE INDEX idx_bookings_tenant_id ON public.bookings USING btree (tenant_id);

CREATE INDEX staff_schedules_tenant_user_idx ON public.staff_schedules USING btree (tenant_id, staff_id);

CREATE INDEX availability_slots_tenant_date_idx ON public.availability_slots USING btree (tenant_id, slot_date, is_available);

CREATE INDEX support_tickets_tenant_id_idx ON public.support_tickets USING btree (tenant_id);

CREATE INDEX availability_slots_staff_date_idx ON public.availability_slots USING btree (staff_id, slot_date, slot_time);

CREATE INDEX security_audit_log_tenant_action_idx ON public.security_audit_log USING btree (tenant_id, action, created_at);

CREATE INDEX idx_tenants_users_tenant_id ON public.tenant_users USING btree (tenant_id);

CREATE INDEX security_violations_status_severity_idx ON public.security_violations USING btree (status, severity, detected_at);

CREATE INDEX jobs_class_priority_idx ON public.jobs USING btree (job_class, priority, status, scheduled_at);

CREATE INDEX jobs_dead_letter_idx ON public.jobs USING btree (dead_letter_at) WHERE (dead_letter_at IS NOT NULL);

CREATE INDEX idx_knowledge_tenant ON public.tenant_knowledge_articles USING btree (tenant_id, is_active);

CREATE INDEX availability_snapshot_tenant_date_idx ON public.availability_snapshot USING btree (tenant_id, date, staff_id, service_id);

CREATE INDEX idx_tenants_users_user_id ON public.tenant_users USING btree (user_id);

CREATE INDEX logs_source_idx ON public.logs USING btree (source);

CREATE INDEX logs_type_idx ON public.logs USING btree (type);

CREATE INDEX idx_reservation_services_tenant_id ON public.reservation_services USING btree (tenant_id);

CREATE INDEX idx_reservation_services_customer_id ON public.reservation_services USING btree (customer_id);

CREATE INDEX idx_reservation_services_tenant_customer ON public.reservation_services USING btree (tenant_id, customer_id);

CREATE UNIQUE INDEX tenant_reminder_settings_tenant_id_uq ON public.tenant_reminder_settings USING btree (tenant_id);

CREATE INDEX tenant_reminder_settings_tenant_idx ON public.tenant_reminder_settings USING btree (tenant_id);

CREATE INDEX notifications_tenant_idx ON public.notifications USING btree (tenant_id);

CREATE INDEX notifications_read_idx ON public.notifications USING btree (read);

CREATE INDEX idx_messages_from_number ON public.messages USING btree (tenant_id, from_number);

CREATE INDEX idx_messages_evolution_id ON public.messages USING btree (evolution_message_id) WHERE (evolution_message_id IS NOT NULL);

CREATE INDEX idx_dialog_sessions_tenant ON public.dialog_sessions USING btree (tenant_id);

CREATE INDEX idx_dialog_sessions_updated ON public.dialog_sessions USING btree (updated_at DESC);

CREATE UNIQUE INDEX tenant_tone_profiles_tenant_id_uq ON public.tenant_tone_profiles USING btree (tenant_id);

CREATE INDEX tenant_tone_profiles_tone_idx ON public.tenant_tone_profiles USING btree (tone);

CREATE INDEX faqs_tenant_idx ON public.faqs USING btree (tenant_id);

CREATE INDEX faqs_question_trgm_idx ON public.faqs USING gin (question gin_trgm_ops);

CREATE UNIQUE INDEX reservation_trends_tenant_date_uq ON public.reservation_trends USING btree (tenant_id, date);

CREATE INDEX reservation_trends_tenant_idx ON public.reservation_trends USING btree (tenant_id);

CREATE INDEX support_messages_ticket_idx ON public.support_messages USING btree (ticket_id);

CREATE INDEX support_assignments_ticket_idx ON public.support_assignments USING btree (ticket_id);

CREATE UNIQUE INDEX uq_wa_conv_channel_external ON public.whatsapp_conversations USING btree (tenant_id, channel, external_id) WHERE (external_id IS NOT NULL);

CREATE INDEX idx_wa_conv_channel_external ON public.whatsapp_conversations USING btree (tenant_id, channel, external_id);

CREATE INDEX idx_transactions_tenant_id ON public.transactions USING btree (tenant_id);

CREATE INDEX idx_reminders_tenant_remind_at ON public.reminders USING btree (tenant_id, remind_at);

CREATE INDEX idx_jobs_status_scheduled ON public.jobs USING btree (status, scheduled_at);

CREATE INDEX idx_escalation_tenant_status ON public.escalation_queue USING btree (tenant_id, status, created_at DESC);

CREATE INDEX idx_whatsapp_cfg_tenant ON public.whatsapp_configurations USING btree (tenant_id);

CREATE UNIQUE INDEX idx_tenants_slug ON public.tenants USING btree (slug) WHERE (slug IS NOT NULL);

CREATE INDEX idx_whatsapp_conn_tenant ON public.whatsapp_connections USING btree (tenant_id);

CREATE INDEX idx_reservation_logs_reservation_id ON public.reservation_logs USING btree (reservation_id);

CREATE INDEX idx_llm_calls_tenant_id ON public.llm_calls USING btree (tenant_id);

CREATE INDEX idx_dialog_sessions_tenant_id ON public.dialog_sessions USING btree (tenant_id);

CREATE INDEX idx_reservation_logs_tenant_id ON public.reservation_logs USING btree (tenant_id);

CREATE INDEX idx_dialog_sessions_updated_at ON public.dialog_sessions USING btree (updated_at);

CREATE INDEX idx_inventory_movements_product ON public.inventory_movements USING btree (product_id, created_at DESC);

CREATE INDEX idx_whatsapp_conv_tenant ON public.whatsapp_conversations USING btree (tenant_id);

CREATE INDEX idx_whatsapp_conv_last_activity ON public.whatsapp_conversations USING btree (tenant_id, last_activity DESC);

CREATE INDEX idx_ai_training_events_tenant_created_at ON public.ai_training_events USING btree (tenant_id, created_at DESC);

CREATE INDEX idx_messages_tenant_chat_created ON public.messages USING btree (tenant_id, chat_id, created_at DESC);

CREATE INDEX idx_messages_tenant_created ON public.messages USING btree (tenant_id, created_at DESC);

CREATE INDEX idx_chats_tenant_customer ON public.chats USING btree (tenant_id, customer_id);

CREATE UNIQUE INDEX uq_provider_sid_tenant ON public.messages USING btree (tenant_id, provider_message_sid) WHERE (provider_message_sid IS NOT NULL);

CREATE UNIQUE INDEX uq_chats_tenant_phone_reservation ON public.chats USING btree (tenant_id, customer_phone, reservation_id);

CREATE INDEX idx_ai_training_events_tenant_intent_created_at ON public.ai_training_events USING btree (tenant_id, intent, created_at DESC);

CREATE INDEX idx_ai_training_events_tenant_success_created_at ON public.ai_training_events USING btree (tenant_id, success, created_at DESC);

CREATE INDEX idx_whatsapp_logs_tenant ON public.whatsapp_connection_logs USING btree (tenant_id, created_at DESC);

CREATE INDEX idx_whatsapp_logs_instance ON public.whatsapp_connection_logs USING btree (instance_name, created_at DESC);

CREATE INDEX idx_inventory_movements_tenant ON public.inventory_movements USING btree (tenant_id);

CREATE INDEX idx_social_mentions_tenant_status ON public.social_mentions USING btree (tenant_id, status, created_at DESC);

CREATE INDEX idx_review_flags_tenant_status ON public.review_flags USING btree (tenant_id, status, created_at DESC);

CREATE INDEX idx_staff_services_tenant ON public.staff_services USING btree (tenant_id);

CREATE INDEX idx_staff_services_service ON public.staff_services USING btree (service_id);

CREATE INDEX idx_staff_services_staff ON public.staff_services USING btree (staff_user_id);

CREATE INDEX idx_inventory_movements_performed_by ON public.inventory_movements USING btree (performed_by) WHERE (performed_by IS NOT NULL);

CREATE INDEX idx_wa_provider_secrets_provider_instance ON public.whatsapp_provider_secrets USING btree (provider, instance_name) WHERE (instance_name IS NOT NULL);

CREATE UNIQUE INDEX uq_message_templates_key ON public.message_templates USING btree (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), message_type, language);

CREATE INDEX idx_whatsapp_metrics_tenant ON public.whatsapp_connection_metrics USING btree (tenant_id);

CREATE INDEX idx_jobs_run_count ON public.jobs USING btree (run_count);

CREATE INDEX idx_webhook_events_created ON public.webhook_events USING btree (created_at DESC);

CREATE INDEX idx_whatsapp_queue_pending ON public.whatsapp_message_queue USING btree (tenant_id, status, created_at) WHERE (status = ANY (ARRAY['pending'::text, 'retry'::text]));

CREATE INDEX idx_tenants_lifecycle_state ON public.tenants USING btree (lifecycle_state);

CREATE INDEX idx_tenants_scheduled_purge_at ON public.tenants USING btree (scheduled_purge_at) WHERE (lifecycle_state = 'scheduled_for_deletion'::text);

CREATE INDEX idx_tenants_financials_purge_at ON public.tenants USING btree (financials_purge_at) WHERE (lifecycle_state = 'purged'::text);

CREATE INDEX skills_tenant_idx ON public.skills USING btree (tenant_id, active);

CREATE INDEX staff_skills_skill_idx ON public.staff_skills USING btree (tenant_id, skill_name);

CREATE INDEX staff_skills_user_idx ON public.staff_skills USING btree (tenant_id, user_id);

CREATE INDEX idx_reservations_staff_id ON public.reservations USING btree (staff_id) WHERE (staff_id IS NOT NULL);

CREATE INDEX idx_reservations_service_id ON public.reservations USING btree (service_id) WHERE (service_id IS NOT NULL);

CREATE INDEX idx_support_tickets_tenant_status ON public.support_tickets USING btree (tenant_id, status, created_at DESC);

CREATE INDEX webhook_events_provider_external_idx ON public.webhook_events USING btree (provider, external_id);

CREATE INDEX event_outbox_undelivered_idx ON public.event_outbox USING btree (created_at) WHERE (delivered_at IS NULL);

CREATE INDEX event_outbox_hash_idx ON public.event_outbox USING btree (hash);

CREATE INDEX events_tenant_type_idx ON public.events USING btree (tenant_id, event, created_at);

CREATE INDEX idx_offboarding_tasks_tenant ON public.offboarding_tasks USING btree (tenant_id);

CREATE INDEX idx_offboarding_tasks_status ON public.offboarding_tasks USING btree (status);

CREATE INDEX transactions_provider_ref_idx ON public.transactions USING btree (provider_reference) WHERE (provider_reference IS NOT NULL);

CREATE INDEX transactions_retry_next_idx ON public.transactions USING btree (next_retry_at) WHERE (next_retry_at IS NOT NULL);

CREATE INDEX transactions_reconciliation_idx ON public.transactions USING btree (reconciliation_status, tenant_id);

CREATE INDEX ledger_entries_tenant_type_idx ON public.ledger_entries USING btree (tenant_id, entry_type, posted_at);

CREATE INDEX transaction_retries_next_attempt_idx ON public.transaction_retries USING btree (next_attempt_at) WHERE (next_attempt_at IS NOT NULL);

CREATE INDEX idx_support_messages_ticket ON public.support_messages USING btree (ticket_id, created_at);

CREATE INDEX idx_support_assignments_ticket ON public.support_assignments USING btree (ticket_id, created_at DESC);

CREATE INDEX idx_reservations_tenant_staff_start_status ON public.reservations USING btree (tenant_id, staff_id, start_at, status);

CREATE INDEX idx_reservations_tenant_status ON public.reservations USING btree (tenant_id, status);

CREATE INDEX idx_messages_tenant_id ON public.messages USING btree (tenant_id);

CREATE INDEX idx_tenant_users_user_tenant ON public.tenant_users USING btree (user_id, tenant_id);

CREATE UNIQUE INDEX idx_reservations_no_exact_duplicates ON public.reservations USING btree (tenant_id, staff_id, start_at, end_at, status) WHERE (status = ANY (ARRAY['pending'::text, 'confirmed'::text]));

CREATE UNIQUE INDEX uq_calendar_integrations_tenant_staff_provider ON public.calendar_integrations USING btree (tenant_id, staff_id, provider);

CREATE INDEX idx_calendar_integrations_tenant ON public.calendar_integrations USING btree (tenant_id);

CREATE INDEX idx_calendar_integrations_calendar_id ON public.calendar_integrations USING btree (calendar_id);

CREATE INDEX idx_whatsapp_media_tenant ON public.whatsapp_media USING btree (tenant_id, created_at DESC);

CREATE INDEX idx_whatsapp_media_message ON public.whatsapp_media USING btree (message_id);

CREATE INDEX idx_whatsapp_sessions_tenant_phone ON public.whatsapp_sessions USING btree (tenant_id, phone_number);

CREATE INDEX idx_whatsapp_conv_active ON public.whatsapp_conversations USING btree (tenant_id, active) WHERE (active = true);

CREATE INDEX idx_analytics_metrics_tenant_period ON public.analytics_metrics_cache USING btree (tenant_id, metric_type, period_start, period_end);

CREATE INDEX idx_analytics_metrics_expires ON public.analytics_metrics_cache USING btree (expires_at);

CREATE INDEX idx_ml_models_tenant_type ON public.ml_models USING btree (tenant_id, model_type, status);

CREATE INDEX idx_ml_predictions_tenant_type ON public.ml_predictions USING btree (tenant_id, prediction_type, created_at);

CREATE INDEX idx_ml_predictions_expires ON public.ml_predictions USING btree (expires_at);

CREATE INDEX idx_anomaly_detections_tenant_status ON public.anomaly_detections USING btree (tenant_id, status, created_at);

CREATE INDEX idx_customer_analytics_tenant_customer ON public.customer_analytics USING btree (tenant_id, customer_id);

CREATE INDEX idx_customer_analytics_expires ON public.customer_analytics USING btree (expires_at);

CREATE INDEX idx_revenue_optimizations_tenant_status ON public.revenue_optimizations USING btree (tenant_id, status, expires_at);

CREATE INDEX idx_module_feature_usage_tenant_module ON public.module_feature_usage USING btree (tenant_id, module_id);

CREATE INDEX idx_performance_metrics_tenant_name ON public.performance_metrics USING btree (tenant_id, metric_name, recorded_at);

CREATE INDEX idx_transactions_raw_reservation_id ON public.transactions USING btree (((raw ->> 'reservation_id'::text))) WHERE ((raw ->> 'reservation_id'::text) IS NOT NULL);

CREATE INDEX tenant_daily_summary_tenant_date_idx ON public.tenant_daily_summary USING btree (tenant_id, date DESC);

CREATE INDEX idx_booking_notifications_booking_id ON public.booking_notifications USING btree (booking_id);

CREATE INDEX idx_booking_notifications_tenant_id ON public.booking_notifications USING btree (tenant_id);

CREATE INDEX idx_booking_notifications_status ON public.booking_notifications USING btree (status);

CREATE INDEX idx_booking_notifications_scheduled_for ON public.booking_notifications USING btree (scheduled_for);

CREATE INDEX idx_booking_notifications_type ON public.booking_notifications USING btree (type);

CREATE INDEX idx_scheduled_notifications_booking_id ON public.scheduled_notifications USING btree (booking_id);

CREATE INDEX idx_scheduled_notifications_tenant_id ON public.scheduled_notifications USING btree (tenant_id);

CREATE INDEX idx_scheduled_notifications_scheduled_for ON public.scheduled_notifications USING btree (scheduled_for);

CREATE INDEX idx_scheduled_notifications_status ON public.scheduled_notifications USING btree (status);

CREATE INDEX idx_scheduled_notifications_trigger_type ON public.scheduled_notifications USING btree (trigger_type);

CREATE INDEX customer_profile_summary_tenant_risk_idx ON public.customer_profile_summary USING btree (tenant_id, risk_score, days_since_visit DESC NULLS LAST);

CREATE INDEX service_performance_summary_tenant_bookings_idx ON public.service_performance_summary USING btree (tenant_id, bookings DESC, revenue DESC);

CREATE INDEX idx_audit_logs_timestamp_event ON public.audit_logs USING btree ("timestamp" DESC, event_type);

CREATE INDEX idx_audit_logs_timestamp ON public.audit_logs USING btree ("timestamp" DESC);

CREATE INDEX idx_audit_logs_user_id ON public.audit_logs USING btree (user_id);

CREATE INDEX idx_audit_logs_tenant_id ON public.audit_logs USING btree (tenant_id);

CREATE INDEX idx_audit_logs_event_type ON public.audit_logs USING btree (event_type);

CREATE INDEX idx_audit_logs_security_level ON public.audit_logs USING btree (security_level);

CREATE INDEX idx_audit_logs_compliance_flags ON public.audit_logs USING gin (compliance_flags);

CREATE INDEX idx_reviews_tenant_id ON public.reviews USING btree (tenant_id);

CREATE INDEX idx_reviews_reservation_id ON public.reviews USING btree (reservation_id);

CREATE INDEX idx_reviews_customer_id ON public.reviews USING btree (customer_id);

CREATE INDEX idx_reviews_staff_id ON public.reviews USING btree (staff_id);

CREATE INDEX idx_reviews_created_at ON public.reviews USING btree (created_at);

CREATE INDEX idx_reviews_rating ON public.reviews USING btree (overall_rating);

CREATE INDEX idx_reviews_status ON public.reviews USING btree (status);

CREATE INDEX idx_staff_ratings_tenant_id ON public.staff_ratings USING btree (tenant_id);

CREATE INDEX idx_staff_ratings_staff_id ON public.staff_ratings USING btree (staff_id);

CREATE INDEX idx_staff_ratings_period ON public.staff_ratings USING btree (period_start, period_end);

CREATE INDEX idx_service_ratings_tenant_id ON public.service_ratings USING btree (tenant_id);

CREATE INDEX idx_audit_logs_user_tenant ON public.audit_logs USING btree (user_id, tenant_id);

CREATE INDEX idx_audit_logs_violations ON public.audit_logs USING btree ("timestamp" DESC) WHERE (event_type = 'security_violation'::text);

CREATE INDEX idx_audit_logs_critical ON public.audit_logs USING btree ("timestamp" DESC) WHERE (security_level = 'critical'::text);

CREATE INDEX idx_audit_logs_failed_access ON public.audit_logs USING btree ("timestamp" DESC, user_id, ip_address) WHERE ((result ->> 'status'::text) = 'failure'::text);

CREATE INDEX idx_audit_logs_compliance_period ON public.audit_logs USING btree (compliance_flags, "timestamp" DESC) WHERE (array_length(compliance_flags, 1) > 0);

CREATE INDEX idx_audit_logs_tenant_period ON public.audit_logs USING btree (tenant_id, "timestamp" DESC);

CREATE INDEX idx_audit_logs_context_gin ON public.audit_logs USING gin (context);

CREATE INDEX idx_audit_logs_result_gin ON public.audit_logs USING gin (result);

CREATE INDEX idx_service_ratings_service_id ON public.service_ratings USING btree (service_id);

CREATE INDEX idx_service_ratings_period ON public.service_ratings USING btree (period_start, period_end);

CREATE INDEX idx_analytics_events_tenant_id ON public.analytics_events USING btree (tenant_id);

CREATE INDEX idx_analytics_events_type ON public.analytics_events USING btree (event_type);

CREATE INDEX idx_analytics_events_session ON public.analytics_events USING btree (session_id);

CREATE INDEX idx_analytics_events_customer ON public.analytics_events USING btree (customer_id);

CREATE INDEX idx_analytics_events_created_at ON public.analytics_events USING btree (created_at);

CREATE INDEX idx_analytics_events_reservation ON public.analytics_events USING btree (reservation_id);

CREATE INDEX idx_faqs_tenant_id ON public.faqs USING btree (tenant_id);

CREATE INDEX idx_faqs_tenant_active ON public.faqs USING btree (tenant_id, is_active);

CREATE UNIQUE INDEX idx_audit_analytics_unique ON public.audit_analytics USING btree (tenant_id, hour, event_type, security_level);

CREATE INDEX idx_jobs_priority_scheduled ON public.jobs USING btree (status, priority DESC, scheduled_at) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));

CREATE INDEX idx_reviews_tenant_published ON public.reviews USING btree (tenant_id, is_published);

CREATE UNIQUE INDEX uidx_reviews_tenant_reservation ON public.reviews USING btree (tenant_id, reservation_id) WHERE (reservation_id IS NOT NULL);

CREATE INDEX idx_tasks_tenant_id ON public.tasks USING btree (tenant_id);

CREATE INDEX idx_tasks_tenant_status ON public.tasks USING btree (tenant_id, status);

CREATE INDEX staff_performance_summary_tenant_bookings_idx ON public.staff_performance_summary USING btree (tenant_id, bookings DESC, estimated_revenue DESC);

CREATE INDEX idx_cron_locks_locked_until ON public.cron_locks USING btree (locked_until);

CREATE INDEX leads_tenant_id_idx ON public.leads USING btree (tenant_id);

CREATE INDEX leads_status_follow_up_idx ON public.leads USING btree (status, follow_up_at) WHERE ((status = 'new'::text) AND (follow_up_at IS NOT NULL));

CREATE INDEX idx_chats_tenant_last_msg ON public.chats USING btree (tenant_id, last_message_at DESC);

CREATE INDEX idx_transactions_reservation_deposit ON public.transactions USING btree (((raw ->> 'reservation_id'::text)), tenant_id, type, status) WHERE ((type = 'deposit'::text) AND (status = ANY (ARRAY['pending'::text, 'success'::text])));

CREATE INDEX idx_messages_chat_id ON public.messages USING btree (chat_id) WHERE (chat_id IS NOT NULL);

CREATE UNIQUE INDEX uq_whatsapp_cfg_evolution_instance_active ON public.whatsapp_configurations USING btree (instance_name) WHERE ((provider = 'evolution'::text) AND (active = true));

CREATE UNIQUE INDEX uq_whatsapp_cfg_waha_endpoint_session_active ON public.whatsapp_configurations USING btree (provider_base_url, instance_name) WHERE ((provider = 'waha'::text) AND (active = true));

CREATE INDEX idx_whatsapp_cfg_instance ON public.whatsapp_configurations USING btree (instance_name);

CREATE UNIQUE INDEX uq_whatsapp_cfg_meta_phone_active ON public.whatsapp_configurations USING btree (meta_phone_number_id) WHERE ((provider = 'meta'::text) AND (active = true) AND (meta_phone_number_id IS NOT NULL));

CREATE INDEX idx_whatsapp_cfg_meta_phone ON public.whatsapp_configurations USING btree (meta_phone_number_id);

CREATE INDEX ai_training_events_tenant_created_idx ON public.ai_training_events USING btree (tenant_id, created_at DESC);

CREATE INDEX ai_training_events_tenant_intent_idx ON public.ai_training_events USING btree (tenant_id, intent, created_at DESC);

CREATE INDEX idx_ai_front_desk_events_tenant_created ON public.ai_front_desk_events USING btree (tenant_id, created_at DESC);

CREATE INDEX idx_ai_front_desk_events_tenant_type_created ON public.ai_front_desk_events USING btree (tenant_id, event_type, created_at DESC);

CREATE INDEX idx_ai_front_desk_events_tenant_category_created ON public.ai_front_desk_events USING btree (tenant_id, event_category, created_at DESC);

CREATE INDEX idx_ai_front_desk_events_tenant_customer_created ON public.ai_front_desk_events USING btree (tenant_id, customer_id, created_at DESC) WHERE (customer_id IS NOT NULL);

CREATE UNIQUE INDEX customers_tenant_phone_key ON public.customers USING btree (tenant_id, phone);

CREATE UNIQUE INDEX customers_tenant_phone_number_key ON public.customers USING btree (tenant_id, phone_number);

CREATE INDEX idx_alert_rules_enabled ON public.alert_rules USING btree (enabled);

CREATE INDEX customers_tenant_email_idx ON public.customers USING btree (tenant_id, email);

CREATE INDEX idx_ai_wallet_ledger_tenant_created_at ON public.ai_wallet_ledger USING btree (tenant_id, created_at DESC);

CREATE INDEX idx_whatsapp_showcase_packs_tenant_active ON public.whatsapp_showcase_packs USING btree (tenant_id, active, sort_order, created_at DESC);

CREATE UNIQUE INDEX idx_whatsapp_showcase_packs_tenant_slug ON public.whatsapp_showcase_packs USING btree (tenant_id, slug) WHERE (slug <> ''::text);

CREATE INDEX idx_whatsapp_showcase_pack_items_pack ON public.whatsapp_showcase_pack_items USING btree (pack_id, active, sort_order, created_at DESC);

CREATE INDEX idx_tenant_revenue_ledger_tenant_created_at ON public.tenant_revenue_ledger USING btree (tenant_id, created_at DESC);

CREATE INDEX idx_tenant_cost_ledger_tenant_created_at ON public.tenant_cost_ledger USING btree (tenant_id, created_at DESC);

CREATE UNIQUE INDEX idx_tenant_revenue_ledger_unique_ref ON public.tenant_revenue_ledger USING btree (tenant_id, revenue_type, reference) WHERE (reference IS NOT NULL);

CREATE UNIQUE INDEX idx_tenant_cost_ledger_unique_ref ON public.tenant_cost_ledger USING btree (tenant_id, cost_type, reference) WHERE (reference IS NOT NULL);

CREATE INDEX idx_products_tenant ON public.products USING btree (tenant_id);

CREATE INDEX idx_products_tenant_active ON public.products USING btree (tenant_id, is_featured DESC, name) WHERE (is_active = true);

CREATE UNIQUE INDEX idx_products_tenant_sku ON public.products USING btree (tenant_id, sku) WHERE (sku IS NOT NULL);

CREATE INDEX idx_product_variants_product ON public.product_variants USING btree (product_id);

CREATE OR REPLACE VIEW public.customer_service_history_view AS  SELECT r.tenant_id,
    r.customer_id,
    COALESCE(c.name, c.customer_name) AS customer_name,
    COALESCE(c.phone, c.phone_number) AS customer_phone,
    r.service_id,
    s.name AS service_name,
    count(*)::integer AS booking_count,
    count(*) FILTER (WHERE r.status = 'completed'::text)::integer AS completed_count,
    count(*) FILTER (WHERE r.status = 'cancelled'::text)::integer AS cancelled_count,
    count(*) FILTER (WHERE r.status = 'no_show'::text)::integer AS no_show_count,
    max(r.start_at) AS last_booking_at,
    max(r.start_at) FILTER (WHERE r.status = 'completed'::text) AS last_completed_at,
    COALESCE(sum(
        CASE
            WHEN r.status = 'completed'::text THEN COALESCE(s.price, 0::numeric)
            ELSE 0::numeric
        END), 0::numeric)::numeric(12,2) AS estimated_revenue
   FROM reservations r
     LEFT JOIN customers c ON c.id = r.customer_id AND c.tenant_id = r.tenant_id
     LEFT JOIN services s ON s.id = r.service_id AND s.tenant_id = r.tenant_id
  WHERE r.customer_id IS NOT NULL
  GROUP BY r.tenant_id, r.customer_id, (COALESCE(c.name, c.customer_name)), (COALESCE(c.phone, c.phone_number)), r.service_id, s.name;

CREATE OR REPLACE VIEW public.staff_customer_history_view AS  SELECT r.tenant_id,
    COALESCE(r.tenant_staff_id, tu.id, r.staff_id) AS staff_id,
    COALESCE(tu.name, tu.phone, COALESCE(r.tenant_staff_id, r.staff_id)::text) AS staff_name,
    r.customer_id,
    COALESCE(c.name, c.customer_name) AS customer_name,
    COALESCE(c.phone, c.phone_number) AS customer_phone,
    count(*)::integer AS booking_count,
    count(*) FILTER (WHERE r.status = 'completed'::text)::integer AS completed_count,
    count(*) FILTER (WHERE r.status = 'cancelled'::text)::integer AS cancelled_count,
    count(*) FILTER (WHERE r.status = 'no_show'::text)::integer AS no_show_count,
    max(r.start_at) AS last_booking_at,
    max(r.start_at) FILTER (WHERE r.status = 'completed'::text) AS last_completed_at
   FROM reservations r
     LEFT JOIN customers c ON c.id = r.customer_id AND c.tenant_id = r.tenant_id
     LEFT JOIN tenant_users tu ON (tu.id = r.tenant_staff_id OR r.tenant_staff_id IS NULL AND tu.user_id = r.staff_id) AND tu.tenant_id = r.tenant_id
  WHERE r.customer_id IS NOT NULL AND COALESCE(r.tenant_staff_id, r.staff_id) IS NOT NULL
  GROUP BY r.tenant_id, (COALESCE(r.tenant_staff_id, tu.id, r.staff_id)), (COALESCE(tu.name, tu.phone, COALESCE(r.tenant_staff_id, r.staff_id)::text)), r.customer_id, (COALESCE(c.name, c.customer_name)), (COALESCE(c.phone, c.phone_number));

CREATE OR REPLACE VIEW public.support AS  SELECT t.id,
    t.tenant_id,
    t.subject,
    t.description,
    t.status,
    t.created_at,
    t.priority,
    t.escalated,
    t.escalated_at,
    t.escalated_by,
    t.assignee_id,
    t.metadata,
    t.updated_at,
    m.last_message,
    m.last_message_at,
    m.internal_notes_count
   FROM support_tickets t
     LEFT JOIN ( SELECT support_messages.ticket_id,
            (array_agg(support_messages.body ORDER BY support_messages.created_at DESC))[1] AS last_message,
            max(support_messages.created_at) AS last_message_at,
            sum(
                CASE
                    WHEN support_messages.is_internal THEN 1
                    ELSE 0
                END) AS internal_notes_count
           FROM support_messages
          GROUP BY support_messages.ticket_id) m ON m.ticket_id = t.id;

CREATE OR REPLACE VIEW public.vw_reservations_with_customer AS  SELECT r.id,
    r.tenant_id,
    r.date,
    r."time",
    r.notes,
    r.created_at,
    r.customer_id,
    r.booking_id,
    r.status,
    r.duration,
    r.calendar_sent,
    r.reminder_sent,
    r.customer_number,
    r.start_at,
    r.end_at,
    r.metadata,
    c.customer_name,
    c.phone_number
   FROM reservations r
     LEFT JOIN customers c ON r.customer_id = c.id;

CREATE OR REPLACE VIEW public.followup_candidates_view AS  WITH customer_future_bookings AS (
         SELECT reservations.tenant_id,
            reservations.customer_id,
            min(reservations.start_at) AS next_booking_at
           FROM reservations
          WHERE reservations.customer_id IS NOT NULL AND (reservations.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text])) AND reservations.start_at > now()
          GROUP BY reservations.tenant_id, reservations.customer_id
        )
 SELECT cps.tenant_id,
    cps.customer_id,
    COALESCE(c.name, c.customer_name) AS customer_name,
    COALESCE(c.phone, c.phone_number) AS customer_phone,
    cps.lifetime_bookings,
    cps.last_visit,
    cps.favorite_service,
    cps.favorite_staff,
    cps.days_since_visit,
    cps.risk_score,
    cfb.next_booking_at,
        CASE
            WHEN cfb.next_booking_at IS NOT NULL THEN false
            WHEN cps.last_visit IS NULL THEN false
            WHEN cps.days_since_visit IS NULL THEN false
            WHEN cps.days_since_visit >= 90 THEN true
            WHEN cps.days_since_visit >= 45 AND (cps.risk_score = ANY (ARRAY['medium'::text, 'high'::text])) THEN true
            ELSE false
        END AS is_followup_candidate,
        CASE
            WHEN cfb.next_booking_at IS NOT NULL THEN 'has_future_booking'::text
            WHEN cps.last_visit IS NULL THEN 'no_completed_visit'::text
            WHEN cps.days_since_visit >= 90 THEN 'inactive_90_plus_days'::text
            WHEN cps.days_since_visit >= 45 AND (cps.risk_score = ANY (ARRAY['medium'::text, 'high'::text])) THEN 'at_risk_lapsed'::text
            ELSE 'not_due'::text
        END AS candidate_reason
   FROM customer_profile_summary cps
     LEFT JOIN customers c ON c.id = cps.customer_id AND c.tenant_id = cps.tenant_id
     LEFT JOIN customer_future_bookings cfb ON cfb.customer_id = cps.customer_id AND cfb.tenant_id = cps.tenant_id
  WHERE cps.last_visit IS NOT NULL;

CREATE OR REPLACE VIEW public.tenant_revenue_view AS  SELECT r.tenant_id,
    date_trunc('day'::text, r.start_at)::date AS booking_date,
    r.service_id,
    s.name AS service_name,
    COALESCE(r.tenant_staff_id, tu.id, r.staff_id) AS staff_id,
    COALESCE(tu.name, tu.phone, COALESCE(r.tenant_staff_id, r.staff_id)::text) AS staff_name,
    r.customer_id,
    COALESCE(c.name, c.customer_name) AS customer_name,
    COALESCE(c.phone, c.phone_number) AS customer_phone,
    count(*)::integer AS booking_count,
    count(*) FILTER (WHERE r.status = 'completed'::text)::integer AS completed_count,
    count(*) FILTER (WHERE r.status = 'cancelled'::text)::integer AS cancelled_count,
    count(*) FILTER (WHERE r.status = 'no_show'::text)::integer AS no_show_count,
    COALESCE(sum(
        CASE
            WHEN r.status = 'completed'::text THEN COALESCE(s.price, 0::numeric)
            ELSE 0::numeric
        END), 0::numeric)::numeric(12,2) AS estimated_revenue
   FROM reservations r
     LEFT JOIN services s ON s.id = r.service_id AND s.tenant_id = r.tenant_id
     LEFT JOIN customers c ON c.id = r.customer_id AND c.tenant_id = r.tenant_id
     LEFT JOIN tenant_users tu ON (tu.id = r.tenant_staff_id OR r.tenant_staff_id IS NULL AND tu.user_id = r.staff_id) AND tu.tenant_id = r.tenant_id
  GROUP BY r.tenant_id, (date_trunc('day'::text, r.start_at)::date), r.service_id, s.name, (COALESCE(r.tenant_staff_id, tu.id, r.staff_id)), (COALESCE(tu.name, tu.phone, COALESCE(r.tenant_staff_id, r.staff_id)::text)), r.customer_id, (COALESCE(c.name, c.customer_name)), (COALESCE(c.phone, c.phone_number));

CREATE OR REPLACE VIEW public.ai_training_event_daily_summary_view AS  SELECT ai_training_events.tenant_id,
    date_trunc('day'::text, ai_training_events.created_at)::date AS event_date,
    COALESCE(ai_training_events.channel, 'unknown'::text) AS channel,
    COALESCE(ai_training_events.user_role, 'unknown'::text) AS user_role,
    COALESCE(ai_training_events.intent, 'unknown'::text) AS intent,
    count(*)::integer AS total_events,
    count(*) FILTER (WHERE ai_training_events.success IS TRUE)::integer AS success_count,
    count(*) FILTER (WHERE ai_training_events.success IS FALSE)::integer AS failure_count,
    count(*) FILTER (WHERE ai_training_events.correction IS NOT NULL AND btrim(ai_training_events.correction) <> ''::text)::integer AS correction_count,
    count(*) FILTER (WHERE ai_training_events.backend_action IS NOT NULL AND btrim(ai_training_events.backend_action) <> ''::text)::integer AS backend_action_count
   FROM ai_training_events
  GROUP BY ai_training_events.tenant_id, (date_trunc('day'::text, ai_training_events.created_at)::date), (COALESCE(ai_training_events.channel, 'unknown'::text)), (COALESCE(ai_training_events.user_role, 'unknown'::text)), (COALESCE(ai_training_events.intent, 'unknown'::text));

CREATE OR REPLACE VIEW public.ai_training_capture_health_view AS  SELECT e.tenant_id,
    t.name AS tenant_name,
    count(*)::integer AS total_events,
    min(e.created_at) AS first_event_at,
    max(e.created_at) AS last_event_at,
    count(*) FILTER (WHERE e.created_at >= (now() - '7 days'::interval))::integer AS events_last_7d,
    count(*) FILTER (WHERE e.success IS TRUE)::integer AS successful_events,
    count(*) FILTER (WHERE e.success IS FALSE)::integer AS failed_events,
    count(*) FILTER (WHERE e.intent IS NULL OR btrim(e.intent) = ''::text)::integer AS missing_intent_events,
    count(*) FILTER (WHERE e.backend_action IS NULL OR btrim(e.backend_action) = ''::text)::integer AS missing_backend_action_events,
    count(*) FILTER (WHERE e.correction IS NOT NULL AND btrim(e.correction) <> ''::text)::integer AS corrected_events,
        CASE
            WHEN count(*) = 0 THEN 0::numeric
            ELSE round(count(*) FILTER (WHERE e.success IS TRUE)::numeric / count(*)::numeric * 100::numeric, 2)
        END AS success_rate_percent
   FROM ai_training_events e
     LEFT JOIN tenants t ON t.id = e.tenant_id
  GROUP BY e.tenant_id, t.name;

CREATE OR REPLACE VIEW public.ai_training_failure_review_view AS  SELECT ai_training_events.id,
    ai_training_events.tenant_id,
    ai_training_events.created_at,
    ai_training_events.channel,
    ai_training_events.user_role,
    ai_training_events.intent,
    ai_training_events.backend_action,
    ai_training_events.success,
    ai_training_events.correction,
    ai_training_events.message,
    ai_training_events.grounded_context,
    ai_training_events.llm_response
   FROM ai_training_events
  WHERE ai_training_events.success IS FALSE OR ai_training_events.correction IS NOT NULL AND btrim(ai_training_events.correction) <> ''::text OR ai_training_events.intent IS NULL OR ai_training_events.backend_action IS NULL;

CREATE OR REPLACE VIEW public.security_dashboard AS  SELECT date_trunc('day'::text, audit_logs."timestamp") AS date,
    audit_logs.tenant_id,
    count(*) AS total_events,
    count(
        CASE
            WHEN audit_logs.event_type = 'security_violation'::text THEN 1
            ELSE NULL::integer
        END) AS violations,
    count(
        CASE
            WHEN audit_logs.security_level = 'critical'::text THEN 1
            ELSE NULL::integer
        END) AS critical_events,
    count(
        CASE
            WHEN (audit_logs.result ->> 'status'::text) = 'failure'::text THEN 1
            ELSE NULL::integer
        END) AS failed_access,
    count(DISTINCT audit_logs.user_id) AS unique_users,
    count(DISTINCT audit_logs.ip_address) AS unique_ips,
    avg((audit_logs.result ->> 'securityScore'::text)::numeric) AS avg_security_score
   FROM audit_logs
  WHERE audit_logs."timestamp" >= (CURRENT_DATE - '30 days'::interval)
  GROUP BY (date_trunc('day'::text, audit_logs."timestamp")), audit_logs.tenant_id
  ORDER BY (date_trunc('day'::text, audit_logs."timestamp")) DESC;

CREATE OR REPLACE VIEW public.ai_front_desk_offer_performance_view AS  SELECT ai_front_desk_events.tenant_id,
    ai_front_desk_events.event_type,
    date((ai_front_desk_events.created_at AT TIME ZONE 'utc'::text)) AS event_date,
    count(*) AS event_count,
    sum(COALESCE(ai_front_desk_events.amount, 0::numeric)) AS amount_total
   FROM ai_front_desk_events
  WHERE ai_front_desk_events.event_type = ANY (ARRAY['offer_sent'::text, 'upsell_sent'::text, 'cross_sell_sent'::text, 'recommendation_sent'::text, 'catalog_sent'::text, 'showcase_sent'::text])
  GROUP BY ai_front_desk_events.tenant_id, ai_front_desk_events.event_type, (date((ai_front_desk_events.created_at AT TIME ZONE 'utc'::text)));

CREATE OR REPLACE VIEW public.ai_front_desk_funnel_daily_view AS  SELECT ai_front_desk_events.tenant_id,
    date((ai_front_desk_events.created_at AT TIME ZONE 'utc'::text)) AS event_date,
    count(*) FILTER (WHERE ai_front_desk_events.event_type = 'inquiry_received'::text) AS inquiries,
    count(*) FILTER (WHERE ai_front_desk_events.event_type = ANY (ARRAY['lead_created'::text, 'lead_qualified'::text])) AS qualified_leads,
    count(*) FILTER (WHERE ai_front_desk_events.event_type = 'quote_sent'::text) AS quotes_sent,
    count(*) FILTER (WHERE ai_front_desk_events.event_type = 'booking_created'::text) AS bookings_created,
    count(*) FILTER (WHERE ai_front_desk_events.event_type = 'payment_completed'::text) AS payments_completed,
    count(*) FILTER (WHERE ai_front_desk_events.event_type = ANY (ARRAY['follow_up_scheduled'::text, 'follow_up_sent'::text, 'recovery_sent'::text])) AS recovery_touches
   FROM ai_front_desk_events
  GROUP BY ai_front_desk_events.tenant_id, (date((ai_front_desk_events.created_at AT TIME ZONE 'utc'::text)));

CREATE OR REPLACE VIEW public.ai_front_desk_followup_pipeline_view AS  SELECT ai_front_desk_events.tenant_id,
    date((ai_front_desk_events.created_at AT TIME ZONE 'utc'::text)) AS event_date,
    count(*) FILTER (WHERE ai_front_desk_events.event_type = 'follow_up_scheduled'::text) AS followups_scheduled,
    count(*) FILTER (WHERE ai_front_desk_events.event_type = 'follow_up_sent'::text) AS followups_sent,
    count(*) FILTER (WHERE ai_front_desk_events.event_type = 'recovery_sent'::text) AS recovery_sent,
    count(*) FILTER (WHERE ai_front_desk_events.event_type = 'handoff_requested'::text) AS handoffs_requested
   FROM ai_front_desk_events
  WHERE ai_front_desk_events.event_type = ANY (ARRAY['follow_up_scheduled'::text, 'follow_up_sent'::text, 'recovery_sent'::text, 'handoff_requested'::text])
  GROUP BY ai_front_desk_events.tenant_id, (date((ai_front_desk_events.created_at AT TIME ZONE 'utc'::text)));

CREATE OR REPLACE VIEW public.ai_front_desk_revenue_attribution_view AS  SELECT ai_front_desk_events.tenant_id,
    date((ai_front_desk_events.created_at AT TIME ZONE 'utc'::text)) AS event_date,
    count(*) FILTER (WHERE ai_front_desk_events.event_type = 'booking_created'::text) AS bookings_created,
    count(*) FILTER (WHERE ai_front_desk_events.event_type = 'payment_completed'::text) AS payments_completed,
    sum(
        CASE
            WHEN ai_front_desk_events.event_type = 'booking_created'::text THEN COALESCE(ai_front_desk_events.amount, 0::numeric)
            ELSE 0::numeric
        END) AS booked_revenue,
    sum(
        CASE
            WHEN ai_front_desk_events.event_type = 'payment_completed'::text THEN COALESCE(ai_front_desk_events.amount, 0::numeric)
            ELSE 0::numeric
        END) AS paid_revenue
   FROM ai_front_desk_events
  WHERE ai_front_desk_events.event_type = ANY (ARRAY['booking_created'::text, 'payment_completed'::text])
  GROUP BY ai_front_desk_events.tenant_id, (date((ai_front_desk_events.created_at AT TIME ZONE 'utc'::text)));

CREATE TRIGGER trigger_check_reservation_service_tenant BEFORE INSERT OR UPDATE ON public.reservation_services FOR EACH ROW EXECUTE FUNCTION check_reservation_service_tenant();

CREATE TRIGGER logs_updated_at BEFORE UPDATE ON public.logs FOR EACH ROW EXECUTE FUNCTION ts_update_updated_at();

CREATE TRIGGER tenant_reminder_settings_updated_at BEFORE UPDATE ON public.tenant_reminder_settings FOR EACH ROW EXECUTE FUNCTION ts_update_updated_at();

CREATE TRIGGER notifications_updated_at BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION ts_update_updated_at();

CREATE TRIGGER tenant_tone_profiles_updated_at BEFORE UPDATE ON public.tenant_tone_profiles FOR EACH ROW EXECUTE FUNCTION ts_update_updated_at();

CREATE TRIGGER faqs_updated_at BEFORE UPDATE ON public.faqs FOR EACH ROW EXECUTE FUNCTION ts_update_updated_at();

CREATE TRIGGER reservation_trends_updated_at BEFORE UPDATE ON public.reservation_trends FOR EACH ROW EXECUTE FUNCTION ts_update_updated_at();

CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER jobs_set_timestamp BEFORE INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION jobs_set_timestamp();

CREATE TRIGGER tg_increment_chat_unread AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION increment_chat_unread();

CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_booking_notifications_updated_at BEFORE UPDATE ON public.booking_notifications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scheduled_notifications_updated_at BEFORE UPDATE ON public.scheduled_notifications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_reviews_updated_at BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION update_reviews_updated_at();

CREATE TRIGGER trigger_update_availability AFTER INSERT OR DELETE OR UPDATE ON public.reservations FOR EACH ROW EXECUTE FUNCTION update_availability_on_reservation_change();

CREATE TRIGGER update_staff_schedules_updated_at BEFORE UPDATE ON public.staff_schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_availability_slots_updated_at BEFORE UPDATE ON public.availability_slots FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_security_rules_updated_at BEFORE UPDATE ON public.security_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_customer_analytics_on_booking AFTER INSERT OR UPDATE ON public.reservations FOR EACH ROW EXECUTE FUNCTION update_customer_analytics_on_booking();

CREATE TRIGGER trg_dialog_sessions_touch BEFORE UPDATE ON public.dialog_sessions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER trigger_notify_critical_security_event AFTER INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION notify_critical_security_event();

CREATE TRIGGER trg_sync_customer_compat_columns BEFORE INSERT OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION sync_customer_compat_columns();
