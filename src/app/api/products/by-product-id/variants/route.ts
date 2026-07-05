export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { CreateVariantRequest } from '@/types/product-catalogue';

/**
 * GET /api/products/by-product-id/variants
 * List variants for a specific product
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const productId = url.searchParams.get('product_id');
    
    if (!productId) {
      throw ApiErrorFactory.badRequest('product_id query parameter required');
    }

    // Verify product belongs to user's tenant
    const { data: product } = await ctx.supabase
      .from('products')
      .select('id, tenant_id')
      .eq('id', productId)
      .eq('tenant_id', ctx.user!.tenantId)
      .single();

    if (!product) {
      throw ApiErrorFactory.notFound('Product not found');
    }

    // Get variants for the product (stock is product_variants.stock_quantity, via *)
    const { data: variants, error } = await ctx.supabase
      .from('product_variants')
      .select('*')
      .eq('product_id', productId)
      .eq('tenant_id', ctx.user!.tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      throw ApiErrorFactory.internalServerError(new Error('Failed to fetch variants'));
    }

    return {
      variants: variants || [],
      total: variants?.length || 0
    };
  },
  'GET',
  { auth: true }
);

/**
 * POST /api/products/by-product-id/variants
 * Create a new variant for a product
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const productId = url.searchParams.get('product_id');
    
    if (!productId) {
      throw ApiErrorFactory.badRequest('product_id query parameter required');
    }

    const body = await ctx.request.json();
    const {
      name,
      description,
      sku,
      price_adjustment_cents,
      weight_grams,
      volume_ml,
      is_active = true,
      attributes = {}
    }: CreateVariantRequest = body;

    // Validate required fields
    if (!name?.trim()) {
      throw ApiErrorFactory.badRequest('Variant name is required');
    }

    // Check if product exists and user has access
    const { data: product, error: productError } = await ctx.supabase
      .from('products')
      .select('id, tenant_id')
      .eq('id', productId)
      .eq('tenant_id', ctx.user!.tenantId)
      .single();

    if (productError || !product) {
      throw ApiErrorFactory.notFound('Product not found');
    }

    // Check for duplicate SKU if provided
    if (sku) {
      const { data: existingSku } = await ctx.supabase
        .from('product_variants')
        .select('id')
        .eq('sku', sku.trim().toUpperCase())
        .eq('tenant_id', ctx.user!.tenantId)
        .single();

      if (existingSku) {
        throw ApiErrorFactory.conflict('SKU already exists');
      }
    }

    // Create the variant
    const { data: variant, error: variantError } = await ctx.supabase
      .from('product_variants')
      .insert({
        product_id: productId,
        tenant_id: ctx.user!.tenantId,
        name: name.trim(),
        description: description?.trim() || null,
        sku: sku?.trim().toUpperCase() || null,
        price_adjustment_cents: price_adjustment_cents || 0,
        weight_grams: weight_grams || null,
        volume_ml: volume_ml || null,
        is_active,
        attributes: attributes || {}
      })
      .select()
      .single();

    if (variantError) {
      throw ApiErrorFactory.internalServerError(new Error('Failed to create variant'));
    }

    // Stock lives on product_variants.stock_quantity (migration 117); no separate
    // inventory table to initialize. Adjustments flow through the update_inventory RPC.

    return {
      success: true,
      variant
    };
  },
  'POST',
  { auth: true, roles: ['admin', 'manager', 'product_manager'] }
);