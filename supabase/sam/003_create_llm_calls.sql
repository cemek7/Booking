-- Migration: Create llm_calls table for logging LLM interactions
-- Run this migration in your Supabase project

CREATE TABLE IF NOT EXISTS public.llm_calls (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  action text,
  model text,
  usage jsonb,
  raw jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_calls_tenant_id ON public.llm_calls(tenant_id);
