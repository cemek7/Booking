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

    const { data, error } = await ctx.supabase
      .from('reviews')
      .insert({
        tenant_id: tenant.id,
        customer_name: body.customer_name,
        customer_email: body.customer_email ?? null,
        rating: body.rating,
        comment: body.comment ?? null,
        reservation_id: body.reservation_id ?? null,
        // TODO: add IP-based rate limiting (requires infrastructure such as Redis)
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
