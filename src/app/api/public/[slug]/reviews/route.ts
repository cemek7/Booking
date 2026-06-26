export const dynamic = 'force-dynamic';
/**
 * /api/public/[slug]/reviews
 *
 * GET  - Public list of published reviews
 * POST - Submit a new review (no auth required)
 */

import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import publicBookingService from '@/lib/publicBookingService';
import { z } from 'zod';
import { isRedisConfigured, cacheGet, cacheSet } from '@/lib/redis';
import { defaultLogger } from '@/lib/logger';

const ReviewCreateSchema = z.object({
  customer_name: z.string().min(1, 'Name is required'),
  customer_email: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().email().optional()
  ),
  rating: z.number().int().min(1).max(5),
  comment: z.string().optional(),
  reservation_id: z.string().uuid().optional(),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const slug = ctx.params?.slug;
    if (!slug) throw ApiErrorFactory.badRequest('Slug required');

    const tenant = await publicBookingService.getTenantPublicInfo(slug);

    const { data, error } = await ctx.supabase
      .from('reviews')
      .select('id,customer_name,rating,comment,created_at')
      .eq('tenant_id', tenant.id)
      .eq('is_published', true)
      .eq('hidden', false)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw ApiErrorFactory.databaseError(error);

    return { data: data || [] };
  },
  'GET',
  { auth: false }
);

export const POST = createHttpHandler(
  async (ctx) => {
    const slug = ctx.params?.slug;
    if (!slug) throw ApiErrorFactory.badRequest('Slug required');

    const tenant = await publicBookingService.getTenantPublicInfo(slug);
    const raw = await parseJsonBody(ctx.request);
    const body = ReviewCreateSchema.parse(raw);

    // Prevent duplicate reviews for the same reservation
    if (body.reservation_id) {
      const { data: existing } = await ctx.supabase
        .from('reviews')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('reservation_id', body.reservation_id)
        .maybeSingle();
      if (existing) throw ApiErrorFactory.badRequest('A review has already been submitted for this reservation.');
    }

    // IP-based rate limiting: max 5 review submissions per IP per hour
    if (isRedisConfigured()) {
      let rateLimited = false;
      try {
        const ip = ctx.request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
        const rateKey = `rate:review:${slug}:${ip}`;
        const current = (await cacheGet(rateKey) as number | null) ?? 0;
        if (current >= 5) {
          rateLimited = true;
        } else {
          await cacheSet(rateKey, current + 1, 3600);
        }
      } catch (redisErr) {
        // Redis unavailable — degrade gracefully, don't block the request
        defaultLogger.warn('Review rate-limit check failed (Redis error), allowing request', { error: String(redisErr) });
      }
      if (rateLimited) {
        throw ApiErrorFactory.badRequest('Too many reviews submitted. Please try again later.');
      }
    }

    const { data, error } = await ctx.supabase
      .from('reviews')
      .insert({
        tenant_id: tenant.id,
        customer_name: body.customer_name,
        customer_email: body.customer_email ?? null,
        rating: body.rating,
        comment: body.comment ?? null,
        reservation_id: body.reservation_id ?? null,
        is_published: true,
      })
      .select('id,customer_name,rating,comment,created_at')
      .single();

    if (error) throw ApiErrorFactory.databaseError(error);

    return { data };
  },
  'POST',
  { auth: false }
);
