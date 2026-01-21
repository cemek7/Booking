import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { PG_ERROR_CODES } from '@/lib/constants';

// Zod schema for GET query parameters
const GetCategoriesQuerySchema = z.object({
  parent_id: z.string().optional(),
  is_active: z.preprocess((val) => val === 'true', z.boolean()).optional(),
  include_children: z.preprocess((val) => val === 'true', z.boolean()).optional(),
  include_product_count: z.preprocess((val) => val === 'true', z.boolean()).optional(),
  sort: z.string().default('display_order'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

// Zod schema for POST request body
const CreateCategoryBodySchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  description: z.string().trim().optional(),
  parent_id: z.string().uuid().nullable().optional(),
  display_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
  metadata: z.record(z.unknown()).optional(),
});

interface Category {
  id: string;
  parent_id: string | null;
  [key: string]: unknown;
}

interface CategoryWithChildren extends Category {
  children: CategoryWithChildren[];
}

/**
 * GET /api/categories
 * List product categories with hierarchical structure.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.forbidden('Tenant ID required');
    }

    const url = new URL(ctx.request.url);
    const queryValidation = GetCategoriesQuerySchema.safeParse(Object.fromEntries(url.searchParams));

    if (!queryValidation.success) {
      throw ApiErrorFactory.validationError({ issues: queryValidation.error.issues });
    }
    const query = queryValidation.data;

    const selectFields = query.include_product_count
      ? '*, product_count:products(count)'
      : '*';

    let queryBuilder = ctx.supabase
      .from('product_categories')
      .select(selectFields)
      .eq('tenant_id', tenantId);

    // Apply filters
    if (query.parent_id !== undefined) {
      if (query.parent_id === 'null') {
        queryBuilder = queryBuilder.is('parent_id', null);
      } else {
        queryBuilder = queryBuilder.eq('parent_id', query.parent_id);
      }
    }

    if (query.is_active !== undefined) {
      queryBuilder = queryBuilder.eq('is_active', query.is_active);
    }

    queryBuilder = queryBuilder.order(query.sort, { ascending: query.order === 'asc' });

    const { data: categories, error } = await queryBuilder;

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    if (query.include_children && categories) {
      const buildHierarchy = (parentId: string | null = null): CategoryWithChildren[] => {
        return (categories as Category[])
          .filter(cat => cat.parent_id === parentId)
          .map(cat => ({
            ...cat,
            children: buildHierarchy(cat.id),
          }));
      };
      const hierarchicalCategories = buildHierarchy(query.parent_id === 'null' ? null : (query.parent_id || null));
      return { categories: hierarchicalCategories };
    }

    return { categories: categories || [] };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);

/**
 * POST /api/categories
 * Create a new product category.
 * Requires 'manager' or 'owner' role.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.forbidden('Tenant ID required');
    }

    const body = await ctx.request.json();
    const bodyValidation = CreateCategoryBodySchema.safeParse(body);

    if (!bodyValidation.success) {
      throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
    }
    const { name, ...restOfBody } = bodyValidation.data;

    // Check for name uniqueness within the tenant
    const { data: existingCategory, error: existingError } = await ctx.supabase
      .from('product_categories')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', name)
      .limit(1);

    if (existingError) {
      throw ApiErrorFactory.databaseError(existingError);
    }
    if (existingCategory && existingCategory.length > 0) {
      throw ApiErrorFactory.conflict('A category with this name already exists');
    }

    // Validate parent category if provided
    if (restOfBody.parent_id) {
      const { data: parentCategory, error: parentError } = await ctx.supabase
        .from('product_categories')
        .select('id, parent_id')
        .eq('id', restOfBody.parent_id)
        .eq('tenant_id', tenantId)
        .single();

      if (parentError || !parentCategory) {
        throw ApiErrorFactory.validationError({
          field: 'parent_id',
          message: 'Parent category not found or is inactive'
        });
      }

      // Prevent deep nesting (max 3 levels)
      let depth = 1;
      let currentParentId = parentCategory.parent_id;
      while (currentParentId && depth < 3) {
        const { data: ancestor } = await ctx.supabase
          .from('product_categories')
          .select('parent_id')
          .eq('id', currentParentId)
          .single();
        if (ancestor) {
          currentParentId = ancestor.parent_id;
          depth++;
        } else {
          break;
        }
      }
      if (depth >= 3) {
        throw ApiErrorFactory.validationError({
          field: 'parent_id',
          message: 'Categories can only be nested 3 levels deep'
        });
      }
    }

    const { data: newCategory, error: insertError } = await ctx.supabase
      .from('product_categories')
      .insert({
        tenant_id: tenantId,
        name,
        ...restOfBody,
      })
      .select('*')
      .single();

    if (insertError) {
      if (insertError.code === PG_ERROR_CODES.UNIQUE_VIOLATION) {
        throw ApiErrorFactory.conflict('Category name already exists');
      }
      throw ApiErrorFactory.databaseError(insertError);
    }

    return { message: 'Category created successfully', category: newCategory };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);