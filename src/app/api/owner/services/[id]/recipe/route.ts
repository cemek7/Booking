export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createHttpHandler, getRouteParam, getVerifiedTenantId, type RouteContext } from '@/lib/error-handling/route-handler';
import { convert, type InventoryUom } from '@/lib/inventory/uom';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

const RecipeItemSchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().optional(),
  default_quantity: z.number().positive(),
  uom: z.enum(['piece', 'pack', 'ml', 'l', 'g', 'kg']),
  is_optional: z.boolean().optional(),
});

const RecipeSchema = z.object({
  is_active: z.boolean().optional(),
  notes: z.string().trim().nullable().optional(),
  items: z.array(RecipeItemSchema).default([]),
});

type ProductUomRow = {
  id: string;
  base_uom: InventoryUom | null;
  pack_size: number | null;
};

async function validateRecipeItems(
  ctx: RouteContext,
  tenantId: string,
  items: Array<z.infer<typeof RecipeItemSchema>>,
) {
  if (items.length === 0) return;

  const productIds = [...new Set(items.map((item) => item.product_id))];
  const { data, error } = await ctx.supabase
    .from('products')
    .select('id, base_uom, pack_size')
    .eq('tenant_id', tenantId)
    .in('id', productIds);

  if (error) throw ApiErrorFactory.databaseError(error);

  const productMap = new Map(
    ((data ?? []) as ProductUomRow[]).map((product) => [product.id, product]),
  );

  items.forEach((item, index) => {
    const product = productMap.get(item.product_id);
    if (!product) {
      throw ApiErrorFactory.notFound(`Product ${item.product_id}`);
    }

    if (!product.base_uom) {
      throw ApiErrorFactory.validationError(`Recipe item ${index + 1}: product ${item.product_id} is missing a base_uom`);
    }

    try {
      convert(item.default_quantity, item.uom, product.base_uom, product.pack_size);
    } catch (error) {
      throw ApiErrorFactory.validationError(
        `Recipe item ${index + 1}: ${error instanceof Error ? error.message : 'Invalid unit conversion'}`,
      );
    }
  });
}

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const serviceId = getRouteParam(ctx.params, 'id');
    const admin = createSupabaseAdminClient();

    const { data, error } = await admin
      .from('service_material_recipes')
      .select(`
        id, tenant_id, service_id, is_active, notes, created_at, updated_at,
        service_material_recipe_items (
          id, product_id, variant_id, default_quantity, uom, is_optional, created_at, updated_at
        )
      `)
      .eq('tenant_id', tenantId)
      .eq('service_id', serviceId)
      .maybeSingle();

    if (error) throw ApiErrorFactory.databaseError(error);
    return { recipe: data ?? null };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'], permissions: [BOOKA_PERMISSIONS.MANAGE_PRODUCTS] },
);

export const PUT = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const serviceId = getRouteParam(ctx.params, 'id');
    const admin = createSupabaseAdminClient();
    const parsed = RecipeSchema.safeParse((await ctx.request.json().catch(() => ({}))) as unknown);

    if (!parsed.success) {
      throw ApiErrorFactory.validationError({ issues: parsed.error.issues });
    }

    await validateRecipeItems({ ...ctx, supabase: admin }, tenantId, parsed.data.items);

    const { data: recipe, error: recipeError } = await admin
      .from('service_material_recipes')
      .upsert(
        {
          tenant_id: tenantId,
          service_id: serviceId,
          is_active: parsed.data.is_active ?? true,
          notes: parsed.data.notes ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,service_id' },
      )
      .select('id, tenant_id, service_id, is_active, notes, created_at, updated_at')
      .single();

    if (recipeError || !recipe) {
      throw ApiErrorFactory.databaseError(recipeError ?? new Error('Failed to save recipe'));
    }

    const { error: deleteError } = await admin
      .from('service_material_recipe_items')
      .delete()
      .eq('recipe_id', recipe.id);

    if (deleteError) throw ApiErrorFactory.databaseError(deleteError);

    if (parsed.data.items.length > 0) {
      const { error: insertError } = await admin
        .from('service_material_recipe_items')
        .insert(
          parsed.data.items.map((item) => ({
            tenant_id: tenantId,
            recipe_id: recipe.id,
            product_id: item.product_id,
            variant_id: item.variant_id ?? null,
            default_quantity: item.default_quantity,
            uom: item.uom,
            is_optional: item.is_optional ?? false,
            updated_at: new Date().toISOString(),
          })),
        );

      if (insertError) throw ApiErrorFactory.databaseError(insertError);
    }

    return { recipe };
  },
  'PUT',
  { auth: true, roles: ['owner', 'manager'], permissions: [BOOKA_PERMISSIONS.MANAGE_PRODUCTS] },
);
