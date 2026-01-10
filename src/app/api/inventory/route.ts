import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/supabaseClient';
import { getSession } from '../../../lib/auth/session';
import { validateTenantAccess } from '../../../lib/enhanced-rbac';
import { z } from 'zod';
import { handleApiError } from '../../../lib/error-handling';

// Zod schema for GET query parameters
const ListMovementsQuerySchema = z.object({
  product_id: z.string().uuid().optional(),
  variant_id: z.string().uuid().optional(),
  movement_type: z.enum(['sale', 'return', 'adjustment', 'initial', 'restock']).optional(),
  reference_type: z.string().optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  sort: z.string().default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.preprocess((val) => parseInt(String(val), 10), z.number().int().min(1)).default(1),
  limit: z.preprocess((val) => parseInt(String(val), 10), z.number().int().min(1).max(100)).default(50),
});

// Zod schema for POST request body
const CreateMovementBodySchema = z.object({
  product_id: z.string().uuid().optional(),
  variant_id: z.string().uuid().optional(),
  quantity_change: z.number().int(),
  movement_type: z.enum(['adjustment', 'initial', 'restock', 'damage', 'theft']),
  reference_type: z.string().optional(),
  reference_id: z.string().optional(),
  reason: z.string().optional(),
}).refine(data => data.product_id || data.variant_id, {
  message: 'Either product_id or variant_id must be provided',
});


/**
 * GET /api/inventory
 * List inventory movements for the tenant.
 * Requires 'manager' or 'admin' role.
 */
export async function GET(req: NextRequest) {
  try {
    const { session, tenantId } = await getSession(req);
    if (!session || !tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const access = await validateTenantAccess(createServerSupabaseClient(), session.user.id, tenantId, ['owner', 'manager']);
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(req.url);
    const queryValidation = ListMovementsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!queryValidation.success) {
      return NextResponse.json({ error: 'Invalid query parameters', details: queryValidation.error.issues }, { status: 400 });
    }
    const query = queryValidation.data;

    const supabase = createServerSupabaseClient();
    let queryBuilder = supabase
      .from('inventory_movements')
      .select(`
        *,
        product:products(id, name, sku),
        variant:product_variants(id, variant_name),
        user:profiles(id, full_name, email)
      `, { count: 'exact' })
      .eq('tenant_id', tenantId);

    // Apply filters from query
    if (query.product_id) queryBuilder = queryBuilder.eq('product_id', query.product_id);
    if (query.variant_id) queryBuilder = queryBuilder.eq('variant_id', query.variant_id);
    if (query.movement_type) queryBuilder = queryBuilder.eq('movement_type', query.movement_type);
    if (query.reference_type) queryBuilder = queryBuilder.eq('reference_type', query.reference_type);
    if (query.date_from) queryBuilder = queryBuilder.gte('created_at', query.date_from);
    if (query.date_to) queryBuilder = queryBuilder.lte('created_at', query.date_to);

    queryBuilder = queryBuilder.order(query.sort, { ascending: query.order === 'asc' });

    const from = (query.page - 1) * query.limit;
    const to = from + query.limit - 1;
    queryBuilder = queryBuilder.range(from, to);

    const { data: movements, error, count } = await queryBuilder;
    if (error) throw error;

    return NextResponse.json({
      movements: movements || [],
      pagination: {
        page: query.page,
        limit: query.limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / query.limit),
      }
    });

  } catch (error) {
    return handleApiError(error, 'Failed to fetch inventory movements');
  }
}

/**
 * POST /api/inventory
 * Create an inventory movement (manual stock adjustment).
 * Requires 'manager' or 'admin' role.
 */
export async function POST(req: NextRequest) {
  try {
    const { session, tenantId } = await getSession(req);
    if (!session || !tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const access = await validateTenantAccess(createServerSupabaseClient(), session.user.id, tenantId, ['owner', 'manager']);
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const bodyValidation = CreateMovementBodySchema.safeParse(body);
    if (!bodyValidation.success) {
      return NextResponse.json({ error: 'Invalid request body', details: bodyValidation.error.issues }, { status: 400 });
    }
    const movementData = bodyValidation.data;

    const supabase = createServerSupabaseClient();
    const { error } = await supabase.rpc('update_inventory', {
      p_tenant_id: tenantId,
      p_product_id: movementData.product_id,
      p_variant_id: movementData.variant_id,
      p_quantity_change: movementData.quantity_change,
      p_movement_type: movementData.movement_type,
      p_reference_type: movementData.reference_type,
      p_reference_id: movementData.reference_id,
      p_reason: movementData.reason,
      p_performed_by: session.user.id,
    });

    if