import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { PG_ERROR_CODES } from '@/lib/constants';

// Zod schema for GET query parameters
const GetCategoryQuerySchema = z.object({
  include_children: z.preprocess((val) => val === 'true', z.boolean()).optional(),
  include_products: z.preprocess((val) => val === 'true', z.boolean()).optional(),
});

// Zod schema for PUT request body
const UpdateCategoryBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().nullable().optional(),
  parent_id: z.string().uuid().nullable().optional(),
  display_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict();

// Zod schema for DELETE query parameters
const DeleteCategoryQuerySchema = z.object({
  force: z.preprocess((val) => val === 'true', z.boolean()).optional(),
  move_products: z.preprocess((val) => val === 'true', z.boolean()).optional(),
  new_category_id: z.string().uuid().optional(),
});

interface CategoryWithChildren {
  children?: unknown[];
  [key: string]: unknown;
}

/**
 * GET /api/categories/[id]
 * Get a specific product category by ID.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    const categoryId = ctx.params?.id;

    if (!tenantId) {
      throw ApiErrorFactory.forbidden('Tenant ID required');
    }
    if (!categoryId) {
      throw ApiErrorFactory.validationError({ id: 'Category ID is required' });
    }

    const url = new URL(ctx.request.url);
    const queryValidation = GetCategoryQuerySchema.safeParse(Object.fromEntries(url.searchParams));

    if (!queryValidation.success) {
      throw ApiErrorFactory.validationError({ issues: queryValidation.error.issues });
    }
    const { include_children, include_products } = queryValidation.data;

    const selectFields = include_products
      ? '*, parent:product_categories!parent_id(id, name), products(id, name, price_cents, is_active), product_count:products(count)'
      : '*, parent:product_categories!parent_id(id, name), product_count:products(count)';

    const { data: category, error } = await ctx.supabase
      .from('product_categories')
      .select(selectFields)
      .eq('id', categoryId)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !category) {
      throw ApiErrorFactory.notFound('Category');
    }

    const result: CategoryWithChildren = { ...category };

    if (include_children) {
      const { data: children, error: childrenError } = await ctx.supabase
        .from('product_categories')
        .select('*, product_count:products(count)')
        .eq('parent_id', categoryId)
        .eq('tenant_id', tenantId)
        .order('display_order', { ascending: true });

      if (childrenError) {
        throw ApiErrorFactory.databaseError(childrenError);
      }
      result.children = children || [];
    }

    return { category: result };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);

/**
 * PUT /api/categories/[id]
 * Update a specific product category.
 */
export const PUT = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    const categoryId = ctx.params?.id;

    if (!tenantId) {
      throw ApiErrorFactory.forbidden('Tenant ID required');
    }
    if (!categoryId) {
      throw ApiErrorFactory.validationError({ id: 'Category ID is required' });
    }

    const body = await ctx.request.json();
    const bodyValidation = UpdateCategoryBodySchema.safeParse(body);

    if (!bodyValidation.success) {
      throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
    }
    const updateData = bodyValidation.data;

    if (Object.keys(updateData).length === 0) {
      throw ApiErrorFactory.validationError({ body: 'Request body cannot be empty' });
    }

    // Check category exists
    const { data: existingCategory, error: existingError } = await ctx.supabase
      .from('product_categories')
      .select('id, name, parent_id')
      .eq('id', categoryId)
      .eq('tenant_id', tenantId)
      .single();

    if (existingError || !existingCategory) {
      throw ApiErrorFactory.notFound('Category');
    }

    // Check name uniqueness if name is being updated
    if (updateData.name && updateData.name !== existingCategory.name) {
      const { count } = await ctx.supabase
        .from('product_categories')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('name', updateData.name)
        .neq('id', categoryId);

      if (count && count > 0) {
        throw ApiErrorFactory.conflict('Category name already exists');
      }
    }

    // Validate parent_id if being updated
    if (updateData.parent_id && updateData.parent_id !== existingCategory.parent_id) {
      if (updateData.parent_id === categoryId) {
        throw ApiErrorFactory.validationError({ parent_id: 'Category cannot be its own parent' });
      }

      const { data: parentCategory } = await ctx.supabase
        .from('product_categories')
        .select('id, parent_id')
        .eq('id', updateData.parent_id)
        .eq('tenant_id', tenantId)
        .single();

      if (!parentCategory) {
        throw ApiErrorFactory.validationError({ parent_id: 'Parent category not found' });
      }
    }

    const { data: updatedCategory, error: updateError } = await ctx.supabase
      .from('product_categories')
      .update({ ...updateData, updated_at: new Date().toISOString() })
      .eq('id', categoryId)
      .eq('tenant_id', tenantId)
      .select('*, parent:product_categories!parent_id(id, name), product_count:products(count)')
      .single();

    if (updateError) {
      throw ApiErrorFactory.databaseError(updateError);
    }

    return { message: 'Category updated successfully', category: updatedCategory };
  },
  'PUT',
  { auth: true, roles: ['owner', 'manager'] }
);

/**
 * DELETE /api/categories/[id]
 * Delete a specific product category.
 */
export const DELETE = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    const categoryId = ctx.params?.id;

    if (!tenantId) {
      throw ApiErrorFactory.forbidden('Tenant ID required');
    }
    if (!categoryId) {
      throw ApiErrorFactory.validationError({ id: 'Category ID is required' });
    }

    const url = new URL(ctx.request.url);
    const queryValidation = DeleteCategoryQuerySchema.safeParse(Object.fromEntries(url.searchParams));

    if (!queryValidation.success) {
      throw ApiErrorFactory.validationError({ issues: queryValidation.error.issues });
    }
    const { force, move_products, new_category_id } = queryValidation.data;

    // Check category exists
    const { data: category, error: categoryError } = await ctx.supabase
      .from('product_categories')
      .select('id, parent_id')
      .eq('id', categoryId)
      .eq('tenant_id', tenantId)
      .single();

    if (categoryError || !category) {
      throw ApiErrorFactory.notFound('Category');
    }

    // Check for products and children
    const { count: productCount } = await ctx.supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('category_id', categoryId);

    const { count: childCount } = await ctx.supabase
      .from('product_categories')
      .select('*', { count: 'exact', head: true })
      .eq('parent_id', categoryId);

    if ((productCount || 0) > 0 || (childCount || 0) > 0) {
      if (!force) {
        throw ApiErrorFactory.conflict('Category has children or products. Use force=true to delete.');
      }

      // Move products if requested
      if (move_products && new_category_id) {
        const { data: newCategory } = await ctx.supabase
          .from('product_categories')
          .select('id')
          .eq('id', new_category_id)
          .eq('tenant_id', tenantId)
          .single();

        if (!newCategory) {
          throw ApiErrorFactory.validationError({ new_category_id: 'Target category not found' });
        }
        await ctx.supabase.from('products').update({ category_id: new_category_id }).eq('category_id', categoryId);
      } else if ((productCount || 0) > 0) {
        await ctx.supabase.from('products').update({ category_id: null }).eq('category_id', categoryId);
      }

      // Re-parent children
      if ((childCount || 0) > 0) {
        await ctx.supabase.from('product_categories').update({ parent_id: category.parent_id }).eq('parent_id', categoryId);
      }
    }

    const { error: deleteError } = await ctx.supabase
      .from('product_categories')
      .delete()
      .eq('id', categoryId);

    if (deleteError) {
      throw ApiErrorFactory.databaseError(deleteError);
    }

    return { message: 'Category deleted successfully', category_id: categoryId };
  },
  'DELETE',
  { auth: true, roles: ['owner', 'manager'] }
);
