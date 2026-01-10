import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { NextResponse } from 'next/server';

/**
 * GET /api/customers
 * List customers for tenant
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;

    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    const { data, error } = await ctx.supabase
      .from('customers')
      .select('id,customer_name,phone_number,notes,created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('[api/customers] GET error:', error);
      throw ApiErrorFactory.internalServerError(new Error('Failed to fetch customers'));
    }

    return data || [];
  },
  'GET',
  { auth: true }
);

/**
 * POST /api/customers
 * Create new customer
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;

    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    const body = await ctx.request.json();

    const payload = {
      tenant_id: tenantId,
      customer_name: body.name || body.customer_name || null,
      phone_number: body.phone || body.phone_number || null,
      notes: body.notes || null,
    };

    const { data, error } = await ctx.supabase
      .from('customers')
      .insert([payload])
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[api/customers] POST error:', error);
      throw ApiErrorFactory.internalServerError(new Error('Failed to create customer'));
    }

    return data;
  },
  'POST',
  { auth: true }
);

/**
 * PATCH /api/customers
 * Update customer by id query param
 */
export const PATCH = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;

    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    const id = ctx.request.nextUrl.searchParams.get('id');

    if (!id) {
      throw ApiErrorFactory.badRequest('Customer ID is required');
    }

    const body = await ctx.request.json();

    const update = {
      name: body.name,
      phone: body.phone,
      email: body.email,
      notes: body.notes,
    } as Record<string, unknown>;

    const { data, error } = await ctx.supabase
      .from('customers')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error(`[api/customers] PATCH error for ${id}:`, error);
      throw ApiErrorFactory.internalServerError(new Error('Failed to update customer'));
    }

    return data;
  },
  'PATCH',
  { auth: true }
);

/**
 * DELETE /api/customers
 * Delete customer by id query param
 */
export const DELETE = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;

    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    const id = ctx.request.nextUrl.searchParams.get('id');

    if (!id) {
      throw ApiErrorFactory.badRequest('Customer ID is required');
    }

    const { error } = await ctx.supabase
      .from('customers')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error(`[api/customers] DELETE error for ${id}:`, error);
      throw ApiErrorFactory.internalServerError(new Error('Failed to delete customer'));
    }

    return { success: true };
  },
  'DELETE',
  { auth: true }
);

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'GET, POST, PATCH, DELETE, OPTIONS',
      'Content-Type': 'application/json',
    },
  });
}
