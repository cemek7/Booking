export const dynamic = 'force-dynamic';
/**
 * /api/leads
 * GET  - list leads for the authenticated tenant (owner/manager)
 * PATCH - update lead status (mark converted, dismiss, follow up now)
 */

import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';

export const GET = createHttpHandler(
  async (ctx) => {
    if (!['owner', 'manager'].includes(ctx.user!.role)) {
      throw ApiErrorFactory.insufficientPermissions(['owner', 'manager']);
    }

    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });

    const url = new URL(ctx.request.url);
    const status = url.searchParams.get('status') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    let query = ctx.supabase
      .from('leads')
      .select('id,name,phone,email,source,intent,notes,status,follow_up_at,followed_up_at,created_at', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);

    const { data, error, count } = await query;
    if (error) throw ApiErrorFactory.databaseError(error);

    return { data: data ?? [], total: count ?? 0 };
  },
  'GET',
  { auth: true }
);

const LeadPatchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['new', 'contacted', 'converted', 'dismissed']).optional(),
  follow_up_at: z.string().datetime().optional(),
  notes: z.string().optional(),
});

export const PATCH = createHttpHandler(
  async (ctx) => {
    if (!['owner', 'manager'].includes(ctx.user!.role)) {
      throw ApiErrorFactory.insufficientPermissions(['owner', 'manager']);
    }

    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });

    const body = await parseJsonBody(ctx.request);
    const { id, status, follow_up_at, notes } = LeadPatchSchema.parse(body);

    const updates: Record<string, unknown> = {};
    if (status !== undefined) updates.status = status;
    if (follow_up_at !== undefined) updates.follow_up_at = follow_up_at;
    if (notes !== undefined) updates.notes = notes;

    const { data, error } = await ctx.supabase
      .from('leads')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id,name,phone,status,follow_up_at')
      .maybeSingle();

    if (error) throw ApiErrorFactory.databaseError(error);
    if (!data) throw ApiErrorFactory.notFound('Lead');

    return { data };
  },
  'PATCH',
  { auth: true }
);
