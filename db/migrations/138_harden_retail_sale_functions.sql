-- Hardening for the SECURITY DEFINER retail-sale functions introduced in 127.
-- PostgreSQL grants function EXECUTE to PUBLIC by default; these privileged
-- functions must only be callable by Booka's server-side service role.
BEGIN;

ALTER FUNCTION public.record_retail_sale_tx(uuid, uuid, jsonb, uuid, text, uuid, text, text, text, jsonb)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.refund_retail_sale_tx(uuid, uuid, uuid, text, text)
  SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION public.record_retail_sale_tx(uuid, uuid, jsonb, uuid, text, uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_retail_sale_tx(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_retail_sale_tx(uuid, uuid, jsonb, uuid, text, uuid, text, text, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_retail_sale_tx(uuid, uuid, uuid, text, text)
  TO service_role;

COMMIT;
