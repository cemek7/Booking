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

const ServicePayloadSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  price: z.number().min(0).optional(),
  price_cents: z.number().int().min(0).optional(),
  duration: z.number().int().min(1).optional(),
  duration_minutes: z.number().int().min(1).optional(),
  category: z.string().nullable().optional(),
});

interface ServiceCreatePayload {
  name: string;
  description?: string | null;
  price?: number;
  price_cents?: number;
  duration?: number;
  duration_minutes?: number;
  category?: string | null;
}

function normalizeServicePayload(body: ServiceCreatePayload) {
  const durationMinutes = body.duration_minutes ?? body.duration ?? 30;
  const priceCents = body.price_cents ?? body.price ?? 0;

  return {
    name: body.name,
    description: body.description || null,
    category: body.category || null,
    duration_minutes: durationMinutes,
    price_cents: priceCents,
  };
}

function mapServiceRow(row: Record<string, unknown>) {
  const durationMinutes =
    typeof row.duration_minutes === 'number'
      ? row.duration_minutes
      : Number(row.duration_minutes ?? row.duration ?? 30);
  const priceCents =
    typeof row.price_cents === 'number'
      ? row.price_cents
      : Number(row.price_cents ?? row.price ?? 0);

  return {
    ...row,
    duration: Number.isFinite(durationMinutes) ? durationMinutes : 30,
    duration_minutes: Number.isFinite(durationMinutes) ? durationMinutes : 30,
    price: Number.isFinite(priceCents) ? priceCents : 0,
    price_cents: Number.isFinite(priceCents) ? priceCents : 0,
  };
}

export const GET = createHttpHandler(
  async (ctx) => {
    const { page, limit, offset } = getPaginationParams(ctx);
    const tenantId = getVerifiedTenantId(ctx);

    const { data, error } = await ctx.supabase
      .from('services')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw ApiErrorFactory.databaseError(error);

    const { count } = await ctx.supabase
      .from('services')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    return {
      data: (data || []).map((row: Record<string, unknown>) => mapServiceRow(row)),
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
    const bodyValidation = ServicePayloadSchema.safeParse(rawBody);
    if (!bodyValidation.success) {
      throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
    }
    const body = normalizeServicePayload(bodyValidation.data);

    const { data, error } = await ctx.supabase
      .from('services')
      .insert({
        tenant_id: tenantId,
        name: body.name,
        description: body.description,
        price_cents: body.price_cents,
        duration_minutes: body.duration_minutes,
        category: body.category,
      })
      .select('*')
      .single();

    if (error) throw ApiErrorFactory.databaseError(error);
    return mapServiceRow(data as Record<string, unknown>);
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
    const bodyValidation = ServicePayloadSchema.partial().safeParse(body);
    if (!bodyValidation.success) {
      throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
    }
    const parsed = bodyValidation.data;
    const updates: Record<string, unknown> = {};
    if (parsed.name !== undefined) updates.name = parsed.name;
    if (parsed.description !== undefined) updates.description = parsed.description || null;
    if (parsed.category !== undefined) updates.category = parsed.category || null;
    if (parsed.duration !== undefined || parsed.duration_minutes !== undefined) {
      updates.duration_minutes = parsed.duration_minutes ?? parsed.duration;
    }
    if (parsed.price !== undefined || parsed.price_cents !== undefined) {
      updates.price_cents = parsed.price_cents ?? parsed.price;
    }

    const { data, error } = await ctx.supabase
      .from('services')
      .update(updates)
      .eq('id', serviceId)
      .eq('tenant_id', tenantId)
      .select('*')
      .single();

    if (error) throw ApiErrorFactory.databaseError(error);
    return mapServiceRow(data as Record<string, unknown>);
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
