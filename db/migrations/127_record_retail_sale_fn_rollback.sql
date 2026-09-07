BEGIN;

DROP FUNCTION IF EXISTS public.refund_retail_sale_tx(uuid, uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.record_retail_sale_tx(uuid, uuid, jsonb, uuid, text, uuid, text, text, text, jsonb);

COMMIT;
