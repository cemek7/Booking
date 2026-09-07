BEGIN;

ALTER TABLE public.reconciliation_items
  DROP COLUMN IF EXISTS anomaly_id;

DROP TABLE IF EXISTS public.business_anomalies CASCADE;

COMMIT;
