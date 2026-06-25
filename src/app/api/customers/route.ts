export const dynamic = 'force-dynamic';
import { createHttpHandler, getVerifiedTenantId, getPaginationParams } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { NextResponse } from 'next/server';
import { defaultLogger } from '@/lib/logger';
import { z } from 'zod';

const CreateCustomerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  customer_name: z.string().min(1).max(200).optional(),
  phone: z.string().max(50).optional(),
  phone_number: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
}).refine(
  (data) => data.name || data.customer_name,
  { message: 'name or customer_name is required' }
);

const UpdateCustomerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().email().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

/**
 * GET /api/customers
 * List customers for tenant (paginated)
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const { page, limit } = getPaginationParams(ctx.request);
    const offset = ((page ?? 1) - 1) * (limit ?? 20);
    const pageLimit = limit ?? 20;

    const { data, error } = await ctx.supabase
      .from('customers')
      .select('id,customer_name,phone_number,notes,created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageLimit - 1);

    if (error) {
      defaultLogger.error('[api/customers] GET error:', error);
      throw ApiErrorFactory.internalServerError(new Error('Failed to fetch customers'));
    }

    return { data: data || [], pagination: { page: page ?? 1, limit: pageLimit, offset } };
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
    const tenantId = getVerifiedTenantId(ctx);

    const rawBody = await ctx.request.json();
    const parsed = CreateCustomerSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    }
    const body = parsed.data;

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
      defaultLogger.error('[api/customers] POST error:', error);
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
    const tenantId = getVerifiedTenantId(ctx);

    const id = ctx.request.nextUrl.searchParams.get('id');

    if (!id) {
      throw ApiErrorFactory.badRequest('Customer ID is required');
    }

    const rawBody = await ctx.request.json();
    const parsed = UpdateCustomerSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    }
    const body = parsed.data;

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
      defaultLogger.error(`[api/customers] PATCH error for ${id}:`, error);
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
    const tenantId = getVerifiedTenantId(ctx);

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
      defaultLogger.error(`[api/customers] DELETE error for ${id}:`, error);
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
