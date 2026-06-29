export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

const GetCategoriesQuerySchema = z.object({
  is_active: z.preprocess((val) => val === 'true', z.boolean()).optional(),
  include_product_count: z.preprocess((val) => val === 'true', z.boolean()).optional(),
  sort: z.enum(['name', 'product_count']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

function normalizeCategoryLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * GET /api/categories
 * List derived category labels from products.category.
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
    let queryBuilder = ctx.supabase
      .from('products')
      .select('category, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .not('category', 'is', null);

    if (query.is_active !== undefined) {
      queryBuilder = queryBuilder.eq('is_active', query.is_active);
    }

    const { data: rows, error } = await queryBuilder;
    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    const buckets = new Map<string, {
      id: string;
      name: string;
      product_count: number;
      created_at: string | null;
      updated_at: string | null;
      _count: { products: number };
    }>();

    for (const row of rows || []) {
      const label = normalizeCategoryLabel((row as Record<string, unknown>).category);
      if (!label) continue;

      const existing = buckets.get(label);
      const createdAt = typeof (row as Record<string, unknown>).created_at === 'string'
        ? (row as Record<string, unknown>).created_at as string
        : null;
      const updatedAt = typeof (row as Record<string, unknown>).updated_at === 'string'
        ? (row as Record<string, unknown>).updated_at as string
        : null;

      if (existing) {
        existing.product_count += 1;
        existing._count.products += 1;
        if (createdAt && (!existing.created_at || createdAt < existing.created_at)) {
          existing.created_at = createdAt;
        }
        if (updatedAt && (!existing.updated_at || updatedAt > existing.updated_at)) {
          existing.updated_at = updatedAt;
        }
        continue;
      }

      buckets.set(label, {
        id: label,
        name: label,
        product_count: 1,
        created_at: createdAt,
        updated_at: updatedAt,
        _count: { products: 1 },
      });
    }

    const categories = Array.from(buckets.values()).sort((a, b) => {
      if (query.sort === 'product_count') {
        const diff = a.product_count - b.product_count;
        return query.order === 'asc' ? diff : -diff;
      }

      return query.order === 'asc'
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name);
    });

    return { categories };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);

/**
 * POST /api/categories
 * Flat model: categories are created when assigned to products.
 */
export const POST = createHttpHandler(
  async () => {
    throw ApiErrorFactory.badRequest(
      'Categories are derived from products.category. Assign a category while creating or editing a product.'
    );
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);
