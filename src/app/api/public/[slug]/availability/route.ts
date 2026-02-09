/**
 * Public Booking Routes - No Authentication Required
 */

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import publicBookingService from '@/lib/publicBookingService';
import type { RouteContext } from '@/lib/error-handling/route-handler';

/**
 * Helper to get tenant by slug
 */
async function getTenantBySlug(ctx: RouteContext, slug: string) {
  const { data: tenant, error: tenantErr } = await ctx.supabase
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  if (tenantErr) {
    throw ApiErrorFactory.databaseError(new Error(tenantErr.message));
  }

  if (!tenant) {
    throw ApiErrorFactory.notFound('Tenant');
  }

  return tenant;
}

/**
 * GET /api/public/[slug]/availability
 * Get available slots for a date
 * Query params: serviceId, date, staffId (optional)
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const slug = ctx.params?.slug;

    if (!slug || typeof slug !== 'string') {
      throw ApiErrorFactory.badRequest('Slug required');
    }

    const url = new URL(ctx.request.url);
    const serviceId = url.searchParams.get('serviceId');
    const date = url.searchParams.get('date');
    const staffId = url.searchParams.get('staffId');

    if (!serviceId || !date) {
      throw ApiErrorFactory.badRequest('serviceId and date required');
    }

    const tenant = await getTenantBySlug(ctx, slug);

    const slots = await publicBookingService.getAvailability(
      tenant.id,
      serviceId,
      date,
      staffId || undefined
    );

    return { slots };
  },
  'GET',
  { auth: false }
);
