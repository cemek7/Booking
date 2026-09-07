-- Migration 043: make Daily Operating Loop automation durable, transactional,
-- and direction-specific. Delivery is intentionally delegated to Task 3R-B.
BEGIN;

ALTER TABLE public.operating_objectives ADD COLUMN source_fingerprint TEXT;
UPDATE public.operating_objectives SET source_fingerprint = 'legacy:' || id::text WHERE source_fingerprint IS NULL;
ALTER TABLE public.operating_objectives ALTER COLUMN source_fingerprint SET NOT NULL;
ALTER TABLE public.operating_objectives DROP CONSTRAINT operating_objectives_status_check;
ALTER TABLE public.operating_objectives ADD CONSTRAINT operating_objectives_status_check
  CHECK (status IN ('active', 'queued', 'deferred', 'completed', 'dismissed', 'expired', 'failed'));
DROP INDEX public.operating_objectives_active_dedupe_idx;
CREATE UNIQUE INDEX operating_objectives_open_dedupe_idx ON public.operating_objectives (tenant_id, dedupe_key)
  WHERE status IN ('active', 'queued');

CREATE TABLE public.operating_loop_settings (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  automation_paused BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.operating_objective_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  objective_id UUID NOT NULL,
  dedupe_key TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('defer', 'dismiss')),
  suppressed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT operating_suppressions_objective_tenant_fkey FOREIGN KEY (tenant_id, objective_id)
    REFERENCES public.operating_objectives (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT operating_suppressions_defer_window_check CHECK (
    (mode = 'defer' AND suppressed_until IS NOT NULL) OR (mode = 'dismiss' AND suppressed_until IS NULL)
  ),
  CONSTRAINT operating_suppressions_dedupe_source_key UNIQUE (tenant_id, dedupe_key, source_fingerprint)
);

-- The outbox records an action's tenant alongside its ID. PostgreSQL requires
-- that exact pair to be unique before it can be referenced by a composite FK.
ALTER TABLE public.operating_actions
  ADD CONSTRAINT operating_actions_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TABLE public.operating_delivery_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  action_id UUID NOT NULL,
  objective_id UUID NOT NULL,
  direction TEXT NOT NULL DEFAULT 'outbound' CHECK (direction = 'outbound'),
  recipient TEXT NOT NULL CHECK (length(btrim(recipient)) > 0),
  payload JSONB NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'held', 'retry', 'sent', 'dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 5),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider_message_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT operating_outbox_action_tenant_fkey FOREIGN KEY (tenant_id, action_id)
    REFERENCES public.operating_actions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT operating_outbox_objective_tenant_fkey FOREIGN KEY (tenant_id, objective_id)
    REFERENCES public.operating_objectives (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT operating_outbox_tenant_idempotency_key UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT operating_outbox_one_delivery_per_objective UNIQUE (tenant_id, objective_id)
);
CREATE INDEX operating_suppressions_active_lookup_idx ON public.operating_objective_suppressions
  (tenant_id, dedupe_key, source_fingerprint, suppressed_until);
CREATE INDEX operating_outbox_due_idx ON public.operating_delivery_outbox (status, available_at);

ALTER TABLE public.operating_loop_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operating_objective_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operating_delivery_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.operating_loop_settings, public.operating_objective_suppressions,
  public.operating_delivery_outbox FROM anon, authenticated;
GRANT SELECT ON TABLE public.operating_loop_settings, public.operating_objective_suppressions TO authenticated;
GRANT ALL ON TABLE public.operating_loop_settings, public.operating_objective_suppressions,
  public.operating_delivery_outbox TO service_role;
CREATE POLICY operating_loop_settings_member_read ON public.operating_loop_settings FOR SELECT TO authenticated
  USING (private.is_tenant_member(tenant_id));
CREATE POLICY operating_suppressions_member_read ON public.operating_objective_suppressions FOR SELECT TO authenticated
  USING (private.is_tenant_member(tenant_id));
CREATE POLICY operating_loop_settings_service_access ON public.operating_loop_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY operating_suppressions_service_access ON public.operating_objective_suppressions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY operating_outbox_service_access ON public.operating_delivery_outbox FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE FUNCTION public.queue_operating_delivery(
  p_tenant_id UUID, p_actor_id UUID, p_objective_id UUID, p_policy_id UUID,
  p_payload JSONB, p_idempotency_key TEXT
) RETURNS TABLE(action_id UUID, outbox_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_objective public.operating_objectives%ROWTYPE; v_policy public.automation_policies%ROWTYPE;
DECLARE v_action_id UUID; v_outbox_id UUID; v_paused BOOLEAN;
DECLARE v_local_time TIME; v_quiet_start TIME; v_quiet_end TIME;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenant_users WHERE tenant_id = p_tenant_id AND user_id = p_actor_id AND role = 'owner') THEN
    RAISE EXCEPTION 'operating-loop owner authority required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.operating_loop_settings (tenant_id) VALUES (p_tenant_id) ON CONFLICT (tenant_id) DO NOTHING;
  SELECT automation_paused INTO v_paused FROM public.operating_loop_settings WHERE tenant_id = p_tenant_id FOR UPDATE;
  IF v_paused THEN RAISE EXCEPTION 'operating-loop automation is paused' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_objective FROM public.operating_objectives
    WHERE id = p_objective_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_objective.status <> 'active' OR v_objective.expires_at IS NULL OR v_objective.expires_at <= now() THEN
    RAISE EXCEPTION 'operating objective is stale or unavailable' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_policy FROM public.automation_policies
    WHERE id = p_policy_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_policy.status <> 'active' OR v_policy.approved_by IS NULL OR v_policy.approved_at IS NULL
    OR v_policy.action_type <> v_objective.objective_type THEN
    RAISE EXCEPTION 'operating policy is inactive or invalid' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(v_policy.eligibility_rules) <> 'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_policy.eligibility_rules) key WHERE key <> 'maxAmountAtRisk')
    OR (v_policy.eligibility_rules ? 'maxAmountAtRisk' AND (
      jsonb_typeof(v_policy.eligibility_rules->'maxAmountAtRisk') <> 'number'
      OR (v_policy.eligibility_rules->>'maxAmountAtRisk')::numeric < 0
    )) THEN RAISE EXCEPTION 'policy eligibility rules are invalid' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(v_policy.quiet_hours) <> 'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_policy.quiet_hours) key WHERE key NOT IN ('start','end','timezone'))
    OR ((v_policy.quiet_hours ? 'start') <> (v_policy.quiet_hours ? 'end'))
    OR (v_policy.quiet_hours ? 'start' AND (
      (v_policy.quiet_hours->>'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      OR (v_policy.quiet_hours->>'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    ))
    OR (v_policy.quiet_hours ? 'timezone' AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_policy.quiet_hours->>'timezone'
    )) THEN RAISE EXCEPTION 'policy quiet hours are invalid' USING ERRCODE = '22023'; END IF;
  IF v_policy.quiet_hours ? 'start' AND (
    CASE
      WHEN v_policy.quiet_hours->>'start' <= v_policy.quiet_hours->>'end' THEN
        to_char(now() AT TIME ZONE coalesce(v_policy.quiet_hours->>'timezone', 'Africa/Lagos'), 'HH24:MI') >= v_policy.quiet_hours->>'start'
        AND to_char(now() AT TIME ZONE coalesce(v_policy.quiet_hours->>'timezone', 'Africa/Lagos'), 'HH24:MI') < v_policy.quiet_hours->>'end'
      ELSE
        to_char(now() AT TIME ZONE coalesce(v_policy.quiet_hours->>'timezone', 'Africa/Lagos'), 'HH24:MI') >= v_policy.quiet_hours->>'start'
        OR to_char(now() AT TIME ZONE coalesce(v_policy.quiet_hours->>'timezone', 'Africa/Lagos'), 'HH24:MI') < v_policy.quiet_hours->>'end'
    END
  ) THEN RAISE EXCEPTION 'operating policy quiet hours are active' USING ERRCODE = '42501'; END IF;
  IF v_objective.amount_at_risk IS NOT NULL AND v_policy.eligibility_rules ? 'maxAmountAtRisk'
    AND v_objective.amount_at_risk > (v_policy.eligibility_rules->>'maxAmountAtRisk')::numeric THEN
    RAISE EXCEPTION 'objective exceeds policy amount cap' USING ERRCODE = '42501';
  END IF;
  IF v_policy.quiet_hours ? 'start' THEN
    v_local_time := (now() AT TIME ZONE coalesce(v_policy.quiet_hours->>'timezone', 'UTC'))::time;
    v_quiet_start := (v_policy.quiet_hours->>'start')::time;
    v_quiet_end := (v_policy.quiet_hours->>'end')::time;
    IF v_quiet_start <> v_quiet_end AND (
      (v_quiet_start < v_quiet_end AND v_local_time >= v_quiet_start AND v_local_time < v_quiet_end)
      OR (v_quiet_start > v_quiet_end AND (v_local_time >= v_quiet_start OR v_local_time < v_quiet_end))
    ) THEN
      RAISE EXCEPTION 'operating delivery is within policy quiet hours' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['sensitive','bespoke','highValue','high_value','complaint','refund','pricingException','pricing_exception']) key
    WHERE lower(coalesce(v_objective.evidence->>key, 'false')) IN ('true','1')) THEN
    RAISE EXCEPTION 'sensitive objective cannot be automated' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_payload) <> 'object' OR coalesce(nullif(btrim(p_payload->>'recipient'), ''), '') = ''
    OR coalesce(nullif(btrim(p_payload->>'content'), ''), '') = '' OR p_payload->>'actionType' <> v_objective.objective_type
    OR coalesce(nullif(btrim(p_idempotency_key), ''), '') = '' THEN
    RAISE EXCEPTION 'operating delivery payload is invalid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.operating_delivery_outbox WHERE tenant_id = p_tenant_id AND objective_id = p_objective_id) THEN
    RAISE EXCEPTION 'operating objective already has a delivery' USING ERRCODE = '23505';
  END IF;
  UPDATE public.operating_objectives SET status = 'queued', updated_at = now() WHERE tenant_id = p_tenant_id AND id = p_objective_id;
  INSERT INTO public.operating_actions (tenant_id, objective_id, policy_id, action_type, status, actor_id, proposed_payload)
    VALUES (p_tenant_id, p_objective_id, p_policy_id, 'execute', 'queued', p_actor_id, p_payload) RETURNING id INTO v_action_id;
  INSERT INTO public.operating_delivery_outbox (tenant_id, action_id, objective_id, recipient, payload, idempotency_key)
    VALUES (p_tenant_id, v_action_id, p_objective_id, p_payload->>'recipient', p_payload, p_idempotency_key) RETURNING id INTO v_outbox_id;
  RETURN QUERY SELECT v_action_id, v_outbox_id;
END $$;

CREATE FUNCTION public.apply_operating_suppression(
  p_tenant_id UUID, p_actor_id UUID, p_objective_id UUID, p_mode TEXT,
  p_scheduled_for TIMESTAMPTZ, p_reason TEXT
) RETURNS TABLE(action_id UUID, suppression_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_objective public.operating_objectives%ROWTYPE; v_action_id UUID; v_suppression_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenant_users WHERE tenant_id = p_tenant_id AND user_id = p_actor_id AND role = 'owner') THEN
    RAISE EXCEPTION 'operating-loop owner authority required' USING ERRCODE = '42501';
  END IF;
  -- Read only the stable lock identity first. Do not take the objective row
  -- lock before the shared advisory lock: persistence takes advisory -> row,
  -- and reversing that order creates a circular wait under concurrent
  -- evaluator persistence and owner defer/dismiss actions.
  SELECT * INTO v_objective FROM public.operating_objectives
    WHERE id = p_objective_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operating objective is stale or unavailable' USING ERRCODE = 'P0001';
  END IF;

  -- Persistence uses this same transaction-scoped lock before locking the
  -- objective row. This order is intentionally identical in both paths.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text || E'\\x1f' || v_objective.dedupe_key, 0)
  );

  -- Re-read under the row lock only after the advisory lock. Any concurrent
  -- persistence or prior owner action has now committed, so freshness is
  -- validated against the authoritative current row rather than the snapshot
  -- used only to derive the advisory key.
  SELECT * INTO v_objective FROM public.operating_objectives
    WHERE id = p_objective_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_objective.status <> 'active' OR v_objective.expires_at IS NULL OR v_objective.expires_at <= now() THEN
    RAISE EXCEPTION 'operating objective is stale or unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF p_mode NOT IN ('defer','dismiss') OR (p_mode = 'defer' AND (p_scheduled_for IS NULL OR p_scheduled_for <= now()))
    OR (p_mode = 'dismiss' AND p_scheduled_for IS NOT NULL) THEN RAISE EXCEPTION 'operating suppression is invalid' USING ERRCODE = '22023'; END IF;
  UPDATE public.operating_objectives SET status = CASE WHEN p_mode = 'defer' THEN 'deferred' ELSE 'dismissed' END, updated_at = now()
    WHERE tenant_id = p_tenant_id AND id = p_objective_id;
  INSERT INTO public.operating_actions (tenant_id, objective_id, action_type, status, actor_id, scheduled_for, result_payload)
    VALUES (p_tenant_id, p_objective_id, p_mode, CASE WHEN p_mode = 'defer' THEN 'deferred' ELSE 'dismissed' END,
      p_actor_id, p_scheduled_for, jsonb_build_object('reason', nullif(btrim(coalesce(p_reason,'')),''))) RETURNING id INTO v_action_id;
  INSERT INTO public.operating_objective_suppressions (tenant_id, objective_id, dedupe_key, source_fingerprint, mode, suppressed_until)
    VALUES (p_tenant_id, p_objective_id, v_objective.dedupe_key, v_objective.source_fingerprint, p_mode, p_scheduled_for)
    ON CONFLICT (tenant_id, dedupe_key, source_fingerprint) DO UPDATE SET mode = EXCLUDED.mode, suppressed_until = EXCLUDED.suppressed_until, created_at = now()
    RETURNING id INTO v_suppression_id;
  RETURN QUERY SELECT v_action_id, v_suppression_id;
END $$;

-- The evaluator is a service-only worker. This function owns the exact
-- suppression check and objective insert, so a delayed evaluator cannot reopen
-- a deferred/dismissed source version between two application queries.
CREATE FUNCTION public.persist_operating_objective_draft(
  p_tenant_id UUID,
  p_objective_type TEXT,
  p_dedupe_key TEXT,
  p_source_fingerprint TEXT,
  p_title TEXT,
  p_explanation TEXT,
  p_evidence JSONB,
  p_affected_record_ids JSONB,
  p_priority_score NUMERIC,
  p_amount_at_risk NUMERIC,
  p_expires_at TIMESTAMPTZ,
  p_status TEXT
) RETURNS TABLE(outcome TEXT, objective JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_objective public.operating_objectives%ROWTYPE;
BEGIN
  IF p_tenant_id IS NULL
    OR nullif(btrim(p_dedupe_key), '') IS NULL
    OR nullif(btrim(p_source_fingerprint), '') IS NULL
    OR nullif(btrim(p_title), '') IS NULL
    OR nullif(btrim(p_explanation), '') IS NULL
    OR p_objective_type NOT IN ('reply_to_lead', 'qualify_lead', 'recover_lead', 'collect_deposit', 'confirm_booking', 'recover_booking', 'follow_up')
    OR p_status <> 'active'
    OR p_expires_at IS NULL
    OR p_expires_at <= now()
    OR jsonb_typeof(p_evidence) <> 'object'
    OR jsonb_typeof(p_affected_record_ids) <> 'array'
    OR p_priority_score IS NULL
    OR p_priority_score < 0
    OR (p_amount_at_risk IS NOT NULL AND p_amount_at_risk < 0) THEN
    RAISE EXCEPTION 'operating objective draft is invalid' USING ERRCODE = '22023';
  END IF;

  -- A collision only serializes unrelated drafts; it cannot make a
  -- suppression/insert decision unsafe. The lock is shared with suppression.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text || E'\\x1f' || p_dedupe_key, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.operating_objective_suppressions suppression
    WHERE suppression.tenant_id = p_tenant_id
      AND suppression.dedupe_key = p_dedupe_key
      AND suppression.source_fingerprint = p_source_fingerprint
      AND (suppression.suppressed_until IS NULL OR suppression.suppressed_until > now())
  ) THEN
    RETURN QUERY SELECT 'suppressed'::text, NULL::jsonb;
    RETURN;
  END IF;

  SELECT * INTO v_objective
  FROM public.operating_objectives candidate
  WHERE candidate.tenant_id = p_tenant_id
    AND candidate.dedupe_key = p_dedupe_key
    AND candidate.status IN ('active', 'queued')
  FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT 'existing'::text, pg_catalog.to_jsonb(v_objective);
    RETURN;
  END IF;

  INSERT INTO public.operating_objectives (
    tenant_id, objective_type, dedupe_key, source_fingerprint, title, explanation,
    evidence, affected_record_ids, priority_score, amount_at_risk, expires_at, status
  ) VALUES (
    p_tenant_id, p_objective_type, p_dedupe_key, p_source_fingerprint, p_title, p_explanation,
    p_evidence, p_affected_record_ids, p_priority_score, p_amount_at_risk, p_expires_at, p_status
  ) RETURNING * INTO v_objective;
  RETURN QUERY SELECT 'inserted'::text, pg_catalog.to_jsonb(v_objective);
END $$;

CREATE FUNCTION public.replace_operating_policies(
  p_tenant_id UUID, p_actor_id UUID, p_automation_paused BOOLEAN, p_policies JSONB
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_policy JSONB; v_rules JSONB; v_quiet JSONB; v_status TEXT; v_action_type TEXT; v_name TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenant_users WHERE tenant_id = p_tenant_id AND user_id = p_actor_id AND role = 'owner') THEN
    RAISE EXCEPTION 'operating-loop owner authority required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_policies) <> 'array' THEN RAISE EXCEPTION 'policies must be an array' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.operating_loop_settings (tenant_id, automation_paused) VALUES (p_tenant_id, p_automation_paused)
    ON CONFLICT (tenant_id) DO UPDATE SET automation_paused = EXCLUDED.automation_paused, updated_at = now();
  UPDATE public.automation_policies SET status = 'revoked', updated_at = now() WHERE tenant_id = p_tenant_id AND status <> 'revoked';
  FOR v_policy IN SELECT value FROM jsonb_array_elements(p_policies) LOOP
    IF jsonb_typeof(v_policy) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_policy) key
      WHERE key NOT IN ('name','actionType','status','eligibilityRules','quietHours')) THEN RAISE EXCEPTION 'policy fields are invalid' USING ERRCODE = '22023'; END IF;
    v_name := btrim(coalesce(v_policy->>'name','')); v_action_type := v_policy->>'actionType'; v_status := v_policy->>'status';
    v_rules := coalesce(v_policy->'eligibilityRules','{}'::jsonb); v_quiet := coalesce(v_policy->'quietHours','{}'::jsonb);
    IF v_name = '' OR v_action_type NOT IN ('confirm_booking','collect_deposit','follow_up') OR v_status NOT IN ('draft','active','paused','revoked')
      OR jsonb_typeof(v_rules) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_rules) key WHERE key <> 'maxAmountAtRisk')
      OR (v_rules ? 'maxAmountAtRisk' AND (jsonb_typeof(v_rules->'maxAmountAtRisk') <> 'number' OR (v_rules->>'maxAmountAtRisk')::numeric < 0))
      OR jsonb_typeof(v_quiet) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_quiet) key WHERE key NOT IN ('start','end','timezone'))
      OR ((v_quiet ? 'start') <> (v_quiet ? 'end')) OR (v_quiet ? 'start' AND ((v_quiet->>'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR (v_quiet->>'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))
      OR (v_quiet ? 'timezone' AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_quiet->>'timezone')) THEN
      RAISE EXCEPTION 'policy is invalid' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.automation_policies (tenant_id,name,action_type,status,eligibility_rules,quiet_hours,approved_by,approved_at)
      VALUES (p_tenant_id,v_name,v_action_type,v_status,v_rules,v_quiet,CASE WHEN v_status='active' THEN p_actor_id END,CASE WHEN v_status='active' THEN now() END);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.queue_operating_delivery(UUID,UUID,UUID,UUID,JSONB,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_operating_suppression(UUID,UUID,UUID,TEXT,TIMESTAMPTZ,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_operating_policies(UUID,UUID,BOOLEAN,JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.persist_operating_objective_draft(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB,NUMERIC,NUMERIC,TIMESTAMPTZ,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_operating_delivery(UUID,UUID,UUID,UUID,JSONB,TEXT),
  public.apply_operating_suppression(UUID,UUID,UUID,TEXT,TIMESTAMPTZ,TEXT), public.replace_operating_policies(UUID,UUID,BOOLEAN,JSONB),
  public.persist_operating_objective_draft(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB,NUMERIC,NUMERIC,TIMESTAMPTZ,TEXT) TO service_role;
COMMIT;
