import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { Product, ProductListQuery, CreateProductRequest, PRODUCT_ROLE_PERMISSIONS } from '@/types/product-catalogue';
import { getUserRole } from '@/lib/auth/role-utils';

/**
 * GET /api/products
 * List products with filtering, search, and pagination
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const query: ProductListQuery = {
      category_id: url.searchParams.get('category_id') || undefined,
      status: (url.searchParams.get('status') as any) || 'all',
      search: url.searchParams.get('search') || undefined,
      tags: url.searchParams.get('tags')?.split(',').filter(Boolean) || undefined,
      price_min: url.searchParams.get('price_min') ? parseInt(url.searchParams.get('price_min')!) : undefined,
      price_max: url.searchParams.get('price_max') ? parseInt(url.searchParams.get('price_max')!) : undefined,
      sort: (url.searchParams.get('sort') as any) || 'created_at',
      order: (url.searchParams.get('order') as 'asc' | 'desc') || 'desc',
      page: parseInt(url.searchParams.get('page') || '1'),
      limit: Math.min(parseInt(url.searchParams.get('limit') || '20'), 100),
      include_variants: url.searchParams.get('include_variants') === 'true',
      include_stock_info: url.searchParams.get('include_stock_info') === 'true',
    };

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

    // Build base query
    let queryBuilder = ctx.supabase
      .from('products')
      .select(`
        *,
        category:product_categories!category_id(id, name, description),
        ${query.include_variants ? 'variants:product_variants!product_id(*)' : ''},
        ${query.include_stock_info ? 'stock_info:get_product_stock(product_id)' : ''}
      `)
      .in('tenant_id', tenantIds);

    // Apply filters
    if (query.category_id) {
      queryBuilder = queryBuilder.eq('category_id', query.category_id);
    }

    if (query.status && query.status !== 'all') {
      switch (query.status) {
        case 'active':
          queryBuilder = queryBuilder.eq('is_active', true);
          break;
        case 'inactive':
          queryBuilder = queryBuilder.eq('is_active', false);
          break;
        case 'featured':
          queryBuilder = queryBuilder.eq('is_featured', true);
          break;
        case 'low_stock':
          queryBuilder = queryBuilder
            .eq('track_inventory', true)
            .lte('stock_quantity', 'low_stock_threshold');
          break;
        case 'out_of_stock':
          queryBuilder = queryBuilder
            .eq('track_inventory', true)
            .eq('stock_quantity', 0);
          break;
      }
    }

    // Price range filter
    if (query.price_min !== undefined) {
      queryBuilder = queryBuilder.gte('price_cents', query.price_min);
    }
    if (query.price_max !== undefined) {
      queryBuilder = queryBuilder.lte('price_cents', query.price_max);
    }

    // Tags filter
    if (query.tags && query.tags.length > 0) {
      queryBuilder = queryBuilder.overlaps('tags', query.tags);
    }

    // Text search
    if (query.search) {
      queryBuilder = queryBuilder.textSearch('name,description,brand', query.search, {
        type: 'websearch',
        config: 'english'
      });
    }

    // Sorting
    if (query.sort && query.order) {
      queryBuilder = queryBuilder.order(query.sort, { ascending: query.order === 'asc' });
    }

    // Pagination
    const from = (query.page! - 1) * query.limit!;
    const to = from + query.limit! - 1;
    
    queryBuilder = queryBuilder.range(from, to);

    const { data: products, error, count } = await queryBuilder;

    if (error) {
      throw ApiErrorFactory.internal('Failed to fetch products');
    }

    // Filter out cost prices if user doesn't have permission
    const sanitizedProducts = products?.map(product => {
      if (!permissions.can_view_cost_prices) {
        const { cost_price_cents, ...productWithoutCost } = product;
        return productWithoutCost;
      }
      return product;
    });

    return {
      products: sanitizedProducts || [],
      pagination: {
        page: query.page,
        limit: query.limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / query.limit!),
      }
    };
  },
  'GET',
  { auth: true }
);

/**
 * POST /api/products
 * Create a new product
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const body: CreateProductRequest = await ctx.request.json();

    // Validate required fields
    if (!body.name || body.price_cents === undefined) {
      throw ApiErrorFactory.badRequest('Missing required fields: name, price_cents');
    }

    // Validate price
    if (body.price_cents < 0) {
      throw ApiErrorFactory.badRequest('Price must be non-negative');
    }

    // Get user's tenant
    const { data: tenantUsers } = await ctx.supabase
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', ctx.user.id)
      .limit(1)
      .single();

    if (!tenantUsers) {
      throw ApiErrorFactory.forbidden('No tenant access');
    }

    // Check SKU uniqueness if provided
    if (body.sku) {
      const { data: existingSku } = await ctx.supabase
        .from('products')
        .select('id')
        .eq('tenant_id', tenantUsers.tenant_id)
        .eq('sku', body.sku)
        .limit(1);

      if (existingSku && existingSku.length > 0) {
        throw ApiErrorFactory.conflict('SKU already exists');
      }
    }

    // Validate category if provided
    if (body.category_id) {
      const { data: category } = await ctx.supabase
        .from('product_categories')
        .select('id')
        .eq('id', body.category_id)
        .eq('tenant_id', tenantUsers.tenant_id)
        .eq('is_active', true)
        .limit(1)
        .single();

      if (!category) {
        throw ApiErrorFactory.badRequest('Category not found or inactive');
      }
    }

    // Prepare product data
    const productData = {
      tenant_id: tenantUsers.tenant_id,
      name: body.name.trim(),
      description: body.description?.trim(),
      short_description: body.short_description?.trim(),
      sku: body.sku?.trim().toUpperCase(),
      category_id: body.category_id,
      price_cents: body.price_cents,
      currency: body.currency || 'USD',
      cost_price_cents: body.cost_price_cents || 0,
      track_inventory: body.track_inventory || false,
      stock_quantity: body.stock_quantity || 0,
      low_stock_threshold: body.low_stock_threshold || 5,
      brand: body.brand?.trim(),
      weight_grams: body.weight_grams,
      dimensions: body.dimensions || {},
      is_active: body.is_active !== false,
      is_featured: body.is_featured || false,
      is_digital: body.is_digital || false,
      upsell_priority: body.upsell_priority || 0,
      frequently_bought_together: body.frequently_bought_together || [],
      tags: body.tags || [],
      images: body.images || [],
      metadata: body.metadata || {},
    };

    const { data: product, error } = await ctx.supabase
      .from('products')
      .insert(productData)
      .select(`
        *,
        category:product_categories!category_id(id, name, description)
      `)
      .single();

    if (error) {
      if (error.code === '23505') {
        throw ApiErrorFactory.conflict('SKU already exists');
      }
      throw ApiErrorFactory.internal('Failed to create product');
    }

    // Log inventory movement if tracking inventory
    if (productData.track_inventory && productData.stock_quantity > 0) {
      await ctx.supabase
        .from('inventory_movements')
        .insert({
          tenant_id: tenantUsers.tenant_id,
          product_id: product.id,
          movement_type: 'adjustment',
          quantity_change: productData.stock_quantity,
          previous_quantity: 0,
          new_quantity: productData.stock_quantity,
          reason: 'Initial stock',
          performed_by: ctx.user.id,
        });
    }

    return { 
      message: 'Product created successfully',
      product 
    };
  },
  'POST',
  { auth: true, roles: ['admin', 'manager', 'product_manager'] }
);