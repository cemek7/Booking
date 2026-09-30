-- Migration 159: order-scoped retail fulfilment handoff and explicit human handling mode.
-- Additive expand migration. Runtime remains gated off until the matching application release.

BEGIN;

ALTER TABLE public.escalation_queue
  ADD COLUMN IF NOT EXISTS retail_order_id uuid,
  ADD COLUMN IF NOT EXISTS reason_code text;

ALTER TABLE public.conversation_threads
  ADD COLUMN IF NOT EXISTS human_handling_mode text;

UPDATE public.conversation_threads
SET human_handling_mode = 'timed'
WHERE human_handling_until IS NOT NULL
  AND human_handling_mode IS NULL;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_info
    WHERE constraint_info.conrelid = 'public.retail_orders'::regclass
      AND constraint_info.conname = 'retail_orders_tenant_id_id_key'
  ) THEN
    ALTER TABLE public.retail_orders
      ADD CONSTRAINT retail_orders_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_info
    WHERE constraint_info.conrelid = 'public.escalation_queue'::regclass
      AND constraint_info.conname = 'escalation_queue_retail_order_tenant_fkey'
  ) THEN
    ALTER TABLE public.escalation_queue
      ADD CONSTRAINT escalation_queue_retail_order_tenant_fkey
      FOREIGN KEY (tenant_id, retail_order_id)
      REFERENCES public.retail_orders (tenant_id, id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_info
    WHERE constraint_info.conrelid = 'public.escalation_queue'::regclass
      AND constraint_info.conname = 'escalation_queue_reason_code_check'
  ) THEN
    ALTER TABLE public.escalation_queue
      ADD CONSTRAINT escalation_queue_reason_code_check
      CHECK (reason_code IS NULL OR reason_code IN ('retail_fulfillment'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_info
    WHERE constraint_info.conrelid = 'public.conversation_threads'::regclass
      AND constraint_info.conname = 'conversation_threads_human_handling_mode_check'
  ) THEN
    ALTER TABLE public.conversation_threads
      ADD CONSTRAINT conversation_threads_human_handling_mode_check
      CHECK (
        human_handling_mode IS NULL
        OR human_handling_mode IN ('timed', 'until_released')
      );
  END IF;
END
$constraints$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_escalation_retail_fulfillment
  ON public.escalation_queue (tenant_id, retail_order_id, reason_code)
  WHERE retail_order_id IS NOT NULL
    AND reason_code = 'retail_fulfillment';

CREATE INDEX IF NOT EXISTS idx_escalation_queue_retail_order
  ON public.escalation_queue (tenant_id, retail_order_id, created_at DESC)
  WHERE retail_order_id IS NOT NULL;

COMMIT;

