import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/supabaseClient';
import { getSession } from '../../../lib/auth/session';
import { validateTenantAccess } from '../../../lib/enhanced-rbac';
import { z } from 'zod';
import { AuthenticatedRequest, handleApiError } from '../../../lib/error-handling';
import { UserRole } from '../../../../types';

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
  metadata: z.record(z.any()).optional(),
});

/**
 * GET /api/categories
 * List product categories with hierarchical structure.
 * Requires 'viewer' or higher role.
 */
export async function GET(req: NextRequest) {
  try {
    const { session, tenantId } = await getSession(req);
    if (!session || !tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Assuming 'viewer' can see categories.
    await validateTenantAccess(session.user.id, tenantId, [UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF, UserRole.VIEWER]);

    const url = new URL(req.url);
    const queryValidation = GetCategoriesQuerySchema.safeParse(Object.fromEntries(url.searchParams));

    if (!queryValidation.success) {
      return NextResponse.json({ error: 'Invalid query parameters', details: queryValidation.error.issues }, { status: 400 });
    }
    const query = queryValidation.data;

    const supabase = createServerSupabaseClient();
    let queryBuilder = supabase
      .from('product_categories')
      .select(`
        *,
        ${query.include_product_count ? 'product_count:products(count)' : ''}
      `)
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
      console.error('Categories fetch error:', error);
      return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
    }

    if (query.include_children && categories) {
      const buildHierarchy = (parentId: string | null = null): any[] => {
        return categories
          .filter(cat => cat.parent_id === parentId)
          .map(cat => ({
            ...cat,
            children: buildHierarchy(cat.id),
          }));
      };
      const hierarchicalCategories = buildHierarchy(query.parent_id === 'null' ? null : (query.parent_id || null));
      return NextResponse.json({ categories: hierarchicalCategories });
    }

    return NextResponse.json({ categories: categories || [] });

  } catch (error) {
    return handleApiError(error, 'Failed to retrieve categories');
  }
}

/**
 * POST /api/categories
 * Create a new product category.
 * Requires 'manager' or 'admin' role.
 */
export async function POST(req: AuthenticatedRequest) {
  try {
    const { session, tenantId } = await getSession(req);
    if (!session || !tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await validateTenantAccess(session.user.id, tenantId, [UserRole.ADMIN, UserRole.MANAGER]);

    const body = await req.json();
    const bodyValidation = CreateCategoryBodySchema.safeParse(body);

    if (!bodyValidation.success) {
      return NextResponse.json({ error: 'Invalid request body', details: bodyValidation.error.issues }, { status: 400 });
    }
    const { name, ...restOfBody } = bodyValidation.data;

    const supabase = createServerSupabaseClient();

    // Check for name uniqueness within the tenant
    const { data: existingCategory, error: existingError } = await supabase
      .from('product_categories')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', name)
      .limit(1);

    if (existingError) throw existingError;
    if (existingCategory && existingCategory.length > 0) {
      return NextResponse.json({
        error: 'Category name already exists',
        details: { field: 'name', message: 'A category with this name already exists' }
      }, { status: 409 });
    }

    // Validate parent category if provided
    if (restOfBody.parent_id) {
      const { data: parentCategory, error: parentError } = await supabase
        .from('product_categories')
        .select('id, parent_id')
        .eq('id', restOfBody.parent_id)
        .eq('tenant_id', tenantId)
        .single();

      if (parentError || !parentCategory) {
        return NextResponse.json({
          error: 'Invalid parent category',
          details: { field: 'parent_id', message: 'Parent category not found or is inactive' }
        }, { status: 400 });
      }
      
      // Prevent deep nesting (e.g., max 3 levels)
      let depth = 1;
      let currentParentId = parentCategory.parent_id;
      while (currentParentId && depth < 3) {
        const { data: ancestor } = await supabase.from('product_categories').select('parent_id').eq('id', currentParentId).single();
        if (ancestor) {
          currentParentId = ancestor.parent_id;
          depth++;
        } else {
          break;
        }
      }
      if (depth >= 3) {
        return NextResponse.json({
          error: 'Maximum nesting depth reached',
          details: { field: 'parent_id', message: 'Categories can only be nested 3 levels deep' }
        }, { status: 400 });
      }
    }

    const { data: newCategory, error: insertError } = await supabase
      .from('product_categories')
      .insert({
        tenant_id: tenantId,
        name,
        ...restOfBody,
      })
      .select('*')
      .single();

    if (insertError) {
      console.error('Category creation error:', insertError);
      if (insertError.code === '23505') { // Unique constraint violation
        return NextResponse.json({ error: 'Category name already exists' }, { status: 409 });
      }
      throw insertError;
    }

    return NextResponse.json({ message: 'Category created successfully', category: newCategory }, { status: 201 });

  } catch (error) {
    return handleApiError(error, 'Failed to create category');
  }
}