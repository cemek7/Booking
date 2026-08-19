-- Migration 060: Payment idempotency and transaction atomicity constraints
--
-- 1. Ensure idempotency_keys has a unique constraint on (tenant_id, idempotency_hash)
--    so concurrent requests generate a 23505 that the application handles correctly.
--
-- 2. Add a unique constraint on transactions(provider_reference) so that
--    duplicate provider calls for the same reference are caught at the DB level.

-- Create idempotency_keys table if it doesn't already exist
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operation        TEXT        NOT NULL,
  idempotency_key  TEXT        NOT NULL,
  idempotency_hash TEXT        NOT NULL,
  amount           NUMERIC,
  metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status           TEXT        NOT NULL DEFAULT 'processing',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- idempotency_keys unique constraint (idempotent — skip if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'idempotency_keys_tenant_hash_unique'
  ) THEN
    ALTER TABLE idempotency_keys
      ADD CONSTRAINT idempotency_keys_tenant_hash_unique
      UNIQUE (tenant_id, idempotency_hash);
  END IF;
END $$;

-- transactions unique constraint on provider_reference prevents duplicate
-- rows being inserted for the same provider-level payment reference
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transactions_provider_reference_unique'
  ) THEN
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_provider_reference_unique
      UNIQUE (provider_reference);
  END IF;
END $$;

-- Index to speed up the reservation deposit lookup used for idempotency checks
-- in deposits/route.ts and dialogBookingBridge.ts
CREATE INDEX IF NOT EXISTS idx_transactions_reservation_deposit
  ON transactions ((raw->>'reservation_id'), tenant_id, type, status)
  WHERE type = 'deposit' AND status IN ('pending', 'success');
