DROP POLICY IF EXISTS service_consumption_records_service_role ON public.service_consumption_records;
DROP POLICY IF EXISTS service_material_recipe_items_service_role ON public.service_material_recipe_items;
DROP POLICY IF EXISTS service_material_recipes_service_role ON public.service_material_recipes;

DROP TABLE IF EXISTS public.service_consumption_records;
DROP TABLE IF EXISTS public.service_material_recipe_items;
DROP TABLE IF EXISTS public.service_material_recipes;

ALTER TABLE public.products
  DROP COLUMN IF EXISTS pack_size,
  DROP COLUMN IF EXISTS base_uom;
