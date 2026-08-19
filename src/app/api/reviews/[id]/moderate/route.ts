export const dynamic = 'force-dynamic';

import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { setReviewHidden } from '@/lib/moderation/reviews';

/**
 * POST /api/reviews/[id]/moderate  { action: 'hide' | 'unhide' }
 * Take a review down (or restore it). Tenant owner/manager only; the review
 * must belong to the caller's tenant.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const reviewId = ctx.params?.id;
    if (!reviewId) throw ApiErrorFactory.validationError({ id: 'review id is required' });

    const body: { action?: 'hide' | 'unhide' } = await parseJsonBody<{
      action?: 'hide' | 'unhide';
    }>(ctx.request).catch(() => ({}));
    if (body.action !== 'hide' && body.action !== 'unhide') {
      throw ApiErrorFactory.validationError({ action: "action must be 'hide' or 'unhide'" });
    }

    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('No tenant in context');

    const admin = createSupabaseAdminClient();
    const { data: review } = await admin
      .from('reviews')
      .select('id')
      .eq('id', reviewId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!review) throw ApiErrorFactory.notFound('Review not found');

    const hidden = body.action === 'hide';
    await setReviewHidden(admin, { tenantId, reviewId, hidden });
    return { success: true, hidden };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] },
);
