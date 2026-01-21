import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

const UpdateVariantSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().nullable().optional(),
  sku: z.string().trim().toUpperCase().nullable().optional(),
  price_adjustment_cents: z.number().int().optional(),
  weight_grams: z.number().int().positive().nullable().optional(),
  volume_ml: z.number().int().positive().nullable().optional(),
  is_active: z.boolean().optional(),
  attributes: z.record(z.unknown()).optional(),
});

/**
 * GET /api/products/by-product-id/variants/[variantId]
 * Get a specific product variant.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const variantId = ctx.params?.variantId;
    if (!variantId) {
      throw ApiErrorFactory.validationError({ variantId: 'Variant ID is required' });
    }

    const tenantId = ctx.user?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.forbidden('Tenant ID required');
    }

    const { data: variant, error } = await ctx.supabase
      .from('product_variants')
      .select(`
        *,
        product:products!product_id(
          id, name, price_cents, currency, tenant_id,
          category:product_categories!category_id(id, name)
        ),
        product_inventory(
          current_stock,
          reserved_stock,
          available_stock
        )
      `)
      .eq('id', variantId)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !variant) {
      throw ApiErrorFactory.notFound('Variant');
    }

    // Calculate final price
    const product = variant.product as { price_cents?: number } | null;
    const variantWithPrice = {
      ...variant,
      final_price_cents: (product?.price_cents || 0) + (variant.price_adjustment_cents || 0),
    };

    return { variant: variantWithPrice };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);

/**
 * PUT /api/products/by-product-id/variants/[variantId]
 * Update a specific product variant.
 */
export const PUT = createHttpHandler(
  async (ctx) => {
    const variantId = ctx.params?.variantId;
    if (!variantId) {
      throw ApiErrorFactory.validationError({ variantId: 'Variant ID is required' });
    }

    const tenantId = ctx.user?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.forbidden('Tenant ID required');
    }

    const body = await ctx.request.json();
    const bodyValidation = UpdateVariantSchema.safeParse(body);
    if (!bodyValidation.success) {
      throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
    }

    const updateData = bodyValidation.data;
    if (Object.keys(updateData).length === 0) {
      throw ApiErrorFactory.validationError({ body: 'No update fields provided' });
    }

    // Check if variant exists
    const { data: existingVariant, error: variantError } = await ctx.supabase
      .from('product_variants')
      .select('id, sku')
      .eq('id', variantId)
      .eq('tenant_id', tenantId)
      .single();

    if (variantError || !existingVariant) {
      throw ApiErrorFactory.notFound('Variant');
    }

    // Check for duplicate SKU if being updated
    if (updateData.sku && updateData.sku !== existingVariant.sku) {
      const { data: existingSku } = await ctx.supabase
        .from('product_variants')
        .select('id')
        .eq('sku', updateData.sku)
        .eq('tenant_id', tenantId)
        .neq('id', variantId)
        .single();

      if (existingSku) {
        throw ApiErrorFactory.conflict('SKU already exists');
      }
    }

    const { data: variant, error: updateError } = await ctx.supabase
      .from('product_variants')
      .update({
        ...updateData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', variantId)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (updateError) {
      throw ApiErrorFactory.databaseError(updateError);
    }

    return { success: true, variant };
  },
  'PUT',
  { auth: true, roles: ['owner', 'manager'] }
);

/**
 * DELETE /api/products/by-product-id/variants/[variantId]
 * Delete (soft-delete) a product variant.
 */
export const DELETE = createHttpHandler(
  async (ctx) => {
    const variantId = ctx.params?.variantId;
    if (!variantId) {
      throw ApiErrorFactory.validationError({ variantId: 'Variant ID is required' });
    }

    const tenantId = ctx.user?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.forbidden('Tenant ID required');
    }

    const url = new URL(ctx.request.url);
    const forceDelete = url.searchParams.get('force') === 'true';

    // Check if variant exists
    const { data: existingVariant, error: variantError } = await ctx.supabase
      .from('product_variants')
      .select('id, name, stock_quantity')
      .eq('id', variantId)
      .eq('tenant_id', tenantId)
      .single();

    if (variantError || !existingVariant) {
      throw ApiErrorFactory.notFound('Variant');
    }

    // Check if variant is being used in any bookings/orders
    const { data: bookingItems } = await ctx.supabase
      .from('booking_items')
      .select('id')
      .eq('variant_id', variantId)
      .eq('tenant_id', tenantId)
      .limit(1);

    if (bookingItems && bookingItems.length > 0) {
      throw ApiErrorFactory.conflict('Cannot delete variant that is used in bookings');
    }

    if (!forceDelete) {
      // Soft delete - set is_active to false
      const { data: updatedVariant, error } = await ctx.supabase
        .from('product_variants')
        .update({
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', variantId)
        .select('id, name, is_active')
        .single();

      if (error) {
        throw ApiErrorFactory.databaseError(error);
      }

      return { message: 'Product variant deactivated successfully', variant: updatedVariant };
    } else {
      // Hard delete - check for inventory first
      if (existingVariant.stock_quantity && existingVariant.stock_quantity > 0) {
        throw ApiErrorFactory.conflict('Cannot delete variant with stock. Reduce stock to zero before deletion.');
      }

      const { error } = await ctx.supabase
        .from('product_variants')
        .delete()
        .eq('id', variantId);

      if (error) {
        throw ApiErrorFactory.databaseError(error);
      }

      return { message: 'Product variant permanently deleted', variant_id: variantId };
    }
  },
  'DELETE',
  { auth: true, roles: ['owner', 'manager'] }
);
