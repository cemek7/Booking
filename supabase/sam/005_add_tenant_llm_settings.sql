-- Add per-tenant LLM preferences: preferred model and a token-rate override (for cost estimates)

ALTER TABLE IF EXISTS tenants
  ADD COLUMN IF NOT EXISTS preferred_llm_model text;

ALTER TABLE IF EXISTS tenants
  ADD COLUMN IF NOT EXISTS llm_token_rate numeric;

-- Notes:
-- - preferred_llm_model: optional name of the model to use for this tenant (overrides env default)
-- - llm_token_rate: optional token rate (currency units per token) used to compute estimated_cost for tenant-specific accounting
