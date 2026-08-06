CREATE TABLE IF NOT EXISTS public.ai_action_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_type        text NOT NULL,
  actor_id          uuid,
  channel           text,
  raw_message       text,
  action            text NOT NULL,
  params            jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key   text NOT NULL,
  validation_result jsonb,
  outcome           text NOT NULL CHECK (outcome IN ('executed','rejected','needs_confirmation','duplicate','denied')),
  model             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_action_log_idem_unique UNIQUE (tenant_id, idempotency_key)
);

ALTER TABLE public.ai_action_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_action_log_service_role ON public.ai_action_log;
CREATE POLICY ai_action_log_service_role
  ON public.ai_action_log
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
