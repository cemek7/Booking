-- Migration 023: Create webhook_events and event_outbox tables for idempotency and reliability
-- Date: 2025-11-20

-- Webhook events table for idempotency tracking
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  external_id text NOT NULL,
  event_type text,
  payload jsonb,
  processed_at timestamptz DEFAULT now(),
  tenant_id uuid,
  UNIQUE (provider, external_id)
);

-- Event outbox table for reliable event publishing
CREATE TABLE IF NOT EXISTS public.event_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  tenant_id uuid,
  location_id uuid,
  payload jsonb,
  hash text UNIQUE NOT NULL, -- SHA256 of type + tenant_id + payload for idempotency
  delivered_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Events table (main event log)
CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL,
  version text DEFAULT '1.0.0',
  tenant_id uuid,
  location_id uuid,
  payload jsonb,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS for all event-related tables
ALTER TABLE IF EXISTS public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.events ENABLE ROW LEVEL SECURITY;

-- Basic tenant scoping policies
DROP POLICY IF EXISTS webhook_events_select ON public.webhook_events;
CREATE POLICY webhook_events_select ON public.webhook_events
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IS NULL OR
    tenant_id::text = current_setting('request.jwt.claims.tenant_id', true)
  );

DROP POLICY IF EXISTS event_outbox_select ON public.event_outbox;
CREATE POLICY event_outbox_select ON public.event_outbox
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IS NULL OR
    tenant_id::text = current_setting('request.jwt.claims.tenant_id', true)
  );

DROP POLICY IF EXISTS events_select ON public.events;
CREATE POLICY events_select ON public.events
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IS NULL OR
    tenant_id::text = current_setting('request.jwt.claims.tenant_id', true)
  );

-- Allow service role to manage all event tables
DROP POLICY IF EXISTS webhook_events_service ON public.webhook_events;
CREATE POLICY webhook_events_service ON public.webhook_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS event_outbox_service ON public.event_outbox;
CREATE POLICY event_outbox_service ON public.event_outbox
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS events_service ON public.events;
CREATE POLICY events_service ON public.events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS webhook_events_provider_external_idx ON public.webhook_events (provider, external_id);
CREATE INDEX IF NOT EXISTS event_outbox_undelivered_idx ON public.event_outbox (created_at) WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS event_outbox_hash_idx ON public.event_outbox (hash);
CREATE INDEX IF NOT EXISTS events_tenant_type_idx ON public.events (tenant_id, event, created_at);