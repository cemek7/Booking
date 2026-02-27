/**
 * GET /api/public/[slug]/faqs
 * Public FAQ list for a tenant's marketing mini-site — no auth required.
 */

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import publicBookingService from '@/lib/publicBookingService';

export const GET = createHttpHandler(
  async (ctx) => {
    const slug = ctx.params?.slug;
    if (!slug) throw ApiErrorFactory.badRequest('Slug required');

    const tenant = await publicBookingService.getTenantPublicInfo(slug);

    const { data, error } = await ctx.supabase
      .from('faqs')
      .select('id,question,answer,category,sort_order')
      .eq('tenant_id', tenant.id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) throw ApiErrorFactory.databaseError(error);

    return { data: data || [] };
  },
  'GET',
  { auth: false }
);
