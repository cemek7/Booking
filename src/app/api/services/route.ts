export const dynamic = 'force-dynamic';
/**
 * /api/services
 * Service management - unified error handling and auth
 * 
 * GET  - List all services for tenant
 * POST - Create new service (requires owner/manager)
 * PATCH - Update service
 * DELETE - Delete service (requires owner)
 */

import { z } from 'zod';
import { createHttpHandler, parseJsonBody, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { getPaginationParams } from '@/lib/error-handling/migration-helpers';

const ServiceCreateSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  price: z.number().min(0).optional(),
  duration: z.number().int().min(1).optional(),
  category: z.string().nullable().optional(),
});

interface ServiceCreatePayload {
  name: string;
  description?: string | null;
  price?: number;
  duration?: number;
  category?: string | null;
}

export const GET = createHttpHandler(
  async (ctx) => {
    const { page, limit, offset } = getPaginationParams(ctx);
    const tenantId = getVerifiedTenantId(ctx);

    const { data, error } = await ctx.supabase
      .from('services')
      .select('id,name,description,price,duration,category,created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw ApiErrorFactory.databaseError(error);

    const { count } = await ctx.supabase
      .from('services')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    return {
      data: data || [],
      pagination: { page, limit, total: count || 0, offset }
    };
  },
  'GET',
  { auth: true }
);

export const POST = createHttpHandler(
  async (ctx) => {
    if (!['owner', 'manager'].includes(ctx.user!.role)) {
      throw ApiErrorFactory.insufficientPermissions(['owner', 'manager']);
    }

    const tenantId = getVerifiedTenantId(ctx);

    const rawBody = await parseJsonBody<ServiceCreatePayload>(ctx.request);
    const bodyValidation = ServiceCreateSchema.safeParse(rawBody);
    if (!bodyValidation.success) {
      throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
    }
    const body = bodyValidation.data;

    const { data, error } = await ctx.supabase
      .from('services')
      .insert({
        tenant_id: tenantId,
        name: body.name,
        description: body.description || null,
        price: body.price ?? 0,
        duration: body.duration ?? 30,
        category: body.category || null,
      })
      .select('*')
      .single();

    if (error) throw ApiErrorFactory.databaseError(error);
    return data;
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);

export const PATCH = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const serviceId = url.searchParams.get('id');
    const tenantId = getVerifiedTenantId(ctx);

    if (!serviceId) {
      throw ApiErrorFactory.validationError({ id: 'Service ID is required' });
    }

    if (!['owner', 'manager'].includes(ctx.user!.role)) {
      throw ApiErrorFactory.insufficientPermissions(['owner', 'manager']);
    }

    const body = await parseJsonBody<Partial<ServiceCreatePayload>>(ctx.request);

    const { data, error } = await ctx.supabase
      .from('services')
      .update(body)
      .eq('id', serviceId)
      .eq('tenant_id', tenantId)
      .select('*')
      .single();

    if (error) throw ApiErrorFactory.databaseError(error);
    return data;
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager'] }
);

export const DELETE = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const serviceId = url.searchParams.get('id');
    const tenantId = getVerifiedTenantId(ctx);

    if (!serviceId) {
      throw ApiErrorFactory.validationError({ id: 'Service ID is required' });
    }

    if (ctx.user!.role !== 'owner') {
      throw ApiErrorFactory.insufficientPermissions(['owner']);
    }

    const { error } = await ctx.supabase
      .from('services')
      .delete()
      .eq('id', serviceId)
      .eq('tenant_id', tenantId);

    if (error) throw ApiErrorFactory.databaseError(error);
    return { success: true };
  },
  'DELETE',
  { auth: true, roles: ['owner'] }
);
