-- ============================================================================
-- Booka — create tables the code references but the deployed schema is missing
-- Generated 2026-07-24 from a live-DB sweep of every .from() call in src/.
--
-- SAFE TO REVIEW & RUN IN THE SUPABASE SQL EDITOR. It only CREATEs new tables
-- (IF NOT EXISTS) + indexes + RLS policies. It does NOT alter or drop anything.
--
-- RLS: every tenant-scoped table gets RLS enabled + a tenant-isolation policy.
--   * Your server uses the SERVICE ROLE (admin client), which BYPASSES RLS, so
--     all existing writes keep working unchanged.
--   * Authenticated (bearer) access is scoped to the user's own tenant via
--     tenant_users. Non-tenant/admin tables get RLS enabled with NO policy,
--     meaning only the service role can touch them.
--
-- SKIPPED (covered by PostHog/Sentry or redundant):
--   traces, error_logs, alert_events, business_metrics, system_metrics
--   (observability -> Sentry + PostHog), templates (per product decision),
--   staff (the app's staff ARE tenant_users).
--
-- Columns marked "-- review" were inferred from typed spread-inserts; adjust if
-- a write fails on first use (trivial ALTER; all columns are nullable).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- AI usage & billing metering
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.llm_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid,
  provider text,
  model text,
  operation text,
  input_tokens integer DEFAULT 0,
  output_tokens integer DEFAULT 0,
  total_tokens integer DEFAULT 0,
  cost_usd numeric(12,6) DEFAULT 0,
  request_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT llm_usage_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS llm_usage_tenant_created_idx ON public.llm_usage(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.llm_quotas (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan text DEFAULT 'free',
  monthly_token_limit bigint DEFAULT 0,
  monthly_cost_limit numeric(12,4) DEFAULT 0,
  monthly_request_limit integer DEFAULT 0,
  current_month_tokens bigint DEFAULT 0,
  current_month_cost numeric(12,4) DEFAULT 0,
  current_month_requests integer DEFAULT 0,
  quota_reset_date timestamptz,
  overage_allowed boolean DEFAULT false,
  notification_threshold integer DEFAULT 80,
  ai_features_enabled boolean DEFAULT true,
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT llm_quotas_pkey PRIMARY KEY (tenant_id)
);

CREATE TABLE IF NOT EXISTS public.llm_usage_alerts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  alert_type text,
  message text,
  current_usage numeric(14,4),
  "limit" numeric(14,4),
  percentage numeric(6,2),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT llm_usage_alerts_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS llm_usage_alerts_tenant_idx ON public.llm_usage_alerts(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.llm_alert_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  status text DEFAULT 'pending',
  retry_count integer DEFAULT 0,
  sent_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT llm_alert_notifications_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS llm_alert_notifications_tenant_idx ON public.llm_alert_notifications(tenant_id);

-- ---------------------------------------------------------------------------
-- Per-staff scheduling
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_availability (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  staff_id uuid,
  day_of_week smallint,
  start_time time,
  end_time time,
  break_start time,
  break_end time,
  is_available boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT staff_availability_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS staff_availability_tenant_staff_idx ON public.staff_availability(tenant_id, staff_id, day_of_week);

CREATE TABLE IF NOT EXISTS public.provider_schedule (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_id uuid,
  day_of_week smallint,
  start_time time,
  end_time time,
  break_start_time time,
  break_end_time time,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT provider_schedule_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS provider_schedule_tenant_provider_idx ON public.provider_schedule(tenant_id, provider_id, day_of_week);

CREATE TABLE IF NOT EXISTS public.provider_services (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_id uuid,
  service_id uuid,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT provider_services_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS provider_services_provider_idx ON public.provider_services(provider_id);
CREATE INDEX IF NOT EXISTS provider_services_service_idx ON public.provider_services(service_id);

CREATE TABLE IF NOT EXISTS public.staff_schedule_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  staff_id uuid,
  date date,
  available boolean DEFAULT true,
  reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT staff_schedule_overrides_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS staff_schedule_overrides_tenant_staff_date_idx ON public.staff_schedule_overrides(tenant_id, staff_id, date);

CREATE TABLE IF NOT EXISTS public.staff_locations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  staff_id uuid,
  location_id uuid,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT staff_locations_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS staff_locations_location_idx ON public.staff_locations(location_id);
CREATE INDEX IF NOT EXISTS staff_locations_staff_idx ON public.staff_locations(staff_id);

-- ---------------------------------------------------------------------------
-- Booking core (real tables behind the current fallbacks)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_hours (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  day_of_week smallint,          -- 0=Sunday .. 6=Saturday
  start_time time,
  end_time time,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT business_hours_pkey PRIMARY KEY (id),
  CONSTRAINT business_hours_tenant_day_uniq UNIQUE (tenant_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS public.reservation_locks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  slot_key text,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT reservation_locks_pkey PRIMARY KEY (id),
  CONSTRAINT reservation_locks_slot_uniq UNIQUE (tenant_id, slot_key)
);
CREATE INDEX IF NOT EXISTS reservation_locks_expires_idx ON public.reservation_locks(expires_at);

-- ---------------------------------------------------------------------------
-- WhatsApp integration message log (optional — only needed if the WhatsApp
-- assistant is live at launch; chat UI uses messages/chats which already exist)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  message_id text,
  from_number text,
  to_number text,
  from_me boolean DEFAULT false,
  message_type text,
  body text,
  media_data jsonb,
  quoted_message jsonb,
  raw_data jsonb,
  "timestamp" timestamptz,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT whatsapp_messages_pkey PRIMARY KEY (id),
  CONSTRAINT whatsapp_messages_msgid_uniq UNIQUE (tenant_id, message_id)
);
CREATE INDEX IF NOT EXISTS whatsapp_messages_tenant_ts_idx ON public.whatsapp_messages(tenant_id, "timestamp" DESC);

-- ---------------------------------------------------------------------------
-- Notifications, settings & usage
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.in_app_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  type text,
  severity text,
  title text,
  message text,
  data jsonb DEFAULT '{}'::jsonb,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT in_app_notifications_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS in_app_notifications_tenant_idx ON public.in_app_notifications(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.tenant_settings (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email_notifications boolean DEFAULT true,
  sms_notifications boolean DEFAULT false,
  whatsapp_notifications boolean DEFAULT true,
  llm_budget_alerts boolean DEFAULT true,
  llm_quota_alerts boolean DEFAULT true,
  llm_notification_threshold integer DEFAULT 80,
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT tenant_settings_pkey PRIMARY KEY (tenant_id)
);

CREATE TABLE IF NOT EXISTS public.user_preferences (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid,
  preference_type text,
  config jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT user_preferences_pkey PRIMARY KEY (id),
  CONSTRAINT user_preferences_uniq UNIQUE (tenant_id, user_id, preference_type)
);

CREATE TABLE IF NOT EXISTS public.usage_daily (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  day date,
  bookings integer DEFAULT 0,
  deposits integer DEFAULT 0,
  llm_tokens bigint DEFAULT 0,
  CONSTRAINT usage_daily_pkey PRIMARY KEY (id),
  CONSTRAINT usage_daily_tenant_day_uniq UNIQUE (tenant_id, day)
);
CREATE INDEX IF NOT EXISTS usage_daily_tenant_day_idx ON public.usage_daily(tenant_id, day);

-- ---------------------------------------------------------------------------
-- Payments — fraud / risk
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fraud_assessments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  risk_score numeric(6,2),
  risk_level text,
  flags jsonb,
  recommendation text,
  payment_amount numeric(14,2),
  payment_currency text,
  customer_email text,
  ip_address text,
  user_agent text,
  country_code text,
  details jsonb,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT fraud_assessments_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS fraud_assessments_tenant_idx ON public.fraud_assessments(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.suspicious_activities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  activity_type text,
  severity text DEFAULT 'medium',
  details jsonb,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT suspicious_activities_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS suspicious_activities_tenant_idx ON public.suspicious_activities(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.flagged_devices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  fingerprint text,
  reason text,
  risk_level text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT flagged_devices_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS flagged_devices_fingerprint_idx ON public.flagged_devices(fingerprint);

-- ---------------------------------------------------------------------------
-- Recommendations / product links
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_analytics (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  service_id uuid,
  commonly_booked_with jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT booking_analytics_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS booking_analytics_tenant_service_idx ON public.booking_analytics(tenant_id, service_id);

CREATE TABLE IF NOT EXISTS public.customer_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  phone text,                    -- review: insert spreads a CustomerProfile
  name text,
  email text,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT customer_profiles_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS customer_profiles_tenant_phone_idx ON public.customer_profiles(tenant_id, phone);

CREATE TABLE IF NOT EXISTS public.service_products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  service_id uuid,
  product_id uuid,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT service_products_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS service_products_service_idx ON public.service_products(service_id);

CREATE TABLE IF NOT EXISTS public.service_pricing_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  service_id uuid,
  price_cents integer,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT service_pricing_history_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS service_pricing_history_service_idx ON public.service_pricing_history(service_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.booking_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  booking_id uuid,
  product_id uuid,
  variant_id uuid,
  quantity integer DEFAULT 1,
  price_cents integer,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT booking_items_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS booking_items_variant_idx ON public.booking_items(variant_id);
CREATE INDEX IF NOT EXISTS booking_items_booking_idx ON public.booking_items(booking_id);

-- ---------------------------------------------------------------------------
-- Integrations & misc
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.calendar_blocks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  staff_id uuid,
  title text,
  description text,
  block_type text,
  start_time timestamptz,
  end_time timestamptz,
  google_event_id text,
  last_synced timestamptz,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT calendar_blocks_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS calendar_blocks_tenant_time_idx ON public.calendar_blocks(tenant_id, start_time);

CREATE TABLE IF NOT EXISTS public.tenant_webhooks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_type text,
  url text,
  secret text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT tenant_webhooks_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS tenant_webhooks_tenant_event_idx ON public.tenant_webhooks(tenant_id, event_type);

CREATE TABLE IF NOT EXISTS public.automation_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text,                     -- review: upsert spreads an AutomationRule
  rule_type text,
  trigger_config jsonb DEFAULT '{}'::jsonb,
  action_config jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT automation_rules_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS automation_rules_tenant_idx ON public.automation_rules(tenant_id);

CREATE TABLE IF NOT EXISTS public.items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT items_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS items_tenant_idx ON public.items(tenant_id);

CREATE TABLE IF NOT EXISTS public.event_processing_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_id text,
  handler_type text,
  success boolean DEFAULT true,
  processed_at timestamptz DEFAULT now(),
  CONSTRAINT event_processing_log_pkey PRIMARY KEY (id),
  CONSTRAINT event_processing_log_uniq UNIQUE (event_id, handler_type)
);

-- ---------------------------------------------------------------------------
-- Platform / admin (non-tenant)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.modules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text,
  vertical text,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  CONSTRAINT modules_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.superadmin_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  admin_id uuid,
  admin_email text,
  action text,
  details jsonb,
  ip_address text,
  "timestamp" timestamptz DEFAULT now(),
  CONSTRAINT superadmin_audit_log_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS superadmin_audit_log_ts_idx ON public.superadmin_audit_log("timestamp" DESC);

-- NOTE: No public.users or public.profiles tables. Identity lives in auth.users
-- (Supabase auth) + public.tenant_users (membership, which already carries
-- email/phone/role). Code paths that referenced users/profiles were repointed
-- to tenant_users.

-- ============================================================================
-- Row Level Security
--   Service role bypasses RLS (server writes keep working). The policies below
--   scope authenticated (bearer) access to the caller's own tenant.
-- ============================================================================

-- Tenant-scoped tables: SELECT/INSERT/UPDATE/DELETE limited to the user's tenant
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'llm_usage','llm_quotas','llm_usage_alerts','llm_alert_notifications',
    'staff_availability','provider_schedule','provider_services','staff_schedule_overrides','staff_locations',
    'business_hours','reservation_locks','whatsapp_messages',
    'in_app_notifications','tenant_settings','user_preferences','usage_daily',
    'fraud_assessments','suspicious_activities','flagged_devices',
    'booking_analytics','customer_profiles','service_products','service_pricing_history','booking_items',
    'calendar_blocks','tenant_webhooks','automation_rules','items'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_tenant_isolation', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        USING (tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()))
        WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()));
    $f$, t || '_tenant_isolation', t);
  END LOOP;
END $$;

-- Service-role only (RLS enabled, no policy -> only the service role can access)
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.superadmin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_processing_log ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- End. Re-runnable: CREATE TABLE IF NOT EXISTS is idempotent; re-running the
-- policy block errors only if a policy already exists (drop-and-recreate if so).
-- ============================================================================
