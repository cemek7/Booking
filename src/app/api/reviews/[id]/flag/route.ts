export const dynamic = 'force-dynamic';

import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { flagReview } from '@/lib/moderation/reviews';

/**
 * POST /api/reviews/[id]/flag  { reason, reporter? }
 * Report a review for moderation. Public (anyone can report). The review's
 * tenant is resolved server-side from the review id.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const reviewId = ctx.params?.id;
    if (!reviewId) throw ApiErrorFactory.validationError({ id: 'review id is required' });

    const body: { reason?: string; reporter?: string } = await parseJsonBody<{
      reason?: string;
      reporter?: string;
    }>(ctx.request).catch(() => ({}));
    if (!body.reason || !body.reason.trim()) {
      throw ApiErrorFactory.validationError({ reason: 'reason is required' });
    }

    const admin = createSupabaseAdminClient();
    const { data: review } = await admin
      .from('reviews')
      .select('tenant_id')
      .eq('id', reviewId)
      .maybeSingle();
    if (!review) throw ApiErrorFactory.notFound('Review not found');

    await flagReview(admin, {
      tenantId: (review as { tenant_id: string }).tenant_id,
      reviewId,
      reason: body.reason.trim(),
      reporter: body.reporter ?? null,
    });
    return { success: true };
  },
  'POST',
  { auth: false },
);
