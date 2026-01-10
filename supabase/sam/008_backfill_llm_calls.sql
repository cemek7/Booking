-- Backfill script for llm_calls: populate total_tokens and estimated_cost from raw->usage if present
-- Run this after applying the migration that added total_tokens and estimated_cost columns.

BEGIN;

-- Best-effort: if raw JSON contains { "usage": { "total_tokens": ..., "estimated_cost": ... } }
UPDATE llm_calls
SET
  total_tokens = (raw -> 'usage' ->> 'total_tokens')::int,
  estimated_cost = (raw -> 'usage' ->> 'estimated_cost')::numeric
WHERE
  (total_tokens IS NULL OR total_tokens = 0)
  AND raw ? 'usage'
  AND (raw -> 'usage' ->> 'total_tokens') IS NOT NULL;

COMMIT;

-- Notes:
-- - Review a sample of rows before running in production.
-- - If your raw usage structure differs, adjust the JSON path extraction accordingly.
