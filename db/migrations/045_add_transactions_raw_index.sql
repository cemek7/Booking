-- Index for JSONB reservation_id lookup used in deposit idempotency checks
-- Covers: .eq('raw->>reservation_id', reservationId) in paymentsAdapter.ts
CREATE INDEX IF NOT EXISTS idx_transactions_raw_reservation_id
  ON transactions ((raw->>'reservation_id'))
  WHERE raw->>'reservation_id' IS NOT NULL;
