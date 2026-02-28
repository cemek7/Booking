/**
 * /api/faqs/[id]
 * Single FAQ operations
 *
 * PATCH  - Update a FAQ (owner/manager only)
 * DELETE - Delete a FAQ (owner/manager only)
 */

import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';

const FaqUpdateSchema = z.object({
  question: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  category: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

export const PATCH = createHttpHandler(
  async (ctx) => {
    if (!['owner', 'manager'].includes(ctx.user!.role)) {
      throw ApiErrorFactory.insufficientPermissions(['owner', 'manager']);
    }

    const tenantId = ctx.user!.tenantId!;
    const id = ctx.params?.id;
    if (!id) throw ApiErrorFactory.badRequest('FAQ ID required');

    const raw = await parseJsonBody(ctx.request);
    const body = FaqUpdateSchema.parse(raw);

    const { data, error } = await ctx.supabase
      .from('faqs')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) throw ApiErrorFactory.databaseError(error);
    if (!data) throw ApiErrorFactory.notFound('FAQ');

    return { data };
  },
  'PATCH',
  { auth: true }
);

export const DELETE = createHttpHandler(
  async (ctx) => {
    if (!['owner', 'manager'].includes(ctx.user!.role)) {
      throw ApiErrorFactory.insufficientPermissions(['owner', 'manager']);
    }

    const tenantId = ctx.user!.tenantId!;
    const id = ctx.params?.id;
    if (!id) throw ApiErrorFactory.badRequest('FAQ ID required');

    const { error } = await ctx.supabase
      .from('faqs')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) throw ApiErrorFactory.databaseError(error);

    return { success: true };
  },
  'DELETE',
  { auth: true }
);
