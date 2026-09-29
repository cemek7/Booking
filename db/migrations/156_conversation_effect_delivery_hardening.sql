+-- Migration 156: make outbound message dispatch idempotent per tenant.
-- The application persists a pending intent before calling Meta. This index is
-- the concurrency boundary that prevents two workers dispatching the same reply.

BEGIN;

DO $duplicate_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.messages
    WHERE idempotency_key IS NOT NULL
    GROUP BY tenant_id, idempotency_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate outbound message idempotency keys exist; reconcile before migration 156';
  END IF;
END
$duplicate_preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_tenant_idempotency
  ON public.messages (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DO $verify$
BEGIN
  IF to_regclass('public.uq_messages_tenant_idempotency') IS NULL THEN
    RAISE EXCEPTION 'Missing outbound message idempotency index';
  END IF;
END
$verify$;

COMMIT;
