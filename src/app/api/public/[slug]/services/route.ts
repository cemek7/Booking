/**
 * Public Booking Routes - No Authentication Required
 */

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import publicBookingService from '@/lib/publicBookingService';

/**
 * GET /api/public/[slug]/services
 * Get services for public booking
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const slug = ctx.params?.slug;

    if (!slug) {
      throw ApiErrorFactory.badRequest('Slug required');
    }

    // Get tenant by slug
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

    const services = await publicBookingService.getTenantServices(tenant.id);
    return services;
  },
  'GET',
  { auth: false }
);
