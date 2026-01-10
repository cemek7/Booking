-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.admins (
  created_at timestamp with time zone DEFAULT now(),
  email text NOT NULL UNIQUE,
  status boolean,
  last_sign_in time without time zone,
  invited_by text,
  invited_at time without time zone
);
CREATE TABLE public.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid,
  action text NOT NULL,
  target_user_id uuid,
  details jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT audit_logs_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.bookings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  start_date timestamp without time zone,
  end_date timestamp without time zone,
  title text,
  description text,
  capacity integer,
  status text CHECK (status = ANY (ARRAY['open'::text, 'full'::text, 'cancelled'::text])),
  CONSTRAINT bookings_pkey PRIMARY KEY (id),
  CONSTRAINT bookings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
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
  CONSTRAINT chats_pkey PRIMARY KEY (id)
);
CREATE TABLE public.customers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  customer_name text,
  phone_number text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT customers_pkey PRIMARY KEY (id),
  CONSTRAINT customers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.dialog_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  user_id uuid,
  slots jsonb DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'collecting'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT dialog_sessions_pkey PRIMARY KEY (id)
);
CREATE TABLE public.faqs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT faqs_pkey PRIMARY KEY (id),
  CONSTRAINT faqs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.invites (
  token uuid NOT NULL,
  tenant_id uuid,
  email text,
  role text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT invites_pkey PRIMARY KEY (token),
  CONSTRAINT invites_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  type text NOT NULL,
  payload jsonb,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])),
  scheduled_at timestamp with time zone NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT jobs_pkey PRIMARY KEY (id)
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
  estimated_cost numeric,
  CONSTRAINT llm_calls_pkey PRIMARY KEY (id),
  CONSTRAINT llm_calls_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source text,
  type text,
  data jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT logs_pkey PRIMARY KEY (id)
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
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_chat_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id)
);
CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  title text,
  message text,
  meta jsonb,
  read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.platform_settings (
  id integer NOT NULL DEFAULT 1,
  stripe_key text NOT NULL,
  CONSTRAINT platform_settings_pkey PRIMARY KEY (id)
);
CREATE TABLE public.platform_settings_kv (
  key text NOT NULL,
  value jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT platform_settings_kv_pkey PRIMARY KEY (key)
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
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT reminders_pkey PRIMARY KEY (id),
  CONSTRAINT reminders_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT reminders_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.reservations(id)
);
CREATE TABLE public.reservation_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  action text,
  created_at timestamp without time zone DEFAULT now(),
  reservation_id uuid,
  actor text,
  notes text,
  CONSTRAINT reservation_logs_pkey PRIMARY KEY (id),
  CONSTRAINT reservation_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.reservation_services (
  reservation_id uuid NOT NULL,
  service_id uuid NOT NULL,
  quantity integer DEFAULT 1,
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  CONSTRAINT reservation_services_pkey PRIMARY KEY (reservation_id, service_id),
  CONSTRAINT reservation_services_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.reservations(id),
  CONSTRAINT reservation_services_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id),
  CONSTRAINT reservation_services_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT reservation_services_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id)
);
CREATE TABLE public.reservation_trends (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  date date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT reservation_trends_pkey PRIMARY KEY (id),
  CONSTRAINT reservation_trends_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.reservations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  date date,
  time text,
  notes text,
  created_at timestamp without time zone DEFAULT now(),
  customer_id uuid,
  booking_id uuid,
  status text CHECK (status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'completed'::text, 'cancelled'::text])),
  duration smallint,
  calendar_sent boolean DEFAULT false,
  reminder_sent boolean DEFAULT false,
  customer_number text,
  start_at timestamp with time zone,
  end_at timestamp with time zone,
  metadata jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT reservations_pkey PRIMARY KEY (id),
  CONSTRAINT reservations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT reservations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id)
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
  CONSTRAINT services_pkey PRIMARY KEY (id),
  CONSTRAINT services_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.support_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL,
  assigned_to uuid NOT NULL,
  assigned_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT support_assignments_pkey PRIMARY KEY (id),
  CONSTRAINT support_assignments_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id)
);
CREATE TABLE public.support_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL,
  author_id uuid,
  author_role text,
  body text NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT support_messages_pkey PRIMARY KEY (id),
  CONSTRAINT support_messages_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id)
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
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT support_tickets_pkey PRIMARY KEY (id),
  CONSTRAINT support_tickets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.tenant_reminder_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  reminder_offset_minutes integer NOT NULL DEFAULT 60,
  template text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT tenant_reminder_settings_pkey PRIMARY KEY (id),
  CONSTRAINT tenant_reminder_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.tenant_tone_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  tone text,
  style_guidelines text,
  voice_parameters jsonb,
  sample_phrases jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT tenant_tone_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT tenant_tone_profiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.tenant_users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  user_id uuid,
  role text NOT NULL DEFAULT 'staff'::text CHECK (role = ANY (ARRAY['owner'::text, 'staff'::text])),
  created_at timestamp with time zone DEFAULT now(),
  email text,
  name text,
  CONSTRAINT tenant_users_pkey PRIMARY KEY (id),
  CONSTRAINT tenants_users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT tenants_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.tenants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  whatsapp_number text,
  whatsapp_api_provider text,
  plan text DEFAULT 'starter'::text,
  notify_via_sms boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  whatsapp_number_id text UNIQUE,
  waba_api_key text,
  whatsapp_status text DEFAULT 'disconnected'::text CHECK (whatsapp_status = ANY (ARRAY['connected'::text, 'disconnected'::text, 'pending'::text])),
  whatsapp_connected_at timestamp with time zone,
  email text UNIQUE,
  business_type text,
  tone_config jsonb DEFAULT '{}'::jsonb,
  timezone text,
  metadata jsonb DEFAULT '{}'::jsonb,
  preferred_llm_model text,
  llm_token_rate numeric,
  CONSTRAINT tenants_pkey PRIMARY KEY (id)
);
CREATE TABLE public.transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  amount numeric,
  currency text DEFAULT 'NGN'::text,
  type text,
  status text,
  raw jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT transactions_pkey PRIMARY KEY (id)
);