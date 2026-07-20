DROP POLICY IF EXISTS stock_count_items_service_role ON public.stock_count_items;
DROP POLICY IF EXISTS stock_count_sessions_service_role ON public.stock_count_sessions;
DROP POLICY IF EXISTS inventory_locations_service_role ON public.inventory_locations;

DROP TABLE IF EXISTS public.stock_count_items CASCADE;
DROP TABLE IF EXISTS public.stock_count_sessions CASCADE;

ALTER TABLE public.inventory_movements
  DROP COLUMN IF EXISTS location_id;

DROP TABLE IF EXISTS public.inventory_locations CASCADE;
