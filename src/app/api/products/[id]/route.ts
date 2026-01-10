import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { UpdateProductRequest, PRODUCT_ROLE_PERMISSIONS } from '@/types/product-catalogue';
import { getUserRole } from '@/lib/auth/role-utils';

interface RouteParams {
  params: { id: string };
}

/**
 * GET /api/products/[id]
 * Get a specific product by ID
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const id = ctx.request.url.split('/').pop();
    if (!id) throw ApiErrorFactory.badRequest('Product ID required');

    // Get user's tenant(s)
    const { data: tenantUsers } = await ctx.supabase
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', ctx.user.id);

    if (!tenantUsers || tenantUsers.length === 0) {
      throw ApiErrorFactory.forbidden('No tenant access');
    }

    const tenantIds = tenantUsers.map(tu => tu.tenant_id);

    // Get user permissions
    const userRole = await getUserRole(ctx.user.id);
    const permissions = PRODUCT_ROLE_PERMISSIONS[userRole];

    // Fetch product with related data
    const { data: product, error } = await ctx.supabase
      .from('products')
      .select(`
        *,
        category:product_categories!category_id(id, name, description),
        variants:product_variants!product_id(*),
        stock_info:get_product_stock(product_id)
      `)
      .eq('id', id)
      .in('tenant_id', tenantIds)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw ApiErrorFactory.notFound('Product not found');
      }
      throw ApiErrorFactory.internal('Failed to fetch product');
    }

    // Filter out cost prices if user doesn't have permission
    if (!permissions.can_view_cost_prices) {
      const { cost_price_cents, ...productWithoutCost } = product;
      return { product: productWithoutCost };
    }

    return { product };
  },
  'GET',
  { auth: true }
);

/**
 * PUT /api/products/[id]
 * Update a specific product
 */
export const PUT = createHttpHandler(
  async (ctx) => {
    const id = ctx.request.url.split('/').pop();
    if (!id) throw ApiErrorFactory.badRequest('Product ID required');

    // Get user's tenant(s)
    const { data: tenantUsers } = await ctx.supabase
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', ctx.user.id);

    if (!tenantUsers || tenantUsers.length === 0) {
      throw ApiErrorFactory.forbidden('No tenant access');
    }

    const tenantIds = tenantUsers.map(tu => tu.tenant_id);

    // Get user permissions
    const userRole = await getUserRole(ctx.user.id);
    const permissions = PRODUCT_ROLE_PERMISSIONS[userRole];

    // Verify product exists and user has access
    const { data: existingProduct } = await ctx.supabase
      .from('products')
      .select('id, tenant_id, sku, stock_quantity, track_inventory')
      .eq('id', id)
      .in('tenant_id', tenantIds)
      .single();

    if (!existingProduct) {
      throw ApiErrorFactory.notFound('Product not found');
    }

    const body: UpdateProductRequest = await ctx.request.json();

    // Validate price if provided
    if (body.price_cents !== undefined && body.price_cents < 0) {
      throw ApiErrorFactory.badRequest('Price must be non-negative');
    }

    // Check SKU uniqueness if being updated
    if (body.sku && body.sku !== existingProduct.sku) {
      const { data: existingSku } = await ctx.supabase
        .from('products')
        .select('id')
        .eq('tenant_id', existingProduct.tenant_id)
        .eq('sku', body.sku)
        .neq('id', id)
        .limit(1);

      if (existingSku && existingSku.length > 0) {
        throw ApiErrorFactory.conflict('SKU already exists');
      }
    }

    // Validate category if being updated
    if (body.category_id) {
      const { data: category } = await ctx.supabase
        .from('product_categories')
        .select('id')
        .eq('id', body.category_id)
        .eq('tenant_id', existingProduct.tenant_id)
        .eq('is_active', true)
        .limit(1)
        .single();

      if (!category) {
        throw ApiErrorFactory.badRequest('Category not found or inactive');
      }
    }

    // Prepare update data (only include provided fields)
    const updateData: Partial<any> = {
      updated_at: new Date().toISOString(),
    };

    // Handle pricing updates (only if user has permission)
    if (permissions.can_set_pricing) {
      if (body.price_cents !== undefined) updateData.price_cents = body.price_cents;
      if (body.currency !== undefined) updateData.currency = body.currency;
    }

    // Handle cost price updates (only if user has permission)
    if (permissions.can_view_cost_prices) {
      if (body.cost_price_cents !== undefined) updateData.cost_price_cents = body.cost_price_cents;
    }

    // Handle other field updates
    if (body.name !== undefined) updateData.name = body.name.trim();
    if (body.description !== undefined) updateData.description = body.description?.trim();
    if (body.short_description !== undefined) updateData.short_description = body.short_description?.trim();
    if (body.sku !== undefined) updateData.sku = body.sku?.trim().toUpperCase();
    if (body.category_id !== undefined) updateData.category_id = body.category_id;
    if (body.brand !== undefined) updateData.brand = body.brand?.trim();
    if (body.weight_grams !== undefined) updateData.weight_grams = body.weight_grams;
    if (body.dimensions !== undefined) updateData.dimensions = body.dimensions;
    if (body.is_active !== undefined) updateData.is_active = body.is_active;
    if (body.is_featured !== undefined) updateData.is_featured = body.is_featured;
    if (body.is_digital !== undefined) updateData.is_digital = body.is_digital;
    if (body.upsell_priority !== undefined) updateData.upsell_priority = body.upsell_priority;
    if (body.frequently_bought_together !== undefined) updateData.frequently_bought_together = body.frequently_bought_together;
    if (body.tags !== undefined) updateData.tags = body.tags;
    if (body.images !== undefined) updateData.images = body.images;
    if (body.metadata !== undefined) updateData.metadata = body.metadata;

    // Handle inventory updates (only if user has permission)
    if (permissions.can_manage_inventory) {
      if (body.track_inventory !== undefined) updateData.track_inventory = body.track_inventory;
      if (body.low_stock_threshold !== undefined) updateData.low_stock_threshold = body.low_stock_threshold;
      
      // Handle stock quantity updates with movement tracking
      if (body.stock_quantity !== undefined && existingProduct.track_inventory) {
        const quantityChange = body.stock_quantity - existingProduct.stock_quantity;
        
        if (quantityChange !== 0) {
          // Log inventory movement
          await ctx.supabase
            .from('inventory_movements')
            .insert({
              tenant_id: existingProduct.tenant_id,
              product_id: id,
              movement_type: 'adjustment',
              quantity_change: quantityChange,
              previous_quantity: existingProduct.stock_quantity,
              new_quantity: body.stock_quantity,
              reason: 'Manual adjustment via product update',
              performed_by: ctx.user.id,
            });
        }
        
        updateData.stock_quantity = body.stock_quantity;
      }
    }

    // Perform the update
    const { data: updatedProduct, error } = await ctx.supabase
      .from('products')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        category:product_categories!category_id(id, name, description),
        variants:product_variants!product_id(*)
      `)
      .single();

    if (error) {
      if (error.code === '23505') {
        throw ApiErrorFactory.conflict('SKU already exists');
      }
      throw ApiErrorFactory.internal('Failed to update product');
    }

    // Filter out cost prices if user doesn't have permission
    if (!permissions.can_view_cost_prices) {
      const { cost_price_cents, ...productWithoutCost } = updatedProduct;
      return { 
        message: 'Product updated successfully',
        product: productWithoutCost 
      };
    }

    return { 
      message: 'Product updated successfully',
      product: updatedProduct 
    };
  },
  'PUT',
  { auth: true, roles: ['admin', 'manager', 'product_manager'] }
);

/**
 * DELETE /api/products/[id]
 * Delete a specific product (soft delete by setting is_active = false)
 */
export const DELETE = createHttpHandler(
  async (ctx) => {
    const id = ctx.request.url.split('/').pop();
    if (!id) throw ApiErrorFactory.badRequest('Product ID required');

    // Get user's tenant(s)
    const { data: tenantUsers } = await ctx.supabase
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', ctx.user.id);

    if (!tenantUsers || tenantUsers.length === 0) {
      throw ApiErrorFactory.forbidden('No tenant access');
    }

    const tenantIds = tenantUsers.map(tu => tu.tenant_id);

    // Verify product exists and user has access
    const { data: existingProduct } = await ctx.supabase
      .from('products')
      .select('id, tenant_id, name')
      .eq('id', id)
      .in('tenant_id', tenantIds)
      .single();

    if (!existingProduct) {
      throw ApiErrorFactory.notFound('Product not found');
    }

    // Check for URL parameter to determine if this should be a hard delete
    const url = new URL(ctx.request.url);
    const forceDelete = url.searchParams.get('force') === 'true';

    if (forceDelete) {
      // Hard delete - remove from database
      const { error } = await ctx.supabase
        .from('products')
        .delete()
        .eq('id', id);

      if (error) {
        throw ApiErrorFactory.internal('Failed to delete product');
      }

      return { 
        message: 'Product permanently deleted',
        product_id: id 
      };
    } else {
      // Soft delete - set is_active to false
      const { data: updatedProduct, error } = await ctx.supabase
        .from('products')
        .update({ 
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select('id, name, is_active')
        .single();

      if (error) {
        throw ApiErrorFactory.internal('Failed to deactivate product');
      }

      return { 
        message: 'Product deactivated successfully',
        product: updatedProduct 
      };
    }
  },
  'DELETE',
  { auth: true, roles: ['admin', 'manager', 'product_manager'] }
);