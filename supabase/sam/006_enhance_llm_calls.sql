-- Add structured fields to llm_calls for easier admin reporting and cost queries

ALTER TABLE IF EXISTS llm_calls
  ADD COLUMN IF NOT EXISTS model text;

ALTER TABLE IF EXISTS llm_calls
  ADD COLUMN IF NOT EXISTS total_tokens integer;

ALTER TABLE IF EXISTS llm_calls
  ADD COLUMN IF NOT EXISTS estimated_cost numeric;

-- Backfill suggestion (manual): run a script to parse existing usage JSON and populate total_tokens/estimated_cost where possible.
