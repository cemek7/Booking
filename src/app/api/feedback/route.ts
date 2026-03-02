import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';

const SubmitFeedbackSchema = z.object({
  reservation_id: z.string().optional(),
  staff_user_id: z.string().min(1),
  customer_name: z.string().optional(),
  score: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

/**
 * POST /api/feedback
 * Submit customer feedback for a completed service.
 * Body: { reservation_id?, staff_user_id, customer_name?, score (1-5), comment? }
 * Requires X-Tenant-ID header.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });

    const body = await ctx.request.json();
    const parsed = SubmitFeedbackSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    }

    const { reservation_id, staff_user_id, customer_name, score, comment } = parsed.data;

    // Prevent duplicate feedback for the same reservation (best-effort pre-check, tenant-scoped)
    if (reservation_id) {
      const { data: existing } = await ctx.supabase
        .from('customer_feedback')
        .select('id')
        .eq('reservation_id', reservation_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();
    if (existing) throw ApiErrorFactory.badRequest(`Feedback already submitted for reservation ${reservation_id}. Each reservation can only be rated once.`);
    }

    const { data, error } = await ctx.supabase
      .from('customer_feedback')
      .insert({
        tenant_id: tenantId,
        reservation_id: reservation_id ?? null,
        staff_user_id,
        customer_name: customer_name ?? null,
        score,
        comment: comment ?? null,
      })
      .select()
      .single();

    if (error) {
      // PostgreSQL unique violation (23505) means a race with the duplicate check
      if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === '23505') {
        throw ApiErrorFactory.badRequest(`Feedback already submitted for reservation ${reservation_id}. Each reservation can only be rated once.`);
      }
      throw ApiErrorFactory.internalServerError(new Error('Failed to save feedback'));
    }

    return { success: true, feedback: data };
  },
  'POST',
  { auth: true }
);

/**
 * GET /api/feedback
 * Query feedback for a tenant. Optionally filter by staff_user_id or date window.
 * Query params: staff_user_id?, days? (default 30)
 * Requires X-Tenant-ID header.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });

    const staffUserId = url.searchParams.get('staff_user_id');
    const daysParam = parseInt(url.searchParams.get('days') || '30', 10);
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    let query = ctx.supabase
      .from('customer_feedback')
      .select('id, staff_user_id, customer_name, score, comment, created_at, reservation_id')
      .eq('tenant_id', tenantId)
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    if (staffUserId) {
      query = query.eq('staff_user_id', staffUserId);
    }

    const { data, error } = await query;
    if (error) throw ApiErrorFactory.internalServerError(new Error('Failed to fetch feedback'));

    const rows = data || [];
    const totalScore = rows.reduce((sum, r) => sum + r.score, 0);
    const avgScore = rows.length > 0 ? Number((totalScore / rows.length).toFixed(2)) : null;

    return {
      feedback: rows,
      summary: {
        count: rows.length,
        avg_score: avgScore,
      },
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'superadmin'] }
);
