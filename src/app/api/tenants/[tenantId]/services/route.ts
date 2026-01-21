import { z } from 'zod';
import { NextResponse } from 'next/server';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

const CreateServiceBodySchema = z.object({
  name: z.string().min(1, 'Service name is required'),
  duration_minutes: z.number().int().positive().optional().default(60),
  price_cents: z.number().int().min(0).optional().default(0),
  active: z.boolean().optional().default(true),
  metadata: z.record(z.unknown()).nullable().optional(),
});

const UpdateServiceBodySchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().min(1).optional(),
  duration_minutes: z.number().int().positive().optional(),
  price_cents: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

const DeleteServiceBodySchema = z.object({
  id: z.union([z.string(), z.number()]),
});

/**
 * GET /api/tenants/[tenantId]/services
 * List all services for a tenant.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    // Verify the caller has access to this tenant
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    const { data, error } = await ctx.supabase
      .from('reservation_services')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    return data ?? [];
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);

/**
 * POST /api/tenants/[tenantId]/services
 * Create a new service for a tenant.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    // Verify the caller has access to this tenant
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    const body = await ctx.request.json();
    const bodyValidation = CreateServiceBodySchema.safeParse(body);
    if (!bodyValidation.success) {
      throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
    }

    const { name, duration_minutes, price_cents, active, metadata } = bodyValidation.data;

    const { data, error } = await ctx.supabase
      .from('reservation_services')
      .insert({
        tenant_id: tenantId,
        name,
        duration_minutes,
        price_cents,
        active,
        metadata: metadata ?? null,
      })
      .select()
      .single();

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    return new NextResponse(JSON.stringify(data), { status: 201 });
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);

/**
 * PATCH /api/tenants/[tenantId]/services
 * Update an existing service.
 */
export const PATCH = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    // Verify the caller has access to this tenant
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    const body = await ctx.request.json();
    const bodyValidation = UpdateServiceBodySchema.safeParse(body);
    if (!bodyValidation.success) {
      throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
    }

    const { id, ...updateFields } = bodyValidation.data;

    if (Object.keys(updateFields).length === 0) {
      throw ApiErrorFactory.validationError({ body: 'No update fields provided' });
    }

    const { data, error } = await ctx.supabase
      .from('reservation_services')
      .update(updateFields)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    return { service: data };
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager'] }
);

/**
 * DELETE /api/tenants/[tenantId]/services
 * Delete a service.
 */
export const DELETE = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    // Verify the caller has access to this tenant
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    const body = await ctx.request.json();
    const bodyValidation = DeleteServiceBodySchema.safeParse(body);
    if (!bodyValidation.success) {
      throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
    }

    const { id } = bodyValidation.data;

    const { error } = await ctx.supabase
      .from('reservation_services')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    return { success: true };
  },
  'DELETE',
  { auth: true, roles: ['owner', 'manager'] }
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
