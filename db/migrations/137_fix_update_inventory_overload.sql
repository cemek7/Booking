BEGIN;

-- Fix an ambiguous-overload bug that breaks every inventory-tracked retail sale
-- and refund at runtime.
--
-- Migration 130 added public.update_inventory(..., p_location_id uuid) as a NEW
-- overload. CREATE OR REPLACE only replaces a function with an IDENTICAL argument
-- signature, so adding p_location_id did not replace the 10-argument version from
-- migration 126 — it created a second function. A 10-argument call, as made by
-- record_retail_sale_tx and refund_retail_sale_tx (migration 127):
--
--     PERFORM public.update_inventory(tenant, product, variant, -qty, 'sale',
--             'retail_order', order_id::text, reason, actor, NULL);
--
-- then matches BOTH the 10-arg and the 11-arg overloads (the latter via its
-- p_location_id default), producing:
--
--     ERROR: function public.update_inventory(uuid, uuid, uuid, integer, ...,
--            uuid, unknown) is not unique
--
-- i.e. no POS/retail sale or refund can record inventory. Caught by the live
-- money-path smoke (tests/live-smoke/money-paths-live.smoke.test.ts).
--
-- Fix: drop the superseded 10-argument overload. The 11-argument version
-- (p_location_id DEFAULT NULL, migration 130) already handles 10-argument callers
-- via the default, so every existing call site keeps working and now resolves to a
-- single, unambiguous function.

DROP FUNCTION IF EXISTS public.update_inventory(
  uuid, uuid, uuid, integer, text, text, text, text, uuid, integer
);

COMMIT;
