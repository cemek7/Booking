export const dynamic = 'force-dynamic';

import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { flagReview } from '@/lib/moderation/reviews';
import { isRedisConfigured, cacheGet, cacheSet } from '@/lib/redis';
import { defaultLogger } from '@/lib/logger';

/** Max review reports accepted per IP per hour (abuse guard on a public endpoint). */
const FLAG_RATE_LIMIT = 10;

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

    // IP-based rate limit (mirrors the public review-submission route). Degrades
    // gracefully if Redis is unavailable — never blocks on infra failure.
    if (isRedisConfigured()) {
      let rateLimited = false;
      try {
        const ip = ctx.request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
        const rateKey = `rate:reviewflag:${ip}`;
        const current = ((await cacheGet(rateKey)) as number | null) ?? 0;
        if (current >= FLAG_RATE_LIMIT) rateLimited = true;
        else await cacheSet(rateKey, current + 1, 3600);
      } catch (redisErr) {
        defaultLogger.warn('Review-flag rate-limit check failed (Redis error), allowing', {
          error: String(redisErr),
        });
      }
      if (rateLimited) {
        throw ApiErrorFactory.badRequest('Too many reports submitted. Please try again later.');
      }
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
