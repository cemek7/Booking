/**
 * /api/faqs
 * FAQ knowledge-graph management for tenant agents
 *
 * GET  - List FAQs for tenant
 * POST - Create a new FAQ (owner/manager only)
 */

import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';

const FaqCreateSchema = z.object({
  question: z.string().min(1, 'Question is required'),
  answer: z.string().min(1, 'Answer is required'),
  category: z.string().optional(),
  sort_order: z.number().int().optional(),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });

    const url = new URL(ctx.request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const { data, error } = await ctx.supabase
      .from('faqs')
      .select('id,question,answer,category,is_active,sort_order,created_at,updated_at')
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) throw ApiErrorFactory.databaseError(error);

    return { data: data || [] };
  },
  'GET',
  { auth: true }
);

export const POST = createHttpHandler(
  async (ctx) => {
    if (!['owner', 'manager'].includes(ctx.user!.role)) {
      throw ApiErrorFactory.insufficientPermissions(['owner', 'manager']);
    }

    const tenantId = ctx.user!.tenantId!;
    const raw = await parseJsonBody(ctx.request);
    const body = FaqCreateSchema.parse(raw);

    const { data, error } = await ctx.supabase
      .from('faqs')
      .insert({
        tenant_id: tenantId,
        question: body.question,
        answer: body.answer,
        category: body.category ?? null,
        sort_order: body.sort_order ?? 0,
      })
      .select()
      .single();

    if (error) throw ApiErrorFactory.databaseError(error);

    return { data };
  },
  'POST',
  { auth: true }
);
