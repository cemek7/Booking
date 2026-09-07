-- Migration 140: WhatsApp message charges
-- Correlates a Meta wamid to the wallet reservation taken before the send, so
-- settlement can charge from Meta's own pricing object and undelivered
-- messages can be released instead of billed.

CREATE TABLE IF NOT EXISTS public.whatsapp_message_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  wamid TEXT,
  wallet_reservation_id UUID,
  reserved_credits NUMERIC(20,6) NOT NULL DEFAULT 0,
  settled_credits NUMERIC(20,6),
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'settled', 'released', 'failed')),
  billable BOOLEAN,
  pricing_category TEXT,
  pricing_type TEXT,
  pricing_model TEXT,
  delivery_status TEXT,
  message_kind TEXT,
  mode TEXT NOT NULL DEFAULT 'live'
    CHECK (mode IN ('shadow', 'live')),
  attribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_message_charges_tenant_wamid
  ON public.whatsapp_message_charges (tenant_id, wamid) WHERE wamid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_charges_sweeper
  ON public.whatsapp_message_charges (sent_at) WHERE status = 'reserved';

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_charges_tenant_sent_at
  ON public.whatsapp_message_charges (tenant_id, sent_at DESC);

ALTER TABLE public.whatsapp_message_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_message_charges_service_role
  ON public.whatsapp_message_charges;
CREATE POLICY whatsapp_message_charges_service_role
  ON public.whatsapp_message_charges
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON COLUMN public.whatsapp_message_charges.attribution IS
  'Free-form {conversation_id, booking_id, flow, ai_layer} used by cost reporting.';
COMMENT ON COLUMN public.whatsapp_message_charges.mode IS
  'shadow rows record volume but never move money; live rows are real revenue.';
