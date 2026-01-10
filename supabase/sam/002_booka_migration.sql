-- Migration: 002_booka_migration.sql
-- Purpose: Reconcile current Supabase schema with Booka PRD schema.
-- This script is conservative and idempotent: it uses IF NOT EXISTS and
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS to avoid destructive changes.
-- Review before running in production. Adjust JWT claim paths for RLS policies
-- to match your Supabase JWT claim names (commonly `jwt.claims.tenant_id`).

-- =====================
-- 1) TENANTS: add PRD fields if missing
-- =====================
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS tone_config jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS timezone text;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- Ensure a created_at exists (many schemas already have it)
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- =====================
-- 2) RESERVATIONS: additive changes
-- =====================
-- Add start_at/end_at as a canonical timestamp-based schedule field
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS start_at timestamptz;

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS end_at timestamptz;

-- Add metadata and status if missing (PRD expects these)
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';

-- Add created_at if absent
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Create an index for tenant + start_at to help queries (no-op if exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'i' AND c.relname = 'reservations_tenant_date_idx'
  ) THEN
    CREATE INDEX reservations_tenant_date_idx ON public.reservations (tenant_id, start_at);
  END IF;
END$$;

-- =====================
-- 3) MESSAGES / CHATS
-- =====================
-- Many schemas use `chats` instead of `messages`. Create a lightweight
-- `messages` table only if it does not already exist.
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  reservation_id uuid,
  from_number text,
  to_number text,
  content text,
  direction text,
  raw jsonb,
  created_at timestamptz DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'i' AND c.relname = 'messages_convo_idx'
  ) THEN
    CREATE INDEX messages_convo_idx ON public.messages (tenant_id, from_number);
  END IF;
END$$;

-- =====================
-- 4) TRANSACTIONS table (create if missing)
-- =====================
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  amount numeric(12,2),
  currency text DEFAULT 'NGN',
  type text,
  status text,
  raw jsonb,
  created_at timestamptz DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'i' AND c.relname = 'transactions_tenant_idx'
  ) THEN
    CREATE INDEX transactions_tenant_idx ON public.transactions (tenant_id, status);
  END IF;
END$$;

-- =====================
-- 5) RESERVATION_LOGS: ensure reservation_id exists (some schemas used tenant_id)
-- =====================
ALTER TABLE public.reservation_logs
  ADD COLUMN IF NOT EXISTS reservation_id uuid;

ALTER TABLE public.reservation_logs
  ADD COLUMN IF NOT EXISTS actor text;

ALTER TABLE public.reservation_logs
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.reservation_logs
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- If you want reservation_logs to reference reservations, uncomment and apply
-- after verifying `reservations.id` exists and you want the FK:
-- ALTER TABLE public.reservation_logs ADD CONSTRAINT reservation_logs_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON DELETE CASCADE;

-- =====================
-- 6) PLATFORM SETTINGS: ensure a kv-style table exists for PRD features
-- If `platform_settings` already exists with a different shape (eg. id/stripe_key),
-- we create an alternate kv table `platform_settings_kv` to avoid destructive changes.
CREATE TABLE IF NOT EXISTS public.platform_settings_kv (
  key text PRIMARY KEY,
  value jsonb DEFAULT '{}'::jsonb
);

-- =====================
-- 7) RLS: enable and add example policies (non-destructive templates)
-- IMPORTANT: Verify your JWT claims path. Common values:
--   current_setting('jwt.claims.tenant_id', true)
--   current_setting('request.jwt.claims.tenant_id', true)
-- Update the policy expressions below to match your environment before enabling.

-- Enable RLS on sensitive tables (no-op if already enabled)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'reservations') THEN
    EXECUTE 'ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'messages') THEN
    EXECUTE 'ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'transactions') THEN
    EXECUTE 'ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY';
  END IF;
END$$;

-- Policy templates: adjust `jwt.claims.tenant_id` to your claim path.
DO $$
BEGIN
  -- Reservations: allow access when tenant_id matches JWT claim
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reservations' AND policyname = 'reservations_tenant_is_owner') THEN
    EXECUTE $$
      CREATE POLICY reservations_tenant_is_owner ON public.reservations
        FOR ALL
        USING (
          (tenant_id IS NULL) OR (tenant_id::text = current_setting('jwt.claims.tenant_id', true))
        );
    $$;
  END IF;

  -- Messages
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'messages' AND policyname = 'messages_tenant_is_owner') THEN
    EXECUTE $$
      CREATE POLICY messages_tenant_is_owner ON public.messages
        FOR ALL
        USING (
          (tenant_id IS NULL) OR (tenant_id::text = current_setting('jwt.claims.tenant_id', true))
        );
    $$;
  END IF;

  -- Transactions
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'transactions' AND policyname = 'transactions_tenant_is_owner') THEN
    EXECUTE $$
      CREATE POLICY transactions_tenant_is_owner ON public.transactions
        FOR ALL
        USING (
          (tenant_id IS NULL) OR (tenant_id::text = current_setting('jwt.claims.tenant_id', true))
        );
    $$;
  END IF;
END$$;

-- =====================
-- 8) Helpful views (optional): reservations_with_customer
-- Create a lightweight view to join reservations with customers if both exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'reservations') AND
     EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'customers') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'vw_reservations_with_customer') THEN
      EXECUTE $$
        CREATE VIEW public.vw_reservations_with_customer AS
        SELECT r.*, c.customer_name, c.phone_number
        FROM public.reservations r
        LEFT JOIN public.customers c ON r.customer_id = c.id;
      $$;
    END IF;
  END IF;
END$$;

-- End of migration 002
