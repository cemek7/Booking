BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_customer_phone(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  digits text;
BEGIN
  IF raw IS NULL OR btrim(raw) = '' THEN
    RETURN NULL;
  END IF;

  digits := regexp_replace(raw, '\D', '', 'g');

  IF digits = '' THEN
    RETURN NULL;
  END IF;

  IF left(digits, 3) = '234' AND length(digits) = 13 THEN
    RETURN '+' || digits;
  END IF;

  IF left(digits, 1) = '0' AND length(digits) = 11 THEN
    RETURN '+234' || substring(digits from 2);
  END IF;

  IF length(digits) = 10 THEN
    RETURN '+234' || digits;
  END IF;

  IF left(digits, 1) <> '0' AND left(digits, 3) <> '234' AND length(digits) >= 8 THEN
    RETURN '+' || digits;
  END IF;

  RETURN NULL;
END;
$$;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS normalized_phone text,
  ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.sync_customer_normalized_phone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.normalized_phone := public.normalize_customer_phone(coalesce(NEW.phone, NEW.phone_number));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_customer_normalized_phone ON public.customers;
CREATE TRIGGER trg_sync_customer_normalized_phone
BEFORE INSERT OR UPDATE OF phone, phone_number
ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.sync_customer_normalized_phone();

UPDATE public.customers
SET normalized_phone = public.normalize_customer_phone(coalesce(phone, phone_number))
WHERE normalized_phone IS DISTINCT FROM public.normalize_customer_phone(coalesce(phone, phone_number));

CREATE INDEX IF NOT EXISTS idx_customers_norm_phone
  ON public.customers (tenant_id, normalized_phone)
  WHERE merged_into IS NULL AND normalized_phone IS NOT NULL;

ALTER TABLE public.customer_profile_summary
  ADD COLUMN IF NOT EXISTS lifetime_value_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_spend_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outstanding_balance_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS repeat_interval_days integer,
  ADD COLUMN IF NOT EXISTS preferred_staff_id uuid,
  ADD COLUMN IF NOT EXISTS no_show_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancellation_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_computed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.customer_merge_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_a uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  customer_b uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  score numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'merged', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  merged_at timestamptz,
  dismissed_at timestamptz,
  merged_by uuid,
  dismissed_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT customer_merge_candidates_distinct_pair CHECK (customer_a <> customer_b)
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_merge_candidates_unique_pair
  ON public.customer_merge_candidates (
    tenant_id,
    LEAST(customer_a, customer_b),
    GREATEST(customer_a, customer_b)
  );

CREATE INDEX IF NOT EXISTS customer_merge_candidates_tenant_status
  ON public.customer_merge_candidates (tenant_id, status, score DESC, created_at DESC);

CREATE OR REPLACE FUNCTION public.merge_customers_tx(
  p_tenant_id uuid,
  p_survivor_id uuid,
  p_loser_id uuid
)
RETURNS TABLE (survivor_id uuid, loser_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  survivor public.customers%ROWTYPE;
  loser public.customers%ROWTYPE;
  merged_notes text;
  merged_tags text[];
BEGIN
  IF p_survivor_id = p_loser_id THEN
    RAISE EXCEPTION 'survivor and loser must be different customers';
  END IF;

  SELECT * INTO survivor
  FROM public.customers
  WHERE tenant_id = p_tenant_id
    AND id = p_survivor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'survivor customer not found';
  END IF;

  SELECT * INTO loser
  FROM public.customers
  WHERE tenant_id = p_tenant_id
    AND id = p_loser_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'loser customer not found';
  END IF;

  IF loser.merged_into IS NOT NULL THEN
    RAISE EXCEPTION 'loser customer already merged';
  END IF;

  merged_notes := CASE
    WHEN coalesce(survivor.notes, '') = '' THEN loser.notes
    WHEN coalesce(loser.notes, '') = '' THEN survivor.notes
    ELSE survivor.notes || E'\n--- merged customer notes ---\n' || loser.notes
  END;

  merged_tags := ARRAY(
    SELECT DISTINCT tag
    FROM unnest(coalesce(survivor.tags, '{}'::text[]) || coalesce(loser.tags, '{}'::text[])) AS tag
    WHERE tag IS NOT NULL AND btrim(tag) <> ''
  );

  UPDATE public.reservations
  SET customer_id = p_survivor_id
  WHERE tenant_id = p_tenant_id
    AND customer_id = p_loser_id;

  UPDATE public.retail_orders
  SET customer_id = p_survivor_id
  WHERE tenant_id = p_tenant_id
    AND customer_id = p_loser_id;

  UPDATE public.chats
  SET customer_id = p_survivor_id
  WHERE tenant_id = p_tenant_id
    AND customer_id = p_loser_id;

  UPDATE public.reviews
  SET customer_id = p_survivor_id
  WHERE tenant_id = p_tenant_id
    AND customer_id = p_loser_id;

  UPDATE public.analytics_events
  SET customer_id = p_survivor_id
  WHERE tenant_id = p_tenant_id
    AND customer_id = p_loser_id;

  UPDATE public.reservation_services
  SET customer_id = p_survivor_id
  WHERE tenant_id = p_tenant_id
    AND customer_id = p_loser_id;

  UPDATE public.customer_analytics
  SET customer_id = p_survivor_id
  WHERE tenant_id = p_tenant_id
    AND customer_id = p_loser_id;

  UPDATE public.sias_outcome_attributions
  SET customer_id = p_survivor_id
  WHERE tenant_id = p_tenant_id
    AND customer_id = p_loser_id;

  UPDATE public.sias_campaign_runs
  SET target_customer_id = p_survivor_id
  WHERE tenant_id = p_tenant_id
    AND target_customer_id = p_loser_id;

  DELETE FROM public.customer_profile_summary
  WHERE tenant_id = p_tenant_id
    AND customer_id = p_loser_id;

  UPDATE public.customers
  SET notes = merged_notes,
      tags = coalesce(merged_tags, '{}'::text[]),
      name = coalesce(name, loser.name, loser.customer_name),
      customer_name = coalesce(customer_name, loser.customer_name, loser.name),
      email = coalesce(email, loser.email),
      phone = coalesce(phone, loser.phone, loser.phone_number),
      phone_number = coalesce(phone_number, loser.phone_number, loser.phone),
      normalized_phone = coalesce(normalized_phone, loser.normalized_phone),
      updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND id = p_survivor_id;

  UPDATE public.customers
  SET merged_into = p_survivor_id,
      updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND id = p_loser_id;

  UPDATE public.customer_merge_candidates
  SET status = 'merged',
      merged_at = now(),
      updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND (
      (customer_a = p_survivor_id AND customer_b = p_loser_id)
      OR (customer_a = p_loser_id AND customer_b = p_survivor_id)
    );

  survivor_id := p_survivor_id;
  loser_id := p_loser_id;
  RETURN NEXT;
END;
$$;

ALTER TABLE public.customer_merge_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_merge_candidates_service_role ON public.customer_merge_candidates;
CREATE POLICY customer_merge_candidates_service_role
  ON public.customer_merge_candidates
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT EXECUTE ON FUNCTION public.merge_customers_tx(uuid, uuid, uuid) TO service_role;

COMMIT;
