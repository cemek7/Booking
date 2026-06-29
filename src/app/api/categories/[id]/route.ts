export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

const GetCategoryQuerySchema = z.object({
  include_products: z.preprocess((val) => val === 'true', z.boolean()).optional(),
});

const UpdateCategoryBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  merge_into: z.string().trim().min(1).nullable().optional(),
}).strict();

const DeleteCategoryQuerySchema = z.object({
  move_products: z.preprocess((val) => val === 'true', z.boolean()).optional(),
  new_category: z.string().trim().min(1).optional(),
});

function normalizeCategoryLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function decodeCategoryId(value: string | undefined): string | null {
  if (!value) return null;
  return normalizeCategoryLabel(decodeURIComponent(value));
}

async function loadCategorySummary(
  ctx: Parameters<typeof createHttpHandler>[0] extends (arg: infer T) => unknown ? T : never,
  tenantId: string,
  categoryName: string,
  includeProducts = false,
) {
  const selectFields = includeProducts
    ? 'id, name, price_cents, is_active, category, created_at, updated_at'
    : 'category, created_at, updated_at';

  const { data: products, error } = await ctx.supabase
    .from('products')
    .select(selectFields)
    .eq('tenant_id', tenantId)
    .eq('category', categoryName);

  if (error) {
    throw ApiErrorFactory.databaseError(error);
  }

  if (!products || products.length === 0) {
    return null;
  }

  const createdAtValues = products
    .map((row) => (typeof (row as unknown as Record<string, unknown>).created_at === 'string'
      ? (row as unknown as Record<string, unknown>).created_at as string
      : null))
    .filter((value): value is string => Boolean(value))
    .sort();

  const updatedAtValues = products
    .map((row) => (typeof (row as unknown as Record<string, unknown>).updated_at === 'string'
      ? (row as unknown as Record<string, unknown>).updated_at as string
      : null))
    .filter((value): value is string => Boolean(value))
    .sort();

  return {
    category: {
      id: categoryName,
      name: categoryName,
      product_count: products.length,
      created_at: createdAtValues[0] ?? null,
      updated_at: updatedAtValues.at(-1) ?? null,
      _count: { products: products.length },
      products: includeProducts ? products : undefined,
    },
  };
}

/**
 * GET /api/categories/[id]
 * Get a derived product category label by name.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    const categoryName = decodeCategoryId(ctx.params?.id);

    if (!tenantId) {
      throw ApiErrorFactory.forbidden('Tenant ID required');
    }
    if (!categoryName) {
      throw ApiErrorFactory.validationError({ id: 'Category name is required' });
    }

    const url = new URL(ctx.request.url);
    const queryValidation = GetCategoryQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!queryValidation.success) {
      throw ApiErrorFactory.validationError({ issues: queryValidation.error.issues });
    }

    const result = await loadCategorySummary(
      ctx as never,
      tenantId,
      categoryName,
      queryValidation.data.include_products === true,
    );

    if (!result) {
      throw ApiErrorFactory.notFound('Category');
    }

    return result;
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);

/**
 * PUT /api/categories/[id]
 * Rename or merge a derived category label by updating products.category.
 */
export const PUT = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    const currentCategoryName = decodeCategoryId(ctx.params?.id);

    if (!tenantId) {
      throw ApiErrorFactory.forbidden('Tenant ID required');
    }
    if (!currentCategoryName) {
      throw ApiErrorFactory.validationError({ id: 'Category name is required' });
    }

    const body = await ctx.request.json();
    const bodyValidation = UpdateCategoryBodySchema.safeParse(body);
    if (!bodyValidation.success) {
      throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
    }

    const nextName = normalizeCategoryLabel(bodyValidation.data.name);
    const mergeInto = normalizeCategoryLabel(bodyValidation.data.merge_into);
    const targetName = mergeInto ?? nextName;

    if (!targetName) {
      throw ApiErrorFactory.validationError({ name: 'A new category name is required' });
    }

    const existing = await loadCategorySummary(ctx as never, tenantId, currentCategoryName, false);
    if (!existing) {
      throw ApiErrorFactory.notFound('Category');
    }

    if (targetName === currentCategoryName) {
      return existing;
    }

    const { error } = await ctx.supabase
      .from('products')
      .update({
        category: targetName,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('category', currentCategoryName);

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    const updated = await loadCategorySummary(ctx as never, tenantId, targetName, false);
    if (!updated) {
      throw ApiErrorFactory.internalServerError(new Error('Failed to reload updated category'));
    }

    return {
      message: mergeInto
        ? 'Category merged successfully'
        : 'Category renamed successfully',
      category: updated.category,
    };
  },
  'PUT',
  { auth: true, roles: ['owner', 'manager'] }
);

/**
 * DELETE /api/categories/[id]
 * Clear a category label or move products into another label.
 */
export const DELETE = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    const categoryName = decodeCategoryId(ctx.params?.id);

    if (!tenantId) {
      throw ApiErrorFactory.forbidden('Tenant ID required');
    }
    if (!categoryName) {
      throw ApiErrorFactory.validationError({ id: 'Category name is required' });
    }

    const url = new URL(ctx.request.url);
    const queryValidation = DeleteCategoryQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!queryValidation.success) {
      throw ApiErrorFactory.validationError({ issues: queryValidation.error.issues });
    }

    const nextCategory = queryValidation.data.move_products
      ? normalizeCategoryLabel(queryValidation.data.new_category)
      : null;

    const existing = await loadCategorySummary(ctx as never, tenantId, categoryName, false);
    if (!existing) {
      throw ApiErrorFactory.notFound('Category');
    }

    if (nextCategory === categoryName) {
      throw ApiErrorFactory.validationError({ new_category: 'Target category must be different' });
    }

    const { error } = await ctx.supabase
      .from('products')
      .update({
        category: nextCategory,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('category', categoryName);

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    return {
      message: nextCategory
        ? 'Category cleared by moving products successfully'
        : 'Category cleared successfully',
      category: categoryName,
      moved_to: nextCategory,
    };
  },
  'DELETE',
  { auth: true, roles: ['owner', 'manager'] }
);
